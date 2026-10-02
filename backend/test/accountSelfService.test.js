const test = require('node:test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'uji-secret-panjang-sekali-untuk-tes-saja-0123456789';
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const requireAuth = require('../src/middleware/requireAuth');
const validate = require('../src/middleware/validate');
const auth = require('../src/controllers/auth.controller');
const router = require('../src/routes/auth.routes');

// Akun saya (/akun): the signed-in user's own language. Passwords are managed
// by the Super Admin: the only change left to the user is replacing a
// temporary password (must_change_password = 1).

const { schemas, limiters } = router;

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
// The handlers of one route, in the order Express runs them.
function handlers(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} is registered`);
  return layer.route.stack.map((l) => l.handle);
}
function runValidate(schema, body) {
  const r = res();
  let passed = false;
  validate(schema)({ body }, r, () => { passed = true; });
  return { passed, status: r.statusCode, code: r.body?.error?.code };
}

test('preferences: only "id" or "en", nothing else in the body', () => {
  assert.equal(runValidate(schemas.preferences, { language: 'id' }).passed, true);
  assert.equal(runValidate(schemas.preferences, { language: 'en' }).passed, true);
  for (const body of [{}, { language: 'fr' }, { language: 'EN' }, { language: null }, { language: 'en', userId: 1 }, { language: 'en', id: 1 }]) {
    assert.deepEqual(runValidate(schemas.preferences, body), { passed: false, status: 400, code: 'VALIDATION_ERROR' }, JSON.stringify(body));
  }
});

test('preferences: writes the language of the session\'s own account only', async (t) => {
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => { writes.push({ sql: String(sql), args }); return [{ affectedRows: 1 }]; });
  const r = res();
  // A body that slipped past validation still cannot name another account.
  await auth.updatePreferences({ user: { sub: 5 }, body: { language: 'en', userId: 99 } }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.data, { language: 'en' });
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /^UPDATE users SET language = \? WHERE id = \?/);
  assert.deepEqual(writes[0].args, ['en', 5]);
});

test('preferences: a deleted account gets 404', async (t) => {
  t.mock.method(pool, 'query', async () => [{ affectedRows: 0 }]);
  const r = res();
  await auth.updatePreferences({ user: { sub: 5 }, body: { language: 'id' } }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 404);
});

test('routes: preferences needs a session; change password is rate limited like login and per user', () => {
  const prefs = handlers('patch', '/me/preferences');
  assert.equal(prefs[0], requireAuth);
  assert.equal(prefs[prefs.length - 1], auth.updatePreferences);
  assert.equal(prefs.length, 3, 'requireAuth, validate, handler');

  const change = handlers('post', '/change-password');
  assert.equal(change[0], limiters.loginLimiter, 'per IP, same limiter as login');
  assert.equal(change[1], requireAuth);
  assert.equal(change[2], limiters.changePasswordUserLimiter, 'per signed-in user');
  assert.equal(change[change.length - 1], auth.changePassword);
  assert.equal(change.length, 5);
  // Login itself keeps both of its limiters.
  const login = handlers('post', '/login');
  assert.deepEqual(login.slice(0, 2), [limiters.loginLimiter, limiters.emailLoginLimiter]);
});

test('change password: the per-user limiter answers 429 after 10 wrong attempts and is keyed on the user', async () => {
  const run = (sub) => new Promise((resolve) => {
    const r = res();
    r.setHeader = () => {}; r.getHeader = () => undefined; r.send = function send(b) { this.body = b; resolve(this); return this; };
    r.on = (event, fn) => { if (event === 'finish') setImmediate(fn); };
    r.statusCode = 400; // a refused attempt counts (skipSuccessfulRequests)
    limiters.changePasswordUserLimiter({ user: { sub }, ip: '203.0.113.9', headers: {}, app: { get: () => false } }, r, () => resolve(null));
  });
  for (let i = 0; i < 10; i += 1) assert.equal(await run(880001), null, `attempt ${i + 1} passes`);
  const blocked = await run(880001);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  // Another user on the same IP is not held back.
  assert.equal(await run(880002), null);
});

test('change password: a weak new password is refused before the handler (400)', () => {
  const weak = ['pendek1', 'hanyahurufsaja', '12345678901234'];
  for (const newPassword of weak) {
    assert.deepEqual(runValidate(schemas.changePassword, { currentPassword: 'Lama12345678', newPassword }), { passed: false, status: 400, code: 'VALIDATION_ERROR' }, newPassword);
  }
  assert.equal(runValidate(schemas.changePassword, { currentPassword: 'Lama12345678', newPassword: 'KopiPagi2026' }).passed, true);
  assert.equal(runValidate(schemas.changePassword, { newPassword: 'KopiPagi2026' }).passed, false, 'the current password is required');
  assert.equal(runValidate(schemas.changePassword, { currentPassword: 'x', newPassword: 'KopiPagi2026', userId: 9 }).passed, false, 'strict');
});

// One account in memory, shared by the controller and requireAuth.
function account(t, initial) {
  const row = { id: 7, entity_id: 1, department_id: 2, name: 'Uji', email: 'uji.akun@example.invalid', avatar_url: null, status: 'active', must_change_password: 0, password_changed_ts: null, tokens_valid_after_ts: null, ...initial };
  const logs = [];
  requireAuth.invalidateAuth();
  t.mock.method(pool, 'query', async (sql, args) => {
    const s = String(sql);
    if (s.startsWith('UPDATE users SET password_hash')) {
      [row.password_hash, row.password_changed_ts] = args;
      row.must_change_password = 0;
      return [{ affectedRows: 1 }];
    }
    if (s.includes('FROM users')) return [[row]];
    if (s.includes('FROM permissions')) return [[{ code: 'notification.view' }]];
    if (s.includes('activity_logs')) { logs.push(args); return [{ insertId: 1 }]; }
    return [{ insertId: 1 }];
  });
  return { row, logs };
}
async function passes(token) {
  const r = res();
  let passed = false;
  await requireAuth({ headers: { authorization: `Bearer ${token}` }, baseUrl: '/api/v1/notifications', path: '', originalUrl: '/api/v1/notifications' }, r, () => { passed = true; });
  return passed ? 'ok' : r.body.error.code;
}
const change = async (body) => { const r = res(); await auth.changePassword({ user: { sub: 7 }, body }, r, (e) => { throw e; }); return r; };
const tokenIssuedAt = (iat) => jwt.sign({ sub: 7, amr: 'password', iat }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });

test('change password: a voluntary change is refused — the password is managed by the Super Admin', async (t) => {
  const hash = await bcrypt.hash('LamaSekali123', 4);
  const { row, logs } = account(t, { password_hash: hash, must_change_password: 0 });
  const compared = t.mock.method(bcrypt, 'compare');
  // Even with the right current password.
  const r = await change({ currentPassword: 'LamaSekali123', newPassword: 'KopiPagi2026' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error.code, 'PASSWORD_MANAGED_BY_ADMIN');
  assert.equal(r.body.error.message, 'Kata sandi dikelola oleh Super Admin');
  assert.equal(r.body.data, undefined);
  assert.equal(row.password_hash, hash);
  assert.equal(row.password_changed_ts, null);
  assert.equal(compared.mock.callCount(), 0, 'the current password is not even checked: no guessing surface');
  assert.equal(logs.length, 0);
});

test('change password (temporary): a wrong current password is refused with a generic error and changes nothing', async (t) => {
  const hash = await bcrypt.hash('LamaSekali123', 4);
  const { row } = account(t, { password_hash: hash, must_change_password: 1 });
  const r = await change({ currentPassword: 'TebakanSalah1', newPassword: 'KopiPagi2026' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(r.body.error.message, 'Kata sandi saat ini salah');
  assert.equal(r.body.data, undefined);
  assert.equal(row.password_hash, hash);
  assert.equal(row.password_changed_ts, null);
});

test('change password: a Google-only account (no password) is refused', async (t) => {
  const { row } = account(t, { password_hash: null });
  const r = await change({ currentPassword: 'apa-saja', newPassword: 'KopiPagi2026' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error.code, 'PASSWORD_MANAGED_BY_ADMIN');
  assert.equal(row.password_hash, null, 'no first password can be set here');
  // Even with the flag raised there is no password to replace.
  row.must_change_password = 1;
  const flagged = await change({ currentPassword: 'apa-saja', newPassword: 'KopiPagi2026' });
  assert.equal(flagged.statusCode, 400);
  assert.equal(flagged.body.error.code, 'NO_PASSWORD');
  assert.equal(row.password_hash, null);
});

test('change password (temporary): success ends the other sessions, the returned token works, and the log holds no password', async (t) => {
  const { row, logs } = account(t, { password_hash: await bcrypt.hash('LamaSekali123', 4), must_change_password: 1 });
  const now = Math.floor(Date.now() / 1000);
  const otherDevice = tokenIssuedAt(now - 600);
  assert.equal(await passes(otherDevice), 'PASSWORD_CHANGE_REQUIRED', 'before the change the temporary password holds every other API');

  const r = await change({ currentPassword: 'LamaSekali123', newPassword: 'KopiPagi2026' });
  assert.equal(r.statusCode, 200);
  assert.ok(await bcrypt.compare('KopiPagi2026', row.password_hash));
  assert.ok(row.password_changed_ts >= now);

  // No stale sign-in cache: the old session ends at once, the new one works.
  assert.equal(await passes(otherDevice), 'SESSION_EXPIRED');
  assert.equal(await passes(r.body.data.token), 'ok');
  assert.equal(jwt.decode(r.body.data.token).sub, 7);
  // The flag is cleared, so a second, voluntary change is refused.
  assert.equal(row.must_change_password, 0);
  assert.equal((await change({ currentPassword: 'KopiPagi2026', newPassword: 'TehSore2027x' })).body.error.code, 'PASSWORD_MANAGED_BY_ADMIN');
  assert.ok(await bcrypt.compare('KopiPagi2026', row.password_hash));

  const written = JSON.stringify(logs) + JSON.stringify(r.body);
  assert.ok(logs.length >= 1, 'an activity log entry is written');
  assert.match(JSON.stringify(logs), /user\.password_change/);
  for (const secret of ['LamaSekali123', 'KopiPagi2026', row.password_hash]) assert.equal(written.includes(secret), false);
});

test('who am I: returns the account language, the division name and the sign-in methods, never the hash', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM users u')) return [[{ id: 7, name: 'Uji', email: 'uji.akun@example.invalid', avatar_url: null, entity_id: 1, department_id: 2, must_change_password: 0, language: 'en', has_password: 0, has_google: 1, department_name: 'Sales' }]];
    return [[{ id: 3, name: 'Sales Member', role_key: 'sales.member', role_level: 'member', department_id: 2 }]];
  });
  const r = res();
  await auth.me({ user: { sub: 7, amr: 'google', permissions: [] } }, r, (e) => { throw e; });
  assert.equal(r.body.data.language, 'en');
  assert.equal(r.body.data.departmentName, 'Sales');
  assert.deepEqual(r.body.data.signIn, { password: false, google: true });
  assert.deepEqual(r.body.data.roles.map((role) => role.name), ['Sales Member']);
  assert.doesNotMatch(JSON.stringify(r.body), /password_hash|google_sub|passwordHash|googleSub/);
});
