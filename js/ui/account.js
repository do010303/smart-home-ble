'use strict';

import { AuthError, createAuth, passwordStrength } from '../auth.js';

// Tài khoản trong app: nút avatar trên thanh trên cùng, thẻ "Tài khoản" ở Cài đặt,
// đổi tên, đổi mật khẩu, đăng xuất, xoá tài khoản.
export function mountAccount(ctx) {
  const { $, $$ } = ctx;
  const auth = createAuth();

  const initials = (name) => {  // Chữ đầu của từ đầu và từ cuối: "Đỗ Đức Anh" → "ĐA"
    const w = name.trim().split(/\s+/);
    return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');

  function toLogin(flag) {  // Về trang đăng nhập (flag: loggedout | changed)
    location.replace(`login.html?${flag}`);
  }

  function render() {  // Vẽ lại avatar + thẻ tài khoản
    const me = auth.currentUser();
    if (!me) { toLogin('loggedout'); return; }
    $('#account-avatar').textContent = initials(me.name);
    $('#account-name').textContent = me.name;
    $('#acc-avatar').textContent = initials(me.name);
    $('#acc-name').textContent = me.name;
    $('#acc-email').textContent = me.email;
    if (document.activeElement !== $('#acc-name-input')) $('#acc-name-input').value = me.name;
    $('#acc-meta').textContent = `Tham gia ${fmtDate(me.createdAt)}` +
      (me.passwordChangedAt ? ` · Đổi mật khẩu lần cuối ${fmtDate(me.passwordChangedAt)}` : '');
  }

  function clearErrors(form) {
    $$('.field-error', form).forEach((e) => { e.textContent = ''; });
    $$('.has-error', form).forEach((f) => f.classList.remove('has-error'));
    form.querySelector('.form-alert').hidden = true;
  }

  function showError(form, err) {  // Gắn lỗi vào ô tương ứng
    const input = err.field && form.elements[err.field];
    if (input) {
      const field = input.closest('.field');
      field.classList.add('has-error');
      field.querySelector('.field-error').textContent = err.message;
      input.focus();
    } else {
      const alert = form.querySelector('.form-alert');
      alert.textContent = err.message;
      alert.hidden = false;
    }
  }

  function bindDialogForm(dialog, form, handler) {  // Submit → handler; lỗi AuthError hiện trên form
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await handler(Object.fromEntries(new FormData(form)));
      } catch (err) {
        showError(form, err instanceof AuthError ? err : new AuthError('Có lỗi xảy ra, hãy thử lại'));
      } finally {
        btn.disabled = false;
      }
    });
    form.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  function openDialog(dialog, form) {  // Mở hộp thoại với form trống
    form.reset();
    clearErrors(form);
    $$('.pw-meter', form).forEach((m) => { m.dataset.strength = 0; });
    dialog.showModal();
    form.querySelector('input')?.focus();
  }

  // Avatar trên thanh trên cùng → Cài đặt, cuộn tới thẻ tài khoản.
  $('#account-btn').addEventListener('click', () => {
    ctx.setView('settings');
    $('#account-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#btn-save-name').addEventListener('click', () => {
    try {
      auth.updateProfile({ name: $('#acc-name-input').value });
      render();
      ctx.toast('Đã lưu tên hiển thị');
    } catch (err) { ctx.toast(err.message); }
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!(await ctx.confirmAsk('Đăng xuất?', 'Bạn sẽ quay về trang đăng nhập. Trạng thái đèn vẫn được giữ.', 'Đăng xuất'))) return;
    auth.logout();
    toLogin('loggedout');
  });

  // Đổi mật khẩu
  const pwDialog = $('#password-dialog');
  const pwForm = $('#password-form');
  $('#btn-change-pw').addEventListener('click', () => openDialog(pwDialog, pwForm));
  const meter = pwForm.querySelector('.pw-meter');
  pwForm.elements.next.addEventListener('input', (e) => { meter.dataset.strength = e.target.value ? Math.max(1, passwordStrength(e.target.value)) : 0; });
  bindDialogForm(pwDialog, pwForm, async (d) => {
    await auth.changePassword({ current: d.current, next: d.next, confirm: d.confirm });
    pwDialog.close();
    if (d.relogin === 'on') { auth.logout(); toLogin('changed'); return; }
    render();
    ctx.toast('Đã đổi mật khẩu');
  });

  // Xoá tài khoản
  const delDialog = $('#delete-account-dialog');
  const delForm = $('#delete-account-form');
  $('#btn-delete-account').addEventListener('click', () => openDialog(delDialog, delForm));
  bindDialogForm(delDialog, delForm, async (d) => {
    await auth.deleteAccount(d.password);
    toLogin('loggedout');
  });

  // Đăng xuất ở tab khác → tab này cũng về trang đăng nhập.
  window.addEventListener('storage', (e) => { if (e.key === null || e.key.startsWith('homemesh-session')) render(); });

  render();
  return { render };
}
