'use strict';

import { NEW_DEVICE_CANDIDATES, ROOMS } from '../data.js';
import { formatAddress } from '../mesh.js';
import {
  SCAN_DURATION_MS, planScan, requestMeshDevice, rssiBars, rssiLabel, webBluetoothSupport
} from '../scanner.js';

const bars = (rssi) => {
  const n = rssiBars(rssi);
  return `<span class="signal" title="${rssi} dBm · ${rssiLabel(rssi)}" aria-label="Tín hiệu ${rssiLabel(rssi)}">${[1, 2, 3, 4]
    .map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
};

// Màn hình Thiết bị: quét đèn mới (mô phỏng), thử Web Bluetooth, quản lý đèn trong mạng.
export function mountDevices(ctx) {
  const { $, state, escapeHtml } = ctx;
  const scan = { running: false, found: [], timers: [], startedAt: 0, raf: 0 };
  let editingId = null;

  // ------------------------------------------------ Quét mô phỏng
  function startScan() {
    stopScan(false);
    const taken = state.lights.map((l) => l.uuid).filter(Boolean);
    const plan = planScan(NEW_DEVICE_CANDIDATES, taken);
    scan.running = true;
    scan.found = [];
    scan.startedAt = performance.now();
    $('#radar').classList.add('is-scanning');
    $('#btn-scan').hidden = true;
    $('#btn-scan-stop').hidden = false;
    $('#scan-status').textContent = 'Đang quét…';
    $('#radar').querySelectorAll('.blip').forEach((b) => b.remove());

    plan.forEach((device) => {
      scan.timers.push(setTimeout(() => {
        scan.found.push(device);
        addBlip(device);
        renderFound();
      }, device.atMs));
    });
    scan.timers.push(setTimeout(() => stopScan(true), SCAN_DURATION_MS));
    tickProgress();
    renderFound();
  }

  function tickProgress() {
    const pct = Math.min(100, ((performance.now() - scan.startedAt) / SCAN_DURATION_MS) * 100);
    $('#scan-progress').style.width = `${scan.running ? pct : 0}%`;
    if (scan.running) scan.raf = requestAnimationFrame(tickProgress);
  }

  function stopScan(finished) {
    scan.timers.forEach(clearTimeout);
    scan.timers = [];
    cancelAnimationFrame(scan.raf);
    if (!scan.running) return;
    scan.running = false;
    $('#radar').classList.remove('is-scanning');
    $('#btn-scan').hidden = false;
    $('#btn-scan').textContent = 'Quét lại';
    $('#btn-scan-stop').hidden = true;
    $('#scan-progress').style.width = '0%';
    $('#scan-status').textContent = finished ? `Xong · thấy ${scan.found.length} thiết bị` : 'Đã dừng';
    if (finished && scan.found.length === 0) ctx.toast('Không thấy đèn mới. Mọi thiết bị trong vùng phủ sóng đã vào mạng.');
  }

  // Chấm trên radar: càng mạnh càng gần tâm.
  function addBlip(device) {
    const strength = Math.min(1, Math.max(0, (device.rssi + 95) / 55));
    const radius = 12 + (1 - strength) * 34; // % bán kính
    const angle = (parseInt(device.uuid.slice(-2), 16) / 255) * Math.PI * 2;
    const blip = document.createElement('span');
    blip.className = 'blip';
    blip.style.left = `${50 + Math.cos(angle) * radius}%`;
    blip.style.top = `${50 + Math.sin(angle) * radius}%`;
    blip.title = `${device.model} · ${device.rssi} dBm`;
    $('#radar').appendChild(blip);
  }

  function renderFound() {
    const list = $('#found-list');
    $('#found-empty').hidden = scan.found.length > 0 || scan.running;
    list.innerHTML = scan.found.map((d) => `
      <li class="found-item">
        <span class="found-icon" aria-hidden="true"></span>
        <div class="found-info">
          <strong>${escapeHtml(d.model)}</strong>
          <small class="mono">UUID ${d.uuid} · fw ${d.fw} · ${d.oob}</small>
        </div>
        <div class="found-signal">${bars(d.rssi)}<small class="mono">${d.rssi} dBm</small></div>
        <button type="button" class="btn btn-primary" data-add="${d.uuid}">Thêm</button>
      </li>`).join('') + (scan.running ? '<li class="found-item searching"><span class="spinner" aria-hidden="true"></span><small class="muted">Đang lắng nghe beacon…</small></li>' : '');
  }

  function forget(uuid) {
    scan.found = scan.found.filter((d) => d.uuid !== uuid);
    $('#radar').querySelectorAll('.blip').forEach((b) => { if (b.title.includes(uuid)) b.remove(); });
    renderFound();
  }

  // ------------------------------------------------ Web Bluetooth
  function renderWebBleSupport() {
    const support = webBluetoothSupport(navigator, window.isSecureContext);
    const el = $('#webble-support');
    el.textContent = support.supported ? 'Trình duyệt này hỗ trợ Web Bluetooth.' : support.reason;
    el.className = `small ${support.supported ? 'lat-ok' : 'muted'}`;
    $('#btn-webble').disabled = !support.supported;
  }

  async function findRealDevice() {
    const acceptAll = $('#webble-all').checked;
    try {
      const device = await requestMeshDevice(navigator, { acceptAll });
      const li = document.createElement('li');
      li.className = 'found-item';
      li.innerHTML = `<span class="found-icon real" aria-hidden="true"></span>
        <div class="found-info"><strong>${escapeHtml(device.name)}</strong>
        <small class="mono">ID ${escapeHtml(device.id.slice(0, 16))}… · ${device.meshFilter ? 'có dịch vụ BLE Mesh' : 'thiết bị BLE'}</small></div>
        <span class="tag">Đã thấy</span>`;
      $('#webble-list').prepend(li);
      ctx.toast(`Đã tìm thấy “${device.name}” bằng Bluetooth của máy`);
    } catch (err) {
      if (err?.name === 'NotFoundError') ctx.toast('Không chọn thiết bị nào (hoặc không có thiết bị BLE Mesh ở gần)');
      else if (err?.name === 'SecurityError') ctx.toast('Trình duyệt chặn Bluetooth — cần HTTPS và quyền truy cập');
      else ctx.toast(`Không mở được Bluetooth: ${err?.message ?? err}`);
    }
  }

  // ------------------------------------------------ Bảng thiết bị trong mạng
  function render() {
    const lights = state.lights;
    $('#device-count').textContent = `${lights.length} đèn · ${new Set(lights.map((l) => l.room)).size} phòng`;
    $('#device-empty').hidden = lights.length > 0;
    $('#device-table tbody').innerHTML = lights.map((l) => {
      const room = ctx.roomById.get(l.room);
      const outOfRange = l.hops > state.settings.ttl;
      return `<tr data-device-row="${l.id}">
        <td><div class="dev-name"><span class="dev-dot" style="--c:${l.on ? 'var(--accent)' : 'var(--surface-3)'}"></span>
          <div><strong>${escapeHtml(l.name)}</strong><small class="muted">${l.id} · LED ${l.watts} W</small></div></div></td>
        <td>${room ? `${room.icon} ${room.name}` : l.room}</td>
        <td class="mono">${formatAddress(l.unicast)}</td>
        <td class="mono">${l.fw}</td>
        <td><div class="found-signal">${bars(l.rssi)}<small class="mono">${l.rssi} dBm</small></div></td>
        <td>${l.hops}${outOfRange ? ' <span class="tag warn" title="Xa hơn TTL hiện tại">vượt TTL</span>' : ''}</td>
        <td class="right"><div class="row-actions">
          <button type="button" class="btn small-btn" data-identify="${l.id}">Nháy</button>
          <button type="button" class="btn small-btn" data-edit="${l.id}">Sửa</button>
          <button type="button" class="btn small-btn danger" data-remove="${l.id}">Xoá</button>
        </div></td>
      </tr>`;
    }).join('');
    renderWebBleSupport();
    renderFound();
  }

  function openEdit(id) {
    const light = ctx.lightById(id);
    if (!light) return;
    editingId = id;
    $('#edit-meta').textContent = `${light.id} · ${formatAddress(light.unicast)} · firmware ${light.fw}`;
    $('#edit-name').value = light.name;
    $('#edit-room').innerHTML = ROOMS.map((r) => `<option value="${r.id}" ${r.id === light.room ? 'selected' : ''}>${r.icon} ${r.name}</option>`).join('');
    $('#device-edit').showModal();
    $('#edit-name').select();
  }

  function saveEdit(e) {
    e.preventDefault();
    const light = ctx.lightById(editingId);
    if (!light) return;
    const name = $('#edit-name').value.trim();
    if (!name) { ctx.toast('Tên đèn không được để trống'); return; }
    const renamed = name !== light.name && ctx.renameLight(editingId, name);
    const moved = ctx.moveLight(editingId, $('#edit-room').value);
    $('#device-edit').close();
    if (moved) ctx.toast(`Đã chuyển “${name}” sang ${ctx.roomById.get(light.room).name}`);
    else if (renamed) ctx.toast(`Đã đổi tên thành “${name}”`);
  }

  async function askRemove(id) {
    const light = ctx.lightById(id);
    if (!light) return;
    const ok = await ctx.confirmAsk(
      `Xoá “${light.name}” khỏi mạng?`,
      'Gateway gửi Config Node Reset: đèn quên khoá mạng và phải ghép nối lại từ đầu nếu muốn dùng tiếp.',
      'Xoá đèn'
    );
    if (ok && ctx.removeLight(id)) ctx.toast(`Đã xoá “${light.name}” khỏi mạng`);
  }

  // ------------------------------------------------ Sự kiện
  $('#btn-scan').addEventListener('click', startScan);
  $('#btn-scan-stop').addEventListener('click', () => stopScan(false));
  $('#btn-webble').addEventListener('click', findRealDevice);
  $('#found-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const device = scan.found.find((d) => d.uuid === btn.dataset.add);
    if (device) ctx.openProvisioning(device);
  });
  $('#device-table').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.identify) ctx.identifyLight(b.dataset.identify);
    if (b.dataset.edit) openEdit(b.dataset.edit);
    if (b.dataset.remove) askRemove(b.dataset.remove);
  });
  $('#device-edit-form').addEventListener('submit', saveEdit);
  $('#edit-cancel').addEventListener('click', () => $('#device-edit').close());

  return { render, forget };
}
