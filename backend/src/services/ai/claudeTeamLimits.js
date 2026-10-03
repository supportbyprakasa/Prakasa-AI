const pool = require('../../db/pool');
const { todayWib } = require('../../utils/wibTime');

// The Claude Team seat's usage window and login, per account ('cli' = this
// server's own login, 'gateway:<id>' = a runner). The CLI reports the window
// on every answer (rate_limit_event: allowed / allowed_warning / rejected,
// utilization, resetsAt). Once the seat is out of quota, Prakasa AI stops
// spawning the CLI until the reset time and tells users when it is back — a
// rejected run would only fail slowly and burn the next window's first minutes.
// Super Admins are warned once per window as the seat fills up, and when the
// login lapses.

const WARN_AT = 0.8;
const state = new Map();
let loaded = false;

function limitError(until) {
  const error = new Error(`Kuota Claude Team untuk Prakasa AI sedang habis. Prakasa AI bisa dipakai lagi sekitar ${formatTime(until)}.`);
  error.code = 'AI_RATE_LIMITED';
  error.status = 429;
  error.retryAt = until ? until.toISOString() : null;
  return error;
}

function formatTime(date) {
  if (!date) return 'beberapa saat lagi';
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date)} WIB`;
}

const toDate = (unixSeconds) => (Number.isFinite(Number(unixSeconds)) && Number(unixSeconds) > 0 ? new Date(Number(unixSeconds) * 1000) : null);

async function loadOnce() {
  if (loaded) return;
  loaded = true;
  if (!persistEnabled()) return;
  try {
    const [rows] = await pool.query('SELECT * FROM ai_claude_team_status');
    for (const r of rows) {
      state.set(r.account_key, {
        rateStatus: r.rate_status,
        rateType: r.rate_type,
        utilization: r.utilization == null ? null : Number(r.utilization),
        resetsAt: r.resets_at ? new Date(r.resets_at) : null,
        cooldownUntil: r.cooldown_until ? new Date(r.cooldown_until) : null,
        loggedIn: r.logged_in == null ? null : Boolean(r.logged_in),
        lastCheckAt: r.last_check_at ? new Date(r.last_check_at) : null,
        lastError: r.last_error,
        warnedWindow: r.warned_window,
      });
    }
  } catch { /* table missing before migration: start empty */ }
}

function get(accountKey) {
  if (!state.has(accountKey)) state.set(accountKey, {});
  return state.get(accountKey);
}

// A remote runner keeps its limits in memory only (it has no business writing
// to whatever database its .env points at); the backend records what it forwards.
const persistEnabled = () => process.env.CLAUDE_TEAM_LIMITS_PERSIST !== 'false';

async function persist(accountKey) {
  if (!persistEnabled()) return;
  const s = get(accountKey);
  try {
    await pool.query(
      `INSERT INTO ai_claude_team_status
         (account_key, rate_status, rate_type, utilization, resets_at, cooldown_until, logged_in, last_check_at, last_error, warned_window)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate_status = VALUES(rate_status), rate_type = VALUES(rate_type), utilization = VALUES(utilization),
         resets_at = VALUES(resets_at), cooldown_until = VALUES(cooldown_until), logged_in = VALUES(logged_in),
         last_check_at = VALUES(last_check_at), last_error = VALUES(last_error), warned_window = VALUES(warned_window)`,
      [accountKey, s.rateStatus || null, s.rateType || null, s.utilization ?? null, s.resetsAt || null, s.cooldownUntil || null,
        s.loggedIn == null ? null : (s.loggedIn ? 1 : 0), s.lastCheckAt || null, s.lastError ? String(s.lastError).slice(0, 255) : null,
        s.warnedWindow || null],
    );
  } catch { /* status is advisory; never fail an answer over it */ }
}

// Super Admins (ai.provider.manage) hear about it once per window.
async function notifyAdmins({ title, body, event, dedupe }) {
  if (!persistEnabled()) return;
  try {
    const notif = require('../notification.service');
    const [admins] = await pool.query(
      `SELECT DISTINCT u.id, u.entity_id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'ai.provider.manage' AND u.status = 'active' AND u.deleted_at IS NULL`,
    );
    for (const admin of admins) {
      await notif.create({
        userId: admin.id, entityId: admin.entity_id, title, body, event,
        subjectType: 'ai_provider', subjectId: null, actionUrl: '/admin/ai-provider-settings', dedupeKey: `${event}:${dedupe}`,
      }).catch(() => {});
    }
  } catch { /* best effort */ }
}

// Called for every rate_limit_event the CLI streams.
async function record(accountKey, info = {}) {
  await loadOnce();
  const s = get(accountKey);
  s.rateStatus = info.status || s.rateStatus;
  s.rateType = info.rateLimitType || s.rateType;
  s.utilization = Number.isFinite(Number(info.utilization)) ? Number(info.utilization) : s.utilization;
  s.resetsAt = toDate(info.resetsAt) || s.resetsAt;
  if (info.status === 'rejected') s.cooldownUntil = s.resetsAt || new Date(Date.now() + 60 * 60 * 1000);
  else if (s.cooldownUntil && s.cooldownUntil <= new Date()) s.cooldownUntil = null;

  const window = `${s.rateType || 'window'}:${s.resetsAt ? s.resetsAt.toISOString() : ''}`;
  const pct = s.utilization == null ? null : Math.round(s.utilization * 100);
  if (info.status === 'rejected' && s.warnedWindow !== `rejected:${window}`) {
    s.warnedWindow = `rejected:${window}`;
    await notifyAdmins({
      title: 'Kuota Claude Team habis',
      body: `Prakasa AI berhenti sementara sampai ${formatTime(s.cooldownUntil)}.`,
      event: 'ai.claude_team_limit', dedupe: s.warnedWindow,
    });
  } else if (pct != null && s.utilization >= WARN_AT && !String(s.warnedWindow || '').endsWith(window)) {
    s.warnedWindow = `warn:${window}`;
    await notifyAdmins({
      title: `Kuota Claude Team terpakai ${pct}%`,
      body: `Batas ${s.rateType === 'five_hour' ? '5 jam' : s.rateType === 'seven_day' ? 'mingguan' : 'pemakaian'} pulih ${formatTime(s.resetsAt)}. Pertimbangkan membatasi pemakaian sampai saat itu.`,
      event: 'ai.claude_team_limit', dedupe: s.warnedWindow,
    });
  }
  await persist(accountKey);
}

// A run that failed on the limit without an event (e.g. result api_error_status 429).
async function markRejected(accountKey) {
  await record(accountKey, { status: 'rejected' });
}

// Throws AI_RATE_LIMITED while the seat is out of quota; clears an expired cooldown.
async function assertAvailable(accountKey) {
  await loadOnce();
  const s = get(accountKey);
  if (!s.cooldownUntil) return;
  if (s.cooldownUntil > new Date()) throw limitError(s.cooldownUntil);
  s.cooldownUntil = null;
  s.rateStatus = null;
  await persist(accountKey);
}

async function recordLogin(accountKey, { loggedIn, error = null }) {
  await loadOnce();
  const s = get(accountKey);
  const wasIn = s.loggedIn;
  s.loggedIn = loggedIn;
  s.lastCheckAt = new Date();
  s.lastError = error;
  if (loggedIn === false && wasIn !== false) {
    await notifyAdmins({
      title: 'Claude Team logout',
      body: 'Prakasa AI tidak bisa menjawab sampai akun Claude Team di runner login kembali (`claude auth login`).',
      event: 'ai.claude_team_logout', dedupe: todayWib(),
    });
  }
  await persist(accountKey);
}

async function snapshot(accountKey) {
  await loadOnce();
  const s = get(accountKey);
  return {
    accountKey,
    rateStatus: s.rateStatus || null,
    rateType: s.rateType || null,
    utilization: s.utilization ?? null,
    resetsAt: s.resetsAt ? s.resetsAt.toISOString() : null,
    cooldownUntil: s.cooldownUntil && s.cooldownUntil > new Date() ? s.cooldownUntil.toISOString() : null,
    loggedIn: s.loggedIn ?? null,
    lastCheckAt: s.lastCheckAt ? s.lastCheckAt.toISOString() : null,
    lastError: s.lastError || null,
  };
}

function reset() { state.clear(); loaded = false; }

module.exports = {
  WARN_AT, record, markRejected, assertAvailable, recordLogin, snapshot, formatTime, limitError, reset,
};
