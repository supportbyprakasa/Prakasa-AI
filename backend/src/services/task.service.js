const pool = require('../db/pool');
const { log: activityLog } = require('./activityLog.service');
const taskAccess = require('./taskAccess.service');
const taskActivity = require('./taskActivity.service');
const watcherSvc = require('./taskWatcher.service');
const notifSvc = require('./taskNotification.service');

const DONE_STATUSES = new Set(['done', 'closed', 'completed']);
const FINAL_STATUSES = new Set(['done', 'closed', 'completed', 'cancelled']);
const TRUSTED_SOURCE_TYPES = new Set(['chat', 'ai_action']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function validationError(message, code = 'VALIDATION_ERROR', status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseDate(value, field) {
  if (value == null || value === '') return null;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw validationError(`${field} harus berformat YYYY-MM-DD`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw validationError(`${field} tidak valid`);
  }
  return text;
}

function parseProgress(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw validationError('progressPercent harus integer 0–100');
  }
  return number;
}

function normalizeStatus(value, fallback = 'open') {
  if (value == null) return fallback;
  const status = String(value).trim();
  if (!status || status.length > 50) throw validationError('status tidak valid');
  return status;
}

function normalizePriority(value, fallback = 'normal') {
  const priority = value == null ? fallback : String(value);
  if (!PRIORITIES.has(priority)) throw validationError('priority tidak valid');
  return priority;
}

async function validateEntity(entityId, conn) {
  const [rows] = await conn.query(
    `SELECT id FROM entities
      WHERE id=? AND deleted_at IS NULL
      LIMIT 1`,
    [entityId]
  );
  if (!rows[0]) {
    const error = new Error('Entity tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  return Number(entityId);
}

async function validateDepartment({ entityId, departmentId }, conn) {
  if (departmentId == null) return null;
  const [rows] = await conn.query(
    `SELECT id FROM departments
      WHERE id=? AND entity_id=? AND deleted_at IS NULL
      LIMIT 1`,
    [departmentId, entityId]
  );
  if (!rows[0]) throw validationError('Department tidak valid untuk entity ini');
  return Number(departmentId);
}

async function validateBoardColumn({
  entityId,
  departmentId,
  boardId,
  columnId,
  allowArchived = false,
}, conn) {
  let resolvedBoardId = boardId == null ? null : Number(boardId);
  let resolvedColumnId = columnId == null ? null : Number(columnId);
  let resolvedDepartmentId = departmentId == null ? null : Number(departmentId);
  let board = null;

  if (resolvedColumnId != null) {
    const [rows] = await conn.query(
      `SELECT bc.id,
              bc.board_id AS boardId,
              b.entity_id AS entityId,
              b.department_id AS departmentId,
              b.is_archived AS isArchived
         FROM board_columns bc
         JOIN boards b ON b.id=bc.board_id
        WHERE bc.id=? AND b.deleted_at IS NULL
        LIMIT 1`,
      [resolvedColumnId]
    );
    const column = rows[0];
    if (!column || Number(column.entityId) !== Number(entityId)) {
      throw validationError('Column tidak valid untuk entity ini');
    }
    if (resolvedBoardId != null && Number(column.boardId) !== resolvedBoardId) {
      throw validationError('Column tidak berada di board yang dipilih');
    }
    resolvedBoardId = Number(column.boardId);
    board = column;
  } else if (resolvedBoardId != null) {
    const [rows] = await conn.query(
      `SELECT id AS boardId, entity_id AS entityId,
              department_id AS departmentId,
              is_archived AS isArchived
         FROM boards
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [resolvedBoardId, entityId]
    );
    board = rows[0] || null;
    if (!board) throw validationError('Board tidak valid untuk entity ini');
  }

  if (board && board.isArchived && !allowArchived) {
    throw validationError('Board sudah diarsipkan', 'BOARD_ARCHIVED', 409);
  }

  if (board?.departmentId != null) {
    const boardDepartmentId = Number(board.departmentId);
    if (resolvedDepartmentId == null) {
      resolvedDepartmentId = boardDepartmentId;
    } else if (resolvedDepartmentId !== boardDepartmentId) {
      throw validationError('Board/column berada di department berbeda dari task');
    }
  }

  if (resolvedDepartmentId != null) {
    await validateDepartment({ entityId, departmentId: resolvedDepartmentId }, conn);
  }

  if (resolvedBoardId == null && resolvedColumnId != null) {
    throw validationError('columnId membutuhkan board yang valid');
  }

  return {
    boardId: resolvedBoardId,
    columnId: resolvedColumnId,
    departmentId: resolvedDepartmentId,
  };
}

async function validateAssignee({ entityId, assigneeId }, conn) {
  if (assigneeId == null) return null;
  const [rows] = await conn.query(
    `SELECT id FROM users
      WHERE id=? AND entity_id=?
        AND status='active' AND deleted_at IS NULL
      LIMIT 1`,
    [assigneeId, entityId]
  );
  if (!rows[0]) throw validationError('Assignee tidak valid untuk entity ini');
  return Number(assigneeId);
}

async function enforceWipLimit({ columnId, entityId, ignoreTaskId = null }, conn) {
  if (!columnId) return;

  const [columns] = await conn.query(
    `SELECT bc.id, bc.wip_limit AS wipLimit,
            b.entity_id AS entityId, b.deleted_at AS boardDeletedAt,
            b.is_archived AS isArchived
       FROM board_columns bc
       JOIN boards b ON b.id=bc.board_id
      WHERE bc.id=?
      LIMIT 1 FOR UPDATE`,
    [columnId]
  );
  const column = columns[0];
  if (!column || column.boardDeletedAt || Number(column.entityId) !== Number(entityId)) {
    throw validationError('Column tidak valid untuk entity ini');
  }
  if (column.isArchived) {
    throw validationError('Board sudah diarsipkan', 'BOARD_ARCHIVED', 409);
  }
  if (column.wipLimit == null) return;

  const [countRows] = await conn.query(
    `SELECT COUNT(*) AS total
       FROM tasks
      WHERE column_id=? AND entity_id=? AND deleted_at IS NULL
        AND status NOT IN ('done','closed','completed','cancelled')
        AND (? IS NULL OR id<>?)`,
    [columnId, entityId, ignoreTaskId, ignoreTaskId]
  );
  if (Number(countRows[0].total) >= Number(column.wipLimit)) {
    throw validationError(
      `WIP limit tercapai untuk kolom ini (maks ${column.wipLimit})`,
      'WIP_LIMIT_EXCEEDED',
      409
    );
  }
}

function buildDynamicUpdate(patch, fieldMap) {
  const sets = [];
  const args = [];
  for (const [key, spec] of Object.entries(fieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];
    sets.push(`${spec.col} = ?`);
    args.push(spec.normalize ? spec.normalize(value) : value);
  }
  return { sets, args };
}

async function finalizeCreatedTask({ taskId, actorUserId }) {
  const [rows] = await pool.query(
    `SELECT id, entity_id, reporter_id, assignee_id, title, source_type
       FROM tasks
      WHERE id=? AND deleted_at IS NULL
      LIMIT 1`,
    [taskId]
  );
  const task = rows[0];
  if (!task) return;

  try {
    await activityLog({
      entityId: task.entity_id,
      userId: actorUserId,
      action: 'task.create',
      subjectType: 'task',
      subjectId: task.id,
      metadata: {
        title: task.title,
        assigneeId: task.assignee_id || null,
        sourceType: task.source_type || 'manual',
      },
    });
  } catch { /* task creation is already committed */ }

  if (task.assignee_id && Number(task.assignee_id) !== Number(actorUserId)) {
    try {
      await notifSvc.notifyTaskUsers({
        task,
        actorUserId,
        event: 'task.assigned',
        title: 'Task baru untuk Anda',
        body: task.title,
        actionUrl: `/tasks/${task.id}`,
        includeWatchers: false,
      });
    } catch { /* notification must not roll back committed work */ }
  }
}

async function createTask({ input, user, trustedSource = null, conn = null }) {
  const db = conn || await pool.getConnection();
  const ownTransaction = !conn;

  try {
    if (ownTransaction) await db.beginTransaction();

    const entityId = taskAccess.resolveTargetEntity({
      user,
      requestedEntityId: input.entityId,
    });
    await validateEntity(entityId, db);

    let departmentId = await validateDepartment({
      entityId,
      departmentId: input.departmentId,
    }, db);

    const refs = await validateBoardColumn({
      entityId,
      departmentId,
      boardId: input.boardId,
      columnId: input.columnId,
    }, db);
    departmentId = refs.departmentId;

    const assigneeId = await validateAssignee({
      entityId,
      assigneeId: input.assigneeId,
    }, db);

    const startDate = parseDate(input.startDate, 'startDate');
    const dueDate = parseDate(input.dueDate, 'dueDate');
    if (startDate && dueDate && startDate > dueDate) {
      throw validationError('startDate harus <= dueDate');
    }

    const title = String(input.title || '').trim();
    if (!title) throw validationError('title wajib');
    if (title.length > 255) throw validationError('title maksimal 255 karakter');

    const status = normalizeStatus(input.status, 'open');
    const priority = normalizePriority(input.priority, 'normal');
    let progress = parseProgress(input.progressPercent) ?? 0;
    let completedAt = null;
    let completedBy = null;

    if (DONE_STATUSES.has(status)) {
      progress = 100;
      completedAt = new Date();
      completedBy = user.sub;
    }

    let sourceType = 'manual';
    let sourceId = null;
    if (trustedSource != null) {
      if (!TRUSTED_SOURCE_TYPES.has(trustedSource.type) || trustedSource.id == null) {
        throw validationError('trustedSource tidak valid');
      }
      sourceType = trustedSource.type;
      sourceId = trustedSource.id;
    }

    if (refs.columnId && !FINAL_STATUSES.has(status)) {
      await enforceWipLimit({
        columnId: refs.columnId,
        entityId,
      }, db);
    }

    const [result] = await db.query(
      `INSERT INTO tasks
       (entity_id, department_id, board_id, column_id,
        title, description, status, priority,
        assignee_id, reporter_id,
        start_date, due_date, progress_percent,
        completed_at, completed_by,
        source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId,
        departmentId,
        refs.boardId,
        refs.columnId,
        title,
        input.description == null ? null : String(input.description).slice(0, 10000),
        status,
        priority,
        assigneeId,
        user.sub,
        startDate,
        dueDate,
        progress,
        completedAt,
        completedBy,
        sourceType,
        sourceId,
      ]
    );

    const taskId = result.insertId;

    await watcherSvc.autoAdd({
      taskId,
      entityId,
      userId: user.sub,
      createdBy: user.sub,
    }, db);
    if (assigneeId && Number(assigneeId) !== Number(user.sub)) {
      await watcherSvc.autoAdd({
        taskId,
        entityId,
        userId: assigneeId,
        createdBy: user.sub,
      }, db);
    }

    await taskActivity.record({
      taskId,
      entityId,
      actorUserId: user.sub,
      event: 'task.created',
      metadata: { title, status, assigneeId, sourceType },
    }, db);

    if (ownTransaction) {
      await db.commit();
      await finalizeCreatedTask({ taskId, actorUserId: user.sub });
    }

    return { id: taskId, entityId };
  } catch (error) {
    if (ownTransaction) {
      try { await db.rollback(); } catch { /* noop */ }
    }
    throw error;
  } finally {
    if (ownTransaction) db.release();
  }
}

async function updateTask({ taskId, patch, user }) {
  const conn = await pool.getConnection();
  let task;
  let normalizedPatch;

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM tasks
        WHERE id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [taskId]
    );
    task = rows[0];
    if (!task) {
      const error = new Error('Task tidak ditemukan');
      error.status = 404;
      error.code = 'NOT_FOUND';
      throw error;
    }
    taskAccess.assertTaskAccess({ user, task, action: 'manage' });

    normalizedPatch = { ...patch };
    const entityId = task.entity_id;

    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      const title = String(patch.title || '').trim();
      if (!title) throw validationError('title tidak boleh kosong');
      normalizedPatch.title = title.slice(0, 255);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      normalizedPatch.status = normalizeStatus(patch.status, task.status);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
      normalizedPatch.priority = normalizePriority(patch.priority, task.priority);
    }

    const nextStart = Object.prototype.hasOwnProperty.call(patch, 'startDate')
      ? parseDate(patch.startDate, 'startDate')
      : task.start_date;
    const nextDue = Object.prototype.hasOwnProperty.call(patch, 'dueDate')
      ? parseDate(patch.dueDate, 'dueDate')
      : task.due_date;
    if (nextStart && nextDue && nextStart > nextDue) {
      throw validationError('startDate harus <= dueDate');
    }

    const hasRefChange =
      Object.prototype.hasOwnProperty.call(patch, 'departmentId') ||
      Object.prototype.hasOwnProperty.call(patch, 'boardId') ||
      Object.prototype.hasOwnProperty.call(patch, 'columnId');

    let nextDepartmentId = Object.prototype.hasOwnProperty.call(patch, 'departmentId')
      ? patch.departmentId
      : task.department_id;
    let nextBoardId = Object.prototype.hasOwnProperty.call(patch, 'boardId')
      ? patch.boardId
      : task.board_id;
    let nextColumnId = Object.prototype.hasOwnProperty.call(patch, 'columnId')
      ? patch.columnId
      : task.column_id;

    if (
      Object.prototype.hasOwnProperty.call(patch, 'boardId') &&
      patch.boardId == null &&
      !Object.prototype.hasOwnProperty.call(patch, 'columnId') &&
      task.column_id != null
    ) {
      throw validationError('Untuk melepas board, columnId juga harus di-set null');
    }
    if (nextBoardId == null && nextColumnId != null) {
      throw validationError('columnId tidak boleh ada tanpa boardId');
    }

    if (hasRefChange) {
      nextDepartmentId = await validateDepartment({
        entityId,
        departmentId: nextDepartmentId,
      }, conn);

      const refs = await validateBoardColumn({
        entityId,
        departmentId: nextDepartmentId,
        boardId: nextBoardId,
        columnId: nextColumnId,
      }, conn);

      nextDepartmentId = refs.departmentId;
      nextBoardId = refs.boardId;
      nextColumnId = refs.columnId;

      if (Number(nextDepartmentId ?? 0) !== Number(task.department_id ?? 0)) {
        normalizedPatch.departmentId = nextDepartmentId;
      }
      if (Number(nextBoardId ?? 0) !== Number(task.board_id ?? 0)) {
        normalizedPatch.boardId = nextBoardId;
      }
      if (Number(nextColumnId ?? 0) !== Number(task.column_id ?? 0)) {
        normalizedPatch.columnId = nextColumnId;
      }
    }

    let nextAssigneeId = task.assignee_id;
    if (Object.prototype.hasOwnProperty.call(patch, 'assigneeId')) {
      nextAssigneeId = await validateAssignee({
        entityId,
        assigneeId: patch.assigneeId,
      }, conn);
      normalizedPatch.assigneeId = nextAssigneeId;
    }

    const nextStatus = Object.prototype.hasOwnProperty.call(normalizedPatch, 'status')
      ? normalizedPatch.status
      : task.status;
    const wasDone = DONE_STATUSES.has(task.status);
    const willBeDone = DONE_STATUSES.has(nextStatus);
    const wasFinal = FINAL_STATUSES.has(task.status);
    const willBeFinal = FINAL_STATUSES.has(nextStatus);

    let nextProgress = Object.prototype.hasOwnProperty.call(patch, 'progressPercent')
      ? parseProgress(patch.progressPercent)
      : Number(task.progress_percent || 0);
    let completedAt = task.completed_at;
    let completedBy = task.completed_by;

    if (!wasDone && willBeDone) {
      completedAt = task.completed_at || new Date();
      completedBy = user.sub;
      nextProgress = 100;
      normalizedPatch.progressPercent = 100;
    } else if (wasDone && !willBeDone) {
      completedAt = null;
      completedBy = null;
      if (nextProgress === 100) nextProgress = 0;
      normalizedPatch.progressPercent = nextProgress;
    } else if (willBeDone) {
      nextProgress = 100;
      normalizedPatch.progressPercent = 100;
    } else if (Object.prototype.hasOwnProperty.call(patch, 'progressPercent')) {
      normalizedPatch.progressPercent = nextProgress;
    }

    const columnChanged = Number(nextColumnId ?? 0) !== Number(task.column_id ?? 0);
    const becomesCounted = wasFinal && !willBeFinal;
    if (nextColumnId && !willBeFinal && (columnChanged || becomesCounted)) {
      await enforceWipLimit({
        columnId: nextColumnId,
        entityId,
        ignoreTaskId: taskId,
      }, conn);
    }

    const fieldMap = {
      title: { col: 'title' },
      description: {
        col: 'description',
        normalize: (value) => value == null ? null : String(value).slice(0, 10000),
      },
      status: { col: 'status' },
      priority: { col: 'priority' },
      departmentId: { col: 'department_id' },
      boardId: { col: 'board_id' },
      columnId: { col: 'column_id' },
      assigneeId: { col: 'assignee_id' },
      startDate: {
        col: 'start_date',
        normalize: (value) => value == null ? null : parseDate(value, 'startDate'),
      },
      dueDate: {
        col: 'due_date',
        normalize: (value) => value == null ? null : parseDate(value, 'dueDate'),
      },
      progressPercent: {
        col: 'progress_percent',
        normalize: (value) => parseProgress(value),
      },
      position: { col: 'position' },
    };

    const { sets, args } = buildDynamicUpdate(normalizedPatch, fieldMap);

    if (completedAt !== task.completed_at) {
      sets.push('completed_at = ?');
      args.push(completedAt);
    }
    if (Number(completedBy ?? 0) !== Number(task.completed_by ?? 0)) {
      sets.push('completed_by = ?');
      args.push(completedBy);
    }

    if (!sets.length) {
      await conn.rollback();
      return { id: taskId, unchanged: true };
    }

    args.push(taskId);
    await conn.query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id=?`,
      args
    );

    const assigneeChanged =
      Number(nextAssigneeId ?? 0) !== Number(task.assignee_id ?? 0);
    const statusChanged = nextStatus !== task.status;

    if (columnChanged) {
      await taskActivity.record({
        taskId,
        entityId,
        actorUserId: user.sub,
        event: 'task.moved',
        metadata: { fromColumnId: task.column_id, toColumnId: nextColumnId },
      }, conn);
    }

    if (statusChanged) {
      await taskActivity.record({
        taskId,
        entityId,
        actorUserId: user.sub,
        event: 'task.status_changed',
        metadata: { from: task.status, to: nextStatus },
      }, conn);

      if (!wasDone && willBeDone) {
        await taskActivity.record({
          taskId,
          entityId,
          actorUserId: user.sub,
          event: 'task.completed',
        }, conn);
      } else if (wasDone && !willBeDone) {
        await taskActivity.record({
          taskId,
          entityId,
          actorUserId: user.sub,
          event: 'task.reopened',
        }, conn);
      }
    }

    if (assigneeChanged) {
      const event = nextAssigneeId == null
        ? 'task.unassigned'
        : task.assignee_id == null
          ? 'task.assigned'
          : 'task.reassigned';
      await taskActivity.record({
        taskId,
        entityId,
        actorUserId: user.sub,
        event,
        metadata: { from: task.assignee_id, to: nextAssigneeId },
      }, conn);
      if (nextAssigneeId != null) {
        await watcherSvc.autoAdd({
          taskId,
          entityId,
          userId: nextAssigneeId,
          createdBy: user.sub,
        }, conn);
      }
    }

    const specialKeys = new Set(['status', 'assigneeId', 'columnId']);
    const genericFields = Object.keys(normalizedPatch).filter((key) => !specialKeys.has(key));
    if (genericFields.length) {
      await taskActivity.record({
        taskId,
        entityId,
        actorUserId: user.sub,
        event: 'task.updated',
        metadata: { fields: genericFields },
      }, conn);
    }

    await conn.commit();

    try {
      await activityLog({
        entityId,
        userId: user.sub,
        action: 'task.update',
        subjectType: 'task',
        subjectId: taskId,
        metadata: { fields: Object.keys(normalizedPatch) },
      });
    } catch { /* committed work remains valid */ }

    const [freshRows] = await pool.query(
      `SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL LIMIT 1`,
      [taskId]
    );
    const fresh = freshRows[0];

    if (fresh && assigneeChanged && fresh.assignee_id) {
      try {
        await notifSvc.notifyTaskUsers({
          task: fresh,
          actorUserId: user.sub,
          event: task.assignee_id ? 'task.reassigned' : 'task.assigned',
          title: task.assignee_id ? 'Task dialihkan kepada Anda' : 'Anda ditugaskan ke task',
          body: fresh.title,
          includeWatchers: false,
        });
      } catch { /* notification is best effort */ }
    }

    if (fresh && statusChanged) {
      try {
        if (!wasDone && willBeDone) {
          await notifSvc.notifyTaskUsers({
            task: fresh,
            actorUserId: user.sub,
            event: 'task.completed',
            title: 'Task selesai',
            body: fresh.title,
          });
        } else if (wasDone && !willBeDone) {
          await notifSvc.notifyTaskUsers({
            task: fresh,
            actorUserId: user.sub,
            event: 'task.reopened',
            title: 'Task dibuka kembali',
            body: fresh.title,
          });
        }
      } catch { /* notification is best effort */ }
    }

    return { id: taskId };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteTask({ taskId, user }) {
  const conn = await pool.getConnection();
  let task;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM tasks
        WHERE id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [taskId]
    );
    task = rows[0];
    if (!task) {
      const error = new Error('Task tidak ditemukan');
      error.status = 404;
      error.code = 'NOT_FOUND';
      throw error;
    }
    taskAccess.assertTaskAccess({ user, task, action: 'manage' });

    await taskActivity.record({
      taskId,
      entityId: task.entity_id,
      actorUserId: user.sub,
      event: 'task.deleted',
    }, conn);
    await conn.query(
      `UPDATE tasks SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`,
      [taskId]
    );
    await conn.commit();

    try {
      await activityLog({
        entityId: task.entity_id,
        userId: user.sub,
        action: 'task.delete',
        subjectType: 'task',
        subjectId: taskId,
      });
    } catch { /* committed work remains valid */ }

    return { id: taskId };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

/* ============================================================
   Detail (normalized, no SELECT * leak)
   ============================================================ */

async function getTaskDetail({ taskId, user }) {
  const task = await taskAccess.loadTask(taskId);
  if (!task) { const e = new Error('Task tidak ditemukan'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
  taskAccess.assertTaskAccess({ user, task, action: 'view' });

  const [meta] = await pool.query(
    `SELECT t.id, t.entity_id AS entityId, t.department_id AS departmentId,
            t.board_id AS boardId, t.column_id AS columnId,
            t.title, t.description, t.status, t.priority,
            t.assignee_id AS assigneeId, ua.name AS assigneeName,
            t.reporter_id AS reporterId, ur.name AS reporterName,
            t.start_date AS startDate, t.due_date AS dueDate,
            t.progress_percent AS progressPercent,
            t.completed_at AS completedAt,
            t.completed_by AS completedBy, uc.name AS completedByName,
            t.source_type AS sourceType, t.source_id AS sourceId,
            t.position,
            t.created_at AS createdAt, t.updated_at AS updatedAt
       FROM tasks t
       LEFT JOIN users ua ON ua.id = t.assignee_id
       LEFT JOIN users ur ON ur.id = t.reporter_id
       LEFT JOIN users uc ON uc.id = t.completed_by
      WHERE t.id = ?`,
    [taskId]
  );
  const detail = meta[0];

  const [comments] = await pool.query(
    `SELECT c.id, c.body, c.user_id AS userId, u.name AS userName, c.created_at AS createdAt
       FROM task_comments c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ?
      ORDER BY c.id ASC`,
    [taskId]
  );

  const [attachments] = await pool.query(
    `SELECT id, drive_file_id AS driveFileId, name, mime_type AS mimeType,
            web_view_link AS webViewLink, created_at AS createdAt
       FROM task_attachments
      WHERE task_id = ?
      ORDER BY id DESC`,
    [taskId]
  );

  const [watchers] = await pool.query(
    `SELECT w.user_id AS userId, u.name AS userName
       FROM task_watchers w
       JOIN users u ON u.id = w.user_id
      WHERE w.task_id = ?`,
    [taskId]
  );

  const checklistSvc = require('./taskChecklist.service');
  const checklist = await checklistSvc.list({ task, user });

  const dependencySvc = require('./taskDependency.service');
  const dependencies = await dependencySvc.list({ task, user });

  return {
    ...detail,
    comments,
    attachments,
    watchers,
    checklist,
    dependencies,
  };
}


/* ============================================================
   List by board
   ============================================================ */

async function listTasksByBoard({ boardId, user, filters = {} }) {
  const board = await taskAccess.loadBoard(boardId);
  if (!board) { const e = new Error('Board tidak ditemukan'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
  taskAccess.assertBoardAccess({ user, board, action: 'view' });

  const where = ['t.deleted_at IS NULL', 't.board_id = ?'];
  const args = [boardId];
  if (filters.assigneeId) { where.push('t.assignee_id = ?'); args.push(filters.assigneeId); }
  if (filters.priority) { where.push('t.priority = ?'); args.push(filters.priority); }
  if (filters.status) { where.push('t.status = ?'); args.push(filters.status); }

  const [rows] = await pool.query(
    `SELECT t.id, t.board_id AS boardId, t.column_id AS columnId,
            t.title, t.description, t.status, t.priority,
            t.assignee_id AS assigneeId, u.name AS assigneeName,
            t.reporter_id AS reporterId,
            t.start_date AS startDate, t.due_date AS dueDate,
            t.progress_percent AS progressPercent,
            t.position, t.completed_at AS completedAt,
            t.created_at AS createdAt
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.column_id ASC, t.position ASC, t.id ASC`,
    args
  );
  return rows;
}


async function addComment({ taskId, user, body }) {
  const task = await taskAccess.loadTask(taskId);
  if (!task) {
    const error = new Error('Task tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  taskAccess.assertTaskAccess({ user, task, action: 'view' });

  const clean = String(body || '').trim();
  if (!clean) throw validationError('body wajib');
  if (clean.length > 5000) throw validationError('body maksimal 5000 karakter');

  const conn = await pool.getConnection();
  let commentId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO task_comments (task_id, user_id, body)
       VALUES (?, ?, ?)`,
      [taskId, user.sub, clean]
    );
    commentId = result.insertId;

    await taskActivity.record({
      taskId,
      entityId: task.entity_id,
      actorUserId: user.sub,
      event: 'task.comment_added',
      metadata: { commentId, length: clean.length },
    }, conn);

    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }

  try {
    await activityLog({
      entityId: task.entity_id,
      userId: user.sub,
      action: 'task.comment',
      subjectType: 'task',
      subjectId: taskId,
      metadata: { commentId },
    });
  } catch { /* committed comment remains valid */ }

  try {
    await notifSvc.notifyTaskUsers({
      task,
      actorUserId: user.sub,
      event: 'task.comment',
      title: 'Komentar baru pada task',
      body: clean.slice(0, 200),
    });
  } catch { /* notification is best effort */ }

  return { id: commentId };
}

module.exports = {
  createTask,
  finalizeCreatedTask,
  updateTask,
  deleteTask,
  getTaskDetail,
  listTasksByBoard,
  addComment,
  enforceWipLimit,
  buildDynamicUpdate,
  DONE_STATUSES,
  FINAL_STATUSES,
};
