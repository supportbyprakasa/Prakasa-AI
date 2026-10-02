const test = require('node:test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'uji-secret-panjang-sekali-untuk-tes-saja-0123456789';
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const jwtService = require('../src/services/jwt.service');
const requireAuth = require('../src/middleware/requireAuth');
const auth = require('../src/controllers/auth.controller');

// The sign-in cache in requireAuth (30 s per user id): it saves two queries a
// request, and every write that changes who may do what drops it at once — a
// revoked session is never accepted from the cache.

const { invalidateAuth, _authCache: cache } = requireAuth;
const now = () => Math.floor(Date.now() / 1000);

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// The database as requireAuth and the auth controller see it.
function mockDb(t, rows) {
  const counts = { user: 0, permissions: 0 };
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const s = String(sql);
    if (s.includes('FROM users') && s.includes('password_changed_ts')) {
      counts.user += 1;
      const row = rows.users[Number(args[0])];
      return [row ? [{ ...row }] : []];
    }
    if (s.includes('SELECT DISTINCT p.code')) {
      counts.permissions += 1;
      return [(rows.permissions[Number(args[0])] || []).map((code) => ({ code }))];
    }
    if (s.includes('SELECT id, entity_id, department_id, name, email, password_hash')) return [[rows.login]];
    if (s.startsWith('UPDATE users SET tokens_valid_after')) { rows.users[Number(args[0])].tokens_valid_after_ts = now(); return [{ affectedRows: 1 }]; }
    if (s.startsWith('UPDATE users SET password_hash')) { rows.users[Number(args[2])].password_changed_ts = Number(args[1]); return [{ affectedRows: 1 }]; }
    return [{ insertId: 1, affectedRows: 1 }];
  });
  return counts;
}

async function call(token, url = '/api/v1/sales/customers') {
  const r = res();
  let passed = false;
  let user = null;
  const [pathOnly] = url.split('?');
  const req = { headers: { authorization: `Bearer ${token}` }, baseUrl: pathOnly, path: '', originalUrl: url };
  await requireAuth(req, r, () => { passed = true; user = req.user; });
  return { passed, status: r.statusCode, code: r.body?.error?.code, user };
}

