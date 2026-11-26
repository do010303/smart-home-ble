'use strict';

import {
  CCT_PRESETS, LED_SPEC, cctGradient, cctToChannels, clampKelvin, estimatePowerW,
  kelvinLabel, kelvinToHex, percentToLightnessActual
} from './cct.js';
import {
  ADDRESS, LOAD_PROFILES, PATHS, PROVISIONING_STEPS, computeHops, createTidCounter,
  encodeAttentionSet, encodeLightCtlSet, encodeNodeReset, encodeOnOffGet, encodeOnOffSet,
  encodeSceneRecall, encodeSubscriptionOverwrite, formatAddress,
  latencyStats, opcodeName, segmentsNeeded, simulateGroupLatency, toHex
} from './mesh.js';
import {
  DEFAULT_FIRMWARE, DEFAULT_LIGHTS, DEFAULT_LIGHT_STATE, NEW_DEVICE_CANDIDATES, ROOMS, SCENES,
  GATEWAY_FLOORPLAN_POS, FLOORS, FURNITURE, applyLayout, presetsFor
} from './data.js';
import {
  LAYOUT_KEY, ROOM_TYPES, TEMPLATES, addRoom, bboxOf, clampInto, createHistory, fromTemplate, moveRoom,
  areaText, nearestRoom, normalizeLayout, relocateLights, removeRoom, resizeRoom, roomAt, sizeText, snap, updateRoom, wallsOf
} from './layout.js';
import { FLOOR_PATTERNS, furnitureSvg } from './ui/furniture2d.js';
import { executeApiRequest, registerGlobalApi } from './api.js';
import { MAC_RE, SETTINGS_KEY, gatewayBaseUrl, resolveTheme, sanitizeSettings } from './settings.js';
import { mountDevices } from './ui/devices.js';
import { mountSettings } from './ui/settings.js';
import { mountAccount } from './ui/account.js';

const STORAGE_KEY = 'homemesh-mvp-v1';
const THEME_KEY = 'homemesh_theme';
const WELCOME_KEY = 'homemesh-welcome-seen';
const GATEWAY_POS = { x: 50, y: 46 };  // Vị trí gateway trên sơ đồ topology (màn hình Mạng Mesh)
const VIEW_TITLES = {  // Nhãn nhỏ + tiêu đề của từng màn hình
  home: ['Nhà của tôi', 'Chiếu sáng'],
  devices: ['Quét & quản lý', 'Thiết bị'],
  scenes: ['Ngữ cảnh ánh sáng', 'Cảnh'],
  mesh: ['Gateway + BLE Mesh', 'Mạng Mesh & Jitter'],
  log: ['Access message', 'Nhật ký gói tin'],
  settings: ['Tuỳ chỉnh ứng dụng', 'Cài đặt']
};
const views = {};  // Nơi giữ 2 màn hình mount từ js/ui/ (devices, settings)
// Trang phụ (Mạng Mesh, Nhật ký): mở từ Cài đặt → Mạng & gateway, không có trên thanh điều hướng.
const TECH_VIEWS = new Set(['mesh', 'log']);
const openRooms = new Set(); // phòng đang mở danh sách đèn

const nextTid = createTidCounter();  // Bộ đếm TID 0–255 cho mỗi gói (đèn bỏ gói lặp)
const roomById = new Map();  // Map id phòng → phòng, tra nhanh (dựng lại mỗi khi sơ đồ đổi)
const indexRooms = () => { roomById.clear(); ROOMS.forEach((r) => roomById.set(r.id, r)); };

const state = {  // Toàn bộ trạng thái app trong một object
  view: 'home',
  path: 'local',
  gatewayOnline: true,
  theme: 'dark',
  settings: sanitizeSettings(null),
  lights: [],
  samples: [],      // độ trễ một chiều (lệnh → đèn), so với mục tiêu
  rttSamples: [],   // độ trễ khứ hồi của lệnh có Ack
  log: [],
  lastResult: null,
  openLightId: null,
  appliedScene: null,
  provisionTarget: null,
  layout: null,     // sơ đồ nhà người dùng (js/layout.js)
  editing: false,   // đang ở chế độ Sửa sơ đồ
  selectedRoom: null,
  fpOptions: { glow: true, links: false, labels: true, mode: '2d' }
};

const $ = (sel, root = document) => root.querySelector(sel);  // Viết tắt document.querySelector: tìm 1 phần tử
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));  // Viết tắt querySelectorAll, trả mảng
const target = () => state.settings.targetLatencyMs;  // Mục tiêu độ trễ hiện tại (ms) trong cài đặt
const readStorage = (key) => { try { return localStorage.getItem(key); } catch { return null; } };  // Đọc localStorage an toàn (trình duyệt chặn thì trả null)
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));  // Đổi & < > " ' thành thực thể HTML trước khi ghép vào innerHTML

// ---------------------------------------------------------------- Persistence

function load() {  // Đọc đèn và cài đặt từ localStorage lúc mở app
  let saved = null;
  let savedSettings = null;
  try {
    saved = JSON.parse(readStorage(STORAGE_KEY) || 'null');
    savedSettings = JSON.parse(readStorage(SETTINGS_KEY) || 'null');
  } catch {
    saved = null;
  }
  state.settings = sanitizeSettings(savedSettings);
  // Bản cũ lưu theme riêng: chuyển sang cài đặt mới.
  const legacyTheme = readStorage(THEME_KEY);
  if (!savedSettings && (legacyTheme === 'dark' || legacyTheme === 'light')) state.settings.theme = legacyTheme;
  let savedLayout = null;
  try { savedLayout = JSON.parse(readStorage(LAYOUT_KEY) || 'null'); } catch { savedLayout = null; }
  state.layout = normalizeLayout(savedLayout);
  applyLayout(state.layout);
  indexRooms();
  const lights = saved?.lights?.length ? saved.lights : DEFAULT_LIGHTS.map((l) => ({ ...l, ...DEFAULT_LIGHT_STATE }));
  state.lights = withDerived(relocateLights(lights.map((l) => ({ ...l, fx: l.fx ?? l.x, fy: l.fy ?? l.y })), ROOMS).lights);
  state.path = saved?.path in PATHS ? saved.path : state.settings.defaultPath;
  state.gatewayOnline = saved?.gatewayOnline ?? true;
}

function save() {  // Ghi đèn, đường truyền, gateway, cài đặt vào localStorage
  try {
    const lights = state.lights.map(({ hops, rssi, ping, lastPacket, identifyUntil, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lights, path: state.path, gatewayOnline: state.gatewayOnline }));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(state.layout));
  } catch {
    /* localStorage có thể bị chặn — demo vẫn chạy bình thường */
  }
}

function withDerived(lights) {  // Thêm trường tính được: số hop, RSSI, toạ độ mặt bằng, firmware
  return computeHops(lights).map((l, i) => ({
    ...l,
    fx: l.fx ?? l.x,
    fy: l.fy ?? l.y,
    fw: l.fw ?? DEFAULT_FIRMWARE,
    rssi: -44 - l.hops * 9 - (i % 3) * 3
  }));
}

// ---------------------------------------------------------------- Theme Switcher

const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

function applyTheme() {  // Gắn data-theme lên <html>, đổi icon, màu thanh trình duyệt, class no-motion
  const theme = resolveTheme(state.settings.theme, darkQuery?.matches ?? true);
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  $('#theme-icon').textContent = isDark ? '🌙' : '☀️';
  $('#theme-text').textContent = isDark ? 'Tối' : 'Sáng';
  $('meta[name="theme-color"]').setAttribute('content', isDark ? '#0E1116' : '#F8FAFC');
  document.documentElement.classList.toggle('no-motion', !state.settings.animations);
}

function toggleTheme() {  // Đảo sáng / tối từ nút trên thanh trên
  updateSettings({ theme: state.theme === 'dark' ? 'light' : 'dark' });
  toast(`Đã chuyển sang giao diện ${state.theme === 'dark' ? 'Tối' : 'Sáng'}`);
}

// Gộp thay đổi cài đặt, kiểm tra hợp lệ, lưu và áp dụng ngay.
function updateSettings(patch) {
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  save();
  applyTheme();
  renderGateway();
  views.settings?.render();
  return state.settings;
}

// ---------------------------------------------------------------- Mesh transport (mô phỏng)

let warnedFallback = false;

function effectivePath() {  // Đường truyền thật sự dùng; gateway offline thì sang BLE Proxy
  if (!state.gatewayOnline && state.path !== 'proxy') {
    if (!warnedFallback) {
      toast('Gateway mất kết nối → tự chuyển sang BLE GATT Proxy');
      warnedFallback = true;
    }
    return 'proxy';
  }
  warnedFallback = false;
  return state.path;
}

// Gửi 1 access message tới `dst`; `targets` là các đèn sẽ nhận (unicast: 1 đèn, group: cả phòng).
// Nếu ack = true, tính thêm độ trễ vòng lặp phản hồi (Round-Trip Response Time).
function transmit({ bytes, dst, targets, record = true, animate = true, ack = false }) {  // Hàm gửi duy nhất: mọi lệnh tới đèn đều đi qua đây
  const path = effectivePath();
  const segments = segmentsNeeded(bytes.length);
  // Qua GATT Proxy: điện thoại kết nối node gần nhất nên bớt 1 hop so với gateway.
  const nodes = targets.map((l) => ({ id: l.id, hops: path === 'proxy' ? Math.max(1, l.hops - 1) : l.hops }));
  const scale = LOAD_PROFILES[state.settings.loadProfile]?.scale ?? 1;
  const result = simulateGroupLatency(nodes, { path, segments, ack, scale });
  const outOfRange = nodes.filter((n) => n.hops > state.settings.ttl).length;

  const entry = {
    time: new Date(),
    path,
    src: path === 'proxy' ? 'Phone' : formatAddress(ADDRESS.GATEWAY),
    dst: formatAddress(dst),
    opcode: opcodeName(bytes),
    hex: toHex(bytes),
    segments,
    ttl: state.settings.ttl,
    latency: result.oneWay,
    rtt: ack ? result.total : null,
    slowestId: result.slowest?.node.id ?? null,
    targets: targets.length,
    outOfRange,
    isAck: ack
  };

  if (outOfRange && record) toast(`${outOfRange} đèn ở xa hơn ${state.settings.ttl} hop — vượt TTL, gói có thể không tới`);
  if (record) {
    state.samples.push(result.oneWay);
    if (state.samples.length > 500) state.samples.shift();
    if (ack) {
      state.rttSamples.push(result.total);
      if (state.rttSamples.length > 500) state.rttSamples.shift();
    }
    state.log.unshift(entry);
    if (state.log.length > 200) state.log.pop();
    state.lastResult = { ...result, entry };
    renderLatencyPill();
    if (state.view === 'mesh') renderMeshStats();
    if (state.view === 'log') renderLog();
  }
  if (animate && state.view === 'mesh') flashTopology(targets, path);
  if (animate && state.view === 'home') flashFloorplan(targets);
  return { result, entry };
}

const throttleMap = new Map();  // Thời điểm gửi gần nhất theo từng khoá, dùng cho throttled()
function throttled(key, fn) {  // Chỉ chạy hàm nếu đã qua throttleMs kể từ lần trước cùng khoá
  const now = performance.now();
  if (now - (throttleMap.get(key) ?? 0) < state.settings.throttleMs) return;
  throttleMap.set(key, now);
  fn();
}

