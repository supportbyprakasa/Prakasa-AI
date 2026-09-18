const pool = require('../db/pool');
const { verifyGoogleIdToken } = require('../services/googleAuth.service');
const jwtService = require('../services/jwt.service');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function googleLogin(req, res, next) {
  try {
    const { idToken } = req.body;
    const profile = await verifyGoogleIdToken(idToken);

    const [rows] = await pool.query(
      `SELECT u.id, u.entity_id, u.department_id, u.name, u.email,
              u.google_sub, u.avatar_url, u.status
         FROM users u
        WHERE u.email = ? AND u.deleted_at IS NULL
        LIMIT 1`,
      [profile.email]
    );

    let user = rows[0];

    if (!user) {
      // Auto-provision: pakai entity 1 sebagai default, harus di-assign admin nanti
      const [ins] = await pool.query(
        `INSERT INTO users (entity_id, department_id, name, email, google_sub, avatar_url)
         VALUES (1, NULL, ?, ?, ?, ?)`,
        [profile.name, profile.email, profile.sub, profile.picture]
      );
      user = {
        id: ins.insertId,
        entity_id: 1,
        department_id: null,
        name: profile.name,
        email: profile.email,
        google_sub: profile.sub,
        avatar_url: profile.picture,
        status: 'active',
      };
      await log({
        entityId: 1,
        userId: user.id,
        action: 'user.auto_provision',
        subjectType: 'user',
        subjectId: user.id,
        metadata: { via: 'google' },
      });
    } else if (!user.google_sub) {
      await pool.query(`UPDATE users SET google_sub = ? WHERE id = ?`, [
        profile.sub,
        user.id,
      ]);
      user.google_sub = profile.sub;
    }

    if (user.status !== 'active') {
      return fail(res, 'USER_INACTIVE', 'Akun tidak aktif', 403);
    }

    const [permRows] = await pool.query(
      `SELECT DISTINCT p.code
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = ?`,
      [user.id]
    );
    const permissions = permRows.map((r) => r.code);

    const token = jwtService.sign({
      sub: user.id,
      email: user.email,
      entityId: user.entity_id,
      departmentId: user.department_id,
      permissions,
    });

    return ok(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatar_url,
        entityId: user.entity_id,
        departmentId: user.department_id,
        permissions,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function me(req, res) {
  const [rows] = await pool.query(
    `SELECT id, name, email, avatar_url, entity_id, department_id
       FROM users WHERE id = ? AND deleted_at IS NULL`,
    [req.user.sub]
  );
  if (!rows[0]) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
  const u = rows[0];
  return ok(res, {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatar_url,
    entityId: u.entity_id,
    departmentId: u.department_id,
    permissions: req.user.permissions || [],
  });
}

module.exports = { googleLogin, me };
