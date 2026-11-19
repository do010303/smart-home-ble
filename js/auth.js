'use strict';

// Tài khoản người dùng: đăng ký, đăng nhập, quên / đổi mật khẩu.
// Chưa có server nên tài khoản lưu dạng JSON trong localStorage; mật khẩu không lưu thô
// mà băm PBKDF2-SHA256 (100 000 vòng) với salt ngẫu nhiên riêng từng người.
// Module không đụng DOM: nhận storage qua tham số để test được bằng Node.

export const USERS_KEY = 'homemesh-users-v1';      // { users: [...] }
export const SESSION_KEY = 'homemesh-session-v1';  // { userId, expiresAt }
export const RESET_KEY = 'homemesh-reset-v1';      // mã khôi phục đang chờ

export const SESSION_HOURS = 12;        // Phiên thường (không "Ghi nhớ")
export const REMEMBER_DAYS = 30;        // Phiên khi chọn "Ghi nhớ đăng nhập"
export const RESET_MINUTES = 10;        // Mã khôi phục hết hạn sau 10 phút
export const RESET_MAX_TRIES = 5;       // Nhập sai mã 5 lần → huỷ mã
export const LOGIN_MAX_FAILS = 5;       // Sai mật khẩu 5 lần → khoá tạm
export const LOCK_MINUTES = 5;
const PBKDF2_ITERATIONS = 100000;

