const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const rolePolicy = require('../services/rolePolicy.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['r.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('r.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) {
      where.push('r.department_id = ?');
      args.push(req.query.departmentId);
    }
    if (req.query.roleLevel) {
      where.push('r.role_level = ?');
      args.push(req.query.roleLevel);
    }
    if (req.query.standard === 'true') where.push('r.is_system_template = 1');
    if (req.query.standard === 'false') where.push('r.is_system_template = 0');
    if (req.query.q) {
      where.push('(r.name LIKE ? OR r.role_key LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId, r.name,
              r.role_key AS roleKey, r.department_id AS departmentId,
              d.name AS departmentName, r.role_level AS roleLevel,
              r.is_system_template AS isSystemTemplate,
              COUNT(DISTINCT rp.permission_id) AS permissionCount,
              COUNT(DISTINCT ur.user_id) AS userCount,
              r.created_at AS createdAt, r.updated_at AS updatedAt
         FROM roles r
         LEFT JOIN departments d ON d.id=r.department_id
         LEFT JOIN role_permissions rp ON rp.role_id=r.id
         LEFT JOIN user_roles ur ON ur.role_id=r.id
        WHERE ${where.join(' AND ')}
        GROUP BY r.id, r.entity_id, r.name, r.role_key, r.department_id,
                 d.name, r.role_level, r.is_system_template,
                 r.created_at, r.updated_at
        ORDER BY d.name, FIELD(r.role_level, 'member', 'supervisor', 'head', 'admin', 'custom'), r.name
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM roles r WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows.map((row) => ({
      ...row,
      isSystemTemplate: Boolean(row.isSystemTemplate),
      permissionCount: Number(row.permissionCount),
      userCount: Number(row.userCount),
    })), { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId, r.name,
              r.role_key AS roleKey, r.department_id AS departmentId,
              d.name AS departmentName, r.role_level AS roleLevel,
              r.is_system_template AS isSystemTemplate,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id=r.id) AS permissionCount,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id=r.id) AS userCount,
              r.created_at AS createdAt, r.updated_at AS updatedAt
         FROM roles r
         LEFT JOIN departments d ON d.id=r.department_id
        WHERE r.id=? AND r.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Role tidak ditemukan', 404);
    const [perms] = await pool.query(
      `SELECT p.id, p.code, p.description
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?`, [id]
    );
    return ok(res, {
      ...rows[0],
      isSystemTemplate: Boolean(rows[0].isSystemTemplate),
      permissionCount: Number(rows[0].permissionCount),
      userCount: Number(rows[0].userCount),
      permissions: perms,
    });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { entityId, name, permissionIds = [] } = req.body;
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO roles (entity_id, name) VALUES (?, ?)`, [entityId, name]
    );
    for (const pid of permissionIds) {
      await conn.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [r.insertId, pid]);
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'role.create', subjectType: 'role', subjectId: r.insertId,
      metadata: { entityId, name, permissionIds },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { entityId, name, permissionIds } = req.body;
    await conn.beginTransaction();

    const [[currentRole]] = await conn.query(
      `SELECT id, entity_id, name
         FROM roles
        WHERE id=? AND deleted_at IS NULL
        FOR UPDATE`,
      [id],
    );
    if (!currentRole) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Role tidak ditemukan', 404);
    }

    const fields = [];
    const values = [];
    if (entityId !== undefined) {
      fields.push('entity_id=?');
      values.push(entityId);
    }
    if (name !== undefined) {
      fields.push('name=?');
      values.push(name);
    }
    if (fields.length) {
      await conn.query(
        `UPDATE roles SET ${fields.join(', ')} WHERE id=? AND deleted_at IS NULL`,
        [...values, id],
      );
    }
    if (Array.isArray(permissionIds)) {
      await conn.query(`DELETE FROM role_permissions WHERE role_id=?`, [id]);
      for (const pid of permissionIds) {
        await conn.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
          [id, pid]);
      }
    }
    await conn.commit();
    const effectiveEntityId = entityId ?? currentRole.entity_id;
    await log({
      entityId: effectiveEntityId, userId: req.user.sub,
      action: 'role.update', subjectType: 'role', subjectId: Number(id),
      metadata: { entityId: effectiveEntityId, name, permissionIds },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE roles SET deleted_at = NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Role tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'role.delete', subjectType: 'role', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function resetStandard(req, res, next) {
  try {
    const result = await rolePolicy.resetStandardRole({
      roleId: req.params.id,
      actor: {
        userId: req.user.sub,
        entityId: req.user.entityId ?? null,
      },
    });
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

module.exports = { list, detail, create, update, remove, resetStandard };
