const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['d.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id = ?'); args.push(req.query.entityId); }

    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, e.name AS entityName,
              d.name, d.created_at AS createdAt
         FROM departments d
         JOIN entities e ON e.id = d.entity_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM departments d WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { entityId, name } = req.body;
    const [r] = await pool.query(
      `INSERT INTO departments (entity_id, name) VALUES (?, ?)`, [entityId, name]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'department.create', subjectType: 'department',
      subjectId: r.insertId, metadata: { entityId, name },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { entityId, name } = req.body;
    const [r] = await pool.query(
      `UPDATE departments SET entity_id=?, name=? WHERE id=? AND deleted_at IS NULL`,
      [entityId, name, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Department tidak ditemukan', 404);
    await log({
      entityId, userId: req.user.sub,
      action: 'department.update', subjectType: 'department',
      subjectId: Number(id), metadata: { entityId, name },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE departments SET deleted_at = NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Department tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'department.delete', subjectType: 'department', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
