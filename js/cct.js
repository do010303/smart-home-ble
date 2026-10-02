'use strict';

// Thông số phần cứng LED của MVP: 2 kênh LED trắng ấm + trắng lạnh (tunable white).
export const LED_SPEC = Object.freeze({
  warmK: 2700,
  coolK: 6500,
  minK: 2700,
  maxK: 6500,
  ratedWatts: [12, 18],
  standbyWatts: 0.3
});

export const CCT_PRESETS = Object.freeze([
  { kelvin: 2700, label: 'Ấm', hint: 'Thư giãn, buổi tối' },
  { kelvin: 3000, label: 'Vàng nhạt', hint: 'Phòng ngủ' },
  { kelvin: 4000, label: 'Trung tính', hint: 'Phòng khách, bếp' },
  { kelvin: 5000, label: 'Trắng', hint: 'Đọc sách' },
  { kelvin: 6500, label: 'Ánh ngày', hint: 'Làm việc, tập trung' }
]);

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function clampKelvin(kelvin) {
  return Math.round(clamp(Number(kelvin), LED_SPEC.minK, LED_SPEC.maxK));
}

// Xấp xỉ màu hiển thị của nhiệt độ màu (thuật toán Tanner Helland, sai số < 1% trong 1000–40000K).
// Chỉ dùng để hiển thị trên màn hình; driver thực không cần RGB.
export function kelvinToRgb(kelvin) {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r;
  let g;
  let b;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255))
  };
}

export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function kelvinToHex(kelvin) {
  return rgbToHex(kelvinToRgb(kelvin));
}

// Gradient CSS cho thanh trượt dải màu 2700K → 6500K.
export function cctGradient(steps = 8) {
  const stops = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = LED_SPEC.minK + ((LED_SPEC.maxK - LED_SPEC.minK) * i) / steps;
    stops.push(`${kelvinToHex(k)} ${Math.round((i / steps) * 100)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function kelvinLabel(kelvin) {
  if (kelvin < 3200) return 'Trắng ấm';
  if (kelvin < 4500) return 'Trung tính';
  if (kelvin < 5600) return 'Trắng';
  return 'Ánh sáng ngày';
}

// BLE Mesh Light Lightness là thang cảm nhận (perceptual). Driver PWM cần giá trị tuyến tính:
// Lightness Linear = Actual² / 65535 (Mesh Model spec, Light Lightness).
export function percentToLightnessActual(percent) {
  return Math.round((clamp(percent, 0, 100) / 100) * 65535);
}

export function lightnessActualToLinear(actual) {
  return Math.round((actual * actual) / 65535);
}

// Trộn 2 kênh theo thang mired (1e6/K) để chuyển màu mượt theo cảm nhận mắt người.
// Tổng duty 2 kênh = độ sáng tuyến tính → công suất không đổi khi đổi màu.
export function cctToChannels(kelvin, lightnessPercent, spec = LED_SPEC) {
  const k = clamp(kelvin, spec.warmK, spec.coolK);
  const mWarm = 1e6 / spec.warmK;
  const mCool = 1e6 / spec.coolK;
  const coolRatio = (mWarm - 1e6 / k) / (mWarm - mCool);
  const linear = lightnessActualToLinear(percentToLightnessActual(lightnessPercent)) / 65535;

  return {
    coolRatio,
    warmDuty: linear * (1 - coolRatio),
    coolDuty: linear * coolRatio,
    linear
  };
}

export function estimatePowerW(ratedW, on, lightnessPercent, spec = LED_SPEC) {
  if (!on) return spec.standbyWatts;
  const { linear } = cctToChannels(spec.warmK, lightnessPercent, spec);
  return Math.round((spec.standbyWatts + ratedW * linear) * 10) / 10;
}
