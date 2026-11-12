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
  GATEWAY_FLOORPLAN_POS, FLOORS, FURNITURE, ROOM_PRESETS
} from './data.js';
import { FLOOR_PATTERNS, furnitureSvg } from './ui/furniture2d.js';
import {
  API_CATALOG, apiCallHistory, buildCurl, executeApiRequest, registerGlobalApi
} from './api.js';
import { MAC_RE, SETTINGS_KEY, gatewayBaseUrl, resolveTheme, sanitizeSettings } from './settings.js';
import { mountDevices } from './ui/devices.js';
import { mountTestbench } from './ui/testbench.js';
import { mountSettings } from './ui/settings.js';

const STORAGE_KEY = 'homemesh-mvp-v1';
const THEME_KEY = 'homemesh_theme';
const WELCOME_KEY = 'homemesh-welcome-seen';
const GATEWAY_POS = { x: 50, y: 46 };
const VIEW_TITLES = {
  home: ['Nhà của tôi', 'Chiếu sáng'],
  devices: ['Quét & quản lý', 'Thiết bị'],
  scenes: ['Ngữ cảnh ánh sáng', 'Cảnh'],
  test: ['Gửi lệnh & đo độ trễ', 'Điều khiển thử'],
  mesh: ['Gateway + BLE Mesh', 'Mạng Mesh & Jitter'],
  api: ['REST & WebSocket Gateway', 'API Console'],
  log: ['Access message', 'Nhật ký gói tin'],
  settings: ['Tuỳ chỉnh ứng dụng', 'Cài đặt']
};
const views = {};
// Màn hình đo & gỡ lỗi: mở từ Cài đặt → Kỹ thuật viên, không có trên thanh điều hướng.
const TECH_VIEWS = new Set(['test', 'mesh', 'api', 'log']);
const openRooms = new Set(); // phòng đang mở danh sách đèn

const nextTid = createTidCounter();
const roomById = new Map(ROOMS.map((r) => [r.id, r]));

