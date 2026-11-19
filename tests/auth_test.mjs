import assert from 'node:assert/strict';
import {
  AuthError, DEMO_ACCOUNT, LOGIN_MAX_FAILS, RESET_KEY, SESSION_KEY, USERS_KEY,
  createAuth, hasSession, passwordStrength, validateEmail, validatePassword
} from '../js/auth.js';

// Test tài khoản: chạy bằng `node tests/auth_test.mjs` (Node 20 có sẵn crypto.subtle).
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`✓ ${name}`); };

const store = () => {  // localStorage / sessionStorage giả
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const setup = () => {
  const local = store(); const session = store();
  const clock = { t: Date.UTC(2026, 10, 19, 8) };
  const auth = createAuth({ local, session, now: () => clock.t });
  return { auth, local, session, clock };
};
const rejects = (p, field) => assert.rejects(p, (e) => e instanceof AuthError && (!field || e.field === field));
const user = { name: 'Đỗ Đức Anh', email: 'Anh@Example.com', password: 'matkhau123', confirm: 'matkhau123' };

await test('Kiểm tra email và mật khẩu', () => {
  assert.equal(validateEmail('a@b.vn'), '');
  assert.notEqual(validateEmail('a@b'), '');
  assert.notEqual(validatePassword('abc12'), '');
  assert.notEqual(validatePassword('chuachuaso'), '');
  assert.equal(validatePassword('homemesh123'), '');
  assert.ok(passwordStrength('Abc!12345678') > passwordStrength('abc12345'));
});

await test('Đăng ký: lưu hash + salt, không lưu mật khẩu thô, tự đăng nhập', async () => {
  const { auth, local } = setup();
  const me = await auth.register(user);
  assert.equal(me.email, 'anh@example.com');
  const raw = local.getItem(USERS_KEY);
  assert.ok(!raw.includes(user.password));
  const saved = JSON.parse(raw).users[0];
  assert.match(saved.hash, /^[0-9a-f]{64}$/);
  assert.match(saved.salt, /^[0-9a-f]{32}$/);
  assert.equal(auth.currentUser().id, me.id);
});

await test('Đăng ký: email trùng (khác hoa thường) và mật khẩu nhập lại sai bị từ chối', async () => {
  const { auth } = setup();
  await auth.register(user);
  await rejects(auth.register({ ...user, email: 'ANH@example.com' }), 'email');
  await rejects(auth.register({ ...user, email: 'b@x.vn', confirm: 'khac12345' }), 'confirm');
});

await test('Đăng nhập đúng / sai; "Ghi nhớ" lưu phiên vào localStorage', async () => {
  const { auth, local, session } = setup();
  await auth.register(user);
  auth.logout();
  assert.equal(auth.currentUser(), null);
  await rejects(auth.login({ email: user.email, password: 'sai123456' }), 'password');
  await rejects(auth.login({ email: 'khong@co.vn', password: 'x' }), 'password');
  await auth.login({ email: 'anh@example.com', password: user.password });
  assert.ok(session.getItem(SESSION_KEY) && !local.getItem(SESSION_KEY));
  await auth.login({ email: user.email, password: user.password, remember: true });
  assert.ok(local.getItem(SESSION_KEY) && !session.getItem(SESSION_KEY));
  assert.ok(hasSession(local, session, Date.UTC(2026, 10, 20)));
});

await test('Phiên hết hạn sau 12 giờ', async () => {
  const { auth, clock } = setup();
  await auth.register(user);
  clock.t += 11 * 3600e3;
  assert.ok(auth.currentUser());
  clock.t += 2 * 3600e3;
  assert.equal(auth.currentUser(), null);
});

await test(`Sai mật khẩu ${LOGIN_MAX_FAILS} lần → khoá 5 phút`, async () => {
  const { auth, clock } = setup();
  await auth.register(user);
  for (let i = 0; i < LOGIN_MAX_FAILS; i += 1) await rejects(auth.login({ email: user.email, password: 'sai123456' }));
  await assert.rejects(auth.login({ email: user.email, password: user.password }), /Thử lại sau/);
  clock.t += 5 * 60e3 + 1;
  await auth.login({ email: user.email, password: user.password });
});

await test('Quên mật khẩu: mã 6 số, sai mã đếm lượt, đúng mã đặt lại được', async () => {
  const { auth, local } = setup();
  await auth.register(user);
  auth.logout();
  assert.equal(auth.requestReset('khong@co.vn').code, null);
  const { code } = auth.requestReset(user.email);
  assert.match(code, /^\d{6}$/);
  const wrong = code === '000000' ? '111111' : '000000';
  await rejects(auth.resetPassword({ email: user.email, code: wrong, password: 'moimoi123' }), 'code');
  assert.equal(JSON.parse(local.getItem(RESET_KEY)).tries, 1);
  await auth.resetPassword({ email: user.email, code, password: 'moimoi123', confirm: 'moimoi123' });
  assert.equal(local.getItem(RESET_KEY), null);
  auth.logout();
  await rejects(auth.login({ email: user.email, password: user.password }));
  await auth.login({ email: user.email, password: 'moimoi123' });
});

await test('Mã khôi phục hết hạn sau 10 phút, sai 5 lần thì huỷ', async () => {
  const { auth, clock } = setup();
  await auth.register(user);
  let { code } = auth.requestReset(user.email);
  clock.t += 10 * 60e3 + 1;
  assert.throws(() => auth.verifyResetCode(user.email, code), /hết hạn/);
  ({ code } = auth.requestReset(user.email));
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i += 1) assert.throws(() => auth.verifyResetCode(user.email, wrong), /còn/);
  assert.throws(() => auth.verifyResetCode(user.email, wrong), /quá nhiều/);
  assert.throws(() => auth.verifyResetCode(user.email, code), /Chưa yêu cầu/);
});

await test('Đổi mật khẩu: cần mật khẩu cũ đúng, mới phải khác cũ', async () => {
  const { auth } = setup();
  await auth.register(user);
  await rejects(auth.changePassword({ current: 'sai123456', next: 'moimoi123' }), 'current');
  await rejects(auth.changePassword({ current: user.password, next: user.password }), 'next');
  await rejects(auth.changePassword({ current: user.password, next: 'moimoi123', confirm: 'x' }), 'confirm');
  await auth.changePassword({ current: user.password, next: 'moimoi123', confirm: 'moimoi123' });
  assert.ok(auth.currentUser().passwordChangedAt);
  auth.logout();
  await auth.login({ email: user.email, password: 'moimoi123' });
});

await test('Đổi tên, xoá tài khoản, tài khoản demo', async () => {
  const { auth } = setup();
  assert.equal(await auth.ensureDemoAccount(), true);
  assert.equal(await auth.ensureDemoAccount(), false);
  await auth.login({ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password });
  assert.equal(auth.updateProfile({ name: '  Nhóm 5 ' }).name, 'Nhóm 5');
  await rejects(auth.deleteAccount('sai123456'), 'password');
  await auth.deleteAccount(DEMO_ACCOUNT.password);
  assert.equal(auth.currentUser(), null);
  assert.equal(auth.userCount(), 0);
});

console.log(`\n${passed} test tài khoản passed.`);
