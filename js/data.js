'use strict';

import { roomGroupAddress } from './mesh.js';

export const ROOMS = Object.freeze([
  {
    id: 'living',
    name: 'Phòng khách',
    icon: '🛋️',
    group: roomGroupAddress(0),
    area: 32,
    bounds: { x: 4, y: 50, w: 44, h: 46 },
    labelPos: { x: 26, y: 57 }
  },
  {
    id: 'bedroom',
    name: 'Phòng ngủ',
    icon: '🛏️',
    group: roomGroupAddress(1),
    area: 20,
    bounds: { x: 4, y: 4, w: 44, h: 44 },
    labelPos: { x: 26, y: 11 }
  },
  {
    id: 'kitchen',
    name: 'Bếp & Bàn ăn',
    icon: '🍳',
    group: roomGroupAddress(2),
    area: 24,
    bounds: { x: 50, y: 4, w: 46, h: 44 },
    labelPos: { x: 73, y: 11 }
  },
  {
    id: 'office',
    name: 'Phòng làm việc',
    icon: '💻',
    group: roomGroupAddress(3),
    area: 18,
    bounds: { x: 50, y: 50, w: 46, h: 46 },
    labelPos: { x: 73, y: 57 }
  }
]);

export const GATEWAY_FLOORPLAN_POS = Object.freeze({ x: 48, y: 48 });

// via: node cha trong cây relay ('gateway' = nhận trực tiếp từ gateway).
// x, y: vị trí trên sơ đồ mạng topology (0–100).
// fx, fy: vị trí trên sơ đồ mặt bằng nhà floorplan (0–100).
export const DEFAULT_LIGHTS = Object.freeze([
  { id: 'L1', name: 'Đèn trần chính', room: 'living', unicast: 0x0002, watts: 18, via: 'gateway', relay: true, x: 30, y: 30, fx: 26, fy: 70 },
  { id: 'L2', name: 'Đèn hắt trần', room: 'living', unicast: 0x0003, watts: 12, via: 'gateway', relay: false, x: 18, y: 55, fx: 14, fy: 84 },
  { id: 'L3', name: 'Đèn bàn ăn', room: 'kitchen', unicast: 0x0004, watts: 12, via: 'gateway', relay: true, x: 70, y: 28, fx: 66, fy: 26 },
  { id: 'L4', name: 'Đèn bếp', room: 'kitchen', unicast: 0x0005, watts: 18, via: 'L3', relay: false, x: 88, y: 12, fx: 84, fy: 16 },
  { id: 'L5', name: 'Đèn ngủ trần', room: 'bedroom', unicast: 0x0006, watts: 12, via: 'L1', relay: true, x: 20, y: 10, fx: 24, fy: 20 },
  { id: 'L6', name: 'Đèn đầu giường', room: 'bedroom', unicast: 0x0007, watts: 12, via: 'L5', relay: false, x: 6, y: 30, fx: 12, fy: 36 },
  { id: 'L7', name: 'Đèn bàn làm việc', room: 'office', unicast: 0x0008, watts: 18, via: 'L3', relay: true, x: 78, y: 62, fx: 68, fy: 70 },
  { id: 'L8', name: 'Đèn trần văn phòng', room: 'office', unicast: 0x0009, watts: 18, via: 'L7', relay: false, x: 90, y: 86, fx: 84, fy: 82 }
]);

