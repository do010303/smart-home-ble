'use strict';

import { roomGroupAddress } from './mesh.js';

// Sơ đồ nhà do người dùng tự thiết kế: phòng (hình chữ nhật), nội thất, vị trí gateway.
// Hệ toạ độ 0–100 như sơ đồ 2D cũ, 1 đơn vị = 0,1 m (khung vẽ 9,6 × 9,6 m).
// Module không đụng DOM: mọi hàm trả về bản sao mới, test được bằng Node.

export const LAYOUT_KEY = 'homemesh-layout-v1';
export const UNIT_M = 0.1;         // 1 đơn vị = 0,1 m
export const GRID = 2;             // bắt lưới 0,2 m
export const MIN_SIZE = 12;        // phòng nhỏ nhất 1,2 m
export const CANVAS = Object.freeze({ min: 4, max: 96 });  // vùng được vẽ
export const MAX_ROOMS = 12;
export const MAX_NAME = 30;

// Loại phòng: tên mặc định, biểu tượng, sàn, kiểu sáng gợi ý.
export const ROOM_TYPES = Object.freeze({
  living: {
    label: 'Phòng khách', icon: '🛋️', floor: 'wood',
    presets: [
      { id: 'guests', name: 'Đón khách', icon: '✨', kelvin: 5000, lightness: 100 },
      { id: 'tv', name: 'Xem TV', icon: '📺', kelvin: 3000, lightness: 25 },
      { id: 'relax', name: 'Thư giãn', icon: '🛋️', kelvin: 2700, lightness: 45 }
    ]
  },
  bedroom: {
    label: 'Phòng ngủ', icon: '🛏️', floor: 'wood',
    presets: [
      { id: 'read', name: 'Đọc sách', icon: '📖', kelvin: 4000, lightness: 75 },
      { id: 'night', name: 'Ngủ ngon', icon: '🌙', kelvin: 2700, lightness: 8 },
      { id: 'wake', name: 'Thức dậy', icon: '☀️', kelvin: 5000, lightness: 85 }
    ]
  },
  kitchen: {
    label: 'Bếp & Bàn ăn', icon: '🍳', floor: 'tile',
    presets: [
      { id: 'cook', name: 'Nấu ăn', icon: '🍳', kelvin: 5000, lightness: 100 },
      { id: 'dinner', name: 'Bữa tối ấm', icon: '🍽️', kelvin: 3000, lightness: 55 },
      { id: 'late', name: 'Đêm khuya', icon: '🌙', kelvin: 2700, lightness: 20 }
    ]
  },
  office: {
    label: 'Phòng làm việc', icon: '💻', floor: 'wood',
    presets: [
      { id: 'focus', name: 'Tập trung', icon: '⚡', kelvin: 6500, lightness: 100 },
      { id: 'meeting', name: 'Họp online', icon: '🎥', kelvin: 4500, lightness: 85 },
      { id: 'break', name: 'Nghỉ ngơi', icon: '☕', kelvin: 3000, lightness: 40 }
    ]
  },
  kids: {
    label: 'Phòng trẻ em', icon: '🧸', floor: 'wood',
    presets: [
      { id: 'study', name: 'Học bài', icon: '✏️', kelvin: 5000, lightness: 95 },
      { id: 'play', name: 'Vui chơi', icon: '🎈', kelvin: 4000, lightness: 80 },
      { id: 'sleep', name: 'Ngủ ngon', icon: '🌙', kelvin: 2700, lightness: 5 }
    ]
  },
  bathroom: {
    label: 'Phòng tắm', icon: '🛁', floor: 'tile',
    presets: [
      { id: 'bright', name: 'Sáng rõ', icon: '💡', kelvin: 5000, lightness: 100 },
      { id: 'spa', name: 'Thư giãn', icon: '🛁', kelvin: 2700, lightness: 40 },
      { id: 'night', name: 'Đêm', icon: '🌙', kelvin: 2700, lightness: 10 }
    ]
  },
  balcony: {
    label: 'Ban công', icon: '🌿', floor: 'tile',
    presets: [
      { id: 'evening', name: 'Buổi tối', icon: '🌆', kelvin: 3000, lightness: 50 },
      { id: 'party', name: 'Tiệc nhỏ', icon: '🎉', kelvin: 4000, lightness: 90 },
      { id: 'guard', name: 'Đèn canh', icon: '🔦', kelvin: 4000, lightness: 15 }
    ]
  },
  hall: {
    label: 'Hành lang', icon: '🚪', floor: 'wood',
    presets: [
      { id: 'walk', name: 'Đi lại', icon: '🚶', kelvin: 4000, lightness: 70 },
      { id: 'night', name: 'Đêm', icon: '🌙', kelvin: 2700, lightness: 10 },
      { id: 'welcome', name: 'Về nhà', icon: '🏠', kelvin: 3500, lightness: 85 }
    ]
  }
});

