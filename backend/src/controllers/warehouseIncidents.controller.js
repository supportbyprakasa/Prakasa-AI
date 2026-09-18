const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.entityId) { where.push('entity_id = ?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              incident_date AS incidentDate, category, severity, description,
              sample_task_id AS sampleTaskId, status, resolution,
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
      entityId, departmentId, incidentDate, category, severity = 'low',
      description, sampleTaskId, photos,
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO warehouse_incidents
       (entity_id, department_id, incident_date, category, severity,
        description, sample_task_id, photos, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, incidentDate, category, severity,
       description, sampleTaskId || null,
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
        WHERE id=?`, [status || 'resolved', resolution || null, req.user.sub, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Incident tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'warehouse_incident.resolve', subjectType: 'warehouse_incident',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, resolve };
