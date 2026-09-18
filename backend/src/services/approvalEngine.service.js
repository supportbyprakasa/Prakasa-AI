const pool = require('../db/pool');
const matrixSvc = require('./approvalMatrix.service');

const FLOW = {
  SEQUENTIAL: 'sequential',
  PARALLEL: 'parallel',
  LEGACY: 'legacy',
};

function appError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function addHours(date, hours) {
  if (hours === null || hours === undefined) return null;
  return new Date(new Date(date).getTime() + Number(hours) * 3600000);
}

function nextDeadline(rule, activatedAt) {
  if (!activatedAt) return null;
  const candidates = [
    rule.reminderAfterHours,
    rule.escalateAfterHours,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter(Number.isFinite);

  if (!candidates.length) return null;
  return addHours(activatedAt, Math.min(...candidates));
}

async function createApprovalRequest(context, conn) {
  const {
    entityId,
    departmentId = null,
    documentId = null,
    subjectType = 'document',
    subjectId = null,
    title,
    description = null,
    requestType = null,
    documentTypeId = null,
    legacyDocumentType = null,
    amount = null,
    currency = 'IDR',
    approvalType = 'level_1',
    requestedBy,
  } = context;

  const chain = await matrixSvc.resolveChain({
    entityId,
    departmentId,
    documentTypeId,
    requestType,
    legacyDocumentType,
    amount,
    currency,
  }, conn);

  const useMatrix = chain.length > 0;
  const flowTypes = new Set(chain.map((rule) => rule.flowType || FLOW.SEQUENTIAL));
  if (flowTypes.size > 1) {
    throw appError('Matrix memiliki flowType campuran', 409, 'MATRIX_INVALID');
  }

  const flowType = useMatrix
    ? (chain[0].flowType === FLOW.PARALLEL ? FLOW.PARALLEL : FLOW.SEQUENTIAL)
    : FLOW.LEGACY;
  const matrixKey = useMatrix ? chain[0].matrixKey : null;
  const matrixRuleIds = useMatrix ? chain.map((rule) => rule.id) : [];
  const initialOrder = useMatrix
    ? Math.min(...chain.map((rule) => Number(rule.orderIndex ?? rule.level ?? 1)))
    : 1;

  const [result] = await conn.query(
    `INSERT INTO approval_requests
     (entity_id, department_id, document_id, subject_type, subject_id,
      request_type, document_type_id, amount, currency,
      title, description, approval_type, current_level, status,
      requested_by, flow_type, matrix_key, matrix_rule_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [
      entityId,
      departmentId,
      documentId,
      subjectType,
      subjectId,
      requestType,
      documentTypeId,
      amount,
      currency,
      title,
      description,
      approvalType,
      initialOrder,
      requestedBy,
      flowType,
      matrixKey,
      matrixRuleIds.length ? JSON.stringify(matrixRuleIds) : null,
    ]
  );

  if (useMatrix) {
    await createStepsFromMatrix({
      approvalRequestId: result.insertId,
      entityId,
      requestType,
      documentTypeId,
      chain,
      flowType,
      conn,
    });
  } else {
    await conn.query(
      `INSERT INTO approval_steps
       (approval_request_id, level, order_index, status, activated_at)
       VALUES (?, 1, 1, 'pending', NOW())`,
      [result.insertId]
    );
  }

  return {
    id: result.insertId,
    flowType,
    matrixKey,
    matrixRuleIds,
    stepCount: useMatrix ? chain.length : 1,
  };
}

async function createStepsFromMatrix({
  approvalRequestId,
  entityId,
  requestType,
  documentTypeId,
  chain,
  flowType,
  conn,
}) {
  const sorted = [...chain].sort((a, b) => {
    const orderA = Number(a.orderIndex ?? a.level ?? 1);
    const orderB = Number(b.orderIndex ?? b.level ?? 1);
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.id) - Number(b.id);
  });

  const firstOrder = Number(sorted[0].orderIndex ?? sorted[0].level ?? 1);
  const now = new Date();

  for (const rule of sorted) {
    const orderIndex = Number(rule.orderIndex ?? rule.level ?? 1);
    const resolved = await matrixSvc.resolveApprover({
      entityId,
      step: rule,
      requestType,
      documentTypeId,
    }, conn);

    const activatedAt = orderIndex === firstOrder ? now : null;

    await conn.query(
      `INSERT INTO approval_steps
       (approval_request_id, matrix_rule_id, level, order_index,
        approver_user_id, approver_role_id,
        parallel_group, is_optional, delegated_from_user_id,
        status, activated_at, deadline_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        approvalRequestId,
        rule.id,
        rule.level || orderIndex,
        orderIndex,
        resolved.userId,
        resolved.roleId,
        flowType === FLOW.PARALLEL ? rule.parallelGroup : null,
        rule.isOptional ? 1 : 0,
        resolved.delegatedFromUserId,
        activatedAt,
        nextDeadline(rule, activatedAt),
      ]
    );
  }
}

