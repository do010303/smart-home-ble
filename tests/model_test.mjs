import assert from 'node:assert/strict';
import {
  cctToChannels, clampKelvin, estimatePowerW, kelvinToRgb, lightnessActualToLinear, percentToLightnessActual
} from '../js/cct.js';
import {
  MESH_LIMITS, LATENCY_PROFILE, computeHops, createTidCounter, encodeLightCtlSet, encodeOnOffSet,
  encodeSceneRecall, latencyStats, opcodeName, segmentsNeeded, simulateGroupLatency, simulateLatency, toHex
} from '../js/mesh.js';
import { DEFAULT_LIGHTS, ROOMS } from '../js/data.js';
import { executeApiRequest } from '../js/api.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`✓ ${name}`); };
const worst = () => 1;
const best = () => 0;

// ---------- CCT / driver
test('Kelvin bị giới hạn trong 2700–6500K', () => {
  assert.equal(clampKelvin(2000), 2700);
  assert.equal(clampKelvin(9000), 6500);
  assert.equal(clampKelvin(4012.4), 4012);
});

test('2700K ra màu ấm (đỏ > xanh dương), 6500K gần trắng', () => {
  const warm = kelvinToRgb(2700);
  const cool = kelvinToRgb(6500);
  assert.equal(warm.r, 255);
  assert.ok(warm.b < 120);
  assert.ok(cool.b > 240 && cool.g > 240);
});

test('Trộn kênh: 2700K chỉ LED ấm, 6500K chỉ LED lạnh', () => {
  const w = cctToChannels(2700, 100);
  const c = cctToChannels(6500, 100);
  assert.equal(w.coolDuty, 0);
  assert.ok(Math.abs(w.warmDuty - 1) < 1e-9);
  assert.ok(Math.abs(c.coolDuty - 1) < 1e-9);
  assert.ok(Math.abs(c.warmDuty) < 1e-9);
});

test('Đổi màu giữ nguyên tổng công suất', () => {
  for (const k of [2700, 3500, 4000, 5000, 6500]) {
    const ch = cctToChannels(k, 60);
    assert.ok(Math.abs(ch.warmDuty + ch.coolDuty - ch.linear) < 1e-9);
  }
});

test('Lightness perceptual → linear (Actual²/65535)', () => {
  assert.equal(percentToLightnessActual(100), 65535);
  assert.equal(lightnessActualToLinear(65535), 65535);
  assert.equal(lightnessActualToLinear(percentToLightnessActual(50)), 16384);
});

test('Công suất ước tính không vượt định mức 12/18W', () => {
  assert.ok(estimatePowerW(18, true, 100) <= 18 + 0.3);
  assert.ok(estimatePowerW(12, true, 100) <= 12 + 0.3);
  assert.equal(estimatePowerW(18, false, 100), 0.3);
});

// ---------- BLE Mesh encoding
test('Light CTL Set Unack đúng opcode và little-endian', () => {
  const bytes = encodeLightCtlSet({ lightness: 0xffff, temperature: 4000, tid: 7 });
  assert.equal(toHex(bytes), '82 5F FF FF A0 0F 00 00 07');
  assert.equal(opcodeName(bytes), 'Light CTL Set Unack');
});

test('Light CTL Set (ack) dùng opcode 0x825E', () => {
  const bytes = encodeLightCtlSet({ lightness: 0, temperature: 2700, tid: 1, ack: true });
  assert.equal(bytes[0], 0x82);
  assert.equal(bytes[1], 0x5e);
});

test('OnOff / Scene Recall encode', () => {
  assert.equal(toHex(encodeOnOffSet({ on: true, tid: 2 })), '82 03 01 02');
  assert.equal(toHex(encodeSceneRecall({ scene: 3, tid: 9 })), '82 43 03 00 09');
});

test('Mọi lệnh điều khiển đèn nằm gọn trong 1 gói unsegmented', () => {
  assert.equal(segmentsNeeded(encodeLightCtlSet({ lightness: 1, temperature: 6500, tid: 1 }).length), 1);
  assert.equal(segmentsNeeded(11), 1);
  assert.equal(segmentsNeeded(12), 2);
});

test('TID xoay vòng 0–255', () => {
  const next = createTidCounter(254);
  assert.equal(next(), 255);
  assert.equal(next(), 0);
});

