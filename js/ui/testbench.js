'use strict';

import { cctGradient, kelvinToHex } from '../cct.js';
import { ROOMS, SCENES } from '../data.js';
import { ADDRESS, PATHS, formatAddress, latencyStats } from '../mesh.js';
import {
  TEST_COMMANDS, buildCommand, commandById, describePacket, expectsStatus, paramsForIteration, statePatch
} from '../testbench.js';

const MAX_ROWS = 200;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Màn hình Điều khiển thử: soạn 1 lệnh, xem trước gói tin, chạy lặp N lần và đo độ trễ.
export function mountTestbench(ctx) {
  const { $, $$, state, escapeHtml } = ctx;
  const run = { active: false, stop: false, rows: [], oneWay: [], rtt: [] };
  let onValue = true;

  // ------------------------------------------------ Form
  function renderTargets() {
    const select = $('#t-target');
    const current = select.value;
    const lights = state.lights.map((l) => `<option value="light:${l.id}">${escapeHtml(l.name)} · ${formatAddress(l.unicast)}</option>`).join('');
    const rooms = ROOMS.map((r) => `<option value="room:${r.id}">${r.icon} ${r.name} · group ${formatAddress(r.group)}</option>`).join('');
    select.innerHTML = `<optgroup label="Một đèn (unicast)">${lights}</optgroup>
      <optgroup label="Cả phòng (group)">${rooms}</optgroup>
      <optgroup label="Toàn nhà"><option value="all">Tất cả đèn · ${formatAddress(ADDRESS.GROUP_ALL_LIGHTS)}</option></optgroup>`;
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  function resolveTarget(value) {
    if (value === 'all') return { label: 'Toàn nhà', dst: ADDRESS.GROUP_ALL_LIGHTS, lights: state.lights };
    const [kind, id] = String(value).split(':');
    if (kind === 'room') {
      const room = ctx.roomById.get(id);
      return room ? { label: room.name, dst: room.group, lights: ctx.roomLights(id) } : null;
    }
    const light = ctx.lightById(id);
    return light ? { label: light.name, dst: light.unicast, lights: [light] } : null;
  }

  function readParams() {
    return {
      on: onValue,
      lightness: Number($('#t-lightness').value),
      kelvin: Number($('#t-kelvin').value),
      scene: Number($('#t-scene').value),
      seconds: Math.min(30, Math.max(1, Number($('#t-seconds').value) || 5))
    };
  }

  function readForm() {
    const count = Math.min(200, Math.max(1, Math.round(Number($('#t-count').value) || 1)));
    const interval = Math.min(2000, Math.max(0, Math.round(Number($('#t-interval').value) || 0)));
    return { command: $('#t-command').value, params: readParams(), count, interval, ack: $('#t-ack').checked };
  }

  function syncForm() {
    const { command, params, ack } = readForm();
    const def = commandById(command);
    $$('#view-test [data-param]').forEach((el) => { el.hidden = !def.params.includes(el.dataset.param); });
    $('#t-ack-row').hidden = !def.ackable;
    $('#t-lightness-out').textContent = `${params.lightness}%`;
    $('#t-kelvin-out').textContent = `${params.kelvin}K`;
    const hex = kelvinToHex(params.kelvin);
    $('#t-kelvin').style.setProperty('--thumb', hex);
    $('#t-lightness').style.background = `linear-gradient(90deg, #2a2f38, ${hex})`;
    $$('#t-on button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.on === '1') === onValue)));

    const target = resolveTarget($('#t-target').value);
    const preview = buildCommand(command, paramsForIteration(command, params, 0, 2, target?.lights[0]?.on), { tid: 0, ack });
    const info = describePacket(preview);
    $('#t-packet').textContent = `${info.opcode} → ${target ? formatAddress(target.dst) : '—'}\n${info.hex}`;
    $('#t-packet-meta').textContent = `${info.bytes} byte · ${info.segments} gói`;
    $('#t-path-tag').textContent = PATHS[ctx.effectivePath()].label;
  }

  // ------------------------------------------------ Chạy
  function applyEffect(command, params, lights) {
    const patch = statePatch(command, params);
    if (patch) lights.forEach((l) => Object.assign(l, patch));
    if (command === 'scene') {
      const scene = SCENES.find((s) => s.id === params.scene);
      if (scene) lights.forEach((l) => Object.assign(l, scene.off ? { on: false } : { on: true, kelvin: scene.kelvin, lightness: scene.lightness }));
    }
    if (command === 'identify') {
      const until = Date.now() + params.seconds * 1000;
      lights.forEach((l) => { l.identifyUntil = until; });
      setTimeout(ctx.paintIdentify, params.seconds * 1000 + 50);
    }
  }

  async function start(form = readForm()) {
    if (run.active) return;
    const target = resolveTarget($('#t-target').value);
    if (!target || target.lights.length === 0) {
      ctx.toast('Đích không có đèn nào — chọn đích khác');
      return;
    }
    run.active = true;
    run.stop = false;
    $('#t-run').disabled = true;
    $('#t-stop').disabled = false;
    const startOn = target.lights[0].on;
    const ack = expectsStatus(form.command, form.ack);

    for (let i = 0; i < form.count && !run.stop; i += 1) {
      const params = paramsForIteration(form.command, form.params, i, form.count, startOn);
      const bytes = buildCommand(form.command, params, { tid: ctx.nextTid(), ack: form.ack });
      const { result, entry } = ctx.transmit({ bytes, dst: target.dst, targets: target.lights, ack, animate: i % 5 === 0 });
      applyEffect(form.command, params, target.lights);
      target.lights.forEach((l) => { l.lastPacket = entry; });

      run.oneWay.push(result.oneWay);
      if (ack) run.rtt.push(result.total);
      run.rows.unshift({ n: run.oneWay.length, target: target.label, opcode: entry.opcode, hex: entry.hex, oneWay: result.oneWay, rtt: ack ? result.total : null });
      if (run.rows.length > MAX_ROWS) run.rows.pop();

      $('#t-progress').style.width = `${((i + 1) / form.count) * 100}%`;
      $('#t-progress-text').textContent = `Lệnh ${i + 1}/${form.count} · ${result.oneWay} ms`;
      ctx.refresh();
      ctx.paintIdentify();
      renderResults();
      await wait(form.interval);
    }

    run.active = false;
    $('#t-run').disabled = false;
    $('#t-stop').disabled = true;
    $('#t-progress').style.width = '0%';
    const s = latencyStats(run.oneWay, ctx.target());
    $('#t-progress-text').textContent = run.stop ? 'Đã dừng.' : `Xong · một chiều TB ${s.avg} ms · P95 ${s.p95} ms`;
  }

  // ------------------------------------------------ Kết quả
  function renderResults() {
    const t = ctx.target();
    const s = latencyStats(run.oneWay, t);
    const r = latencyStats(run.rtt, Infinity);
    const cell = (label, value, cls = '') => `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`;
    const ok = (v) => (s.count ? (v < t ? 'ok' : 'bad') : '');
    $('#t-stats').innerHTML = [
      cell('Số lệnh', s.count),
      cell('Một chiều TB', s.count ? `${s.avg} ms` : '—', ok(s.avg)),
      cell('Một chiều P95', s.count ? `${s.p95} ms` : '—', ok(s.p95)),
      cell(`Đạt < ${t} ms`, s.count ? `${s.withinTarget}%` : '—', s.count ? (s.withinTarget >= 95 ? 'ok' : 'bad') : ''),
      cell('Jitter TB', s.count ? `${s.jitterAvg} ms` : '—'),
      cell('Khứ hồi TB', r.count ? `${r.avg} ms` : '—')
    ].join('');

    const verdict = $('#t-verdict');
    if (!s.count) { verdict.textContent = 'Chưa chạy'; verdict.className = 'tag'; }
    else if (s.p95 < t) { verdict.textContent = `Đạt · P95 ${s.p95} ms`; verdict.className = 'tag ok'; }
    else { verdict.textContent = `Chưa đạt · P95 ${s.p95} ms`; verdict.className = 'tag bad'; }

    $('#t-empty').hidden = run.rows.length > 0;
    $('#t-count-text').textContent = run.rows.length ? `${run.oneWay.length} lệnh` : '';
    $('#t-table tbody').innerHTML = run.rows.map((row) => `<tr>
      <td>${row.n}</td><td>${escapeHtml(row.target)}</td><td>${row.opcode}</td><td>${row.hex}</td>
      <td class="${ctx.latencyClass(row.oneWay)}">${row.oneWay} ms</td>
      <td>${row.rtt != null ? `${row.rtt} ms` : '—'}</td></tr>`).join('');
    renderChart();
  }

  function renderChart() {
    const svg = $('#t-chart');
    const W = 300;
    const H = 120;
    const one = run.oneWay.slice(-100);
    const rtt = run.rtt.slice(-100);
    const t = ctx.target();
    const maxY = Math.max(t * 1.5, ...one, ...rtt) * 1.1;
    const y = (v) => (H - (v / maxY) * H).toFixed(1);
    const line = (data, cls) => {
      if (data.length < 2) return '';
      const step = W / (data.length - 1);
      return `<polyline class="${cls}" points="${data.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(' ')}" />`;
    };
    svg.innerHTML = `${line(rtt, 'line rtt')}${line(one, 'line')}
      <line class="threshold" x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" /><text x="4" y="${y(t) - 4}">${t} ms</text>`;
  }

  function clearResults() {
    run.rows = [];
    run.oneWay = [];
    run.rtt = [];
    $('#t-progress-text').textContent = '';
    renderResults();
  }

  // Bài thử nhanh: điền form rồi chạy.
  function quick(kind) {
    const first = state.lights[0];
    const presets = {
      toggle: { target: first ? `light:${first.id}` : 'all', command: 'toggle', count: 20, interval: 80, ack: true },
      sweep: { target: 'all', command: 'sweep', count: 20, interval: 120, ack: false },
      room: { target: `room:${ROOMS[0].id}`, command: 'ctl', count: 10, interval: 150, ack: true, kelvin: 3000 },
      get: { target: first ? `light:${first.id}` : 'all', command: 'get', count: 30, interval: 50, ack: true }
    };
    const p = presets[kind];
    if (!p || run.active) return;
    $('#t-target').value = p.target;
    $('#t-command').value = p.command;
    $('#t-count').value = p.count;
    $('#t-interval').value = p.interval;
    $('#t-ack').checked = p.ack;
    if (p.kelvin) $('#t-kelvin').value = p.kelvin;
    syncForm();
    start();
  }

  function render() {
    renderTargets();
    syncForm();
    renderResults();
  }

  // ------------------------------------------------ Khởi tạo
  $('#t-command').innerHTML = TEST_COMMANDS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('#t-command').value = 'ctl';
  $('#t-scene').innerHTML = SCENES.map((s) => `<option value="${s.id}">#${s.id} ${s.name}</option>`).join('');
  $('#t-kelvin').style.background = cctGradient();

  $('#view-test .test-form').addEventListener('input', syncForm);
  $('#view-test .test-form').addEventListener('change', syncForm);
  $('#t-on').addEventListener('click', (e) => {
    const b = e.target.closest('[data-on]');
    if (!b) return;
    onValue = b.dataset.on === '1';
    syncForm();
  });
  $('#t-run').addEventListener('click', () => start());
  $('#t-stop').addEventListener('click', () => { run.stop = true; });
  $('#t-clear').addEventListener('click', clearResults);
  $('#view-test .quick-tests').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-quick]');
    if (chip) quick(chip.dataset.quick);
  });

  return { render, renderTargets };
}
