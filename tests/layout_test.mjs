import assert from 'node:assert/strict';
import {
  MAX_ROOMS, MIN_SIZE, ROOM_TYPES, TEMPLATES, addRoom, bboxOf, clampInto, cleanName, createHistory, fromTemplate,
  inCanvas, moveRoom, nearestRoom, normalizeLayout, overlaps, relocateLights, removeRoom, resizeRoom, roomArea,
  roomAt, sizeText, snap, updateRoom, validateLayout, wallsOf
} from '../js/layout.js';
import { DEFAULT_LIGHTS, ROOMS, applyLayout, presetsFor } from '../js/data.js';
import { buildBackup, parseBackup, sanitizeSettings } from '../js/settings.js';

// Test thiết kế nhà: chạy bằng `node tests/layout_test.mjs`.
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`✓ ${name}`); };
const room = (layout, id) => layout.rooms.find((r) => r.id === id);

test('Mọi mẫu nhà hợp lệ: không chồng phòng, nằm trong khung, đủ lớn, group riêng', () => {
  Object.keys(TEMPLATES).forEach((id) => {
    const l = fromTemplate(id);
    assert.deepEqual(validateLayout(l), [], id);
    assert.equal(new Set(l.rooms.map((r) => r.group)).size, l.rooms.length, `${id}: group trùng`);
    assert.ok(inCanvas({ x: l.gateway.x, y: l.gateway.y, w: 0, h: 0 }), `${id}: gateway trong khung`);
  });
});

test('Mẫu nhà 4 phòng giữ đúng mã phòng & group như bản 1.x (đèn cũ không lạc phòng)', () => {
  const l = fromTemplate('demo');
  assert.deepEqual(l.rooms.map((r) => r.id), ['living', 'bedroom', 'kitchen', 'office']);
  assert.deepEqual(l.rooms.map((r) => r.group), [0xC001, 0xC002, 0xC003, 0xC004]);
  applyLayout(l);
  DEFAULT_LIGHTS.forEach((d) => assert.equal(roomAt(ROOMS, d.fx, d.fy)?.id, d.room, `${d.id} nằm trong ${d.room}`));
});

test('Phòng chồng nhau bị phát hiện, chạm cạnh thì không', () => {
  assert.ok(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }));
  const l = fromTemplate('demo');
  l.rooms[1].bounds.y = 40; // phòng ngủ đè lên phòng khách
  assert.match(validateLayout(l).join(), /chồng lên/);
});

test('Sơ đồ lỗi bị báo đúng: 0 phòng, tên trống, quá nhỏ, ra ngoài khung, loại sai, trùng mã', () => {
  assert.deepEqual(validateLayout({ rooms: [] }), ['Nhà cần ít nhất 1 phòng']);
  assert.deepEqual(validateLayout(null), ['Nhà cần ít nhất 1 phòng']);
  const bad = (patch) => validateLayout({ rooms: [{ id: 'a', type: 'living', name: 'A', bounds: { x: 10, y: 10, w: 20, h: 20 }, ...patch }] }).join();
  assert.match(bad({ name: '  ' }), /chưa có tên/);
  assert.match(bad({ bounds: { x: 10, y: 10, w: 6, h: 20 } }), /nhỏ hơn/);
  assert.match(bad({ bounds: { x: 90, y: 10, w: 20, h: 20 } }), /ngoài khung/);
  assert.match(bad({ type: 'garage' }), /loại phòng/);
  assert.match(bad({ bounds: { x: 10, y: 10, w: NaN, h: 20 } }), /kích thước/);
  const dup = { rooms: [{ id: 'a', type: 'living', name: 'A', bounds: { x: 4, y: 4, w: 20, h: 20 } }, { id: 'a', type: 'living', name: 'B', bounds: { x: 40, y: 4, w: 20, h: 20 } }] };
  assert.match(validateLayout(dup).join(), /trùng/);
});

test('Bắt lưới 0,2 m, diện tích và kích thước hiển thị theo mét', () => {
  assert.equal(snap(13), 14);
  assert.equal(snap(-2.9), -2);
  assert.equal(roomArea({ w: 40, h: 30 }), 12);
  assert.equal(sizeText({ w: 44, h: 46 }), '4,4 × 4,6 m');
});

test('Dời phòng: nội thất đi theo; chạm phòng khác hoặc ra ngoài khung → từ chối', () => {
  const l = fromTemplate('demo');
  const shrunk = resizeRoom(l, 'bedroom', 30, 30);
  const moved = moveRoom(shrunk, 'bedroom', 10, 6);
  assert.ok(moved);
  assert.deepEqual(room(moved, 'bedroom').bounds, { x: 14, y: 10, w: 30, h: 30 });
  assert.equal(moveRoom(l, 'bedroom', 0, 20), null, 'đè phòng khách');
  assert.equal(moveRoom(l, 'bedroom', -10, 0), null, 'ra ngoài khung');
  assert.equal(moveRoom(l, 'khong-co', 2, 2), null);
  assert.equal(l.rooms[1].bounds.x, 4, 'bản gốc không bị đổi');
});

