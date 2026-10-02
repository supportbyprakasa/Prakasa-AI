// "Sambungkan Accurate" — the OAuth 2.0 connection of an entity to Accurate
// Online, read-only.
//
//   1. Super Admin presses "Sambungkan" → startConnect() stores a single-use
//      state (10 minutes, bound to that user + entity) and returns the
//      authorize URL the browser opens.
//   2. Accurate redirects the browser to GET /integrations/accurate/callback →
//      handleCallback() consumes the state, exchanges the code, refuses any
//      scope that is not *_view, picks the production database by name
//      (never a Trial one) and stores the tokens encrypted.
//   3. getAccessToken() hands a valid token to the (future) sync client and
//      refreshes it first when it expires within 2 days.
//
// Every Accurate request goes through accurateReadOnly.js. Tokens never leave
// this module except as the return value of getAccessToken() (server side).

const crypto = require('crypto');
const pool = require('../../db/pool');
const logger = require('../../utils/logger');
const { encryptBuffer, decryptBuffer } = require('../signature.service');
const { log } = require('../activityLog.service');
const readOnly = require('./accurateReadOnly');

// Exactly the read (*_view) scopes of what accurateReadOnly.js may read.
const DEFAULT_SCOPES = readOnly.VIEW_SCOPES.join(' ');
const DEFAULT_DB_NAME = 'PT. PRAKASA FOODS NUSANTARA';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const ADMIN_PAGE = '/admin/accurate';

// Short codes travel in the redirect (?reason=…) and in last_error; the
// messages are what the admin reads. Never a token, never Accurate's raw body.
const REASONS = Object.freeze({
  not_configured: 'Integrasi Accurate belum dikonfigurasi. Isi Kredensial aplikasi Accurate (Client ID, Client Secret, URL OAuth Callback) di halaman ini.',
  db_name_trial: 'ACCURATE_DB_NAME menunjuk database Trial. Integrasi hanya boleh ke database produksi.',
  state_invalid: 'Tautan penyambungan tidak dikenal. Ulangi dari tombol "Sambungkan Accurate".',
  state_expired: 'Tautan penyambungan sudah kedaluwarsa (lebih dari 10 menit). Ulangi dari tombol "Sambungkan Accurate".',
  state_used: 'Tautan penyambungan sudah pernah dipakai. Ulangi dari tombol "Sambungkan Accurate".',
  denied: 'Akses ditolak di halaman Accurate. Tidak ada yang disimpan.',
  code_missing: 'Accurate tidak mengirim kode otorisasi. Ulangi penyambungan.',
  token_failed: 'Accurate menolak penukaran token. Periksa Client ID, Client Secret dan URL callback.',
  scope_not_readonly: 'Accurate memberi izin selain "lihat" (*_view). Token ditolak dan tidak disimpan — aplikasi hanya boleh membaca.',
  scope_not_approved: 'ACCURATE_SCOPES meminta izin di luar daftar yang disetujui owner. Kosongkan ACCURATE_SCOPES atau pakai sebagian dari daftar itu.',
  db_list_failed: 'Gagal membaca daftar database Accurate.',
  db_not_found: 'Database produksi Accurate tidak ditemukan di akun ini. Pastikan akun yang login punya akses ke database tersebut.',
  db_trial_only: 'Akun ini hanya punya database Trial. Integrasi hanya boleh ke database produksi.',
  not_connected: 'Accurate belum tersambung.',
  refresh_failed: 'Gagal memperbarui token Accurate. Sambungkan ulang bila berlanjut.',
  internal: 'Terjadi kesalahan saat menyambungkan Accurate. Coba lagi.',
});

class AccurateConnectionError extends Error {
  constructor(reason, status = 400) {
    super(REASONS[reason] || REASONS.internal);
    this.reason = REASONS[reason] ? reason : 'internal';
    this.code = `ACCURATE_${this.reason.toUpperCase()}`;
    this.status = status;
  }
}

const isTrial = (name) => /trial/i.test(String(name || ''));
const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const hashState = (state) => crypto.createHash('sha256').update(String(state)).digest('hex');