const row = (extra = {}) => ({ id: 5, entity_id: 1, department_id: 2, email: 'ani@prakasagroup.com', status: 'active', must_change_password: 0, password_changed_ts: null, tokens_valid_after_ts: null, ...extra });
const tokenAt = (iat, amr = 'google', sub = 5) => jwt.sign({ sub, amr, iat }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

test.beforeEach(() => { cache.setEnabled(true); cache.clear(); });
test.after(() => { cache.clear(); cache.setEnabled(null); });

test('within 30 s the user and permissions are read once', async (t) => {
  const counts = mockDb(t, { users: { 5: row() }, permissions: { 5: ['sales.customer.view'] } });
  const token = jwtService.sign({ sub: 5, amr: 'google' });
  for (let i = 0; i < 5; i += 1) assert.equal((await call(token)).passed, true);
  assert.deepEqual(counts, { user: 1, permissions: 1 });
  assert.equal(requireAuth.AUTH_CACHE_TTL_MS, 30000);
});

test('logout ends the session at once, not after the cache expires', async (t) => {
  const rows = { users: { 5: row() }, permissions: { 5: ['sales.customer.view'] } };
  mockDb(t, rows);
  const old = tokenAt(now() - 60);
  assert.equal((await call(old)).passed, true, 'cached as valid');
  const r = res();
  await auth.logout({ user: { sub: 5, entityId: 1 } }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(await call(old), { passed: false, status: 401, code: 'SESSION_EXPIRED', user: null });
});

test('a password change ends older sessions at once; the new one works', async (t) => {
  const hash = await bcrypt.hash('Sementara123', 4);
  const rows = {
    users: { 5: row({ must_change_password: 1 }) },
    permissions: { 5: ['sales.customer.view'] },
    login: { id: 5, entity_id: 1, department_id: 2, name: 'Ani', email: 'ani@prakasagroup.com', password_hash: hash, status: 'active', must_change_password: 1 },
  };
  mockDb(t, rows);
  const old = tokenAt(now() - 60, 'password');
  assert.equal((await call(old, '/api/v1/auth/me')).passed, true);
  assert.equal((await call(old)).code, 'PASSWORD_CHANGE_REQUIRED', 'the gate runs on the cached row');
  const r = res();
  await auth.changePassword({ user: { sub: 5 }, body: { currentPassword: 'Sementara123', newPassword: 'KopiPagi2026' } }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 200);
  rows.users[5].must_change_password = 0;
  assert.equal((await call(old)).code, 'SESSION_EXPIRED', 'never a stale "valid" from the cache');
});

test('an administrator\'s change (status, roles) is read on the next request', async (t) => {
  const rows = { users: { 5: row(), 50: row({ id: 50 }) }, permissions: { 5: ['sales.customer.view'], 50: ['sales.customer.view'] } };
  const counts = mockDb(t, rows);
  const t5 = jwtService.sign({ sub: 5, amr: 'google' });
  const t50 = jwtService.sign({ sub: 50, amr: 'google' });
  await call(t5);
  await call(t50);
  rows.users[5].status = 'inactive';
  rows.permissions[50] = ['sales.customer.view', 'sales.data.view_all'];
  assert.equal((await call(t5)).passed, true, 'until invalidated the cached row answers');
  invalidateAuth(5);
  assert.equal((await call(t5)).code, 'USER_INACTIVE');
  assert.deepEqual((await call(t50)).user.permissions, ['sales.customer.view'], 'user 50 is not dropped by user 5 (no prefix clash)');
  invalidateAuth(); // a role's permissions changed: everyone
  assert.deepEqual((await call(t50)).user.permissions, ['sales.customer.view', 'sales.data.view_all']);
  assert.equal(counts.user, 4);
});

test('a deleted account is refused once invalidated', async (t) => {
  const rows = { users: { 5: row() }, permissions: { 5: [] } };
  mockDb(t, rows);
  const token = jwtService.sign({ sub: 5, amr: 'google' });
  assert.equal((await call(token)).passed, true);
  delete rows.users[5];
  invalidateAuth('5');
  assert.equal((await call(token)).code, 'UNAUTHORIZED');
});

test('a sign-in read that was running when the account changed is not kept', async (t) => {
  const rows = { users: { 5: row() }, permissions: { 5: ['sales.customer.view'] } };
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const s = String(sql);
    if (s.includes('password_changed_ts')) {
      const snapshot = { ...rows.users[Number(args[0])] };
      if (first) { first = false; await gate; }
      return [[snapshot]];
    }
    if (s.includes('SELECT DISTINCT p.code')) return [rows.permissions[5].map((code) => ({ code }))];
    return [{ affectedRows: 1 }];
  });
  const old = tokenAt(now() - 60);
  const slow = call(old); // reads the row before logout
  await new Promise((r) => setTimeout(r, 10));
  rows.users[5].tokens_valid_after_ts = now(); // logout commits…
  invalidateAuth(5); // …and drops the entry
  release();
  await slow;
  assert.equal((await call(old)).code, 'SESSION_EXPIRED', 'the pre-logout row was not stored');
});

test('req.user.permissions is a copy: changing it never touches the cache', async (t) => {
  mockDb(t, { users: { 5: row() }, permissions: { 5: ['sales.customer.view'] } });
  const token = jwtService.sign({ sub: 5, amr: 'google' });
  const a = await call(token);
  a.user.permissions.push('management_dashboard.view');
  assert.deepEqual((await call(token)).user.permissions, ['sales.customer.view']);
});

test('the HS256 pin still holds with the cache on', async (t) => {
  mockDb(t, { users: { 5: row() }, permissions: { 5: [] } });
  const none = jwt.sign({ sub: 5, amr: 'google' }, '', { algorithm: 'none', expiresIn: '1h' });
  assert.equal((await call(none)).code, 'UNAUTHORIZED');
  const hs512 = jwt.sign({ sub: 5, amr: 'google' }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '1h' });
  assert.equal((await call(hs512)).code, 'UNAUTHORIZED');
});
