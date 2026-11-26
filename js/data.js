'use strict';

import { ROOM_TYPES, deriveRoom, fromTemplate } from './layout.js';

// Phòng, nội thất, sàn, vị trí gateway: dữ liệu SỐNG, nạp từ sơ đồ người dùng tự thiết kế (js/layout.js).
// Các mảng / object giữ nguyên tham chiếu, applyLayout() thay nội dung bên trong → mọi module đang import đều thấy bản mới.
export const ROOMS = [];  // { id, type, name, group, bounds, icon, floor, area, labelPos }
export const FURNITURE = [];  // nội thất trên mặt bằng (toạ độ 0–100, 1 đơn vị ≈ 0,1 m)
export const FLOORS = {};  // id phòng → 'wood' | 'tile'
export const GATEWAY_FLOORPLAN_POS = { x: 48, y: 48 };  // Vị trí gateway trên mặt bằng

export function applyLayout(layout) {  // Nạp sơ đồ vào ROOMS / FURNITURE / FLOORS / GATEWAY_FLOORPLAN_POS
  ROOMS.splice(0, ROOMS.length, ...layout.rooms.map(deriveRoom));
  FURNITURE.splice(0, FURNITURE.length, ...layout.furniture.map((f) => ({ ...f })));
  Object.keys(FLOORS).forEach((k) => delete FLOORS[k]);
  ROOMS.forEach((r) => { FLOORS[r.id] = r.floor; });
  Object.assign(GATEWAY_FLOORPLAN_POS, layout.gateway);
}
applyLayout(fromTemplate('demo'));

// via: node cha trong cây relay ('gateway' = nhận trực tiếp từ gateway).
// x, y: vị trí trên sơ đồ mạng topology (0–100).
// fx, fy: vị trí trên sơ đồ mặt bằng nhà floorplan (0–100).
export const DEFAULT_LIGHTS = Object.freeze([  // via: node cha trong cây relay ('gateway' = nhận trực tiếp từ gateway)
  { id: 'L1', name: 'Đèn trần chính', room: 'living', unicast: 0x0002, watts: 18, via: 'gateway', relay: true, x: 30, y: 30, fx: 26, fy: 70 },
  { id: 'L2', name: 'Đèn hắt trần', room: 'living', unicast: 0x0003, watts: 12, via: 'gateway', relay: false, x: 18, y: 55, fx: 14, fy: 84 },
  { id: 'L3', name: 'Đèn bàn ăn', room: 'kitchen', unicast: 0x0004, watts: 12, via: 'gateway', relay: true, x: 70, y: 28, fx: 66, fy: 26 },
  { id: 'L4', name: 'Đèn bếp', room: 'kitchen', unicast: 0x0005, watts: 18, via: 'L3', relay: false, x: 88, y: 12, fx: 84, fy: 16 },
  { id: 'L5', name: 'Đèn ngủ trần', room: 'bedroom', unicast: 0x0006, watts: 12, via: 'L1', relay: true, x: 20, y: 10, fx: 24, fy: 20 },
  { id: 'L6', name: 'Đèn đầu giường', room: 'bedroom', unicast: 0x0007, watts: 12, via: 'L5', relay: false, x: 6, y: 30, fx: 12, fy: 36 },
  { id: 'L7', name: 'Đèn bàn làm việc', room: 'office', unicast: 0x0008, watts: 18, via: 'L3', relay: true, x: 78, y: 62, fx: 68, fy: 70 },
  { id: 'L8', name: 'Đèn trần văn phòng', room: 'office', unicast: 0x0009, watts: 18, via: 'L7', relay: false, x: 90, y: 86, fx: 84, fy: 82 }
]);

export const DEFAULT_LIGHT_STATE = Object.freeze({ on: true, lightness: 70, kelvin: 4000 });  // Trạng thái đèn mới: bật, 70 %, 4000 K

// Scene lưu sẵn trong Scene Server của từng đèn → app chỉ gửi 1 gói Scene Recall.
export const SCENES = Object.freeze([
  { id: 1, name: 'Thư giãn', icon: '🌙', kelvin: 2700, lightness: 35, desc: 'Ánh vàng ấm, dịu mắt' },
  { id: 2, name: 'Đọc sách', icon: '📖', kelvin: 5000, lightness: 90, desc: 'Trắng sáng, rõ chữ' },
  { id: 3, name: 'Làm việc', icon: '⚡', kelvin: 6500, lightness: 100, desc: 'Ánh sáng ngày, tập trung' },
  { id: 4, name: 'Xem phim', icon: '🎬', kelvin: 3000, lightness: 15, desc: 'Tối nhẹ, ấm' },
  { id: 5, name: 'Buổi sáng', icon: '☀️', kelvin: 4500, lightness: 80, desc: 'Trung tính, tỉnh táo' },
  { id: 6, name: 'Đi ngủ', icon: '😴', kelvin: 2700, lightness: 0, desc: 'Tắt toàn bộ đèn', off: true }
]);

// Thiết bị chưa vào mạng (Unprovisioned) mà gateway có thể quét thấy.
// rssi = cường độ tín hiệu trung bình tại gateway; fw = firmware driver.
export const NEW_DEVICE_CANDIDATES = Object.freeze([  // Thiết bị chưa vào mạng (Unprovisioned) mà gateway có thể quét thấy
  { uuid: 'A4C1-38F2-11D0', model: 'LED Panel 18W CCT', rssi: -52, watts: 18, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-11D7', model: 'LED Downlight 12W CCT', rssi: -64, watts: 12, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-12A3', model: 'LED Tube 18W CCT', rssi: -71, watts: 18, fw: '1.1.4', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-13B8', model: 'LED Ceiling 18W CCT', rssi: -58, watts: 18, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-14C2', model: 'LED Spot 12W CCT', rssi: -77, watts: 12, fw: '1.1.4', oob: 'No OOB' },
  { uuid: 'A4C1-38F2-15D9', model: 'LED Strip 12W CCT', rssi: -83, watts: 12, fw: '1.0.9', oob: 'No OOB' }
]);

export const DEFAULT_FIRMWARE = '1.2.0';

// Kiểu sáng chọn nhanh cho từng phòng: 1 chạm = 1 gói Light CTL Set tới group của phòng.
// theo LOẠI phòng (living, bedroom, …) — phòng mới thêm cũng có gợi ý.
export const ROOM_PRESETS = Object.freeze(Object.fromEntries(Object.entries(ROOM_TYPES).map(([k, t]) => [k, t.presets])));
export const presetsFor = (room) => ROOM_TYPES[room?.type]?.presets ?? [];  // Kiểu sáng gợi ý của 1 phòng
