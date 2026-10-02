'use strict';

import {
  CCT_PRESETS, LED_SPEC, cctGradient, cctToChannels, clampKelvin, estimatePowerW,
  kelvinLabel, kelvinToHex, percentToLightnessActual
} from './cct.js';
import {
  ADDRESS, MESH_LIMITS, PATHS, PROVISIONING_STEPS, computeHops, createTidCounter,
  encodeLightCtlSet, encodeOnOffGet, encodeOnOffSet, encodeSceneRecall, formatAddress,
  latencyStats, opcodeName, segmentsNeeded, simulateGroupLatency, toHex
} from './mesh.js';
import { DEFAULT_LIGHTS, DEFAULT_LIGHT_STATE, NEW_DEVICE_CANDIDATES, ROOMS, SCENES } from './data.js';

const STORAGE_KEY = 'homemesh-mvp-v1';
const SLIDER_THROTTLE_MS = 60;
const GATEWAY_POS = { x: 50, y: 46 };
const VIEW_TITLES = {
  home: ['Nhà của tôi', 'Trang chủ'],
  scenes: ['Ngữ cảnh ánh sáng', 'Cảnh'],
  mesh: ['Gateway + BLE Mesh', 'Mạng Mesh'],
  log: ['Access message', 'Nhật ký gói tin']
};

const nextTid = createTidCounter();
const roomById = new Map(ROOMS.map((r) => [r.id, r]));

const state = {
  view: 'home',
  roomFilter: 'all',
  path: 'local',
  gatewayOnline: true,
  lights: [],
  samples: [],
  log: [],
  lastResult: null,
  openLightId: null,
  appliedScene: null,
  provisionTarget: null
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------- Persistence

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  const lights = saved?.lights?.length ? saved.lights : DEFAULT_LIGHTS.map((l) => ({ ...l, ...DEFAULT_LIGHT_STATE }));
  state.lights = withDerived(lights);
  state.path = saved?.path in PATHS ? saved.path : 'local';
  state.gatewayOnline = saved?.gatewayOnline ?? true;
}

function save() {
  try {
    const lights = state.lights.map(({ hops, rssi, ping, lastPacket, ...rest }) => rest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lights, path: state.path, gatewayOnline: state.gatewayOnline }));
  } catch {
    /* localStorage có thể bị chặn — demo vẫn chạy bình thường */
  }
}

