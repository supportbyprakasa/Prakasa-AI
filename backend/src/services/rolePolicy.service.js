const pool = require('../db/pool');
const {
  GLOBAL_ROLE_KEYS,
  permissionsForStandardRole,
} = require('../config/standardOrganization');

const SUPER_ADMIN = 'system.super_admin';
const SYSTEM_ADMIN = 'system.admin';

function policyError(message, code = 'ROLE_ASSIGNMENT_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validateRoleAssignment({ entityId, departmentId, roleRows = [] }) {
  for (const role of roleRows) {
    const label = role.name || `#${role.id}`;

    if (role.deleted_at) {
      throw policyError(`Role ${label} tidak aktif`);
    }
    if (Number(role.entity_id) !== Number(entityId)) {
      throw policyError(`Role ${label} tidak berasal dari entity pengguna`);
    }

    if (role.department_id == null) {
      const isGlobal = GLOBAL_ROLE_KEYS.includes(role.role_key)
        && role.role_level === 'admin';
      if (!isGlobal) {
        throw policyError(`Role ${label} tidak memiliki kebijakan global yang valid`);
      }
      continue;
    }

    if (departmentId == null) {
      throw policyError(`Role ${label} memerlukan divisi pengguna belum dipilih`);
    }
    if (role.department_deleted_at) {
      throw policyError(`Divisi role ${label} tidak aktif`);
    }
    if (role.department_entity_id != null
      && Number(role.department_entity_id) !== Number(entityId)) {
      throw policyError(`Divisi role ${label} tidak berasal dari entity pengguna`);
    }
    if (Number(role.department_id) !== Number(departmentId)) {
      throw policyError(`Role ${label} tidak sesuai divisi pengguna`);
    }
  }

  return roleRows;
}

const ROLE_ASSIGNMENT_COLUMNS = `
  r.id, r.name, r.entity_id, r.department_id, r.role_key, r.role_level,
  r.is_system_template, r.deleted_at,
  d.entity_id AS department_entity_id,
  d.deleted_at AS department_deleted_at`;

async function getAssignableRoles({ entityId, departmentId, connection = pool }) {
  const [rows] = await connection.query(
    `SELECT ${ROLE_ASSIGNMENT_COLUMNS}
       FROM roles r
       LEFT JOIN departments d ON d.id=r.department_id
      WHERE r.entity_id = ?
        AND r.deleted_at IS NULL
        AND (
          (r.department_id = ? AND d.deleted_at IS NULL)
          OR (r.department_id IS NULL AND r.role_key IN (?))
        )
      ORDER BY r.department_id IS NULL DESC,
               FIELD(r.role_level, 'member', 'supervisor', 'head', 'admin', 'custom'),
               r.name`,
    [entityId, departmentId ?? null, GLOBAL_ROLE_KEYS],
  );
  return rows;
}

async function loadRolesForAssignment({ connection, roleIds = [] }) {
  const normalizedIds = [...new Set(roleIds.map(Number))];
  if (!normalizedIds.length) return [];

  const [rows] = await connection.query(
    `SELECT ${ROLE_ASSIGNMENT_COLUMNS}
       FROM roles r
       LEFT JOIN departments d ON d.id=r.department_id
      WHERE r.id IN (?)
      FOR SHARE`,
    [normalizedIds],
  );

  if (rows.length !== normalizedIds.length) {
    throw policyError('Satu atau lebih role tidak ditemukan atau tidak aktif');
  }
  return rows;
}

async function loadAssignedRoles({ connection, userId }) {
  const [rows] = await connection.query(
    `SELECT ${ROLE_ASSIGNMENT_COLUMNS}
       FROM user_roles ur
       JOIN roles r ON r.id=ur.role_id
       LEFT JOIN departments d ON d.id=r.department_id
      WHERE ur.user_id = ?
      FOR SHARE`,
    [userId],
  );
  return rows;
}

// Run inside the same transaction as the write, after it, so the count sees the new state.
async function countActiveSuperAdmins({ connection }) {
  const [[row]] = await connection.query(
    `SELECT COUNT(DISTINCT u.id) AS total
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
      WHERE r.role_key = 'system.super_admin'
        AND r.deleted_at IS NULL
        AND u.deleted_at IS NULL
        AND u.status = 'active'`,
  );
  return Number(row?.total || 0);
}