test('Đổi cỡ: không nhỏ hơn 1,2 m, không đè phòng bên cạnh, nội thất không vừa bị bỏ', () => {
  const l = fromTemplate('demo');
  const small = resizeRoom(l, 'bedroom', 2, 2);
  assert.equal(room(small, 'bedroom').bounds.w, MIN_SIZE);
  assert.ok(small.furniture.filter((f) => f.room === 'bedroom').length < l.furniture.filter((f) => f.room === 'bedroom').length);
  assert.equal(resizeRoom(l, 'bedroom', 60, 46), null, 'lấn sang bếp');
});

test('Thêm phòng: tìm chỗ trống, tên tự đánh số, group mới; hết chỗ → null', () => {
  let l = fromTemplate('studio');
  l = resizeRoom(l, 'living', 40, 60);
  const res = addRoom(l, 'bedroom');
  assert.ok(res);
  assert.deepEqual(validateLayout(res.layout), []);
  assert.equal(res.room.name, 'Phòng ngủ');
  assert.ok(!l.rooms.some((r) => r.group === res.room.group));
  const res2 = addRoom(res.layout, 'bedroom');
  assert.equal(res2.room.name, 'Phòng ngủ 2');
  assert.notEqual(res2.room.id, res.room.id);
  assert.equal(addRoom(fromTemplate('demo'), 'bedroom'), null, 'căn mẫu đã kín chỗ');
  assert.equal(addRoom(l, 'garage'), null, 'loại không có');
});

test(`Giới hạn ${MAX_ROOMS} phòng`, () => {
  let l = fromTemplate('blank');
  l = resizeRoom(l, 'living', MIN_SIZE, MIN_SIZE);
  for (let i = 1; i < MAX_ROOMS; i += 1) l = addRoom(l, 'office').layout;
  assert.equal(l.rooms.length, MAX_ROOMS);
  assert.equal(addRoom(l, 'office'), null);
});

test('Xoá phòng: giữ tối thiểu 1 phòng, nội thất của phòng bị xoá theo', () => {
  const l = removeRoom(fromTemplate('demo'), 'office');
  assert.equal(l.rooms.length, 3);
  assert.ok(!l.furniture.some((f) => f.room === 'office'));
  assert.equal(removeRoom(fromTemplate('blank'), 'living'), null);
});

test('Đổi tên / loại phòng: lọc ký tự HTML, tên trống bị từ chối, tên mặc định đổi theo loại', () => {
  const l = fromTemplate('demo');
  assert.equal(room(updateRoom(l, 'office', { name: '<b>Phòng</b> "con" & mèo' }), 'office').name, 'bPhòng/b con & mèo');
  assert.equal(normalizeLayout(fromTemplate('demo')).rooms.find((r) => r.id === 'kitchen').name, 'Bếp & Bàn ăn', 'giữ dấu & trong tên');
  assert.equal(updateRoom(l, 'office', { name: '   ' }), null);
  const kids = updateRoom(l, 'office', { type: 'kids' });
  assert.equal(room(kids, 'office').name, 'Phòng trẻ em');
  assert.equal(room(updateRoom(updateRoom(l, 'office', { name: 'Góc học' }), 'office', { type: 'kids' }), 'office').name, 'Góc học', 'tên tự đặt giữ nguyên');
  assert.equal(cleanName('a'.repeat(50)).length, 30);
});

test('Đèn sau khi sửa sơ đồ: đèn ngoài phòng chuyển vào phòng chứa nó / gần nhất', () => {
  const l = removeRoom(fromTemplate('demo'), 'office');
  const lights = DEFAULT_LIGHTS.map((d) => ({ ...d }));
  const { lights: out, moved } = relocateLights(lights, l.rooms);
  assert.deepEqual(moved.map((m) => m.id).sort(), ['L7', 'L8']);
  out.forEach((o) => {
    const r = l.rooms.find((x) => x.id === o.room);
    assert.ok(r, `${o.id} có phòng`);
    assert.ok(o.fx >= r.bounds.x && o.fx <= r.bounds.x + r.bounds.w && o.fy >= r.bounds.y && o.fy <= r.bounds.y + r.bounds.h, `${o.id} nằm trong ${r.id}`);
  });
  const same = relocateLights(lights, fromTemplate('demo').rooms);
  assert.equal(same.moved.length, 0, 'sơ đồ không đổi → không đèn nào bị chuyển');
});

