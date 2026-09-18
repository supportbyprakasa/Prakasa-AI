const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const pipelineSvc = require('../services/salesPipeline.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['p.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('p.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('p.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.stage) { where.push('p.stage = ?'); args.push(req.query.stage); }
    if (req.query.ownerUserId) { where.push('p.owner_user_id = ?'); args.push(req.query.ownerUserId); }

    const [rows] = await pool.query(
      `SELECT p.id, p.entity_id AS entityId, p.department_id AS departmentId,
              p.customer_id AS customerId, c.name AS customerName,
              p.deal_title AS dealTitle, p.stage, p.estimated_value AS estimatedValue,
              p.currency, p.probability, p.expected_close_date AS expectedCloseDate,
              p.owner_user_id AS ownerUserId, u.name AS ownerName,
              p.stage_changed_at AS stageChangedAt, p.closed_at AS closedAt,
              p.created_at AS createdAt
         FROM sales_pipeline p
         JOIN sales_customers c ON c.id = p.customer_id
         LEFT JOIN users u ON u.id = p.owner_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.stage, p.id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT p.*, c.name AS customerName, u.name AS ownerName
         FROM sales_pipeline p
         JOIN sales_customers c ON c.id = p.customer_id
         LEFT JOIN users u ON u.id = p.owner_user_id
        WHERE p.id=? AND p.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Pipeline tidak ditemukan', 404);
    const [history] = await pool.query(
      `SELECT h.id, h.from_stage AS fromStage, h.to_stage AS toStage,
              h.note, h.created_at AS createdAt, u.name AS changedByName
         FROM sales_pipeline_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.pipeline_id=? ORDER BY h.id DESC`, [id]
    );
    return ok(res, { ...rows[0], history });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, customerId, inquiryId, dealTitle,
      estimatedValue, currency = 'IDR', probability = 0,
      expectedCloseDate, ownerUserId, notes, stage = 'new_inquiry',
    } = req.body;
    if (!pipelineSvc.STAGES.includes(stage)) {
      return fail(res, 'VALIDATION_ERROR', 'Stage tidak valid', 400);
    }
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO sales_pipeline
       (entity_id, department_id, customer_id, inquiry_id, deal_title, stage,
        estimated_value, currency, probability, expected_close_date,
        owner_user_id, notes, created_by, stage_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [entityId, departmentId || null, customerId, inquiryId || null, dealTitle, stage,
       estimatedValue || null, currency, probability, expectedCloseDate || null,
       ownerUserId || null, notes || null, req.user.sub]
    );
    await conn.query(
      `INSERT INTO sales_pipeline_history (pipeline_id, from_stage, to_stage, changed_by, note)
       VALUES (?, NULL, ?, ?, 'Initial')`,
      [r.insertId, stage, req.user.sub]
    );
    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'sales_pipeline.create', subjectType: 'sales_pipeline', subjectId: r.insertId,
      metadata: { dealTitle, stage, customerId },
    });

    if (ownerUserId && ownerUserId !== req.user.sub) {
      await notif.create({
        userId: ownerUserId, entityId,
        title: 'Deal baru ditugaskan ke Anda',
        body: dealTitle,
        event: 'sales_pipeline.assigned',
        subjectType: 'sales_pipeline', subjectId: r.insertId,
        actionUrl: `/sales/pipeline/${r.insertId}`,
      });
    }

    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function updateStage(req, res, next) {
  try {
    const { id } = req.params;
    const { stage, note } = req.body;
    const result = await pipelineSvc.changeStage({
      pipelineId: Number(id), toStage: stage, userId: req.user.sub, note,
    });

    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_pipeline.stage_change', subjectType: 'sales_pipeline', subjectId: Number(id),
      metadata: { stage, note, from: result.from },
    });

    // Notifikasi ke owner
    const [p] = await pool.query(
      `SELECT owner_user_id AS ownerUserId, entity_id AS entityId, deal_title AS dealTitle
         FROM sales_pipeline WHERE id=?`, [id]
    );
    if (p[0]?.ownerUserId) {
      await notif.create({
        userId: p[0].ownerUserId, entityId: p[0].entityId,
        title: `Pipeline stage → ${stage}`,
        body: p[0].dealTitle,
        event: 'sales_pipeline.stage_changed',
        subjectType: 'sales_pipeline', subjectId: Number(id),
        actionUrl: `/sales/pipeline/${id}`,
      });
    }

    return ok(res, { id: Number(id), ...result });
  } catch (e) {
    if (/tidak valid|tidak ditemukan/i.test(e.message)) {
      return fail(res, 'VALIDATION_ERROR', e.message, 400);
    }
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      dealTitle, estimatedValue, currency, probability,
      expectedCloseDate, ownerUserId, notes,
    } = req.body;
    const [r] = await pool.query(
      `UPDATE sales_pipeline SET
         deal_title=COALESCE(?,deal_title), estimated_value=COALESCE(?,estimated_value),
         currency=COALESCE(?,currency), probability=COALESCE(?,probability),
         expected_close_date=COALESCE(?,expected_close_date),
         owner_user_id=COALESCE(?,owner_user_id), notes=COALESCE(?,notes)
       WHERE id=? AND deleted_at IS NULL`,
      [dealTitle || null, estimatedValue ?? null, currency || null,
       probability ?? null, expectedCloseDate || null, ownerUserId ?? null,
       notes || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Pipeline tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_pipeline.update', subjectType: 'sales_pipeline', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE sales_pipeline SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Pipeline tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_pipeline.delete', subjectType: 'sales_pipeline', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, updateStage, remove };
