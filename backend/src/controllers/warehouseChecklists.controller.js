const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.from) { where.push('checklist_date >= ?'); args.push(req.query.from); }
    if (req.query.to) { where.push('checklist_date <= ?'); args.push(req.query.to); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              checklist_date AS checklistDate, title, items, completed,
              completed_by AS completedBy, completed_at AS completedAt,
              created_at AS createdAt
         FROM warehouse_checklists WHERE ${where.join(' AND ')}
        ORDER BY checklist_date DESC, id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { entityId, departmentId, checklistDate, title, items } = req.body;
    const [r] = await pool.query(
      `INSERT INTO warehouse_checklists
       (entity_id, department_id, checklist_date, title, items, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, checklistDate, title,
       JSON.stringify(items || []), req.user.sub]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'warehouse_checklist.create', subjectType: 'warehouse_checklist',
      subjectId: r.insertId,
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function complete(req, res, next) {
  try {
    const { id } = req.params;
    const { items } = req.body;
    const [r] = await pool.query(
      `UPDATE warehouse_checklists
          SET items=?, completed=1, completed_by=?, completed_at=NOW()
        WHERE id=?`,
      [JSON.stringify(items || []), req.user.sub, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Checklist tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'warehouse_checklist.complete', subjectType: 'warehouse_checklist',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, complete };
