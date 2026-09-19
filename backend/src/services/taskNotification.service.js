const pool = require('../db/pool');
const notif = require('./notification.service');

/**
 * Fan out a task event notification to relevant users.
 * Never notifies the actor by default.
 */
async function notifyTaskUsers({
  task,
  actorUserId = null,
  event,
  title,
  body,
  actionUrl = null,
  includeReporter = true,
  includeAssignee = true,
  includeWatchers = true,
  dedupeKey = null,
}) {
  if (!task || !event) return { sent: 0 };

  const userIds = new Set();

  if (includeReporter && task.reporter_id) userIds.add(Number(task.reporter_id));
  if (includeAssignee && task.assignee_id) userIds.add(Number(task.assignee_id));

  if (includeWatchers) {
    const [watchers] = await pool.query(
      `SELECT user_id FROM task_watchers WHERE task_id = ?`, [task.id]
    );
    for (const w of watchers) userIds.add(Number(w.user_id));
  }

  // Never notify the actor
  if (actorUserId != null) userIds.delete(Number(actorUserId));

  if (!userIds.size) return { sent: 0 };

  const sent = await notif.notifyUsers({
    userIds: Array.from(userIds),
    entityId: task.entity_id,
    title: title || `Task #${task.id}`,
    body: body || null,
    event,
    subjectType: 'task',
    subjectId: task.id,
    actionUrl: actionUrl || `/tasks/${task.id}`,
    dedupeKey,
  });

  return { sent: sent.length };
}

module.exports = { notifyTaskUsers };