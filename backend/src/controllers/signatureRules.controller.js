const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

async function validateRuleReferences(entityId, rule) {
  const checks = [
    ['documentTypeId', 'document_types', 'id', 'deleted_at IS NULL', 'Document type'],
    ['appliesToFormId', 'forms', 'id', 'deleted_at IS NULL', 'Form'],
    ['requiredSignerRoleId', 'roles', 'id', 'deleted_at IS NULL', 'Signer role'],
    ['requiredSignerUserId', 'users', 'id', 'deleted_at IS NULL', 'Signer user'],
  ];

  for (const [key, table, column, extra, label] of checks) {
    const value = rule[key];
    if (value === undefined || value === null) continue;
    const [rows] = await pool.query(
      `SELECT id FROM ${table}
        WHERE ${column}=? AND entity_id=? AND ${extra}
        LIMIT 1`,
      [value, entityId]
    );
    if (!rows[0]) {
      const error = new Error(`${label} tidak valid untuk entity ini`);
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }
}

function mergedRule(existing, patch) {
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  return {
    documentTypeId: has('documentTypeId') ? patch.documentTypeId : existing.document_type_id,
    appliesToFormId: has('appliesToFormId') ? patch.appliesToFormId : existing.applies_to_form_id,
    requiredSignerRoleId: has('requiredSignerRoleId')
      ? patch.requiredSignerRoleId : existing.required_signer_role_id,
    requiredSignerUserId: has('requiredSignerUserId')
      ? patch.requiredSignerUserId : existing.required_signer_user_id,
  };
}

function validateRuleShape(rule) {
  if (!rule.documentTypeId && !rule.appliesToFormId) {
    const error = new Error('Minimal documentTypeId atau appliesToFormId wajib');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (rule.documentTypeId && rule.appliesToFormId) {
    const error = new Error('Pilih documentTypeId atau appliesToFormId, bukan keduanya');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (!rule.requiredSignerRoleId && !rule.requiredSignerUserId) {
    const error = new Error('Minimal requiredSignerRoleId atau requiredSignerUserId wajib');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (rule.requiredSignerRoleId && rule.requiredSignerUserId) {
    const error = new Error('Pilih signer role atau signer user, bukan keduanya');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
}

async function list(req, res, next) {
  try {
    const where = ['sr.entity_id = ?', 'sr.deleted_at IS NULL'];
    const args = [req.entityScope.entityId];
    if (req.query.activeOnly === '1') where.push('sr.is_active = 1');

    const [rows] = await pool.query(
      `SELECT sr.id, sr.entity_id AS entityId,
              sr.document_type_id AS documentTypeId, dt.name AS documentTypeName,
              sr.applies_to_form_id AS appliesToFormId, f.name AS formName,
              sr.min_approval_level AS minApprovalLevel,
              sr.required_signer_role_id AS requiredSignerRoleId,
              r.name AS requiredSignerRoleName,
              sr.required_signer_user_id AS requiredSignerUserId,
              u.name AS requiredSignerUserName,
              sr.requires_ai_precheck AS requiresAiPrecheck,
              sr.allow_delegation AS allowDelegation,
              sr.auto_generate_verification_code AS autoGenerateVerificationCode,
              sr.qr_required AS qrRequired,
              sr.checksum_algorithm AS checksumAlgorithm,
              sr.precheck_module AS precheckModule,
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
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    validateRuleShape(req.body);
    await validateRuleReferences(entityId, req.body);

    const [result] = await pool.query(
      `INSERT INTO signature_rules
       (entity_id, document_type_id, applies_to_form_id, min_approval_level,
        required_signer_role_id, required_signer_user_id,
        requires_ai_precheck, allow_delegation,
        auto_generate_verification_code, qr_required,
        checksum_algorithm, precheck_module, archive_folder_drive_id,
        is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId,
        req.body.documentTypeId ?? null,
        req.body.appliesToFormId ?? null,
        req.body.minApprovalLevel ?? 1,
        req.body.requiredSignerRoleId ?? null,
        req.body.requiredSignerUserId ?? null,
        req.body.requiresAiPrecheck === false ? 0 : 1,
        req.body.allowDelegation === false ? 0 : 1,
        req.body.autoGenerateVerificationCode === false ? 0 : 1,
        req.body.qrRequired === false ? 0 : 1,
        req.body.checksumAlgorithm || 'sha256',
        req.body.precheckModule || 'signature_precheck',
        req.body.archiveFolderDriveId ?? null,
        req.body.isActive === false ? 0 : 1,
        req.user.sub,
      ]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'signature_rule.create', subjectType: 'signature_rule',
      subjectId: result.insertId,
    });
    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    const [rows] = await pool.query(
      `SELECT * FROM signature_rules
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, entityId]
    );
    const existing = rows[0];
    if (!existing) return fail(res, 'NOT_FOUND', 'Signature rule tidak ditemukan', 404);

    const nextRule = mergedRule(existing, req.body);
    validateRuleShape(nextRule);
    await validateRuleReferences(entityId, nextRule);

    const map = {
      documentTypeId: 'document_type_id',
      appliesToFormId: 'applies_to_form_id',
      minApprovalLevel: 'min_approval_level',
      requiredSignerRoleId: 'required_signer_role_id',
      requiredSignerUserId: 'required_signer_user_id',
      requiresAiPrecheck: 'requires_ai_precheck',
      allowDelegation: 'allow_delegation',
      autoGenerateVerificationCode: 'auto_generate_verification_code',
      qrRequired: 'qr_required',
      checksumAlgorithm: 'checksum_algorithm',
      precheckModule: 'precheck_module',
      archiveFolderDriveId: 'archive_folder_drive_id',
      isActive: 'is_active',
    };

    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (['requiresAiPrecheck','allowDelegation','autoGenerateVerificationCode','qrRequired','isActive'].includes(key)) {
        value = value ? 1 : 0;
      }
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.id, entityId);
      await pool.query(
        `UPDATE signature_rules SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'signature_rule.update', subjectType: 'signature_rule',
      subjectId: Number(req.params.id), metadata: req.body,
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      `UPDATE signature_rules
          SET is_active=0, deleted_at=NOW()
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Signature rule tidak ditemukan', 404);
    }

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'signature_rule.delete', subjectType: 'signature_rule',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

function normalizeRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    entityId: row.entity_id,
    documentTypeId: row.document_type_id,
    appliesToFormId: row.applies_to_form_id,
    minApprovalLevel: row.min_approval_level,
    requiredSignerRoleId: row.required_signer_role_id,
    requiredSignerUserId: row.required_signer_user_id,
    requiresAiPrecheck: Boolean(row.requires_ai_precheck),
    allowDelegation: Boolean(row.allow_delegation),
    autoGenerateVerificationCode: Boolean(row.auto_generate_verification_code),
    qrRequired: Boolean(row.qr_required),
    checksumAlgorithm: row.checksum_algorithm || 'sha256',
    precheckModule: row.precheck_module || 'signature_precheck',
    archiveFolderDriveId: row.archive_folder_drive_id,
    isActive: Boolean(row.is_active),
  };
}

async function resolveRule({ entityId, documentTypeId, formId }) {
  if (formId) {
    const [rows] = await pool.query(
      `SELECT * FROM signature_rules
        WHERE entity_id=? AND applies_to_form_id=?
          AND is_active=1 AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [entityId, formId]
    );
    if (rows[0]) return normalizeRule(rows[0]);
  }

  if (documentTypeId) {
    const [rows] = await pool.query(
      `SELECT * FROM signature_rules
        WHERE entity_id=? AND document_type_id=?
          AND is_active=1 AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [entityId, documentTypeId]
    );
    if (rows[0]) return normalizeRule(rows[0]);
  }

  return null;
}

module.exports = { list, create, update, remove, resolveRule };