function config(env = process.env) {
  const clientId = (env.ACCURATE_CLIENT_ID || '').trim();
  const clientSecret = (env.ACCURATE_CLIENT_SECRET || '').trim();
  const redirectUri = (env.ACCURATE_REDIRECT_URI || '').trim();
  const scopes = (env.ACCURATE_SCOPES || '').trim() || DEFAULT_SCOPES;
  const dbName = (env.ACCURATE_DB_NAME || '').trim() || DEFAULT_DB_NAME;
  return {
    clientId, clientSecret, redirectUri, scopes, dbName,
    configured: Boolean(clientId && clientSecret && redirectUri),
  };
}

// Credentials entered in the app (Administrasi → Integrasi Accurate) fill in
// whatever backend/.env leaves empty; .env wins when it has them.
const CALLBACK_PATH = '/api/v1/integrations/accurate/callback';

async function storedCredentials() {
  const [[row]] = await pool.query('SELECT * FROM accurate_app_credentials WHERE id = 1 LIMIT 1');
  if (!row) return null;
  const secret = decryptBuffer({ encrypted: Buffer.from(row.secret_encrypted), iv: row.secret_iv, authTag: row.secret_auth_tag }).toString('utf8');
  return { clientId: row.client_id, clientSecret: secret, redirectUri: row.redirect_uri, updatedAt: row.updated_at };
}

async function loadConfig(env = process.env) {
  const cfg = config(env);
  if (cfg.configured) return { ...cfg, source: 'env' };
  const stored = await storedCredentials();
  if (!stored) return { ...cfg, source: null };
  const merged = {
    ...cfg,
    clientId: cfg.clientId || stored.clientId,
    clientSecret: cfg.clientSecret || stored.clientSecret,
    redirectUri: cfg.redirectUri || stored.redirectUri,
  };
  return { ...merged, configured: Boolean(merged.clientId && merged.clientSecret && merged.redirectUri), source: 'app' };
}

// HTTPS, or plain HTTP only on this machine (local development); no user info.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function validRedirectUri(uri) {
  try {
    const url = new URL(uri);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
    return secure && !url.username && !url.password && url.pathname === CALLBACK_PATH && !url.search && !url.hash;
  } catch { return false; }
}

// Saves the developer-app credentials. The secret may be left empty to keep the
// stored one (e.g. when only the callback URL changes).
async function saveCredentials({ clientId, clientSecret, redirectUri, entityId, userId }) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  const uri = String(redirectUri || '').trim();
  const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'VALIDATION_ERROR' });
  if (config().configured) throw invalid('Kredensial Accurate sudah diatur di backend/.env server; ubah di sana.');
  if (!id || id.length > 200 || /\s/.test(id)) throw invalid('Client ID tidak valid.');
  if (secret.length > 500 || /\s/.test(secret)) throw invalid('Client Secret tidak valid.');
  if (!validRedirectUri(uri)) throw invalid(`URL OAuth Callback harus HTTPS (HTTP hanya untuk localhost) dan berakhiran ${CALLBACK_PATH}.`);
  const existing = await storedCredentials();
  const finalSecret = secret || existing?.clientSecret;
  if (!finalSecret) throw invalid('Client Secret wajib diisi.');
  const sealed = encryptBuffer(Buffer.from(finalSecret, 'utf8'));
  await pool.query(
    `INSERT INTO accurate_app_credentials (id, client_id, secret_encrypted, secret_iv, secret_auth_tag, redirect_uri, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE client_id = VALUES(client_id), secret_encrypted = VALUES(secret_encrypted), secret_iv = VALUES(secret_iv),
       secret_auth_tag = VALUES(secret_auth_tag), redirect_uri = VALUES(redirect_uri), updated_by = VALUES(updated_by)`,
    [id, sealed.encrypted, sealed.iv, sealed.authTag, uri, userId],
  );
  await safeLog({
    entityId, userId, action: 'accurate.credentials.update', subjectType: 'accurate_connection',
    metadata: { clientIdEnd: id.slice(-4), secretChanged: Boolean(secret), redirectUri: uri },
  });
  return getStatus(entityId);
}

