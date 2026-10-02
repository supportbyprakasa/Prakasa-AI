// Production hardening (Oct 2026): health check, realtime switch, rate limits,
// encrypted Claude Team gateway secrets, verified Google email, URLs that must
// be configured in production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.SIGNATURE_ENCRYPTION_KEY = process.env.SIGNATURE_ENCRYPTION_KEY || 'test-signature-key-0123456789abcdef0123';

function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (k, v) => { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

// ------------------------------------------------------------------ health
const { healthHandler, pingDb } = require('../src/utils/health');

test('health answers 200 when the database responds and 503 when it does not', async () => {
  const up = fakeRes();
  await healthHandler({ pool: {}, ping: async () => true })({}, up);
  assert.equal(up.statusCode, 200);
  assert.deepEqual(Object.keys(up.body).sort(), ['db', 'status', 'timestamp']);
  assert.equal(up.body.db, 'ok');

  const down = fakeRes();
  await healthHandler({ pool: {}, ping: async () => false })({}, down);
  assert.equal(down.statusCode, 503);
  assert.equal(down.body.db, 'down');
});

test('the database ping gives up after its timeout', async () => {
  const hanging = { query: () => new Promise(() => {}) };
  const started = Date.now();
  assert.equal(await pingDb(hanging, 50), false);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await pingDb({ query: async () => [[{ 1: 1 }]] }, 50), true);
  assert.equal(await pingDb({ query: async () => { throw new Error('ECONNREFUSED'); } }, 50), false);
});

// ---------------------------------------------------------------- realtime
const realtimeCtrl = require('../src/controllers/realtime.controller');
const realtime = require('../src/services/realtime.service');

test('REALTIME_ENABLED=0 answers 503 REALTIME_DISABLED and opens no stream', (t) => {
  withEnv(t, { REALTIME_ENABLED: '0' });
  const req = new EventEmitter();
  req.user = { sub: 77, entityId: 1 };
  const res = fakeRes();
  realtimeCtrl.stream(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'REALTIME_DISABLED');
  assert.equal(realtime.clientCount(77), 0);
});

test('realtime is on by default', (t) => {
  withEnv(t, { REALTIME_ENABLED: undefined });
  assert.equal(realtimeCtrl.realtimeEnabled(), true);
  process.env.REALTIME_ENABLED = '1';
  assert.equal(realtimeCtrl.realtimeEnabled(), true);
});

// -------------------------------------------------------------- rate limits
const { perUserLimiter, userKey, limitFromEnv } = require('../src/middleware/rateLimits');

test('rate limits are per user and answer 429 RATE_LIMITED', async () => {
  const limiter = perUserLimiter({ windowMs: 60000, limit: 2, message: 'pelan' });
  const run = (userId) => new Promise((resolve) => {
    const req = { user: { sub: userId }, ip: '10.0.0.1', headers: {}, app: { get: () => false } };
    const res = fakeRes();
    res.send = (body) => { res.body = body; resolve({ status: res.statusCode, body }); return res; };
    res.json = (body) => { res.body = body; resolve({ status: res.statusCode, body }); return res; };
    limiter(req, res, () => resolve({ status: 'next' }));
  });
  assert.equal((await run(1)).status, 'next');
  assert.equal((await run(1)).status, 'next');
  const blocked = await run(1);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.equal((await run(2)).status, 'next');
});

test('limiter keys and env parsing', (t) => {
  assert.equal(userKey({ user: { sub: 5 }, ip: '1.1.1.1' }), 'user:5');
  assert.equal(userKey({ ip: '1.1.1.1' }), 'ip:1.1.1.1');
  withEnv(t, { RATE_LIMIT_TEST: '0' });
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 30), 0);
  process.env.RATE_LIMIT_TEST = 'abc';
  assert.equal(limitFromEnv('RATE_LIMIT_TEST', 30), 30);
  const off = perUserLimiter({ windowMs: 1000, limit: 0, message: 'x' });
  let passed = false;
  off({}, {}, () => { passed = true; });
  assert.equal(passed, true);
});

// ------------------------------------------------- Claude Team gateway secrets
const pool = require('../src/db/pool');
const accounts = require('../src/services/ai/claudeTeamAccounts.service');

test('a new gateway secret is stored encrypted and read back in full only server-side', async (t) => {
  let stored = null;
  t.mock.method(pool, 'query', async (sql, args) => {
    const statement = String(sql);
    if (statement.startsWith('INSERT INTO')) { stored = args[3]; return [{ insertId: 4 }]; }
    return [[{
      id: 4, label: 'Cabang', mode: 'gateway', gateway_url: 'https://gw', gateway_secret: stored,
      model: 'sonnet', web_research: 0, enabled: 1, updated_at: null,
    }]];
  });
  const secret = 'gateway-secret-value-9876';
  const masked = await accounts.createAccount({ label: 'Cabang', mode: 'gateway', gatewayUrl: 'https://gw', gatewaySecret: secret, model: 'sonnet' }, 1);
  assert.ok(accounts.isSealed(stored));
  assert.ok(!stored.includes(secret));
  assert.ok(stored.length <= 255);
  assert.deepEqual(masked.gatewaySecret, { set: true, preview: '••••9876' });
  const full = await accounts.getAccount(4, { includeSecret: true });
  assert.equal(full.gatewaySecret, secret);
});

