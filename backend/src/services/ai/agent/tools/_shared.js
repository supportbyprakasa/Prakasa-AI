// Helpers shared by the agent's tool files (a file starting with "_" is not a
// tool file: tools/index discovery skips it).
const pool = require('../../../../db/pool');

const hasPerm = (user, code) => (user?.permissions || []).includes(code);
const anyPerm = (user, codes) => [].concat(codes || []).some((code) => hasPerm(user, code));
const denied = (message = 'Alat ini tidak tersedia untuk Anda') => Object.assign(new Error(message), { status: 403, code: 'FORBIDDEN' });
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, { min = 1, max = 50, fallback = 20 } = {}) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : fallback);

// The asking user's own active roles, the same rows GET /auth/me returns
// (controllers/auth.controller.js rolesForUser): the handbook audience filter
// and anything else that depends on the role level reads them here.
async function userRoles(user) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.role_key, r.role_level, r.department_id
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
       LEFT JOIN departments d ON d.id = r.department_id
      WHERE ur.user_id = ?
        AND (r.department_id IS NULL OR d.deleted_at IS NULL)
      ORDER BY r.id`,
    [user.sub],
  );
  return (rows || []).filter((row) => row && row.role_key !== undefined).map((row) => ({
    id: row.id, name: row.name, roleKey: row.role_key, roleLevel: row.role_level, departmentId: row.department_id,
  }));
}

module.exports = { hasPerm, anyPerm, denied, text, int, userRoles };
