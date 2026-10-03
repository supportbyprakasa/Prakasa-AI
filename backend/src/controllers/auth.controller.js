const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { verifyGoogleIdToken, exchangeAuthCode } = require('../services/googleAuth.service');
const jwtService = require('../services/jwt.service');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { invalidateAuth } = require('../middleware/requireAuth');

// Interface languages an account can keep (users.language).
const LANGUAGES = ['id', 'en'];

async function permissionsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.code
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?`,
    [userId]
  );
  return rows.map((row) => row.code);
}

// Active roles with their division scope; the client uses this only to decide whether
// to show the workspace or the "access not prepared" state. Authorization stays server-side.
async function rolesForUser(userId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.role_key, r.role_level, r.department_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       LEFT JOIN departments d ON d.id = r.department_id
      WHERE ur.user_id = ?
        AND (r.department_id IS NULL OR d.deleted_at IS NULL)
      ORDER BY r.id`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    roleKey: row.role_key,
    roleLevel: row.role_level,
    departmentId: row.department_id,
  }));
}

// bcrypt hash (cost 12, same as real passwords) of a random value nobody knows;
// compared against when the account does not exist. Made once per process, on
// first use.
let dummyHash = null;
function dummyPasswordHash() {
  if (!dummyHash) dummyHash = bcrypt.hashSync(require('node:crypto').randomBytes(24).toString('hex'), 12);
  return dummyHash;
}

async function createSession(user, method = 'password') {
  const permissions = await permissionsForUser(user.id);
  const token = jwtService.sign({
    sub: user.id,
    email: user.email,
    entityId: user.entity_id,
    departmentId: user.department_id,
    permissions,
    // How the session began: 'password' sessions must replace a temporary password.
    amr: method,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      entityId: user.entity_id,
      departmentId: user.department_id,
      mustChangePassword: Boolean(user.must_change_password),
      passwordChangeRequired: method === 'password' && Boolean(user.must_change_password),
      permissions,
    },
  };
}

async function manualLogin(req, res, next) {
  try {
    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    const [rows] = await pool.query(
      `SELECT id, entity_id, department_id, name, email, password_hash,
              avatar_url, status, must_change_password
         FROM users
        WHERE email = ? AND deleted_at IS NULL
        LIMIT 1`,
      [email]
    );

    const user = rows[0];
    // Always run one bcrypt comparison, against a dummy hash when there is no
    // such account (or it signs in with Google only), so the response time
    // does not reveal which emails exist.
    const hash = user?.password_hash || dummyPasswordHash();
    const matches = await bcrypt.compare(password, hash);
    const valid = Boolean(user?.password_hash) && matches;
    if (!valid) {
      return fail(res, 'INVALID_CREDENTIALS', 'Email atau password salah', 401);
    }
    if (user.status !== 'active') {
      return fail(res, 'USER_INACTIVE', 'Akun dinonaktifkan oleh administrator', 403);
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await log({
      entityId: user.entity_id,
      userId: user.id,
      action: 'user.login',
      subjectType: 'user',
      subjectId: user.id,
      metadata: { via: 'manual' },
    });

    return ok(res, await createSession(user, 'password'));
  } catch (error) {
    next(error);
  }
}

async function googleLogin(req, res, next) {
  try {
    // The custom-styled button sends an OAuth "code" (exchanged here so it
    // never needs the client secret); the widget-based fallback sends an
    // idToken directly. Both resolve to the same verified Google profile.
    const profile = req.body.code
      ? await exchangeAuthCode(req.body.code)
      : await verifyGoogleIdToken(req.body.idToken);

    const [rows] = await pool.query(
      `SELECT id, entity_id, department_id, name, email, google_sub,
              avatar_url, status, must_change_password
         FROM users
        WHERE email = ? AND deleted_at IS NULL
        LIMIT 1`,
      [profile.email.toLowerCase()]
    );

    const user = rows[0];
    if (!user) {
      return fail(
        res,
        'ACCOUNT_NOT_PROVISIONED',
        'Akun belum dibuat oleh Super Admin',
        403
      );
    }
    if (user.status !== 'active') {
      return fail(res, 'USER_INACTIVE', 'Akun dinonaktifkan oleh administrator', 403);
    }

    if (!user.google_sub) {
      await pool.query(
        'UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?',
        [profile.sub, profile.picture || null, user.id]
      );
    } else if (user.google_sub !== profile.sub) {
      return fail(res, 'GOOGLE_ACCOUNT_MISMATCH', 'Akun Google tidak cocok', 403);
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await log({
      entityId: user.entity_id,
      userId: user.id,
      action: 'user.login',
      subjectType: 'user',
      subjectId: user.id,
      metadata: { via: 'google' },
    });

    return ok(res, await createSession(user, 'google'));
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    // password_hash and google_sub are read only to say WHICH sign-in methods
    // the account has (Akun saya); neither value ever leaves the server.
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.entity_id, u.department_id,
              u.must_change_password, u.language, u.morning_briefing,
              u.password_hash IS NOT NULL AS has_password,
              u.google_sub IS NOT NULL AS has_google,
              d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.id = u.department_id AND d.deleted_at IS NULL
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [req.user.sub]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);

    const user = rows[0];
    const roles = await rolesForUser(user.id);
    return ok(res, {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      entityId: user.entity_id,
      departmentId: user.department_id,
      departmentName: user.department_name || null,
      // Interface language saved on the account ('id' | 'en'), null = never chosen.
      language: LANGUAGES.includes(user.language) ? user.language : null,
      // "Ringkasan pagi" on the home page (Akun saya); shown unless switched off.
      morningBriefing: user.morning_briefing == null ? true : Boolean(Number(user.morning_briefing)),
      signIn: { password: Boolean(user.has_password), google: Boolean(user.has_google) },
      mustChangePassword: Boolean(user.must_change_password),
      passwordChangeRequired: req.user.amr === 'password' && Boolean(user.must_change_password),
      permissions: req.user.permissions || [],
      roles,
    });
  } catch (error) {
    next(error);
  }
}

// PATCH /auth/me/preferences — the signed-in user's own preferences (Akun
// saya, and the top bar's language switch). Always the caller's own account:
// the id comes from the session, never from the request.
async function updatePreferences(req, res, next) {
  try {
    // language: the interface language; morningBriefing: whether the home page
    // shows the "Ringkasan pagi" card. Only what the body names is written.
    const { language, morningBriefing } = req.body;
    const sets = [];
    const args = [];
    const saved = {};
    if (language !== undefined) { sets.push('language = ?'); args.push(language); saved.language = language; }
    if (typeof morningBriefing === 'boolean') { sets.push('morning_briefing = ?'); args.push(morningBriefing ? 1 : 0); saved.morningBriefing = morningBriefing; }
    if (!sets.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada preferensi yang diubah', 400);
    const [result] = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...args, req.user.sub],
    );
    if (!result.affectedRows) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    return ok(res, saved);
  } catch (error) {
    next(error);
  }
}

