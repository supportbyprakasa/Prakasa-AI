const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['r.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('r.entity_id = ?'); args.push(req.query.entityId); }

    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId, r.name, r.created_at AS createdAt
         FROM roles r
        WHERE ${where.join(' AND ')}
        ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM roles r WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name FROM roles WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Role tidak ditemukan', 404);
    const [perms] = await pool.query(
      `SELECT p.id, p.code, p.description
         FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?`, [id]
    );
    return ok(res, { ...rows[0], permissions: perms });
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
    const [r] = await conn.query(
      `UPDATE roles SET entity_id=?, name=? WHERE id=? AND deleted_at IS NULL`,
      [entityId, name, id]
    );
    if (!r.affectedRows) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Role tidak ditemukan', 404); }
    if (Array.isArray(permissionIds)) {
      await conn.query(`DELETE FROM role_permissions WHERE role_id=?`, [id]);
      for (const pid of permissionIds) {
        await conn.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
          [id, pid]);
      }
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'role.update', subjectType: 'role', subjectId: Number(id),
      metadata: { entityId, name, permissionIds },
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

module.exports = { list, detail, create, update, remove };