const state = {
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
  activeApiIndex: 0,
  fpOptions: { glow: true, links: false, labels: true, mode: '2d' }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const target = () => state.settings.targetLatencyMs;
const readStorage = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- Persistence

function load() {
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
  const lights = saved?.lights?.length ? saved.lights : DEFAULT_LIGHTS.map((l) => ({ ...l, ...DEFAULT_LIGHT_STATE }));
  state.lights = withDerived(lights);
  state.path = saved?.path in PATHS ? saved.path : state.settings.defaultPath;
  state.gatewayOnline = saved?.gatewayOnline ?? true;
}

function save() {
  try {
    const lights = state.lights.map(({ hops, rssi, ping, lastPacket, identifyUntil, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lights, path: state.path, gatewayOnline: state.gatewayOnline }));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    /* localStorage có thể bị chặn — demo vẫn chạy bình thường */
  }
}

function withDerived(lights) {
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

function applyTheme() {
  const theme = resolveTheme(state.settings.theme, darkQuery?.matches ?? true);
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  $('#theme-icon').textContent = isDark ? '🌙' : '☀️';
  $('#theme-text').textContent = isDark ? 'Tối' : 'Sáng';
  $('meta[name="theme-color"]').setAttribute('content', isDark ? '#0E1116' : '#F8FAFC');
  document.documentElement.classList.toggle('no-motion', !state.settings.animations);
}

function toggleTheme() {
  updateSettings({ theme: state.theme === 'dark' ? 'light' : 'dark' });
  toast(`Đã chuyển sang giao diện ${state.theme === 'dark' ? 'Tối' : 'Sáng'}`);
}

// Gộp thay đổi cài đặt, kiểm tra hợp lệ, lưu và áp dụng ngay.
function updateSettings(patch) {
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  save();
  applyTheme();
  renderGateway();
  if (state.view === 'api') selectApiEndpoint(state.activeApiIndex);
  views.settings?.render();
  return state.settings;
}

// ---------------------------------------------------------------- Mesh transport (mô phỏng)

let warnedFallback = false;

function effectivePath() {
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
function transmit({ bytes, dst, targets, record = true, animate = true, ack = false }) {
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

const throttleMap = new Map();
function throttled(key, fn) {
  const now = performance.now();
  if (now - (throttleMap.get(key) ?? 0) < state.settings.throttleMs) return;
  throttleMap.set(key, now);
  fn();
}

function ctlBytes(light, ack) {
  return encodeLightCtlSet({
    lightness: percentToLightnessActual(light.lightness),
    temperature: light.kelvin,
    tid: nextTid(),
    ack
  });
}

// ---------------------------------------------------------------- Actions

function lightById(id) {
  return state.lights.find((l) => l.id === id);
}

function roomLights(roomId) {
  return state.lights.filter((l) => l.room === roomId);
}

function setLight(id, patch, { ack = true, send = true } = {}) {
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

function setRoom(roomId, patch, { ack = true } = {}) {
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

function setAllLights(on) {
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

function recallScene(sceneId, scope) {
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

function paintIdentify() {
  const now = Date.now();
  state.lights.forEach((l) => {
    const on = (l.identifyUntil ?? 0) > now;
    $$(`[data-light="${l.id}"], [data-fp-light="${l.id}"], [data-device-row="${l.id}"]`).forEach((el) => el.classList.toggle('identify', on));
  });
}

function renameLight(id, name) {
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
  light.fx = Math.round(b.x + 8 + Math.random() * (b.w - 16));
  light.fy = Math.round(b.y + 10 + Math.random() * (b.h - 18));
  rebuildAll();
  return true;
}

// Xoá khỏi mạng: Config Node Reset. Đèn con đang relay qua nó được nối lên node cha.
function removeLight(id) {
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

function rebuildAll() {
  save();
  buildHome();
  if (state.view === 'home') buildFloorplan();
  if (state.view === 'mesh') { buildTopology(); renderNodeTable(); }
  views.devices?.render();
  views.testbench?.renderTargets();
  paintIdentify();
}

function nextLightId() {
  const nums = state.lights.map((l) => Number(String(l.id).replace(/\D/g, ''))).filter(Number.isFinite);
  return `L${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

// ---------------------------------------------------------------- Rendering helpers

function glow(light) {
  return light.on ? (0.15 + (light.lightness / 100) * 0.85).toFixed(2) : 0;
}

function paintBulb(el, light) {
  el.style.setProperty('--c', kelvinToHex(light.kelvin));
  el.style.setProperty('--g', glow(light));
}

function latencyClass(ms) {
  return ms < target() ? 'lat-ok' : 'lat-bad';
}

function average(values) {
  return values.reduce((s, v) => s + v, 0) / (values.length || 1);
}

function isEditing(el) {
  return document.activeElement === el && el.matches('input[type="range"]');
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function refresh() {
  save();
  updateHome();
  if (state.openLightId) updateSheet();
  if (state.view === 'home') updateFloorplan();
  if (state.view === 'scenes') updateScenes();
  if (state.view === 'mesh') { updateTopology(); renderNodeTable(); }
  if (state.view === 'devices') views.devices?.render();
}

// ---------------------------------------------------------------- Top bar & navigation

function setView(view) {
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
  if (view === 'api') buildApiConsole();
  if (view === 'log') renderLog();
  if (view === 'devices') views.devices?.render();
  if (view === 'test') views.testbench?.render();
  if (view === 'settings') views.settings?.render();
  paintIdentify();
  window.scrollTo({ top: 0 });
}

function renderPathControl() {
  $$('#path-control button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.path === state.path)));
}

function renderLatencyPill() {
  const pill = $('#latency-pill');
  const last = state.lastResult;
  pill.classList.toggle('is-idle', !last);
  pill.classList.toggle('is-late', !!last && last.oneWay >= target());
  $('#latency-pill-text').textContent = last ? `${last.oneWay.toFixed(1)} ms · ${PATHS[last.entry.path].short}` : '— ms';
  pill.title = `Độ trễ một chiều của lệnh gần nhất (mục tiêu < ${target()} ms)`;
}

function renderGateway() {
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
  return (ROOM_PRESETS[roomId] || []).find((p) => lights.every((l) => l.kelvin === p.kelvin && l.lightness === p.lightness))?.id ?? null;
}

function applyRoomPreset(roomId, presetId) {
  const preset = (ROOM_PRESETS[roomId] || []).find((p) => p.id === presetId);
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

function buildHome() {
  $('#rooms').innerHTML = ROOMS.map((room) => {
    const lights = roomLights(room.id);
    const presets = ROOM_PRESETS[room.id] || [];
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
      </details>` : '<p class="muted small">Phòng chưa có đèn. Vào <b>Thiết bị</b> để quét và thêm đèn.</p>';
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

function updateHome() {
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

function bindHome() {
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

function buildFloorplan() {
  const svg = $('#floorplan-svg');

  // 1. Defs Radial Gradients cho quầng sáng CCT từng đèn
  const defs = state.lights.map((l) => `
    <radialGradient id="fp-glow-${l.id}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="${(l.on ? 0.38 * (l.lightness / 100) : 0).toFixed(2)}" />
      <stop offset="55%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="${(l.on ? 0.16 * (l.lightness / 100) : 0).toFixed(2)}" />
      <stop offset="100%" stop-color="${kelvinToHex(l.kelvin)}" stop-opacity="0" />
    </radialGradient>`).join('');

  // 2. Phòng & Tường ngăn kiến trúc
  const roomZones = ROOMS.map((r) => {
    const b = r.bounds;
    return `
      <g class="room-zone" data-fp-room="${r.id}">
        <rect class="room-tag-bg" x="${b.x + 2}" y="${b.y + 2}" width="28" height="7.2" />
        <text class="room-tag-text" x="${b.x + 16}" y="${b.y + 5.2}">${r.icon} ${r.name}</text>
        <text class="room-tag-area" x="${b.x + 16}" y="${b.y + 8.2}">${r.area} m² · ${roomLights(r.id).length} đèn</text>
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
    <defs>${FLOOR_PATTERNS}${defs}</defs>
    <!-- Nền, sàn từng phòng, nội thất -->
    <rect class="fp-bg" x="0" y="0" width="100" height="100" rx="3" />
    ${ROOMS.map((r) => { const z = roomZone(r); return `<rect class="fp-floor" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="url(#fp-${FLOORS[r.id] ?? 'wood'})" />`; }).join('')}
    <g class="fp-furniture">${furnitureSvg(FURNITURE)}</g>
    <!-- Phòng tối dần khi tắt đèn -->
    ${ROOMS.map((r) => { const z = roomZone(r); return `<rect class="fp-shade" data-shade="${r.id}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" />`; }).join('')}
    <rect class="fp-outer-wall" x="4" y="4" width="92" height="92" rx="2" />
    
    <!-- Tường ngăn phòng & Lối đi -->
    <line class="fp-inner-wall" x1="48" y1="4" x2="48" y2="44" />
    <line class="fp-inner-wall" x1="48" y1="56" x2="48" y2="96" />
    <line class="fp-inner-wall" x1="4" y1="50" x2="44" y2="50" />
    <line class="fp-inner-wall" x1="56" y1="50" x2="96" y2="50" />
    
    <!-- Cửa mở phòng -->
    <line class="fp-door" x1="44" y1="50" x2="48" y2="46" />
    <line class="fp-door" x1="56" y1="50" x2="52" y2="46" />
    <line class="fp-door" x1="48" y1="56" x2="52" y2="60" />

    ${roomZones}
    ${glows}
    ${links}
    ${gw}
    ${fixtures}
  `;

  updateFloorplan();
}

// Vùng sàn của phòng, kéo tới giữa tường ngăn.
function roomZone(room) {
  const x = room.bounds.x < 48 ? 4 : 48;
  const y = room.bounds.y < 50 ? 4 : 50;
  return { x, y, w: (x === 4 ? 48 : 96) - x, h: (y === 4 ? 50 : 96) - y };
}

// Độ sáng cảm nhận trung bình của phòng (0–1), dùng để làm tối phòng trên bản 2D.
function roomBrightness(roomId) {
  const lights = roomLights(roomId);
  if (!lights.length) return 0;
  return Math.min(1, (lights.reduce((s, l) => s + (l.on ? l.lightness / 100 : 0), 0) / lights.length) * 1.4);
}

function updateFloorplan() {
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

function flashFloorplan(targets) {
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

function bindFloorplan() {
  $('#floorplan-svg').addEventListener('click', (e) => {
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
    if (b) setFloorplanMode(b.dataset.mode);
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
const fp3d = { api: null, loading: null };

function setFloorplanMode(mode, { quiet = false, lazy = false } = {}) {
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
  fp3d.loading = import('./ui/floorplan3d.js')
    .then((m) => m.mountFloorplan3D({
      host: $('#fp3d'), state, lightById,
      onToggle: (id) => { const l = lightById(id); if (l) setLight(id, { on: !l.on }); },
      onOpen: openSheet
    }))
    .then((api) => { fp3d.api = api; })
    .catch((err) => {
      console.warn('3D không khả dụng', err);
      fp3d.loading = null;
      if (!quiet) toast('Máy này không dựng được 3D (WebGL) — quay về sơ đồ 2D');
      setFloorplanMode('2d', { quiet: true });
    })
    .finally(() => { $('#fp3d-loading').hidden = true; });
}

// ---------------------------------------------------------------- Kiểm tra gateway (Kỹ thuật viên)

// Trả danh sách { ok, label, detail } để màn hình Cài đặt hiển thị.
function checkGateway() {
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

function openSheet(id) {
  state.openLightId = id;
  $('#sheet-presets').innerHTML = CCT_PRESETS.map((p) =>
    `<button type="button" class="chip" data-kelvin="${p.kelvin}" title="${p.hint}"><i style="--c:${kelvinToHex(p.kelvin)}"></i>${p.label} ${p.kelvin}K</button>`
  ).join('');
  updateSheet();
  $('#device-sheet').showModal();
}

function updateSheet() {
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

function bindSheet() {
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

function buildScenes() {
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

function updateScenes() {
  $$('#scene-grid .scene').forEach((el) => el.classList.toggle('is-applied', Number(el.dataset.scene) === state.appliedScene));
}

// ---------------------------------------------------------------- 5. Mesh & Jitter Simulation

function positionOf(id) {
  if (id === 'gateway') return GATEWAY_POS;
  const l = lightById(id);
  return l ? { x: l.x, y: l.y } : GATEWAY_POS;
}

function buildTopology() {
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

function updateTopology() {
  state.lights.forEach((l) => {
    const core = $(`#topology [data-node="${l.id}"] .node-core`);
    if (core) core.setAttribute('fill', l.on ? kelvinToHex(l.kelvin) : '#3a4250');
  });
}

function flashTopology(targets, path) {
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

function renderMeshStats() {
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

function renderSparkline() {
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

function renderBreakdown() {
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

function renderNodeTable() {
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

function pingAll() {
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

function clearMetrics() {
  state.samples = [];
  state.rttSamples = [];
  state.lastResult = null;
  state.log = [];
  renderLatencyPill();
  updateHome();
  if (state.view === 'mesh') renderMeshStats();
  if (state.view === 'log') renderLog();
}

function bindMesh() {
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

// ---------------------------------------------------------------- 6. API Gateway Console

function buildApiConsole() {
  const list = $('#api-catalog-list');
  list.innerHTML = API_CATALOG.map((item, index) => `
    <div class="api-endpoint-card${state.activeApiIndex === index ? ' is-active' : ''}" data-api-index="${index}">
      <span class="method-badge ${item.method.toLowerCase()}">${item.method}</span>
      <div class="api-endpoint-info">
        <strong>${item.path}</strong>
        <small>${item.description}</small>
      </div>
    </div>`).join('');

  selectApiEndpoint(state.activeApiIndex);
  renderApiLogTable();
}

function selectApiEndpoint(index) {
  state.activeApiIndex = index;
  const item = API_CATALOG[index];
  if (!item) return;

  $$('#api-catalog-list .api-endpoint-card').forEach((card, idx) => {
    card.classList.toggle('is-active', idx === index);
  });

  $('#api-req-method-path').textContent = `${item.method} ${item.path}`;
  $('#api-request-body').value = item.sampleBody ? JSON.stringify(item.sampleBody, null, 2) : '';
  $('#api-request-body').placeholder = item.sampleBody ? 'JSON Request Body...' : 'Endpoint này không yêu cầu Request Body (GET)';
  $('#api-curl-code').textContent = buildCurl(item, gatewayBaseUrl(state.settings));
}

function runApiCall() {
  const item = API_CATALOG[state.activeApiIndex];
  if (!item) return;

  let body = null;
  const rawBody = $('#api-request-body').value.trim();
  if (rawBody && item.method !== 'GET') {
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      toast(`Request Body không phải JSON hợp lệ: ${e.message}`);
      return;
    }
  }

  const res = executeApiRequest({
    method: item.method,
    path: item.path,
    body,
    context: apiContext()
  });

  const resStatus = $('#api-res-status');
  resStatus.textContent = `${res.status} ${res.statusText}`;
  resStatus.className = `status-pill ${res.status >= 200 && res.status < 300 ? 'ok' : 'err'}`;
  $('#api-res-time').textContent = `${res.timeMs} ms`;
  $('#api-response-code').textContent = JSON.stringify(res.body, null, 2);

  renderApiLogTable();
  refresh();
}

function apiContext() {
  return {
    state, lightById, roomLights, setLight, setRoom, recallScene, latencyStats,
    SCENES, NEW_DEVICE_CANDIDATES, quickProvision, removeLight, identifyLight
  };
}

function renderApiLogTable() {
  const tbody = $('#api-log-table tbody');
  $('#api-log-empty').hidden = apiCallHistory.length > 0;
  tbody.innerHTML = apiCallHistory.map((h) => {
    const timeStr = h.timestamp.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(h.timestamp.getMilliseconds()).padStart(3, '0');
    const msg = h.body?.message || (h.body?.ok ? 'Thành công' : h.body?.error || '—');
    return `<tr>
      <td>${timeStr}</td>
      <td><span class="method-badge ${h.method.toLowerCase()}">${h.method}</span></td>
      <td>${h.path}</td>
      <td><span class="status-pill ${h.status < 300 ? 'ok' : 'err'}">${h.status}</span></td>
      <td>${h.timeMs} ms</td>
      <td>${msg}</td>
    </tr>`;
  }).join('');
}

function bindApiConsole() {
  $('#api-catalog-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-api-index]');
    if (card) selectApiEndpoint(Number(card.dataset.apiIndex));
  });

  $('#btn-run-api').addEventListener('click', runApiCall);
  $('#btn-run-api-bottom').addEventListener('click', runApiCall);

  $('#btn-reset-api-body').addEventListener('click', () => {
    const item = API_CATALOG[state.activeApiIndex];
    if (item) $('#api-request-body').value = item.sampleBody ? JSON.stringify(item.sampleBody, null, 2) : '';
  });

  $('#btn-copy-curl').addEventListener('click', () => {
    copyText($('#api-curl-code').textContent, 'Đã sao chép lệnh cURL');
  });

  $('#btn-clear-api-log').addEventListener('click', () => {
    apiCallHistory.length = 0;
    renderApiLogTable();
    toast('Đã xoá lịch sử gọi API.');
  });
}

// ---------------------------------------------------------------- 7. Provisioning Flow

function quickProvision(target, roomId, name) {
  const room = roomById.get(roomId) || ROOMS[0];
  const unicast = Math.max(1, ...state.lights.map((l) => l.unicast)) + 1;
  const parent = roomLights(room.id).find((l) => l.relay) ?? state.lights.find((l) => l.relay && l.hops === 1);
  const bounds = room.bounds || { x: 20, y: 20, w: 30, h: 30 };
  const fx = Math.round(bounds.x + 8 + Math.random() * (bounds.w - 16));
  const fy = Math.round(bounds.y + 8 + Math.random() * (bounds.h - 16));

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

function chooseProvisionTarget(device) {
  state.provisionTarget = device;
  $('#prov-title').textContent = device.model;
  $('#prov-meta').textContent = `UUID ${device.uuid} · ${device.rssi} dBm · firmware ${device.fw ?? DEFAULT_FIRMWARE} · ${device.oob ?? 'Static OOB'}`;
  $('#prov-name').value = device.model.replace(' CCT', '');
  $('#prov-scan').hidden = true;
  $('#prov-run').hidden = false;
  $('#prov-name').focus();
}

function bindProvisioning() {
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

function renderLog() {
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

function bindLog() {
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

function copyText(text, message) {
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

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function replaceLights(lights) {
  state.lights = withDerived(lights.map(({ hops, rssi, ...l }) => l));
  rebuildAll();
}

function resetAll() {
  try {
    [STORAGE_KEY, SETTINGS_KEY, THEME_KEY].forEach((k) => localStorage.removeItem(k));
  } catch { /* bỏ qua */ }
  state.settings = sanitizeSettings(null);
  state.path = state.settings.defaultPath;
  state.gatewayOnline = true;
  clearMetrics();
  replaceLights(DEFAULT_LIGHTS.map((l) => ({ ...l, ...DEFAULT_LIGHT_STATE })));
  applyTheme();
  renderPathControl();
  renderGateway();
}

function context() {
  return {
    state, $, $$, toast, escapeHtml, target, transmit, nextTid,
    lightById, roomLights, roomById, setLight, setRoom, recallScene, checkGateway,
    identifyLight, paintIdentify, renameLight, moveLight, removeLight, openProvisioning,
    refresh, rebuildAll, replaceLights, resetAll, clearMetrics, updateSettings,
    confirmAsk, copyText, downloadJson, latencyClass, effectivePath, showWelcome
  };
}

function showWelcome() {
  $('#welcome-dialog').showModal();
}

function bindShell() {
  $$('.nav-item[data-view], .more-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#back-settings').addEventListener('click', () => setView('settings'));
  $('#theme-toggle').addEventListener('click', toggleTheme);
  darkQuery?.addEventListener?.('change', () => { if (state.settings.theme === 'system') applyTheme(); });

  $('#welcome-ok').addEventListener('click', () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* bỏ qua */ }
    $('#welcome-dialog').close();
  });

  $('#sheet-identify').addEventListener('click', () => {
    if (state.openLightId) identifyLight(state.openLightId);
  });
}

function init() {
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
  bindSheet();
  bindMesh();
  bindApiConsole();
  bindProvisioning();
  bindLog();

  const ctx = context();
  views.devices = mountDevices(ctx);
  views.testbench = mountTestbench(ctx);
  views.settings = mountSettings(ctx);

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
