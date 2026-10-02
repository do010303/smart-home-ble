'use strict';

// Opcode SIG Mesh Model (2 byte). Ack = có Status trả về, Unack = không chờ phản hồi.
export const OPCODES = Object.freeze({
  GENERIC_ONOFF_GET: { code: [0x82, 0x01], name: 'Generic OnOff Get', ack: true },
  GENERIC_ONOFF_SET: { code: [0x82, 0x02], name: 'Generic OnOff Set', ack: true },
  GENERIC_ONOFF_SET_UNACK: { code: [0x82, 0x03], name: 'Generic OnOff Set Unack', ack: false },
  LIGHT_LIGHTNESS_SET_UNACK: { code: [0x82, 0x4d], name: 'Light Lightness Set Unack', ack: false },
  SCENE_RECALL: { code: [0x82, 0x42], name: 'Scene Recall', ack: true },
  SCENE_RECALL_UNACK: { code: [0x82, 0x43], name: 'Scene Recall Unack', ack: false },
  LIGHT_CTL_SET: { code: [0x82, 0x5e], name: 'Light CTL Set', ack: true },
  LIGHT_CTL_SET_UNACK: { code: [0x82, 0x5f], name: 'Light CTL Set Unack', ack: false }
});

export const ADDRESS = Object.freeze({
  GATEWAY: 0x0001,
  GROUP_ALL_LIGHTS: 0xc000
});

// Giới hạn thiết kế để đạt < 50 ms: tối đa 3 hop (TTL = 3).
export const MESH_LIMITS = Object.freeze({
  maxHops: 3,
  defaultTtl: 3,
  targetLatencyMs: 50,
  unsegmentedMaxAccessBytes: 11,
  segmentPayloadBytes: 12
});

// Mô hình độ trễ [min, max] ms cho từng chặng. Số liệu giả định — cần đo lại trên phần cứng thật.
export const LATENCY_PROFILE = Object.freeze({
  lanWebSocket: [3, 8],
  gatewayProcessing: [1, 3],
  advertisingTx: [3, 10],
  relayHop: [6, 12],
  nodeProcessing: [1, 2],
  gattProxyConnInterval: [8, 15],
  cloudRoundTrip: [60, 160]
});

export const PATHS = Object.freeze({
  local: { id: 'local', label: 'LAN → Gateway', short: 'LAN' },
  proxy: { id: 'proxy', label: 'BLE GATT Proxy', short: 'BLE' },
  cloud: { id: 'cloud', label: 'Cloud MQTT', short: 'Cloud' }
});

export const PROVISIONING_STEPS = Object.freeze([
  { id: 'beacon', title: 'Quét Unprovisioned Beacon', detail: 'Gateway quét quảng bá UUID thiết bị mới' },
  { id: 'invite', title: 'Invite & Capabilities', detail: 'Thiết bị báo số phần tử, thuật toán, kiểu OOB' },
  { id: 'ecdh', title: 'Trao đổi khoá công khai (ECDH P-256)', detail: 'Tạo khoá phiên bảo mật' },
  { id: 'auth', title: 'Xác thực OOB', detail: 'Static OOB / mã QR in trên driver' },
  { id: 'data', title: 'Cấp NetKey + Unicast + IV Index', detail: 'Thiết bị chính thức vào mạng' },
  { id: 'appkey', title: 'Config AppKey Add + Model App Bind', detail: 'Gắn AppKey cho OnOff / Lightness / CTL / Scene' },
  { id: 'pubsub', title: 'Config Subscription Add', detail: 'Đăng ký vào group địa chỉ của phòng' }
]);

export function formatAddress(address) {
  return '0x' + address.toString(16).toUpperCase().padStart(4, '0');
}

export function roomGroupAddress(index) {
  return ADDRESS.GROUP_ALL_LIGHTS + 1 + index;
}

const u16le = (v) => [v & 0xff, (v >> 8) & 0xff];

// Light CTL Set: Lightness(2) + Temperature(2) + Delta UV(2) + TID(1) [+ Transition(1) + Delay(1)]
export function encodeLightCtlSet({ lightness, temperature, deltaUv = 0, tid, ack = false }) {
  const op = ack ? OPCODES.LIGHT_CTL_SET : OPCODES.LIGHT_CTL_SET_UNACK;
  return Uint8Array.from([
    ...op.code,
    ...u16le(lightness),
    ...u16le(temperature),
    ...u16le(deltaUv & 0xffff),
    tid & 0xff
  ]);
}

