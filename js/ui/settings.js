'use strict';

import { ROOMS } from '../data.js';
import { APP_VERSION, buildBackup, parseBackup } from '../settings.js';

// Màn hình Cài đặt: giao diện, gateway, tham số mesh, sao lưu / khôi phục, cài app (PWA).
export function mountSettings(ctx) {
  const { $, $$, state } = ctx;
  let installPrompt = null;

  function render() {  // Vẽ lại màn hình này (app.js gọi khi mở / khi dữ liệu đổi)
    const s = state.settings;
    $$('#settings-form [data-setting]').forEach((el) => {
      const value = s[el.dataset.setting];
      if (document.activeElement === el) return;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    });
    $$('#set-theme [data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === s.theme)));
    const far = state.lights.filter((l) => l.hops > s.ttl).length;
    $('#ttl-hint').textContent = far
      ? `TTL ${s.ttl}: ${far} đèn ở xa hơn ${s.ttl} hop sẽ không nhận được lệnh.`
      : `TTL ${s.ttl}: gói tin đi tối đa ${s.ttl} hop — mọi đèn hiện tại đều trong tầm.`;
    $('#ttl-hint').className = `small ${far ? 'lat-bad' : 'muted'}`;
    $('#app-version').textContent = `v${APP_VERSION}`;
    $('#btn-install').hidden = !installPrompt;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
    $('#install-hint').textContent = standalone
      ? 'Đang chạy như ứng dụng đã cài.'
      : installPrompt ? '' : 'Cài lên điện thoại: mở menu trình duyệt → “Thêm vào Màn hình chính”.';
  }

  function onChange(e) {  // Một ô cài đặt đổi → updateSettings
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const key = el.dataset.setting;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    const before = state.settings[key];
    const after = ctx.updateSettings({ [key]: value })[key];
    if (el.type !== 'checkbox') el.value = after;
    if (after !== before) ctx.toast('Đã lưu cài đặt');
    else if (String(value) !== String(after)) ctx.toast('Giá trị không hợp lệ — giữ nguyên');
  }

  function backup() {  // Tải file sao lưu
    const data = buildBackup({ settings: state.settings, lights: state.lights, layout: state.layout });
    ctx.downloadJson(data, `homemesh-backup-${new Date().toISOString().slice(0, 10)}.json`);
    ctx.toast(`Đã sao lưu ${state.lights.length} đèn, sơ đồ nhà và cài đặt`);
  }

  async function restore(file) {  // Khôi phục từ file
    if (!file) return;
    const text = await file.text();
    const result = parseBackup(text, ROOMS.map((r) => r.id));
    if (!result.ok) { ctx.toast(`Không khôi phục được: ${result.error}`); return; }
    const ok = await ctx.confirmAsk(
      'Khôi phục từ file?',
      `Thay toàn bộ ${state.lights.length} đèn hiện tại bằng ${result.lights.length} đèn trong file, kèm cài đặt${result.layout ? ' và sơ đồ nhà' : ''}.`,
      'Khôi phục'
    );
    if (!ok) return;
    ctx.updateSettings(result.settings);
    if (result.layout) ctx.replaceLayout(result.layout);
    ctx.replaceLights(result.lights);
    ctx.toast(`Đã khôi phục ${result.lights.length} đèn`);
  }

  async function factoryReset() {  // Khôi phục mặc định
    const ok = await ctx.confirmAsk(
      'Khôi phục mặc định?',
      'Xoá mọi đèn đã thêm, sơ đồ nhà, cài đặt và số liệu đo trong trình duyệt này, đưa về căn hộ mẫu với 8 đèn.',
      'Khôi phục mặc định'
    );
    if (!ok) return;
    ctx.resetAll();
    render();
    ctx.toast('Đã đưa ứng dụng về mặc định');
  }

  $('#settings-form').addEventListener('change', onChange);
  $('#set-theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-choice]');
    if (b) ctx.updateSettings({ theme: b.dataset.themeChoice });
  });
  $('#btn-backup').addEventListener('click', backup);
  $('#import-file').addEventListener('change', (e) => { restore(e.target.files[0]); e.target.value = ''; });
  $('#btn-clear-metrics').addEventListener('click', () => { ctx.clearMetrics(); ctx.toast('Đã xoá số liệu đo và nhật ký'); });
  $('#btn-factory').addEventListener('click', factoryReset);
  $('#btn-share').addEventListener('click', () => ctx.copyText(location.origin + location.pathname, 'Đã sao chép link — gửi cho người khác để mở demo'));
  $('#btn-show-welcome').addEventListener('click', ctx.showWelcome);

  // Mạng & gateway: kiểm tra địa chỉ, MAC, REST API và các node mesh.
  $('#btn-check-gateway').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const list = $('#check-list');
    btn.disabled = true;
    list.innerHTML = '<li class="muted small"><span class="spinner" aria-hidden="true"></span>Đang kiểm tra gateway…</li>';
    await new Promise((r) => setTimeout(r, 450));
    const checks = ctx.checkGateway();
    list.innerHTML = checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">
      <span class="check-icon" aria-hidden="true">${c.ok ? '✓' : '!'}</span>
      <div><b>${ctx.escapeHtml(c.label)}</b><small>${ctx.escapeHtml(c.detail)}</small></div></li>`).join('');
    const failed = checks.filter((c) => !c.ok).length;
    ctx.toast(failed ? `Kiểm tra xong: ${failed} mục cần xem lại` : 'Gateway hoạt động bình thường');
    btn.disabled = false;
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    render();
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    render();
  });

  return { render };
}
