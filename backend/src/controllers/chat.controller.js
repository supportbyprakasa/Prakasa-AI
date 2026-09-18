const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

function serviceError(message, status = 400, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function listRooms(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId,
              r.department_id AS departmentId,
              r.name, r.room_type AS roomType,
              r.created_at AS createdAt
         FROM chat_rooms r
         JOIN chat_room_members rm
           ON rm.room_id=r.id AND rm.user_id=?
        WHERE r.is_archived=0
          AND r.entity_id=?
        ORDER BY r.id DESC`,
      [req.user.sub, req.user.entityId]
    );

    return ok(res, rows);
  } catch (error) {
    next(error);
  }
}

async function createRoom(req, res, next) {
  const conn = await pool.getConnection();

  try {
    const {
      departmentId,
      name,
      roomType = 'division',
      memberIds = [],
    } = req.body;

    const entityId = Number(req.user.entityId);
    if (!entityId) {
      throw serviceError('User tidak memiliki entity aktif', 400);
    }

    await conn.beginTransaction();

    if (departmentId) {
      const [departments] = await conn.query(
        `SELECT id FROM departments
          WHERE id=? AND entity_id=? AND deleted_at IS NULL
          LIMIT 1`,
        [departmentId, entityId]
      );
      if (!departments[0]) {
        throw serviceError('Department tidak valid untuk entity ini');
      }
    }

    const uniqueMemberIds = [
      ...new Set(
        [Number(req.user.sub), ...memberIds.map(Number)]
          .filter((id) => Number.isInteger(id) && id > 0)
      ),
    ];

    if (roomType === 'direct' && uniqueMemberIds.length !== 2) {
      throw serviceError('Direct room harus berisi tepat 2 user');
    }

    if (uniqueMemberIds.length) {
      const [validMembers] = await conn.query(
        `SELECT id
           FROM users
          WHERE id IN (?)
            AND entity_id=?
            AND status='active'
            AND deleted_at IS NULL`,
        [uniqueMemberIds, entityId]
      );

      if (validMembers.length !== uniqueMemberIds.length) {
        throw serviceError(
          'Beberapa member tidak aktif atau tidak berada di entity yang sama'
        );
      }
    }

    const [room] = await conn.query(
      `INSERT INTO chat_rooms
       (entity_id, department_id, name, room_type, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entityId,
        departmentId || null,
        String(name).trim(),
        roomType,
        req.user.sub,
      ]
    );

    for (const userId of uniqueMemberIds) {
      await conn.query(
        `INSERT INTO chat_room_members (room_id, user_id)
         VALUES (?, ?)`,
        [room.insertId, userId]
      );
    }

    await conn.commit();

    await log({
      entityId,
      userId: req.user.sub,
      action: 'chat.room_create',
      subjectType: 'chat_room',
      subjectId: room.insertId,
      metadata: {
        roomType,
        departmentId: departmentId || null,
        memberCount: uniqueMemberIds.length,
      },
    });

    return ok(res, { id: room.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }

    if (error.status) {
      return fail(
        res,
        error.code || 'VALIDATION_ERROR',
        error.message,
        error.status
      );
    }

    next(error);
  } finally {
    conn.release();
  }
}

async function assertRoomMembership(roomId, user) {
  const [rows] = await pool.query(
    `SELECT r.id, r.entity_id AS entityId,
            r.department_id AS departmentId,
            r.is_archived AS isArchived
       FROM chat_rooms r
       JOIN chat_room_members rm
         ON rm.room_id=r.id AND rm.user_id=?
      WHERE r.id=?
        AND r.entity_id=?
      LIMIT 1`,
    [user.sub, roomId, user.entityId]
  );

  return rows[0] || null;
}

async function listMessages(req, res, next) {
  try {
    const room = await assertRoomMembership(req.params.id, req.user);
    if (!room) {
      return fail(res, 'FORBIDDEN', 'Anda bukan anggota room ini', 403);
    }

    const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 50);
    const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;

    const where = ['m.room_id=?'];
    const args = [req.params.id];

    if (beforeId) {
      where.push('m.id < ?');
      args.push(beforeId);
    }

    const [rows] = await pool.query(
      `SELECT m.id, m.room_id AS roomId,
              m.user_id AS userId, u.name AS userName,
              m.body, m.message_type AS messageType,
              m.converted_task_id AS convertedTaskId,
              m.created_at AS createdAt
         FROM chat_messages m
         JOIN users u ON u.id=m.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.id DESC
        LIMIT ?`,
      [...args, limit]
    );

    return ok(res, rows.reverse());
  } catch (error) {
    next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const room = await assertRoomMembership(req.params.id, req.user);
    if (!room) {
      return fail(res, 'FORBIDDEN', 'Anda bukan anggota room ini', 403);
    }
    if (room.isArchived) {
      return fail(res, 'CONFLICT', 'Room sudah diarsipkan', 409);
    }

    const [result] = await pool.query(
      `INSERT INTO chat_messages
       (room_id, user_id, body, message_type)
       VALUES (?, ?, ?, 'text')`,
      [req.params.id, req.user.sub, req.body.body]
    );

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    next(error);
  }
}