function assertConfigured(cfg) {
  if (!cfg.configured) throw new AccurateConnectionError('not_configured', 503);
  if (isTrial(cfg.dbName)) throw new AccurateConnectionError('db_name_trial', 503);
  if (!readOnly.onlyViewScopes(cfg.scopes)) throw new AccurateConnectionError('scope_not_readonly', 503);
  // Only what the owner approved (readOnly.VIEW_SCOPES) may be asked for — an
  // .env override can narrow that list, never widen it.
  if (!cfg.scopes.split(/[\s,]+/).filter(Boolean).every((sc) => readOnly.VIEW_SCOPES.includes(sc))) {
    throw new AccurateConnectionError('scope_not_approved', 503);
  }
}

// Where the browser returns after the Accurate login: PUBLIC_WEB_URL, else the
// first CORS origin. Production without either fails clearly instead of
// sending the admin to a guessed domain.
function webBase(env = process.env) {
  const firstOrigin = String(env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).find(Boolean);
  const base = String(env.PUBLIC_WEB_URL || '').trim() || firstOrigin;
  if (!base) {
    if (env.NODE_ENV === 'production') {
      throw Object.assign(new Error('PUBLIC_WEB_URL belum diatur di server.'), { status: 503, code: 'PUBLIC_WEB_URL_MISSING' });
    }
    return 'http://localhost:5173';
  }
  return base.replace(/\/+$/, '');
}

function resultUrl(reason = null, env = process.env) {
  const base = `${webBase(env)}${ADMIN_PAGE}`;
  return reason ? `${base}?accurate=error&reason=${encodeURIComponent(reason)}` : `${base}?accurate=connected`;
}

// --- tokens at rest -------------------------------------------------------

function encryptTokens({ accessToken, refreshToken }) {
  const { encrypted, iv, authTag } = encryptBuffer(Buffer.from(JSON.stringify({ accessToken, refreshToken }), 'utf8'));
  return { encrypted, iv, authTag };
}

function decryptTokens({ encrypted, iv, authTag }) {
  const plain = decryptBuffer({ encrypted: Buffer.from(encrypted), iv, authTag });
  const parsed = JSON.parse(plain.toString('utf8'));
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken || null };
}

// --- single-use state -----------------------------------------------------

async function createState({ entityId, userId, now = new Date() }) {
  const state = crypto.randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM accurate_oauth_states WHERE expires_at < ?', [new Date(now.getTime() - 24 * 60 * 60 * 1000)]);
  await pool.query(
    'INSERT INTO accurate_oauth_states (state_hash, entity_id, user_id, expires_at) VALUES (?, ?, ?, ?)',
    [hashState(state), entityId, userId, new Date(now.getTime() + STATE_TTL_MS)],
  );
  return state;
}

// Returns { entityId, userId } of the sign-in the state belongs to, or throws.
// The state is burnt on first sight, whatever happens next.
async function consumeState(state, { now = new Date() } = {}) {
  if (typeof state !== 'string' || !state || state.length > 200) throw new AccurateConnectionError('state_invalid');
  const [rows] = await pool.query(
    'SELECT id, entity_id, user_id, expires_at, used_at FROM accurate_oauth_states WHERE state_hash = ? LIMIT 1',
    [hashState(state)],
  );
  const row = rows[0];
  if (!row) throw new AccurateConnectionError('state_invalid');
  if (row.used_at) throw new AccurateConnectionError('state_used');
  const [result] = await pool.query(
    'UPDATE accurate_oauth_states SET used_at = ? WHERE id = ? AND used_at IS NULL',
    [now, row.id],
  );
  if (Number(result?.affectedRows) !== 1) throw new AccurateConnectionError('state_used');
  if (new Date(row.expires_at).getTime() <= now.getTime()) throw new AccurateConnectionError('state_expired');
  return { entityId: Number(row.entity_id), userId: Number(row.user_id) };
}

