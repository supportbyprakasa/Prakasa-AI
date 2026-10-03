const pool = require('../db/pool');
const taskAccess = require('../services/taskAccess.service');
const googleChat = require('../services/googleChat.service');
const taskSvc = require('../services/task.service');
const { log: activityLog } = require('../services/activityLog.service');
const { ok, fail } = require('../utils/response');

function svcError(e, res, next) {
  if ([400, 403, 404, 409].includes(e.status)) {
    const fallback =
      e.status === 403 ? 'FORBIDDEN' :
      e.status === 404 ? 'NOT_FOUND' :
      e.status === 409 ? 'CONFLICT' :
      'VALIDATION_ERROR';
    return fail(res, e.code || fallback, e.message, e.status);
  }
  return next(e);
}

async function loadBoardWithSpace(boardId, user) {
  const board = await taskAccess.loadBoard(boardId);
  taskAccess.assertBoardAccess({ user, board, action: 'view' });
  if (!board.google_chat_space_name) {
    const e = new Error('Space belum tersedia untuk board ini');
    e.status = 400; e.code = 'SPACE_NOT_LINKED'; throw e;
  }
  return board;
}

async function listMessages(req, res, next) {
  try {
    const board = await loadBoardWithSpace(Number(req.params.id), req.user);
    const data = await googleChat.listMessages({
      spaceName: board.google_chat_space_name,
      actingEmail: req.user.email,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      pageToken: req.query.pageToken,
    }, { entityId: board.entity_id, userId: req.user.sub, subjectType: 'board', subjectId: board.id });
    return ok(res, data);
  } catch (e) { return svcError(e, res, next); }
}

async function sendMessage(req, res, next) {
  try {
    const board = await loadBoardWithSpace(Number(req.params.id), req.user);
    const message = await googleChat.createMessage({
      spaceName: board.google_chat_space_name,
      text: req.body.text,
      senderEmail: req.user.email,
    }, { entityId: board.entity_id, userId: req.user.sub, subjectType: 'board', subjectId: board.id });
    return ok(res, message, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function convertMessageToTask(req, res, next) {
  let conn;
  try {
    const board = await loadBoardWithSpace(Number(req.params.id), req.user);
    const message = await googleChat.getMessage({
      messageName: req.body.messageName,
      actingEmail: req.user.email,
    }, { entityId: board.entity_id, userId: req.user.sub, subjectType: 'board', subjectId: board.id });

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const created = await taskSvc.createTask({
      input: {
        entityId: board.entity_id,
        departmentId: board.department_id,
        boardId: board.id,
        columnId: req.body.columnId || null,
        title: (message.text || '(pesan tanpa teks)').slice(0, 200),
        description: message.text || '',
        assigneeId: req.body.assigneeId || null,
        priority: req.body.priority,
        dueDate: req.body.dueDate,
      },
      user: req.user,
      trustedSource: { type: 'chat', id: null, externalRef: message.name },
      conn,
    });

    await conn.query(
      `INSERT INTO chat_task_links (board_id, chat_message_name, task_id, created_by)
       VALUES (?, ?, ?, ?)`,
      [board.id, message.name, created.id, req.user.sub]
    );

    await conn.commit();
    await taskSvc.finalizeCreatedTask({ taskId: created.id, actorUserId: req.user.sub });

    try {
      await activityLog({
        entityId: board.entity_id, userId: req.user.sub, action: 'chat.convert_to_task',
        subjectType: 'task', subjectId: created.id,
        metadata: { boardId: board.id, messageName: message.name },
      });
    } catch { /* task is already committed */ }

    return ok(res, created, undefined, 201);
  } catch (e) {
    if (conn) { try { await conn.rollback(); } catch { /* noop */ } }
    if (e.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Pesan ini sudah pernah dikonversi jadi task', 409);
    }
    return svcError(e, res, next);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { listMessages, sendMessage, convertMessageToTask };