function withDerived(lights) {
  return computeHops(lights).map((l, i) => ({ ...l, rssi: -44 - l.hops * 9 - (i % 3) * 3 }));
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
function transmit({ bytes, dst, targets, record = true, animate = true }) {
  const path = effectivePath();
  const segments = segmentsNeeded(bytes.length);
  // Qua GATT Proxy: điện thoại kết nối node gần nhất nên bớt 1 hop so với gateway.
  const nodes = targets.map((l) => ({ id: l.id, hops: path === 'proxy' ? Math.max(1, l.hops - 1) : l.hops }));
  const result = simulateGroupLatency(nodes, { path, segments });

  const entry = {
    time: new Date(),
    path,
    src: path === 'proxy' ? 'Phone' : formatAddress(ADDRESS.GATEWAY),
    dst: formatAddress(dst),
    opcode: opcodeName(bytes),
    hex: toHex(bytes),
    segments,
    ttl: MESH_LIMITS.defaultTtl,
    latency: result.total,
    slowestId: result.slowest?.node.id ?? null,
    targets: targets.length
  };

  if (record) {
    state.samples.push(result.total);
    if (state.samples.length > 500) state.samples.shift();
    state.log.unshift(entry);
    if (state.log.length > 200) state.log.pop();
    state.lastResult = { ...result, entry };
    renderLatencyPill();
    if (state.view === 'mesh') renderMeshStats();
    if (state.view === 'log') renderLog();
  }
  if (animate && state.view === 'mesh') flashTopology(targets, path);
  return { result, entry };
}

const throttleMap = new Map();
function throttled(key, fn) {
  const now = performance.now();
  if (now - (throttleMap.get(key) ?? 0) < SLIDER_THROTTLE_MS) return;
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
    const { entry } = transmit({ bytes, dst: light.unicast, targets: [light] });
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
  const { entry } = transmit({ bytes, dst: roomById.get(roomId).group, targets: lights });
  lights.forEach((l) => { l.lastPacket = entry; });
  state.appliedScene = null;
  refresh();
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

// ---------------------------------------------------------------- Rendering helpers

function glow(light) {
  return light.on ? (0.15 + (light.lightness / 100) * 0.85).toFixed(2) : 0;
}

function paintBulb(el, light) {
  el.style.setProperty('--c', kelvinToHex(light.kelvin));
  el.style.setProperty('--g', glow(light));
}

function latencyClass(ms) {
  return ms < MESH_LIMITS.targetLatencyMs ? 'lat-ok' : 'lat-bad';
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
  if (state.view === 'scenes') updateScenes();
  if (state.view === 'mesh') { updateTopology(); renderNodeTable(); }
}

// ---------------------------------------------------------------- Top bar & navigation

function setView(view) {
  state.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  const [eyebrow, title] = VIEW_TITLES[view];
  $('#view-eyebrow').textContent = eyebrow;
  $('#view-title').textContent = title;
  if (view === 'scenes') updateScenes();
  if (view === 'mesh') { buildTopology(); renderMeshStats(); renderNodeTable(); }
  if (view === 'log') renderLog();
  window.scrollTo({ top: 0 });
}

function renderPathControl() {
  $$('#path-control button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.path === state.path)));
}

function renderLatencyPill() {
  const pill = $('#latency-pill');
  const last = state.lastResult;
  pill.classList.toggle('is-idle', !last);
  pill.classList.toggle('is-late', !!last && last.total >= MESH_LIMITS.targetLatencyMs);
  $('#latency-pill-text').textContent = last ? `${last.total.toFixed(1)} ms · ${PATHS[last.entry.path].short}` : '— ms';
}

function renderGateway() {
  $('#nav-gateway').classList.toggle('is-offline', !state.gatewayOnline);
  $('#nav-gateway-text').textContent = state.gatewayOnline ? `Online · ${formatAddress(ADDRESS.GATEWAY)}` : 'Offline · dùng BLE Proxy';
  $('#gateway-online').checked = state.gatewayOnline;
  $('#topology .gw')?.classList.toggle('offline', !state.gatewayOnline);
}

// ---------------------------------------------------------------- Home

function buildHome() {
  const filter = $('#room-filter');
  filter.innerHTML = [{ id: 'all', name: 'Tất cả', icon: '🏠' }, ...ROOMS]
    .map((r) => `<button type="button" role="tab" class="chip${state.roomFilter === r.id ? ' is-active' : ''}" data-room-filter="${r.id}">${r.icon} ${r.name}</button>`)
    .join('');

  const rooms = ROOMS.filter((r) => state.roomFilter === 'all' || r.id === state.roomFilter);
  $('#rooms').innerHTML = rooms.map((room) => `
    <section class="room" data-room="${room.id}">
      <div class="room-head">
        <div class="room-title">
          <span aria-hidden="true">${room.icon}</span>
          <h2>${room.name}</h2>
          <small>group ${formatAddress(room.group)}</small>
        </div>
        <label class="switch-row" title="Bật/tắt cả phòng (1 gói tới group)">
          <input type="checkbox" data-action="room-toggle" aria-label="Bật/tắt ${room.name}" /><span class="switch"></span>
        </label>
        <div class="room-group-controls">
          <label>Độ sáng cả phòng <input type="range" class="range mini range-light" data-action="room-lightness" min="1" max="100" /></label>
          <label>Màu cả phòng <input type="range" class="range mini range-cct" data-action="room-kelvin" min="${LED_SPEC.minK}" max="${LED_SPEC.maxK}" step="50" /></label>
        </div>
      </div>
      <div class="device-grid">
        ${roomLights(room.id).map((l) => `
          <article class="device" data-light="${l.id}">
            <button type="button" class="device-open" aria-label="Mở ${l.name}"></button>
            <div class="device-top">
              <span class="bulb" aria-hidden="true"></span>
              <label class="switch-row"><input type="checkbox" data-action="light-toggle" aria-label="Bật/tắt ${l.name}" /><span class="switch"></span></label>
            </div>
            <div>
              <div class="device-name">${l.name}</div>
              <div class="device-meta"></div>
            </div>
          </article>`).join('') || '<p class="muted">Chưa có đèn.</p>'}
      </div>
    </section>`).join('');

  $$('#rooms .range-cct').forEach((el) => { el.style.background = cctGradient(); });
  updateHome();
}

function updateHome() {
  const on = state.lights.filter((l) => l.on);
  const watts = state.lights.reduce((s, l) => s + estimatePowerW(l.watts, l.on, l.lightness), 0);
  const stats = latencyStats(state.samples);
  $('#summary').innerHTML = `
    <div class="card"><small>Đèn đang bật</small><b>${on.length}/${state.lights.length}</b></div>
    <div class="card"><small>Công suất tổng (ước tính)</small><b>${watts.toFixed(1)} W</b></div>
    <div class="card"><small>Độ trễ trung bình</small><b class="${stats.count ? latencyClass(stats.avg) : ''}">${stats.count ? stats.avg + ' ms' : '—'}</b></div>
    <div class="card"><small>Gateway</small><b class="${state.gatewayOnline ? 'lat-ok' : 'lat-bad'}">${state.gatewayOnline ? 'Online' : 'Offline'}</b></div>`;

  $$('#rooms .device').forEach((card) => {
    const light = lightById(card.dataset.light);
    if (!light) return;
    card.classList.toggle('is-off', !light.on);
    paintBulb($('.bulb', card), light);
    $('[data-action="light-toggle"]', card).checked = light.on;
    $('.device-meta', card).textContent = light.on ? `${light.kelvin}K · ${light.lightness}%` : `Tắt · ${light.watts}W`;
  });

  $$('#rooms .room').forEach((section) => {
    const lights = roomLights(section.dataset.room);
    if (lights.length === 0) return;
    const onLights = lights.filter((l) => l.on);
    const ref = onLights.length ? onLights : lights;
    const kelvin = Math.round(average(ref.map((l) => l.kelvin)) / 50) * 50;
    const lightness = Math.round(average(ref.map((l) => l.lightness)));
    $('[data-action="room-toggle"]', section).checked = onLights.length > 0;
    const k = $('[data-action="room-kelvin"]', section);
    const b = $('[data-action="room-lightness"]', section);
    if (!isEditing(k)) k.value = kelvin;
    if (!isEditing(b)) b.value = lightness;
    k.style.setProperty('--thumb', kelvinToHex(kelvin));
    b.style.background = `linear-gradient(90deg, #2a2f38, ${kelvinToHex(kelvin)})`;
  });
}

function bindHome() {
  $('#room-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-room-filter]');
    if (!btn) return;
    state.roomFilter = btn.dataset.roomFilter;
    buildHome();
  });

  const rooms = $('#rooms');
  rooms.addEventListener('click', (e) => {
    const open = e.target.closest('.device-open');
    if (open) openSheet(open.closest('.device').dataset.light);
  });

  rooms.addEventListener('change', (e) => {
    const el = e.target;
    const card = el.closest('.device');
    const room = el.closest('.room')?.dataset.room;
    switch (el.dataset.action) {
      case 'light-toggle': setLight(card.dataset.light, { on: el.checked }); break;
      case 'room-toggle': setRoom(room, { on: el.checked }); break;
      case 'room-kelvin': setRoom(room, { on: true, kelvin: Number(el.value) }, { ack: true }); break;
      case 'room-lightness': setRoom(room, { on: true, lightness: Number(el.value) }, { ack: true }); break;
      default:
    }
  });

  // Kéo thanh trượt: gửi Unack, giới hạn tần suất để không làm nghẽn mesh.
  rooms.addEventListener('input', (e) => {
    const el = e.target;
    const room = el.closest('.room')?.dataset.room;
    const key = el.dataset.action === 'room-kelvin' ? 'kelvin' : el.dataset.action === 'room-lightness' ? 'lightness' : null;
    if (!key) return;
    roomLights(room).forEach((l) => { l[key] = Number(el.value); l.on = true; });
    updateHome();
    throttled(`room-${room}`, () => setRoom(room, { on: true, [key]: Number(el.value) }, { ack: false }));
  });
}

// ---------------------------------------------------------------- Device sheet

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

// ---------------------------------------------------------------- Scenes

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

// ---------------------------------------------------------------- Mesh view

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

// Minh hoạ gói tin lan qua các hop (làm chậm ~6 lần để mắt kịp thấy).
function flashTopology(targets, path) {
  const svg = $('#topology');
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
  const s = latencyStats(state.samples);
  const last = state.lastResult;
  const cell = (label, value, cls = '') => `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`;
  const okCls = (v) => (s.count ? (v < MESH_LIMITS.targetLatencyMs ? 'ok' : 'bad') : '');
  $('#latency-stats').innerHTML = [
    cell('Gần nhất', last ? `${last.total}` : '—', last ? okCls(last.total) : ''),
    cell('Trung bình', s.count ? s.avg : '—', okCls(s.avg)),
    cell('P95', s.count ? s.p95 : '—', okCls(s.p95)),
    cell('Max', s.count ? s.max : '—', okCls(s.max)),
    cell('Đạt < 50 ms', s.count ? `${s.withinTarget}%` : '—', s.count ? (s.withinTarget >= 95 ? 'ok' : 'bad') : ''),
    cell('Số lệnh', s.count)
  ].join('');

  renderSparkline();
  renderBreakdown();
}

function renderSparkline() {
  const svg = $('#sparkline');
  const data = state.samples.slice(-80);
  const W = 300;
  const H = 90;
  const maxY = Math.max(80, ...data) * 1.1;
  const y = (v) => H - (v / maxY) * H;
  const thr = y(MESH_LIMITS.targetLatencyMs);
  if (data.length < 2) {
    svg.innerHTML = `<line class="threshold" x1="0" x2="${W}" y1="${thr}" y2="${thr}" /><text x="4" y="${thr - 4}">50 ms</text>`;
    return;
  }
  const step = W / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  svg.innerHTML = `
    <polygon class="area" points="0,${H} ${pts.join(' ')} ${W},${H}" />
    <polyline class="line" points="${pts.join(' ')}" />
    <line class="threshold" x1="0" x2="${W}" y1="${thr}" y2="${thr}" />
    <text x="4" y="${thr - 4}">50 ms</text>`;
}

function renderBreakdown() {
  const last = state.lastResult;
  const box = $('#breakdown');
  if (!last?.slowest) {
    box.innerHTML = '<p class="muted small">Gửi 1 lệnh để xem độ trễ từng chặng.</p>';
    $('#breakdown-target').textContent = '';
    return;
  }
  const slow = last.slowest;
  const light = lightById(slow.node.id);
  $('#breakdown-target').textContent = `Đèn chậm nhất: ${light?.name ?? slow.node.id} (${slow.node.hops} hop, ${PATHS[last.entry.path].label})`;
  box.innerHTML = slow.breakdown.map((p) => `
    <div class="bd-row">
      <div><span class="bd-label">${p.label}</span><div class="bd-bar" style="width:${Math.max(2, (p.ms / slow.total) * 100)}%"></div></div>
      <b>${p.ms.toFixed(1)}</b>
    </div>`).join('') +
    `<div class="bd-row bd-total"><span>Tổng</span><b class="${latencyClass(slow.total)}">${slow.total}</b></div>`;
}

function renderNodeTable() {
  $('#node-count').textContent = `${state.lights.length} node · TTL ${MESH_LIMITS.defaultTtl} · tối đa ${MESH_LIMITS.maxHops} hop`;
  $('#node-table tbody').innerHTML = state.lights.map((l) => {
    const room = roomById.get(l.room);
    const status = l.ping != null
      ? `<span class="${latencyClass(l.ping)}">Online · ${l.ping} ms</span>`
      : '<span class="lat-ok">Online</span>';
    return `<tr>
      <td>${l.name}</td>
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
    const { result } = transmit({ bytes: encodeOnOffGet(), dst: l.unicast, targets: [l], record: false, animate: false });
    l.ping = result.total;
  });
  flashTopology(state.lights, path);
  renderNodeTable();
  const pings = state.lights.map((l) => l.ping);
  toast(`Ping ${pings.length} node · max ${Math.max(...pings).toFixed(1)} ms`);
}

async function stressTest(button) {
  button.disabled = true;
  const before = state.samples.length;
  for (let i = 0; i < 100; i += 1) {
    const useGroup = Math.random() < 0.4;
    const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    const targets = useGroup ? roomLights(room.id) : [state.lights[Math.floor(Math.random() * state.lights.length)]];
    if (targets.length === 0) continue;
    const bytes = encodeLightCtlSet({
      lightness: percentToLightnessActual(20 + Math.random() * 80),
      temperature: clampKelvin(LED_SPEC.minK + Math.random() * (LED_SPEC.maxK - LED_SPEC.minK)),
      tid: nextTid()
    });
    transmit({ bytes, dst: useGroup ? room.group : targets[0].unicast, targets, animate: i % 10 === 0 });
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 30));
  }
  const s = latencyStats(state.samples.slice(before));
  toast(`100 lệnh · TB ${s.avg} ms · P95 ${s.p95} ms · ${s.withinTarget}% < 50 ms`);
  button.disabled = false;
}

function bindMesh() {
  $('#btn-ping').addEventListener('click', pingAll);
  $('#btn-stress').addEventListener('click', (e) => stressTest(e.currentTarget));
  $('#btn-reset-stats').addEventListener('click', () => {
    state.samples = [];
    state.lastResult = null;
    renderMeshStats();
    renderLatencyPill();
    updateHome();
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

// ---------------------------------------------------------------- Provisioning

function openProvisioning() {
  const taken = new Set(state.lights.map((l) => l.uuid).filter(Boolean));
  const list = NEW_DEVICE_CANDIDATES.filter((c) => !taken.has(c.uuid));
  $('#prov-scan').hidden = false;
  $('#prov-run').hidden = true;
  $('#prov-candidates').innerHTML = list.length
    ? list.map((c) => `<li><button type="button" class="candidate" data-uuid="${c.uuid}">
        <span>${c.model}<small>UUID ${c.uuid}</small></span><small>${c.rssi} dBm</small></button></li>`).join('')
    : '<li class="muted">Không tìm thấy thiết bị mới.</li>';
  $('#prov-room').innerHTML = ROOMS.map((r) => `<option value="${r.id}">${r.icon} ${r.name}</option>`).join('');
  $('#prov-steps').innerHTML = PROVISIONING_STEPS.map((s) => `<li data-step="${s.id}"><span><b>${s.title}</b><small>${s.detail}</small></span></li>`).join('');
  $('#prov-start').disabled = false;
  $('#provision-dialog').showModal();
}

function bindProvisioning() {
  const dialog = $('#provision-dialog');
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  $('#prov-candidates').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-uuid]');
    if (!btn) return;
    state.provisionTarget = NEW_DEVICE_CANDIDATES.find((c) => c.uuid === btn.dataset.uuid);
    $('#prov-title').textContent = state.provisionTarget.model;
    $('#prov-scan').hidden = true;
    $('#prov-run').hidden = false;
  });

  $('#prov-start').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const roomId = $('#prov-room').value;
    const room = roomById.get(roomId);
    const unicast = Math.max(...state.lights.map((l) => l.unicast)) + 1;

    for (const li of $$('#prov-steps li')) {
      li.classList.add('is-running');
      if (li.dataset.step === 'pubsub') $('small', li).textContent = `Subscribe group ${formatAddress(room.group)} (${room.name})`;
      if (li.dataset.step === 'data') $('small', li).textContent = `Unicast ${formatAddress(unicast)} · NetKey index 0 · IV Index 0`;
      await new Promise((r) => setTimeout(r, 420));
      li.classList.replace('is-running', 'is-done');
    }

    const target = state.provisionTarget;
    const parent = roomLights(roomId).find((l) => l.relay) ?? state.lights.find((l) => l.relay && l.hops === 1);
    const angle = Math.random() * Math.PI * 2;
    const px = parent?.x ?? GATEWAY_POS.x;
    const py = parent?.y ?? GATEWAY_POS.y;
    const light = {
      id: `L${state.lights.length + 1}`,
      uuid: target.uuid,
      name: `${target.model.replace(' CCT', '')}`,
      room: roomId,
      unicast,
      watts: target.watts,
      via: parent?.id ?? 'gateway',
      relay: false,
      x: Math.round(Math.min(94, Math.max(6, px + Math.cos(angle) * 14))),
      y: Math.round(Math.min(90, Math.max(6, py + Math.sin(angle) * 14))),
      ...DEFAULT_LIGHT_STATE
    };
    state.lights = withDerived([...state.lights.map(({ hops, rssi, ...rest }) => rest), light]);
    save();
    buildHome();
    buildTopology();
    renderNodeTable();
    dialog.close();
    toast(`Đã thêm “${light.name}” vào ${room.name} · ${formatAddress(unicast)}`);
  });
}

// ---------------------------------------------------------------- Log

function renderLog() {
  const fmt = (d) => d.toLocaleTimeString('vi-VN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  $('#log-empty').hidden = state.log.length > 0;
  $('#log-table tbody').innerHTML = state.log.map((e) => `<tr>
    <td>${fmt(e.time)}</td>
    <td>${PATHS[e.path].short}</td>
    <td>${e.src} → ${e.dst}${e.targets > 1 ? ` (${e.targets})` : ''}</td>
    <td>${e.opcode}</td>
    <td>${e.hex}</td>
    <td>${e.segments}</td>
    <td>${e.ttl}</td>
    <td class="${latencyClass(e.latency)}">${e.latency} ms</td>
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

// ---------------------------------------------------------------- Init

function init() {
  load();

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#path-control').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-path]');
    if (!btn) return;
    state.path = btn.dataset.path;
    renderPathControl();
    save();
    toast(`Đường truyền: ${PATHS[state.path].label}`);
  });

  bindHome();
  bindSheet();
  bindMesh();
  bindProvisioning();
  bindLog();

  buildHome();
  buildScenes();
  renderPathControl();
  renderLatencyPill();
  renderGateway();
}

init();
