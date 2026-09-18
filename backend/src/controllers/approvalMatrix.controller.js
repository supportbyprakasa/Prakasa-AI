const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const approvalAudit = require('../services/approvalAudit.service');

function bool(value) {
  return Boolean(Number(value));
}

function normalizeRow(row) {
  return {
    id: row.id,
    matrixKey: row.matrix_key,
    matrixName: row.matrix_name,
    entityId: row.entity_id,
    departmentId: row.department_id,
    documentType: row.document_type,
    documentTypeId: row.document_type_id,
    requestType: row.request_type,
    level: row.level,
    orderIndex: row.order_index,
    approverRoleId: row.approver_role_id,
    approverUserId: row.approver_user_id,
    signerUserId: row.signer_user_id,
    signerRoleId: row.signer_role_id,
    isRequired: bool(row.is_required),
    amountMin: row.amount_min,
    amountMax: row.amount_max,
    currency: row.currency,
    flowType: row.flow_type,
    parallelGroup: row.parallel_group,
    isOptional: bool(row.is_optional),
    priority: row.priority,
    escalationUserId: row.escalation_user_id,
    escalationRoleId: row.escalation_role_id,
    reminderAfterHours: row.reminder_after_hours,
    escalateAfterHours: row.escalate_after_hours,
    isActive: bool(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function assertReference(conn, {
  entityId,
  table,
  id,
  label,
  extra = '1=1',
}) {
  if (id === undefined || id === null) return;
  const [rows] = await conn.query(
    `SELECT id FROM ${table}
      WHERE id=? AND entity_id=? AND ${extra}
      LIMIT 1`,
    [id, entityId]
  );
  if (!rows[0]) {
    const error = new Error(`${label} tidak valid untuk entity ini`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function resolveLegacyDocumentType(conn, {
  entityId,
  documentType,
  documentTypeId,
  requestType,
}) {
  if (documentType) return documentType;

  if (documentTypeId) {
    const [rows] = await conn.query(
      `SELECT code FROM document_types
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [documentTypeId, entityId]
    );
    if (!rows[0]) {
      const error = new Error('Document type tidak valid untuk entity ini');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    return rows[0].code;
  }

  return requestType || 'generic';
}

async function validateRuleReferences(conn, entityId, rule) {
  await assertReference(conn, {
    entityId,
    table: 'roles',
    id: rule.approverRoleId,
    label: 'Approver role',
    extra: 'deleted_at IS NULL',
  });
  await assertReference(conn, {
    entityId,
    table: 'users',
    id: rule.approverUserId,
    label: 'Approver user',
    extra: "deleted_at IS NULL AND status='active'",
  });
  await assertReference(conn, {
    entityId,
    table: 'roles',
    id: rule.signerRoleId,
    label: 'Signer role',
    extra: 'deleted_at IS NULL',
  });
  await assertReference(conn, {
    entityId,
    table: 'users',
    id: rule.signerUserId,
    label: 'Signer user',
    extra: "deleted_at IS NULL AND status='active'",
  });
  await assertReference(conn, {
    entityId,
    table: 'roles',
    id: rule.escalationRoleId,
    label: 'Escalation role',
    extra: 'deleted_at IS NULL',
  });
  await assertReference(conn, {
    entityId,
    table: 'users',
    id: rule.escalationUserId,
    label: 'Escalation user',
    extra: "deleted_at IS NULL AND status='active'",
  });
}

function validateMatrixShape({
  amountMin,
  amountMax,
  flowType,
  rules,
}) {
  if (amountMin !== null && amountMin !== undefined &&
      amountMax !== null && amountMax !== undefined &&
      Number(amountMin) > Number(amountMax)) {
    const error = new Error('amountMin tidak boleh lebih besar dari amountMax');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (!Array.isArray(rules) || !rules.length) {
    const error = new Error('Minimal 1 rule approval');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  for (const rule of rules) {
    if (!rule.approverUserId && !rule.approverRoleId) {
      const error = new Error('Setiap approval rule wajib punya approver user atau role');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (rule.approverUserId && rule.approverRoleId) {
      const error = new Error('Pilih salah satu approver user atau approver role');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (rule.signerUserId && rule.signerRoleId) {
      const error = new Error('Pilih salah satu signer user atau signer role');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (
      rule.reminderAfterHours !== null &&
      rule.reminderAfterHours !== undefined &&
      rule.escalateAfterHours !== null &&
      rule.escalateAfterHours !== undefined &&
      Number(rule.escalateAfterHours) < Number(rule.reminderAfterHours)
    ) {
      const error = new Error('escalateAfterHours harus >= reminderAfterHours');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (flowType === 'parallel' && !rule.parallelGroup) {
      const error = new Error('parallelGroup wajib untuk matrix parallel');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  if (flowType === 'parallel') {
    const groupOrder = new Map();
    for (const rule of rules) {
      const order = Number(rule.orderIndex ?? rule.level ?? 1);
      if (!groupOrder.has(rule.parallelGroup)) {
        groupOrder.set(rule.parallelGroup, order);
      } else if (groupOrder.get(rule.parallelGroup) !== order) {
        const error = new Error(
          `Semua rule dalam parallelGroup '${rule.parallelGroup}' harus punya orderIndex sama`
        );
        error.status = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
    }
  }
}

async function list(req, res, next) {
  try {
    const where = ['am.entity_id=?', 'am.deleted_at IS NULL'];
    const args = [req.entityScope.entityId];

    if (req.query.matrixKey) {
      where.push('am.matrix_key=?');
      args.push(req.query.matrixKey);
    }
    if (req.query.documentTypeId) {
      where.push('am.document_type_id=?');
      args.push(req.query.documentTypeId);
    }
    if (req.query.requestType) {
      where.push('am.request_type=?');
      args.push(req.query.requestType);
    }
    if (req.query.departmentId) {
      where.push('am.department_id=?');
      args.push(req.query.departmentId);
    }
    if (req.query.activeOnly === '1') where.push('am.is_active=1');

    const [rows] = await pool.query(
      `SELECT am.*,
              ar.name AS approverRoleName,
              au.name AS approverUserName,
              sr.name AS signerRoleName,
              su.name AS signerUserName,
              er.name AS escalationRoleName,
              eu.name AS escalationUserName,
              dt.name AS documentTypeName
         FROM approval_matrix am
         LEFT JOIN roles ar ON ar.id=am.approver_role_id
         LEFT JOIN users au ON au.id=am.approver_user_id
         LEFT JOIN roles sr ON sr.id=am.signer_role_id
         LEFT JOIN users su ON su.id=am.signer_user_id
         LEFT JOIN roles er ON er.id=am.escalation_role_id
         LEFT JOIN users eu ON eu.id=am.escalation_user_id
         LEFT JOIN document_types dt ON dt.id=am.document_type_id
        WHERE ${where.join(' AND ')}
        ORDER BY am.matrix_key ASC, am.order_index ASC, am.id ASC`,
      args
    );

    return ok(res, rows.map((row) => ({
      ...normalizeRow(row),
      approverRoleName: row.approverRoleName || null,
      approverUserName: row.approverUserName || null,
      signerRoleName: row.signerRoleName || null,
      signerUserName: row.signerUserName || null,
      escalationRoleName: row.escalationRoleName || null,
      escalationUserName: row.escalationUserName || null,
      documentTypeName: row.documentTypeName || null,
    })));
  } catch (error) { next(error); }
}

async function matrixKeys(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT matrix_key AS matrixKey,
              MAX(matrix_name) AS matrixName,
              MAX(flow_type) AS flowType,
              MAX(is_active) AS isActive,
              COUNT(*) AS ruleCount
         FROM approval_matrix
        WHERE entity_id=? AND deleted_at IS NULL
        GROUP BY matrix_key
        ORDER BY matrix_key ASC`,
      [req.entityScope.entityId]
    );
    return ok(res, rows.map((row) => ({
      ...row,
      isActive: bool(row.isActive),
      ruleCount: Number(row.ruleCount),
    })));
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM approval_matrix
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Approval rule tidak ditemukan', 404);
    return ok(res, normalizeRow(rows[0]));
  } catch (error) { next(error); }
}

async function createMatrix(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const {
      matrixKey,
      matrixName,
      departmentId = null,
      documentType = null,
      documentTypeId = null,
      requestType = null,
      amountMin = null,
      amountMax = null,
      currency = 'IDR',
      flowType = 'sequential',
      priority = 100,
      isActive = true,
      rules,
    } = req.body;

    validateMatrixShape({ amountMin, amountMax, flowType, rules });

    await assertReference(conn, {
      entityId,
      table: 'departments',
      id: departmentId,
      label: 'Department',
      extra: 'deleted_at IS NULL',
    });
    await assertReference(conn, {
      entityId,
      table: 'document_types',
      id: documentTypeId,
      label: 'Document type',
      extra: 'deleted_at IS NULL',
    });

    for (const rule of rules) {
      await validateRuleReferences(conn, entityId, rule);
    }

    const legacyDocumentType = await resolveLegacyDocumentType(conn, {
      entityId,
      documentType,
      documentTypeId,
      requestType,
    });

    await conn.beginTransaction();

    const [existing] = await conn.query(
      `SELECT id FROM approval_matrix
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [entityId, matrixKey]
    );
    if (existing[0]) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'matrixKey sudah dipakai di entity ini', 409);
    }

    const insertedIds = [];
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      const orderIndex = Number(rule.orderIndex ?? rule.level ?? index + 1);
      const level = Number(rule.level ?? orderIndex);
      const isOptional = Boolean(rule.isOptional);

      const [result] = await conn.query(
        `INSERT INTO approval_matrix
         (matrix_key, matrix_name, entity_id, department_id,
          document_type, document_type_id, request_type,
          level, order_index, approver_role_id, approver_user_id,
          is_required, amount_min, amount_max, currency,
          flow_type, parallel_group, is_optional, priority,
          signer_user_id, signer_role_id,
          escalation_user_id, escalation_role_id,
          reminder_after_hours, escalate_after_hours,
          is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matrixKey,
          matrixName,
          entityId,
          departmentId,
          legacyDocumentType,
          documentTypeId,
          requestType,
          level,
          orderIndex,
          rule.approverRoleId ?? null,
          rule.approverUserId ?? null,
          isOptional ? 0 : 1,
          amountMin,
          amountMax,
          currency,
          flowType,
          flowType === 'parallel' ? rule.parallelGroup : null,
          isOptional ? 1 : 0,
          priority,
          rule.signerUserId ?? null,
          rule.signerRoleId ?? null,
          rule.escalationUserId ?? null,
          rule.escalationRoleId ?? null,
          rule.reminderAfterHours ?? null,
          rule.escalateAfterHours ?? null,
          isActive ? 1 : 0,
          req.user.sub,
        ]
      );
      insertedIds.push(result.insertId);
    }

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'matrix',
      entityIdRef: insertedIds[0] || null,
      action: 'create',
      after: {
        matrixKey,
        matrixName,
        flowType,
        ruleIds: insertedIds,
      },
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_matrix.create',
      subjectType: 'approval_matrix',
      subjectId: insertedIds[0] || null,
      metadata: {
        matrixKey,
        matrixName,
        flowType,
        ruleCount: insertedIds.length,
      },
    });

    return ok(res, {
      matrixKey,
      ruleIds: insertedIds,
    }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Approval matrix duplikat', 409);
    }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function updateRule(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM approval_matrix
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, entityId]
    );
    const existing = rows[0];
    if (!existing) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Approval rule tidak ditemukan', 404);
    }

    const merged = {
      approverRoleId: Object.prototype.hasOwnProperty.call(req.body, 'approverRoleId')
        ? req.body.approverRoleId : existing.approver_role_id,
      approverUserId: Object.prototype.hasOwnProperty.call(req.body, 'approverUserId')
        ? req.body.approverUserId : existing.approver_user_id,
      signerRoleId: Object.prototype.hasOwnProperty.call(req.body, 'signerRoleId')
        ? req.body.signerRoleId : existing.signer_role_id,
      signerUserId: Object.prototype.hasOwnProperty.call(req.body, 'signerUserId')
        ? req.body.signerUserId : existing.signer_user_id,
      escalationRoleId: Object.prototype.hasOwnProperty.call(req.body, 'escalationRoleId')
        ? req.body.escalationRoleId : existing.escalation_role_id,
      escalationUserId: Object.prototype.hasOwnProperty.call(req.body, 'escalationUserId')
        ? req.body.escalationUserId : existing.escalation_user_id,
      reminderAfterHours: Object.prototype.hasOwnProperty.call(req.body, 'reminderAfterHours')
        ? req.body.reminderAfterHours : existing.reminder_after_hours,
      escalateAfterHours: Object.prototype.hasOwnProperty.call(req.body, 'escalateAfterHours')
        ? req.body.escalateAfterHours : existing.escalate_after_hours,
    };

    if (!merged.approverRoleId && !merged.approverUserId) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Approval rule wajib punya approver', 400);
    }
    if (merged.approverRoleId && merged.approverUserId) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Pilih salah satu approver user atau role', 400);
    }
    if (merged.signerRoleId && merged.signerUserId) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Pilih salah satu signer user atau role', 400);
    }
    if (
      merged.reminderAfterHours !== null &&
      merged.reminderAfterHours !== undefined &&
      merged.escalateAfterHours !== null &&
      merged.escalateAfterHours !== undefined &&
      Number(merged.escalateAfterHours) < Number(merged.reminderAfterHours)
    ) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'escalateAfterHours harus >= reminderAfterHours', 400);
    }

    await validateRuleReferences(conn, entityId, merged);

    if (existing.flow_type === 'parallel') {
      const proposedGroup = Object.prototype.hasOwnProperty.call(req.body, 'parallelGroup')
        ? req.body.parallelGroup
        : existing.parallel_group;
      const proposedOrder = Object.prototype.hasOwnProperty.call(req.body, 'orderIndex')
        ? Number(req.body.orderIndex)
        : Number(existing.order_index);

      if (!proposedGroup) {
        await conn.rollback();
        return fail(res, 'VALIDATION_ERROR', 'parallelGroup wajib untuk matrix parallel', 400);
      }

      const [sameGroup] = await conn.query(
        `SELECT id, order_index
           FROM approval_matrix
          WHERE entity_id=?
            AND matrix_key=?
            AND parallel_group=?
            AND id<>?
            AND deleted_at IS NULL`,
        [entityId, existing.matrix_key, proposedGroup, req.params.id]
      );
      if (sameGroup.some((row) => Number(row.order_index) !== proposedOrder)) {
        await conn.rollback();
        return fail(
          res,
          'VALIDATION_ERROR',
          'Semua rule dalam parallelGroup yang sama harus punya orderIndex sama',
          400
        );
      }
    }

    const map = {
      level: 'level',
      orderIndex: 'order_index',
      approverRoleId: 'approver_role_id',
      approverUserId: 'approver_user_id',
      signerUserId: 'signer_user_id',
      signerRoleId: 'signer_role_id',
      parallelGroup: 'parallel_group',
      isOptional: 'is_optional',
      escalationUserId: 'escalation_user_id',
      escalationRoleId: 'escalation_role_id',
      reminderAfterHours: 'reminder_after_hours',
      escalateAfterHours: 'escalate_after_hours',
    };

    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (key === 'isOptional' || key === 'isActive') value = value ? 1 : 0;
      values.push(value ?? null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'isOptional')) {
      fields.push('is_required=?');
      values.push(req.body.isOptional ? 0 : 1);
    }

    if (fields.length) {
      values.push(req.params.id, entityId);
      await conn.query(
        `UPDATE approval_matrix SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    const [afterRows] = await conn.query(
      'SELECT * FROM approval_matrix WHERE id=? LIMIT 1',
      [req.params.id]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'matrix',
      entityIdRef: Number(req.params.id),
      action: 'update',
      before: normalizeRow(existing),
      after: afterRows[0] ? normalizeRow(afterRows[0]) : null,
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_matrix.update',
      subjectType: 'approval_matrix',
      subjectId: Number(req.params.id),
      metadata: req.body,
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function updateMatrix(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const matrixKey = req.params.matrixKey;

    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM approval_matrix
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL
        ORDER BY order_index ASC, id ASC
        FOR UPDATE`,
      [entityId, matrixKey]
    );
    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Approval matrix tidak ditemukan', 404);
    }

    const first = rows[0];
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
    const next = {
      matrixName: has('matrixName') ? req.body.matrixName : first.matrix_name,
      departmentId: has('departmentId') ? req.body.departmentId : first.department_id,
      documentType: has('documentType') ? req.body.documentType : first.document_type,
      documentTypeId: has('documentTypeId') ? req.body.documentTypeId : first.document_type_id,
      requestType: has('requestType') ? req.body.requestType : first.request_type,
      amountMin: has('amountMin') ? req.body.amountMin : first.amount_min,
      amountMax: has('amountMax') ? req.body.amountMax : first.amount_max,
      currency: has('currency') ? req.body.currency : first.currency,
      flowType: has('flowType') ? req.body.flowType : first.flow_type,
      priority: has('priority') ? req.body.priority : first.priority,
      isActive: has('isActive') ? req.body.isActive : Boolean(first.is_active),
    };

    if (
      next.amountMin !== null && next.amountMin !== undefined &&
      next.amountMax !== null && next.amountMax !== undefined &&
      Number(next.amountMin) > Number(next.amountMax)
    ) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'amountMin tidak boleh lebih besar dari amountMax', 400);
    }

    await assertReference(conn, {
      entityId,
      table: 'departments',
      id: next.departmentId,
      label: 'Department',
      extra: 'deleted_at IS NULL',
    });
    await assertReference(conn, {
      entityId,
      table: 'document_types',
      id: next.documentTypeId,
      label: 'Document type',
      extra: 'deleted_at IS NULL',
    });

    const legacyDocumentType = await resolveLegacyDocumentType(conn, {
      entityId,
      documentType: next.documentType,
      documentTypeId: next.documentTypeId,
      requestType: next.requestType,
    });

    if (next.flowType === 'parallel') {
      for (const row of rows) {
        if (!row.parallel_group) {
          await conn.rollback();
          return fail(
            res,
            'VALIDATION_ERROR',
            'Semua rule harus punya parallelGroup sebelum matrix diubah menjadi parallel',
            400
          );
        }
      }

      const groupOrder = new Map();
      for (const row of rows) {
        const order = Number(row.order_index);
        if (!groupOrder.has(row.parallel_group)) {
          groupOrder.set(row.parallel_group, order);
        } else if (groupOrder.get(row.parallel_group) !== order) {
          await conn.rollback();
          return fail(
            res,
            'VALIDATION_ERROR',
            `parallelGroup '${row.parallel_group}' memiliki orderIndex berbeda`,
            400
          );
        }
      }
    }

    await conn.query(
      `UPDATE approval_matrix
          SET matrix_name=?,
              department_id=?,
              document_type=?,
              document_type_id=?,
              request_type=?,
              amount_min=?,
              amount_max=?,
              currency=?,
              flow_type=?,
              priority=?,
              is_active=?,
              parallel_group=CASE WHEN ?='sequential' THEN NULL ELSE parallel_group END
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL`,
      [
        next.matrixName,
        next.departmentId ?? null,
        legacyDocumentType,
        next.documentTypeId ?? null,
        next.requestType ?? null,
        next.amountMin ?? null,
        next.amountMax ?? null,
        next.currency || 'IDR',
        next.flowType,
        next.priority ?? 100,
        next.isActive ? 1 : 0,
        next.flowType,
        entityId,
        matrixKey,
      ]
    );

    const [afterRows] = await conn.query(
      `SELECT * FROM approval_matrix
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL
        ORDER BY order_index ASC, id ASC`,
      [entityId, matrixKey]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'matrix',
      entityIdRef: rows[0].id,
      action: 'update_group',
      before: rows.map(normalizeRow),
      after: afterRows.map(normalizeRow),
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_matrix.update_group',
      subjectType: 'approval_matrix',
      subjectId: rows[0].id,
      metadata: { matrixKey, ...req.body },
    });

    return ok(res, {
      matrixKey,
      affected: afterRows.length,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function removeRule(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM approval_matrix
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, entityId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Approval rule tidak ditemukan', 404);
    }

    await conn.query(
      `UPDATE approval_matrix
          SET is_active=0, deleted_at=NOW()
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, entityId]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'matrix',
      entityIdRef: Number(req.params.id),
      action: 'delete',
      before: normalizeRow(rows[0]),
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_matrix.delete',
      subjectType: 'approval_matrix',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally {
    conn.release();
  }
}

async function removeMatrix(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM approval_matrix
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL
        FOR UPDATE`,
      [entityId, req.params.matrixKey]
    );
    if (!rows.length) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Approval matrix tidak ditemukan', 404);
    }

    await conn.query(
      `UPDATE approval_matrix
          SET is_active=0, deleted_at=NOW()
        WHERE entity_id=? AND matrix_key=? AND deleted_at IS NULL`,
      [entityId, req.params.matrixKey]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'matrix',
      entityIdRef: rows[0].id,
      action: 'delete_group',
      before: rows.map(normalizeRow),
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_matrix.delete_group',
      subjectType: 'approval_matrix',
      subjectId: rows[0].id,
      metadata: {
        matrixKey: req.params.matrixKey,
        affected: rows.length,
      },
    });

    return ok(res, {
      matrixKey: req.params.matrixKey,
      affected: rows.length,
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally {
    conn.release();
  }
}

module.exports = {
  list,
  matrixKeys,
  detail,
  createMatrix,
  updateMatrix,
  updateRule,
  removeRule,
  removeMatrix,
};
