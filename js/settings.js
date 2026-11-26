'use strict';

import { LOAD_PROFILES, PATHS } from './mesh.js';
import { validateLayout } from './layout.js';

export const APP_VERSION = '2.0.0';
export const SETTINGS_KEY = 'homemesh-settings-v1';
export const BACKUP_FORMAT = 'homemesh-backup';

export const DEFAULT_SETTINGS = Object.freeze({  // Giá trị cài đặt mặc định
  theme: 'system',            // system | dark | light
  gatewayName: 'GW-01',
  gatewayHost: '192.168.1.100',
  gatewayPort: 8080,
  gatewayMac: 'A4:C1:38:5E:00:01',
  defaultPath: 'local',
  autoFallback: true,         // Gateway offline → tự chuyển BLE Proxy
  targetLatencyMs: 50,
  ttl: 3,
  throttleMs: 60,
  loadProfile: 'normal',
  attentionSeconds: 5,
  animations: true
});

// Giới hạn cho từng trường số: [min, max].
export const SETTING_RANGES = Object.freeze({
  gatewayPort: [1, 65535],
  targetLatencyMs: [10, 500],
  ttl: [2, 7],
  throttleMs: [20, 500],
  attentionSeconds: [1, 30]
});

const THEMES = ['system', 'dark', 'light'];  // Các chủ đề hợp lệ
const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;
export const MAC_RE = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;

const clampInt = (value, [min, max], fallback) => {  // Làm tròn và kẹp số nguyên
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Nhận dữ liệu bất kỳ (localStorage, file nhập), trả về cài đặt hợp lệ đủ trường.
export function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const out = { ...d };

  if (THEMES.includes(src.theme)) out.theme = src.theme;
  if (typeof src.gatewayName === 'string' && src.gatewayName.trim()) out.gatewayName = src.gatewayName.trim().slice(0, 32);
  if (typeof src.gatewayHost === 'string' && HOST_RE.test(src.gatewayHost.trim())) out.gatewayHost = src.gatewayHost.trim();
  if (typeof src.gatewayMac === 'string' && MAC_RE.test(src.gatewayMac.trim())) out.gatewayMac = src.gatewayMac.trim().toUpperCase().replace(/-/g, ':');
  if (src.defaultPath in PATHS) out.defaultPath = src.defaultPath;
  if (src.loadProfile in LOAD_PROFILES) out.loadProfile = src.loadProfile;
  if (typeof src.autoFallback === 'boolean') out.autoFallback = src.autoFallback;
  if (typeof src.animations === 'boolean') out.animations = src.animations;

  for (const [key, range] of Object.entries(SETTING_RANGES)) {
    if (key in src) out[key] = clampInt(src[key], range, d[key]);
  }
  return out;
}

export function gatewayBaseUrl(settings) {  // http://<host>:<port>
  return `http://${settings.gatewayHost}:${settings.gatewayPort}`;
}

// File sao lưu: cài đặt + danh sách đèn + sơ đồ nhà (không gồm số liệu đo).
export function buildBackup({ settings, lights, layout = null, now = new Date() }) {
  return {
    format: BACKUP_FORMAT,
    version: APP_VERSION,
    exportedAt: now.toISOString(),
    settings,
    ...(layout ? { layout } : {}),
    lights: lights.map(({ hops, rssi, ping, lastPacket, identifyUntil, ...rest }) => rest)
  };
}

const LIGHT_FIELDS = ['id', 'name', 'room', 'unicast', 'watts', 'via'];  // Trường bắt buộc của đèn trong file sao lưu

// Đọc file sao lưu. Trả về { ok, settings, lights, layout } hoặc { ok: false, error }.
// File có sơ đồ nhà (bản 2.0) → phòng của đèn kiểm theo sơ đồ đó; file cũ → theo validRooms.
export function parseBackup(text, validRooms) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return { ok: false, error: 'File không phải JSON hợp lệ.' };
  }
  if (!data || data.format !== BACKUP_FORMAT) return { ok: false, error: 'Không phải file sao lưu HomeMesh.' };
  if (!Array.isArray(data.lights) || data.lights.length === 0) return { ok: false, error: 'File không có danh sách đèn.' };
  let layout = null;
  if (data.layout !== undefined) {
    const errors = validateLayout(data.layout);
    if (errors.length) return { ok: false, error: `Sơ đồ nhà trong file lỗi: ${errors[0]}.` };
    layout = data.layout;
    validRooms = layout.rooms.map((r) => r.id);
  }

  const ids = new Set();
  for (const l of data.lights) {
    const missing = LIGHT_FIELDS.filter((f) => l?.[f] === undefined);
    if (missing.length) return { ok: false, error: `Đèn thiếu trường: ${missing.join(', ')}.` };
    if (!validRooms.includes(l.room)) return { ok: false, error: `Phòng không hợp lệ: ${l.room}.` };
    if (ids.has(l.id)) return { ok: false, error: `Trùng ID đèn: ${l.id}.` };
    ids.add(l.id);
  }
  return { ok: true, settings: sanitizeSettings(data.settings), lights: data.lights, layout };
}

// Theme thật sự áp dụng khi chọn "system".
export function resolveTheme(theme, prefersDark) {
  if (theme === 'dark' || theme === 'light') return theme;
  return prefersDark ? 'dark' : 'light';
}
