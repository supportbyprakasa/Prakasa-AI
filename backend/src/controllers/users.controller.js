const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const {
  loadAssignedRoles,
  loadRolesForAssignment,
  validateRoleAssignment,
} = require('../services/rolePolicy.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['u.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('u.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('u.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.q) {
      where.push('(u.name LIKE ? OR u.email LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl,
              u.entity_id AS entityId, u.department_id AS departmentId,
              u.status, u.last_login_at AS lastLoginAt,
              u.must_change_password AS mustChangePassword,
              (u.password_hash IS NOT NULL) AS hasPassword,
              u.created_at AS createdAt
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(
      res,
      rows.map((row) => ({
        ...row,
        hasPassword: Boolean(row.hasPassword),
        mustChangePassword: Boolean(row.mustChangePassword),
      })),
      { page, limit, total }
    );
  } catch (error) {
    next(error);
  }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_url AS avatarUrl,
              entity_id AS entityId, department_id AS departmentId,
              status, last_login_at AS lastLoginAt,
              must_change_password AS mustChangePassword,
              (password_hash IS NOT NULL) AS hasPassword
         FROM users
        WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);

    const [roles] = await pool.query(
      `SELECT r.id, r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?`,
      [req.params.id]
    );

    const user = rows[0];
    return ok(res, {
      ...user,
      hasPassword: Boolean(user.hasPassword),
      mustChangePassword: Boolean(user.mustChangePassword),
      roles,
    });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      name,
      email,
      password,
      entityId,
      departmentId,
      status = 'active',
      roleIds = [],
      mustChangePassword = true,
    } = req.body;

    const passwordHash = await bcrypt.hash(password, 12);
    await conn.beginTransaction();

    const roleRows = await loadRolesForAssignment({ connection: conn, roleIds });
    validateRoleAssignment({
      entityId,
      departmentId: departmentId || null,
      roleRows,
    });

    const [result] = await conn.query(
      `INSERT INTO users
       (entity_id, department_id, name, email, password_hash, must_change_password, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId,
        departmentId || null,
        name,
        email.trim().toLowerCase(),
        passwordHash,
        mustChangePassword ? 1 : 0,
        status,
      ]
    );

    for (const roleId of roleIds) {
      await conn.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [result.insertId, roleId]
      );
    }

    await conn.commit();
    await log({
      entityId,
      userId: req.user.sub,
      action: 'user.create',
      subjectType: 'user',
      subjectId: result.insertId,
      metadata: { email: email.trim().toLowerCase(), entityId, departmentId, roleIds },
    });

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Email sudah dipakai', 409);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, email, entityId, departmentId, status, roleIds, mustChangePassword } = req.body;

    await conn.beginTransaction();

    const [[currentUser]] = await conn.query(
      `SELECT id, entity_id, department_id
         FROM users
        WHERE id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [id],
    );
    if (!currentUser) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    }

    const effectiveEntityId = entityId ?? currentUser.entity_id;
    const effectiveDepartmentId = departmentId !== undefined
      ? (departmentId || null)
      : currentUser.department_id;
    const roleRows = Array.isArray(roleIds)
      ? await loadRolesForAssignment({ connection: conn, roleIds })
      : await loadAssignedRoles({ connection: conn, userId: id });
    validateRoleAssignment({
      entityId: effectiveEntityId,
      departmentId: effectiveDepartmentId,
      roleRows,
    });

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email.trim().toLowerCase()); }
    if (entityId !== undefined) { fields.push('entity_id = ?'); values.push(entityId); }
    if (departmentId !== undefined) { fields.push('department_id = ?'); values.push(departmentId || null); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (mustChangePassword !== undefined) {
      fields.push('must_change_password = ?');
      values.push(mustChangePassword ? 1 : 0);
    }

    if (fields.length) {
      values.push(id);
      const [result] = await conn.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        values
      );
      if (!result.affectedRows) {
        await conn.rollback();
        return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
      }
    }

    if (Array.isArray(roleIds)) {
      await conn.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
      for (const roleId of roleIds) {
        await conn.query(
          'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [id, roleId]
        );
      }
    }

    await conn.commit();
    await log({
      entityId: entityId ?? req.user.entityId ?? null,
      userId: req.user.sub,
      action: 'user.update',
      subjectType: 'user',
      subjectId: Number(id),
      metadata: { name, email, entityId, departmentId, status, roleIds, mustChangePassword },
    });

    return ok(res, { id: Number(id) });
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Email sudah dipakai', 409);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function resetPassword(req, res, next) {
  try {
    const { id } = req.params;
    const passwordHash = await bcrypt.hash(req.body.password, 12);

    const [result] = await pool.query(
      `UPDATE users
          SET password_hash = ?, must_change_password = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [passwordHash, req.body.mustChangePassword === false ? 0 : 1, id]
    );

    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    }

    await log({
      entityId: req.user.entityId ?? null,
      userId: req.user.sub,
      action: 'user.password_reset',
      subjectType: 'user',
      subjectId: Number(id),
      metadata: { mustChangePassword: req.body.mustChangePassword !== false },
    });

    return ok(res, { id: Number(id) });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      'UPDATE users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    }

    await log({
      entityId: null,
      userId: req.user.sub,
      action: 'user.delete',
      subjectType: 'user',
      subjectId: Number(req.params.id),
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, detail, create, update, resetPassword, remove };