function ctlBytes(light, ack) {  // Mã hoá Light CTL Set từ độ sáng % và Kelvin của đèn
  return encodeLightCtlSet({
    lightness: percentToLightnessActual(light.lightness),
    temperature: light.kelvin,
    tid: nextTid(),
    ack
  });
}

// ---------------------------------------------------------------- Actions

function lightById(id) {  // Tìm đèn theo id
  return state.lights.find((l) => l.id === id);
}

function roomLights(roomId) {  // Các đèn thuộc một phòng
  return state.lights.filter((l) => l.room === roomId);
}

function setLight(id, patch, { ack = true, send = true } = {}) {  // Đổi một đèn (bật/tắt, độ sáng, màu) và gửi gói
  const light = lightById(id);
  if (!light) return;
  Object.assign(light, patch);
  if ('kelvin' in patch) light.kelvin = clampKelvin(light.kelvin);

  if (send) {
    const onlyPower = Object.keys(patch).length === 1 && 'on' in patch;
    const bytes = onlyPower || !light.on
      ? encodeOnOffSet({ on: light.on, tid: nextTid(), ack })
      : ctlBytes(light, ack);
    const { entry } = transmit({ bytes, dst: light.unicast, targets: [light], ack });
    light.lastPacket = entry;
  }
  state.appliedScene = null;
  refresh();
}

function setRoom(roomId, patch, { ack = true } = {}) {  // Đổi cả phòng bằng một gói tới địa chỉ group của phòng
  if (!roomById.has(roomId)) return;  // phòng không còn trong sơ đồ
  const lights = roomLights(roomId);
  if (lights.length === 0) return;
  lights.forEach((l) => Object.assign(l, patch));
  const sample = { ...lights[0], ...patch };
  const bytes = 'on' in patch && Object.keys(patch).length === 1
    ? encodeOnOffSet({ on: patch.on, tid: nextTid(), ack })
    : ctlBytes(sample, ack);
  const { entry } = transmit({ bytes, dst: roomById.get(roomId).group, targets: lights, ack });
  lights.forEach((l) => { l.lastPacket = entry; });
  state.appliedScene = null;
  refresh();
}

function setAllLights(on) {  // Bật / tắt cả nhà bằng 1 gói tới group 0xC000
  state.lights.forEach((l) => { l.on = on; });
  const { entry } = transmit({
    bytes: encodeOnOffSet({ on, tid: nextTid(), ack: false }),
    dst: ADDRESS.GROUP_ALL_LIGHTS,
    targets: state.lights
  });
  state.lights.forEach((l) => { l.lastPacket = entry; });
  state.appliedScene = null;
  refresh();
  toast(on ? 'Đã bật toàn bộ đèn trong nhà' : 'Đã tắt toàn bộ đèn trong nhà');
}

function recallScene(sceneId, scope) {  // Gọi cảnh cho cả nhà hoặc một phòng (Scene Recall)
  const scene = SCENES.find((s) => s.id === sceneId);
  const lights = scope === 'all' ? state.lights : roomLights(scope);
  if (!scene || lights.length === 0) return;
  lights.forEach((l) => Object.assign(l, scene.off
    ? { on: false }
    : { on: true, kelvin: scene.kelvin, lightness: scene.lightness }));
  const dst = scope === 'all' ? ADDRESS.GROUP_ALL_LIGHTS : roomById.get(scope).group;
  const { result } = transmit({ bytes: encodeSceneRecall({ scene: scene.id, tid: nextTid(), ack: false }), dst, targets: lights });
  state.appliedScene = sceneId;
  refresh();
  toast(`Cảnh “${scene.name}” → ${lights.length} đèn · ${result.total} ms`);
}

// ---------------------------------------------------------------- Quản lý thiết bị

// Nháy nhận diện: Health Attention Set → đèn nhấp nháy trong N giây.
function identifyLight(id, seconds = state.settings.attentionSeconds) {
  const light = lightById(id);
  if (!light) return null;
  const { entry } = transmit({ bytes: encodeAttentionSet({ seconds, ack: true }), dst: light.unicast, targets: [light], ack: true });
  light.lastPacket = entry;
  light.identifyUntil = Date.now() + seconds * 1000;
  paintIdentify();
  setTimeout(paintIdentify, seconds * 1000 + 50);
  toast(`“${light.name}” đang nháy ${seconds} giây để nhận diện`);
  return entry;
}

function paintIdentify() {  // Bật/tắt class identify cho đèn đang nháy ở mọi màn hình
  const now = Date.now();
  state.lights.forEach((l) => {
    const on = (l.identifyUntil ?? 0) > now;
    $$(`[data-light="${l.id}"], [data-fp-light="${l.id}"], [data-device-row="${l.id}"]`).forEach((el) => el.classList.toggle('identify', on));
  });
}

function renameLight(id, name) {  // Đổi tên đèn (tối đa 40 ký tự)
  const light = lightById(id);
  const clean = String(name).trim().slice(0, 40);
  if (!light || !clean) return false;
  light.name = clean;
  rebuildAll();
  return true;
}

// Chuyển phòng = ghi đè subscription của model Light CTL sang group của phòng mới.
function moveLight(id, roomId) {
  const light = lightById(id);
  const room = roomById.get(roomId);
  if (!light || !room || light.room === roomId) return false;
  const { entry } = transmit({
    bytes: encodeSubscriptionOverwrite({ elementAddress: light.unicast, groupAddress: room.group }),
    dst: light.unicast,
    targets: [light],
    ack: true
  });
  light.lastPacket = entry;
  light.room = roomId;
  const b = room.bounds;
  const p = clampInto(b, b.x + b.w / 2 + (Math.random() - 0.5) * (b.w - 8), b.y + b.h / 2 + (Math.random() - 0.5) * (b.h - 8), 4);
  light.fx = p.x;
  light.fy = p.y;
  rebuildAll();
  return true;
}

// Xoá khỏi mạng: Config Node Reset. Đèn con đang relay qua nó được nối lên node cha.
function removeLight(id) {  // Xoá đèn khỏi mạng và nối lại các đèn con
  const light = lightById(id);
  if (!light) return false;
  transmit({ bytes: encodeNodeReset(), dst: light.unicast, targets: [light], ack: true });
  const rest = state.lights
    .filter((l) => l.id !== id)
    .map(({ hops, rssi, ...l }) => (l.via === id ? { ...l, via: light.via } : l));
  state.lights = withDerived(rest);
  if (state.openLightId === id) $('#device-sheet').close();
  rebuildAll();
  return true;
}

function rebuildAll() {  // Tính lại hop, lưu và dựng lại mọi màn hình sau khi thêm / xoá đèn
  save();
  buildHome();
  if (state.view === 'home') buildFloorplan();
  if (state.view === 'mesh') { buildTopology(); renderNodeTable(); }
  views.devices?.render();
  paintIdentify();
}

function nextLightId() {  // Id kế tiếp dạng L<n>
  const nums = state.lights.map((l) => Number(String(l.id).replace(/\D/g, ''))).filter(Number.isFinite);
  return `L${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

// ---------------------------------------------------------------- Rendering helpers

function glow(light) {  // Độ phát sáng 0–1 của bóng theo độ sáng
  return light.on ? (0.15 + (light.lightness / 100) * 0.85).toFixed(2) : 0;
}

function paintBulb(el, light) {  // Gán biến CSS --c (màu) và --g (độ sáng) cho bóng đèn
  el.style.setProperty('--c', kelvinToHex(light.kelvin));
  el.style.setProperty('--g', glow(light));
}

function latencyClass(ms) {  // Class màu xanh / đỏ theo mục tiêu độ trễ
  return ms < target() ? 'lat-ok' : 'lat-bad';
}

function average(values) {  // Trung bình cộng
  return values.reduce((s, v) => s + v, 0) / (values.length || 1);
}

function isEditing(el) {  // Phần tử đang được kéo / gõ thì không ghi đè giá trị
  return document.activeElement === el && el.matches('input[type="range"]');
}

let toastTimer;
function toast(message) {  // Hiện thông báo ngắn 2,4 giây
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function refresh() {  // Lưu rồi vẽ lại những gì đang hiện trên màn hình
  save();
  updateHome();
  if (state.openLightId) updateSheet();
  if (state.view === 'home') updateFloorplan();
  if (state.view === 'scenes') updateScenes();
  if (state.view === 'mesh') { updateTopology(); renderNodeTable(); }
  if (state.view === 'devices') views.devices?.render();
}

// ---------------------------------------------------------------- Top bar & navigation

function setView(view) {  // Chuyển màn hình: đổi class is-active và vẽ màn hình mới
  if (view === 'floorplan') view = 'home'; // link cũ ?view=floorplan
  if (!(view in VIEW_TITLES)) view = 'home';
  state.view = view;
  const navView = TECH_VIEWS.has(view) ? 'settings' : view;
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === navView));
  $('#back-settings').hidden = !TECH_VIEWS.has(view);
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  const [eyebrow, title] = VIEW_TITLES[view] || ['HomeMesh', view];
  $('#view-eyebrow').textContent = eyebrow;
  $('#view-title').textContent = title;

  if (view === 'home') {
    buildFloorplan();
    if (state.fpOptions.mode === '3d') setFloorplanMode('3d', { quiet: true });
  }
  if (view === 'scenes') updateScenes();
  if (view === 'mesh') { buildTopology(); renderMeshStats(); renderNodeTable(); }
  if (view === 'log') renderLog();
  if (view === 'devices') views.devices?.render();
  if (view === 'settings') views.settings?.render();
  paintIdentify();
  window.scrollTo({ top: 0 });
}

function renderPathControl() {  // Tô nút đường truyền đang chọn
  $$('#path-control button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.path === state.path)));
}

function renderLatencyPill() {  // Viên độ trễ lệnh gần nhất (trong Cài đặt → Mạng & gateway)
  const pill = $('#latency-pill');
  const last = state.lastResult;
  pill.classList.toggle('is-idle', !last);
  pill.classList.toggle('is-late', !!last && last.oneWay >= target());
  $('#latency-pill-text').textContent = last ? `${last.oneWay.toFixed(1)} ms · ${PATHS[last.entry.path].short}` : '— ms';
  pill.title = `Độ trễ một chiều của lệnh gần nhất (mục tiêu < ${target()} ms)`;
}

function renderGateway() {  // Ô trạng thái gateway ở thanh điều hướng
  $('#nav-gateway').classList.toggle('is-offline', !state.gatewayOnline);
  $('#nav-gateway-name').textContent = `Gateway ${state.settings.gatewayName}`;
  $('#nav-gateway-text').textContent = state.gatewayOnline ? `Online · ${state.settings.gatewayHost}` : 'Offline · dùng BLE Proxy';
  $('#gateway-online').checked = state.gatewayOnline;
  $('#topology .gw')?.classList.toggle('offline', !state.gatewayOnline);
  $('#floorplan-svg .fp-gw')?.classList.toggle('offline', !state.gatewayOnline);
}

// ---------------------------------------------------------------- 1. Nhà của tôi: điều khiển theo phòng

// Trạng thái gộp của một phòng: đèn đang bật, màu / độ sáng trung bình, công suất.
function roomSummary(roomId) {
  const lights = roomLights(roomId);
  const onLights = lights.filter((l) => l.on);
  const ref = onLights.length ? onLights : lights;
  return {
    lights,
    onLights,
    kelvin: ref.length ? Math.round(average(ref.map((l) => l.kelvin)) / 50) * 50 : DEFAULT_LIGHT_STATE.kelvin,
    lightness: ref.length ? Math.round(average(ref.map((l) => l.lightness))) : DEFAULT_LIGHT_STATE.lightness,
    watts: lights.reduce((sum, l) => sum + estimatePowerW(l.watts, l.on, l.lightness), 0)
  };
}

// Kiểu sáng đang khớp với mọi đèn trong phòng (null nếu không khớp kiểu nào).
function activePreset(roomId) {
  const lights = roomLights(roomId);
  if (!lights.length || lights.some((l) => !l.on)) return null;
  return presetsFor(roomById.get(roomId)).find((p) => lights.every((l) => l.kelvin === p.kelvin && l.lightness === p.lightness))?.id ?? null;
}

function applyRoomPreset(roomId, presetId) {  // Áp một kiểu sáng có sẵn cho cả phòng
  const preset = presetsFor(roomById.get(roomId)).find((p) => p.id === presetId);
  const room = roomById.get(roomId);
  if (!preset || !room) return;
  setRoom(roomId, { on: true, kelvin: preset.kelvin, lightness: preset.lightness });
  toast(`${room.name}: ${preset.name} · ${preset.kelvin}K ${preset.lightness}%`);
}

// Làm nổi thẻ phòng khi bấm tên phòng trên sơ đồ.
function focusRoom(roomId) {
  const card = $(`#rooms .room-card[data-room="${roomId}"]`);
  if (!card) return;
  card.classList.add('is-focus');
  card.scrollIntoView({ behavior: state.settings.animations ? 'smooth' : 'auto', block: 'nearest' });
  setTimeout(() => card.classList.remove('is-focus'), 1400);
}

