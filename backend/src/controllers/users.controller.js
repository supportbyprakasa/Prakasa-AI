const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['u.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('u.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('u.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.q) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl,
              u.entity_id AS entityId, u.department_id AS departmentId,
              u.status, u.created_at AS createdAt
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_url AS avatarUrl, entity_id AS entityId,
              department_id AS departmentId, status
         FROM users WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    const [roles] = await pool.query(
      `SELECT r.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id=?`, [id]
    );
    return ok(res, { ...rows[0], roles });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { name, email, entityId, departmentId, status = 'active', roleIds = [] } = req.body;
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO users (entity_id, department_id, name, email, status) VALUES (?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, name, email, status]
    );
    for (const rid of roleIds) {
      await conn.query(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [r.insertId, rid]);
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'user.create', subjectType: 'user', subjectId: r.insertId,
      metadata: { email, entityId, departmentId, roleIds },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Email sudah dipakai', 409);
    next(e);
  } finally { conn.release(); }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, entityId, departmentId, status, roleIds } = req.body;
    await conn.beginTransaction();
    const [r] = await conn.query(
      `UPDATE users SET name=?, entity_id=?, department_id=?, status=?
        WHERE id=? AND deleted_at IS NULL`,
      [name, entityId, departmentId || null, status, id]
    );
    if (!r.affectedRows) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404); }
    if (Array.isArray(roleIds)) {
      await conn.query(`DELETE FROM user_roles WHERE user_id=?`, [id]);
      for (const rid of roleIds) {
        await conn.query(`INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, [id, rid]);
      }
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'user.update', subjectType: 'user', subjectId: Number(id),
      metadata: { entityId, departmentId, status, roleIds },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE users SET deleted_at = NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'User tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'user.delete', subjectType: 'user', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove };
