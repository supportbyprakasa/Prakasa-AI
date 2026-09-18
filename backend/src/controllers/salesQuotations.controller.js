const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['q.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('q.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.status) { where.push('q.status = ?'); args.push(req.query.status); }
    if (req.query.customerId) { where.push('q.customer_id = ?'); args.push(req.query.customerId); }

    const [rows] = await pool.query(
      `SELECT q.id, q.entity_id AS entityId, q.department_id AS departmentId,
              q.customer_id AS customerId, c.name AS customerName,
              q.pipeline_id AS pipelineId, q.quotation_number AS quotationNumber,
              q.total_amount AS totalAmount, q.currency, q.validity_date AS validityDate,
              q.status, q.document_id AS documentId, q.created_at AS createdAt
         FROM sales_quotations q
         JOIN sales_customers c ON c.id = q.customer_id
        WHERE ${where.join(' AND ')}
        ORDER BY q.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, customerId, pipelineId, documentId,
      quotationNumber, totalAmount = 0, currency = 'IDR',
      validityDate, status = 'draft', notes,
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO sales_quotations
       (entity_id, department_id, customer_id, pipeline_id, document_id,
        quotation_number, total_amount, currency, validity_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, customerId, pipelineId || null, documentId || null,
       quotationNumber, totalAmount, currency, validityDate || null, status,
       notes || null, req.user.sub]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'sales_quotation.create', subjectType: 'sales_quotation', subjectId: r.insertId,
      metadata: { quotationNumber, totalAmount },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Nomor quotation sudah ada', 409);
    next(e);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const [r] = await pool.query(
      `UPDATE sales_quotations SET status=?
        WHERE id=? AND deleted_at IS NULL`, [status, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Quotation tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_quotation.update_status', subjectType: 'sales_quotation',
      subjectId: Number(id), metadata: { status },
    });
    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

module.exports = { list, create, updateStatus };
