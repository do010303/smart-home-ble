'use strict';

import { percentToLightnessActual, clampKelvin } from './cct.js';
import {
  encodeAttentionSet, encodeLightCtlSet, encodeLightnessSet, encodeOnOffGet, encodeOnOffSet,
  encodeSceneRecall, opcodeName, segmentsNeeded, toHex
} from './mesh.js';

// Các lệnh có thể thử. `params` = trường cần nhập; `ackable` = có bản Ack/Unack.
export const TEST_COMMANDS = Object.freeze([
  { id: 'onoff', label: 'Bật / tắt (Generic OnOff Set)', params: ['on'], ackable: true },
  { id: 'toggle', label: 'Đảo trạng thái mỗi lần (OnOff Set)', params: [], ackable: true },
  { id: 'lightness', label: 'Độ sáng (Light Lightness Set)', params: ['lightness'], ackable: true },
  { id: 'ctl', label: 'Độ sáng + màu (Light CTL Set)', params: ['lightness', 'kelvin'], ackable: true },
  { id: 'sweep', label: 'Quét màu 2700 → 6500 K (CTL Set)', params: ['lightness'], ackable: true },
  { id: 'scene', label: 'Gọi cảnh (Scene Recall)', params: ['scene'], ackable: true },
  { id: 'get', label: 'Đọc trạng thái (Generic OnOff Get)', params: [], ackable: false },
  { id: 'identify', label: 'Nháy nhận diện (Health Attention Set)', params: ['seconds'], ackable: true }
]);

export const commandById = (id) => TEST_COMMANDS.find((c) => c.id === id);

// Giá trị của lần chạy thứ `i` (0-based) trong `count` lần — dùng cho toggle và sweep.
export function paramsForIteration(command, params, i, count, startOn = false) {
  if (command === 'toggle') return { ...params, on: i % 2 === 0 ? !startOn : startOn };
  if (command === 'sweep') {
    const t = count <= 1 ? 0 : i / (count - 1);
    return { ...params, kelvin: clampKelvin(2700 + t * (6500 - 2700)) };
  }
  return params;
}

// Mã hoá lệnh thành access payload. Get luôn có phản hồi (Status).
export function buildCommand(command, params, { tid, ack }) {
  switch (command) {
    case 'onoff':
    case 'toggle':
      return encodeOnOffSet({ on: !!params.on, tid, ack });
    case 'lightness':
      return encodeLightnessSet({ lightness: percentToLightnessActual(params.lightness), tid, ack });
    case 'ctl':
    case 'sweep':
      return encodeLightCtlSet({
        lightness: percentToLightnessActual(params.lightness),
        temperature: clampKelvin(params.kelvin ?? 4000),
        tid,
        ack
      });
    case 'scene':
      return encodeSceneRecall({ scene: Number(params.scene), tid, ack });
    case 'get':
      return encodeOnOffGet();
    case 'identify':
      return encodeAttentionSet({ seconds: Number(params.seconds), ack });
    default:
      throw new Error(`Lệnh không hỗ trợ: ${command}`);
  }
}

// Lệnh có chờ Status trả về không.
export function expectsStatus(command, ack) {
  return command === 'get' || (ack && commandById(command)?.ackable);
}

export function describePacket(bytes) {
  return {
    opcode: opcodeName(bytes),
    hex: toHex(bytes),
    bytes: bytes.length,
    segments: segmentsNeeded(bytes.length)
  };
}

// Trạng thái đèn sau lệnh (null = lệnh không đổi trạng thái).
export function statePatch(command, params) {
  switch (command) {
    case 'onoff':
    case 'toggle':
      return { on: !!params.on };
    case 'lightness':
      return { on: true, lightness: params.lightness };
    case 'ctl':
    case 'sweep':
      return { on: true, lightness: params.lightness, kelvin: clampKelvin(params.kelvin) };
    default:
      return null;
  }
}
