// Security review fixes (Oct 2026): permission catalog guard, Super Admin gates
// for AI/Accurate, gateway URL checks, per-email login limiter, logout/session
// cut, login timing, Google token errors, error mapping, upload sniffing and
// https-only link fields. The database is mocked; routes run in a real Express
// app on a random port.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(48, 'x');

const pool = require('../src/db/pool');
const errorHandler = require('../src/middleware/errorHandler');
const { describeError } = errorHandler;
const upload = require('../src/middleware/upload');
const { httpsUrl, isPrivateAddress, assertSafeGatewayUrl } = require('../src/utils/safeUrl');
const authRoutes = require('../src/routes/auth.routes');
const authController = require('../src/controllers/auth.controller');
const googleAuth = require('../src/services/googleAuth.service');
const providerSettings = require('../src/services/ai/providerSettings');

// ------------------------------------------------------------------ test app

// What the mocked database answers: the signed-in user, their permissions,
// whether they are Super Admin, and every write the routes make.
const state = { superAdmin: false, permissions: [], tokensValidAfter: null, writes: [], loginUser: null };

function mockDb(t) {
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    if (/FROM users\s+WHERE id = \? AND deleted_at IS NULL\s+LIMIT 1/.test(text) && /must_change_password/.test(text) && /password_changed_ts/.test(text)) {
      return [[{ id: Number(args[0]), entity_id: 1, department_id: null, email: 'admin@x.test', status: 'active', must_change_password: 0, password_changed_ts: null, tokens_valid_after_ts: state.tokensValidAfter }]];
    }
    if (/SELECT DISTINCT p\.code/.test(text)) return [state.permissions.map((code) => ({ code }))];
    if (/LIMIT 1/.test(text) && args[1] === 'system.super_admin') return [state.superAdmin ? [{ 1: 1 }] : []];
    if (/FROM permissions WHERE id=\?/.test(text)) return [[{ id: Number(args[0]), code: 'sales.order.view', description: 'Lihat SO' }]];
    if (/FROM users\s+WHERE email = \?/.test(text)) return [state.loginUser ? [state.loginUser] : []];
    state.writes.push({ sql: text, args });
    return [{ affectedRows: 1, insertId: 5 }];
  });
}