export const DEFAULT_LIGHT_STATE = Object.freeze({ on: true, lightness: 70, kelvin: 4000 });

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
export const NEW_DEVICE_CANDIDATES = Object.freeze([
  { uuid: 'A4C1-38F2-11D0', model: 'LED Panel 18W CCT', rssi: -52, watts: 18, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-11D7', model: 'LED Downlight 12W CCT', rssi: -64, watts: 12, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-12A3', model: 'LED Tube 18W CCT', rssi: -71, watts: 18, fw: '1.1.4', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-13B8', model: 'LED Ceiling 18W CCT', rssi: -58, watts: 18, fw: '1.2.0', oob: 'QR Static OOB' },
  { uuid: 'A4C1-38F2-14C2', model: 'LED Spot 12W CCT', rssi: -77, watts: 12, fw: '1.1.4', oob: 'No OOB' },
  { uuid: 'A4C1-38F2-15D9', model: 'LED Strip 12W CCT', rssi: -83, watts: 12, fw: '1.0.9', oob: 'No OOB' }
]);

export const DEFAULT_FIRMWARE = '1.2.0';

// Nội thất trên mặt bằng (cùng hệ toạ độ 0–100 như fx/fy; 1 đơn vị ≈ 0,1 m).
// side: phía tựa lưng của sofa/ghế, phía đầu giường, hoặc phía áp tường của tủ/bếp.
export const FLOORS = Object.freeze({ bedroom: 'wood', living: 'wood', kitchen: 'tile', office: 'wood' });

export const FURNITURE = Object.freeze([
  // Phòng ngủ
  { room: 'bedroom', type: 'rug', x: 22, y: 20, w: 16, h: 22 },
  { room: 'bedroom', type: 'bed', x: 5, y: 22, w: 21, h: 16, side: 'left' },
  { room: 'bedroom', type: 'nightstand', x: 5, y: 16, w: 5, h: 5 },
  { room: 'bedroom', type: 'nightstand', x: 5, y: 39, w: 5, h: 5 },
  { room: 'bedroom', type: 'wardrobe', x: 34, y: 5, w: 13, h: 6, side: 'top' },
  { room: 'bedroom', type: 'plant', x: 41, y: 41, w: 5, h: 5 },
  // Bếp & bàn ăn
  { room: 'kitchen', type: 'fridge', x: 89, y: 5, w: 7, h: 7, side: 'right' },
  { room: 'kitchen', type: 'counter', x: 89, y: 12, w: 7, h: 26, side: 'right' },
  { room: 'kitchen', type: 'stove', x: 90, y: 15, w: 5, h: 6 },
  { room: 'kitchen', type: 'sink', x: 90, y: 27, w: 5, h: 6 },
  { room: 'kitchen', type: 'table', x: 58, y: 21, w: 18, h: 10 },
  { room: 'kitchen', type: 'chair', x: 60, y: 16, w: 5, h: 4.5, side: 'top' },
  { room: 'kitchen', type: 'chair', x: 69, y: 16, w: 5, h: 4.5, side: 'top' },
  { room: 'kitchen', type: 'chair', x: 60, y: 31.5, w: 5, h: 4.5, side: 'bottom' },
  { room: 'kitchen', type: 'chair', x: 69, y: 31.5, w: 5, h: 4.5, side: 'bottom' },
  // Phòng khách
  { room: 'living', type: 'rug', x: 10, y: 70, w: 26, h: 18 },
  { room: 'living', type: 'tv', x: 12, y: 61, w: 22, h: 4, side: 'top' },
  { room: 'living', type: 'table', x: 16, y: 75, w: 13, h: 7, low: true },
  { room: 'living', type: 'sofa', x: 9, y: 87, w: 28, h: 8, side: 'bottom' },
  { room: 'living', type: 'armchair', x: 38, y: 72, w: 8, h: 9, side: 'right' },
  { room: 'living', type: 'plant', x: 41, y: 89, w: 5, h: 5 },
  // Phòng làm việc
  { room: 'office', type: 'desk', x: 59, y: 62, w: 19, h: 8 },
  { room: 'office', type: 'chair', x: 66, y: 71, w: 5.5, h: 5, side: 'bottom' },
  { room: 'office', type: 'shelf', x: 91, y: 60, w: 5, h: 26, side: 'right' },
  { room: 'office', type: 'armchair', x: 56, y: 85, w: 9, h: 9, side: 'left' },
  { room: 'office', type: 'plant', x: 52, y: 61, w: 5, h: 5 }
]);
