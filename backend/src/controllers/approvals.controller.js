const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const approvalAudit = require('../services/approvalAudit.service');
const notif = require('../services/notification.service');
const engine = require('../services/approvalEngine.service');

async function userRoleIds(userId, entityId, conn = pool) {
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

async function targetUsersForSteps(stepIds, entityId) {
  if (!stepIds?.length) return [];

  const [steps] = await pool.query(
    `SELECT approver_user_id AS approverUserId,
            approver_role_id AS approverRoleId,
            escalated_to_user_id AS escalatedToUserId,
            escalated_to_role_id AS escalatedToRoleId
       FROM approval_steps
      WHERE id IN (?)`,
    [stepIds]
  );

  const targets = new Set();
  const roleIds = new Set();

  for (const step of steps) {
    if (step.escalatedToUserId) targets.add(Number(step.escalatedToUserId));
    else if (step.approverUserId) targets.add(Number(step.approverUserId));

    if (step.escalatedToRoleId) roleIds.add(Number(step.escalatedToRoleId));
    else if (step.approverRoleId) roleIds.add(Number(step.approverRoleId));
  }

  if (roleIds.size) {
    const [users] = await pool.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id
        WHERE ur.role_id IN (?)
          AND u.entity_id=?
          AND r.entity_id=?
          AND u.status='active'
          AND u.deleted_at IS NULL
          AND r.deleted_at IS NULL`,
      [[...roleIds], entityId, entityId]
    );
    for (const user of users) targets.add(Number(user.id));
  }

  return [...targets];
}

async function notifySteps(stepIds, request) {
  const users = await targetUsersForSteps(stepIds, request.entity_id);
  for (const userId of users) {
    try {
      await notif.create({
        userId,
        entityId: request.entity_id,
        title: 'Approval menunggu keputusan Anda',
        body: request.title,
        event: 'approval.step_activated',
        subjectType: 'approval_request',
        subjectId: request.id,
        actionUrl: `/approvals/${request.id}`,
      });
    } catch {
      // Notification failure must not revert the committed approval state.
    }
  }
}

async function validateCreateReferences(conn, entityId, body) {
  if (body.departmentId) {
    const [rows] = await conn.query(
      `SELECT id FROM departments
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [body.departmentId, entityId]
    );
    if (!rows[0]) {
      const error = new Error('Department tidak valid untuk entity ini');
      error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
  }

  let document = null;
  if (body.documentId) {
    const [rows] = await conn.query(
      `SELECT id, entity_id, department_id, document_type
         FROM documents
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [body.documentId, entityId]
    );
    document = rows[0] || null;
    if (!document) {
      const error = new Error('Document tidak valid untuk entity ini');
      error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
  }

  let documentTypeId = body.documentTypeId || null;
  if (documentTypeId) {
    const [rows] = await conn.query(
      `SELECT id FROM document_types
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [documentTypeId, entityId]
    );
    if (!rows[0]) {
      const error = new Error('Document type tidak valid untuk entity ini');
      error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
  } else if (document?.document_type) {
    const [rows] = await conn.query(
      `SELECT id FROM document_types
        WHERE entity_id=? AND code=? AND deleted_at IS NULL
        LIMIT 1`,
      [entityId, document.document_type]
    );
    documentTypeId = rows[0]?.id || null;
  }

  return {
    document,
    documentTypeId,
  };
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 20);
    const offset = (page - 1) * limit;

    const where = ['a.entity_id=?'];
    const args = [req.entityScope.entityId];

    if (req.query.status) { where.push('a.status=?'); args.push(req.query.status); }
    if (req.query.departmentId) { where.push('a.department_id=?'); args.push(req.query.departmentId); }
    if (req.query.requestType) { where.push('a.request_type=?'); args.push(req.query.requestType); }
    if (req.query.subjectType) { where.push('a.subject_type=?'); args.push(req.query.subjectType); }
    if (req.query.subjectId) { where.push('a.subject_id=?'); args.push(req.query.subjectId); }

    const [rows] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId, a.department_id AS departmentId,
              a.document_id AS documentId, a.subject_type AS subjectType,
              a.subject_id AS subjectId, a.request_type AS requestType,
              a.document_type_id AS documentTypeId,
              a.title, a.description, a.approval_type AS approvalType,
              a.current_level AS currentLevel, a.status,
              a.flow_type AS flowType, a.matrix_key AS matrixKey,
              a.amount, a.currency,
              a.requested_by AS requestedBy, u.name AS requesterName,
              a.decided_by AS decidedBy, a.decided_at AS decidedAt,
              a.created_at AS createdAt,
              (SELECT COUNT(*) FROM approval_steps s
                WHERE s.approval_request_id=a.id) AS totalSteps,
              (SELECT COUNT(*) FROM approval_steps s
                WHERE s.approval_request_id=a.id AND s.status='approved') AS approvedSteps,
              (SELECT COUNT(*) FROM approval_steps s
                WHERE s.approval_request_id=a.id
                  AND s.status='pending' AND s.activated_at IS NOT NULL) AS activeSteps
         FROM approval_requests a
         JOIN users u ON u.id=a.requested_by
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM approval_requests a
        WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(res, rows, { page, limit, total });
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId,
              a.department_id AS departmentId,
              a.document_id AS documentId,
              a.subject_type AS subjectType,
              a.subject_id AS subjectId,
              a.request_type AS requestType,
              a.document_type_id AS documentTypeId,
              a.title, a.description,
              a.approval_type AS approvalType,
              a.current_level AS currentLevel,
              a.status,
              a.flow_type AS flowType,
              a.matrix_key AS matrixKey,
              a.matrix_rule_ids AS matrixRuleIds,
              a.amount, a.currency,
              a.requested_by AS requestedBy,
              u.name AS requesterName,
              a.decided_by AS decidedBy,
              a.decided_at AS decidedAt,
              a.decision_note AS decisionNote,
              a.created_at AS createdAt,
              a.updated_at AS updatedAt
         FROM approval_requests a
         JOIN users u ON u.id=a.requested_by
        WHERE a.id=? AND a.entity_id=?
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Approval tidak ditemukan', 404);

    const [steps] = await pool.query(
      `SELECT s.id, s.level, s.order_index AS orderIndex,
              s.matrix_rule_id AS matrixRuleId,
              s.approver_user_id AS approverUserId,
              au.name AS approverUserName,
              s.approver_role_id AS approverRoleId,
              ar.name AS approverRoleName,
              s.parallel_group AS parallelGroup,
              s.is_optional AS isOptional,
              s.delegated_from_user_id AS delegatedFromUserId,
              du.name AS delegatedFromUserName,
              s.status, s.activated_at AS activatedAt,
              s.deadline_at AS deadlineAt,
              s.escalated_at AS escalatedAt,
              s.escalated_to_user_id AS escalatedToUserId,
              eu.name AS escalatedToUserName,
              s.escalated_to_role_id AS escalatedToRoleId,
              er.name AS escalatedToRoleName,
              s.decided_by AS decidedBy,
              dec.name AS decidedByName,
              s.decided_at AS decidedAt, s.note
         FROM approval_steps s
         LEFT JOIN users au ON au.id=s.approver_user_id
         LEFT JOIN roles ar ON ar.id=s.approver_role_id
         LEFT JOIN users du ON du.id=s.delegated_from_user_id
         LEFT JOIN users eu ON eu.id=s.escalated_to_user_id
         LEFT JOIN roles er ON er.id=s.escalated_to_role_id
         LEFT JOIN users dec ON dec.id=s.decided_by
        WHERE s.approval_request_id=?
        ORDER BY s.order_index ASC, s.id ASC`,
      [req.params.id]
    );

    return ok(res, {
      ...rows[0],
      steps: steps.map((step) => ({
        ...step,
        isOptional: Boolean(step.isOptional),
      })),
    });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const reference = await validateCreateReferences(conn, entityId, req.body);

    await conn.beginTransaction();

    const result = await engine.createApprovalRequest({
      entityId,
      departmentId: req.body.departmentId || reference.document?.department_id || null,
      documentId: req.body.documentId || null,
      subjectType: req.body.subjectType || 'document',
      subjectId: req.body.subjectId || req.body.documentId || null,
      requestType: req.body.requestType || req.body.subjectType || 'document',
      documentTypeId: reference.documentTypeId,
      legacyDocumentType: req.body.subjectType || 'document',
      title: req.body.title,
      description: req.body.description || null,
      amount: req.body.amount ?? null,
      currency: req.body.currency || 'IDR',
      approvalType: req.body.approvalType || 'level_1',
      requestedBy: req.user.sub,
    }, conn);

    const [requestRows] = await conn.query(
      'SELECT * FROM approval_requests WHERE id=? LIMIT 1',
      [result.id]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'request',
      entityIdRef: result.id,
      action: 'create',
      after: {
        flowType: result.flowType,
        matrixKey: result.matrixKey,
        matrixRuleIds: result.matrixRuleIds,
        stepCount: result.stepCount,
      },
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval.create',
      subjectType: 'approval_request',
      subjectId: result.id,
      metadata: {
        title: req.body.title,
        flowType: result.flowType,
        matrixKey: result.matrixKey,
        stepCount: result.stepCount,
      },
    });

    const active = await engine.getActiveSteps(result.id, pool);
    await notifySteps(active.map((step) => step.id), requestRows[0]);

    return ok(res, {
      id: result.id,
      flowType: result.flowType,
      matrixKey: result.matrixKey,
      stepCount: result.stepCount,
    }, undefined, 201);
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

async function resolveTargetStep({
  approval,
  requestedStepId,
  userId,
  roles,
  permissions,
  conn,
}) {
  if (requestedStepId) return Number(requestedStepId);

  const active = await engine.getActiveSteps(approval.id, conn);
  const candidates = [];

  for (const step of active) {
    if (await engine.canDecide({
      step,
      userId,
      userRoleIds: roles,
      userPermissions: permissions,
      entityId: approval.entity_id,
      requestType: approval.request_type,
      documentTypeId: approval.document_type_id,
      conn,
    })) {
      candidates.push(step);
    }
  }

  if (!candidates.length) {
    throw Object.assign(new Error('Tidak ada step aktif yang dapat Anda putuskan'), {
      status: 403,
      code: 'FORBIDDEN',
    });
  }
  if (candidates.length > 1) {
    throw Object.assign(new Error('Ada lebih dari satu step aktif; stepId wajib'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  return Number(candidates[0].id);
}

async function decide(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const roles = await userRoleIds(req.user.sub, entityId, conn);
    const permissions = req.user.permissions || [];

    await conn.beginTransaction();

    const [requestRows] = await conn.query(
      `SELECT * FROM approval_requests
        WHERE id=? AND entity_id=?
        LIMIT 1 FOR UPDATE`,
      [req.params.id, entityId]
    );
    const approval = requestRows[0];
    if (!approval) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Approval tidak ditemukan', 404);
    }
    if (approval.status !== 'pending') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Approval sudah tidak pending', 409);
    }

    const targetStepId = await resolveTargetStep({
      approval,
      requestedStepId: req.body.stepId,
      userId: req.user.sub,
      roles,
      permissions,
      conn,
    });

    let result;
    if (req.body.action === 'request_revision') {
      result = await engine.requestRevision({
        approvalRequest: approval,
        stepId: targetStepId,
        note: req.body.note,
        userId: req.user.sub,
        userRoleIds: roles,
        userPermissions: permissions,
        conn,
      });
    } else {
      const decidedStep = await engine.decideStep({
        approvalRequest: approval,
        stepId: targetStepId,
        action: req.body.action,
        note: req.body.note,
        userId: req.user.sub,
        userRoleIds: roles,
        userPermissions: permissions,
        conn,
      });

      const advanced = await engine.advanceAfterDecision({
        approvalRequestId: approval.id,
        actorUserId: req.user.sub,
        note: req.body.note,
        conn,
      });

      result = {
        ...advanced,
        stepId: decidedStep.id,
      };
    }

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'request',
      entityIdRef: approval.id,
      action: req.body.action,
      before: {
        status: approval.status,
        currentLevel: approval.current_level,
      },
      after: result,
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: `approval.${req.body.action}`,
      subjectType: 'approval_request',
      subjectId: approval.id,
      metadata: {
        stepId: targetStepId,
        note: req.body.note,
        status: result.status,
      },
    });

    if (result.status === 'approved' ||
        result.status === 'rejected' ||
        result.status === 'revision_requested') {
      try {
        await notif.create({
          userId: approval.requested_by,
          entityId,
          title: `Approval ${result.status}`,
          body: approval.title,
          event: `approval.${result.status}`,
          subjectType: 'approval_request',
          subjectId: approval.id,
          actionUrl: `/approvals/${approval.id}`,
        });
      } catch { /* no-op */ }
    }

    if (result.nextStepIds?.length) {
      await notifySteps(result.nextStepIds, approval);
    }

    return ok(res, {
      id: approval.id,
      stepId: targetStepId,
      status: result.status,
      advanced: Boolean(result.advanced),
      nextStepIds: result.nextStepIds || [],
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

async function myPendingSteps(req, res, next) {
  try {
    const [requests] = await pool.query(
      `SELECT * FROM approval_requests
        WHERE id=? AND entity_id=?
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    const approval = requests[0];
    if (!approval) return fail(res, 'NOT_FOUND', 'Approval tidak ditemukan', 404);
    if (approval.status !== 'pending') return ok(res, []);

    const roles = await userRoleIds(req.user.sub, approval.entity_id);
    const permissions = req.user.permissions || [];
    const active = await engine.getActiveSteps(approval.id);
    const result = [];

    for (const step of active) {
      if (await engine.canDecide({
        step,
        userId: req.user.sub,
        userRoleIds: roles,
        userPermissions: permissions,
        entityId: approval.entity_id,
        requestType: approval.request_type,
        documentTypeId: approval.document_type_id,
      })) {
        result.push({
          id: step.id,
          orderIndex: step.order_index,
          approverUserId: step.approver_user_id,
          approverRoleId: step.approver_role_id,
          parallelGroup: step.parallel_group,
          isOptional: Boolean(step.is_optional),
          deadlineAt: step.deadline_at,
          escalatedAt: step.escalated_at,
        });
      }
    }

    return ok(res, result);
  } catch (error) { next(error); }
}

module.exports = {
  list,
  detail,
  create,
  decide,
  myPendingSteps,
};
