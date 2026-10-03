const test = require('node:test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'uji-secret-panjang-sekali-untuk-tes-saja-0123456789';
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');
const jwtService = require('../src/services/jwt.service');
const requireAuth = require('../src/middleware/requireAuth');
const auth = require('../src/controllers/auth.controller');
const { schemas } = require('../src/routes/auth.routes');

// A temporary password from an administrator must be replaced first; a
// changed or reset password ends older sessions; Google sign-in is never held up.

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function mockUser(t, row) {
  // Each test has its own row for user 5: start without a cached sign-in
  // (the cache is off under node --test unless MEMO_IN_TESTS=1).
  requireAuth.invalidateAuth();
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM users') && s.includes('must_change_password')) return [[row]];
    if (s.includes('FROM permissions')) return [[{ code: 'notification.view' }]];
    return [[]];
  });
}
async function call(token, url) {
  const r = res();
  let passed = false;
  const [pathOnly] = url.split('?');
  await requireAuth({ headers: { authorization: `Bearer ${token}` }, baseUrl: pathOnly, path: '', originalUrl: url }, r, () => { passed = true; });
  return { passed, status: r.statusCode, code: r.body?.error?.code };
}

test('a temporary password holds every API except "who am I" and "change password"', async (t) => {
  mockUser(t, { id: 5, entity_id: 1, department_id: 2, email: 'a@prakasagroup.com', status: 'active', must_change_password: 1, password_changed_ts: null });
  const token = jwtService.sign({ sub: 5, amr: 'password' });
  assert.deepEqual(await call(token, '/api/v1/sales/customers'), { passed: false, status: 403, code: 'PASSWORD_CHANGE_REQUIRED' });
  assert.equal((await call(token, '/api/v1/auth/me')).passed, true);
  assert.equal((await call(token, '/api/v1/auth/change-password')).passed, true);
  // Google sign-in has no password to replace.
  assert.equal((await call(jwtService.sign({ sub: 5, amr: 'google' }), '/api/v1/sales/customers')).passed, true);
});

test('a session older than the last password change is over', async (t) => {
  const now = Math.floor(Date.now() / 1000);
  mockUser(t, { id: 5, entity_id: 1, department_id: 2, email: 'a@x', status: 'active', must_change_password: 0, password_changed_ts: now + 5 });
  assert.deepEqual(await call(jwtService.sign({ sub: 5, amr: 'password' }), '/api/v1/sales/customers'), { passed: false, status: 401, code: 'SESSION_EXPIRED' });
});

test('change password: checks the current one, refuses weak or same passwords, clears the flag and returns a fresh session', async (t) => {
  const hash = await bcrypt.hash('Sementara123', 4);
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const s = String(sql);
    if (s.includes('SELECT id, entity_id, department_id, name, email, password_hash')) return [[{ id: 5, entity_id: 1, department_id: 2, name: 'Ani', email: 'ani@prakasagroup.com', password_hash: hash, status: 'active', must_change_password: 1 }]];
    if (s.startsWith('UPDATE users')) { writes.push(args); return [{ affectedRows: 1 }]; }
    if (s.includes('FROM permissions')) return [[]];
    return [{ insertId: 1 }];
  });
  const run = async (body) => { const r = res(); await auth.changePassword({ user: { sub: 5 }, body }, r, (e) => { throw e; }); return r; };
  assert.equal((await run({ currentPassword: 'salah', newPassword: 'BaruSekali123' })).body.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await run({ currentPassword: 'Sementara123', newPassword: 'Sementara123' })).body.error.code, 'VALIDATION_ERROR');
  assert.equal((await run({ currentPassword: 'Sementara123', newPassword: 'ani12345678' })).body.error.code, 'VALIDATION_ERROR', 'no email name inside');
  const ok = await run({ currentPassword: 'Sementara123', newPassword: 'KopiPagi2026' });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.body.data.token);
  assert.equal(ok.body.data.user.passwordChangeRequired, false);
  assert.equal(writes.length, 1);
  assert.ok(await bcrypt.compare('KopiPagi2026', writes[0][0]));
});

test('change password: without the temporary flag it is refused — passwords are managed by the Super Admin', async (t) => {
  const hash = await bcrypt.hash('TetapSaja123', 4);
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const s = String(sql);
    if (s.includes('SELECT id, entity_id, department_id, name, email, password_hash')) return [[{ id: 5, entity_id: 1, department_id: 2, name: 'Ani', email: 'ani@prakasagroup.com', password_hash: hash, status: 'active', must_change_password: 0 }]];
    writes.push({ s, args });
    return [{ insertId: 1 }];
  });
  const r = res();
  await auth.changePassword({ user: { sub: 5 }, body: { currentPassword: 'TetapSaja123', newPassword: 'KopiPagi2026' } }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.body.error, { code: 'PASSWORD_MANAGED_BY_ADMIN', message: 'Kata sandi dikelola oleh Super Admin' });
  assert.deepEqual(writes, [], 'nothing written, nothing logged');
});

test('the gate reads the path, not the query string (no "?x=/auth/me" bypass)', async (t) => {
  mockUser(t, { id: 5, entity_id: 1, department_id: 2, email: 'a@x', status: 'active', must_change_password: 1, password_changed_ts: null });
  const token = jwtService.sign({ sub: 5, amr: 'password' });
  const r = res();
  let passed = false;
  await requireAuth({ headers: { authorization: `Bearer ${token}` }, baseUrl: '/api/v1/notifications', path: '/', originalUrl: '/api/v1/notifications?x=/auth/me' }, r, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(r.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  let ok = false;
  await requireAuth({ headers: { authorization: `Bearer ${token}` }, baseUrl: '/api/v1/auth', path: '/me', originalUrl: '/api/v1/auth/me' }, res(), () => { ok = true; });
  assert.equal(ok, true);
});
