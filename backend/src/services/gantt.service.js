const pool = require('../db/pool');
const taskAccess = require('./taskAccess.service');

function appError(message, status = 400, code = 'VALIDATION_ERROR') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function isoDateOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDate(value, name) {
  if (value == null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw appError(`${name} tidak valid`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw appError(`${name} tidak valid`);
  }
  return s;
}

function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86400000);
}

async function resolveScope({ user, requestedEntityId, departmentId }) {
  const entityId = taskAccess.resolveTargetEntity({
    user,
    requestedEntityId: requestedEntityId == null || requestedEntityId === ''
      ? null
      : requestedEntityId,
  });

  if (departmentId == null || departmentId === '') {
    return { entityId: Number(entityId), departmentId: null };
  }

  const depId = Number(departmentId);
  if (!Number.isInteger(depId) || depId <= 0) {
    throw appError('departmentId tidak valid');
  }

  const [rows] = await pool.query(
    `SELECT id
       FROM departments
      WHERE id=? AND entity_id=? AND deleted_at IS NULL
      LIMIT 1`,
    [depId, entityId]
  );
  if (!rows[0]) {
    throw appError('Department tidak ditemukan pada entity ini', 404, 'NOT_FOUND');
  }

  return { entityId: Number(entityId), departmentId: depId };
}

async function getGantt({
  user,
  from,
  to,
  entityId: requestedEntityId,
  departmentId,
  limit = 500,
}) {
  if (!(user?.permissions || []).includes('timeline.view') ||
      !(user?.permissions || []).includes('task.view')) {
    throw appError('Tidak punya akses timeline task', 403, 'FORBIDDEN');
  }

  const fromDate = parseDate(from, 'from') || isoDateOffset(-30);
  const toDate = parseDate(to, 'to') || isoDateOffset(90);
  if (fromDate > toDate) {
    throw appError('from harus <= to');
  }
  if (daysBetween(fromDate, toDate) > 730) {
    throw appError('Rentang timeline maksimal 730 hari');
  }

  const scope = await resolveScope({
    user,
    requestedEntityId,
    departmentId,
  });

  const requestedLimit = Number(limit);
  const safeLimit = Number.isInteger(requestedLimit)
    ? Math.min(500, Math.max(1, requestedLimit))
    : 500;
  const fetchLimit = safeLimit + 1;

  const where = [
    't.entity_id = ?',
    't.deleted_at IS NULL',
    'COALESCE(t.start_date, t.due_date, DATE(t.created_at)) <= ?',
    'COALESCE(t.due_date, t.start_date, DATE(t.created_at)) >= ?',
  ];
  const args = [scope.entityId, toDate, fromDate];

  if (scope.departmentId) {
    where.push('t.department_id = ?');
    args.push(scope.departmentId);
  }

  const [rawRows] = await pool.query(
    `SELECT t.id,
            t.entity_id AS entityId,
            t.department_id AS departmentId,
            t.board_id AS boardId,
            t.column_id AS columnId,
            t.title,
            t.status,
            t.priority,
            t.assignee_id AS assigneeId,
            u.name AS assigneeName,
            DATE_FORMAT(t.start_date, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(t.due_date, '%Y-%m-%d') AS dueDate,
            DATE_FORMAT(COALESCE(t.start_date, t.due_date, DATE(t.created_at)), '%Y-%m-%d') AS effectiveStartDate,
            DATE_FORMAT(COALESCE(t.due_date, t.start_date, DATE(t.created_at)), '%Y-%m-%d') AS effectiveDueDate,
            t.progress_percent AS progressPercent,
            DATE_FORMAT(t.created_at, '%Y-%m-%d') AS createdDate
       FROM tasks t
       LEFT JOIN users u ON u.id=t.assignee_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(t.start_date, t.due_date, DATE(t.created_at)) ASC,
               COALESCE(t.due_date, t.start_date, DATE(t.created_at)) ASC,
               t.id ASC
      LIMIT ?`,
    [...args, fetchLimit]
  );

  const truncated = rawRows.length > safeLimit;
  const rows = rawRows.slice(0, safeLimit);
  const ids = rows.map((row) => Number(row.id));

  let links = [];
  if (ids.length) {
    const [edgeRows] = await pool.query(
      `SELECT d.id,
              d.predecessor_task_id AS predecessorTaskId,
              d.successor_task_id AS successorTaskId,
              d.dependency_type AS type
         FROM task_dependencies d
        WHERE d.predecessor_task_id IN (?)
          AND d.successor_task_id IN (?)
        ORDER BY d.id ASC`,
      [ids, ids]
    );
    links = edgeRows.map((row) => ({
      id: Number(row.id),
      from: Number(row.predecessorTaskId),
      to: Number(row.successorTaskId),
      type: row.type,
    }));
  }

  const blockedBy = new Map();
  for (const link of links) {
    if (link.type !== 'blocks') continue;
    if (!blockedBy.has(link.to)) blockedBy.set(link.to, []);
    blockedBy.get(link.to).push(link.from);
  }

  const tasks = rows.map((row) => ({
    id: Number(row.id),
    entityId: Number(row.entityId),
    departmentId: row.departmentId == null ? null : Number(row.departmentId),
    boardId: row.boardId == null ? null : Number(row.boardId),
    columnId: row.columnId == null ? null : Number(row.columnId),
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId == null ? null : Number(row.assigneeId),
    assigneeName: row.assigneeName || null,
    startDate: row.startDate || null,
    dueDate: row.dueDate || null,
    effectiveStartDate: row.effectiveStartDate,
    effectiveDueDate: row.effectiveDueDate,
    progress: Number(row.progressPercent || 0),
    dependencyIds: blockedBy.get(Number(row.id)) || [],
  }));

  return {
    from: fromDate,
    to: toDate,
    entityId: scope.entityId,
    departmentId: scope.departmentId,
    tasks,
    links,
    meta: {
      taskCount: tasks.length,
      linkCount: links.length,
      limit: safeLimit,
      truncated,
    },
  };
}

module.exports = {
  getGantt,
  resolveScope,
  parseDate,
};