// Nội thất của nhà mẫu (giữ nguyên từ bản 1.x).
const DEMO_FURNITURE = [
  { room: 'bedroom', type: 'rug', x: 22, y: 20, w: 16, h: 22 },
  { room: 'bedroom', type: 'bed', x: 5, y: 22, w: 21, h: 16, side: 'left' },
  { room: 'bedroom', type: 'nightstand', x: 5, y: 16, w: 5, h: 5 },
  { room: 'bedroom', type: 'nightstand', x: 5, y: 39, w: 5, h: 5 },
  { room: 'bedroom', type: 'wardrobe', x: 34, y: 5, w: 13, h: 6, side: 'top' },
  { room: 'bedroom', type: 'plant', x: 41, y: 41, w: 5, h: 5 },
  { room: 'kitchen', type: 'fridge', x: 89, y: 5, w: 7, h: 7, side: 'right' },
  { room: 'kitchen', type: 'counter', x: 89, y: 12, w: 7, h: 26, side: 'right' },
  { room: 'kitchen', type: 'stove', x: 90, y: 15, w: 5, h: 6 },
  { room: 'kitchen', type: 'sink', x: 90, y: 27, w: 5, h: 6 },
  { room: 'kitchen', type: 'table', x: 58, y: 21, w: 18, h: 10 },
  { room: 'kitchen', type: 'chair', x: 60, y: 16, w: 5, h: 4.5, side: 'top' },
  { room: 'kitchen', type: 'chair', x: 69, y: 16, w: 5, h: 4.5, side: 'top' },
  { room: 'kitchen', type: 'chair', x: 60, y: 31.5, w: 5, h: 4.5, side: 'bottom' },
  { room: 'kitchen', type: 'chair', x: 69, y: 31.5, w: 5, h: 4.5, side: 'bottom' },
  { room: 'living', type: 'rug', x: 10, y: 70, w: 26, h: 18 },
  { room: 'living', type: 'tv', x: 12, y: 61, w: 22, h: 4, side: 'top' },
  { room: 'living', type: 'table', x: 16, y: 75, w: 13, h: 7, low: true },
  { room: 'living', type: 'sofa', x: 9, y: 87, w: 28, h: 8, side: 'bottom' },
  { room: 'living', type: 'armchair', x: 38, y: 72, w: 8, h: 9, side: 'right' },
  { room: 'living', type: 'plant', x: 41, y: 89, w: 5, h: 5 },
  { room: 'office', type: 'desk', x: 59, y: 62, w: 19, h: 8 },
  { room: 'office', type: 'chair', x: 66, y: 71, w: 5.5, h: 5, side: 'bottom' },
  { room: 'office', type: 'shelf', x: 91, y: 60, w: 5, h: 26, side: 'right' },
  { room: 'office', type: 'armchair', x: 56, y: 85, w: 9, h: 9, side: 'left' },
  { room: 'office', type: 'plant', x: 52, y: 61, w: 5, h: 5 }
];