function buildHome() {  // Dựng lại HTML các thẻ phòng (khi danh sách đèn đổi)
  $('#rooms').innerHTML = ROOMS.map((room) => {
    const lights = roomLights(room.id);
    const presets = presetsFor(room);
    const body = lights.length ? `
      <div class="preset-row" role="group" aria-label="Kiểu sáng ${room.name}">${presets.map((p) => `
        <button type="button" class="preset" data-preset="${p.id}" style="--c:${kelvinToHex(p.kelvin)}">
          <span aria-hidden="true">${p.icon}</span><b>${p.name}</b><small>${p.kelvin}K · ${p.lightness}%</small>
        </button>`).join('')}
      </div>
      <div class="room-sliders">
        <label class="slider"><span class="control-label"><span>Độ sáng</span><output data-out="lightness"></output></span>
          <input type="range" class="range range-light" data-action="room-lightness" min="1" max="100" aria-label="Độ sáng ${room.name}" /></label>
        <label class="slider"><span class="control-label"><span>Màu ánh sáng</span><output data-out="kelvin"></output></span>
          <input type="range" class="range range-cct" data-action="room-kelvin" min="${LED_SPEC.minK}" max="${LED_SPEC.maxK}" step="50" aria-label="Màu ánh sáng ${room.name}" />
          <span class="cct-ticks"><span>Vàng ấm</span><span>Trắng</span></span></label>
      </div>
      <details class="room-lights"${openRooms.has(room.id) ? ' open' : ''}>
        <summary>${lights.length} đèn trong phòng</summary>
        ${lights.map((l) => `
        <div class="light-row" data-light="${l.id}">
          <span class="bulb" aria-hidden="true"></span>
          <div class="light-row-info"><strong>${escapeHtml(l.name)}</strong><small class="light-meta"></small></div>
          <input type="range" class="range mini range-light" data-action="light-lightness" min="1" max="100" aria-label="Độ sáng ${escapeHtml(l.name)}" />
          <label class="switch-row"><input type="checkbox" data-action="light-toggle" aria-label="Bật/tắt ${escapeHtml(l.name)}" /><span class="switch"></span></label>
          <button type="button" class="btn small-btn" data-open="${l.id}">Chỉnh</button>
        </div>`).join('')}
      </details>` : '<p class="muted small">Phòng chưa có đèn. Bấm <b>+ Thêm đèn</b> để quét đèn mới, hoặc <b>✏️ Sửa sơ đồ</b> rồi kéo đèn có sẵn vào phòng này.</p>';
    return `
    <article class="room-card" data-room="${room.id}">
      <header class="room-card-head">
        <span class="room-glow" aria-hidden="true">${room.icon}</span>
        <div class="room-card-title"><h3>${room.name}</h3><small class="room-status"></small></div>
        <label class="switch-row big" title="Bật/tắt cả phòng"><input type="checkbox" data-action="room-toggle" aria-label="Bật/tắt ${room.name}"${lights.length ? '' : ' disabled'} /><span class="switch"></span></label>
      </header>${body}
    </article>`;
  }).join('');

  $$('#rooms .range-cct').forEach((el) => { el.style.background = cctGradient(); });
  updateHome();
}

function updateHome() {  // Đổ giá trị hiện tại vào thẻ phòng có sẵn (không dựng lại, không mất focus khi kéo)
  const on = state.lights.filter((l) => l.on);
  const watts = state.lights.reduce((sum, l) => sum + estimatePowerW(l.watts, l.on, l.lightness), 0);
  const litRooms = ROOMS.filter((r) => roomLights(r.id).some((l) => l.on)).length;
  $('#summary').innerHTML = `
    <span class="summary-chip"><b>${on.length}/${state.lights.length}</b> đèn đang bật</span>
    <span class="summary-chip"><b>${litRooms}/${ROOMS.length}</b> phòng có sáng</span>
    <span class="summary-chip"><b>${watts.toFixed(1)} W</b> đang dùng</span>
    <span class="summary-chip${state.gatewayOnline ? '' : ' bad'}"><i class="dot${state.gatewayOnline ? '' : ' bad'}"></i>Gateway ${state.gatewayOnline ? 'online' : 'offline'}</span>`;

  $$('#rooms .room-card').forEach((card) => {
    const s = roomSummary(card.dataset.room);
    if (!s.lights.length) return;
    const hex = kelvinToHex(s.kelvin);
    const lit = s.onLights.length > 0;
    card.classList.toggle('is-off', !lit);
    card.style.setProperty('--c', hex);
    card.style.setProperty('--g', lit ? (0.15 + (s.lightness / 100) * 0.85).toFixed(2) : 0);
    $('.room-status', card).textContent = lit
      ? `${s.onLights.length}/${s.lights.length} đèn bật · ${s.watts.toFixed(1)} W`
      : `Đang tắt · ${s.lights.length} đèn`;
    $('[data-action="room-toggle"]', card).checked = lit;

    const k = $('[data-action="room-kelvin"]', card);
    const b = $('[data-action="room-lightness"]', card);
    if (!isEditing(k)) k.value = s.kelvin;
    if (!isEditing(b)) b.value = s.lightness;
    k.style.setProperty('--thumb', kelvinToHex(Number(k.value)));
    b.style.background = `linear-gradient(90deg, #2a2f38, ${hex})`;
    $('[data-out="kelvin"]', card).textContent = `${k.value}K · ${kelvinLabel(Number(k.value))}`;
    $('[data-out="lightness"]', card).textContent = `${b.value}%`;

    const active = activePreset(card.dataset.room);
    $$('[data-preset]', card).forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.preset === active);
      btn.setAttribute('aria-pressed', String(btn.dataset.preset === active));
    });

    $$('.light-row', card).forEach((row) => {
      const light = lightById(row.dataset.light);
      if (!light) return;
      row.classList.toggle('is-off', !light.on);
      paintBulb($('.bulb', row), light);
      $('[data-action="light-toggle"]', row).checked = light.on;
      const r = $('[data-action="light-lightness"]', row);
      if (!isEditing(r)) r.value = light.lightness;
      r.style.background = `linear-gradient(90deg, #2a2f38, ${kelvinToHex(light.kelvin)})`;
      $('.light-meta', row).textContent = light.on ? `${light.kelvin}K · ${light.lightness}%` : 'Đang tắt';
    });
  });
}

function bindHome() {  // Gắn sự kiện cho các thẻ phòng (một lần, kiểu event delegation)
  const rooms = $('#rooms');
  rooms.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openSheet(open.dataset.open); return; }
    const preset = e.target.closest('[data-preset]');
    if (preset) applyRoomPreset(preset.closest('.room-card').dataset.room, preset.dataset.preset);
  });

  // Nhớ phòng nào đang mở danh sách đèn (sự kiện toggle không nổi bọt → bắt ở pha capture).
  rooms.addEventListener('toggle', (e) => {
    const room = e.target.closest?.('.room-card')?.dataset.room;
    if (!room) return;
    if (e.target.open) openRooms.add(room); else openRooms.delete(room);
  }, true);

  rooms.addEventListener('change', (e) => {
    const el = e.target;
    const room = el.closest('.room-card')?.dataset.room;
    const lightId = el.closest('.light-row')?.dataset.light;
    switch (el.dataset.action) {
      case 'light-toggle': setLight(lightId, { on: el.checked }); break;
      case 'light-lightness': setLight(lightId, { on: true, lightness: Number(el.value) }); break;
      case 'room-toggle': setRoom(room, { on: el.checked }); break;
      case 'room-kelvin': setRoom(room, { on: true, kelvin: Number(el.value) }, { ack: true }); break;
      case 'room-lightness': setRoom(room, { on: true, lightness: Number(el.value) }, { ack: true }); break;
      default:
    }
  });

  // Đang kéo: đổi giao diện ngay, gửi gói Unack theo nhịp throttleMs.
  rooms.addEventListener('input', (e) => {
    const el = e.target;
    const value = Number(el.value);
    if (el.dataset.action === 'light-lightness') {
      const id = el.closest('.light-row').dataset.light;
      Object.assign(lightById(id), { on: true, lightness: value });
      updateHome();
      if (state.view === 'home') updateFloorplan();
      throttled(`light-${id}`, () => setLight(id, { on: true, lightness: value }, { ack: false }));
      return;
    }
    const key = el.dataset.action === 'room-kelvin' ? 'kelvin' : el.dataset.action === 'room-lightness' ? 'lightness' : null;
    if (!key) return;
    const room = el.closest('.room-card').dataset.room;
    roomLights(room).forEach((l) => { l[key] = value; l.on = true; });
    updateHome();
    if (state.view === 'home') updateFloorplan();
    throttled(`room-${room}`, () => setRoom(room, { on: true, [key]: value }, { ack: false }));
  });
}

// ---------------------------------------------------------------- 2. Sơ đồ Mặt bằng Nhà (Floorplan)

