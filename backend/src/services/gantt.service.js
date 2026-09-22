const pool = require('../db/pool');
const taskAccess = require('./taskAccess.service');

const MAX_TASKS = 500;
const MAX_RANGE_DAYS = 365;
const DEFAULT_RANGE_DAYS_BACK = 90;
const DEFAULT_RANGE_DAYS_AHEAD = 90;
const FALLBACK_DUE_OFFSET_DAYS = 7;

function appError(message, status = 400, code = 'VALIDATION_ERROR') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

function parseIsoDate(value, field) {
  if (value == null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw appError(`${field} harus format YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw appError(`${field} tidak valid`);
  }
  return s;
}

function defaultRange() {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - DEFAULT_RANGE_DAYS_BACK);
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + DEFAULT_RANGE_DAYS_AHEAD);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Gantt contract:
 * {
 *   tasks: [{
 *     id, title, startDate, dueDate, progressPercent, status, priority,
 *     assigneeId, assigneeName, boardId, columnId, departmentId,
 *     isFallbackStart, isFallbackDue, isCancelled
 *   }],
 *   links: [{ id, fromTaskId, toTaskId, type }],
 *   meta: { entityId, from, to, taskCount, linkCount, truncated }
 * }
 */
async function buildGantt({
  user,
  entityId,
  departmentId = null,
  boardId = null,
  from = null,
  to = null,
}) {
  const resolvedEntity = taskAccess.resolveTargetEntity({
    user,
    requestedEntityId: entityId,
  });

  const range = defaultRange();
  const fromDate = from ? parseIsoDate(from, 'from') : range.from;
  const toDate = to ? parseIsoDate(to, 'to') : range.to;

  if (fromDate > toDate) {
    throw appError('from harus <= to');
  }
  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS) {
    throw appError(`Rentang maksimal ${MAX_RANGE_DAYS} hari`);
  }

  const where = [
    't.deleted_at IS NULL',
    't.entity_id = ?',
    `(
      (
        t.start_date IS NULL
        AND t.due_date IS NULL
        AND DATE(t.created_at) BETWEEN ? AND ?
      )
      OR (
        (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)
        AND COALESCE(t.start_date, DATE(t.created_at)) <= ?
        AND COALESCE(
          t.due_date,
          DATE_ADD(COALESCE(t.start_date, DATE(t.created_at)), INTERVAL 7 DAY)
        ) >= ?
      )
    )`,
  ];
  const args = [
    resolvedEntity,
    fromDate, toDate,
    toDate, fromDate,
  ];

  if (departmentId) {
    where.push('t.department_id = ?');
    args.push(Number(departmentId));
  }
  if (boardId) {
    where.push('t.board_id = ?');
    args.push(Number(boardId));
  }

  const [rows] = await pool.query(
    `SELECT t.id, t.title,
            t.start_date AS startDate,
            t.due_date AS dueDate,
            t.progress_percent AS progressPercent,
            t.status, t.priority,
            t.assignee_id AS assigneeId,
            u.name AS assigneeName,
            t.board_id AS boardId,
            t.column_id AS columnId,
            t.department_id AS departmentId,
            t.created_at AS createdAt
       FROM tasks t
       LEFT JOIN users u ON u.id=t.assignee_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(t.start_date, t.due_date, DATE(t.created_at)) ASC, t.id ASC
      LIMIT ?`,
    [...args, MAX_TASKS + 1]
  );

  const truncated = rows.length > MAX_TASKS;
  const capped = truncated ? rows.slice(0, MAX_TASKS) : rows;

  const tasks = [];
  const taskIdSet = new Set();

  for (const row of capped) {
    const originalStart = toIsoDate(row.startDate);
    const originalDue = toIsoDate(row.dueDate);
    const createdAt = toIsoDate(row.createdAt);

    let startDate = originalStart;
    let dueDate = originalDue;
    let isFallbackStart = false;
    let isFallbackDue = false;

    if (!startDate) {
      if (!createdAt) continue;
      startDate = createdAt;
      isFallbackStart = true;
    }
    if (!dueDate) {
      dueDate = addDays(startDate, FALLBACK_DUE_OFFSET_DAYS);
      isFallbackDue = true;
    }

    // Protect Part 2 from malformed legacy scheduling data.
    if (startDate > dueDate) {
      [startDate, dueDate] = [dueDate, startDate];
      isFallbackStart = true;
      isFallbackDue = true;
    }

    tasks.push({
      id: Number(row.id),
      title: row.title,
      startDate,
      dueDate,
      progressPercent: Number(row.progressPercent) || 0,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assigneeId == null ? null : Number(row.assigneeId),
      assigneeName: row.assigneeName || null,
      boardId: row.boardId == null ? null : Number(row.boardId),
      columnId: row.columnId == null ? null : Number(row.columnId),
      departmentId: row.departmentId == null ? null : Number(row.departmentId),
      isFallbackStart,
      isFallbackDue,
      isCancelled: row.status === 'cancelled',
    });
    taskIdSet.add(Number(row.id));
  }

  let links = [];
  if (taskIdSet.size > 1) {
    const ids = [...taskIdSet];
    const [linkRows] = await pool.query(
      `SELECT id,
              predecessor_task_id AS fromTaskId,
              successor_task_id AS toTaskId,
              dependency_type AS type
         FROM task_dependencies
        WHERE predecessor_task_id IN (?)
          AND successor_task_id IN (?)
        ORDER BY id ASC`,
      [ids, ids]
    );

    links = linkRows.map((row) => ({
      id: Number(row.id),
      fromTaskId: Number(row.fromTaskId),
      toTaskId: Number(row.toTaskId),
      type: row.type,
    }));
  }

  return {
    tasks,
    links,
    meta: {
      entityId: Number(resolvedEntity),
      from: fromDate,
      to: toDate,
      taskCount: tasks.length,
      linkCount: links.length,
      truncated,
    },
  };
}

module.exports = {
  buildGantt,
  MAX_TASKS,
  MAX_RANGE_DAYS,
  FALLBACK_DUE_OFFSET_DAYS,
};