const R = (id, type, x, y, w, h, name) => ({ id, type, name: name ?? ROOM_TYPES[type].label, bounds: { x, y, w, h } });

// Mẫu nhà để khách hàng bắt đầu nhanh.
export const TEMPLATES = Object.freeze({
  demo: {
    label: 'Căn hộ mẫu 4 phòng', desc: 'Khách, ngủ, bếp, làm việc · có sẵn nội thất',
    rooms: [R('living', 'living', 4, 50, 44, 46), R('bedroom', 'bedroom', 4, 4, 44, 46),
      R('kitchen', 'kitchen', 48, 4, 48, 46), R('office', 'office', 48, 50, 48, 46)],
    furniture: DEMO_FURNITURE
  },
  apt1: {
    label: 'Căn hộ 1 phòng ngủ', desc: 'Khách liền bếp, 1 ngủ, 1 tắm',
    rooms: [R('living', 'living', 4, 46, 60, 50), R('kitchen', 'kitchen', 64, 46, 32, 50),
      R('bedroom', 'bedroom', 4, 4, 52, 42), R('bathroom', 'bathroom', 56, 4, 24, 26), R('balcony', 'balcony', 80, 4, 16, 42)],
    furniture: []
  },
  apt2: {
    label: 'Căn hộ 2 phòng ngủ', desc: 'Khách, bếp, 2 ngủ, 1 tắm',
    rooms: [R('living', 'living', 4, 52, 56, 44), R('kitchen', 'kitchen', 60, 52, 36, 44),
      R('bedroom', 'bedroom', 4, 4, 40, 36, 'Phòng ngủ chính'), R('kids', 'kids', 56, 4, 40, 36),
      R('bathroom', 'bathroom', 44, 4, 12, 24), R('hall', 'hall', 4, 40, 92, 12)],
    furniture: []
  },
  studio: {
    label: 'Studio', desc: '1 không gian chính, bếp nhỏ, tắm',
    rooms: [R('living', 'living', 4, 4, 64, 92, 'Không gian chính'), R('bathroom', 'bathroom', 68, 4, 28, 30),
      R('kitchen', 'kitchen', 68, 34, 28, 62, 'Bếp')],
    furniture: []
  },
  blank: {
    label: 'Tự vẽ từ đầu', desc: 'Bắt đầu với 1 phòng, tự thêm và kéo thả',
    rooms: [R('living', 'living', 20, 20, 50, 40)],
    furniture: []
  }
});