export const DEMO_ACCOUNT = Object.freeze({  // Tài khoản có sẵn để trình bày
  name: 'Người dùng demo',
  email: 'demo@homemesh.vn',
  password: 'homemesh123'
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class AuthError extends Error {  // Lỗi có thông báo tiếng Việt để hiện thẳng lên form
  constructor(message, field = '') {
    super(message);
    this.name = 'AuthError';
    this.field = field;  // Ô nhập liên quan: email | password | code | name | current | next
  }
}

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();  // So email không phân biệt hoa thường

export function validateEmail(email) {  // '' nếu hợp lệ, ngược lại là câu báo lỗi
  return EMAIL_RE.test(normalizeEmail(email)) ? '' : 'Email không hợp lệ';
}

export function validatePassword(password) {  // Ít nhất 8 ký tự, có chữ và số
  const p = String(password ?? '');
  if (p.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự';
  if (p.length > 128) return 'Mật khẩu quá dài';
  if (!/[A-Za-zÀ-ỹ]/.test(p) || !/\d/.test(p)) return 'Mật khẩu cần có cả chữ và số';
  return '';
}

export function passwordStrength(password) {  // 0–4 cho thanh độ mạnh
  const p = String(password ?? '');
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 12) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score += 1;
  return score;
}

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {  // PBKDF2-SHA256 → hex 64 ký tự
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new AuthError('Trình duyệt không hỗ trợ mã hoá (cần https hoặc localhost)');
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

function safeEqual(a, b) {  // So chuỗi không dừng sớm (tránh đoán theo thời gian)
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function memoryStorage() {  // Storage giả trong bộ nhớ khi trình duyệt chặn localStorage
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

// Tạo bộ quản lý tài khoản. local: nơi lưu tài khoản + phiên "Ghi nhớ"; session: phiên thường.
export function createAuth({
  local = globalThis.localStorage ?? memoryStorage(),
  session = globalThis.sessionStorage ?? memoryStorage(),
  now = () => Date.now(),
  randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
} = {}) {
  const read = (store, key) => {  // Đọc JSON, hỏng thì trả null
    try { return JSON.parse(store.getItem(key)); } catch { return null; }
  };
  const write = (store, key, value) => store.setItem(key, JSON.stringify(value));

  const users = () => {  // Danh sách tài khoản
    const data = read(local, USERS_KEY);
    return Array.isArray(data?.users) ? data.users : [];
  };
  const saveUsers = (list) => write(local, USERS_KEY, { format: 'homemesh-users', version: 1, users: list });
  const findByEmail = (email) => users().find((u) => u.email === normalizeEmail(email)) ?? null;
  const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, passwordChangedAt: u.passwordChangedAt };

  function updateUser(id, patch) {  // Sửa một tài khoản rồi lưu
    const list = users().map((u) => (u.id === id ? { ...u, ...patch } : u));
    saveUsers(list);
    return list.find((u) => u.id === id);
  }

  async function makeSecret(password) {  // Salt mới + hash
    const salt = toHex(randomBytes(16));
    return { salt, hash: await hashPassword(password, salt) };
  }

  async function checkPassword(user, password) {
    return safeEqual(await hashPassword(password, user.salt), user.hash);
  }

  function startSession(user, remember) {  // Ghi phiên; "Ghi nhớ" → localStorage, không thì sessionStorage
    const hours = remember ? REMEMBER_DAYS * 24 : SESSION_HOURS;
    const data = { userId: user.id, expiresAt: now() + hours * 3600e3, remember: !!remember };
    endSession();
    write(remember ? local : session, SESSION_KEY, data);
    return publicUser(user);
  }

  function endSession() {
    try { session.removeItem(SESSION_KEY); } catch { /* bỏ qua */ }
    try { local.removeItem(SESSION_KEY); } catch { /* bỏ qua */ }
  }

  function currentUser() {  // Người đang đăng nhập, hết hạn / không tồn tại → null
    const s = read(session, SESSION_KEY) ?? read(local, SESSION_KEY);
    if (!s || !(s.expiresAt > now())) return null;
    return publicUser(users().find((u) => u.id === s.userId)) ?? null;
  }

  async function register({ name, email, password, confirm }) {  // Đăng ký → tự đăng nhập
    const cleanName = String(name ?? '').trim();
    if (cleanName.length < 2) throw new AuthError('Nhập họ tên (ít nhất 2 ký tự)', 'name');
    if (validateEmail(email)) throw new AuthError(validateEmail(email), 'email');
    if (findByEmail(email)) throw new AuthError('Email này đã có tài khoản', 'email');
    const err = validatePassword(password);
    if (err) throw new AuthError(err, 'password');
    if (confirm !== undefined && confirm !== password) throw new AuthError('Mật khẩu nhập lại không khớp', 'confirm');
    const user = {
      id: toHex(randomBytes(8)),
      name: cleanName.slice(0, 60),
      email: normalizeEmail(email),
      ...(await makeSecret(password)),
      createdAt: new Date(now()).toISOString(),
      passwordChangedAt: null,
      failedLogins: 0,
      lockedUntil: 0
    };
    saveUsers([...users(), user]);
    return startSession(user, false);
  }

  async function login({ email, password, remember = false }) {  // Đăng nhập, sai 5 lần → khoá 5 phút
    const user = findByEmail(email);
    if (!user) {
      await hashPassword(password ?? '', '00');  // Tốn thời gian như khi có tài khoản
      throw new AuthError('Email hoặc mật khẩu không đúng', 'password');
    }
    if (user.lockedUntil > now()) {
      const min = Math.ceil((user.lockedUntil - now()) / 60e3);
      throw new AuthError(`Sai quá nhiều lần. Thử lại sau ${min} phút hoặc dùng “Quên mật khẩu”`, 'password');
    }
    if (!(await checkPassword(user, password ?? ''))) {
      const fails = (user.failedLogins || 0) + 1;
      const locked = fails >= LOGIN_MAX_FAILS;
      updateUser(user.id, { failedLogins: locked ? 0 : fails, lockedUntil: locked ? now() + LOCK_MINUTES * 60e3 : 0 });
      throw new AuthError(locked
        ? `Sai ${LOGIN_MAX_FAILS} lần, tài khoản bị khoá ${LOCK_MINUTES} phút`
        : `Email hoặc mật khẩu không đúng (còn ${LOGIN_MAX_FAILS - fails} lần thử)`, 'password');
    }
    updateUser(user.id, { failedLogins: 0, lockedUntil: 0, lastLoginAt: new Date(now()).toISOString() });
    return startSession(user, remember);
  }

  // Quên mật khẩu, bước 1: tạo mã 6 số. Chưa có máy chủ email nên trả mã về để trang hiện
  // trong "hộp thư giả lập". Email không có tài khoản → trả code null (trang vẫn báo chung chung).
  function requestReset(email) {
    if (validateEmail(email)) throw new AuthError(validateEmail(email), 'email');
    const user = findByEmail(email);
    if (!user) return { email: normalizeEmail(email), code: null, expiresAt: null };
    const n = randomBytes(4).reduce((acc, b) => acc * 256 + b, 0);
    const code = String(n % 1e6).padStart(6, '0');
    const expiresAt = now() + RESET_MINUTES * 60e3;
    write(local, RESET_KEY, { email: user.email, code, expiresAt, tries: 0 });
    return { email: user.email, code, expiresAt };
  }

  function verifyResetCode(email, code) {  // Bước 2: kiểm mã (chưa đổi mật khẩu)
    const r = read(local, RESET_KEY);
    if (!r || r.email !== normalizeEmail(email)) throw new AuthError('Chưa yêu cầu mã cho email này', 'code');
    if (!(r.expiresAt > now())) { local.removeItem(RESET_KEY); throw new AuthError('Mã đã hết hạn, hãy gửi lại mã', 'code'); }
    if (String(code ?? '').trim() !== r.code) {
      const tries = r.tries + 1;
      if (tries >= RESET_MAX_TRIES) { local.removeItem(RESET_KEY); throw new AuthError('Sai mã quá nhiều lần, hãy gửi lại mã', 'code'); }
      write(local, RESET_KEY, { ...r, tries });
      throw new AuthError(`Mã không đúng (còn ${RESET_MAX_TRIES - tries} lần)`, 'code');
    }
    return true;
  }

  async function resetPassword({ email, code, password, confirm }) {  // Bước 3: đặt mật khẩu mới rồi đăng nhập
    verifyResetCode(email, code);
    const err = validatePassword(password);
    if (err) throw new AuthError(err, 'password');
    if (confirm !== undefined && confirm !== password) throw new AuthError('Mật khẩu nhập lại không khớp', 'confirm');
    const user = findByEmail(email);
    const updated = updateUser(user.id, {
      ...(await makeSecret(password)), passwordChangedAt: new Date(now()).toISOString(), failedLogins: 0, lockedUntil: 0
    });
    local.removeItem(RESET_KEY);
    return startSession(updated, false);
  }

  async function changePassword({ current, next, confirm }) {  // Đổi mật khẩu khi đang đăng nhập
    const me = currentUser();
    if (!me) throw new AuthError('Phiên đăng nhập đã hết, hãy đăng nhập lại');
    const user = users().find((u) => u.id === me.id);
    if (!(await checkPassword(user, current ?? ''))) throw new AuthError('Mật khẩu hiện tại không đúng', 'current');
    const err = validatePassword(next);
    if (err) throw new AuthError(err, 'next');
    if (next === current) throw new AuthError('Mật khẩu mới phải khác mật khẩu cũ', 'next');
    if (confirm !== undefined && confirm !== next) throw new AuthError('Mật khẩu nhập lại không khớp', 'confirm');
    updateUser(user.id, { ...(await makeSecret(next)), passwordChangedAt: new Date(now()).toISOString() });
    return true;
  }

  function updateProfile({ name }) {  // Đổi tên hiển thị
    const me = currentUser();
    if (!me) throw new AuthError('Phiên đăng nhập đã hết, hãy đăng nhập lại');
    const cleanName = String(name ?? '').trim();
    if (cleanName.length < 2) throw new AuthError('Nhập họ tên (ít nhất 2 ký tự)', 'name');
    return publicUser(updateUser(me.id, { name: cleanName.slice(0, 60) }));
  }

  async function deleteAccount(password) {  // Xoá tài khoản đang đăng nhập (cần mật khẩu)
    const me = currentUser();
    if (!me) throw new AuthError('Phiên đăng nhập đã hết, hãy đăng nhập lại');
    const user = users().find((u) => u.id === me.id);
    if (!(await checkPassword(user, password ?? ''))) throw new AuthError('Mật khẩu không đúng', 'password');
    saveUsers(users().filter((u) => u.id !== me.id));
    endSession();
  }

  async function ensureDemoAccount() {  // Tạo sẵn tài khoản demo nếu chưa có ai
    if (users().length) return false;
    saveUsers([{
      id: 'demo', name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email,
      ...(await makeSecret(DEMO_ACCOUNT.password)),
      createdAt: new Date(now()).toISOString(), passwordChangedAt: null, failedLogins: 0, lockedUntil: 0
    }]);
    return true;
  }

  return {
    register, login, logout: endSession, currentUser, requestReset, verifyResetCode,
    resetPassword, changePassword, updateProfile, deleteAccount, ensureDemoAccount,
    userCount: () => users().length
  };
}

// Kiểm tra nhanh, đồng bộ (dùng cho script chặn ở đầu index.html): còn phiên hợp lệ không.
export function hasSession(local = globalThis.localStorage, session = globalThis.sessionStorage, now = Date.now()) {
  try {
    const raw = session?.getItem(SESSION_KEY) ?? local?.getItem(SESSION_KEY);
    return JSON.parse(raw)?.expiresAt > now;
  } catch { return false; }
}