function buildFloorplan() {  // Vẽ toàn bộ sơ đồ 2D bằng SVG theo từng lớp
  const svg = $('#floorplan-svg');

  // 1. Defs Radial Gradients cho quầng sáng CCT từng đèn
  const defs = state.lights.map((l) => `
    <radialGradient id="fp-glow-${l.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="${(l.on ? 0.38 * (l.lightness / 100) : 0).toFixed(2)}" />
      <stop offset="55%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="${(l.on ? 0.16 * (l.lightness / 100) : 0).toFixed(2)}" />
      <stop offset="100%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="0" />
    </radialGradient>`).join('');

  // 2. Nhãn phòng (tên, diện tích, số đèn) — co theo cỡ phòng
  const roomZones = ROOMS.map((r) => {
    const b = r.bounds;
    const tw = Math.min(28, b.w - 4);
    const tall = b.h >= 16;
    return `
      <g class="room-zone" data-fp-room="${r.id}">
        <rect class="room-tag-bg" x="${b.x + 2}" y="${b.y + 2}" width="${tw}" height="${tall ? 7.2 : 4.6}" />
        <text class="room-tag-text" x="${b.x + 2 + tw / 2}" y="${b.y + 5.2}">${r.icon} ${escapeHtml(r.name)}</text>
        ${tall ? `<text class="room-tag-area" x="${b.x + 2 + tw / 2}" y="${b.y + 8.2}">${areaText(b)} · ${roomLights(r.id).length} đèn</text>` : ''}
      </g>`;
  }).join('');

  // 3. Quầng sáng (Glow cones)
  const glows = state.lights.map((l) => `
    <circle class="fp-glow" data-glow="${l.id}" cx="${l.fx}" cy="${l.fy}" r="22" fill="url(#fp-glow-${l.id})" style="${state.fpOptions.glow ? '' : 'display:none;'}" />
  `).join('');

  // 4. Đường truyền Mesh trên mặt bằng
  const links = state.lights.map((l) => {
    const parent = l.via === 'gateway' ? GATEWAY_FLOORPLAN_POS : lightById(l.via) ?? GATEWAY_FLOORPLAN_POS;
    const px = parent.fx ?? parent.x;
    const py = parent.fy ?? parent.y;
    return `<line class="fp-mesh-link" data-fp-link="${l.id}" x1="${px}" y1="${py}" x2="${l.fx}" y2="${l.fy}" style="${state.fpOptions.links ? '' : 'display:none;'}" />`;
  }).join('');

  // 5. Đèn (Fixtures)
  const fixtures = state.lights.map((l) => `
    <g class="fp-fixture${l.relay ? ' relay' : ''}${l.on ? '' : ' is-off'}" data-fp-light="${l.id}">
      <title>${escapeHtml(l.name)} (${l.room}) · ${l.watts}W · ${l.on ? `${l.kelvin}K · ${l.lightness}%` : 'Đang tắt'}</title>
      <circle class="fp-fixture-base" cx="${l.fx}" cy="${l.fy}" r="4.2" />
      <circle class="fp-fixture-ring" cx="${l.fx}" cy="${l.fy}" r="3.4" fill="none" />
      <circle class="fp-fixture-core" cx="${l.fx}" cy="${l.fy}" r="2.4" fill="${l.on ? kelvinToHex(l.kelvin) : '#3a4250'}" />
      <text class="fp-fixture-label" x="${l.fx}" y="${l.fy + 6.8}" style="${state.fpOptions.labels ? '' : 'display:none;'}">${l.id}</text>
    </g>`).join('');

  // 6. Gateway
  const gw = `
    <g class="fp-gw${state.gatewayOnline ? '' : ' offline'}">
      <title>Gateway trung tâm GW-01 (0x0001)</title>
      <circle class="fp-gw-pulse" cx="${GATEWAY_FLOORPLAN_POS.x}" cy="${GATEWAY_FLOORPLAN_POS.y}" r="4" />
      <circle class="fp-gw-core" cx="${GATEWAY_FLOORPLAN_POS.x}" cy="${GATEWAY_FLOORPLAN_POS.y}" r="3.6" />
      <text class="fp-fixture-label" x="${GATEWAY_FLOORPLAN_POS.x}" y="${GATEWAY_FLOORPLAN_POS.y + 1}" style="fill:#0e1116;font-weight:700">GW</text>
    </g>`;

  svg.innerHTML = `
    <defs>${FLOOR_PATTERNS}${defs}<pattern id="fp-grid" width="10" height="10" x="4" y="4" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" class="ed-grid-line" /></pattern></defs>
    <!-- Nền, sàn từng phòng, nội thất -->
    <rect class="fp-bg" x="0" y="0" width="100" height="100" rx="3" />
    ${ROOMS.map((r) => { const z = roomZone(r); return `<rect class="fp-floor" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="url(#fp-${FLOORS[r.id] ?? 'wood'})" />`; }).join('')}
    <g class="fp-furniture">${furnitureSvg(FURNITURE)}</g>
    <!-- Phòng tối dần khi tắt đèn -->
    ${ROOMS.map((r) => { const z = roomZone(r); return `<rect class="fp-shade" data-shade="${r.id}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" />`; }).join('')}
    ${state.editing ? '<rect class="ed-grid" x="4" y="4" width="92" height="92" fill="url(#fp-grid)" />' : ''}
    <!-- Tường: cạnh của từng phòng (cạnh chung chỉ vẽ 1 lần) + tường bao -->
    ${wallsOf(ROOMS).map(([x1, y1, x2, y2]) => `<line class="fp-inner-wall" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`).join('')}
    ${(() => { const o = bboxOf(ROOMS); return `<rect class="fp-outer-wall" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="1" />`; })()}

    ${roomZones}
    ${glows}
    ${links}
    ${gw}
    ${editorLayer()}
    ${fixtures}
  `;

  updateFloorplan();
}

// Vùng sàn của phòng = đúng hình chữ nhật người dùng vẽ.
function roomZone(room) {
  return room.bounds;
}

// Độ sáng cảm nhận trung bình của phòng (0–1), dùng để làm tối phòng trên bản 2D.
function roomBrightness(roomId) {
  const lights = roomLights(roomId);
  if (!lights.length) return 0;
  return Math.min(1, (lights.reduce((s, l) => s + (l.on ? l.lightness / 100 : 0), 0) / lights.length) * 1.4);
}

function updateFloorplan() {  // Cập nhật màu, độ tối phòng, nhãn trên sơ đồ 2D và gọi 3D sync()
  ROOMS.forEach((r) => {
    const shade = $(`#floorplan-svg [data-shade="${r.id}"]`);
    if (shade) shade.style.opacity = (0.62 * (1 - roomBrightness(r.id))).toFixed(2);
  });
  fp3d.api?.sync();
  state.lights.forEach((l) => {
    const hex = kelvinToHex(l.kelvin);
    const grad = $(`#fp-glow-${l.id}`);
    if (grad) {
      const stops = grad.querySelectorAll('stop');
      if (stops.length >= 2) {
        stops[0].setAttribute('stop-color', hex);
        stops[0].setAttribute('stop-opacity', (l.on ? 0.38 * (l.lightness / 100) : 0).toFixed(2));
        stops[1].setAttribute('stop-color', hex);
        stops[1].setAttribute('stop-opacity', (l.on ? 0.16 * (l.lightness / 100) : 0).toFixed(2));
      }
    }
    const fixture = $(`#floorplan-svg [data-fp-light="${l.id}"]`);
    if (fixture) {
      fixture.classList.toggle('is-off', !l.on);
      const core = fixture.querySelector('.fp-fixture-core');
      if (core) core.setAttribute('fill', l.on ? hex : '#3a4250');
      const label = fixture.querySelector('.fp-fixture-label');
      if (label) {
        label.textContent = state.fpOptions.labels ? (l.on ? `${l.id}·${estimatePowerW(l.watts, l.on, l.lightness).toFixed(0)}W` : l.id) : '';
      }
    }
  });
}

function flashFloorplan(targets) {  // Hiệu ứng gói tin chạy tới đèn trên sơ đồ
  fp3d.api?.flash(targets);
  const svg = $('#floorplan-svg');
  if (!svg) return;
  const pulse = $('.fp-gw-pulse', svg);
  if (pulse) {
    pulse.classList.remove('go');
    void pulse.getBBox();
    pulse.classList.add('go');
  }
  targets.forEach((light) => {
    const link = $(`[data-fp-link="${light.id}"]`, svg);
    const g = $(`[data-fp-light="${light.id}"]`, svg);
    link?.classList.add('flash');
    g?.classList.add('flash');
    setTimeout(() => { link?.classList.remove('flash'); g?.classList.remove('flash'); }, 260);
  });
}

function bindFloorplan() {  // Gắn sự kiện sơ đồ: bấm đèn, bấm tên phòng, công tắc hiển thị, 2D/3D, ngày/đêm
  $('#floorplan-svg').addEventListener('click', (e) => {
    if (state.editing) return;  // chế độ Sửa sơ đồ: bấm = chọn / kéo, không bật tắt đèn
    const fixture = e.target.closest('[data-fp-light]');
    if (!fixture) {
      const zone = e.target.closest('[data-fp-room]');
      if (zone) focusRoom(zone.dataset.fpRoom);
      return;
    }
    const lightId = fixture.dataset.fpLight;
    const light = lightById(lightId);
    if (!light) return;

    // Click vào tâm đèn -> mở sheet chi tiết
    if (e.target.classList.contains('fp-fixture-core')) {
      openSheet(lightId);
    } else {
      // Click vào bóng -> bật/tắt nhanh
      setLight(lightId, { on: !light.on });
    }
  });

  $('#floorplan-svg').addEventListener('dblclick', (e) => {
    if (state.editing) return;
    const fixture = e.target.closest('[data-fp-light]');
    if (fixture) openSheet(fixture.dataset.fpLight);
  });

  $('#fp-all-on').addEventListener('click', () => setAllLights(true));
  $('#fp-all-off').addEventListener('click', () => setAllLights(false));
  $('#fp-add-light').addEventListener('click', openProvisioning);

  $('#fp-glow').addEventListener('change', (e) => {
    state.fpOptions.glow = e.target.checked;
    $$('#floorplan-svg .fp-glow').forEach((el) => { el.style.display = state.fpOptions.glow ? '' : 'none'; });
    fp3d.api?.sync(); // bản 3D: ẩn/hiện nón sáng
  });

  $('#fp-links').addEventListener('change', (e) => {
    state.fpOptions.links = e.target.checked;
    $$('#floorplan-svg .fp-mesh-link').forEach((el) => { el.style.display = state.fpOptions.links ? '' : 'none'; });
    fp3d.api?.sync(); // bản 3D: ẩn/hiện đường mesh
  });

  $('#fp-labels').addEventListener('change', (e) => {
    state.fpOptions.labels = e.target.checked;
    updateFloorplan();
  });

  $('#fp-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    if (state.editing && b.dataset.mode === '3d') setEditing(false);
    setFloorplanMode(b.dataset.mode);
  });
  $('#fp3d-reset').addEventListener('click', () => fp3d.api?.resetView());
  $('#fp3d-day').addEventListener('click', (e) => {
    const day = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(day));
    e.currentTarget.textContent = day ? '🌙 Ban đêm' : '☀️ Ban ngày';
    fp3d.api?.setDaylight(day);
  });
  setFloorplanMode(readStorage(FP_MODE_KEY) === '3d' ? '3d' : '2d', { quiet: true, lazy: true });

}

// ---------------------------------------------------------------- 2b. Mô hình 3D (tải khi cần)
const FP_MODE_KEY = 'homemesh-fp-mode';
const fp3d = { api: null, loading: null, gen: 0 };  // Giữ API mô hình 3D sau khi tải ({ sync, flash, … })

