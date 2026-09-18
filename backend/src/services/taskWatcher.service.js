const pool = require('../db/pool');
const { assertTaskAccess, hasPerm } = require('./taskAccess.service');
const activity = require('./taskActivity.service');

async function list({ task, user }) {
  assertTaskAccess({ user, task, action: 'view' });
  const [rows] = await pool.query(
    `SELECT w.user_id AS userId, u.name AS userName, u.email AS userEmail,
            w.created_by AS createdBy, w.created_at AS createdAt
       FROM task_watchers w
       JOIN users u ON u.id = w.user_id
      WHERE w.task_id = ?
      ORDER BY w.created_at ASC`,
    [task.id]
  );
  return rows;
}

async function add({ task, user, targetUserId, conn = pool }) {
  assertTaskAccess({ user, task, action: 'manage' });

  const isSelf = Number(targetUserId) === Number(user.sub);
  if (!isSelf && !hasPerm(user, 'task.watch.manage')) {
    const e = new Error('Butuh permission task.watch.manage untuk menambah watcher lain');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }
  if (isSelf && !hasPerm(user, 'task.watch')) {
    const e = new Error('Butuh permission task.watch');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }

  // Validate user belongs to task entity
  const [urows] = await conn.query(
    `SELECT id FROM users
      WHERE id = ? AND entity_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [targetUserId, task.entity_id]
  );
  if (!urows[0]) {
    const e = new Error('User tidak valid untuk entity task ini');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }

  const [r] = await conn.query(
    `INSERT IGNORE INTO task_watchers (task_id, user_id, created_by)
     VALUES (?, ?, ?)`,
    [task.id, targetUserId, user.sub]
  );

  if (r.affectedRows > 0) {
    await activity.record({
      taskId: task.id, entityId: task.entity_id,
      actorUserId: user.sub, event: 'task.watcher_added',
      metadata: { watcherUserId: Number(targetUserId) },
    }, conn);
  }
  return { taskId: task.id, userId: Number(targetUserId), added: r.affectedRows > 0 };
}

async function remove({ task, user, targetUserId, conn = pool }) {
  assertTaskAccess({ user, task, action: 'manage' });

  const isSelf = Number(targetUserId) === Number(user.sub);
  if (!isSelf && !hasPerm(user, 'task.watch.manage')) {
    const e = new Error('Butuh permission task.watch.manage');
    e.status = 403; e.code = 'FORBIDDEN'; throw e;
  }

  const [r] = await conn.query(
    `DELETE FROM task_watchers WHERE task_id = ? AND user_id = ?`,
    [task.id, targetUserId]
  );

  if (r.affectedRows > 0) {
    await activity.record({
      taskId: task.id, entityId: task.entity_id,
      actorUserId: user.sub, event: 'task.watcher_removed',
      metadata: { watcherUserId: Number(targetUserId) },
    }, conn);
  }
  return { taskId: task.id, userId: Number(targetUserId), removed: r.affectedRows > 0 };
}

/**
 * Internal: add a watcher without permission checks.
 * Used for auto-adding reporter / assignee.
 */
async function autoAdd({ taskId, entityId, userId, createdBy = null }, conn = pool) {
  if (!userId) return;
  const [urows] = await conn.query(
    `SELECT id FROM users
      WHERE id = ? AND entity_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
    [userId, entityId]
  );
  if (!urows[0]) return;
  await conn.query(
    `INSERT IGNORE INTO task_watchers (task_id, user_id, created_by)
     VALUES (?, ?, ?)`,
    [taskId, userId, createdBy]
  );
}

module.exports = { list, add, remove, autoAdd };