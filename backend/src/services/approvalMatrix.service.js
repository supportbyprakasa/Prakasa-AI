const pool = require('../db/pool');

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function specificity(rule, context) {
  let score = 0;

  if (rule.departmentId && Number(rule.departmentId) === Number(context.departmentId)) score += 8;
  if (rule.documentTypeId && Number(rule.documentTypeId) === Number(context.documentTypeId)) score += 8;
  if (rule.requestType && rule.requestType === context.requestType) score += 8;

  if (rule.amountMin !== null || rule.amountMax !== null) score += 4;
  if (rule.currency && rule.currency === context.currency) score += 1;

  return score;
}

async function resolveChain({
  entityId,
  departmentId = null,
  documentTypeId = null,
  requestType = null,
  amount = null,
  currency = 'IDR',
}, conn = pool) {
  if (!entityId) throw new Error('entityId wajib');

  const normalizedAmount = numberOrNull(amount);
  const conditions = [
    'am.entity_id = ?',
    'am.is_active = 1',
    'am.deleted_at IS NULL',
  ];
  const args = [entityId];

  if (departmentId) {
    conditions.push('(am.department_id IS NULL OR am.department_id = ?)');
    args.push(departmentId);
  } else {
    conditions.push('am.department_id IS NULL');
  }

  if (documentTypeId) {
    conditions.push('(am.document_type_id IS NULL OR am.document_type_id = ?)');
    args.push(documentTypeId);
  } else {
    conditions.push('am.document_type_id IS NULL');
  }

  if (requestType) {
    conditions.push('(am.request_type IS NULL OR am.request_type = ?)');
    args.push(requestType);
  } else {
    conditions.push('am.request_type IS NULL');
  }

  conditions.push('(am.currency IS NULL OR am.currency = ?)');
  args.push(currency);

  if (normalizedAmount !== null) {
    conditions.push('(am.amount_min IS NULL OR am.amount_min <= ?)');
    args.push(normalizedAmount);
    conditions.push('(am.amount_max IS NULL OR am.amount_max >= ?)');
    args.push(normalizedAmount);
  } else {
    conditions.push('am.amount_min IS NULL');
    conditions.push('am.amount_max IS NULL');
  }

  const [rows] = await conn.query(
    `SELECT am.id,
            am.matrix_key AS matrixKey,
            am.matrix_name AS matrixName,
            am.entity_id AS entityId,
            am.department_id AS departmentId,
            am.document_type AS legacyDocumentType,
            am.document_type_id AS documentTypeId,
            am.request_type AS requestType,
            am.level,
            am.order_index AS orderIndex,
            am.approver_role_id AS approverRoleId,
            am.approver_user_id AS approverUserId,
            am.amount_min AS amountMin,
            am.amount_max AS amountMax,
            am.currency,
            am.flow_type AS flowType,
            am.parallel_group AS parallelGroup,
            am.is_optional AS isOptional,
            am.is_required AS isRequired,
            am.priority,
            am.signer_user_id AS signerUserId,
            am.signer_role_id AS signerRoleId,
            am.escalation_user_id AS escalationUserId,
            am.escalation_role_id AS escalationRoleId,
            am.reminder_after_hours AS reminderAfterHours,
            am.escalate_after_hours AS escalateAfterHours
       FROM approval_matrix am
      WHERE ${conditions.join(' AND ')}
      ORDER BY am.priority ASC, am.order_index ASC, am.level ASC, am.id ASC`,
    args
  );

  if (!rows.length) return [];

  const context = {
    departmentId,
    documentTypeId,
    requestType,
    amount: normalizedAmount,
    currency,
  };

  const groups = new Map();
  for (const row of rows) {
    const key = row.matrixKey || `legacy:${row.entityId}:${row.legacyDocumentType || 'generic'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rows: [],
        specificity: -1,
        priority: Number.MAX_SAFE_INTEGER,
      });
    }

    const group = groups.get(key);
    group.rows.push(row);
    group.specificity = Math.max(group.specificity, specificity(row, context));
    group.priority = Math.min(group.priority, Number(row.priority ?? 100));
  }

  const selected = [...groups.values()].sort((a, b) => {
    if (a.specificity !== b.specificity) return b.specificity - a.specificity;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.key.localeCompare(b.key);
  })[0];

  return selected.rows.sort((a, b) => {
    const orderA = Number(a.orderIndex ?? a.level ?? 1);
    const orderB = Number(b.orderIndex ?? b.level ?? 1);
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.id) - Number(b.id);
  });
}

async function resolveApprover({
  entityId,
  step,
  requestType = null,
  documentTypeId = null,
}, conn = pool) {
  let targetUserId = step.approverUserId || null;
  const targetRoleId = step.approverRoleId || null;
  let delegatedFromUserId = null;

  if (!targetUserId) {
    return {
      userId: null,
      roleId: targetRoleId,
      delegatedFromUserId: null,
    };
  }

  const conditions = [
    'entity_id = ?',
    'from_user_id = ?',
    'is_active = 1',
    'deleted_at IS NULL',
    'starts_at <= NOW()',
    'ends_at >= NOW()',
  ];
  const args = [entityId, targetUserId];

  if (requestType) {
    conditions.push('(applies_to_request_type IS NULL OR applies_to_request_type = ?)');
    args.push(requestType);
  } else {
    conditions.push('applies_to_request_type IS NULL');
  }

  if (documentTypeId) {
    conditions.push('(applies_to_document_type_id IS NULL OR applies_to_document_type_id = ?)');
    args.push(documentTypeId);
  } else {
    conditions.push('applies_to_document_type_id IS NULL');
  }

  const [delegations] = await conn.query(
    `SELECT from_user_id AS fromUserId,
            to_user_id AS toUserId,
            applies_to_request_type AS appliesToRequestType,
            applies_to_document_type_id AS appliesToDocumentTypeId
       FROM approval_delegations
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        (applies_to_document_type_id IS NOT NULL) DESC,
        (applies_to_request_type IS NOT NULL) DESC,
        starts_at DESC,
        id DESC
      LIMIT 1`,
    args
  );

  if (delegations[0]) {
    delegatedFromUserId = delegations[0].fromUserId;
    targetUserId = delegations[0].toUserId;
  }

  return {
    userId: targetUserId,
    roleId: targetRoleId,
    delegatedFromUserId,
  };
}

async function resolveRoleUsers({ entityId, roleId }, conn = pool) {
  if (!entityId || !roleId) return [];

  const [rows] = await conn.query(
    `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.role_id = ?
        AND u.entity_id = ?
        AND r.entity_id = ?
        AND u.status = 'active'
        AND u.deleted_at IS NULL
        AND r.deleted_at IS NULL
      ORDER BY u.name ASC, u.id ASC`,
    [roleId, entityId, entityId]
  );

  return rows;
}

module.exports = {
  resolveChain,
  resolveApprover,
  resolveRoleUsers,
};