// POST /auth/change-password — the signed-in user replaces a TEMPORARY
// password (users.must_change_password = 1: set by a Super Admin when the
// account was created or reset). Nothing else: passwords are managed by the
// Super Admin (owner decision, 2 Oct 2026), so a voluntary change is refused
// with PASSWORD_MANAGED_BY_ADMIN before the current password is even looked
// at. Ends every other session (password_changed_at) and returns a fresh one
// for this browser. An account without a password (Google only) is refused:
// there is no way to set a first password here.
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const [[user]] = await pool.query(
      `SELECT id, entity_id, department_id, name, email, password_hash, avatar_url, status, must_change_password
         FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [req.user.sub],
    );
    if (!user) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    if (Number(user.must_change_password) !== 1) {
      return fail(res, 'PASSWORD_MANAGED_BY_ADMIN', 'Kata sandi dikelola oleh Super Admin', 403);
    }
    if (!user.password_hash) return fail(res, 'NO_PASSWORD', 'Akun ini masuk dengan Google, tidak memakai kata sandi aplikasi.', 400);
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return fail(res, 'INVALID_CREDENTIALS', 'Kata sandi saat ini salah', 400, { field: 'currentPassword' });
    }
    if (currentPassword === newPassword) {
      return fail(res, 'VALIDATION_ERROR', 'Kata sandi baru harus berbeda dari yang sekarang', 400, { field: 'newPassword' });
    }
    if (newPassword.toLowerCase().includes(String(user.email).split('@')[0].toLowerCase())) {
      return fail(res, 'VALIDATION_ERROR', 'Kata sandi tidak boleh memuat nama email Anda', 400, { field: 'newPassword' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = FROM_UNIXTIME(?) WHERE id = ?',
      // This second: the session issued right below (iat = now) stays valid,
      // every earlier one ends.
      [hash, Math.floor(Date.now() / 1000), user.id],
    );
    // Older sessions end now, not after the sign-in cache expires.
    invalidateAuth(user.id);
    await log({ entityId: user.entity_id, userId: user.id, action: 'user.password_change', subjectType: 'user', subjectId: user.id, metadata: { wasTemporary: true } });
    return ok(res, await createSession({ ...user, must_change_password: 0 }, 'password'));
  } catch (error) {
    next(error);
  }
}

// POST /auth/logout — "Keluar": ends every session of this account on every
// device (requireAuth refuses tokens issued up to tokens_valid_after).
async function logout(req, res, next) {
  try {
    await pool.query('UPDATE users SET tokens_valid_after = NOW() WHERE id = ? AND deleted_at IS NULL', [req.user.sub]);
    // Every session ends now, not after the sign-in cache expires.
    invalidateAuth(req.user.sub);
    await log({ entityId: req.user.entityId ?? null, userId: req.user.sub, action: 'user.logout', subjectType: 'user', subjectId: req.user.sub, metadata: { allDevices: true } });
    return ok(res, { loggedOut: true });
  } catch (error) {
    next(error);
  }
}

module.exports = { manualLogin, googleLogin, me, updatePreferences, changePassword, logout, dummyPasswordHash, LANGUAGES };
