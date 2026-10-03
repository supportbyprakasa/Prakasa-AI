const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { warehouseDepartmentId } = require('../services/warehouseDivision');

// Checklists belong to the user's own company and to the Warehouse division
// (so management sees them per division). Neither comes from the request.

async function list(req, res, next) {
  try {
    const where = ['entity_id = ?'];
    const args = [req.user.entityId];
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
    const { checklistDate, title, items } = req.body;
    const entityId = req.user.entityId;
    const departmentId = await warehouseDepartmentId(entityId);
    const [r] = await pool.query(
      `INSERT INTO warehouse_checklists
       (entity_id, department_id, checklist_date, title, items, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId, checklistDate, title,
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
    // Only the warehouse division's own checklist, and only once.
    const departmentId = await warehouseDepartmentId(req.user.entityId);
    const [r] = await pool.query(
      `UPDATE warehouse_checklists
          SET items=?, completed=1, completed_by=?, completed_at=NOW()
        WHERE id=? AND entity_id=? AND (department_id=? OR ? IS NULL) AND completed=0`,
      [JSON.stringify(items || []), req.user.sub, id, req.user.entityId, departmentId, departmentId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Checklist tidak ditemukan atau sudah selesai', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'warehouse_checklist.complete', subjectType: 'warehouse_checklist',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, complete };
