'use strict';

// UUID dịch vụ GATT theo Mesh Profile: thiết bị chưa vào mạng quảng bá 0x1827,
// node đã vào mạng (bật Proxy) quảng bá 0x1828.
export const MESH_PROVISIONING_SERVICE = 0x1827;
export const MESH_PROXY_SERVICE = 0x1828;

export const SCAN_DURATION_MS = 6000;

// Lên lịch "thấy" từng thiết bị trong một lượt quét mô phỏng.
// Tín hiệu mạnh được thấy sớm hơn; RSSI dao động ±4 dBm mỗi lượt.
export function planScan(pool, takenUuids, rng = Math.random, durationMs = SCAN_DURATION_MS) {
  const taken = new Set(takenUuids);
  return pool
    .filter((d) => !taken.has(d.uuid))
    .map((d) => {
      const rssi = Math.round(d.rssi + (rng() * 8 - 4));
      const strength = Math.min(1, Math.max(0, (rssi + 95) / 55)); // -95 dBm → 0, -40 dBm → 1
      const atMs = Math.round(300 + (1 - strength) * (durationMs * 0.7) + rng() * 400);
      return { ...d, rssi, atMs: Math.min(atMs, durationMs - 200) };
    })
    .sort((a, b) => a.atMs - b.atMs);
}

// 0–4 vạch sóng.
export function rssiBars(rssi) {
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

export function rssiLabel(rssi) {
  return ['Rất yếu', 'Yếu', 'Trung bình', 'Tốt', 'Rất tốt'][rssiBars(rssi)];
}

// Web Bluetooth chỉ có trên Chrome/Edge/Opera, cần HTTPS (hoặc localhost).
export function webBluetoothSupport(nav, isSecure) {
  if (!isSecure) return { supported: false, reason: 'Cần mở trang qua HTTPS hoặc localhost.' };
  if (!nav?.bluetooth?.requestDevice) {
    return { supported: false, reason: 'Trình duyệt chưa hỗ trợ Web Bluetooth (dùng Chrome hoặc Edge trên máy tính/Android).' };
  }
  return { supported: true, reason: '' };
}

// Mở hộp thoại chọn thiết bị của trình duyệt, lọc theo dịch vụ BLE Mesh.
// Chỉ đọc tên/ID để hiển thị — MVP không provisioning qua Web Bluetooth.
export async function requestMeshDevice(nav, { acceptAll = false } = {}) {
  const options = acceptAll
    ? { acceptAllDevices: true }
    : { filters: [{ services: [MESH_PROVISIONING_SERVICE] }, { services: [MESH_PROXY_SERVICE] }] };
  const device = await nav.bluetooth.requestDevice(options);
  return { id: device.id, name: device.name || '(không tên)', meshFilter: !acceptAll };
}
