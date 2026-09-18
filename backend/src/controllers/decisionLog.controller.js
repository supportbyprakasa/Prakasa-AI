const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['d.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id=?'); args.push(req.query.entityId); }
    if (req.query.category) { where.push('d.category=?'); args.push(req.query.category); }
    if (req.query.status) { where.push('d.status=?'); args.push(req.query.status); }
    if (req.query.subjectType && req.query.subjectId) {
      where.push('d.subject_type=? AND d.subject_id=?');
      args.push(req.query.subjectType, req.query.subjectId);
    }
    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.department_id AS departmentId,
              d.title, d.decision, d.rationale, d.impact, d.category, d.status,
              d.decided_by_user_id AS decidedByUserId, u.name AS decidedByName,
              d.decided_at AS decidedAt, d.effective_date AS effectiveDate,
              d.subject_type AS subjectType, d.subject_id AS subjectId,
              d.created_at AS createdAt
         FROM decision_logs d
         LEFT JOIN users u ON u.id=d.decided_by_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, title, decision, rationale, impact, category,
      status = 'proposed', decidedByUserId, effectiveDate,
      subjectType, subjectId, contextRecordId, attachmentDocumentId,
    } = req.body;

    const [r] = await pool.query(
      `INSERT INTO decision_logs
       (entity_id, department_id, title, decision, rationale, impact, category,
        status, decided_by_user_id, decided_at, effective_date,
        subject_type, subject_id, context_record_id, attachment_document_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, title, decision, rationale || null,
       impact || null, category || null, status, decidedByUserId || null,
       decidedByUserId ? new Date() : null, effectiveDate || null,
       subjectType || null, subjectId || null, contextRecordId || null,
       attachmentDocumentId || null, req.user.sub]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'decision.create', subjectType: 'decision_log', subjectId: r.insertId,
      metadata: { title, category },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title, decision, rationale, impact, category, status,
      decidedByUserId, effectiveDate,
    } = req.body;

    const updates = [];
    const args = [];
    if (title !== undefined) { updates.push('title=?'); args.push(title); }
    if (decision !== undefined) { updates.push('decision=?'); args.push(decision); }
    if (rationale !== undefined) { updates.push('rationale=?'); args.push(rationale); }
    if (impact !== undefined) { updates.push('impact=?'); args.push(impact); }
    if (category !== undefined) { updates.push('category=?'); args.push(category); }
    if (status !== undefined) { updates.push('status=?'); args.push(status); }
    if (decidedByUserId !== undefined) {
      updates.push('decided_by_user_id=?', 'decided_at=NOW()');
      args.push(decidedByUserId);
    }
    if (effectiveDate !== undefined) { updates.push('effective_date=?'); args.push(effectiveDate); }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);

    args.push(id);
    const [r] = await pool.query(
      `UPDATE decision_logs SET ${updates.join(', ')} WHERE id=? AND deleted_at IS NULL`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Decision tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'decision.update', subjectType: 'decision_log', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE decision_logs SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Decision tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
