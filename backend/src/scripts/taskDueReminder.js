require('dotenv').config();
const pool = require('../db/pool');
const taskNotification = require('../services/taskNotification.service');
const logger = require('../utils/logger');

async function notifyRows(rows, event, title, dateKey) {
  let tasks = 0;
  let notifications = 0;

  for (const task of rows) {
    try {
      const result = await taskNotification.notifyTaskUsers({
        task,
        actorUserId: null,
        event,
        title,
        body: task.title,
        actionUrl: `/tasks/${task.id}`,
        dedupeKey: `task:${task.id}:${event === 'task.due_soon' ? 'due-soon' : 'overdue'}:${dateKey}`,
      });
      tasks += 1;
      notifications += result.sent;
    } catch (error) {
      logger.error(
        { taskId: task.id, err: error.message },
        '[taskDueReminder] notification failed'
      );
    }
  }

  return { tasks, notifications };
}

async function runOnce() {
  const [[dates]] = await pool.query(
    `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today,
            DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d') AS tomorrow`
  );

  const [dueSoonRows] = await pool.query(
    `SELECT t.*
       FROM tasks t
      WHERE t.deleted_at IS NULL
        AND t.due_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND t.status NOT IN ('done','closed','completed','cancelled')`
  );

  const [overdueRows] = await pool.query(
    `SELECT t.*
       FROM tasks t
      WHERE t.deleted_at IS NULL
        AND t.due_date < CURDATE()
        AND t.status NOT IN ('done','closed','completed','cancelled')`
  );

  const dueSoon = await notifyRows(
    dueSoonRows,
    'task.due_soon',
    'Task jatuh tempo besok',
    dates.tomorrow
  );
  const overdue = await notifyRows(
    overdueRows,
    'task.overdue',
    'Task sudah lewat jatuh tempo',
    dates.today
  );

  return {
    dueSoonTasks: dueSoon.tasks,
    dueSoonNotifications: dueSoon.notifications,
    overdueTasks: overdue.tasks,
    overdueNotifications: overdue.notifications,
  };
}

if (require.main === module) {
  (async () => {
    try {
      const result = await runOnce();
      console.log(
        `[taskDueReminder] dueSoonTasks=${result.dueSoonTasks} dueSoonNotifications=${result.dueSoonNotifications} overdueTasks=${result.overdueTasks} overdueNotifications=${result.overdueNotifications}`
      );
      logger.info({ result }, '[taskDueReminder] done');
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { runOnce };