function setFloorplanMode(mode, { quiet = false, lazy = false } = {}) {  // Chuyển 2D / 3D; lần đầu vào 3D thì tải module 3D
  state.fpOptions.mode = mode;
  try { localStorage.setItem(FP_MODE_KEY, mode); } catch { /* bỏ qua */ }
  $$('#fp-mode [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  const is3d = mode === '3d';
  $('#floorplan-svg').hidden = is3d;
  $('#fp3d').hidden = !is3d;
  $('#fp-hint').textContent = is3d
    ? '💡 Kéo để xoay, cuộn hoặc chụm 2 ngón để phóng to. Bấm đèn trên trần để bật/tắt, bấm đúp để chỉnh màu.'
    : '💡 Bấm vào đèn để bật/tắt, bấm tên phòng để chỉnh cả phòng.';
  if (!is3d) return;
  if (fp3d.api) { fp3d.api.resize(); fp3d.api.sync(); return; }
  if (lazy && state.view !== 'home') return; // dựng khi mở màn hình Nhà của tôi
  if (fp3d.loading) return;
  $('#fp3d-loading').hidden = false;
  const gen = fp3d.gen;
  fp3d.loading = import('./ui/floorplan3d.js')
    .then((m) => m.mountFloorplan3D({
      host: $('#fp3d'), state, lightById,
      onToggle: (id) => { const l = lightById(id); if (l) setLight(id, { on: !l.on }); },
      onOpen: openSheet
    }))
    .then((api) => {
      if (gen !== fp3d.gen) { api.destroy?.(); return; }  // sơ đồ đã đổi trong lúc dựng
      fp3d.api = api;
    })
    .catch((err) => {
      console.warn('3D không khả dụng', err);
      fp3d.loading = null;
      if (!quiet) toast('Máy này không dựng được 3D (WebGL) — quay về sơ đồ 2D');
      setFloorplanMode('2d', { quiet: true });
    })
    .finally(() => { $('#fp3d-loading').hidden = true; });
}

// ---------------------------------------------------------------- 2c. Thiết kế nhà (chế độ Sửa sơ đồ)
const layoutHistory = createHistory();  // Hoàn tác / Làm lại
let drag = null;  // thao tác kéo đang diễn ra

const snapshot = () => ({  // Ảnh chụp sơ đồ + vị trí đèn, dùng cho Hoàn tác
  layout: state.layout,
  lights: state.lights.map(({ id, room, fx, fy }) => ({ id, room, fx, fy }))
});

function invalidate3D() {  // Sơ đồ đổi → bỏ mô hình 3D cũ, dựng lại nếu đang xem 3D
  fp3d.gen += 1;
  if (!fp3d.api && !fp3d.loading) return;
  fp3d.api?.destroy?.();
  const old = $('#fp3d canvas');
  old.replaceWith(old.cloneNode(false));  // bỏ hết listener cũ
  $('#fp3d .fp3d-labels').innerHTML = '';
  fp3d.api = null;
  fp3d.loading = null;
  if (state.fpOptions.mode === '3d') setFloorplanMode('3d', { quiet: true, lazy: true });
}

// Áp sơ đồ mới: đèn ra ngoài phòng được chuyển vào phòng chứa nó (gửi lệnh đổi group), lưu, vẽ lại.
function commitLayout(next, { record = true, before = null } = {}) {
  if (record) layoutHistory.push(before ?? snapshot());
  state.layout = next;
  applyLayout(next);
  indexRooms();
  const { lights, moved } = relocateLights(state.lights, ROOMS);
  state.lights = withDerived(lights.map(({ hops, rssi, ...l }) => l));
  moved.forEach(({ id, to }) => {
    const l = lightById(id);
    const { entry } = transmit({
      bytes: encodeSubscriptionOverwrite({ elementAddress: l.unicast, groupAddress: roomById.get(to).group }),
      dst: l.unicast, targets: [l], ack: true
    });
    l.lastPacket = entry;
  });
  if (state.selectedRoom && !roomById.has(state.selectedRoom)) state.selectedRoom = null;
  rebuildAll();
  if (state.view !== 'home') buildFloorplan();
  invalidate3D();
  renderEditor();
  return moved.length;
}

function restoreSnapshot(snap) {  // Quay về một ảnh chụp (Hoàn tác / Làm lại)
  snap.lights.forEach((p) => { const l = lightById(p.id); if (l) Object.assign(l, { room: p.room, fx: p.fx, fy: p.fy }); });
  commitLayout(snap.layout, { record: false });
}

function undoLayout() {
  const snap = layoutHistory.undo(snapshot());
  if (snap) { restoreSnapshot(snap); toast('Đã hoàn tác'); }
}
function redoLayout() {
  const snap = layoutHistory.redo(snapshot());
  if (snap) { restoreSnapshot(snap); toast('Đã làm lại'); }
}

function editorLayer() {  // Lớp chỉnh sửa trên SVG: khung phòng kéo được + ô đổi cỡ
  if (!state.editing) return '';
  return ROOMS.map((r) => {
    const b = r.bounds;
    return `<g class="ed-room${r.id === state.selectedRoom ? ' is-selected' : ''}" data-ed-room="${r.id}">
      <rect class="ed-room-rect" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />
      <text class="ed-size" x="${b.x + b.w / 2}" y="${b.y + b.h - 2.2}">${sizeText(b)}</text>
      <rect class="ed-handle" data-ed-resize="${r.id}" x="${b.x + b.w - 4.5}" y="${b.y + b.h - 4.5}" width="4" height="4" rx="0.8"><title>Kéo để đổi kích thước</title></rect>
    </g>`;
  }).join('');
}

function svgPoint(e) {  // Toạ độ chuột → toạ độ sơ đồ (0–100)
  const svg = $('#floorplan-svg');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function renderRoomForm() {  // Ô sửa tên / loại / xoá của phòng đang chọn
  const r = roomById.get(state.selectedRoom);
  $('#fp-room-form').hidden = !r;
  if (!r) return;
  if (document.activeElement !== $('#fp-room-name')) $('#fp-room-name').value = r.name;
  $('#fp-room-type').value = r.type;
  $('#fp-room-size').textContent = `${sizeText(r.bounds)} · ${areaText(r.bounds)} · ${roomLights(r.id).length} đèn`;
}

function renderEditor() {  // Thanh công cụ Sửa sơ đồ
  $('#fp-editor').hidden = !state.editing;
  $('#fp-edit').hidden = state.editing;
  $('#floorplan-svg').classList.toggle('is-editing', state.editing);
  $('#fp-undo').disabled = !layoutHistory.canUndo;
  $('#fp-redo').disabled = !layoutHistory.canRedo;
  renderRoomForm();
}

function selectRoom(id) {
  state.selectedRoom = id;
  buildFloorplan();
  renderRoomForm();
}

function setEditing(on) {  // Bật / tắt chế độ Sửa sơ đồ (luôn ở bản 2D)
  state.editing = on;
  if (on && state.fpOptions.mode === '3d') setFloorplanMode('2d', { quiet: true });
  if (!on) state.selectedRoom = null;
  buildFloorplan();
  renderEditor();
  $('#fp-hint').textContent = on
    ? '✏️ Kéo phòng để di chuyển, kéo ô vuông ở góc để đổi kích thước, kéo đèn tới chỗ mới. Bấm vào phòng để đổi tên, loại hoặc xoá.'
    : '💡 Bấm vào đèn để bật/tắt, bấm tên phòng để chỉnh cả phòng.';
}

function placeLight(id, before) {  // Thả đèn: gán phòng theo vị trí, kéo vào trong phòng
  const l = lightById(id);
  const target = roomAt(ROOMS, l.fx, l.fy) ?? nearestRoom(ROOMS, l.fx, l.fy);
  const p = clampInto(target.bounds, l.fx, l.fy);
  l.fx = p.x;
  l.fy = p.y;
  layoutHistory.push(before);
  if (target.id !== l.room) {
    const { entry } = transmit({
      bytes: encodeSubscriptionOverwrite({ elementAddress: l.unicast, groupAddress: target.group }),
      dst: l.unicast, targets: [l], ack: true
    });
    l.lastPacket = entry;
    l.room = target.id;
    toast(`Đã chuyển “${l.name}” sang ${target.name}`);
  }
  rebuildAll();
  renderEditor();
}

const TEMPLATE_COLORS = { wood: '#c9a27a', tile: '#b9c4cf' };
function templatePreview(t) {  // Hình thu nhỏ của mẫu nhà
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${t.rooms.map((r) => {
    const b = r.bounds;
    return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${TEMPLATE_COLORS[ROOM_TYPES[r.type].floor]}" stroke="#3a3f47" stroke-width="1.2" />
      <text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 3}" font-size="${Math.min(9, b.w / 3, b.h / 2)}" text-anchor="middle">${ROOM_TYPES[r.type].icon}</text>`;
  }).join('')}</svg>`;
}

function openTemplates() {  // Hộp chọn mẫu nhà
  $('#template-list').innerHTML = Object.entries(TEMPLATES).map(([id, t]) => `
    <button type="button" class="template-card" data-template="${id}">
      ${templatePreview(t)}
      <b>${t.label}</b><small>${t.desc}</small>
    </button>`).join('');
  $('#template-dialog').showModal();
}

function applyTemplate(id) {
  $('#template-dialog').close();
  commitLayout(fromTemplate(id));
  state.selectedRoom = null;
  toast(`Đã dùng mẫu “${TEMPLATES[id].label}”. Bấm ✏️ Sửa sơ đồ để chỉnh theo nhà bạn.`);
  if (id === 'blank' || !state.editing) {
    setView('home');
    if (id === 'blank') setEditing(true);
  }
}

function bindEditor() {  // Gắn sự kiện chế độ Sửa sơ đồ
  const svg = $('#floorplan-svg');
  $('#fp-add-type').innerHTML = $('#fp-room-type').innerHTML = Object.entries(ROOM_TYPES)
    .map(([k, t]) => `<option value="${k}">${t.icon} ${t.label}</option>`).join('');

  svg.addEventListener('pointerdown', (e) => {
    if (!state.editing || e.button > 0) return;
    const p = svgPoint(e);
    const resize = e.target.closest('[data-ed-resize]');
    const light = e.target.closest('[data-fp-light]');
    const room = e.target.closest('[data-ed-room]');
    if (resize) drag = { kind: 'resize', id: resize.dataset.edResize };
    else if (light) drag = { kind: 'light', id: light.dataset.fpLight };
    else if (room) drag = { kind: 'room', id: room.dataset.edRoom };
    else { selectRoom(null); return; }
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    Object.assign(drag, {
      x0: p.x, y0: p.y, moved: false, base: state.layout, before: snapshot(),
      lights0: state.lights.map(({ id, room: r, fx, fy }) => ({ id, room: r, fx, fy }))
    });
    if (drag.kind !== 'light') { state.selectedRoom = drag.id; renderRoomForm(); }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = svgPoint(e);
    const dx = p.x - drag.x0;
    const dy = p.y - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 1) return;
    drag.moved = true;
    if (drag.kind === 'light') {
      const l = lightById(drag.id);
      const s0 = drag.lights0.find((x) => x.id === drag.id);
      l.fx = Math.round(Math.min(96, Math.max(4, s0.fx + dx)) * 10) / 10;
      l.fy = Math.round(Math.min(96, Math.max(4, s0.fy + dy)) * 10) / 10;
      buildFloorplan();
      return;
    }
    const r0 = drag.base.rooms.find((r) => r.id === drag.id);
    const next = drag.kind === 'room'
      ? moveRoom(drag.base, drag.id, dx, dy)
      : resizeRoom(drag.base, drag.id, r0.bounds.w + dx, r0.bounds.h + dy);
    svg.classList.toggle('ed-blocked', !next);  // chạm phòng khác / ra ngoài khung → đứng yên, viền đỏ
    if (!next) return;
    state.layout = next;
    applyLayout(next);
    indexRooms();
    if (drag.kind === 'room') {  // đèn trong phòng đi theo phòng
      const sdx = snap(dx);
      const sdy = snap(dy);
      drag.lights0.filter((x) => x.room === drag.id).forEach((x) => {
        const l = lightById(x.id);
        l.fx = x.fx + sdx;
        l.fy = x.fy + sdy;
      });
    }
    buildFloorplan();
    renderRoomForm();
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    svg.classList.remove('ed-blocked');
    if (!d.moved) { buildFloorplan(); renderRoomForm(); return; }
    if (d.kind === 'light') placeLight(d.id, d.before);
    else commitLayout(state.layout, { before: d.before });
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  $('#fp-edit').addEventListener('click', () => setEditing(true));
  $('#fp-done').addEventListener('click', () => { setEditing(false); toast('Đã lưu sơ đồ nhà'); });
  $('#fp-undo').addEventListener('click', undoLayout);
  $('#fp-redo').addEventListener('click', redoLayout);
  $('#fp-templates').addEventListener('click', openTemplates);
  $('#fp-add-room').addEventListener('click', () => {
    const res = addRoom(state.layout, $('#fp-add-type').value);
    if (!res) { toast('Không còn chỗ trống — thu nhỏ hoặc dời bớt phòng khác'); return; }
    commitLayout(res.layout);
    selectRoom(res.room.id);
    toast(`Đã thêm ${res.room.name}. Kéo để đặt đúng chỗ, kéo góc để đổi kích thước.`);
  });
  $('#fp-room-name').addEventListener('change', (e) => {
    const next = updateRoom(state.layout, state.selectedRoom, { name: e.target.value });
    if (!next) { toast('Tên phòng không được để trống'); renderRoomForm(); return; }
    commitLayout(next);
  });
  $('#fp-room-type').addEventListener('change', (e) => {
    const next = updateRoom(state.layout, state.selectedRoom, { type: e.target.value });
    if (next) commitLayout(next);
  });
  $('#fp-room-delete').addEventListener('click', async () => {
    const r = roomById.get(state.selectedRoom);
    if (!r) return;
    const n = roomLights(r.id).length;
    const ok = await confirmAsk(`Xoá ${r.name}?`,
      n ? `${n} đèn trong phòng sẽ chuyển sang phòng gần nhất. Có thể hoàn tác.` : 'Có thể hoàn tác bằng nút ↶.', 'Xoá phòng');
    if (!ok) return;
    const next = removeRoom(state.layout, r.id);
    if (!next) { toast('Nhà cần ít nhất 1 phòng'); return; }
    state.selectedRoom = null;
    commitLayout(next);
    toast(`Đã xoá ${r.name}`);
  });
  $('#template-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-template]');
    if (b) applyTemplate(b.dataset.template);
  });
  document.addEventListener('keydown', (e) => {  // Ctrl+Z / Ctrl+Y / Delete / Esc khi đang sửa
    if (!state.editing || e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undoLayout(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redoLayout(); }
    else if ((k === 'delete' || k === 'backspace') && state.selectedRoom) { e.preventDefault(); $('#fp-room-delete').click(); }
    else if (k === 'escape') setEditing(false);
  });
  renderEditor();
}

// ---------------------------------------------------------------- Kiểm tra gateway (Cài đặt → Mạng & gateway)

// Trả danh sách { ok, label, detail } để màn hình Cài đặt hiển thị.
function checkGateway() {  // Kiểm tra gateway: địa chỉ, MAC, REST API, node trong tầm, độ trễ
  const s = state.settings;
  const checks = [
    { ok: true, label: 'Địa chỉ API', detail: `${gatewayBaseUrl(s)}/api/v1` },
    { ok: MAC_RE.test(s.gatewayMac), label: 'Địa chỉ MAC gateway', detail: s.gatewayMac }
  ];
  const api = executeApiRequest({ method: 'GET', path: '/api/v1/lights', context: apiContext() });
  checks.push({
    ok: state.gatewayOnline && api.status === 200,
    label: 'REST API · GET /api/v1/lights',
    detail: state.gatewayOnline ? `${api.status} ${api.statusText} · ${api.timeMs} ms · ${api.body?.count ?? 0} đèn` : 'Gateway offline — app đang đi qua BLE GATT Proxy'
  });
  const far = state.lights.filter((l) => l.hops > s.ttl).length;
  checks.push({ ok: far === 0, label: 'Node BLE Mesh trong tầm', detail: `${state.lights.length - far}/${state.lights.length} node trong TTL ${s.ttl}` });
  if (state.lights.length) {
    const { result } = transmit({ bytes: encodeOnOffGet(), dst: ADDRESS.GROUP_ALL_LIGHTS, targets: state.lights, ack: true, animate: false });
    checks.push({
      ok: result.oneWay < target(),
      label: 'Độ trễ tới đèn xa nhất',
      detail: `${result.oneWay} ms một chiều · ${result.total} ms khứ hồi (mục tiêu < ${target()} ms)`
    });
  }
  return checks;
}

// ---------------------------------------------------------------- 3. Device Sheet

function openSheet(id) {  // Mở hộp chi tiết đèn
  state.openLightId = id;
  $('#sheet-presets').innerHTML = CCT_PRESETS.map((p) =>
    `<button type="button" class="chip" data-kelvin="${p.kelvin}" title="${p.hint}"><i style="--c:${kelvinToHex(p.kelvin)}"></i>${p.label} ${p.kelvin}K</button>`
  ).join('');
  updateSheet();
  $('#device-sheet').showModal();
}

function updateSheet() {  // Đổ giá trị đèn vào hộp chi tiết
  const light = lightById(state.openLightId);
  if (!light) return;
  const hex = kelvinToHex(light.kelvin);
  const room = roomById.get(light.room);
  const ch = cctToChannels(light.kelvin, light.lightness);
  const lamp = $('#sheet-lamp');

  paintBulb(lamp, light);
  lamp.classList.toggle('is-off', !light.on);
  $('#sheet-room').textContent = `${room.icon} ${room.name} · LED ${light.watts}W CCT`;
  $('#sheet-title').textContent = light.name;
  $('#sheet-identify').disabled = false;
  $('#sheet-on').checked = light.on;

  const lightness = $('#sheet-lightness');
  const kelvin = $('#sheet-kelvin');
  if (!isEditing(lightness)) lightness.value = light.lightness;
  if (!isEditing(kelvin)) kelvin.value = light.kelvin;
  lightness.style.background = `linear-gradient(90deg, #2a2f38, ${hex})`;
  lightness.style.setProperty('--thumb', hex);
  kelvin.style.background = cctGradient();
  kelvin.style.setProperty('--thumb', hex);

  $('#sheet-lightness-out').textContent = `${light.lightness}%`;
  $('#sheet-kelvin-out').textContent = `${light.kelvin}K · ${kelvinLabel(light.kelvin)}`;
  $$('#sheet-presets .chip').forEach((c) => c.classList.toggle('is-active', Number(c.dataset.kelvin) === light.kelvin));

  $('#sheet-warm').textContent = light.on ? `${(ch.warmDuty * 100).toFixed(1)}%` : '0%';
  $('#sheet-cool').textContent = light.on ? `${(ch.coolDuty * 100).toFixed(1)}%` : '0%';
  $('#sheet-power').textContent = `${estimatePowerW(light.watts, light.on, light.lightness)} / ${light.watts} W`;
  $('#sheet-hex').textContent = hex;
  $('#sheet-addr').textContent = `${formatAddress(light.unicast)} / ${formatAddress(room.group)}`;
  $('#sheet-hops').textContent = `${light.hops} hop${light.relay ? ' · Relay' : ''}`;

  const pkt = light.lastPacket;
  $('#sheet-packet').textContent = pkt ? `${pkt.opcode} → ${pkt.dst}\n${pkt.hex}` : '—';
  const out = $('#sheet-latency');
  out.textContent = pkt ? `${pkt.latency} ms` : '';
  out.className = pkt ? latencyClass(pkt.latency) : '';
}

function bindSheet() {  // Gắn sự kiện hộp chi tiết đèn
  const sheet = $('#device-sheet');
  sheet.addEventListener('close', () => { state.openLightId = null; });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  $('#sheet-on').addEventListener('change', (e) => setLight(state.openLightId, { on: e.target.checked }));

  for (const [sel, key] of [['#sheet-lightness', 'lightness'], ['#sheet-kelvin', 'kelvin']]) {
    const el = $(sel);
    el.addEventListener('input', () => {
      const id = state.openLightId;
      Object.assign(lightById(id), { on: true, [key]: Number(el.value) });
      updateSheet();
      updateHome();
      throttled(`light-${id}`, () => setLight(id, { on: true, [key]: Number(el.value) }, { ack: false }));
    });
    el.addEventListener('change', () => setLight(state.openLightId, { on: true, [key]: Number(el.value) }, { ack: true }));
  }

  $('#sheet-presets').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-kelvin]');
    if (chip) setLight(state.openLightId, { on: true, kelvin: Number(chip.dataset.kelvin) });
  });
}