async function getActiveSteps(approvalRequestId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.*,
            am.request_type AS matrix_request_type,
            am.document_type_id AS matrix_document_type_id
       FROM approval_steps s
       LEFT JOIN approval_matrix am ON am.id=s.matrix_rule_id
      WHERE s.approval_request_id=?
        AND s.status='pending'
        AND s.activated_at IS NOT NULL
      ORDER BY s.order_index ASC, s.id ASC`,
    [approvalRequestId]
  );
  return rows;
}

async function delegationStillValid({
  step,
  userId,
  requestType,
  documentTypeId,
  entityId,
  conn,
}) {
  if (!step.delegated_from_user_id) return false;
  if (Number(step.approver_user_id) !== Number(userId)) return false;

  const conditions = [
    'entity_id=?',
    'from_user_id=?',
    'to_user_id=?',
    'is_active=1',
    'deleted_at IS NULL',
    'starts_at<=NOW()',
    'ends_at>=NOW()',
  ];
  const args = [
    entityId,
    step.delegated_from_user_id,
    userId,
  ];

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
  return Boolean(rows[0]);
}

async function canDecide({
  step,
  userId,
  userRoleIds = [],
  userPermissions = [],
  entityId,
  requestType = null,
  documentTypeId = null,
  conn = pool,
}) {
  if (step.escalated_to_user_id &&
      Number(step.escalated_to_user_id) === Number(userId)) {
    return true;
  }
  if (step.escalated_to_role_id &&
      userRoleIds.map(Number).includes(Number(step.escalated_to_role_id))) {
    return true;
  }

  if (step.delegated_from_user_id) {
    return delegationStillValid({
      step,
      userId,
      requestType,
      documentTypeId,
      entityId,
      conn,
    });
  }

  if (step.approver_user_id &&
      Number(step.approver_user_id) === Number(userId)) {
    return true;
  }

  if (step.approver_role_id &&
      userRoleIds.map(Number).includes(Number(step.approver_role_id))) {
    return true;
  }

  // Legacy Phase-3 requests can contain an unassigned fallback step.
  // The route already requires approval.decide; preserve that legacy behavior
  // only for this unassigned fallback. Matrix-backed steps must stay assigned.
  if (!step.matrix_rule_id && !step.approver_user_id && !step.approver_role_id) {
    return userPermissions.includes('approval.decide');
  }

  return false;
}

async function decideStep({
  approvalRequest,
  stepId,
  action,
  note,
  userId,
  userRoleIds,
  userPermissions,
  conn,
}) {
  if (!['approve', 'reject', 'skip'].includes(action)) {
    throw appError('Action approval tidak valid', 400, 'VALIDATION_ERROR');
  }

  const [rows] = await conn.query(
    `SELECT * FROM approval_steps
      WHERE id=? AND approval_request_id=?
      LIMIT 1 FOR UPDATE`,
    [stepId, approvalRequest.id]
  );
  const step = rows[0];
  if (!step) throw appError('Approval step tidak ditemukan', 404, 'NOT_FOUND');
  if (step.status !== 'pending') {
    throw appError('Approval step sudah diputuskan', 409, 'CONFLICT');
  }
  if (!step.activated_at) {
    throw appError('Approval step belum aktif', 409, 'CONFLICT');
  }

  if (action === 'skip' && !step.is_optional) {
    throw appError('Hanya step opsional yang dapat di-skip', 400, 'VALIDATION_ERROR');
  }
  if ((action === 'reject' || action === 'skip') && !String(note || '').trim()) {
    throw appError('Catatan wajib untuk reject/skip', 400, 'VALIDATION_ERROR');
  }

  const allowed = await canDecide({
    step,
    userId,
    userRoleIds,
    userPermissions,
    entityId: approvalRequest.entity_id,
    requestType: approvalRequest.request_type,
    documentTypeId: approvalRequest.document_type_id,
    conn,
  });
  if (!allowed) {
    throw appError('Anda bukan approver/delegate/escalation target step ini', 403, 'FORBIDDEN');
  }

  const nextStatus = action === 'approve'
    ? 'approved'
    : action === 'reject'
      ? 'rejected'
      : 'skipped';

  await conn.query(
    `UPDATE approval_steps
        SET status=?, decided_by=?, decided_at=NOW(), note=?
      WHERE id=? AND status='pending'`,
    [nextStatus, userId, note || null, step.id]
  );

  return { ...step, status: nextStatus };
}

async function activateOrder({
  approvalRequestId,
  orderIndex,
  conn,
}) {
  const [steps] = await conn.query(
    `SELECT s.id, s.matrix_rule_id,
            am.reminder_after_hours AS reminderAfterHours,
            am.escalate_after_hours AS escalateAfterHours
       FROM approval_steps s
       LEFT JOIN approval_matrix am ON am.id=s.matrix_rule_id
      WHERE s.approval_request_id=?
        AND s.status='pending'
        AND s.order_index=?
        AND s.activated_at IS NULL
      ORDER BY s.id ASC
      FOR UPDATE`,
    [approvalRequestId, orderIndex]
  );

  const ids = [];
  const activatedAt = new Date();
  for (const step of steps) {
    const deadline = nextDeadline(step, activatedAt);
    await conn.query(
      `UPDATE approval_steps
          SET activated_at=?, deadline_at=?
        WHERE id=? AND activated_at IS NULL`,
      [activatedAt, deadline, step.id]
    );
    ids.push(step.id);
  }

  if (ids.length) {
    await conn.query(
      'UPDATE approval_requests SET current_level=? WHERE id=?',
      [orderIndex, approvalRequestId]
    );
  }

  return ids;
}

async function advanceAfterDecision({
  approvalRequestId,
  actorUserId,
  note = null,
  conn,
}) {
  const [requestRows] = await conn.query(
    'SELECT * FROM approval_requests WHERE id=? LIMIT 1 FOR UPDATE',
    [approvalRequestId]
  );
  const request = requestRows[0];
  if (!request) throw appError('Approval request tidak ditemukan', 404, 'NOT_FOUND');

  const [steps] = await conn.query(
    `SELECT * FROM approval_steps
      WHERE approval_request_id=?
      ORDER BY order_index ASC, id ASC
      FOR UPDATE`,
    [approvalRequestId]
  );

  const requiredRejected = steps.find(
    (step) => !step.is_optional && step.status === 'rejected'
  );
  if (requiredRejected) {
    await conn.query(
      `UPDATE approval_requests
          SET status='rejected', decided_by=?, decided_at=NOW(),
              decision_note=?
        WHERE id=?`,
      [actorUserId, note || requiredRejected.note || null, approvalRequestId]
    );
    return {
      advanced: false,
      status: 'rejected',
      nextStepIds: [],
    };
  }

  const activePending = steps.filter(
    (step) => step.status === 'pending' && step.activated_at
  );
  if (activePending.length) {
    return {
      advanced: false,
      status: 'pending',
      nextStepIds: [],
    };
  }

  const pending = steps
    .filter((step) => step.status === 'pending')
    .sort((a, b) => Number(a.order_index) - Number(b.order_index));

  if (!pending.length) {
    await conn.query(
      `UPDATE approval_requests
          SET status='approved', decided_by=?, decided_at=NOW(),
              decision_note=?
        WHERE id=?`,
      [actorUserId, note || null, approvalRequestId]
    );
    return {
      advanced: false,
      status: 'approved',
      nextStepIds: [],
    };
  }

  const nextOrder = Number(pending[0].order_index);
  const nextStepIds = await activateOrder({
    approvalRequestId,
    orderIndex: nextOrder,
    conn,
  });

  return {
    advanced: nextStepIds.length > 0,
    status: 'pending',
    nextStepIds,
  };
}

async function requestRevision({
  approvalRequest,
  stepId,
  note,
  userId,
  userRoleIds,
  userPermissions,
  conn,
}) {
  if (!String(note || '').trim()) {
    throw appError('Catatan revisi wajib', 400, 'VALIDATION_ERROR');
  }

  const [rows] = await conn.query(
    `SELECT * FROM approval_steps
      WHERE id=? AND approval_request_id=?
      LIMIT 1 FOR UPDATE`,
    [stepId, approvalRequest.id]
  );
  const step = rows[0];
  if (!step || step.status !== 'pending' || !step.activated_at) {
    throw appError('Step aktif tidak ditemukan', 409, 'CONFLICT');
  }

  const allowed = await canDecide({
    step,
    userId,
    userRoleIds,
    userPermissions,
    entityId: approvalRequest.entity_id,
    requestType: approvalRequest.request_type,
    documentTypeId: approvalRequest.document_type_id,
    conn,
  });
  if (!allowed) {
    throw appError('Anda tidak berhak meminta revisi pada step ini', 403, 'FORBIDDEN');
  }

  await conn.query(
    `UPDATE approval_steps
        SET decided_by=?, decided_at=NOW(), note=?
      WHERE id=?`,
    [userId, note, step.id]
  );
  await conn.query(
    `UPDATE approval_requests
        SET status='revision_requested', decided_by=?, decided_at=NOW(),
            decision_note=?
      WHERE id=?`,
    [userId, note, approvalRequest.id]
  );

  return {
    status: 'revision_requested',
    stepId: step.id,
  };
}

module.exports = {
  FLOW,
  createApprovalRequest,
  createStepsFromMatrix,
  getActiveSteps,
  canDecide,
  decideStep,
  activateOrder,
  advanceAfterDecision,
  requestRevision,
};
