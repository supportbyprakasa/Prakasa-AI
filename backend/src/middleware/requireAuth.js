const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { fail } = require('../utils/response');

module.exports = async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'UNAUTHORIZED', 'Token tidak ada', 401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [users] = await pool.query(
      `SELECT id, entity_id, department_id, email, status
         FROM users
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [decoded.sub]
    );

    const user = users[0];
    if (!user) {
      return fail(res, 'UNAUTHORIZED', 'User tidak ditemukan', 401);
    }
    if (user.status !== 'active') {
      return fail(res, 'USER_INACTIVE', 'Akun dinonaktifkan oleh administrator', 403);
    }

    const [permissionRows] = await pool.query(
      `SELECT DISTINCT p.code
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = ?`,
      [user.id]
    );

    req.user = {
      ...decoded,
      sub: user.id,
      email: user.email,
      entityId: user.entity_id,
      departmentId: user.department_id,
      permissions: permissionRows.map((row) => row.code),
    };

    next();
  } catch (error) {
    if (error?.code === 'ER_ACCESS_DENIED_ERROR' || error?.code === 'ECONNREFUSED') {
      return next(error);
    }
    return fail(res, 'UNAUTHORIZED', 'Token tidak valid', 401);
  }
};
