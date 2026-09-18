const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['dt.entity_id = ?'];
    const args = [req.entityScope.entityId];
    if (req.query.activeOnly === '1') where.push('dt.is_active = 1');
    if (req.query.category) { where.push('dt.category = ?'); args.push(req.query.category); }

    const [rows] = await pool.query(
      `SELECT dt.id, dt.entity_id AS entityId, dt.code, dt.name, dt.category,
              dt.default_workflow_id AS defaultWorkflowId,
              wd.name AS defaultWorkflowName,
              dt.default_approval_matrix_id AS defaultApprovalMatrixId,
              dt.default_folder_id AS defaultFolderId,
              dt.requires_signature AS requiresSignature,
              dt.requires_ai_precheck AS requiresAiPrecheck,
              dt.is_active AS isActive, dt.created_at AS createdAt
         FROM document_types dt
         LEFT JOIN workflow_definitions wd ON wd.id = dt.default_workflow_id
        WHERE ${where.join(' AND ')}
        ORDER BY dt.code ASC`,
      args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM document_types
        WHERE id = ? AND entity_id = ?`, [id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);
    return ok(res, rows[0]);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      code, name, category, defaultWorkflowId, defaultApprovalMatrixId,
      defaultFolderId, requiresSignature = false, requiresAiPrecheck = false,
      isActive = true,
    } = req.body;
    const entityId = req.entityScope.entityId;

    if (!/^[a-z0-9-_]+$/.test(code)) {
      return fail(res, 'VALIDATION_ERROR', 'Code hanya huruf kecil, angka, dash, underscore', 400);
    }

    const [r] = await pool.query(
      `INSERT INTO document_types
       (entity_id, code, name, category, default_workflow_id,
        default_approval_matrix_id, default_folder_id,
        requires_signature, requires_ai_precheck, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, code, name, category || null,
       defaultWorkflowId || null, defaultApprovalMatrixId || null,
       defaultFolderId || null,
       requiresSignature ? 1 : 0, requiresAiPrecheck ? 1 : 0,
       isActive ? 1 : 0]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'document_type.create', subjectType: 'document_type',
      subjectId: r.insertId, metadata: { code, name },
    });

    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Code sudah dipakai', 409);
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name, category, defaultWorkflowId, defaultApprovalMatrixId,
      defaultFolderId, requiresSignature, requiresAiPrecheck, isActive,
    } = req.body;

    const [r] = await pool.query(
      `UPDATE document_types SET
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         default_workflow_id = COALESCE(?, default_workflow_id),
         default_approval_matrix_id = COALESCE(?, default_approval_matrix_id),
         default_folder_id = COALESCE(?, default_folder_id),
         requires_signature = COALESCE(?, requires_signature),
         requires_ai_precheck = COALESCE(?, requires_ai_precheck),
         is_active = COALESCE(?, is_active)
       WHERE id = ? AND entity_id = ?`,
      [
        name ?? null, category ?? null,
        defaultWorkflowId ?? null, defaultApprovalMatrixId ?? null,
        defaultFolderId ?? null,
        requiresSignature === undefined ? null : (requiresSignature ? 1 : 0),
        requiresAiPrecheck === undefined ? null : (requiresAiPrecheck ? 1 : 0),
        isActive === undefined ? null : (isActive ? 1 : 0),
        id, req.entityScope.entityId,
      ]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'document_type.update', subjectType: 'document_type',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE document_types SET is_active = 0
        WHERE id = ? AND entity_id = ?`,
      [id, req.entityScope.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);
    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'document_type.deactivate', subjectType: 'document_type',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove };
