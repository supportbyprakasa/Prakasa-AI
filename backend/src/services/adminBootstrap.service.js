const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const MIN_PASSWORD_LENGTH = 12;

function makeError(message, status = 400, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function validateInput({ email, name, password, entityId }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim();
  const normalizedEntityId = Number(entityId || 1);

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw makeError('email tidak valid');
  }
  if (!normalizedName) {
    throw makeError('name wajib');
  }
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    throw makeError(`password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }
  if (!Number.isInteger(normalizedEntityId) || normalizedEntityId <= 0) {
    throw makeError('entityId tidak valid');
  }

  const lowerPassword = String(password).toLowerCase();
  const localPart = normalizedEmail.split('@')[0];
  if (
    lowerPassword.includes('admin') ||
    (localPart.length >= 4 && lowerPassword.includes(localPart))
  ) {
    throw makeError('password terlalu lemah');
  }

  return {
    email: normalizedEmail,
    name: normalizedName,
    password: String(password),
    entityId: normalizedEntityId,
  };
}

async function bootstrapFirstAdmin(input) {
  const {
    email,
    name,
    password,
    entityId,
  } = validateInput(input);
  const mustChangePassword = input.mustChangePassword === false ? 0 : 1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [entities] = await conn.query(
      `SELECT id FROM entities
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [entityId]
    );
    if (!entities[0]) {
      throw makeError(`entity id=${entityId} tidak ditemukan`);
    }

    let [[role]] = await conn.query(
      `SELECT id FROM roles
        WHERE entity_id = ?
          AND LOWER(name) IN ('super admin','superadmin','administrator','admin')
          AND deleted_at IS NULL
        ORDER BY CASE LOWER(name)
          WHEN 'super admin' THEN 1
          WHEN 'superadmin' THEN 2
          WHEN 'administrator' THEN 3
          ELSE 4
        END
        LIMIT 1`,
      [entityId]
    );

    if (!role) {
      const [roleInsert] = await conn.query(
        'INSERT INTO roles (entity_id, name) VALUES (?, ?)',
        [entityId, 'Super Admin']
      );
      role = { id: roleInsert.insertId };
    }

    await conn.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions`,
      [role.id]
    );

    const [existingRows] = await conn.query(
      `SELECT id, entity_id AS entityId, status, deleted_at AS deletedAt
         FROM users
        WHERE email = ?
        LIMIT 1`,
      [email]
    );
    const existing = existingRows[0] || null;

    if (existing) {
      if (existing.deletedAt) {
        throw makeError(
          'User bootstrap sudah soft-deleted. Restore secara manual.',
          409,
          'USER_DELETED'
        );
      }
      if (Number(existing.entityId) !== entityId) {
        throw makeError(
          'User bootstrap sudah ada di entity berbeda.',
          409,
          'USER_ENTITY_CONFLICT'
        );
      }

      if (existing.status !== 'active') {
        await conn.query(
          `UPDATE users SET status = 'active'
            WHERE id = ? AND deleted_at IS NULL`,
          [existing.id]
        );
      }

      await conn.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [existing.id, role.id]
      );

      await conn.commit();
      return {
        id: existing.id,
        entityId,
        roleId: role.id,
        created: false,
        passwordReset: false,
      };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [insert] = await conn.query(
      `INSERT INTO users
       (entity_id, department_id, name, email, password_hash,
        must_change_password, status)
       VALUES (?, NULL, ?, ?, ?, ?, 'active')`,
      [entityId, name, email, passwordHash, mustChangePassword]
    );

    await conn.query(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [insert.insertId, role.id]
    );

    await conn.commit();
    return {
      id: insert.insertId,
      entityId,
      roleId: role.id,
      created: true,
      passwordReset: false,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  bootstrapFirstAdmin,
  MIN_PASSWORD_LENGTH,
  validateInput,
};
