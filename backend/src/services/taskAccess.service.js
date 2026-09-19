const pool = require('../db/pool');

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
   Assert helpers
   ============================================================ */

function assertBoardAccess({ user, board, action }) {
  if (!board) {
    const e = new Error('Board tidak ditemukan');
    e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  const cross = hasPerm(user, 'entity.cross_access');
  if (!sameEntity(user, board) && !cross) {
    const e = new Error('Board tidak ditemukan');
    e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  // Action-specific permissions are enforced by route-level requirePermission.
  // Here we only enforce entity boundary + row existence.
  if (action === 'manage' && !hasPerm(user, 'board.manage')) {
    const e = new Error('Butuh permission board.manage');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }
}

function assertTaskAccess({ user, task, action }) {
  if (!task) {
    const e = new Error('Task tidak ditemukan');
    e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  const cross = hasPerm(user, 'entity.cross_access');
  if (!sameEntity(user, task) && !cross) {
    const e = new Error('Task tidak ditemukan');
    e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  // Read is always allowed for entity members; writes gated by route permissions.
}

module.exports = {
  loadBoard,
  loadTask,
  resolveTargetEntity,
  assertBoardAccess,
  assertTaskAccess,
  sameEntity,
  hasPerm,
};