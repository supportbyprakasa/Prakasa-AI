const pool = require('../db/pool');
const { spansDivisions, sameDivision } = require('./divisionAccess');

/**
 * Centralized access policy for boards and tasks.
 * No controller should perform ad-hoc entity checks.
 */

function hasPerm(user, code) {
  if (!user) return false;
  return (user.permissions || []).includes(code);
}

function sameEntity(user, row) {
  if (!user || !row) return false;
  return Number(row.entity_id) === Number(user.entityId);
}

/* ============================================================
   Loaders
   ============================================================ */

async function loadBoard(boardId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [boardId]
  );
  return rows[0] || null;
}

async function loadTask(taskId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

/* ============================================================
   Resolve target entity for a write operation
   ============================================================ */

function resolveTargetEntity({ user, requestedEntityId }) {
  const userEntityId = user?.entityId || null;
  const cross = hasPerm(user, 'entity.cross_access');

  if (requestedEntityId != null) {
    const num = Number(requestedEntityId);
    if (!Number.isInteger(num) || num <= 0) {
      const e = new Error('entityId tidak valid');
      e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
    }
    if (userEntityId != null && num === Number(userEntityId)) return num;
    if (!cross) {
      const e = new Error('Tidak punya akses ke entity ini');
      e.status = 403; e.code = 'FORBIDDEN'; throw e;
    }
    return num;
  }

  if (!userEntityId) {
    const e = new Error('entityId wajib');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  return userEntityId;
}

/* ============================================================
   Division visibility (see divisionAccess.js)
   ============================================================ */

function notFound(message) {
  const e = new Error(message);
  e.status = 404; e.code = 'NOT_FOUND';
  return e;
}

function entityAllowed(user, row) {
  return sameEntity(user, row) || hasPerm(user, 'entity.cross_access');
}

/**
 * Board rule: same entity AND (spans divisions OR board of the user's division
 * / company-wide OR the user created the board). There is no board_members
 * table, so created_by is the only per-user membership signal.
 */
function canViewBoard(user, board) {
  if (!user || !board) return false;
  if (!entityAllowed(user, board)) return false;
  if (spansDivisions(user) || sameDivision(user, board.department_id)) return true;
  return board.created_by != null && Number(board.created_by) === Number(user.sub);
}

/**
 * Task rule: same entity AND (spans divisions OR task of the user's division /
 * company-wide OR the user is reporter, assignee or watcher OR the task's board
 * is visible per canViewBoard).
 */
async function canViewTask(user, task, conn = pool) {
  if (!user || !task) return false;
  if (!entityAllowed(user, task)) return false;
  if (spansDivisions(user) || sameDivision(user, task.department_id)) return true;
  const uid = Number(user.sub);
  if (task.reporter_id != null && Number(task.reporter_id) === uid) return true;
  if (task.assignee_id != null && Number(task.assignee_id) === uid) return true;
  if (task.board_id != null) {
    const board = await loadBoard(task.board_id, conn);
    if (board && canViewBoard(user, board)) return true;
  }
  const [watch] = await conn.query(
    'SELECT 1 AS ok FROM task_watchers WHERE task_id = ? AND user_id = ? LIMIT 1',
    [task.id, uid]
  );
  return Boolean(watch && watch[0]);
}

/**
 * SQL predicate mirroring canViewBoard's division part for a boards alias.
 * The caller still filters the entity.
 */
function boardDivisionSql(user, alias = 'b') {
  if (spansDivisions(user)) return { sql: '1=1', args: [] };
  const dept = user?.departmentId == null ? null : Number(user.departmentId);
  return {
    sql: `(${alias}.department_id IS NULL OR ${alias}.department_id = ? OR ${alias}.created_by = ?)`,
    args: [dept, Number(user?.sub) || 0],
  };
}

/**
 * SQL predicate mirroring canViewTask's division part for a tasks alias.
 * The caller still filters the entity.
 */
function taskDivisionSql(user, alias = 't') {
  if (spansDivisions(user)) return { sql: '1=1', args: [] };
  const dept = user?.departmentId == null ? null : Number(user.departmentId);
  const uid = Number(user?.sub) || 0;
  return {
    sql: `(${alias}.department_id IS NULL OR ${alias}.department_id = ?
           OR ${alias}.reporter_id = ? OR ${alias}.assignee_id = ?
           OR EXISTS (SELECT 1 FROM task_watchers tw_acl
                       WHERE tw_acl.task_id = ${alias}.id AND tw_acl.user_id = ?)
           OR EXISTS (SELECT 1 FROM boards b_acl
                       WHERE b_acl.id = ${alias}.board_id AND b_acl.deleted_at IS NULL
                         AND (b_acl.department_id IS NULL OR b_acl.department_id = ? OR b_acl.created_by = ?)))`,
    args: [dept, uid, uid, uid, dept, uid],
  };
}

/* ============================================================
   Assert helpers
   ============================================================ */

function assertBoardAccess({ user, board, action }) {
  if (!board) throw notFound('Board tidak ditemukan');
  // Cross-division boards answer 404 so ids cannot be probed.
  if (!canViewBoard(user, board)) throw notFound('Board tidak ditemukan');
  // Action-specific permissions are enforced by route-level requirePermission.
  if (action === 'manage' && !hasPerm(user, 'board.manage')) {
    const e = new Error('Butuh permission board.manage');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }
}

/**
 * Async: the watcher / board checks may need the database. Every caller MUST
 * await it — an un-awaited call would silently skip the check.
 */
async function assertTaskAccess({ user, task, action, conn = pool }) {
  if (!task) throw notFound('Task tidak ditemukan');
  if (!(await canViewTask(user, task, conn))) throw notFound('Task tidak ditemukan');
  // Writes are additionally gated by route permissions.
}

module.exports = {
  loadBoard,
  loadTask,
  resolveTargetEntity,
  assertBoardAccess,
  assertTaskAccess,
  canViewBoard,
  canViewTask,
  boardDivisionSql,
  taskDivisionSql,
  sameEntity,
  hasPerm,
};