test('an old plain-text gateway secret still works', async (t) => {
  t.mock.method(pool, 'query', async () => [[{
    id: 1, label: 'Lama', mode: 'gateway', gateway_url: 'https://gw', gateway_secret: 'legacyplainsecret1234',
    model: 'sonnet', web_research: 0, enabled: 1, updated_at: null,
  }]]);
  assert.equal((await accounts.getAccount(1, { includeSecret: true })).gatewaySecret, 'legacyplainsecret1234');
  assert.deepEqual((await accounts.getAccount(1)).gatewaySecret, { set: true, preview: '••••1234' });
});

test('updating an account without a new secret re-saves the same secret encrypted', async (t) => {
  const sealed = accounts.sealSecret('existing-secret-abcdef');
  let written = null;
  t.mock.method(pool, 'query', async (sql, args) => {
    const statement = String(sql);
    if (statement.startsWith('UPDATE')) { written = args[3]; return [{ affectedRows: 1 }]; }
    return [[{
      id: 2, label: 'X', mode: 'gateway', gateway_url: 'https://gw', gateway_secret: written || sealed,
      model: 'sonnet', web_research: 0, enabled: 1, updated_at: null,
    }]];
  });
  await accounts.updateAccount(2, { label: 'Y' }, 1);
  assert.ok(accounts.isSealed(written));
  assert.equal(accounts.openSecret(written), 'existing-secret-abcdef');
});

test('a secret too long for the column is refused before any query', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    accounts.createAccount({ label: 'X', mode: 'gateway', gatewayUrl: 'https://gw', gatewaySecret: 'x'.repeat(accounts.MAX_SECRET_BYTES + 1), model: 'sonnet' }, 1),
    { code: 'VALIDATION_ERROR' },
  );
  assert.ok(accounts.sealSecret('x'.repeat(accounts.MAX_SECRET_BYTES)).length <= 255);
});

// -------------------------------------------------------------- Google login
test('Google login requires a verified email', async (t) => {
  const { OAuth2Client } = require('google-auth-library');
  let payload = { sub: '1', email: 'a@prakasagroup.com', hd: 'prakasagroup.com', email_verified: false };
  t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({ getPayload: () => payload }));
  withEnv(t, { GOOGLE_ALLOWED_DOMAIN: 'prakasagroup.com' });
  const googleAuth = require('../src/services/googleAuth.service');
  await assert.rejects(googleAuth.verifyGoogleIdToken('token'), { code: 'GOOGLE_EMAIL_NOT_VERIFIED', status: 403 });
  payload = { ...payload, email_verified: undefined };
  await assert.rejects(googleAuth.verifyGoogleIdToken('token'), { code: 'GOOGLE_EMAIL_NOT_VERIFIED' });
  payload = { ...payload, email_verified: true };
  assert.equal((await googleAuth.verifyGoogleIdToken('token')).email, 'a@prakasagroup.com');
});

// ------------------------------------------------- URLs required in production
test('QR links use PUBLIC_WEB_URL and fail clearly in production without it', () => {
  const qr = require('../src/services/qrCode.service');
  assert.equal(qr.publicWebUrl({ PUBLIC_WEB_URL: 'https://web.test' }), 'https://web.test');
  assert.equal(qr.publicWebUrl({ NODE_ENV: 'development' }), 'http://localhost:5173');
  assert.throws(() => qr.publicWebUrl({ NODE_ENV: 'production' }), { code: 'PUBLIC_WEB_URL_MISSING' });
});

test('the Accurate return URL never falls back to a guessed domain in production', () => {
  const accurate = require('../src/services/accurate/accurateConnection.service');
  assert.match(accurate.resultUrl(null, { PUBLIC_WEB_URL: 'https://web.test/' }), /^https:\/\/web\.test\/admin/);
  assert.match(accurate.resultUrl(null, { CORS_ORIGINS: 'https://a.test,https://b.test' }), /^https:\/\/a\.test\//);
  assert.throws(() => accurate.resultUrl(null, { NODE_ENV: 'production' }), { code: 'PUBLIC_WEB_URL_MISSING' });
});

test('the agent API URL defaults to 127.0.0.1 only outside production', () => {
  const agentRun = require('../src/services/ai/agent/agentRun');
  assert.equal(agentRun.apiBase({ PORT: '3099' }), 'http://127.0.0.1:3099/api/v1');
  assert.equal(agentRun.apiBase({ NODE_ENV: 'production' }), null);
  assert.equal(agentRun.apiBase({ NODE_ENV: 'production', PRAKASA_AGENT_API_URL: 'https://api.test/api/v1' }), 'https://api.test/api/v1');
});

test.after(() => pool.end());
