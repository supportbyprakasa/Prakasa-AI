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
  const requestedEntityId = Number(payload.entityId || entityId);
  if (requestedEntityId !== entityId) {
    const error = new Error('Task tidak boleh dibuat di entity berbeda dari proposal');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  let departmentId =
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

  if (departmentId != null) {
    const [departments] = await conn.query(
      `SELECT id FROM departments
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [departmentId, entityId]
    );
    if (!departments[0]) {
      const error = new Error('Department tidak valid');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  let boardId = payload.boardId ? Number(payload.boardId) : null;
  const columnId = payload.columnId ? Number(payload.columnId) : null;

  let board = null;
  if (boardId) {
    const [boards] = await conn.query(
      `SELECT id, department_id AS departmentId
         FROM boards
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [boardId, entityId]
    );
    board = boards[0] || null;
    if (!board) {
      const error = new Error('Board tidak valid');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    if (departmentId == null && board.departmentId != null) {
      departmentId = Number(board.departmentId);
    } else if (
      board.departmentId != null &&
      departmentId != null &&
      Number(board.departmentId) !== Number(departmentId)
    ) {
      const error = new Error('Board tidak sesuai department task');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  if (columnId) {
    const args = [columnId, entityId];
    let sql =
      `SELECT bc.id, bc.board_id AS boardId,
              b.department_id AS departmentId
         FROM board_columns bc
         JOIN boards b ON b.id=bc.board_id
        WHERE bc.id=?
          AND b.entity_id=?
          AND b.deleted_at IS NULL`;

    if (boardId) {
      sql += ' AND bc.board_id=?';
      args.push(boardId);
    }

    sql += ' LIMIT 1';

    const [columns] = await conn.query(sql, args);
    if (!columns[0]) {
      const error = new Error(
        boardId
          ? 'Column tidak berada pada board yang dipilih'
          : 'Column tidak valid'
      );
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (!boardId) boardId = Number(columns[0].boardId);

    if (departmentId == null && columns[0].departmentId != null) {
      departmentId = Number(columns[0].departmentId);
    } else if (
      columns[0].departmentId != null &&
      departmentId != null &&
      Number(columns[0].departmentId) !== Number(departmentId)
    ) {
      const error = new Error('Column berada pada board department berbeda');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  const assigneeId = payload.assigneeId
    ? Number(payload.assigneeId)
    : null;

  if (assigneeId) {
    const [users] = await conn.query(
      `SELECT id, department_id AS departmentId
         FROM users
        WHERE id=? AND entity_id=?
          AND status='active' AND deleted_at IS NULL
        LIMIT 1`,
      [assigneeId, entityId]
    );
    const assignee = users[0];
    if (!assignee) {
      const error = new Error('Assignee tidak valid');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    if (
      departmentId != null &&
      assignee.departmentId != null &&
      Number(assignee.departmentId) !== Number(departmentId) &&
      !hasPerm(user, 'ai_command.admin.view')
    ) {
      const error = new Error('Assignee berada di department lain');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
  }

  const priority = ['low', 'normal', 'high', 'urgent'].includes(payload.priority)
    ? payload.priority
    : 'normal';

  const dueDate = payload.dueDate == null || payload.dueDate === ''
    ? null
    : String(payload.dueDate);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    const error = new Error('dueDate harus berformat YYYY-MM-DD');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const [task] = await conn.query(
    `INSERT INTO tasks
     (entity_id, department_id, board_id, column_id, title, description,
      priority, assignee_id, reporter_id, due_date, source_type, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_action', ?)`,
    [
      entityId,
      departmentId,
      boardId,
      columnId,
      title.slice(0, 255),
      payload.description ? String(payload.description).slice(0, 10000) : null,
      priority,
      assigneeId,
      user.sub,
      dueDate,
      proposal.id,
    ]
  );

  return { taskId: task.insertId };
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
              failure_message=?
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
