const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['b.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('b.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('b.department_id = ?'); args.push(req.query.departmentId); }
    const [rows] = await pool.query(
      `SELECT b.id, b.entity_id AS entityId, b.department_id AS departmentId,
              b.name, b.description, b.is_archived AS isArchived,
              b.created_at AS createdAt
         FROM boards b
        WHERE ${where.join(' AND ')}
        ORDER BY b.id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [b] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              name, description, is_archived AS isArchived
         FROM boards WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!b[0]) return fail(res, 'NOT_FOUND', 'Board tidak ditemukan', 404);
    const [cols] = await pool.query(
      `SELECT id, name, position, wip_limit AS wipLimit
         FROM board_columns WHERE board_id=? ORDER BY position ASC`, [id]
    );
    return ok(res, { ...b[0], columns: cols });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { entityId, departmentId, name, description, columns } = req.body;
    await conn.beginTransaction();
    const [b] = await conn.query(
      `INSERT INTO boards (entity_id, department_id, name, description, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, name, description || null, req.user.sub]
    );
    const defaultCols = columns && columns.length
      ? columns
      : [{ name: 'Backlog', position: 0 }, { name: 'To Do', position: 1 },
         { name: 'In Progress', position: 2 }, { name: 'Done', position: 3 }];
    for (const col of defaultCols) {
      await conn.query(
        `INSERT INTO board_columns (board_id, name, position) VALUES (?, ?, ?)`,
        [b.insertId, col.name, col.position ?? 0]
      );
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'board.create', subjectType: 'board', subjectId: b.insertId,
      metadata: { name },
    });
    return ok(res, { id: b.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE boards SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Board tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'board.delete', subjectType: 'board', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, remove };