// --- Accurate calls (all through accurateReadOnly) ------------------------

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function requestToken(form, cfg, { fetchImpl, now = new Date() } = {}) {
  const res = await readOnly.accurateTokenRequest(form, { clientId: cfg.clientId, clientSecret: cfg.clientSecret, fetchImpl });
  const body = await readJson(res);
  if (!res.ok || !body?.access_token) {
    const reason = form.grant_type === 'refresh_token' ? 'refresh_failed' : 'token_failed';
    const error = new AccurateConnectionError(reason, 502);
    // Accurate's error code only (e.g. "invalid_grant") — never the body.
    error.detail = typeof body?.error === 'string' ? body.error.slice(0, 60) : `HTTP ${res.status}`;
    throw error;
  }
  if (!readOnly.onlyViewScopes(body.scope)) {
    const error = new AccurateConnectionError('scope_not_readonly', 403);
    error.detail = String(body.scope || '').split(/[\s,]+/).filter((s) => s && !s.endsWith('_view')).slice(0, 10).join(' ') || 'scope kosong';
    throw error;
  }
  const seconds = Number(body.expires_in);
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : null,
    scope: String(body.scope).split(/[\s,]+/).filter(Boolean).join(' '),
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? new Date(now.getTime() + seconds * 1000) : null,
  };
}

async function listDatabases(accessToken, { fetchImpl } = {}) {
  const res = await readOnly.accurateGet(readOnly.DB_LIST_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    fetchImpl,
  });
  const body = await readJson(res);
  if (!res.ok || !body || body.s === false || !Array.isArray(body.d)) throw new AccurateConnectionError('db_list_failed', 502);
  return body.d;
}

// Only the database named ACCURATE_DB_NAME, and never one called "Trial".
function selectDatabase(databases, dbName) {
  if (isTrial(dbName)) throw new AccurateConnectionError('db_name_trial');
  const target = normalizeName(dbName);
  const list = Array.isArray(databases) ? databases : [];
  const match = list.find((db) => normalizeName(db?.alias) === target && !isTrial(db?.alias));
  if (match) return { id: String(match.id), alias: String(match.alias) };
  if (list.length && list.every((db) => isTrial(db?.alias))) throw new AccurateConnectionError('db_trial_only');
  throw new AccurateConnectionError('db_not_found');
}

// --- persistence ----------------------------------------------------------