// ---------------------------------------------------------------- 4. Scenes

function buildScenes() {  // Dựng thẻ cảnh và ô phạm vi
  $('#scene-scope').innerHTML = `<option value="all">Toàn nhà (${formatAddress(ADDRESS.GROUP_ALL_LIGHTS)})</option>` +
    ROOMS.map((r) => `<option value="${r.id}">${r.name} (${formatAddress(r.group)})</option>`).join('');

  $('#scene-grid').innerHTML = SCENES.map((s) => `
    <button type="button" class="scene" data-scene="${s.id}" style="--c:${kelvinToHex(s.kelvin)};--o:${s.off ? 0.08 : 0.2 + s.lightness / 200}">
      <span class="scene-icon" aria-hidden="true">${s.icon}</span>
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
      <span class="scene-spec">${s.off ? 'OFF' : `${s.kelvin}K · ${s.lightness}%`} · Scene #${s.id}</span>
    </button>`).join('');

  $('#scene-grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-scene]');
    if (card) recallScene(Number(card.dataset.scene), $('#scene-scope').value);
  });
}

function updateScenes() {  // Tô cảnh đang áp dụng
  $$('#scene-grid .scene').forEach((el) => el.classList.toggle('is-applied', Number(el.dataset.scene) === state.appliedScene));
}

// ---------------------------------------------------------------- 5. Mesh & Jitter Simulation

function positionOf(id) {  // Toạ độ node trên sơ đồ topology
  if (id === 'gateway') return GATEWAY_POS;
  const l = lightById(id);
  return l ? { x: l.x, y: l.y } : GATEWAY_POS;
}

