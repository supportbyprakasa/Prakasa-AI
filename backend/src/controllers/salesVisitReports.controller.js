const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.customerId) { where.push('v.customer_id = ?'); args.push(req.query.customerId); }
    if (req.query.pipelineId) { where.push('v.pipeline_id = ?'); args.push(req.query.pipelineId); }
    if (req.query.from) { where.push('v.visit_date >= ?'); args.push(req.query.from); }
    if (req.query.to) { where.push('v.visit_date <= ?'); args.push(req.query.to); }

    const [rows] = await pool.query(
      `SELECT v.id, v.entity_id AS entityId, v.department_id AS departmentId,
              v.customer_id AS customerId, c.name AS customerName,
              v.pipeline_id AS pipelineId, v.visit_date AS visitDate,
              v.location, v.latitude, v.longitude, v.summary, v.photos,
              v.created_by AS createdBy, u.name AS createdByName,
              v.created_at AS createdAt
         FROM sales_visit_reports v
         LEFT JOIN sales_customers c ON c.id = v.customer_id
         LEFT JOIN users u ON u.id = v.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY v.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, customerId, pipelineId, visitDate,
      location, latitude, longitude, summary, rawInput, photos,
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO sales_visit_reports
       (entity_id, department_id, customer_id, pipeline_id, visit_date,
        location, latitude, longitude, summary, raw_input, photos, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, customerId || null, pipelineId || null,
       visitDate, location || null, latitude ?? null, longitude ?? null,
       summary || null, rawInput || null,
       photos ? JSON.stringify(photos) : null, req.user.sub]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'sales_visit.create', subjectType: 'sales_visit_report', subjectId: r.insertId,
      metadata: { customerId, pipelineId },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { list, create };
