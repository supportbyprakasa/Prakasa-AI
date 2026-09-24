const pool = require('../db/pool');
const {
  permissionsForStandardRole,
} = require('../config/standardOrganization');

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
      const isSuperAdmin = role.role_key === 'system.super_admin'
        && role.role_level === 'admin';
      if (!isSuperAdmin) {
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
          OR (r.department_id IS NULL AND r.role_key='system.super_admin')
        )
      ORDER BY r.department_id IS NULL DESC,
               FIELD(r.role_level, 'member', 'supervisor', 'head', 'admin', 'custom'),
               r.name`,
    [entityId, departmentId ?? null],
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
      || role.role_key === 'system.super_admin') {
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

module.exports = {
  getAssignableRoles,
  loadAssignedRoles,
  loadRolesForAssignment,
  policyError,
  resetStandardRole,
  validateRoleAssignment,
  permissionsForStandardRole,
  pool,
};
