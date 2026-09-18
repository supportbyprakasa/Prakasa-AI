const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

async function validateReferences(entityId, { defaultWorkflowId, defaultApprovalMatrixId }) {
  if (defaultWorkflowId !== undefined && defaultWorkflowId !== null) {
    const [rows] = await pool.query(
      `SELECT id FROM workflow_definitions
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [defaultWorkflowId, entityId]
    );
    if (!rows[0]) {
      const error = new Error('Default workflow tidak valid untuk entity ini');
      error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
  }

  if (defaultApprovalMatrixId !== undefined && defaultApprovalMatrixId !== null) {
    const [rows] = await pool.query(
      `SELECT id FROM approval_matrix WHERE id=? AND entity_id=?`,
      [defaultApprovalMatrixId, entityId]
    );
    if (!rows[0]) {
      const error = new Error('Default approval matrix tidak valid untuk entity ini');
      error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
  }
}

async function list(req, res, next) {
  try {
    const where = ['dt.entity_id = ?', 'dt.deleted_at IS NULL'];
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
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, code, name, category,
              default_workflow_id AS defaultWorkflowId,
              default_approval_matrix_id AS defaultApprovalMatrixId,
              default_folder_id AS defaultFolderId,
              requires_signature AS requiresSignature,
              requires_ai_precheck AS requiresAiPrecheck,
              is_active AS isActive, created_at AS createdAt,
              updated_at AS updatedAt
         FROM document_types
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);
    return ok(res, rows[0]);
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    const {
      code, name, category, defaultWorkflowId, defaultApprovalMatrixId,
      defaultFolderId, requiresSignature = false, requiresAiPrecheck = false,
      isActive = true,
    } = req.body;
    const entityId = req.entityScope.entityId;

    await validateReferences(entityId, { defaultWorkflowId, defaultApprovalMatrixId });

    const [result] = await pool.query(
      `INSERT INTO document_types
       (entity_id, code, name, category, default_workflow_id,
        default_approval_matrix_id, default_folder_id,
        requires_signature, requires_ai_precheck, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId, code, name, category ?? null,
        defaultWorkflowId ?? null, defaultApprovalMatrixId ?? null,
        defaultFolderId ?? null,
        requiresSignature ? 1 : 0, requiresAiPrecheck ? 1 : 0,
        isActive ? 1 : 0, req.user.sub,
      ]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'document_type.create', subjectType: 'document_type',
      subjectId: result.insertId, metadata: { code, name },
    });

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Code sudah dipakai', 409);
    }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    const [existing] = await pool.query(
      `SELECT id FROM document_types
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, entityId]
    );
    if (!existing[0]) return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);

    await validateReferences(entityId, req.body);

    const map = {
      name: 'name',
      category: 'category',
      defaultWorkflowId: 'default_workflow_id',
      defaultApprovalMatrixId: 'default_approval_matrix_id',
      defaultFolderId: 'default_folder_id',
      requiresSignature: 'requires_signature',
      requiresAiPrecheck: 'requires_ai_precheck',
      isActive: 'is_active',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (['requiresSignature','requiresAiPrecheck','isActive'].includes(key)) {
        value = value ? 1 : 0;
      }
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.id, entityId);
      await pool.query(
        `UPDATE document_types SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'document_type.update', subjectType: 'document_type',
      subjectId: Number(req.params.id), metadata: req.body,
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      `UPDATE document_types
          SET is_active=0, deleted_at=NOW()
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Document type tidak ditemukan', 404);
    }

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'document_type.deactivate', subjectType: 'document_type',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

module.exports = { list, detail, create, update, remove };