function buildTopology() {  // Vẽ sơ đồ mạng mesh SVG
  const svg = $('#topology');
  const links = state.lights.map((l) => {
    const a = positionOf(l.via);
    return `<line class="link" data-link="${l.id}" x1="${a.x}" y1="${a.y}" x2="${l.x}" y2="${l.y}" />`;
  }).join('');
  const nodes = state.lights.map((l) => `
    <g class="node${l.relay ? ' relay' : ''}" data-node="${l.id}">
      <title>${l.name} · ${formatAddress(l.unicast)} · ${l.hops} hop</title>
      <circle class="node-ring" cx="${l.x}" cy="${l.y}" r="4.3" />
      <circle class="node-core" cx="${l.x}" cy="${l.y}" r="2.8" />
      <text class="node-label" x="${l.x}" y="${l.y + 7.2}">${l.id} · ${formatAddress(l.unicast).slice(2)}</text>
    </g>`).join('');
  svg.innerHTML = `${links}
    <g class="gw${state.gatewayOnline ? '' : ' offline'}">
      <circle class="pulse" cx="${GATEWAY_POS.x}" cy="${GATEWAY_POS.y}" r="4" />
      <circle class="gw-core" cx="${GATEWAY_POS.x}" cy="${GATEWAY_POS.y}" r="4.2" />
      <text class="node-label" x="${GATEWAY_POS.x}" y="${GATEWAY_POS.y + 1}" style="fill:#0e1116;font-weight:700">GW</text>
    </g>${nodes}`;
  updateTopology();
}

function updateTopology() {  // Cập nhật màu node
  state.lights.forEach((l) => {
    const core = $(`#topology [data-node="${l.id}"] .node-core`);
    if (core) core.setAttribute('fill', l.on ? kelvinToHex(l.kelvin) : '#3a4250');
  });
}

function flashTopology(targets, path) {  // Hiệu ứng gói chạy trên topology
  const svg = $('#topology');
  if (!svg) return;
  const pulse = $('.pulse', svg);
  if (pulse && path !== 'proxy') {
    pulse.classList.remove('go');
    void pulse.getBBox();
    pulse.classList.add('go');
  }
  const seen = new Set();
  targets.forEach((light) => {
    const chain = [];
    for (let cur = light; cur; cur = cur.via === 'gateway' ? null : lightById(cur.via)) chain.unshift(cur);
    chain.forEach((node, depth) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      setTimeout(() => {
        const link = $(`[data-link="${node.id}"]`, svg);
        const g = $(`[data-node="${node.id}"]`, svg);
        link?.classList.add('flash');
        g?.classList.add('flash');
        setTimeout(() => { link?.classList.remove('flash'); g?.classList.remove('flash'); }, 260);
      }, depth * 110);
    });
  });
}

function renderMeshStats() {  // Ô thống kê độ trễ / jitter
  const s = latencyStats(state.samples, target());
  const r = latencyStats(state.rttSamples, Infinity);
  const last = state.lastResult;
  const cell = (label, value, cls = '') => `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`;
  const okCls = (v) => (s.count ? (v < target() ? 'ok' : 'bad') : '');
  const jitterCls = (j) => (s.count ? (j < 5 ? 'jitter-ok' : j < 15 ? 'jitter-warn' : 'jitter-bad') : '');

  $('#target-tag').textContent = `Mục tiêu một chiều < ${target()} ms`;
  $('#latency-stats').innerHTML = [
    cell('Gần nhất (1 chiều)', last ? `${last.oneWay} ms` : '—', last ? okCls(last.oneWay) : ''),
    cell('Trung bình', s.count ? `${s.avg} ms` : '—', okCls(s.avg)),
    cell('P95', s.count ? `${s.p95} ms` : '—', okCls(s.p95)),
    cell('Max', s.count ? `${s.max} ms` : '—', okCls(s.max)),
    cell('Jitter TB (IPDV)', s.count ? `${s.jitterAvg} ms` : '—', jitterCls(s.jitterAvg)),
    cell(`Đạt < ${target()} ms`, s.count ? `${s.withinTarget}%` : '—', s.count ? (s.withinTarget >= 95 ? 'ok' : 'bad') : ''),
    cell('Khứ hồi Ack TB', r.count ? `${r.avg} ms` : '—'),
    cell('Khứ hồi Ack P95', r.count ? `${r.p95} ms` : '—'),
    cell('Tổng số lệnh', s.count)
  ].join('');

  renderSparkline();
  renderBreakdown();
}

function renderSparkline() {  // Biểu đồ nhỏ độ trễ
  const svg = $('#sparkline');
  const data = state.samples.slice(-80);
  const W = 300;
  const H = 90;
  const maxY = Math.max(target() * 1.6, ...data) * 1.1;
  const y = (v) => H - (v / maxY) * H;
  const thr = y(target());
  if (data.length < 2) {
    svg.innerHTML = `<line class="threshold" x1="0" x2="${W}" y1="${thr}" y2="${thr}" /><text x="4" y="${thr - 4}">${target()} ms</text>`;
    return;
  }
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  svg.innerHTML = `
    <polygon class="area" points="0,${H} ${pts.join(' ')} ${W},${H}" />
    <polyline class="line" points="${pts.join(' ')}" />
    <line class="threshold" x1="0" x2="${W}" y1="${thr}" y2="${thr}" />
    <text x="4" y="${thr - 4}">${target()} ms</text>`;
}

function renderBreakdown() {  // Phân rã từng chặng của lệnh gần nhất
  const last = state.lastResult;
  const box = $('#breakdown');
  if (!last?.slowest) {
    box.innerHTML = '<p class="muted small">Gửi 1 lệnh để xem độ trễ từng chặng và thời gian phản hồi Status (Ack).</p>';
    $('#breakdown-target').textContent = '';
    return;
  }
  const slow = last.slowest;
  const light = lightById(slow.node.id);
  const ackTag = slow.isAck ? ' · Đo Round-Trip Ack' : ' · Unack';
  $('#breakdown-target').textContent = `Đèn: ${light?.name ?? slow.node.id} (${slow.node.hops} hop, ${PATHS[last.entry.path].label}${ackTag})`;
  box.innerHTML = slow.breakdown.map((p) => `
    <div class="bd-row">
      <div><span class="bd-label">${p.label}</span><div class="bd-bar" style="width:${Math.max(2, (p.ms / slow.total) * 100)}%"></div></div>
      <b>${p.ms.toFixed(1)} ms</b>
    </div>`).join('') +
    `<div class="bd-row bd-total"><span>Một chiều (lệnh → đèn)</span><b class="${latencyClass(slow.oneWay)}">${slow.oneWay} ms</b></div>` +
    (slow.isAck ? `<div class="bd-row bd-total"><span>Khứ hồi (Status về app)</span><b>${slow.total} ms</b></div>` : '');
}

function renderNodeTable() {  // Bảng node mesh
  $('#node-count').textContent = `${state.lights.length} node · TTL ${state.settings.ttl} · tối đa ${state.settings.ttl} hop`;
  $('#node-table tbody').innerHTML = state.lights.map((l) => {
    const room = roomById.get(l.room);
    const status = l.ping != null
      ? `<span class="${latencyClass(l.ping)}">Online · ${l.ping} ms</span>`
      : '<span class="lat-ok">Online</span>';
    return `<tr>
      <td>${escapeHtml(l.name)}</td>
      <td class="mono">${formatAddress(l.unicast)}</td>
      <td class="mono">${formatAddress(room.group)}</td>
      <td>${l.hops}</td>
      <td>${l.relay ? '✓' : '—'}</td>
      <td class="mono">${l.rssi} dBm</td>
      <td class="mono">${estimatePowerW(l.watts, l.on, l.lightness)} / ${l.watts} W</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
}

function pingAll() {  // Ping mọi node
  const path = effectivePath();
  state.lights.forEach((l) => {
    const { result } = transmit({ bytes: encodeOnOffGet(), dst: l.unicast, targets: [l], record: false, animate: false, ack: true });
    l.ping = result.total;
  });
  flashTopology(state.lights, path);
  renderNodeTable();
  const pings = state.lights.map((l) => l.ping);
  toast(`Ping ${pings.length} node · max ${Math.max(...pings).toFixed(1)} ms`);
}

// Kịch bản mô phỏng 1: Quét tuần tự bật/tắt toàn nhà
async function simulateSweep(btn) {
  btn.disabled = true;
  toast('Đang chạy kịch bản: Quét tuần tự từng đèn trong nhà...');
  for (const light of state.lights) {
    setLight(light.id, { on: !light.on }, { ack: true, send: true });
    await new Promise((r) => setTimeout(r, 90));
  }
  const s = latencyStats(state.samples, target());
  toast(`Hoàn tất quét tuần tự ${state.lights.length} đèn · Jitter TB: ${s.jitterAvg} ms · Trễ TB: ${s.avg} ms`);
  btn.disabled = false;
}

// Kịch bản mô phỏng 2: Chuyển nhiệt độ màu nhịp sinh học
async function simulateCircadian(btn) {
  btn.disabled = true;
  toast('Đang chạy mô phỏng nhịp sinh học CCT (2700K ➔ 6500K)...');
  const kelvins = [2700, 3200, 3800, 4500, 5200, 6000, 6500, 5000, 3500, 2700];
  for (const k of kelvins) {
    state.lights.forEach((l) => { l.on = true; l.kelvin = k; });
    transmit({
      bytes: encodeLightCtlSet({ lightness: percentToLightnessActual(85), temperature: k, tid: nextTid(), ack: true }),
      dst: ADDRESS.GROUP_ALL_LIGHTS,
      targets: state.lights,
      ack: true
    });
    refresh();
    await new Promise((r) => setTimeout(r, 120));
  }
  const s = latencyStats(state.samples, target());
  toast(`Mô phỏng nhịp sinh học thành công · Jitter TB: ${s.jitterAvg} ms · Jitter Max: ${s.jitterMax} ms`);
  btn.disabled = false;
}

// Kịch bản mô phỏng 3: Thử tải 100 lệnh đo Jitter & độ trễ
async function stressTest(button) {
  button.disabled = true;
  const before = state.samples.length;
  for (let i = 0; i < 100; i += 1) {
    const useGroup = Math.random() < 0.4;
    const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    const targets = useGroup ? roomLights(room.id) : [state.lights[Math.floor(Math.random() * state.lights.length)]];
    if (targets.length === 0) continue;
    const isAck = Math.random() < 0.3;
    const bytes = encodeLightCtlSet({
      lightness: percentToLightnessActual(20 + Math.random() * 80),
      temperature: clampKelvin(LED_SPEC.minK + Math.random() * (LED_SPEC.maxK - LED_SPEC.minK)),
      tid: nextTid(),
      ack: isAck
    });
    transmit({ bytes, dst: useGroup ? room.group : targets[0].unicast, targets, animate: i % 10 === 0, ack: isAck });
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 30));
  }
  const s = latencyStats(state.samples.slice(before), target());
  toast(`100 lệnh · một chiều TB ${s.avg} ms · P95 ${s.p95} ms · ${s.withinTarget}% < ${target()} ms`);
  button.disabled = false;
}

function clearMetrics() {  // Xoá số đo và nhật ký
  state.samples = [];
  state.rttSamples = [];
  state.lastResult = null;
  state.log = [];
  renderLatencyPill();
  updateHome();
  if (state.view === 'mesh') renderMeshStats();
  if (state.view === 'log') renderLog();
}

function bindMesh() {  // Gắn sự kiện màn hình Mesh
  $('#btn-ping').addEventListener('click', pingAll);
  $('#btn-sim-sweep').addEventListener('click', (e) => simulateSweep(e.currentTarget));
  $('#btn-sim-circadian').addEventListener('click', (e) => simulateCircadian(e.currentTarget));
  $('#btn-stress').addEventListener('click', (e) => stressTest(e.currentTarget));
  $('#btn-reset-stats').addEventListener('click', () => {
    clearMetrics();
    toast('Đã xoá toàn bộ số liệu thống kê độ trễ và Jitter.');
  });
  $('#gateway-online').addEventListener('change', (e) => {
    state.gatewayOnline = e.target.checked;
    renderGateway();
    save();
    updateHome();
    toast(state.gatewayOnline ? 'Gateway online — điều khiển qua LAN' : 'Gateway offline — app vẫn điều khiển được qua BLE GATT Proxy');
  });
  $('#btn-provision').addEventListener('click', openProvisioning);
}

// ---------------------------------------------------------------- 6. REST API (dùng cho kiểm tra gateway và window.HomeMeshAPI)

function apiContext() {  // Các hàm điều khiển cho js/api.js gọi
  return {
    state, lightById, roomLights, setLight, setRoom, recallScene, latencyStats,
    SCENES, NEW_DEVICE_CANDIDATES, quickProvision, removeLight, identifyLight
  };
}

// ---------------------------------------------------------------- 7. Provisioning Flow

function quickProvision(target, roomId, name) {  // Tạo đèn mới sau 7 bước provisioning
  const room = roomById.get(roomId) || ROOMS[0];
  const unicast = Math.max(1, ...state.lights.map((l) => l.unicast)) + 1;
  const parent = roomLights(room.id).find((l) => l.relay) ?? state.lights.find((l) => l.relay && l.hops === 1);
  const bounds = room.bounds;
  const { x: fx, y: fy } = clampInto(bounds, bounds.x + bounds.w / 2 + (Math.random() - 0.5) * (bounds.w - 8), bounds.y + bounds.h / 2 + (Math.random() - 0.5) * (bounds.h - 8), 4);

  const newLight = {
    id: nextLightId(),
    uuid: target.uuid,
    name: (name && String(name).trim().slice(0, 40)) || target.model.replace(' CCT', ''),
    fw: target.fw ?? DEFAULT_FIRMWARE,
    room: room.id,
    unicast,
    watts: target.watts,
    via: parent?.id ?? 'gateway',
    relay: false,
    x: fx,
    y: fy,
    fx,
    fy,
    ...DEFAULT_LIGHT_STATE
  };

  state.lights = withDerived([...state.lights.map(({ hops, rssi, ...rest }) => rest), newLight]);
  views.devices?.forget(target.uuid);
  rebuildAll();
  return lightById(newLight.id);
}

// Mở hộp thoại thêm đèn; `device` = thiết bị đã chọn từ màn hình Quét (bỏ qua bước chọn).
function openProvisioning(device = null) {
  const taken = new Set(state.lights.map((l) => l.uuid).filter(Boolean));
  const list = NEW_DEVICE_CANDIDATES.filter((c) => !taken.has(c.uuid));
  $('#prov-title').textContent = 'Thêm đèn mới';
  $('#prov-scan').hidden = false;
  $('#prov-run').hidden = true;
  $('#prov-candidates').innerHTML = list.length
    ? list.map((c) => `<li><button type="button" class="candidate" data-uuid="${c.uuid}">
        <span>${c.model}<small>UUID ${c.uuid}</small></span><small>${c.rssi} dBm</small></button></li>`).join('')
    : '<li class="muted">Tất cả thiết bị trong danh mục đã được gia nhập vào mạng.</li>';
  $('#prov-room').innerHTML = ROOMS.map((r) => `<option value="${r.id}">${r.icon} ${r.name}</option>`).join('');
  $('#prov-steps').innerHTML = PROVISIONING_STEPS.map((s) => `<li data-step="${s.id}"><span><b>${s.title}</b><small>${s.detail}</small></span></li>`).join('');
  $('#prov-start').disabled = false;
  $('#provision-dialog').showModal();
  if (device) chooseProvisionTarget(device);
}

function chooseProvisionTarget(device) {  // Chọn thiết bị, sang bước đặt tên / phòng
  state.provisionTarget = device;
  $('#prov-title').textContent = device.model;
  $('#prov-meta').textContent = `UUID ${device.uuid} · ${device.rssi} dBm · firmware ${device.fw ?? DEFAULT_FIRMWARE} · ${device.oob ?? 'Static OOB'}`;
  $('#prov-name').value = device.model.replace(' CCT', '');
  $('#prov-scan').hidden = true;
  $('#prov-run').hidden = false;
  $('#prov-name').focus();
}

function bindProvisioning() {  // Chạy 7 bước provisioning
  const dialog = $('#provision-dialog');
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  $('#prov-candidates').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-uuid]');
    if (!btn) return;
    chooseProvisionTarget(NEW_DEVICE_CANDIDATES.find((c) => c.uuid === btn.dataset.uuid));
  });

  $('#prov-start').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const roomId = $('#prov-room').value;
    const room = roomById.get(roomId);

    for (const li of $$('#prov-steps li')) {
      li.classList.add('is-running');
      if (li.dataset.step === 'pubsub') $('small', li).textContent = `Subscribe group ${formatAddress(room.group)} (${room.name})`;
      if (li.dataset.step === 'data') $('small', li).textContent = `Cấp Unicast mới · NetKey index 0 · IV Index 0`;
      await new Promise((r) => setTimeout(r, 380));
      li.classList.replace('is-running', 'is-done');
    }

    const light = quickProvision(state.provisionTarget, roomId, $('#prov-name').value);
    dialog.close();
    toast(`Đã thêm “${light.name}” vào ${room.name} · ${formatAddress(light.unicast)}`);
  });
}

// ---------------------------------------------------------------- 8. Log

function renderLog() {  // Bảng nhật ký gói tin
  const fmt = (d) => d.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  $('#log-empty').hidden = state.log.length > 0;
  $('#log-table tbody').innerHTML = state.log.map((e) => `<tr>
    <td>${fmt(e.time)}</td>
    <td>${PATHS[e.path].short}</td>
    <td>${e.src} → ${e.dst}${e.targets > 1 ? ` (${e.targets})` : ''}</td>
    <td>${e.opcode}${e.isAck ? ' (Ack)' : ''}</td>
    <td>${e.hex}</td>
    <td>${e.segments}</td>
    <td>${e.ttl}</td>
    <td class="${latencyClass(e.latency)}">${e.latency} ms${e.rtt != null ? ` <span class="muted">/ ${e.rtt}</span>` : ''}</td>
  </tr>`).join('');
}

function bindLog() {  // Nút xuất JSON / xoá nhật ký
  $('#btn-clear-log').addEventListener('click', () => { state.log = []; renderLog(); });
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `homemesh-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------------------------------------------------------------- 9. Init

// ---------------------------------------------------------------- Tiện ích chung cho các màn hình

function copyText(text, message) {  // Chép vào clipboard
  const done = () => toast(message);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Không sao chép được — hãy chọn và copy thủ công'));
  else toast('Trình duyệt không cho sao chép tự động');
}

// Hộp thoại xác nhận, trả về Promise<boolean>.
function confirmAsk(title, message, okLabel = 'Xác nhận') {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      $('#confirm-ok').onclick = null;
      $('#confirm-cancel').onclick = null;
      resolve(value);
    };
    $('#confirm-ok').onclick = () => finish(true);
    $('#confirm-cancel').onclick = () => finish(false);
    dialog.onclose = () => resolve(false);
  });
}

function downloadJson(data, filename) {  // Tải object thành file .json
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function replaceLayout(layout) {  // Thay sơ đồ (khôi phục từ file)
  layoutHistory.clear();
  commitLayout(normalizeLayout(layout), { record: false });
}

function replaceLights(lights) {  // Thay toàn bộ đèn (khôi phục từ file)
  state.lights = withDerived(relocateLights(lights.map(({ hops, rssi, ...l }) => l), ROOMS).lights);
  rebuildAll();
}

function resetAll() {  // Xoá hết về mặc định
  try {
    [STORAGE_KEY, SETTINGS_KEY, THEME_KEY, LAYOUT_KEY].forEach((k) => localStorage.removeItem(k));
  } catch { /* bỏ qua */ }
  layoutHistory.clear();
  state.layout = fromTemplate('demo');
  applyLayout(state.layout);
  indexRooms();
  invalidate3D();
  state.settings = sanitizeSettings(null);
  state.path = state.settings.defaultPath;
  state.gatewayOnline = true;
  clearMetrics();
  replaceLights(DEFAULT_LIGHTS.map((l) => ({ ...l, ...DEFAULT_LIGHT_STATE })));
  applyTheme();
  renderPathControl();
  renderGateway();
}

function context() {  // Gói các hàm / dữ liệu app.js cho module js/ui/ dùng (tránh import vòng)
  return {
    state, $, $$, toast, escapeHtml, target, transmit, nextTid,
    lightById, roomLights, roomById, setLight, setRoom, recallScene, checkGateway,
    identifyLight, paintIdentify, renameLight, moveLight, removeLight, openProvisioning,
    refresh, rebuildAll, replaceLights, replaceLayout, openTemplates, resetAll, clearMetrics, updateSettings,
    confirmAsk, copyText, downloadJson, latencyClass, effectivePath, showWelcome, setView
  };
}

function showWelcome() {  // Mở hộp hướng dẫn
  $('#welcome-dialog').showModal();
}

function bindShell() {  // Điều hướng, nút theme, nút ← Cài đặt, hộp hướng dẫn
  $$('.nav-item[data-view], .more-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#back-settings').addEventListener('click', () => setView('settings'));
  $('#theme-toggle').addEventListener('click', toggleTheme);
  darkQuery?.addEventListener?.('change', () => { if (state.settings.theme === 'system') applyTheme(); });

  $('#welcome-ok').addEventListener('click', () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* bỏ qua */ }
    $('#welcome-dialog').close();
    openTemplates();  // bước tiếp: chọn sơ đồ nhà
  });

  $('#sheet-identify').addEventListener('click', () => {
    if (state.openLightId) identifyLight(state.openLightId);
  });
}

function init() {  // Chạy một lần khi trang mở
  load();
  applyTheme();
  registerGlobalApi(apiContext());
  bindShell();

  $('#path-control').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-path]');
    if (!btn) return;
    state.path = btn.dataset.path;
    renderPathControl();
    save();
    toast(`Đường truyền: ${PATHS[state.path].label}`);
  });

  bindHome();
  bindFloorplan();
  bindEditor();
  bindSheet();
  bindMesh();
  bindProvisioning();
  bindLog();

  const ctx = context();
  views.devices = mountDevices(ctx);
  views.settings = mountSettings(ctx);
  mountAccount(ctx);  // Avatar + thẻ Tài khoản (đăng xuất, đổi mật khẩu)

  buildHome();
  buildScenes();
  renderPathControl();
  renderLatencyPill();
  renderGateway();

  const params = new URLSearchParams(location.search);
  setView(params.get('view') || 'home');
  if (!readStorage(WELCOME_KEY) && !params.has('nowelcome')) showWelcome();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* chạy được cả khi không có SW */ });
  }
}

init();
