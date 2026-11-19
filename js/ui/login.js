'use strict';

import { AuthError, DEMO_ACCOUNT, RESET_MINUTES, createAuth, passwordStrength } from '../auth.js';

// Trang login.html: đăng nhập, đăng ký, quên mật khẩu (gửi mã → đặt lại).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const auth = createAuth();
let resetEmail = '';      // Email đang đặt lại mật khẩu
let resendTimer = null;   // Đếm ngược nút "Gửi lại"

function nextUrl() {  // Quay về đúng trang trước khi bị chuyển sang đăng nhập (chỉ nhận ?… hoặc #…)
  const next = new URLSearchParams(location.search).get('next') || '';
  return 'index.html' + (/^[?#]/.test(next) ? next : '');
}

function toast(message) {  // Thông báo ngắn
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function showPane(name) {  // Chuyển form: login | register | forgot | reset
  $$('.auth-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  const tabbed = name === 'login' || name === 'register';
  $('#auth-tabs').hidden = !tabbed;
  $$('#auth-tabs [data-pane]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === name)));
  const pane = $(`#pane-${name}`);
  clearErrors(pane);
  pane.querySelector('input:not([type=checkbox])')?.focus();
  history.replaceState(null, '', `#${name}`);
}

function clearErrors(form) {
  $$('.field-error', form).forEach((e) => { e.textContent = ''; });
  $$('.field.has-error', form).forEach((f) => f.classList.remove('has-error'));
  const alert = $('.form-alert', form);
  alert.hidden = true;
  alert.className = 'form-alert';
}

function showError(form, err) {  // Lỗi gắn vào đúng ô nếu biết field, không thì hiện ở đầu form
  const input = err.field && form.elements[err.field];
  if (input) {
    const field = input.closest('.field');
    field.classList.add('has-error');
    field.querySelector('.field-error').textContent = err.message;
    input.focus();
  } else {
    const alert = $('.form-alert', form);
    alert.textContent = err.message;
    alert.hidden = false;
  }
}

function showNotice(form, message) {  // Thông báo xanh ở đầu form
  const alert = $('.form-alert', form);
  alert.textContent = message;
  alert.className = 'form-alert ok';
  alert.hidden = false;
}

// Bọc submit: chặn bấm hai lần, bắt AuthError, hiện lỗi.
function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      if (err instanceof AuthError) showError(form, err);
      else { console.error(err); showError(form, new AuthError('Có lỗi xảy ra, hãy thử lại')); }
    } finally {
      btn.disabled = false;
    }
  });
}

function sendCode(email) {  // Tạo mã và hiện trong hộp thư giả lập
  const { code, expiresAt } = auth.requestReset(email);
  resetEmail = email;
  $('#reset-sent').textContent = `Nếu ${email.trim()} có tài khoản, mã 6 số đã được gửi tới email đó.`;
  $('#mail-sim').hidden = !code;
  if (code) {
    $('#mail-code').textContent = code;
    $('#mail-expire').textContent = `Hết hạn lúc ${new Date(expiresAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (${RESET_MINUTES} phút)`;
  }
  startResendCountdown();
}

function startResendCountdown(seconds = 30) {  // Khoá nút "Gửi lại" 30 giây
  const btn = $('#resend');
  clearInterval(resendTimer);
  let left = seconds;
  const tick = () => {
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Gửi lại (${left}s)` : 'Gửi lại';
    left -= 1;
    if (left < 0) clearInterval(resendTimer);
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

function bindPasswordUi() {  // Nút Hiện/Ẩn mật khẩu và thanh độ mạnh
  $$('.pw-toggle').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Ẩn' : 'Hiện';
    btn.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  }));
  $$('.pw-meter').forEach((meter) => {
    const input = meter.closest('.field').querySelector('input');
    input.addEventListener('input', () => { meter.dataset.strength = input.value ? Math.max(1, passwordStrength(input.value)) : 0; });
  });
}

async function init() {
  if (auth.currentUser()) { location.replace(nextUrl()); return; }
  await auth.ensureDemoAccount().catch(() => { /* không có crypto.subtle: form sẽ báo lỗi khi gửi */ });

  $$('#auth-tabs [data-pane]').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.goto)));
  bindPasswordUi();

  $('#fill-demo').addEventListener('click', () => {
    const f = $('#pane-login');
    f.elements.email.value = DEMO_ACCOUNT.email;
    f.elements.password.value = DEMO_ACCOUNT.password;
    $('button[type=submit]', f).focus();
  });

  onSubmit($('#pane-login'), async (d) => {
    const user = await auth.login({ email: d.email, password: d.password, remember: d.remember === 'on' });
    toast(`Xin chào, ${user.name}`);
    location.replace(nextUrl());
  });

  onSubmit($('#pane-register'), async (d) => {
    await auth.register(d);
    location.replace(nextUrl());
  });

  onSubmit($('#pane-forgot'), async (d) => {
    sendCode(d.email);
    const reset = $('#pane-reset');
    reset.reset();
    showPane('reset');
  });

  onSubmit($('#pane-reset'), async (d) => {
    await auth.resetPassword({ email: resetEmail, code: d.code, password: d.password, confirm: d.confirm });
    location.replace(nextUrl());
  });

  $('#resend').addEventListener('click', () => {
    sendCode(resetEmail);
    showNotice($('#pane-reset'), 'Đã gửi mã mới. Mã cũ không còn dùng được.');
  });

  // Mở đúng form theo #hash (vd. login.html#forgot); đăng xuất xong thì báo.
  const start = location.hash.slice(1);
  showPane(['register', 'forgot'].includes(start) ? start : 'login');
  if (new URLSearchParams(location.search).has('loggedout')) showNotice($('#pane-login'), 'Bạn đã đăng xuất.');
  if (new URLSearchParams(location.search).has('changed')) showNotice($('#pane-login'), 'Đã đổi mật khẩu. Hãy đăng nhập lại.');
}

init();