async function resetStandardRole({ roleId, actor, connection = null }) {
  const ownsConnection = !connection;
  const db = connection || await pool.getConnection();

  try {
    await db.beginTransaction();
    const [[role]] = await db.query(
      `SELECT r.id, r.entity_id, r.role_key, r.is_system_template, r.deleted_at
         FROM roles r
        WHERE r.id = ?
        FOR UPDATE`,
      [roleId],
    );
    if (!role || role.deleted_at) {
      throw policyError('Role tidak ditemukan', 'NOT_FOUND', 404);
    }
    if (!role.is_system_template
      || !role.role_key
      || GLOBAL_ROLE_KEYS.includes(role.role_key)) {
      throw policyError(
        'Hanya role standar divisi yang dapat dikembalikan ke default',
        'ROLE_RESET_NOT_ALLOWED',
      );
    }

    const targetCodes = permissionsForStandardRole(role.role_key);
    if (!targetCodes.length) {
      throw policyError(
        'Default permission untuk role ini tidak ditemukan',
        'ROLE_RESET_NOT_ALLOWED',
      );
    }

    const [permissionRows] = await db.query(
      'SELECT p.id, p.code FROM permissions p WHERE p.code IN (?)',
      [targetCodes],
    );
    if (permissionRows.length !== targetCodes.length) {
      throw policyError(
        'Katalog permission database belum lengkap untuk reset role',
        'ROLE_PERMISSION_CATALOG_MISMATCH',
        500,
      );
    }

    const [currentRows] = await db.query(
      `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id=rp.permission_id
        WHERE rp.role_id = ?`,
      [roleId],
    );
    const currentCodes = currentRows.map((row) => row.code);
    const currentSet = new Set(currentCodes);
    const targetSet = new Set(targetCodes);
    const addedPermissions = targetCodes.filter((code) => !currentSet.has(code));
    const removedPermissions = currentCodes.filter((code) => !targetSet.has(code));

    await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    await db.query(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES ?',
      [permissionRows.map((permission) => [Number(roleId), permission.id])],
    );

    const metadata = {
      roleKey: role.role_key,
      addedPermissions,
      removedPermissions,
    };
    await db.query(
      `INSERT INTO activity_logs
       (entity_id, user_id, action, subject_type, subject_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        role.entity_id,
        actor?.userId ?? null,
        'role.reset_standard',
        'role',
        Number(roleId),
        JSON.stringify(metadata),
      ],
    );

    await db.commit();
    return {
      id: Number(roleId),
      roleKey: role.role_key,
      permissionCount: targetCodes.length,
      addedPermissions,
      removedPermissions,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    if (ownsConnection) db.release();
  }
}

// --------------------------------------------------------------- admin guards
// Only a Super Admin may touch Super Admin accounts or the two global roles,
// and nobody below Super Admin changes their own access. This is what keeps
// an Administrator Sistem from granting themselves a division role (and with
// it that division's data). Every change is still in the activity log.

async function isSuperAdmin(userId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT 1 FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
      WHERE ur.user_id = ? AND r.role_key = ?
      LIMIT 1`,
    [userId, SUPER_ADMIN],
  );
  return Boolean(rows[0]);
}

const hasKey = (rows, key) => rows.some((row) => row.role_key === key);
const isGlobalRole = (row) => GLOBAL_ROLE_KEYS.includes(row?.role_key);

// The level of a role row: role_level when loaded from the database, otherwise
// the suffix of a standard role key (sales.head → head).
function roleLevelOf(row) {
  if (row?.role_level) return String(row.role_level);
  const key = String(row?.role_key || '');
  return key.includes('.') ? key.split('.').pop() : '';
}

const roleIdentity = (row) => (row?.id != null ? `id:${row.id}` : `key:${row?.role_key}`);

// targetRoles: the account's current roles; nextRoles: the roles it would get
// (null when roles are not being changed). changesDivision: the account's
// division would change.
//
// Below Super Admin (i.e. an Administrator Sistem) the rules are:
//   - no change to an account holding a global role (Super Admin or another
//     Administrator Sistem), except one's own name/email;
//   - no global role is granted (Super Admin nor Administrator Sistem);
//   - no change to one's own roles or division;
//   - only member-level division roles are newly granted. Head, Supervisor or a
//     custom role carries the division's data, so granting it is Super Admin
//     only; otherwise an administrator could create a puppet account, give it
//     a Head role and read that division through it. Roles the account
//     already holds may stay or be removed.
async function assertCanChangeAccount({ connection = pool, actorId, targetUserId, targetRoles = [], nextRoles = null, changesDivision = false }) {
  if (await isSuperAdmin(actorId, connection)) return;
  const self = targetUserId != null && Number(actorId) === Number(targetUserId);
  if (hasKey(targetRoles, SUPER_ADMIN) || (nextRoles && hasKey(nextRoles, SUPER_ADMIN))) {
    throw policyError('Akun Super Admin hanya bisa diubah oleh Super Admin.', 'SUPER_ADMIN_ONLY', 403);
  }
  if (self && (nextRoles || changesDivision)) {
    throw policyError('Peran dan divisi akun Anda sendiri hanya bisa diubah oleh Super Admin.', 'SELF_ACCESS_CHANGE', 403);
  }
  if ((!self && targetRoles.some(isGlobalRole)) || (nextRoles && nextRoles.some(isGlobalRole))) {
    throw policyError('Peran Administrator Sistem hanya bisa diberikan atau diubah oleh Super Admin.', 'SUPER_ADMIN_ONLY', 403);
  }
  if (nextRoles) {
    const held = new Set(targetRoles.map(roleIdentity));
    const granted = nextRoles.filter((row) => !held.has(roleIdentity(row)));
    const senior = granted.find((row) => roleLevelOf(row) !== 'member');
    if (senior) {
      throw policyError(
        `Peran ${senior.name || senior.role_key || 'ini'} (Head, Supervisor atau khusus) hanya bisa diberikan oleh Super Admin. Administrator Sistem hanya memberi peran Anggota.`,
        'SUPER_ADMIN_ONLY',
        403,
      );
    }
  }
}

async function assertCanChangeRole({ connection = pool, actorId, roleKey }) {
  if (!GLOBAL_ROLE_KEYS.includes(roleKey)) return;
  if (await isSuperAdmin(actorId, connection)) return;
  throw policyError('Peran Super Admin dan Administrator Sistem hanya bisa diubah oleh Super Admin.', 'SUPER_ADMIN_ONLY', 403);
}

module.exports = {
  SUPER_ADMIN,
  SYSTEM_ADMIN,
  assertCanChangeAccount,
  assertCanChangeRole,
  isSuperAdmin,
  roleLevelOf,
  countActiveSuperAdmins,
  getAssignableRoles,
  loadAssignedRoles,
  loadRolesForAssignment,
  policyError,
  resetStandardRole,
  validateRoleAssignment,
  permissionsForStandardRole,
  pool,
};
