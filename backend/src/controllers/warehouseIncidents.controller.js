const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { warehouseDepartmentId } = require('../services/warehouseDivision');

// Incidents belong to the user's own company and to the Warehouse division
// (so management sees them per division). Neither comes from the request.

async function list(req, res, next) {
  try {
    const where = ['entity_id = ?'];
    const args = [req.user.entityId];
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              incident_date AS incidentDate, category, severity, description,
              status, resolution,
              reported_by AS reportedBy, resolved_by AS resolvedBy,
              resolved_at AS resolvedAt, created_at AS createdAt
         FROM warehouse_incidents WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      incidentDate, category, severity = 'low', description, photos,
    } = req.body;
    const entityId = req.user.entityId;
    const departmentId = await warehouseDepartmentId(entityId);
    const [r] = await pool.query(
      `INSERT INTO warehouse_incidents
       (entity_id, department_id, incident_date, category, severity,
        description, photos, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId, incidentDate, category, severity,
       description,
       photos ? JSON.stringify(photos) : null, req.user.sub]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'warehouse_incident.create', subjectType: 'warehouse_incident',
      subjectId: r.insertId, metadata: { category, severity },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function resolve(req, res, next) {
  try {
    const { id } = req.params;
    const { status, resolution } = req.body;
    const [r] = await pool.query(
      `UPDATE warehouse_incidents
          SET status=?, resolution=?, resolved_by=?, resolved_at=NOW()
        WHERE id=? AND entity_id=?`,
      [status || 'resolved', resolution || null, req.user.sub, id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Incident tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'warehouse_incident.resolve', subjectType: 'warehouse_incident',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, resolve };
