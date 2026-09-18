const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const sigSvc = require('../services/signature.service');
const pdfSvc = require('../services/pdf.service');
const drive = require('../services/googleDrive.service');
const { resolveFolder } = require('./folderMappingRules.controller');
const precheckSvc = require('../services/signaturePrecheck.service');
const qrSvc = require('../services/qrCode.service');

function normalizeRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentTypeId: row.document_type_id,
    minApprovalLevel: Number(row.min_approval_level || 0),
    requiredSignerRoleId: row.required_signer_role_id,
    requiredSignerUserId: row.required_signer_user_id,
    requiresAiPrecheck: Boolean(row.requires_ai_precheck),
    allowDelegation: Boolean(row.allow_delegation),
    autoGenerateVerificationCode: Boolean(row.auto_generate_verification_code),
    qrRequired: Boolean(row.qr_required),
    checksumAlgorithm: row.checksum_algorithm || 'sha256',
    precheckModule: row.precheck_module || 'signature_precheck',
    archiveFolderDriveId: row.archive_folder_drive_id,
  };
}

async function resolveDocumentTypeId(entityId, document) {
  if (!document?.document_type) return null;
  const [rows] = await pool.query(
    `SELECT id FROM document_types
      WHERE entity_id=? AND code=? AND deleted_at IS NULL
      LIMIT 1`,
    [entityId, document.document_type]
  );
  return rows[0]?.id || null;
}

async function resolveRule({ entityId, documentTypeId, ruleId = null }, conn = pool) {
  if (ruleId) {
    const [rows] = await conn.query(
      `SELECT * FROM signature_rules
        WHERE id=? AND entity_id=? AND is_active=1 AND deleted_at IS NULL
        LIMIT 1`,
      [ruleId, entityId]
    );
    return normalizeRule(rows[0]);
  }

  if (!documentTypeId) return null;
  const [rows] = await conn.query(
    `SELECT * FROM signature_rules
      WHERE entity_id=? AND document_type_id=?
        AND is_active=1 AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [entityId, documentTypeId]
  );
  return normalizeRule(rows[0]);
}

async function roleIdsForUser(userId, entityId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT ur.role_id AS roleId
       FROM user_roles ur
       JOIN roles r ON r.id=ur.role_id
      WHERE ur.user_id=?
        AND r.entity_id=?
        AND r.deleted_at IS NULL`,
    [userId, entityId]
  );
  return rows.map((row) => Number(row.roleId));
}

async function validateAssignedSigner({
  entityId,
  userId,
  assignedUserId,
  assignedRoleId,
  allowDelegation,
  requestType,
  documentTypeId,
  conn = pool,
}) {
  if (assignedUserId && Number(assignedUserId) === Number(userId)) return true;

  if (assignedRoleId) {
    const roles = await roleIdsForUser(userId, entityId, conn);
    if (roles.includes(Number(assignedRoleId))) return true;
  }

  if (assignedUserId && allowDelegation) {
    const conditions = [
      'entity_id=?',
      'from_user_id=?',
      'to_user_id=?',
      'is_active=1',
      'deleted_at IS NULL',
      'starts_at<=NOW()',
      'ends_at>=NOW()',
    ];
    const args = [entityId, assignedUserId, userId];

    if (requestType) {
      conditions.push('(applies_to_request_type IS NULL OR applies_to_request_type=?)');
      args.push(requestType);
    } else {
      conditions.push('applies_to_request_type IS NULL');
    }

    if (documentTypeId) {
      conditions.push('(applies_to_document_type_id IS NULL OR applies_to_document_type_id=?)');
      args.push(documentTypeId);
    } else {
      conditions.push('applies_to_document_type_id IS NULL');
    }

    const [rows] = await conn.query(
      `SELECT id FROM approval_delegations
        WHERE ${conditions.join(' AND ')}
        LIMIT 1`,
      args
    );
    if (rows[0]) return true;
  }

  return false;
}

async function approvalMeetsRule(approvalRequestId, entityId, rule, conn = pool) {
  const [rows] = await conn.query(
    `SELECT * FROM approval_requests
      WHERE id=? AND entity_id=?
      LIMIT 1`,
    [approvalRequestId, entityId]
  );
  const approval = rows[0];
  if (!approval || approval.status !== 'approved') return false;

  if (rule?.minApprovalLevel > 0) {
    const [[{ approvedCount }]] = await conn.query(
      `SELECT COUNT(*) AS approvedCount
         FROM approval_steps
        WHERE approval_request_id=? AND status='approved'`,
      [approvalRequestId]
    );
    if (Number(approvedCount) < Number(rule.minApprovalLevel)) return false;
  }

  return true;
}