// ---------- Topology & latency
test('Topology mặc định không vượt quá 3 hop', () => {
  const lights = computeHops(DEFAULT_LIGHTS);
  assert.ok(lights.every((l) => l.hops >= 1 && l.hops <= MESH_LIMITS.maxHops));
  assert.equal(lights.find((l) => l.id === 'L8').hops, 3);
});

test('LAN, worst case 3 hop vẫn < 50 ms', () => {
  const r = simulateLatency({ hops: MESH_LIMITS.maxHops, path: 'local' }, worst);
  assert.ok(r.total < MESH_LIMITS.targetLatencyMs, `worst-case = ${r.total} ms`);
});

test('Cloud luôn > 50 ms (lý do cần điều khiển local-first)', () => {
  const r = simulateLatency({ hops: 1, path: 'cloud' }, best);
  assert.ok(r.total >= LATENCY_PROFILE.cloudRoundTrip[0]);
  assert.ok(r.total > MESH_LIMITS.targetLatencyMs);
});

test('Lệnh group lấy độ trễ của đèn chậm nhất', () => {
  const nodes = computeHops(DEFAULT_LIGHTS);
  const g = simulateGroupLatency(nodes, { path: 'local' }, worst);
  assert.equal(g.slowest.node.hops, 3);
  assert.equal(g.total, Math.max(...g.perNode.map((p) => p.total)));
});

test('Thống kê latency & Jitter (Mean delay variation RFC 3550)', () => {
  const s = latencyStats([10, 20, 30, 40, 60]);
  assert.equal(s.avg, 32);
  assert.equal(s.max, 60);
  assert.equal(s.withinTarget, 80);
  assert.equal(s.min, 10);
  assert.equal(s.jitterAvg, 12.5); // (|20-10| + |30-20| + |40-30| + |60-40|) / 4 = (10+10+10+20)/4 = 12.5
  assert.equal(s.jitterMax, 20);
  assert.equal(s.jitterCurrent, 20);
  assert.equal(latencyStats([]).count, 0);
});

test('Lệnh Ack đo độ trễ vòng lặp Round-Trip (Tx + Rx Status)', () => {
  const unack = simulateLatency({ hops: 2, path: 'local', ack: false }, worst);
  const ack = simulateLatency({ hops: 2, path: 'local', ack: true }, worst);
  assert.ok(ack.total > unack.total, 'Ack latency phải lớn hơn Unack do có chặng phản hồi Status');
  assert.ok(ack.isAck === true);
});

test('Sơ đồ mặt bằng nhà: Tọa độ đèn (fx, fy) nằm gọn trong từng phòng', () => {
  for (const light of DEFAULT_LIGHTS) {
    const room = ROOMS.find((r) => r.id === light.room);
    assert.ok(room, `Đèn ${light.id} phải thuộc một phòng hợp lệ`);
    assert.ok(light.fx >= room.bounds.x && light.fx <= room.bounds.x + room.bounds.w, `Đèn ${light.id} fx nằm trong phòng ${room.name}`);
    assert.ok(light.fy >= room.bounds.y && light.fy <= room.bounds.y + room.bounds.h, `Đèn ${light.id} fy nằm trong phòng ${room.name}`);
  }
});

test('Mô phỏng API Gateway: GET /lights và PUT /lights hoạt động chuẩn REST', () => {
  const fakeState = {
    lights: DEFAULT_LIGHTS.map((l) => ({ ...l, on: false, lightness: 50, kelvin: 3000 })),
    samples: [20, 25],
    path: 'local',
    gatewayOnline: true
  };
  const fakeContext = {
    state: fakeState,
    lightById: (id) => fakeState.lights.find((l) => l.id === id),
    roomLights: (r) => fakeState.lights.filter((l) => l.room === r),
    setLight: (id, patch) => { Object.assign(fakeState.lights.find((l) => l.id === id), patch); },
    setRoom: () => {},
    recallScene: () => {},
    latencyStats: () => ({ avg: 22 }),
    SCENES: [],
    NEW_DEVICE_CANDIDATES: []
  };

  const getRes = executeApiRequest({ method: 'GET', path: '/api/v1/lights', context: fakeContext });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.count, 8);

  const putRes = executeApiRequest({
    method: 'PUT',
    path: '/api/v1/lights/L1',
    body: { on: true, kelvin: 5000, lightness: 90 },
    context: fakeContext
  });
  assert.equal(putRes.status, 200);
  assert.equal(fakeState.lights.find((l) => l.id === 'L1').on, true);
  assert.equal(fakeState.lights.find((l) => l.id === 'L1').kelvin, 5000);
});

console.log(`\n${passed} test passed.`);
