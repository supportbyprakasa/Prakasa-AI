const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { verifyGoogleIdToken } = require('../services/googleAuth.service');
const jwtService = require('../services/jwt.service');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

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

async function createSession(user) {
  const permissions = await permissionsForUser(user.id);
  const token = jwtService.sign({
    sub: user.id,
    email: user.email,
    entityId: user.entity_id,
    departmentId: user.department_id,
    permissions,
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
    if (!user || !user.password_hash) {
      return fail(res, 'INVALID_CREDENTIALS', 'Email atau password salah', 401);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
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

    return ok(res, await createSession(user));
  } catch (error) {
    next(error);
  }
}

async function googleLogin(req, res, next) {
  try {
    const profile = await verifyGoogleIdToken(req.body.idToken);

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

    return ok(res, await createSession(user));
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_url, entity_id, department_id,
              must_change_password
         FROM users
        WHERE id = ? AND deleted_at IS NULL`,
      [req.user.sub]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);

    const user = rows[0];
    return ok(res, {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      entityId: user.entity_id,
      departmentId: user.department_id,
      mustChangePassword: Boolean(user.must_change_password),
      permissions: req.user.permissions || [],
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { manualLogin, googleLogin, me };
