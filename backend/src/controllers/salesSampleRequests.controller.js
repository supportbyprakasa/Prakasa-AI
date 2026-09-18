const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['s.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('s.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.status) { where.push('s.status = ?'); args.push(req.query.status); }
    if (req.query.customerId) { where.push('s.customer_id = ?'); args.push(req.query.customerId); }

    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId, s.department_id AS departmentId,
              s.customer_id AS customerId, c.name AS customerName,
              s.pipeline_id AS pipelineId, s.product_name AS productName,
              s.product_sku AS productSku, s.quantity, s.unit, s.purpose,
              s.delivery_address AS deliveryAddress,
              s.requested_delivery_date AS requestedDeliveryDate,
              s.priority, s.status,
              s.requested_by AS requestedBy, s.approved_by AS approvedBy,
              s.approved_at AS approvedAt, s.created_at AS createdAt,
              w.id AS warehouseTaskId, w.status AS warehouseStatus,
              w.assigned_to AS warehouseAssignee
         FROM sales_sample_requests s
         LEFT JOIN sales_customers c ON c.id = s.customer_id
         LEFT JOIN warehouse_sample_tasks w ON w.sample_request_id = s.id
        WHERE ${where.join(' AND ')}
        ORDER BY s.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

/**
 * Buat sample request.
 * Setelah sukses, otomatis membuat warehouse_sample_tasks (1:1) dan
 * mengubah pipeline stage ke 'sample_requested' (kalau pipeline_id dikirim).
 * Ini yang membuat DoD "Sample request dari Sales otomatis membuat warehouse_sample_tasks
 * tanpa input manual ulang oleh Warehouse" terpenuhi.
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, customerId, pipelineId, productName,
      productSku, quantity, unit = 'pcs', purpose, deliveryAddress,
      requestedDeliveryDate, priority = 'normal',
    } = req.body;

    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO sales_sample_requests
       (entity_id, department_id, customer_id, pipeline_id, product_name,
        product_sku, quantity, unit, purpose, delivery_address,
        requested_delivery_date, priority, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)`,
      [entityId, departmentId || null, customerId, pipelineId || null,
       productName, productSku || null, quantity, unit,
       purpose || null, deliveryAddress || null,
       requestedDeliveryDate || null, priority, req.user.sub]
    );

    // buat warehouse task otomatis
    const [wt] = await conn.query(
      `INSERT INTO warehouse_sample_tasks
       (entity_id, department_id, sample_request_id, status)
       VALUES (?, ?, ?, 'queued')`,
      [entityId, departmentId || null, r.insertId]
    );

    // update pipeline stage ke sample_requested (kalau ada)
    if (pipelineId) {
      const [pl] = await conn.query(
        `SELECT stage FROM sales_pipeline WHERE id=? FOR UPDATE`, [pipelineId]
      );
      if (pl[0] && pl[0].stage !== 'sample_requested') {
        await conn.query(
          `UPDATE sales_pipeline SET stage='sample_requested', stage_changed_at=NOW() WHERE id=?`,
          [pipelineId]
        );
        await conn.query(
          `INSERT INTO sales_pipeline_history (pipeline_id, from_stage, to_stage, changed_by, note)
           VALUES (?, ?, 'sample_requested', ?, 'Auto: sample requested')`,
          [pipelineId, pl[0].stage, req.user.sub]
        );
      }
    }

    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'sales_sample.request', subjectType: 'sales_sample_request',
      subjectId: r.insertId, metadata: { productName, quantity, warehouseTaskId: wt.insertId },
    });

    // Notifikasi ke approver role nanti di fase approval. Untuk sekarang, notif ke requester sendiri.
    return ok(res, {
      id: r.insertId,
      warehouseTaskId: wt.insertId,
    }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function decide(req, res, next) {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // 'approve' | 'reject'
    const status = action === 'approve' ? 'approved' : 'rejected';
    const [r] = await pool.query(
      `UPDATE sales_sample_requests
          SET status=?, approved_by=?, approved_at=NOW(),
              rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END
        WHERE id=? AND deleted_at IS NULL AND status='requested'`,
      [status, req.user.sub, status, reason || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Sample request tidak ditemukan atau sudah diputuskan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: `sales_sample.${action}`, subjectType: 'sales_sample_request', subjectId: Number(id),
      metadata: { reason },
    });

    // Notifikasi ke requester
    const [s] = await pool.query(
      `SELECT requested_by AS requestedBy, entity_id AS entityId, product_name AS productName
         FROM sales_sample_requests WHERE id=?`, [id]
    );
    if (s[0]) {
      await notif.create({
        userId: s[0].requestedBy, entityId: s[0].entityId,
        title: `Sample request ${status}`,
        body: s[0].productName,
        event: `sample_request.${status}`,
        subjectType: 'sales_sample_request', subjectId: Number(id),
        actionUrl: `/sales/sample-requests`,
      });
    }

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

module.exports = { list, create, decide };