async function loadConnection(entityId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.entity_id, c.status, c.tokens_encrypted, c.tokens_iv, c.tokens_auth_tag,
            c.expires_at, c.granted_scope, c.accurate_db_id, c.accurate_db_alias,
            c.connected_by, u.name AS connected_by_name, c.connected_at, c.last_refreshed_at, c.last_error
       FROM accurate_connections c
       LEFT JOIN users u ON u.id = c.connected_by
      WHERE c.entity_id = ? LIMIT 1`,
    [entityId],
  );
  return rows[0] || null;
}

async function saveConnection({ entityId, userId, tokens, db, now }) {
  const sealed = encryptTokens(tokens);
  await pool.query(
    `INSERT INTO accurate_connections
       (entity_id, status, tokens_encrypted, tokens_iv, tokens_auth_tag, expires_at, granted_scope,
        accurate_db_id, accurate_db_alias, connected_by, connected_at, last_refreshed_at, last_error)
     VALUES (?, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON DUPLICATE KEY UPDATE status='connected', tokens_encrypted=VALUES(tokens_encrypted),
       tokens_iv=VALUES(tokens_iv), tokens_auth_tag=VALUES(tokens_auth_tag), expires_at=VALUES(expires_at),
       granted_scope=VALUES(granted_scope), accurate_db_id=VALUES(accurate_db_id),
       accurate_db_alias=VALUES(accurate_db_alias), connected_by=VALUES(connected_by),
       connected_at=VALUES(connected_at), last_refreshed_at=NULL, last_error=NULL`,
    [entityId, sealed.encrypted, sealed.iv, sealed.authTag, tokens.expiresAt, tokens.scope,
      db.id, db.alias, userId, now],
  );
}

// A failed attempt is remembered, but an existing working connection keeps
// its tokens and status.
async function recordFailure(entityId, reason) {
  if (!entityId) return;
  await pool.query(
    `INSERT INTO accurate_connections (entity_id, status, last_error) VALUES (?, 'error', ?)
     ON DUPLICATE KEY UPDATE last_error = VALUES(last_error)`,
    [entityId, reason],
  );
}

async function safeLog(entry) {
  try { await log(entry); } catch (error) { logger.error({ err: error.message }, '[accurate] activity log gagal'); }
}

// --- public operations ----------------------------------------------------

function toStatus(row, cfg = config()) {
  const connected = Boolean(row && row.status === 'connected' && row.tokens_encrypted);
  return {
    configured: cfg.configured,
    // Never the secret itself: only where credentials come from and the parts that are not secret.
    credentials: {
      source: cfg.source || (cfg.configured ? 'env' : null),
      clientIdEnd: cfg.clientId ? cfg.clientId.slice(-4) : null,
      hasSecret: Boolean(cfg.clientSecret),
      redirectUri: cfg.redirectUri || null,
    },
    readOnly: true,
    connected,
    status: connected ? 'connected' : (row?.status === 'error' ? 'error' : 'disconnected'),
    database: row?.accurate_db_alias || null,
    expectedDatabase: cfg.dbName,
    scopes: row?.granted_scope ? row.granted_scope.split(/\s+/).filter(Boolean) : [],
    requestedScopes: cfg.scopes.split(/[\s,]+/).filter(Boolean),
    // Scopes the app now reads but this connection was not granted yet → reconnect.
    missingScopes: row?.granted_scope
      ? cfg.scopes.split(/[\s,]+/).filter((sc) => sc && !row.granted_scope.split(/\s+/).includes(sc))
      : [],
    expiresAt: connected ? row.expires_at : null,
    connectedAt: row?.connected_at || null,
    connectedBy: row?.connected_by_name || null,
    lastRefreshedAt: row?.last_refreshed_at || null,
    lastError: row?.last_error || null,
    lastErrorMessage: row?.last_error ? (REASONS[row.last_error] || REASONS.internal) : null,
  };
}

async function getStatus(entityId) {
  return toStatus(await loadConnection(entityId), await loadConfig());
}

async function startConnect({ entityId, userId, now = new Date() }) {
  const cfg = await loadConfig();
  assertConfigured(cfg);
  const state = await createState({ entityId, userId, now });
  const authorizeUrl = readOnly.buildAuthorizeUrl({
    clientId: cfg.clientId, redirectUri: cfg.redirectUri, scope: cfg.scopes, state,
  });
  await safeLog({
    entityId, userId, action: 'accurate.connect.start', subjectType: 'accurate_connection',
    metadata: { scopes: cfg.scopes, database: cfg.dbName },
  });
  return { authorizeUrl, expiresInSeconds: STATE_TTL_MS / 1000 };
}

// Never throws: always resolves to the page the browser goes back to.
async function handleCallback({ query = {}, fetchImpl, now = new Date() } = {}) {
  let ctx = null;
  try {
    ctx = await consumeState(query.state, { now });
    if (query.error) throw new AccurateConnectionError('denied');
    if (!query.code || typeof query.code !== 'string') throw new AccurateConnectionError('code_missing');
    const cfg = await loadConfig();
    assertConfigured(cfg);

    const tokens = await requestToken({
      grant_type: 'authorization_code', code: query.code, redirect_uri: cfg.redirectUri,
    }, cfg, { fetchImpl, now });
    const db = selectDatabase(await listDatabases(tokens.accessToken, { fetchImpl }), cfg.dbName);

    await saveConnection({ entityId: ctx.entityId, userId: ctx.userId, tokens, db, now });
    await safeLog({
      entityId: ctx.entityId, userId: ctx.userId, action: 'accurate.connect', subjectType: 'accurate_connection',
      metadata: { database: db.alias, scope: tokens.scope, expiresAt: tokens.expiresAt },
    });
    return resultUrl(null);
  } catch (error) {
    const reason = error instanceof AccurateConnectionError ? error.reason : 'internal';
    if (reason === 'internal') logger.error({ err: error.code || error.name }, '[accurate] callback gagal');
    try { await recordFailure(ctx?.entityId, reason); } catch { /* reported by the log below */ }
    await safeLog({
      entityId: ctx?.entityId || null, userId: ctx?.userId || null, action: 'accurate.connect.failed',
      subjectType: 'accurate_connection', metadata: { reason, detail: error.detail || null },
    });
    return resultUrl(reason);
  }
}

async function refresh({ entityId, userId = null, trigger = 'manual', fetchImpl, now = new Date() }) {
  const cfg = await loadConfig();
  assertConfigured(cfg);
  const row = await loadConnection(entityId);
  if (!row || row.status !== 'connected' || !row.tokens_encrypted) throw new AccurateConnectionError('not_connected', 409);
  const current = decryptTokens({ encrypted: row.tokens_encrypted, iv: row.tokens_iv, authTag: row.tokens_auth_tag });
  if (!current.refreshToken) throw new AccurateConnectionError('refresh_failed', 409);

  let tokens;
  try {
    tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: current.refreshToken }, cfg, { fetchImpl, now });
  } catch (error) {
    const reason = error instanceof AccurateConnectionError ? error.reason : 'refresh_failed';
    if (reason === 'scope_not_readonly') {
      // A grant that could write is dropped entirely, not just ignored.
      await pool.query(
        `UPDATE accurate_connections SET status='error', tokens_encrypted=NULL, tokens_iv=NULL, tokens_auth_tag=NULL,
                expires_at=NULL, last_error=? WHERE entity_id=?`,
        [reason, entityId],
      );
    } else {
      await pool.query('UPDATE accurate_connections SET last_error=? WHERE entity_id=?', [reason, entityId]);
    }
    await safeLog({
      entityId, userId, action: 'accurate.refresh.failed', subjectType: 'accurate_connection',
      metadata: { trigger, reason, detail: error.detail || null },
    });
    throw error instanceof AccurateConnectionError ? error : new AccurateConnectionError('refresh_failed', 502);
  }

  const sealed = encryptTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || current.refreshToken });
  await pool.query(
    `UPDATE accurate_connections
        SET tokens_encrypted=?, tokens_iv=?, tokens_auth_tag=?, expires_at=?, granted_scope=?,
            last_refreshed_at=?, last_error=NULL, status='connected'
      WHERE entity_id=?`,
    [sealed.encrypted, sealed.iv, sealed.authTag, tokens.expiresAt, tokens.scope, now, entityId],
  );
  await safeLog({
    entityId, userId, action: 'accurate.refresh', subjectType: 'accurate_connection',
    metadata: { trigger, expiresAt: tokens.expiresAt },
  });
  return getStatus(entityId);
}

// For the sync client: a valid access token plus the chosen database,
// refreshed first when it expires within 2 days. Server side only.
async function getAccessToken(entityId, { fetchImpl, now = new Date() } = {}) {
  let row = await loadConnection(entityId);
  if (!row || row.status !== 'connected' || !row.tokens_encrypted) throw new AccurateConnectionError('not_connected', 409);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt - now.getTime() < REFRESH_WINDOW_MS) {
    await refresh({ entityId, trigger: 'auto', fetchImpl, now });
    row = await loadConnection(entityId);
  }
  const { accessToken } = decryptTokens({ encrypted: row.tokens_encrypted, iv: row.tokens_iv, authTag: row.tokens_auth_tag });
  return { accessToken, dbId: row.accurate_db_id, dbAlias: row.accurate_db_alias };
}

// Forgets the tokens here. Accurate itself is not called.
async function disconnect({ entityId, userId }) {
  const row = await loadConnection(entityId);
  await pool.query('DELETE FROM accurate_connections WHERE entity_id = ?', [entityId]);
  await safeLog({
    entityId, userId, action: 'accurate.disconnect', subjectType: 'accurate_connection',
    metadata: { database: row?.accurate_db_alias || null, hadTokens: Boolean(row?.tokens_encrypted) },
  });
  return toStatus(null, await loadConfig());
}

module.exports = {
  DEFAULT_SCOPES,
  DEFAULT_DB_NAME,
  STATE_TTL_MS,
  REFRESH_WINDOW_MS,
  ADMIN_PAGE,
  REASONS,
  AccurateConnectionError,
  config,
  loadConfig,
  saveCredentials,
  validRedirectUri,
  CALLBACK_PATH,
  resultUrl,
  encryptTokens,
  decryptTokens,
  createState,
  consumeState,
  selectDatabase,
  requestToken,
  getStatus,
  startConnect,
  handleCallback,
  refresh,
  getAccessToken,
  disconnect,
};