async function sourceDocumentHash(document, algorithm, userId) {
  if (document.drive_file_id) {
    const downloaded = await drive.downloadFileBuffer(document.drive_file_id, {
      entityId: document.entity_id,
      userId,
      subjectType: 'document',
      subjectId: document.id,
    });
    return {
      hash: crypto.createHash(algorithm).update(downloaded.buffer).digest('hex'),
      source: 'drive-content',
    };
  }

  const canonical = JSON.stringify({
    id: document.id,
    title: document.title,
    documentType: document.document_type,
    currentVersionId: document.current_version_id || null,
    updatedAt: document.updated_at || null,
  });
  return {
    hash: crypto.createHash(algorithm).update(canonical).digest('hex'),
    source: 'metadata-fallback',
  };
}

async function notifyAssignedSigner({ entityId, userId, roleId, title, requestId }) {
  const targets = new Set();
  if (userId) targets.add(Number(userId));

  if (roleId) {
    const [users] = await pool.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id
        WHERE ur.role_id=?
          AND u.entity_id=?
          AND r.entity_id=?
          AND u.status='active'
          AND u.deleted_at IS NULL
          AND r.deleted_at IS NULL`,
      [roleId, entityId, entityId]
    );
    for (const user of users) targets.add(Number(user.id));
  }

  for (const target of targets) {
    try {
      await notif.create({
        userId: target,
        entityId,
        title: 'Permintaan tanda tangan',
        body: title,
        event: 'signature.requested',
        subjectType: 'signature_request',
        subjectId: requestId,
        actionUrl: `/signatures/${requestId}`,
      });
    } catch {
      // Notification failure must not undo a created request.
    }
  }
}

async function saveSignatureAsset(req, res, next) {
  try {
    const raw = String(req.body.imageBase64 || '').replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length || buffer.length > 500 * 1024) {
      return fail(res, 'VALIDATION_ERROR', 'Ukuran tanda tangan tidak valid (maks 500KB)', 400);
    }

    const { encrypted, iv, authTag } = sigSvc.encryptBuffer(buffer);
    await pool.query(
      `INSERT INTO signature_assets
       (user_id, encrypted_blob, iv, auth_tag, mime_type)
       VALUES (?, ?, ?, ?, 'image/png')
       ON DUPLICATE KEY UPDATE
         encrypted_blob=VALUES(encrypted_blob),
         iv=VALUES(iv),
         auth_tag=VALUES(auth_tag),
         mime_type='image/png'`,
      [req.user.sub, encrypted, iv, authTag]
    );

    await activityLog({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'signature_asset.save',
      subjectType: 'user',
      subjectId: req.user.sub,
    });
    return ok(res, { saved: true });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const {
      departmentId = null,
      documentId,
      approvalRequestId,
      signatureType = 'level_2',
      signerUserId = null,
      signerRoleId = null,
    } = req.body;

    const [documents] = await conn.query(
      `SELECT * FROM documents
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [documentId, entityId]
    );
    const document = documents[0];
    if (!document) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);

    if (
      departmentId &&
      document.department_id &&
      Number(departmentId) !== Number(document.department_id)
    ) {
      return fail(
        res,
        'VALIDATION_ERROR',
        'departmentId tidak sesuai department dokumen',
        400
      );
    }
    if (departmentId && !document.department_id) {
      const [departments] = await conn.query(
        `SELECT id FROM departments
          WHERE id=? AND entity_id=? AND deleted_at IS NULL
          LIMIT 1`,
        [departmentId, entityId]
      );
      if (!departments[0]) {
        return fail(res, 'VALIDATION_ERROR', 'Department tidak valid untuk entity ini', 400);
      }
    }

    const documentTypeId = await resolveDocumentTypeId(entityId, document);
    const rule = await resolveRule({ entityId, documentTypeId }, conn);

    await conn.beginTransaction();

    const [approvals] = await conn.query(
      `SELECT * FROM approval_requests
        WHERE id=? AND entity_id=?
        LIMIT 1 FOR UPDATE`,
      [approvalRequestId, entityId]
    );
    const approval = approvals[0];
    if (!approval || approval.status !== 'approved') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Approval belum approved', 409);
    }

    const approvalTargetsDocument =
      Number(approval.document_id) === Number(documentId) ||
      (
        approval.subject_type === 'document' &&
        Number(approval.subject_id) === Number(documentId)
      );
    if (!approvalTargetsDocument) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Approval tidak terkait dokumen ini', 400);
    }

    if (!(await approvalMeetsRule(approvalRequestId, entityId, rule, conn))) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Approval belum memenuhi minimum signature rule', 409);
    }

    // Resolve signer from the exact matrix rules used by this approval.
    let matrixSignerUserId = null;
    let matrixSignerRoleId = null;
    if (approval.matrix_rule_ids) {
      let ruleIds = approval.matrix_rule_ids;
      if (typeof ruleIds === 'string') {
        try { ruleIds = JSON.parse(ruleIds); } catch { ruleIds = []; }
      }
      if (Array.isArray(ruleIds) && ruleIds.length) {
        const [matrixRows] = await conn.query(
          `SELECT signer_user_id AS signerUserId,
                  signer_role_id AS signerRoleId
             FROM approval_matrix
            WHERE id IN (?)
              AND entity_id=?
            ORDER BY order_index ASC, id ASC`,
          [ruleIds, entityId]
        );

        const assignments = new Map();
        for (const row of matrixRows) {
          if (!row.signerUserId && !row.signerRoleId) continue;
          const key = `${row.signerUserId || 0}:${row.signerRoleId || 0}`;
          assignments.set(key, row);
        }
        if (assignments.size > 1) {
          await conn.rollback();
          return fail(
            res,
            'CONFLICT',
            'Approval matrix memiliki lebih dari satu signer assignment',
            409
          );
        }
        if (assignments.size === 1) {
          const assignment = [...assignments.values()][0];
          matrixSignerUserId = assignment.signerUserId || null;
          matrixSignerRoleId = assignment.signerRoleId || null;
        }
      }
    }

    const authoritativeUserId =
      rule?.requiredSignerUserId || matrixSignerUserId || null;
    const authoritativeRoleId =
      rule?.requiredSignerRoleId || matrixSignerRoleId || null;

    if (
      authoritativeUserId &&
      signerUserId &&
      Number(authoritativeUserId) !== Number(signerUserId)
    ) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Signer user tidak sesuai konfigurasi', 400);
    }
    if (
      authoritativeRoleId &&
      signerRoleId &&
      Number(authoritativeRoleId) !== Number(signerRoleId)
    ) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Signer role tidak sesuai konfigurasi', 400);
    }

    const assignedUserId = authoritativeUserId || signerUserId || null;
    const assignedRoleId = authoritativeRoleId || signerRoleId || null;

    if (!assignedUserId && !assignedRoleId) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Signer user/role belum dikonfigurasi', 400);
    }
    if (assignedUserId && assignedRoleId) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Pilih signer user atau signer role, bukan keduanya', 400);
    }

    if (assignedUserId) {
      const [users] = await conn.query(
        `SELECT id FROM users
          WHERE id=? AND entity_id=? AND status='active' AND deleted_at IS NULL`,
        [assignedUserId, entityId]
      );
      if (!users[0]) {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', 'Signer user tidak valid', 400);
      }
    }

    if (assignedRoleId) {
      const [roles] = await conn.query(
        `SELECT id FROM roles
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        [assignedRoleId, entityId]
      );
      if (!roles[0]) {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', 'Signer role tidak valid', 400);
      }
    }

    const [existing] = await conn.query(
      `SELECT id FROM signature_requests
        WHERE document_id=? AND status IN ('pending','approved')
        LIMIT 1 FOR UPDATE`,
      [documentId]
    );
    if (existing[0]) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Masih ada signature request aktif untuk dokumen ini', 409);
    }

    const [result] = await conn.query(
      `INSERT INTO signature_requests
       (entity_id, department_id, document_id, approval_request_id,
        signature_rule_id, assigned_signer_user_id, assigned_signer_role_id,
        signature_type, status, requested_by, signed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      [
        entityId,
        departmentId || document.department_id || null,
        documentId,
        approvalRequestId,
        rule?.id || null,
        assignedUserId,
        assignedRoleId,
        signatureType,
        req.user.sub,
      ]
    );

    await conn.query(
      `INSERT INTO signature_logs
       (signature_request_id, action, actor_user_id, document_id, note)
       VALUES (?, 'requested', ?, ?, ?)`,
      [result.insertId, req.user.sub, documentId, 'Signature requested']
    );

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'signature.request',
      subjectType: 'signature_request',
      subjectId: result.insertId,
      metadata: {
        documentId,
        approvalRequestId,
        signatureRuleId: rule?.id || null,
        matrixKey: approval.matrix_key || null,
        assignedUserId,
        assignedRoleId,
      },
    });

    await notifyAssignedSigner({
      entityId,
      userId: assignedUserId,
      roleId: assignedRoleId,
      title: document.title,
      requestId: result.insertId,
    });

    return ok(res, {
      id: result.insertId,
      signatureRuleId: rule?.id || null,
      assignedSignerUserId: assignedUserId,
      assignedSignerRoleId: assignedRoleId,
    }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally {
    conn.release();
  }
}

