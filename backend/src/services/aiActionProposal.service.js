const pool = require('../db/pool');
const { log: activityLog } = require('./activityLog.service');

const EXECUTABLE_ACTION_TYPES = new Set(['create_task']);
const ALLOWED_ACTION_TYPES = new Set([
  'create_task',
  'create_approval',
  'create_document',
  'create_calendar_event',
  'update_task',
  'send_notification',
]);

function hasPerm(user, code) {
  return Boolean(user && (user.permissions || []).includes(code));
}

function safeParse(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function containsSensitiveKey(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return false;

  const sensitive = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'apikey',
    'privatekey',
    'clientsecret',
    'authorization',
    'jwt',
  ];

  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveKey(item, depth + 1));
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalized = String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    if (sensitive.some((needle) => normalized.includes(needle))) {
      return true;
    }
    if (containsSensitiveKey(nested, depth + 1)) return true;
  }

  return false;
}


function assertProposalEntityAccess(user, proposal) {
  if (Number(proposal.entity_id) === Number(user.entityId)) return;
  if (
    hasPerm(user, 'entity.cross_access') &&
    hasPerm(user, 'ai_command.admin.view')
  ) {
    return;
  }

  const error = new Error('Tidak punya akses ke entity proposal');
  error.status = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

async function insertUsage(event, conn = pool) {
  await conn.query(
    `INSERT INTO ai_usage_events
     (session_id, entity_id, department_id, user_id,
      module, event_type, metadata_json)
     VALUES (?, ?, ?, ?, 'ai_command_center', ?, ?)`,
    [
      event.sessionId,
      event.entityId,
      event.departmentId || null,
      event.userId,
      event.eventType,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ]
  );
}

async function createProposal({
  session,
  messageId,
  actionType,
  payload,
  user,
  proposedByAiModule = 'ai_command_center',
}) {
  if (!ALLOWED_ACTION_TYPES.has(actionType)) {
    const error = new Error('actionType tidak didukung');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('payload wajib objek');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (containsSensitiveKey(payload)) {
    const error = new Error('Payload action tidak boleh berisi credential, token, atau secret');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > 20000) {
    const error = new Error('payload proposal terlalu besar');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (messageId) {
    const [messages] = await pool.query(
      `SELECT id FROM ai_messages
        WHERE id=? AND session_id=?
        LIMIT 1`,
      [messageId, session.id]
    );
    if (!messages[0]) {
      const error = new Error('messageId tidak berasal dari session ini');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  const [result] = await pool.query(
    `INSERT INTO ai_action_proposals
     (session_id, message_id, entity_id, department_id,
      action_type, payload_json, proposed_by_ai_module, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    [
      session.id,
      messageId || null,
      session.entity_id,
      session.department_id,
      actionType,
      serialized,
      proposedByAiModule,
    ]
  );

  await insertUsage({
    sessionId: session.id,
    entityId: session.entity_id,
    departmentId: session.department_id,
    userId: user.sub,
    eventType: 'action_proposed',
    metadata: { actionType },
  });

  await activityLog({
    entityId: session.entity_id,
    userId: user.sub,
    action: 'ai_action.propose',
    subjectType: 'ai_action_proposal',
    subjectId: result.insertId,
    metadata: { actionType },
  });

  return { id: result.insertId };
}

async function listProposals({ session, status }) {
  const where = ['session_id=?'];
  const args = [session.id];

  if (status) {
    where.push('status=?');
    args.push(status);
  }

  const [rows] = await pool.query(
    `SELECT id, session_id AS sessionId, message_id AS messageId,
            action_type AS actionType, payload_json AS payloadJson,
            status, proposed_by_ai_module AS proposedByAiModule,
            confirmed_by AS confirmedBy, confirmed_at AS confirmedAt,
            decision_note AS decisionNote,
            executed_by AS executedBy, executed_at AS executedAt,
            execution_result_json AS executionResultJson,
            failure_message AS failureMessage, expires_at AS expiresAt,
            created_at AS createdAt, updated_at AS updatedAt
       FROM ai_action_proposals
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC`,
    args
  );

  return rows.map((row) => ({
    ...row,
    payload: safeParse(row.payloadJson),
    executionResult: safeParse(row.executionResultJson),
    payloadJson: undefined,
    executionResultJson: undefined,
  }));
}

async function getProposalById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM ai_action_proposals WHERE id=? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function executeCreateTask({ proposal, conn, user }) {
  if (!hasPerm(user, 'task.create')) {
    const error = new Error('Butuh permission task.create');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const payload = safeParse(proposal.payload_json) || {};
  const title = String(payload.title || '').trim();
  if (!title) {
    const error = new Error('payload.title wajib untuk create_task');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const entityId = Number(proposal.entity_id);
  if (
    payload.entityId != null &&
    Number(payload.entityId) !== entityId
  ) {
    const error = new Error('Task tidak boleh dibuat di entity berbeda dari proposal');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const departmentId =
    payload.departmentId != null
      ? Number(payload.departmentId)
      : proposal.department_id != null
        ? Number(proposal.department_id)
        : user.departmentId != null
          ? Number(user.departmentId)
          : null;

  if (
    proposal.department_id != null &&
    departmentId != null &&
    Number(departmentId) !== Number(proposal.department_id) &&
    !hasPerm(user, 'ai_command.admin.view')
  ) {
    const error = new Error('Task tidak boleh berpindah department dari session AI');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const taskSvc = require('./task.service');
  const created = await taskSvc.createTask({
    input: {
      entityId,
      departmentId,
      boardId: payload.boardId != null ? Number(payload.boardId) : null,
      columnId: payload.columnId != null ? Number(payload.columnId) : null,
      title,
      description: payload.description || null,
      priority: payload.priority || 'normal',
      assigneeId: payload.assigneeId != null ? Number(payload.assigneeId) : null,
      startDate: payload.startDate || null,
      dueDate: payload.dueDate || null,
      progressPercent: payload.progressPercent,
    },
    user,
    trustedSource: { type: 'ai_action', id: proposal.id },
    conn,
  });

  return { taskId: created.id };
}

async function confirmProposal({ proposalId, user }) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM ai_action_proposals
        WHERE id=?
        LIMIT 1 FOR UPDATE`,
      [proposalId]
    );
    const proposal = rows[0];

    if (!proposal) {
      await conn.rollback();
      const error = new Error('Proposal tidak ditemukan');
      error.status = 404;
      error.code = 'NOT_FOUND';
      throw error;
    }

    assertProposalEntityAccess(user, proposal);

    if (proposal.status !== 'proposed') {
      await conn.rollback();
      const error = new Error(
        `Proposal tidak dalam status proposed (current=${proposal.status})`
      );
      error.status = 409;
      error.code = 'CONFLICT';
      throw error;
    }

    if (
      proposal.expires_at &&
      new Date(proposal.expires_at).getTime() <= Date.now()
    ) {
      await conn.query(
        `UPDATE ai_action_proposals
            SET status='expired'
          WHERE id=?`,
        [proposalId]
      );
      await conn.commit();

      const error = new Error('Proposal sudah kedaluwarsa');
      error.status = 409;
      error.code = 'EXPIRED';
      throw error;
    }

    if (!EXECUTABLE_ACTION_TYPES.has(proposal.action_type)) {
      const result = {
        deferred: true,
        reason: `Executor belum tersedia untuk action_type=${proposal.action_type}`,
      };

      await conn.query(
        `UPDATE ai_action_proposals
            SET status='confirmed',
                confirmed_by=?,
                confirmed_at=NOW(),
                execution_result_json=?
          WHERE id=?`,
        [user.sub, JSON.stringify(result), proposalId]
      );

      await insertUsage({
        sessionId: proposal.session_id,
        entityId: proposal.entity_id,
        departmentId: proposal.department_id,
        userId: user.sub,
        eventType: 'action_confirmed',
        metadata: {
          actionType: proposal.action_type,
          executionDeferred: true,
        },
      }, conn);

      await conn.commit();

      await activityLog({
        entityId: proposal.entity_id,
        userId: user.sub,
        action: 'ai_action.confirm_deferred',
        subjectType: 'ai_action_proposal',
        subjectId: proposalId,
        metadata: { actionType: proposal.action_type },
      });

      return {
        id: proposalId,
        status: 'confirmed',
        executionDeferred: true,
      };
    }

    const executionResult = await executeCreateTask({
      proposal,
      conn,
      user,
    });

    await conn.query(
      `UPDATE ai_action_proposals
          SET status='executed',
              confirmed_by=?,
              confirmed_at=NOW(),
              executed_by=?,
              executed_at=NOW(),
              execution_result_json=?
        WHERE id=?`,
      [
        user.sub,
        user.sub,
        JSON.stringify(executionResult),
        proposalId,
      ]
    );

    await insertUsage({
      sessionId: proposal.session_id,
      entityId: proposal.entity_id,
      departmentId: proposal.department_id,
      userId: user.sub,
      eventType: 'action_confirmed',
      metadata: {
        actionType: proposal.action_type,
        executionDeferred: false,
      },
    }, conn);

    await insertUsage({
      sessionId: proposal.session_id,
      entityId: proposal.entity_id,
      departmentId: proposal.department_id,
      userId: user.sub,
      eventType: 'action_executed',
      metadata: {
        actionType: proposal.action_type,
        taskId: executionResult.taskId,
      },
    }, conn);

    await conn.commit();

    try {
      const taskSvc = require('./task.service');
      await taskSvc.finalizeCreatedTask({
        taskId: executionResult.taskId,
        actorUserId: user.sub,
      });
    } catch {
      // Proposal/task are already committed; notification/log side effects are best effort.
    }

    try {
      await activityLog({
        entityId: proposal.entity_id,
        userId: user.sub,
        action: 'ai_action.execute',
        subjectType: 'ai_action_proposal',
        subjectId: proposalId,
        metadata: {
          actionType: proposal.action_type,
          taskId: executionResult.taskId,
        },
      });
    } catch {
      // Proposal/task execution is already committed.
    }

    return {
      id: proposalId,
      status: 'executed',
      executionResult,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function rejectProposal({ proposalId, user, reason }) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM ai_action_proposals
        WHERE id=?
        LIMIT 1 FOR UPDATE`,
      [proposalId]
    );
    const proposal = rows[0];

    if (!proposal) {
      await conn.rollback();
      const error = new Error('Proposal tidak ditemukan');
      error.status = 404;
      error.code = 'NOT_FOUND';
      throw error;
    }

    assertProposalEntityAccess(user, proposal);

    if (proposal.status !== 'proposed') {
      await conn.rollback();
      const error = new Error(
        `Proposal tidak dalam status proposed (current=${proposal.status})`
      );
      error.status = 409;
      error.code = 'CONFLICT';
      throw error;
    }

    await conn.query(
      `UPDATE ai_action_proposals
          SET status='rejected',
              confirmed_by=?,
              confirmed_at=NOW(),
              decision_note=?
        WHERE id=?`,
      [
        user.sub,
        reason ? String(reason).slice(0, 500) : null,
        proposalId,
      ]
    );

    await insertUsage({
      sessionId: proposal.session_id,
      entityId: proposal.entity_id,
      departmentId: proposal.department_id,
      userId: user.sub,
      eventType: 'action_rejected',
      metadata: { actionType: proposal.action_type },
    }, conn);

    await conn.commit();

    await activityLog({
      entityId: proposal.entity_id,
      userId: user.sub,
      action: 'ai_action.reject',
      subjectType: 'ai_action_proposal',
      subjectId: proposalId,
      metadata: {
        actionType: proposal.action_type,
        reasonProvided: Boolean(reason),
      },
    });

    return { id: proposalId, status: 'rejected' };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  ALLOWED_ACTION_TYPES,
  EXECUTABLE_ACTION_TYPES,
  createProposal,
  listProposals,
  getProposalById,
  confirmProposal,
  rejectProposal,
};
