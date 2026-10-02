const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { fail } = require('../utils/response');
const { createMemo } = require('../utils/memo');

// The signed-in user with their current permissions, or null when the account
// is gone. Shared with the AI agent's tool endpoint, which authenticates with
// its own short-lived token but must see exactly the same user.
async function loadUser(userId) {
  const [users] = await pool.query(
    `SELECT id, entity_id, department_id, email, status, must_change_password,
            UNIX_TIMESTAMP(password_changed_at) AS password_changed_ts,
            UNIX_TIMESTAMP(tokens_valid_after) AS tokens_valid_after_ts
       FROM users
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user) return null;
  const [permissionRows] = await pool.query(
    `SELECT DISTINCT p.code
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?`,
    [user.id]
  );
  return { ...user, permissions: permissionRows.map((row) => row.code) };
}

// The user row and permissions are read on every request (two queries each):
// kept AUTH_CACHE_TTL_MS per user id (load test, 1 Oct 2026). Every check
// below still runs on each request against the cached row — status, the
// password-change and logout cut-offs, the temporary-password gate — and the
// writes that change any of them drop the user's entry at once, AFTER they are
// committed (invalidateAuth): sign-out, password change or reset, status,
// roles, division or entity, delete, and role/permission edits (all users).
// A write from another process (a CLI script) is seen within the TTL.
const AUTH_CACHE_TTL_MS = (() => {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  const v = raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 60 * 1000) : 30 * 1000; // 0 = off; at most a minute
})();
const authCache = createMemo({ name: 'auth', maxEntries: 5000 });
const authKey = (userId) => `u:${Number(userId)}|`;

function cachedUser(userId) {
  return authCache.get(authKey(userId), AUTH_CACHE_TTL_MS, () => loadUser(userId));
}

/**
 * Drops the cached sign-in state of one user, or of everyone without an id
 * (a role's permissions changed). Call it after the write has committed.
 */
function invalidateAuth(userId) {
  if (userId == null) return authCache.invalidate('');
  return authCache.invalidate(authKey(userId));
}

// Matched on the PATH only (never the query string), anchored.
const PASSWORD_CHANGE_PATHS = /^\/api\/v1\/auth\/(me|change-password|logout)$/;
const pathOf = (req) => String((req.baseUrl || '') + (req.path || '')).replace(/\/+$/, '') || String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'UNAUTHORIZED', 'Token tidak ada', 401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.exp || !Number.isInteger(Number(decoded.sub)) || Number(decoded.sub) <= 0) {
      return fail(res, 'UNAUTHORIZED', 'Token tidak valid', 401);
    }
    // An AI agent token is only for the agent's own tool endpoint.
    if (decoded.typ === 'ai_agent') return fail(res, 'UNAUTHORIZED', 'Token tidak valid', 401);

    const user = await cachedUser(decoded.sub);
    if (!user) {
      return fail(res, 'UNAUTHORIZED', 'User tidak ditemukan', 401);
    }
    if (user.status !== 'active') {
      return fail(res, 'USER_INACTIVE', 'Akun dinonaktifkan oleh administrator', 403);
    }
    // A password changed or reset after this session began ends the session.
    if (user.password_changed_ts && decoded.iat && Number(decoded.iat) < Number(user.password_changed_ts)) {
      return fail(res, 'SESSION_EXPIRED', 'Kata sandi akun ini sudah diganti. Silakan masuk lagi.', 401);
    }
    // "Keluar" signs the account out everywhere: every session issued up to
    // that second ends (POST /auth/logout, users.tokens_valid_after).
    if (user.tokens_valid_after_ts && decoded.iat && Number(decoded.iat) <= Number(user.tokens_valid_after_ts)) {
      return fail(res, 'SESSION_EXPIRED', 'Sesi sudah berakhir. Silakan masuk lagi.', 401);
    }
    // A temporary password from an administrator must be replaced before
    // anything else: only "who am I" and "change password" work meanwhile.
    // Google sign-in has no password to replace, so it is never held up.
    if (decoded.amr === 'password' && Number(user.must_change_password) === 1 && !PASSWORD_CHANGE_PATHS.test(pathOf(req))) {
      return fail(res, 'PASSWORD_CHANGE_REQUIRED', 'Ganti kata sandi sementara Anda dulu.', 403);
    }

    req.user = {
      ...decoded,
      sub: user.id,
      email: user.email,
      entityId: user.entity_id,
      departmentId: user.department_id,
      // A copy: the cached list is shared by this user's requests.
      permissions: [...user.permissions],
    };

    next();
  } catch (error) {
    if (error?.code === 'ER_ACCESS_DENIED_ERROR' || error?.code === 'ECONNREFUSED') {
      return next(error);
    }
    return fail(res, 'UNAUTHORIZED', 'Token tidak valid', 401);
  }
}

module.exports = requireAuth;
module.exports.loadUser = loadUser;
module.exports.invalidateAuth = invalidateAuth;
module.exports.AUTH_CACHE_TTL_MS = AUTH_CACHE_TTL_MS;
module.exports._authCache = authCache;