test('Tìm phòng theo điểm, phòng gần nhất, kéo điểm vào trong phòng', () => {
  const rooms = fromTemplate('demo').rooms;
  assert.equal(roomAt(rooms, 10, 10).id, 'bedroom');
  assert.equal(roomAt(rooms, 99, 99), null);
  assert.equal(nearestRoom(rooms, 99, 99).id, 'office');
  assert.deepEqual(clampInto({ x: 10, y: 10, w: 20, h: 20 }, 0, 50), { x: 13, y: 27 });
});

test('Tường: cạnh chung giữa 2 phòng chỉ vẽ 1 lần; khung bao đúng', () => {
  const rooms = [{ bounds: { x: 4, y: 4, w: 20, h: 20 } }, { bounds: { x: 24, y: 4, w: 20, h: 20 } }];
  assert.equal(wallsOf(rooms).length, 7);
  assert.deepEqual(bboxOf(rooms), { x: 4, y: 4, w: 40, h: 20 });
});

test('Dữ liệu hỏng trong localStorage → về nhà mẫu; dữ liệu đúng giữ nguyên, cấp group còn thiếu', () => {
  assert.equal(normalizeLayout(null).template, 'demo');
  assert.equal(normalizeLayout({ rooms: 'abc' }).template, 'demo');
  assert.equal(normalizeLayout({ rooms: [{ id: 'x', type: 'living', name: 'X', bounds: { x: 0, y: 0, w: 5, h: 5 } }] }).template, 'demo');
  const ok = normalizeLayout({ rooms: [{ id: 'x', type: 'bedroom', name: 'Ngủ', bounds: { x: 10, y: 10, w: 30, h: 30 } }], furniture: [{ room: 'khac' }] });
  assert.equal(ok.rooms[0].name, 'Ngủ');
  assert.equal(ok.rooms[0].group, 0xC001);
  assert.equal(ok.furniture.length, 0, 'nội thất của phòng không tồn tại bị bỏ');
  assert.deepEqual(ok.gateway, { x: 26, y: 26 });
});

test('Mỗi loại phòng có ≥ 3 kiểu sáng gợi ý, trong dải 2700–6500 K', () => {
  Object.entries(ROOM_TYPES).forEach(([k, t]) => {
    assert.ok(t.presets.length >= 3, k);
    t.presets.forEach((p) => assert.ok(p.kelvin >= 2700 && p.kelvin <= 6500 && p.lightness >= 1 && p.lightness <= 100));
  });
  assert.equal(presetsFor({ type: 'bathroom' })[0].name, 'Sáng rõ');
  assert.deepEqual(presetsFor({ type: 'khong-co' }), []);
});

test('Hoàn tác / Làm lại: tối đa 30 bước, thao tác mới xoá nhánh làm lại', () => {
  const h = createHistory(3);
  [1, 2, 3, 4].forEach((n) => h.push({ n }));
  assert.deepEqual(h.undo({ n: 5 }), { n: 4 });
  assert.ok(h.canRedo);
  assert.deepEqual(h.redo({ n: 4 }), { n: 5 });
  h.undo({ n: 5 });
  h.push({ n: 9 });
  assert.ok(!h.canRedo);
  assert.deepEqual(h.undo({}), { n: 9 });
  assert.deepEqual(h.undo({}), { n: 3 });
  assert.deepEqual(h.undo({}), { n: 2 });
  assert.equal(h.undo({}), null, 'chỉ giữ 3 bước');
});

test('Sao lưu / khôi phục kèm sơ đồ nhà; file cũ (không sơ đồ) vẫn đọc được; sơ đồ lỗi bị từ chối', () => {
  const layout = updateRoom(fromTemplate('apt1'), 'bedroom', { name: 'Phòng con' });
  const lights = [{ id: 'L1', name: 'Đèn', room: 'bedroom', unicast: 2, watts: 12, via: 'gateway' }];
  const file = JSON.stringify(buildBackup({ settings: sanitizeSettings(null), lights, layout }));
  const r = parseBackup(file, ['living']);
  assert.ok(r.ok, r.error);
  assert.equal(r.layout.rooms.find((x) => x.id === 'bedroom').name, 'Phòng con');
  const old = JSON.stringify(buildBackup({ settings: sanitizeSettings(null), lights: [{ ...lights[0], room: 'living' }] }));
  assert.ok(parseBackup(old, ['living']).ok);
  assert.equal(parseBackup(old, ['living']).layout, null);
  const broken = JSON.parse(file);
  broken.layout.rooms[0].bounds.w = 1;
  assert.match(parseBackup(broken, []).error, /Sơ đồ nhà trong file lỗi/);
});

console.log(`\n${passed} test thiết kế nhà passed.`);