async function convertMessageToTask(req, res, next) {
  const conn = await pool.getConnection();

  try {
    const {
      boardId,
      columnId,
      assigneeId,
      priority = 'normal',
      dueDate,
    } = req.body;

    await conn.beginTransaction();

    const [messages] = await conn.query(
      `SELECT m.id, m.room_id, m.body, m.converted_task_id,
              r.entity_id AS entityId,
              r.department_id AS departmentId,
              r.is_archived AS isArchived
         FROM chat_messages m
         JOIN chat_rooms r ON r.id=m.room_id
        WHERE m.id=?
        LIMIT 1 FOR UPDATE`,
      [req.params.messageId]
    );
    const message = messages[0];

    if (!message) {
      throw serviceError('Pesan tidak ditemukan', 404, 'NOT_FOUND');
    }

    if (Number(message.entityId) !== Number(req.user.entityId)) {
      throw serviceError('Room berada di entity lain', 403, 'FORBIDDEN');
    }

    const [members] = await conn.query(
      `SELECT 1 FROM chat_room_members
        WHERE room_id=? AND user_id=?
        LIMIT 1`,
      [message.room_id, req.user.sub]
    );
    if (!members[0]) {
      throw serviceError('Anda bukan anggota room ini', 403, 'FORBIDDEN');
    }

    if (message.converted_task_id) {
      throw serviceError(
        'Pesan sudah dikonversi',
        409,
        'CONFLICT'
      );
    }

    let resolvedBoardId = boardId || null;
    let taskDepartmentId = message.departmentId || null;
    let board = null;
    if (resolvedBoardId) {
      const [boards] = await conn.query(
        `SELECT id, department_id AS departmentId
           FROM boards
          WHERE id=? AND entity_id=? AND deleted_at IS NULL
          LIMIT 1`,
        [resolvedBoardId, message.entityId]
      );
      board = boards[0] || null;
      if (!board) {
        throw serviceError('Board tidak valid');
      }

      if (taskDepartmentId == null && board.departmentId != null) {
        taskDepartmentId = Number(board.departmentId);
      } else if (
        taskDepartmentId != null &&
        board.departmentId != null &&
        Number(taskDepartmentId) !== Number(board.departmentId)
      ) {
        throw serviceError('Board berada di department berbeda dari room');
      }
    }

    if (columnId) {
      const args = [columnId, message.entityId];
      let sql =
        `SELECT bc.id, bc.board_id AS boardId,
                b.department_id AS departmentId
           FROM board_columns bc
           JOIN boards b ON b.id=bc.board_id
          WHERE bc.id=?
            AND b.entity_id=?
            AND b.deleted_at IS NULL`;

      if (resolvedBoardId) {
        sql += ' AND bc.board_id=?';
        args.push(resolvedBoardId);
      }
      sql += ' LIMIT 1';

      const [columns] = await conn.query(sql, args);
      if (!columns[0]) {
        throw serviceError(
          resolvedBoardId
            ? 'Column tidak berada pada board yang dipilih'
            : 'Column tidak valid'
        );
      }
      if (!resolvedBoardId) resolvedBoardId = Number(columns[0].boardId);
      if (taskDepartmentId == null && columns[0].departmentId != null) {
        taskDepartmentId = Number(columns[0].departmentId);
      } else if (
        taskDepartmentId != null &&
        columns[0].departmentId != null &&
        Number(taskDepartmentId) !== Number(columns[0].departmentId)
      ) {
        throw serviceError('Column berada pada board department berbeda dari room');
      }
    }

    if (assigneeId) {
      const [assignees] = await conn.query(
        `SELECT id FROM users
          WHERE id=? AND entity_id=?
            AND status='active' AND deleted_at IS NULL
          LIMIT 1`,
        [assigneeId, message.entityId]
      );
      if (!assignees[0]) {
        throw serviceError('Assignee tidak valid');
      }
    }

    const [task] = await conn.query(
      `INSERT INTO tasks
       (entity_id, department_id, board_id, column_id,
        title, description, priority, assignee_id,
        reporter_id, due_date, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chat', ?)`,
      [
        message.entityId,
        taskDepartmentId,
        resolvedBoardId,
        columnId || null,
        String(message.body).slice(0, 200),
        message.body,
        priority,
        assigneeId || null,
        req.user.sub,
        dueDate || null,
        message.id,
      ]
    );

    await conn.query(
      `UPDATE chat_messages
          SET converted_task_id=?
        WHERE id=? AND converted_task_id IS NULL`,
      [task.insertId, message.id]
    );

    await conn.commit();

    await log({
      entityId: message.entityId,
      userId: req.user.sub,
      action: 'chat.convert_to_task',
      subjectType: 'task',
      subjectId: task.insertId,
      metadata: {
        messageId: message.id,
        roomId: message.room_id,
      },
    });

    return ok(res, { taskId: task.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }

    if (error.status) {
      return fail(
        res,
        error.code || 'VALIDATION_ERROR',
        error.message,
        error.status
      );
    }

    next(error);
  } finally {
    conn.release();
  }
}

module.exports = {
  listRooms,
  createRoom,
  listMessages,
  sendMessage,
  convertMessageToTask,
};
