'use strict';

import { roomGroupAddress } from './mesh.js';

export const ROOMS = Object.freeze([
  { id: 'living', name: 'Phòng khách', icon: '🛋️', group: roomGroupAddress(0) },
  { id: 'bedroom', name: 'Phòng ngủ', icon: '🛏️', group: roomGroupAddress(1) },
  { id: 'kitchen', name: 'Bếp', icon: '🍳', group: roomGroupAddress(2) },
  { id: 'office', name: 'Phòng làm việc', icon: '💻', group: roomGroupAddress(3) }
]);

// via: node cha trong cây relay ('gateway' = nhận trực tiếp từ gateway).
// x, y: vị trí trên sơ đồ mạng (0–100).
export const DEFAULT_LIGHTS = Object.freeze([
  { id: 'L1', name: 'Đèn trần chính', room: 'living', unicast: 0x0002, watts: 18, via: 'gateway', relay: true, x: 30, y: 30 },
  { id: 'L2', name: 'Đèn hắt trần', room: 'living', unicast: 0x0003, watts: 12, via: 'gateway', relay: false, x: 18, y: 55 },
  { id: 'L3', name: 'Đèn bàn ăn', room: 'kitchen', unicast: 0x0004, watts: 12, via: 'gateway', relay: true, x: 70, y: 28 },
  { id: 'L4', name: 'Đèn bếp', room: 'kitchen', unicast: 0x0005, watts: 18, via: 'L3', relay: false, x: 88, y: 12 },
  { id: 'L5', name: 'Đèn ngủ trần', room: 'bedroom', unicast: 0x0006, watts: 12, via: 'L1', relay: true, x: 20, y: 10 },
  { id: 'L6', name: 'Đèn đầu giường', room: 'bedroom', unicast: 0x0007, watts: 12, via: 'L5', relay: false, x: 6, y: 30 },
  { id: 'L7', name: 'Đèn bàn làm việc', room: 'office', unicast: 0x0008, watts: 18, via: 'L3', relay: true, x: 78, y: 62 },
  { id: 'L8', name: 'Đèn trần văn phòng', room: 'office', unicast: 0x0009, watts: 18, via: 'L7', relay: false, x: 90, y: 86 }
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

export const NEW_DEVICE_CANDIDATES = Object.freeze([
  { uuid: 'A4C1-38F2-11D0', model: 'LED Panel 18W CCT', rssi: -52, watts: 18 },
  { uuid: 'A4C1-38F2-11D7', model: 'LED Downlight 12W CCT', rssi: -64, watts: 12 },
  { uuid: 'A4C1-38F2-12A3', model: 'LED Tube 18W CCT', rssi: -71, watts: 18 }
]);