function token(sub = 7, extra = {}) {
  return jwt.sign({ sub, amr: 'google', ...extra }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

let baseUrl;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/permissions', require('../src/routes/permissions.routes'));
  app.use('/api/v1/ai', require('../src/routes/ai.routes'));
  app.use('/api/v1/integrations/accurate', require('../src/routes/accurateIntegration.routes'));
  app.post('/upload', upload.single('file'), (req, res) => res.json({ mimetype: req.file?.mimetype }));
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

function call(method, url, { body, auth = token() } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  return fetch(`${baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
}

function reset(overrides = {}) {
  Object.assign(state, { superAdmin: false, permissions: [], tokensValidAfter: null, writes: [], loginUser: null }, overrides);
}

// --------------------------------------------------------------- H-1 catalog

test('H-1: only a Super Admin adds, edits or removes a permission', async (t) => {
  mockDb(t);
  reset({ permissions: ['permission.manage'] });
  for (const [method, url, body] of [
    ['POST', '/api/v1/permissions', { code: 'evil.manage' }],
    ['PATCH', '/api/v1/permissions/3', { code: 'user.manage' }],
    ['DELETE', '/api/v1/permissions/3'],
  ]) {
    const res = await call(method, url, { body });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.error.code, 'SUPER_ADMIN_ONLY');
    assert.equal(res.body.error.message, 'Hanya Super Admin yang bisa mengubah katalog izin');
  }
  assert.equal(state.writes.length, 0);
  // Reading the catalog stays with the permission.
  assert.equal((await call('GET', '/api/v1/permissions')).status, 200);
});

test('H-1: a permission code never changes and an update sets only the fields sent', async (t) => {
  mockDb(t);
  reset({ superAdmin: true, permissions: ['permission.manage'] });
  const renamed = await call('PATCH', '/api/v1/permissions/3', { body: { code: 'user.manage' } });
  assert.equal(renamed.status, 400);
  assert.equal(renamed.body.error.code, 'PERMISSION_CODE_IMMUTABLE');
  assert.equal(state.writes.filter((w) => /UPDATE permissions/.test(w.sql)).length, 0);

  // Same code, no description: nothing is wiped.
  assert.equal((await call('PATCH', '/api/v1/permissions/3', { body: { code: 'sales.order.view' } })).status, 200);
  assert.equal(state.writes.filter((w) => /UPDATE permissions/.test(w.sql)).length, 0);

  assert.equal((await call('PATCH', '/api/v1/permissions/3', { body: { description: 'Baru' } })).status, 200);
  const update = state.writes.find((w) => /UPDATE permissions/.test(w.sql));
  assert.match(update.sql, /SET description=\?/);
  assert.doesNotMatch(update.sql, /code=/);
  assert.deepEqual(update.args, ['Baru', '3']);
});

// ------------------------------------------------------- H-3 AI and Accurate

test('H-3: AI provider, routing and module settings and the Accurate connection are Super Admin only', async (t) => {
  mockDb(t);
  reset({ permissions: ['ai.provider.manage', 'ai.routing.manage', 'ai.config.manage', 'integration.accurate.manage'] });
  for (const [method, url, body] of [
    ['PATCH', '/api/v1/ai/provider-settings/providers/n8n', { gatewayUrl: 'https://n8n.example.com' }],
    ['POST', '/api/v1/ai/provider-settings/claude-team/accounts', { label: 'A', mode: 'cli', model: 'claude-sonnet-4-5' }],
    ['PATCH', '/api/v1/ai/provider-settings/claude-team/accounts/1', { label: 'B' }],
    ['DELETE', '/api/v1/ai/provider-settings/claude-team/accounts/1'],
    ['PUT', '/api/v1/ai/provider-settings/routing', { defaultProvider: 'openai' }],
    ['PUT', '/api/v1/ai/provider-settings/routing/divisions/3', { provider: 'openai' }],
    ['DELETE', '/api/v1/ai/provider-settings/routing/divisions/3'],
    ['PATCH', '/api/v1/ai/modules/chat', { model: 'gpt-4o-mini' }],
    ['PUT', '/api/v1/integrations/accurate/credentials', {}],
    ['POST', '/api/v1/integrations/accurate/connect', {}],
    ['POST', '/api/v1/integrations/accurate/refresh', {}],
    ['POST', '/api/v1/integrations/accurate/disconnect', {}],
  ]) {
    const res = await call(method, url, { body });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.error.code, 'SUPER_ADMIN_ONLY', `${method} ${url}`);
  }
  assert.equal(state.writes.length, 0);
});

test('H-3: a gateway URL must be https and, in production, never an internal address', async () => {
  const prod = { NODE_ENV: 'production' };
  const lookupTo = (address) => async () => [{ address }];
  const rejects = (url, env, lookup = lookupTo('93.184.216.34')) => assert.rejects(assertSafeGatewayUrl(url, { env, lookup }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR', url);

  await rejects('http://gateway.example.com', prod);
  await rejects('http://localhost:8787', prod);
  await rejects('https://localhost:8787', prod);
  await rejects('https://127.0.0.1', prod);
  await rejects('https://169.254.169.254/latest/meta-data', prod);
  await rejects('https://[::1]/', prod);
  await rejects('https://[fd00::1]/', prod);
  await rejects('https://user:pw@gateway.example.com', prod);
  await rejects('ftp://gateway.example.com', prod);
  // A public name that resolves inside is refused too.
  for (const inside of ['10.1.2.3', '172.20.0.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', 'fe80::1', '::ffff:10.0.0.1']) {
    await rejects('https://gateway.example.com', prod, lookupTo(inside));
  }
  assert.equal(await assertSafeGatewayUrl('https://gateway.example.com/v1', { env: prod, lookup: lookupTo('93.184.216.34') }), 'https://gateway.example.com/v1');

  // Development: http only for localhost; https anywhere.
  const dev = { NODE_ENV: 'development' };
  assert.ok(await assertSafeGatewayUrl('http://localhost:8787', { env: dev }));
  assert.ok(await assertSafeGatewayUrl('http://127.0.0.1:8787', { env: dev }));
  await rejects('http://gateway.example.com', dev);
});

test('H-3: isPrivateAddress covers loopback, private, link-local, CGNAT and unique-local ranges', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('H-3: the n8n gateway URL is checked when saved', async (t) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => { process.env.NODE_ENV = original; });
  t.mock.method(pool, 'query', async () => [[]]);
  await assert.rejects(providerSettings.saveProviderConfig('n8n', { model: 'n8n-flow', gatewayUrl: 'http://10.0.0.5/hook' }, 1), (e) => e.status === 400);
  await assert.rejects(providerSettings.saveProviderConfig('n8n', { model: 'n8n-flow', gatewayUrl: 'https://169.254.169.254/' }, 1), (e) => e.status === 400);
});

// --------------------------------------------------------------- M-1 login

test('M-1: failed sign-ins are limited per email, whatever the casing', async (t) => {
  mockDb(t);
  reset();
  t.mock.method(bcrypt, 'compare', async () => false);
  const attempt = (email) => call('POST', '/api/v1/auth/login', { auth: null, body: { email, password: 'salah-salah' } });
  for (let i = 0; i < 10; i += 1) {
    const res = await attempt(i % 2 ? 'Korban@X.test' : 'korban@x.test');
    assert.equal(res.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await attempt('KORBAN@x.test');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.match(blocked.body.error.message, /untuk akun ini/);
  // Another account from the same address is not blocked by that bucket.
  assert.equal((await attempt('lain@x.test')).status, 401);
  assert.equal(authRoutes.emailKey({ body: { email: '  A@B.Test ' } }), 'email:a@b.test');
});

test('L-3: an unknown email still costs one bcrypt comparison', async (t) => {
  mockDb(t);
  reset();
  const compared = [];
  t.mock.method(bcrypt, 'compare', async (plain, hash) => { compared.push(hash); return true; });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await authController.manualLogin({ body: { email: 'tidak-ada@x.test', password: 'apa saja' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 401);
  assert.equal(compared.length, 1);
  assert.equal(compared[0], authController.dummyPasswordHash());
  assert.match(compared[0], /^\$2[aby]\$12\$/);

  // A Google-only account (no password) is compared against the dummy too and fails even if it "matches".
  state.loginUser = { id: 3, email: 'g@x.test', password_hash: null, status: 'active' };
  await authController.manualLogin({ body: { email: 'g@x.test', password: 'apa saja' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 401);
  assert.equal(compared.length, 2);
});

// ------------------------------------------------------------- M-3 logout

test('M-3: logout ends every session issued up to that moment', async (t) => {
  mockDb(t);
  reset({ permissions: ['permission.manage'] });
  const iat = Math.floor(Date.now() / 1000) - 60;
  const old = jwt.sign({ sub: 7, amr: 'google', iat }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const out = await call('POST', '/api/v1/auth/logout', { auth: old });
  assert.equal(out.status, 200);
  const write = state.writes.find((w) => /UPDATE users SET tokens_valid_after = NOW\(\)/.test(w.sql));
  assert.deepEqual(write.args, [7]);

  state.tokensValidAfter = iat + 1; // what NOW() stored
  const after = await call('GET', '/api/v1/permissions', { auth: old });
  assert.equal(after.status, 401);
  assert.equal(after.body.error.code, 'SESSION_EXPIRED');

  const fresh = jwt.sign({ sub: 7, amr: 'google', iat: iat + 5 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await call('GET', '/api/v1/permissions', { auth: fresh })).status, 200);

  const sql = fs.readFileSync(path.join(__dirname, '../migrations/124_session_revocation.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN tokens_valid_after TIMESTAMP NULL/);
  assert.match(sql, /information_schema\.columns/, 'idempotent');
});

// ------------------------------------------------------ L-5 error handling

test('L-5: errors map to safe statuses and, in production, generic 5xx messages', () => {
  const prod = { production: true };
  const dup = Object.assign(new Error("Duplicate entry 'a@x' for key 'users.email'"), { code: 'ER_DUP_ENTRY', errno: 1062 });
  assert.deepEqual(describeError(dup, prod), { status: 500, code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server' });
  assert.equal(describeError(Object.assign(new Error('x'), { status: 503, code: 'AI_PROVIDER_NOT_CONFIGURED' }), prod).code, 'INTERNAL_ERROR');
  // Outside production the detail helps debugging.
  assert.equal(describeError(dup, { production: false }).code, 'ER_DUP_ENTRY');
  // 4xx keep their own code and message.
  assert.deepEqual(describeError(Object.assign(new Error('Tipe file tidak diizinkan'), { status: 400, code: 'FILE_TYPE_NOT_ALLOWED' }), prod), { status: 400, code: 'FILE_TYPE_NOT_ALLOWED', message: 'Tipe file tidak diizinkan' });

  const multerError = (code) => Object.assign(new Error(code), { name: 'MulterError', code });
  assert.equal(describeError(multerError('LIMIT_FILE_SIZE'), prod).status, 413);
  for (const code of ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE']) {
    assert.deepEqual(describeError(multerError(code), prod), { status: 400, code: 'TOO_MANY_FILES', message: 'Jumlah file melebihi batas' });
  }
  const badJson = Object.assign(new SyntaxError('Unexpected token'), { status: 400, type: 'entity.parse.failed', body: '{' });
  assert.deepEqual(describeError(badJson, prod), { status: 400, code: 'INVALID_JSON', message: 'Format JSON tidak valid' });
});

test('L-5: missing Google credentials are a 503 GOOGLE_NOT_CONFIGURED, not a 500', () => {
  const expected = { status: 503, code: 'GOOGLE_NOT_CONFIGURED', message: 'Integrasi Google belum dikonfigurasi. Hubungi Administrator.' };
  for (const production of [true, false]) {
    assert.deepEqual(describeError(new Error('No key or keyFile set.'), { production }), expected);
    assert.deepEqual(describeError(Object.assign(new Error('GOOGLE_ADMIN_DELEGATED_USER belum diisi di .env'), { code: 'GOOGLE_ADMIN_NOT_CONFIGURED' }), { production }), expected);
  }
  // A 4xx of its own is kept.
  assert.equal(describeError(Object.assign(new Error('GOOGLE_X belum diisi'), { status: 400, code: 'VALIDATION_ERROR' }), { production: true }).status, 400);
});

test('L-5: a malformed JSON body is a 400 through the real parser', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.message, 'Format JSON tidak valid');
});

test('L-5: an invalid Google token is a 401, a network failure is not', async (t) => {
  t.mock.method(googleAuth.client, 'verifyIdToken', async () => { throw new Error('Wrong number of segments in token'); });
  await assert.rejects(googleAuth.verifyGoogleIdToken('abc.def'), (e) => e.status === 401 && e.code === 'GOOGLE_TOKEN_INVALID');
  t.mock.method(googleAuth.codeClient, 'getToken', async () => { throw Object.assign(new Error('invalid_grant'), { response: { status: 400 } }); });
  await assert.rejects(googleAuth.exchangeAuthCode('code-1234567'), (e) => e.status === 401);
  t.mock.method(googleAuth.codeClient, 'getToken', async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); });
  await assert.rejects(googleAuth.exchangeAuthCode('code-1234567'), (e) => e.code === 'ECONNREFUSED' && !e.status);
});

// ------------------------------------------------------------- L-6 uploads

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('L-6: HTML and arbitrary octet-stream files are refused before upload', () => {
  assert.equal(upload.acceptsFile({ originalname: 'a.html', mimetype: 'text/html' }), false);
  assert.equal(upload.acceptsFile({ originalname: 'a.htm', mimetype: 'text/plain' }), false);
  assert.equal(upload.acceptsFile({ originalname: 'a.txt', mimetype: 'text/html' }), false);
  assert.equal(upload.acceptsFile({ originalname: 'a.json', mimetype: 'application/octet-stream' }), false);
  assert.equal(upload.acceptsFile({ originalname: 'a.xlsx', mimetype: 'application/octet-stream' }), true);
  assert.equal(upload.acceptsFile({ originalname: 'a.pdf', mimetype: 'application/pdf' }), true);
});

test('L-6: the content must match the declared type and extension', () => {
  const sniff = (originalname, mimetype, buffer) => upload.sniffFile({ originalname, mimetype, buffer });
  assert.equal(sniff('a.pdf', 'application/pdf', PDF), 'application/pdf');
  assert.equal(sniff('a.pdf', 'application/pdf', HTML), null);
  assert.equal(sniff('a.png', 'image/png', PNG), 'image/png');
  assert.equal(sniff('a.png', 'image/png', JPEG), null);
  assert.equal(sniff('a.jpg', 'image/jpeg', JPEG), 'image/jpeg');
  assert.equal(sniff('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sniff('a.xlsx', XLSX_MIME, HTML), null);
  // A text type with a PDF extension must still be a PDF.
  assert.equal(sniff('a.pdf', 'text/plain', HTML), null);
  // octet-stream is accepted for a safe extension once the content matches, and recorded as the real type.
  assert.equal(sniff('a.xlsx', 'application/octet-stream', ZIP), XLSX_MIME);
  assert.equal(sniff('a.xlsx', 'application/octet-stream', HTML), null);
  assert.equal(sniff('a.csv', 'application/octet-stream', Buffer.from('a,b\n1,2\n')), 'text/csv');
  assert.equal(sniff('a.csv', 'application/octet-stream', Buffer.from([0x4d, 0x5a, 0, 0])), null);
  // CSV sent by Windows browsers as application/vnd.ms-excel still passes.
  assert.equal(sniff('a.csv', 'application/vnd.ms-excel', Buffer.from('a,b\n')), 'application/vnd.ms-excel');
});

test('L-6: the upload middleware rejects a renamed file and rewrites a generic type', async () => {
  const send = async (name, type, buffer) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), name);
    const res = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };
  const fake = await send('laporan.pdf', 'application/pdf', HTML);
  assert.equal(fake.status, 400);
  assert.equal(fake.body.error.code, 'FILE_CONTENT_MISMATCH');
  assert.equal((await send('halaman.html', 'text/html', HTML)).status, 400);
  const generic = await send('data.xlsx', 'application/octet-stream', ZIP);
  assert.equal(generic.status, 200);
  assert.equal(generic.body.mimetype, XLSX_MIME);
});

// -------------------------------------------------------------- M-4 links

test('M-4: link fields accept https only', () => {
  const schema = httpsUrl({ max: 500 }).nullable().optional();
  assert.equal(schema.safeParse('https://app.kantorku.id/employee/1').success, true);
  assert.equal(schema.safeParse(null).success, true);
  for (const bad of ['http://app.kantorku.id', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'mailto:a@b.c', `https://x.test/${'a'.repeat(500)}`]) {
    assert.equal(schema.safeParse(bad).success, false, bad);
  }
  for (const [file, field] of [['hrga.routes.js', 'kantorkuReferenceUrl'], ['it.routes.js', 'portalUrl'], ['entities.routes.js', 'logoUrl']]) {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8');
    assert.match(src, new RegExp(`${field}: httpsUrl\\(`), `${file} ${field}`);
    assert.doesNotMatch(src, new RegExp(`${field}: z\\.string\\(\\)\\.url\\(`), `${file} ${field}`);
  }
});