export function encodeOnOffSet({ on, tid, ack = false }) {
  const op = ack ? OPCODES.GENERIC_ONOFF_SET : OPCODES.GENERIC_ONOFF_SET_UNACK;
  return Uint8Array.from([...op.code, on ? 1 : 0, tid & 0xff]);
}

export function encodeOnOffGet() {
  return Uint8Array.from(OPCODES.GENERIC_ONOFF_GET.code);
}

export function encodeSceneRecall({ scene, tid, ack = false }) {
  const op = ack ? OPCODES.SCENE_RECALL : OPCODES.SCENE_RECALL_UNACK;
  return Uint8Array.from([...op.code, ...u16le(scene), tid & 0xff]);
}

export function opcodeName(bytes) {
  const found = Object.values(OPCODES).find((op) => op.code[0] === bytes[0] && op.code[1] === bytes[1]);
  return found ? found.name : 'Unknown';
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// Access payload ≤ 11 byte (TransMIC 32-bit) → 1 gói unsegmented, nhanh nhất.
export function segmentsNeeded(accessBytes, transMicBytes = 4) {
  if (accessBytes <= MESH_LIMITS.unsegmentedMaxAccessBytes) return 1;
  return Math.ceil((accessBytes + transMicBytes) / MESH_LIMITS.segmentPayloadBytes);
}

export function createTidCounter(start = 0) {
  let tid = start;
  return () => {
    tid = (tid + 1) & 0xff;
    return tid;
  };
}

const pick = ([min, max], rng) => min + (max - min) * rng();

// Độ trễ từ lúc người dùng thao tác đến lúc đèn ở cách gateway `hops` hop đổi trạng thái.
export function simulateLatency({ hops, path = 'local', segments = 1 }, rng = Math.random) {
  const p = LATENCY_PROFILE;
  const breakdown = [];

  if (path === 'cloud') breakdown.push({ label: 'App → Cloud → Gateway', ms: pick(p.cloudRoundTrip, rng) });
  if (path === 'local') breakdown.push({ label: 'App → Gateway (WebSocket LAN)', ms: pick(p.lanWebSocket, rng) });
  if (path === 'proxy') breakdown.push({ label: 'App → Proxy node (GATT)', ms: pick(p.gattProxyConnInterval, rng) });

  breakdown.push({ label: 'Gateway / Proxy xử lý + mã hoá', ms: pick(p.gatewayProcessing, rng) });
  breakdown.push({ label: 'Phát quảng bá (advertising)', ms: pick(p.advertisingTx, rng) * segments });

  for (let i = 1; i < hops; i += 1) {
    breakdown.push({ label: `Relay hop ${i}`, ms: pick(p.relayHop, rng) * segments });
  }

  breakdown.push({ label: 'Node giải mã + cập nhật PWM', ms: pick(p.nodeProcessing, rng) });

  const total = breakdown.reduce((sum, part) => sum + part.ms, 0);
  return { total: Math.round(total * 10) / 10, breakdown };
}

// Lệnh group: 1 gói tới địa chỉ group, mọi đèn nhận gần như cùng lúc. Độ trễ = đèn chậm nhất.
export function simulateGroupLatency(nodes, options, rng = Math.random) {
  if (nodes.length === 0) return { total: 0, perNode: [], slowest: null };
  const perNode = nodes.map((node) => ({ node, ...simulateLatency({ ...options, hops: node.hops }, rng) }));
  const slowest = perNode.reduce((a, b) => (b.total > a.total ? b : a));
  return { total: slowest.total, perNode, slowest };
}

export function latencyStats(samples, target = MESH_LIMITS.targetLatencyMs) {
  if (samples.length === 0) return { count: 0, avg: 0, p95: 0, max: 0, withinTarget: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const within = sorted.filter((v) => v < target).length;
  return {
    count: sorted.length,
    avg: Math.round(avg * 10) / 10,
    p95: Math.round(p95 * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    withinTarget: Math.round((within / sorted.length) * 1000) / 10
  };
}

// Tính số hop từ gateway theo cây relay (`via` = node cha).
export function computeHops(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hopsOf = (node, guard = 0) => {
    if (!node.via || node.via === 'gateway' || guard > 8) return 1;
    return 1 + hopsOf(byId.get(node.via), guard + 1);
  };
  return nodes.map((n) => ({ ...n, hops: hopsOf(n) }));
}