const clone = (v) => JSON.parse(JSON.stringify(v));
// Tên phòng do người dùng gõ: bỏ ký tự HTML để chèn an toàn vào giao diện.
export const cleanName = (s) => String(s ?? '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export const snap = (v) => Math.round(v / GRID) * GRID;  // Bắt lưới
export const roomArea = (b) => Math.round(b.w * b.h * UNIT_M * UNIT_M * 10) / 10;  // m², 1 chữ số thập phân
export const areaText = (b) => `${String(roomArea(b)).replace('.', ',')} m²`;  // "2,9 m²"
export const sizeText = (b) => `${(b.w * UNIT_M).toFixed(1).replace('.', ',')} × ${(b.h * UNIT_M).toFixed(1).replace('.', ',')} m`;

export function overlaps(a, b) {  // Hai phòng chồng lên nhau (chạm cạnh thì không tính)
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inCanvas(b) {  // Phòng nằm trong khung vẽ
  return b.x >= CANVAS.min && b.y >= CANVAS.min && b.x + b.w <= CANVAS.max && b.y + b.h <= CANVAS.max;
}

export function contains(b, x, y) {  // Điểm nằm trong phòng (tính cả cạnh)
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export const roomAt = (rooms, x, y) => rooms.find((r) => contains(r.bounds, x, y)) ?? null;  // Phòng chứa điểm

export function nearestRoom(rooms, x, y) {  // Phòng gần điểm nhất (tính tới mép)
  let best = null;
  let bestD = Infinity;
  rooms.forEach((r) => {
    const b = r.bounds;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = r; }
  });
  return best;
}

export function clampInto(b, x, y, pad = 3) {  // Kéo điểm vào trong phòng, cách mép pad
  const px = Math.min(pad, b.w / 2);
  const py = Math.min(pad, b.h / 2);
  return {
    x: Math.round(Math.min(b.x + b.w - px, Math.max(b.x + px, x)) * 10) / 10,
    y: Math.round(Math.min(b.y + b.h - py, Math.max(b.y + py, y)) * 10) / 10
  };
}

export function bboxOf(rooms) {  // Khung bao quanh mọi phòng
  if (!rooms.length) return { x: CANVAS.min, y: CANVAS.min, w: 0, h: 0 };
  const x0 = Math.min(...rooms.map((r) => r.bounds.x));
  const y0 = Math.min(...rooms.map((r) => r.bounds.y));
  const x1 = Math.max(...rooms.map((r) => r.bounds.x + r.bounds.w));
  const y1 = Math.max(...rooms.map((r) => r.bounds.y + r.bounds.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Tường: 4 cạnh mỗi phòng, cạnh chung giữa 2 phòng chỉ giữ 1 lần.
export function wallsOf(rooms) {
  const seen = new Set();
  const out = [];
  rooms.forEach(({ bounds: b }) => {
    [[b.x, b.y, b.x + b.w, b.y], [b.x, b.y + b.h, b.x + b.w, b.y + b.h], [b.x, b.y, b.x, b.y + b.h], [b.x + b.w, b.y, b.x + b.w, b.y + b.h]]
      .forEach((s) => {
        const key = s.join(',');
        if (!seen.has(key)) { seen.add(key); out.push(s); }
      });
  });
  return out;
}

// Kiểm tra toàn bộ sơ đồ. Trả mảng lỗi tiếng Việt (rỗng = hợp lệ).
export function validateLayout(layout) {
  const errors = [];
  const rooms = layout?.rooms;
  if (!Array.isArray(rooms) || rooms.length === 0) return ['Nhà cần ít nhất 1 phòng'];
  if (rooms.length > MAX_ROOMS) errors.push(`Tối đa ${MAX_ROOMS} phòng`);
  const ids = new Set();
  rooms.forEach((r, i) => {
    const b = r?.bounds;
    const label = r?.name || `Phòng ${i + 1}`;
    if (!r?.id || ids.has(r.id)) errors.push(`${label}: mã phòng trống hoặc bị trùng`);
    ids.add(r?.id);
    if (!String(r?.name ?? '').trim()) errors.push(`Phòng ${i + 1}: chưa có tên`);
    if (String(r?.name ?? '').length > MAX_NAME) errors.push(`${label}: tên dài quá ${MAX_NAME} ký tự`);
    if (!ROOM_TYPES[r?.type]) errors.push(`${label}: loại phòng không hợp lệ`);
    if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) { errors.push(`${label}: thiếu kích thước`); return; }
    if (b.w < MIN_SIZE || b.h < MIN_SIZE) errors.push(`${label}: nhỏ hơn ${MIN_SIZE * UNIT_M} m`);
    if (!inCanvas(b)) errors.push(`${label}: nằm ngoài khung vẽ`);
  });
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if (rooms[i]?.bounds && rooms[j]?.bounds && overlaps(rooms[i].bounds, rooms[j].bounds)) {
        errors.push(`${rooms[i].name} chồng lên ${rooms[j].name}`);
      }
    }
  }
  return errors;
}

function assignGroups(rooms) {  // Mỗi phòng một group address riêng, giữ group cũ nếu có
  const used = new Set(rooms.map((r) => r.group).filter(Number.isInteger));
  let i = 0;
  return rooms.map((r) => {
    if (Number.isInteger(r.group)) return r;
    while (used.has(roomGroupAddress(i))) i += 1;
    used.add(roomGroupAddress(i));
    return { ...r, group: roomGroupAddress(i) };
  });
}

export function fromTemplate(id) {  // Sơ đồ mới từ mẫu
  const t = TEMPLATES[id] ?? TEMPLATES.demo;
  const rooms = assignGroups(clone(t.rooms));
  const box = bboxOf(rooms);
  return {
    version: 1,
    template: TEMPLATES[id] ? id : 'demo',
    rooms,
    furniture: clone(t.furniture),
    gateway: { x: snap(box.x + box.w / 2), y: snap(box.y + box.h / 2) }
  };
}

// Dữ liệu đọc từ localStorage / file: hỏng thì dùng nhà mẫu, thiếu group thì cấp mới.
export function normalizeLayout(raw) {
  if (!raw || validateLayout(raw).length) return fromTemplate('demo');
  const rooms = assignGroups(raw.rooms.map((r) => ({ id: String(r.id), type: r.type, name: cleanName(r.name) || ROOM_TYPES[r.type].label, group: r.group, bounds: { ...r.bounds } })));
  const ids = new Set(rooms.map((r) => r.id));
  const furniture = Array.isArray(raw.furniture) ? raw.furniture.filter((f) => ids.has(f?.room)) : [];
  const box = bboxOf(rooms);
  const gw = raw.gateway && Number.isFinite(raw.gateway.x) && Number.isFinite(raw.gateway.y) ? raw.gateway : null;
  return {
    version: 1,
    template: raw.template ?? 'custom',
    rooms,
    furniture,
    gateway: gw ? { x: Math.min(CANVAS.max, Math.max(CANVAS.min, gw.x)), y: Math.min(CANVAS.max, Math.max(CANVAS.min, gw.y)) } : { x: snap(box.x + box.w / 2), y: snap(box.y + box.h / 2) }
  };
}

// Thông tin tính thêm cho giao diện: diện tích, biểu tượng, sàn, vị trí nhãn.
export function deriveRoom(r) {
  const t = ROOM_TYPES[r.type] ?? ROOM_TYPES.living;
  return { ...r, icon: t.icon, floor: t.floor, area: roomArea(r.bounds), labelPos: { x: r.bounds.x + r.bounds.w / 2, y: r.bounds.y + 7 } };
}

const commit = (layout, rooms, furniture = layout.furniture) => {  // Bản sao mới nếu hợp lệ, không thì null
  const next = { ...layout, template: 'custom', rooms, furniture };
  return validateLayout(next).length ? null : next;
};

export function moveRoom(layout, id, dx, dy) {  // Dời phòng (nội thất đi theo); chồng phòng khác / ra ngoài → null
  const room = layout.rooms.find((r) => r.id === id);
  if (!room) return null;
  const sdx = snap(dx);
  const sdy = snap(dy);
  if (!sdx && !sdy) return layout;
  const rooms = layout.rooms.map((r) => (r.id === id ? { ...r, bounds: { ...r.bounds, x: r.bounds.x + sdx, y: r.bounds.y + sdy } } : r));
  const furniture = layout.furniture.map((f) => (f.room === id ? { ...f, x: f.x + sdx, y: f.y + sdy } : f));
  return commit(layout, rooms, furniture);
}

export function resizeRoom(layout, id, w, h) {  // Đổi kích thước (kéo góc dưới phải); nội thất không còn vừa bị bỏ
  const room = layout.rooms.find((r) => r.id === id);
  if (!room) return null;
  const bounds = { ...room.bounds, w: Math.max(MIN_SIZE, snap(w)), h: Math.max(MIN_SIZE, snap(h)) };
  const rooms = layout.rooms.map((r) => (r.id === id ? { ...r, bounds } : r));
  const furniture = layout.furniture.filter((f) => f.room !== id
    || (f.x >= bounds.x && f.y >= bounds.y && f.x + f.w <= bounds.x + bounds.w && f.y + f.h <= bounds.y + bounds.h));
  return commit(layout, rooms, furniture);
}

export function updateRoom(layout, id, { name, type }) {  // Đổi tên / loại phòng
  const rooms = layout.rooms.map((r) => {
    if (r.id !== id) return r;
    const next = { ...r };
    if (type !== undefined && ROOM_TYPES[type]) {
      // Tên đang là tên mặc định của loại cũ → đổi theo loại mới
      if (r.name === ROOM_TYPES[r.type]?.label) next.name = ROOM_TYPES[type].label;
      next.type = type;
    }
    if (name !== undefined) next.name = cleanName(name);
    return next;
  });
  return commit(layout, rooms);
}

// Thêm phòng: tìm chỗ trống đầu tiên (thử cỡ lớn trước). Hết chỗ → null.
export function addRoom(layout, type = 'living') {
  if (!ROOM_TYPES[type] || layout.rooms.length >= MAX_ROOMS) return null;
  let n = 1;
  while (layout.rooms.some((r) => r.id === `${type}-${n}`)) n += 1;
  const id = `${type}-${n}`;
  const sameType = layout.rooms.filter((r) => r.type === type).length;
  const name = sameType ? `${ROOM_TYPES[type].label} ${sameType + 1}` : ROOM_TYPES[type].label;
  for (const size of [30, 24, 20, 16, MIN_SIZE]) {
    for (let y = CANVAS.min; y + size <= CANVAS.max; y += GRID) {
      for (let x = CANVAS.min; x + size <= CANVAS.max; x += GRID) {
        const bounds = { x, y, w: size, h: size };
        if (!layout.rooms.some((r) => overlaps(r.bounds, bounds))) {
          const [room] = assignGroups([...layout.rooms, { id, type, name, bounds }]).slice(-1);
          const next = commit(layout, [...layout.rooms, room]);
          if (next) return { layout: next, room };
        }
      }
    }
  }
  return null;
}

export function removeRoom(layout, id) {  // Xoá phòng (giữ tối thiểu 1 phòng)
  if (layout.rooms.length <= 1) return null;
  return commit(layout, layout.rooms.filter((r) => r.id !== id), layout.furniture.filter((f) => f.room !== id));
}

// Sau khi sơ đồ đổi: đèn nằm ngoài phòng của nó được gán phòng chứa nó (hoặc gần nhất) và kéo vào trong.
// Trả { lights, moved: [{ id, from, to }] } để app gửi lệnh đổi group cho đèn đổi phòng.
export function relocateLights(lights, rooms) {
  const moved = [];
  const out = lights.map((l) => {
    const own = rooms.find((r) => r.id === l.room);
    if (own && contains(own.bounds, l.fx, l.fy)) return l;
    const target = roomAt(rooms, l.fx, l.fy) ?? own ?? nearestRoom(rooms, l.fx, l.fy);
    const p = clampInto(target.bounds, l.fx, l.fy);
    if (target.id !== l.room) moved.push({ id: l.id, from: l.room, to: target.id });
    return { ...l, room: target.id, fx: p.x, fy: p.y };
  });
  return { lights: out, moved };
}

// Lịch sử để Hoàn tác / Làm lại (tối đa 30 bước).
export function createHistory(limit = 30) {
  const undo = [];
  const redo = [];
  return {
    push(snapshot) { undo.push(clone(snapshot)); if (undo.length > limit) undo.shift(); redo.length = 0; },
    undo(current) { if (!undo.length) return null; redo.push(clone(current)); return undo.pop(); },
    redo(current) { if (!redo.length) return null; undo.push(clone(current)); return redo.pop(); },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    clear() { undo.length = 0; redo.length = 0; }
  };
}
