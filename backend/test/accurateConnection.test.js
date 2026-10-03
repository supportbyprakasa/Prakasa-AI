const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const accurate = require('../src/services/accurate/accurateConnection.service');
const { buildAuthorizeUrl, accurateTokenRequest, onlyViewScopes } = require('../src/services/accurate/accurateReadOnly');
const ctrl = require('../src/controllers/accurateIntegration.controller');

// Never talks to Accurate: every "Accurate" answer below is a fake fetch.

const ENV = {
  ACCURATE_CLIENT_ID: 'client-id-test',
  ACCURATE_CLIENT_SECRET: 'client-secret-test',
  ACCURATE_REDIRECT_URI: 'https://api.example.test/api/v1/integrations/accurate/callback',
  ACCURATE_SCOPES: '',
  ACCURATE_DB_NAME: '',
  PUBLIC_WEB_URL: 'https://web.example.test',
  SIGNATURE_ENCRYPTION_KEY: 'k'.repeat(40),
};
const ACCESS = 'ACCESS-TOKEN-SHOULD-NEVER-LEAK';
const REFRESH = 'REFRESH-TOKEN-SHOULD-NEVER-LEAK';

function withEnv(t, overrides = {}) {
  const saved = {};
  for (const [k, v] of Object.entries({ ...ENV, ...overrides })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

// A tiny stand-in for the two tables and the activity log.
function fakeDb(t) {
  const db = { states: [], connections: new Map(), logs: [], nextId: 1 };
  t.mock.method(pool, 'query', async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('DELETE FROM accurate_oauth_states')) return [{ affectedRows: 0 }];
    if (q.startsWith('INSERT INTO accurate_oauth_states')) {
      const [stateHash, entityId, userId, expiresAt] = params;
      db.states.push({ id: db.nextId++, state_hash: stateHash, entity_id: entityId, user_id: userId, expires_at: expiresAt, used_at: null });
      return [{ insertId: db.nextId - 1 }];
    }
    if (q.startsWith('SELECT id, entity_id, user_id, expires_at, used_at FROM accurate_oauth_states')) {
      return [db.states.filter((s) => s.state_hash === params[0]).map((s) => ({ ...s }))];
    }
    if (q.startsWith('UPDATE accurate_oauth_states SET used_at')) {
      const row = db.states.find((s) => s.id === params[1] && !s.used_at);
      if (row) row.used_at = params[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('INSERT INTO activity_logs')) {
      db.logs.push({ action: params[2], entityId: params[0], userId: params[1], metadata: params[5] });
      return [{}];
    }
    if (q.startsWith('SELECT c.id')) {
      const row = db.connections.get(params[0]);
      return [row ? [{ ...row, connected_by_name: row.connected_by ? 'Super Admin' : null }] : []];
    }
    if (q.startsWith("INSERT INTO accurate_connections (entity_id, status, tokens_encrypted")) {
      const [entityId, enc, iv, tag, expiresAt, scope, dbId, dbAlias, by, at] = params;
      db.connections.set(entityId, {
        id: 1, entity_id: entityId, status: 'connected', tokens_encrypted: enc, tokens_iv: iv, tokens_auth_tag: tag,
        expires_at: expiresAt, granted_scope: scope, accurate_db_id: dbId, accurate_db_alias: dbAlias,
        connected_by: by, connected_at: at, last_refreshed_at: null, last_error: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("INSERT INTO accurate_connections (entity_id, status, last_error)")) {
      const [entityId, reason] = params;
      const row = db.connections.get(entityId);
      if (row) row.last_error = reason;
      else db.connections.set(entityId, { entity_id: entityId, status: 'error', last_error: reason });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE accurate_connections SET tokens_encrypted')) {
      const [enc, iv, tag, expiresAt, scope, at, entityId] = params;
      Object.assign(db.connections.get(entityId), {
        tokens_encrypted: enc, tokens_iv: iv, tokens_auth_tag: tag, expires_at: expiresAt,
        granted_scope: scope, last_refreshed_at: at, last_error: null, status: 'connected',
      });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith("UPDATE accurate_connections SET status='error'")) {
      // Follows the SQL: only the columns it really sets to NULL are wiped.
      const row = db.connections.get(params[params.length - 1]);
      Object.assign(row, { status: 'error', last_error: params[0] });
      for (const col of ['tokens_encrypted', 'tokens_iv', 'tokens_auth_tag', 'expires_at']) {
        if (new RegExp(`\\b${col}=NULL`).test(q)) row[col] = null;
      }
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE accurate_connections SET last_error')) {
      db.connections.get(params[1]).last_error = params[0];
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('DELETE FROM accurate_connections')) {
      db.connections.delete(params[0]);
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT * FROM accurate_app_credentials')) return [db.creds ? [{ ...db.creds }] : []];
    if (q.startsWith('INSERT INTO accurate_app_credentials')) {
      const [clientId, enc, iv, tag, uri, by] = params;
      db.creds = { id: 1, client_id: clientId, secret_encrypted: enc, secret_iv: iv, secret_auth_tag: tag, redirect_uri: uri, updated_by: by };
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unexpected query: ${q}`);
  });
  return db;
}

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body };
}

// Fake Accurate: token endpoint + db-list. Records every request.
function fakeAccurate({ scope = accurate.DEFAULT_SCOPES, databases, tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith('/oauth/token')) {
      if (tokenStatus !== 200) return jsonResponse(tokenStatus, { error: 'invalid_grant' });
      return jsonResponse(200, { access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', expires_in: 1296000, scope });
    }
    if (url.includes('/api/db-list.do')) {
      return jsonResponse(200, { s: true, d: databases || [
        { id: 111, alias: 'prakasa food ( Trial )' },
        { id: 222, alias: 'PT. PRAKASA FOODS NUSANTARA' },
      ] });
    }
    throw new Error(`unexpected Accurate call ${init.method} ${url}`);
  };
  return { calls, fetchImpl };
}

const stateFrom = (authorizeUrl) => new URL(authorizeUrl).searchParams.get('state');

test('connect without Client ID answers "belum dikonfigurasi" instead of crashing', async (t) => {
  withEnv(t, { ACCURATE_CLIENT_ID: '' });
  fakeDb(t);
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await ctrl.connect({ user: { sub: 2, entityId: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error.message, /belum dikonfigurasi/);
});

test('the authorize URL asks only for *_view scopes and carries a fresh state', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const { authorizeUrl, expiresInSeconds } = await accurate.startConnect({ entityId: 1, userId: 2 });
  const url = new URL(authorizeUrl);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), ENV.ACCURATE_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), ENV.ACCURATE_REDIRECT_URI);
  assert.equal(url.searchParams.get('scope'), accurate.DEFAULT_SCOPES);
  assert.ok(stateFrom(authorizeUrl).length >= 40);
  assert.equal(expiresInSeconds, 600);
  // Only a hash of the state is stored, bound to user + entity.
  assert.notEqual(db.states[0].state_hash, stateFrom(authorizeUrl));
  assert.deepEqual([db.states[0].entity_id, db.states[0].user_id], [1, 2]);
  assert.ok(!authorizeUrl.includes(ENV.ACCURATE_CLIENT_SECRET));

  assert.throws(() => buildAuthorizeUrl({ clientId: 'x', redirectUri: 'https://a.test', scope: 'item_view item_save', state: 's' }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
  assert.equal(onlyViewScopes('customer_view item_view'), true);
  assert.equal(onlyViewScopes('customer_view sales_invoice_save'), false);
  assert.equal(onlyViewScopes(''), false);
});

test('a write scope in ACCURATE_SCOPES or a Trial ACCURATE_DB_NAME refuses to start', async (t) => {
  withEnv(t, { ACCURATE_SCOPES: 'customer_view customer_save' });
  fakeDb(t);
  await assert.rejects(() => accurate.startConnect({ entityId: 1, userId: 2 }), (e) => e.reason === 'scope_not_readonly');
  process.env.ACCURATE_SCOPES = '';
  process.env.ACCURATE_DB_NAME = 'prakasa food ( Trial )';
  await assert.rejects(() => accurate.startConnect({ entityId: 1, userId: 2 }), (e) => e.reason === 'db_name_trial');
});

test('state is single use and expires after 10 minutes', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const now = new Date('2026-09-29T08:00:00Z');
  const state = await accurate.createState({ entityId: 1, userId: 2, now });
  assert.deepEqual(await accurate.consumeState(state, { now }), { entityId: 1, userId: 2 });
  await assert.rejects(() => accurate.consumeState(state, { now }), (e) => e.reason === 'state_used');

  const late = await accurate.createState({ entityId: 1, userId: 2, now });
  await assert.rejects(
    () => accurate.consumeState(late, { now: new Date(now.getTime() + accurate.STATE_TTL_MS + 1000) }),
    (e) => e.reason === 'state_expired',
  );
  assert.ok(db.states[1].used_at, 'an expired state is burnt too');
  await assert.rejects(() => accurate.consumeState('made-up', { now }), (e) => e.reason === 'state_invalid');
  await assert.rejects(() => accurate.consumeState(undefined, { now }), (e) => e.reason === 'state_invalid');
});

test('database selection takes only the production alias, never Trial', () => {
  const prod = { id: 222, alias: 'PT. PRAKASA FOODS NUSANTARA' };
  const trial = { id: 111, alias: 'prakasa food ( Trial )' };
  assert.deepEqual(accurate.selectDatabase([trial, prod], accurate.DEFAULT_DB_NAME), { id: '222', alias: prod.alias });
  assert.deepEqual(accurate.selectDatabase([{ id: 5, alias: '  pt. prakasa  foods nusantara ' }], accurate.DEFAULT_DB_NAME).id, '5');
  assert.throws(() => accurate.selectDatabase([trial], accurate.DEFAULT_DB_NAME), (e) => e.reason === 'db_trial_only');
  assert.throws(() => accurate.selectDatabase([{ id: 3, alias: 'PT LAIN' }], accurate.DEFAULT_DB_NAME), (e) => e.reason === 'db_not_found');
  assert.throws(() => accurate.selectDatabase([], accurate.DEFAULT_DB_NAME), (e) => e.reason === 'db_not_found');
  assert.throws(() => accurate.selectDatabase([{ id: 9, alias: 'PT. PRAKASA FOODS NUSANTARA Trial' }], 'PT. PRAKASA FOODS NUSANTARA Trial'), (e) => e.reason === 'db_name_trial');
});

test('tokens are encrypted at rest and decrypt back', (t) => {
  withEnv(t);
  const sealed = accurate.encryptTokens({ accessToken: ACCESS, refreshToken: REFRESH });
  assert.ok(Buffer.isBuffer(sealed.encrypted));
  assert.equal(sealed.encrypted.toString('utf8').includes(ACCESS), false);
  assert.deepEqual(accurate.decryptTokens(sealed), { accessToken: ACCESS, refreshToken: REFRESH });
  const tampered = { ...sealed, encrypted: Buffer.from(sealed.encrypted) };
  tampered.encrypted[0] ^= 1;
  assert.throws(() => accurate.decryptTokens(tampered));
});

test('callback: exchanges the code, picks production and redirects without any secret', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const accurateFake = fakeAccurate();
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  const target = await accurate.handleCallback({ query: { code: 'one-time-code', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });

  assert.equal(target, 'https://web.example.test/admin/accurate?accurate=connected');
  for (const secret of [ACCESS, REFRESH, 'one-time-code', ENV.ACCURATE_CLIENT_SECRET]) assert.equal(target.includes(secret), false);

  const [token, list] = accurateFake.calls;
  assert.equal(token.method, 'POST');
  assert.equal(token.headers.Authorization, `Basic ${Buffer.from(`${ENV.ACCURATE_CLIENT_ID}:${ENV.ACCURATE_CLIENT_SECRET}`).toString('base64')}`);
  const form = new URLSearchParams(token.body);
  assert.deepEqual([form.get('grant_type'), form.get('code'), form.get('redirect_uri')], ['authorization_code', 'one-time-code', ENV.ACCURATE_REDIRECT_URI]);
  assert.equal(list.method, 'GET');
  assert.equal(list.headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(accurateFake.calls.length, 2, 'nothing else is requested');

  const row = db.connections.get(1);
  assert.equal(row.status, 'connected');
  assert.equal(row.accurate_db_id, '222');
  assert.equal(row.tokens_encrypted.toString('utf8').includes(ACCESS), false);

  const status = await accurate.getStatus(1);
  assert.equal(status.connected, true);
  assert.equal(status.database, 'PT. PRAKASA FOODS NUSANTARA');
  assert.equal(JSON.stringify(status).includes(ACCESS) || JSON.stringify(status).includes(REFRESH), false);
  assert.ok(db.logs.some((l) => l.action === 'accurate.connect'));
  assert.equal(JSON.stringify(db.logs).includes(ACCESS), false);

  // Replaying the same callback does nothing.
  const replay = await accurate.handleCallback({ query: { code: 'one-time-code', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });
  assert.equal(replay, 'https://web.example.test/admin/accurate?accurate=error&reason=state_used');
  assert.equal(accurateFake.calls.length, 2);
});

test('callback refuses a token that carries a write scope and stores nothing', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const accurateFake = fakeAccurate({ scope: 'customer_view sales_invoice_save' });
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  const target = await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });
  assert.equal(target, 'https://web.example.test/admin/accurate?accurate=error&reason=scope_not_readonly');
  assert.equal(accurateFake.calls.length, 1, 'db-list is never read with a write-capable token');
  const row = db.connections.get(1);
  assert.equal(row.status, 'error');
  assert.equal(row.tokens_encrypted, undefined);
  const failed = db.logs.find((l) => l.action === 'accurate.connect.failed');
  assert.match(failed.metadata, /scope_not_readonly/);
  assert.equal(failed.metadata.includes(ACCESS), false);
});

test('callback refuses an account with only the Trial database', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const accurateFake = fakeAccurate({ databases: [{ id: 111, alias: 'prakasa food ( Trial )' }] });
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  const target = await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });
  assert.equal(target, 'https://web.example.test/admin/accurate?accurate=error&reason=db_trial_only');
  assert.equal(db.connections.get(1).tokens_encrypted, undefined);
});

test('callback handles a denied consent and an unknown state', async (t) => {
  withEnv(t);
  fakeDb(t);
  const accurateFake = fakeAccurate();
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  assert.match(await accurate.handleCallback({ query: { error: 'access_denied', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl }), /reason=denied$/);
  assert.match(await accurate.handleCallback({ query: { code: 'c', state: 'nope' }, fetchImpl: accurateFake.fetchImpl }), /reason=state_invalid$/);
  assert.equal(accurateFake.calls.length, 0);
});

test('callback endpoint answers with a no-store redirect', async (t) => {
  withEnv(t);
  fakeDb(t);
  const res = { headers: {}, set(k, v) { this.headers[k] = v; }, redirect(code, url) { this.code = code; this.url = url; } };
  await ctrl.callback({ query: { code: 'c', state: 'unknown' } }, res);
  assert.equal(res.code, 302);
  assert.equal(res.url, 'https://web.example.test/admin/accurate?accurate=error&reason=state_invalid');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('refresh swaps tokens; getAccessToken refreshes only within 2 days of expiry', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const accurateFake = fakeAccurate();
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });
  accurateFake.calls.length = 0;

  const expiresAt = new Date(db.connections.get(1).expires_at);
  const early = await accurate.getAccessToken(1, { fetchImpl: accurateFake.fetchImpl, now: new Date(expiresAt.getTime() - 5 * 86400000) });
  assert.deepEqual(early, { accessToken: ACCESS, dbId: '222', dbAlias: 'PT. PRAKASA FOODS NUSANTARA' });
  assert.equal(accurateFake.calls.length, 0);

  await accurate.getAccessToken(1, { fetchImpl: accurateFake.fetchImpl, now: new Date(expiresAt.getTime() - 86400000) });
  assert.equal(accurateFake.calls.length, 1);
  const form = new URLSearchParams(accurateFake.calls[0].body);
  assert.deepEqual([form.get('grant_type'), form.get('refresh_token')], ['refresh_token', REFRESH]);
  assert.ok(db.connections.get(1).last_refreshed_at);
  assert.ok(db.logs.some((l) => l.action === 'accurate.refresh' && /"trigger":"auto"/.test(l.metadata)));
});

test('a refresh that returns a write scope drops the stored tokens', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const good = fakeAccurate();
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: good.fetchImpl });
  const bad = fakeAccurate({ scope: 'item_view item_delete' });
  await assert.rejects(() => accurate.refresh({ entityId: 1, userId: 2, fetchImpl: bad.fetchImpl }), (e) => e.reason === 'scope_not_readonly');
  const row = db.connections.get(1);
  assert.equal(row.status, 'error');
  for (const col of ['tokens_encrypted', 'tokens_iv', 'tokens_auth_tag', 'expires_at']) assert.equal(row[col], null, col);
  assert.ok(db.logs.some((l) => l.action === 'accurate.refresh.failed'));  await assert.rejects(() => accurate.getAccessToken(1), (e) => e.reason === 'not_connected', 'the sync can no longer read');
});

test('the automatic refresh before a pull wipes a write-capable grant the same way', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: fakeAccurate().fetchImpl });
  const expiresAt = new Date(db.connections.get(1).expires_at);
  const bad = fakeAccurate({ scope: 'item_view item_save' });
  await assert.rejects(
    () => accurate.getAccessToken(1, { fetchImpl: bad.fetchImpl, now: new Date(expiresAt.getTime() - 86400000) }),
    (e) => e.reason === 'scope_not_readonly',
  );
  assert.deepEqual(bad.calls.map((c) => new URL(c.url).pathname), ['/oauth/token'], 'no data read with that grant');
  const row = db.connections.get(1);
  for (const col of ['tokens_encrypted', 'tokens_iv', 'tokens_auth_tag', 'expires_at']) assert.equal(row[col], null, col);
});

// Fake Accurate whose token answer is sent exactly as given (scope may be absent).
function rawTokenAccurate(body) {
  return async (url) => {
    if (url.endsWith('/oauth/token')) return jsonResponse(200, body);
    if (url.includes('/api/db-list.do')) return jsonResponse(200, { s: true, d: [{ id: 222, alias: 'PT. PRAKASA FOODS NUSANTARA' }] });
    throw new Error(`unexpected Accurate call ${url}`);
  };
}

test('a token answer without a scope, or with an empty one, is refused on callback and on refresh', async (t) => {
  withEnv(t);
  const token = { access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', expires_in: 1296000 };
  // A list-shaped scope is judged entry by entry, so a write scope inside a list is refused too.
  for (const body of [token, { ...token, scope: '' }, { ...token, scope: null }, { ...token, scope: ['item_view', 'item_save'] }]) {
    const db = fakeDb(t);
    const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
    const location = await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: rawTokenAccurate(body) });
    assert.match(String(location), /scope_not_readonly/, JSON.stringify(body.scope));
    assert.ok(!db.connections.get(1)?.tokens_encrypted, 'nothing stored');
    t.mock.restoreAll();
  }
  const db = fakeDb(t);
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: fakeAccurate().fetchImpl });
  await assert.rejects(() => accurate.refresh({ entityId: 1, userId: 2, fetchImpl: rawTokenAccurate(token) }), (e) => e.reason === 'scope_not_readonly');
  assert.equal(db.connections.get(1).tokens_encrypted, null, 'a grant of unknown scope is dropped');
});

test('ACCURATE_SCOPES may narrow the approved list, never widen it — not even with another *_view', async (t) => {
  withEnv(t, { ACCURATE_SCOPES: 'customer_view sales_checkin_view' });
  fakeDb(t);
  await assert.rejects(() => accurate.startConnect({ entityId: 1, userId: 2 }), (e) => e.reason === 'scope_not_approved');
  process.env.ACCURATE_SCOPES = 'customer_view access_privilege_view';
  await assert.rejects(() => accurate.startConnect({ entityId: 1, userId: 2 }), (e) => e.reason === 'scope_not_approved');
  process.env.ACCURATE_SCOPES = 'customer_view item_view';
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  assert.equal(new URL(authorizeUrl).searchParams.get('scope'), 'customer_view item_view');
});

test('the OAuth callback must be HTTPS (plain HTTP only on this machine) with no user info', () => {
  const path = '/api/v1/integrations/accurate/callback';
  for (const ok of [`https://api.prakasa-work-os.com${path}`, `http://127.0.0.1:3001${path}`, `http://localhost:3001${path}`]) {
    assert.equal(accurate.validRedirectUri(ok), true, ok);
  }
  for (const bad of [`http://evil.example${path}`, `https://user:pw@api.example.test${path}`, `https://api.example.test${path}?x=1`,
    `https://api.example.test/other`, `ftp://api.example.test${path}`, 'not a url']) {
    assert.equal(accurate.validRedirectUri(bad), false, bad);
  }
});

test('disconnect forgets the tokens locally without calling Accurate', async (t) => {
  withEnv(t);
  const db = fakeDb(t);
  const accurateFake = fakeAccurate();
  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  await accurate.handleCallback({ query: { code: 'c', state: stateFrom(authorizeUrl) }, fetchImpl: accurateFake.fetchImpl });
  accurateFake.calls.length = 0;
  const status = await accurate.disconnect({ entityId: 1, userId: 2 });
  assert.equal(status.connected, false);
  assert.equal(db.connections.has(1), false);
  assert.equal(accurateFake.calls.length, 0);
  assert.ok(db.logs.some((l) => l.action === 'accurate.disconnect'));
});

test('the token POST refuses other grants and never follows a redirect', async () => {
  await assert.rejects(() => accurateTokenRequest({ grant_type: 'client_credentials' }, { fetchImpl: async () => { throw new Error('must not call'); } }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
  const redirecting = async () => ({ status: 302, headers: { get: () => 'https://evil.example.com/' } });
  await assert.rejects(() => accurateTokenRequest({ grant_type: 'refresh_token', refresh_token: 'x' }, { clientId: 'a', clientSecret: 'b', fetchImpl: redirecting }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
});

// ------------------------------------------------------------------ credentials entered in the app

const NO_ENV = { ACCURATE_CLIENT_ID: '', ACCURATE_CLIENT_SECRET: '', ACCURATE_REDIRECT_URI: '' };
const LOCAL_CALLBACK = 'http://127.0.0.1:3001/api/v1/integrations/accurate/callback';
const SECRET = 'SECRET-FROM-DEVELOPER-PAGE';

test('credentials typed into the app are stored encrypted, never returned, and used to connect', async (t) => {
  withEnv(t, NO_ENV);
  const db = fakeDb(t);
  assert.equal((await accurate.getStatus(1)).configured, false);
  const status = await accurate.saveCredentials({ clientId: 'cid-1234', clientSecret: SECRET, redirectUri: LOCAL_CALLBACK, entityId: 1, userId: 2 });
  assert.equal(status.configured, true);
  assert.deepEqual(status.credentials, { source: 'app', clientIdEnd: '1234', hasSecret: true, redirectUri: LOCAL_CALLBACK });
  assert.doesNotMatch(JSON.stringify(status), new RegExp(SECRET));
  assert.doesNotMatch(Buffer.from(db.creds.secret_encrypted).toString('latin1'), new RegExp(SECRET), 'secret is encrypted at rest');
  assert.ok(db.logs.some((l) => l.action === 'accurate.credentials.update' && !String(l.metadata).includes(SECRET)));

  const { authorizeUrl } = await accurate.startConnect({ entityId: 1, userId: 2 });
  const url = new URL(authorizeUrl);
  assert.equal(url.searchParams.get('client_id'), 'cid-1234');
  assert.equal(url.searchParams.get('redirect_uri'), LOCAL_CALLBACK);
  assert.equal((await accurate.loadConfig()).clientSecret, SECRET, 'server side only');
});

test('credentials are validated; an empty secret keeps the stored one; .env wins and locks the form', async (t) => {
  withEnv(t, NO_ENV);
  const db = fakeDb(t);
  const save = (over) => accurate.saveCredentials({ clientId: 'cid-1234', clientSecret: SECRET, redirectUri: LOCAL_CALLBACK, entityId: 1, userId: 2, ...over });
  await assert.rejects(save({ redirectUri: 'http://127.0.0.1:3001/lain' }), /URL OAuth Callback/);
  await assert.rejects(save({ clientSecret: '' }), /Client Secret wajib/);
  await assert.rejects(save({ clientId: 'ada spasi' }), /Client ID tidak valid/);
  await save({});
  await save({ clientId: 'cid-9999', clientSecret: '' });
  assert.equal(db.creds.client_id, 'cid-9999');
  assert.equal((await accurate.loadConfig()).clientSecret, SECRET);
  t.mock.restoreAll();

  withEnv(t, {});
  fakeDb(t);
  await assert.rejects(save({}), /backend\/.env/);
  assert.equal((await accurate.getStatus(1)).credentials.source, 'env');
});
