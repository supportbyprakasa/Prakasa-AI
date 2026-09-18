const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['sr.entity_id = ?'];
    const args = [req.entityScope.entityId];
    if (req.query.activeOnly === '1') where.push('sr.is_active = 1');

    const [rows] = await pool.query(
      `SELECT sr.id, sr.entity_id AS entityId,
              sr.document_type_id AS documentTypeId, dt.name AS documentTypeName,
              sr.applies_to_form_id AS appliesToFormId, f.name AS formName,
              sr.min_approval_level AS minApprovalLevel,
              sr.required_signer_role_id AS requiredSignerRoleId, r.name AS requiredSignerRoleName,
              sr.required_signer_user_id AS requiredSignerUserId, u.name AS requiredSignerUserName,
              sr.requires_ai_precheck AS requiresAiPrecheck,
              sr.allow_delegation AS allowDelegation,
              sr.auto_generate_verification_code AS autoGenerateVerificationCode,
              sr.archive_folder_drive_id AS archiveFolderDriveId,
              sr.is_active AS isActive,
              sr.created_at AS createdAt
         FROM signature_rules sr
         LEFT JOIN document_types dt ON dt.id = sr.document_type_id
         LEFT JOIN forms f ON f.id = sr.applies_to_form_id
         LEFT JOIN roles r ON r.id = sr.required_signer_role_id
         LEFT JOIN users u ON u.id = sr.required_signer_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY sr.id DESC`,
      args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      documentTypeId, appliesToFormId, minApprovalLevel = 1,
      requiredSignerRoleId, requiredSignerUserId,
      requiresAiPrecheck = true, allowDelegation = true,
      autoGenerateVerificationCode = true, archiveFolderDriveId, isActive = true,
    } = req.body;
    const entityId = req.entityScope.entityId;

    if (!documentTypeId && !appliesToFormId) {
      return fail(res, 'VALIDATION_ERROR', 'Minimal documentTypeId atau appliesToFormId wajib', 400);
    }
    if (!requiredSignerRoleId && !requiredSignerUserId) {
      return fail(res, 'VALIDATION_ERROR', 'Minimal requiredSignerRoleId atau requiredSignerUserId wajib', 400);
    }

    const [r] = await pool.query(
      `INSERT INTO signature_rules
       (entity_id, document_type_id, applies_to_form_id, min_approval_level,
        required_signer_role_id, required_signer_user_id,
        requires_ai_precheck, allow_delegation,
        auto_generate_verification_code, archive_folder_drive_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, documentTypeId || null, appliesToFormId || null, minApprovalLevel,
       requiredSignerRoleId || null, requiredSignerUserId || null,
       requiresAiPrecheck ? 1 : 0, allowDelegation ? 1 : 0,
       autoGenerateVerificationCode ? 1 : 0, archiveFolderDriveId || null,
       isActive ? 1 : 0]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'signature_rule.create', subjectType: 'signature_rule',
      subjectId: r.insertId,
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      minApprovalLevel, requiredSignerRoleId, requiredSignerUserId,
      requiresAiPrecheck, allowDelegation, autoGenerateVerificationCode,
      archiveFolderDriveId, isActive,
    } = req.body;

    const [r] = await pool.query(
      `UPDATE signature_rules SET
         min_approval_level = COALESCE(?, min_approval_level),
         required_signer_role_id = COALESCE(?, required_signer_role_id),
         required_signer_user_id = COALESCE(?, required_signer_user_id),
         requires_ai_precheck = COALESCE(?, requires_ai_precheck),
         allow_delegation = COALESCE(?, allow_delegation),
         auto_generate_verification_code = COALESCE(?, auto_generate_verification_code),
         archive_folder_drive_id = COALESCE(?, archive_folder_drive_id),
         is_active = COALESCE(?, is_active)
       WHERE id = ? AND entity_id = ?`,
      [
        minApprovalLevel ?? null,
        requiredSignerRoleId ?? null, requiredSignerUserId ?? null,
        requiresAiPrecheck === undefined ? null : (requiresAiPrecheck ? 1 : 0),
        allowDelegation === undefined ? null : (allowDelegation ? 1 : 0),
        autoGenerateVerificationCode === undefined ? null : (autoGenerateVerificationCode ? 1 : 0),
        archiveFolderDriveId ?? null,
        isActive === undefined ? null : (isActive ? 1 : 0),
        id, req.entityScope.entityId,
      ]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Signature rule tidak ditemukan', 404);

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'signature_rule.update', subjectType: 'signature_rule',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `DELETE FROM signature_rules WHERE id = ? AND entity_id = ?`,
      [id, req.entityScope.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Signature rule tidak ditemukan', 404);
    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'signature_rule.delete', subjectType: 'signature_rule',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * Resolve the applicable signature rule for a given context.
 * Priority: form-specific > document-type-specific > first active in entity.
 * Exported for use by signature workflow.
 */
async function resolveRule({ entityId, documentTypeId, formId }) {
  if (formId) {
    const [rows] = await pool.query(
      `SELECT * FROM signature_rules
        WHERE entity_id = ? AND applies_to_form_id = ? AND is_active = 1
        ORDER BY id DESC LIMIT 1`,
      [entityId, formId]
    );
    if (rows[0]) return rows[0];
  }
  if (documentTypeId) {
    const [rows] = await pool.query(
      `SELECT * FROM signature_rules
        WHERE entity_id = ? AND document_type_id = ? AND is_active = 1
        ORDER BY id DESC LIMIT 1`,
      [entityId, documentTypeId]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

module.exports = { list, create, update, remove, resolveRule };