async function runPrecheck(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT sr.*, d.document_type
         FROM signature_requests sr
         JOIN documents d ON d.id=sr.document_id
        WHERE sr.id=? AND sr.entity_id=?
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    const request = rows[0];
    if (!request) return fail(res, 'NOT_FOUND', 'Signature request tidak ditemukan', 404);

    const documentTypeId = await resolveDocumentTypeId(
      request.entity_id,
      { document_type: request.document_type }
    );
    const rule = await resolveRule({
      entityId: request.entity_id,
      documentTypeId,
      ruleId: request.signature_rule_id,
    });

    if (request.signature_rule_id && !rule) {
      return fail(res, 'CONFLICT', 'Signature rule request sudah tidak aktif', 409);
    }

    const result = await precheckSvc.runPrecheck({
      documentId: request.document_id,
      signatureRequestId: request.id,
      approvalRequestId: request.approval_request_id,
      module: rule?.precheckModule || 'signature_precheck',
      user: req.user,
    });
    return ok(res, result);
  } catch (error) {
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  }
}

async function sign(req, res, next) {
  const entityId = req.entityScope.entityId;
  const requestId = Number(req.params.id);
  const { overridePrecheck = false, overrideReason = null } = req.body || {};

  try {
    const [initialRows] = await pool.query(
      `SELECT sr.*, d.title, d.document_type, d.drive_file_id,
              d.current_version_id, d.updated_at, d.department_id AS documentDepartmentId,
              ar.request_type AS approvalRequestType,
              ar.document_type_id AS approvalDocumentTypeId
         FROM signature_requests sr
         JOIN documents d ON d.id=sr.document_id
         LEFT JOIN approval_requests ar ON ar.id=sr.approval_request_id
        WHERE sr.id=? AND sr.entity_id=? AND d.deleted_at IS NULL
        LIMIT 1`,
      [requestId, entityId]
    );
    const initial = initialRows[0];
    if (!initial) return fail(res, 'NOT_FOUND', 'Signature request tidak ditemukan', 404);
    if (initial.status !== 'pending') {
      return fail(res, 'CONFLICT', 'Signature request sudah tidak pending', 409);
    }

    const documentTypeId = initial.approvalDocumentTypeId ||
      await resolveDocumentTypeId(entityId, initial);
    const rule = await resolveRule({
      entityId,
      documentTypeId,
      ruleId: initial.signature_rule_id,
    });

    if (initial.signature_rule_id && !rule) {
      return fail(
        res,
        'CONFLICT',
        'Signature rule yang terikat ke request ini sudah tidak aktif',
        409
      );
    }

    const allowed = await validateAssignedSigner({
      entityId,
      userId: req.user.sub,
      assignedUserId: initial.assigned_signer_user_id,
      assignedRoleId: initial.assigned_signer_role_id,
      allowDelegation: rule?.allowDelegation ?? false,
      requestType: initial.approvalRequestType,
      documentTypeId,
    });
    if (!allowed) {
      return fail(res, 'FORBIDDEN', 'Anda bukan signer/delegate yang ditugaskan', 403);
    }

    let precheckResult = null;
    if (rule?.requiresAiPrecheck) {
      precheckResult = await precheckSvc.runPrecheck({
        documentId: initial.document_id,
        signatureRequestId: initial.id,
        approvalRequestId: initial.approval_request_id,
        module: rule.precheckModule,
        user: req.user,
      });

      const blocked = precheckResult.status === 'failed' ||
        precheckResult.status === 'skipped';
      if (blocked) {
        const canOverride = (req.user.permissions || []).includes('signature_precheck.override');
        if (!overridePrecheck || !canOverride || !String(overrideReason || '').trim()) {
          return fail(
            res,
            'PRECHECK_BLOCKED',
            'AI precheck gagal/tidak tersedia. Override membutuhkan permission dan alasan.',
            409,
            { status: precheckResult.status, findings: precheckResult.findings }
          );
        }
      }
    }

    const algorithm = ['sha256', 'sha512'].includes(rule?.checksumAlgorithm)
      ? rule.checksumAlgorithm
      : 'sha256';

    const documentForHash = {
      id: initial.document_id,
      entity_id: entityId,
      title: initial.title,
      document_type: initial.document_type,
      drive_file_id: initial.drive_file_id,
      current_version_id: initial.current_version_id,
      updated_at: initial.updated_at,
    };
    const sourceHash = await sourceDocumentHash(
      documentForHash,
      algorithm,
      req.user.sub
    );

    const shouldCreateVerification = !rule ||
      rule.autoGenerateVerificationCode ||
      rule.qrRequired;
    const verificationCode = shouldCreateVerification
      ? crypto.randomBytes(16).toString('hex').toUpperCase()
      : null;

    let qrBuffer = null;
    let verificationUrl = null;
    if (rule?.qrRequired || (!rule && verificationCode)) {
      const qr = await qrSvc.generateVerificationQrBuffer({
        verificationCode,
        entityId,
        userId: req.user.sub,
        subjectId: requestId,
      });
      qrBuffer = qr.buffer;
      verificationUrl = qr.payload;
    } else if (verificationCode) {
      verificationUrl = qrSvc.verificationUrl({ verificationCode });
    }

    const [signerRows] = await pool.query(
      'SELECT id, name, email FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1',
      [req.user.sub]
    );
    const signer = signerRows[0];
    if (!signer) return fail(res, 'FORBIDDEN', 'Signer user tidak ditemukan', 403);

    const pdfBuffer = await pdfSvc.generateSignedPdfWithQr({
      title: initial.title,
      signerName: signer.name,
      signerEmail: signer.email,
      documentHash: sourceHash.hash,
      verificationCode: verificationCode || 'N/A',
      signedAt: new Date(),
      qrBuffer,
      verificationUrl,
      hashAlgorithm: algorithm,
    });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [lockedRows] = await conn.query(
        `SELECT * FROM signature_requests
          WHERE id=? AND entity_id=?
          LIMIT 1 FOR UPDATE`,
        [requestId, entityId]
      );
      const locked = lockedRows[0];
      if (!locked || locked.status !== 'pending') {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Signature request berubah/sudah diproses', 409);
      }

      const [approvalRows] = await conn.query(
        `SELECT * FROM approval_requests
          WHERE id=? AND entity_id=?
          LIMIT 1 FOR UPDATE`,
        [locked.approval_request_id, entityId]
      );
      const approval = approvalRows[0];
      if (!approval || approval.status !== 'approved') {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Approval tidak dalam status approved', 409);
      }

      const approvalStillTargetsDocument =
        Number(approval.document_id) === Number(locked.document_id) ||
        (
          approval.subject_type === 'document' &&
          Number(approval.subject_id) === Number(locked.document_id)
        );
      if (!approvalStillTargetsDocument) {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Approval tidak lagi terkait dokumen ini', 409);
      }

      const [currentDocs] = await conn.query(
        `SELECT drive_file_id, current_version_id, updated_at
           FROM documents
          WHERE id=? AND entity_id=? AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE`,
        [locked.document_id, entityId]
      );
      const currentDoc = currentDocs[0];
      if (!currentDoc) {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Dokumen sudah tidak tersedia', 409);
      }

      const sameNullableNumber = (a, b) =>
        (a === null || a === undefined) && (b === null || b === undefined)
          ? true
          : Number(a) === Number(b);
      const documentChanged =
        String(currentDoc.drive_file_id || '') !== String(initial.drive_file_id || '') ||
        !sameNullableNumber(currentDoc.current_version_id, initial.current_version_id) ||
        new Date(currentDoc.updated_at).getTime() !== new Date(initial.updated_at).getTime();

      if (documentChanged) {
        await conn.rollback();
        return fail(
          res,
          'CONFLICT',
          'Dokumen berubah saat proses tanda tangan. Jalankan ulang precheck/sign.',
          409
        );
      }

      const lockedRule = await resolveRule({
        entityId,
        documentTypeId: approval.document_type_id || documentTypeId,
        ruleId: locked.signature_rule_id,
      }, conn);

      if (locked.signature_rule_id && !lockedRule) {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Signature rule sudah tidak aktif', 409);
      }

      if (rule && lockedRule) {
        const policyChanged =
          rule.checksumAlgorithm !== lockedRule.checksumAlgorithm ||
          rule.qrRequired !== lockedRule.qrRequired ||
          rule.requiresAiPrecheck !== lockedRule.requiresAiPrecheck ||
          rule.precheckModule !== lockedRule.precheckModule ||
          rule.allowDelegation !== lockedRule.allowDelegation ||
          rule.minApprovalLevel !== lockedRule.minApprovalLevel;
        if (policyChanged) {
          await conn.rollback();
          return fail(
            res,
            'CONFLICT',
            'Signature rule berubah saat proses. Jalankan ulang precheck/sign.',
            409
          );
        }
      }

      const effectiveRule = lockedRule || rule;

      const signerStillAllowed = await validateAssignedSigner({
        entityId,
        userId: req.user.sub,
        assignedUserId: locked.assigned_signer_user_id,
        assignedRoleId: locked.assigned_signer_role_id,
        allowDelegation: effectiveRule?.allowDelegation ?? false,
        requestType: approval.request_type,
        documentTypeId: approval.document_type_id || documentTypeId,
        conn,
      });
      if (!signerStillAllowed) {
        await conn.rollback();
        return fail(res, 'FORBIDDEN', 'Assignment signer/delegation sudah tidak valid', 403);
      }

      if (!(await approvalMeetsRule(approval.id, entityId, effectiveRule, conn))) {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Approval tidak lagi memenuhi signature rule', 409);
      }

      const folderId = effectiveRule?.archiveFolderDriveId || await resolveFolder({
        entityId,
        departmentId: locked.department_id || initial.documentDepartmentId,
        documentType: initial.document_type,
      });

      const uploaded = await drive.uploadFile(
        {
          name: `${initial.title} - SIGNED.pdf`,
          mimeType: 'application/pdf',
          buffer: pdfBuffer,
          parentId: folderId || undefined,
        },
        {
          entityId,
          userId: req.user.sub,
          subjectType: 'signature_request',
          subjectId: requestId,
        }
      );

      const [signedResult] = await conn.query(
        `INSERT INTO signed_documents
         (signature_request_id, document_id, drive_file_id, drive_folder_id,
          web_view_link, document_hash, signed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          locked.document_id,
          uploaded.id,
          folderId || null,
          uploaded.webViewLink || null,
          sourceHash.hash,
          req.user.sub,
        ]
      );

      if (verificationCode) {
        await conn.query(
          `INSERT INTO document_verifications
           (document_id, verification_code, verification_url,
            document_hash, hash_algorithm, signed_document_id,
            qr_generated_at, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            locked.document_id,
            verificationCode,
            verificationUrl,
            sourceHash.hash,
            algorithm,
            signedResult.insertId,
            qrBuffer ? new Date() : null,
            JSON.stringify({
              signerUserId: req.user.sub,
              signatureRequestId: requestId,
              signatureRuleId: locked.signature_rule_id || null,
              hashSource: sourceHash.source,
              precheckStatus: precheckResult?.status || null,
              precheckOverride: Boolean(
                overridePrecheck &&
                (precheckResult?.status === 'failed' || precheckResult?.status === 'skipped')
              ),
            }),
          ]
        );
      }

      await conn.query(
        `UPDATE signature_requests
            SET status='signed', signed_by=?, signed_at=NOW()
          WHERE id=? AND status='pending'`,
        [req.user.sub, requestId]
      );

      await conn.query(
        `INSERT INTO signature_logs
         (signature_request_id, action, actor_user_id,
          document_id, document_hash, note)
         VALUES (?, 'signed', ?, ?, ?, ?)`,
        [
          requestId,
          req.user.sub,
          locked.document_id,
          sourceHash.hash,
          overrideReason
            ? `Precheck override: ${String(overrideReason).slice(0, 450)}`
            : 'Document signed',
        ]
      );

      await conn.commit();

      await activityLog({
        entityId,
        userId: req.user.sub,
        action: 'signature.signed',
        subjectType: 'signature_request',
        subjectId: requestId,
        metadata: {
          documentId: locked.document_id,
          documentHash: sourceHash.hash,
          hashAlgorithm: algorithm,
          hashSource: sourceHash.source,
          verificationCode,
          qrEmbedded: Boolean(qrBuffer),
          precheckStatus: precheckResult?.status || null,
        },
      });

      try {
        await notif.create({
          userId: locked.requested_by,
          entityId,
          title: 'Dokumen telah ditandatangani',
          body: initial.title,
          event: 'signature.signed',
          subjectType: 'signature_request',
          subjectId: requestId,
          actionUrl: `/signatures/${requestId}`,
        });
      } catch { /* no-op */ }

      return ok(res, {
        signatureRequestId: requestId,
        signedDocumentId: signedResult.insertId,
        webViewLink: uploaded.webViewLink,
        documentHash: sourceHash.hash,
        hashAlgorithm: algorithm,
        hashSource: sourceHash.source,
        verificationCode,
        verificationUrl,
        qrEmbedded: Boolean(qrBuffer),
        precheckStatus: precheckResult?.status || null,
      });
    } catch (error) {
      try { await conn.rollback(); } catch { /* noop */ }
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const where = ['s.entity_id=?'];
    const args = [req.entityScope.entityId];

    if (req.query.status) {
      where.push('s.status=?');
      args.push(req.query.status);
    }

    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId,
              s.document_id AS documentId,
              d.title AS documentTitle,
              s.approval_request_id AS approvalRequestId,
              s.signature_rule_id AS signatureRuleId,
              s.assigned_signer_user_id AS assignedSignerUserId,
              au.name AS assignedSignerUserName,
              s.assigned_signer_role_id AS assignedSignerRoleId,
              ar.name AS assignedSignerRoleName,
              s.signature_type AS signatureType,
              s.status, s.requested_by AS requestedBy,
              s.signed_by AS signedBy, su.name AS signedByName,
              s.signed_at AS signedAt, s.created_at AS createdAt
         FROM signature_requests s
         JOIN documents d ON d.id=s.document_id
         LEFT JOIN users au ON au.id=s.assigned_signer_user_id
         LEFT JOIN roles ar ON ar.id=s.assigned_signer_role_id
         LEFT JOIN users su ON su.id=s.signed_by
        WHERE ${where.join(' AND ')}
        ORDER BY s.id DESC LIMIT 200`,
      args
    );
    return ok(res, rows);
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, d.title AS documentTitle,
              au.name AS assignedSignerUserName,
              ar.name AS assignedSignerRoleName,
              su.name AS signedByName
         FROM signature_requests s
         JOIN documents d ON d.id=s.document_id
         LEFT JOIN users au ON au.id=s.assigned_signer_user_id
         LEFT JOIN roles ar ON ar.id=s.assigned_signer_role_id
         LEFT JOIN users su ON su.id=s.signed_by
        WHERE s.id=? AND s.entity_id=?
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Signature request tidak ditemukan', 404);

    const [prechecks] = await pool.query(
      `SELECT id, status, summary, findings_json AS findingsJson,
              provider, model, created_at AS createdAt
         FROM signature_precheck_logs
        WHERE signature_request_id=?
        ORDER BY id DESC LIMIT 10`,
      [req.params.id]
    );

    const [verification] = await pool.query(
      `SELECT v.id, v.verification_code AS verificationCode,
              v.verification_url AS verificationUrl,
              v.document_hash AS documentHash,
              v.hash_algorithm AS hashAlgorithm,
              v.valid_until AS validUntil,
              v.qr_generated_at AS qrGeneratedAt,
              v.created_at AS createdAt
         FROM document_verifications v
         JOIN signed_documents sd ON sd.id=v.signed_document_id
        WHERE sd.signature_request_id=?
        ORDER BY v.id DESC LIMIT 1`,
      [req.params.id]
    );

    const parse = (value) => {
      if (!value) return [];
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return []; }
    };

    return ok(res, {
      ...rows[0],
      prechecks: prechecks.map((item) => ({
        ...item,
        findings: parse(item.findingsJson),
        findingsJson: undefined,
      })),
      verification: verification[0] || null,
    });
  } catch (error) { next(error); }
}

module.exports = {
  saveSignatureAsset,
  create,
  runPrecheck,
  sign,
  list,
  detail,
};
