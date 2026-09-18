require('dotenv').config();
const pool = require('../db/pool');
const notif = require('../services/notification.service');
const logger = require('../utils/logger');

/**
 * Cron harian: notifikasi ke assignee untuk task yang overdue > 3 hari.
 *  0 8 * * * /usr/local/bin/node /path/to/jobs/overdueTaskScan.js
 */
(async () => {
  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.entity_id AS entityId, t.title, t.assignee_id AS assigneeId,
              t.due_date AS dueDate, DATEDIFF(CURDATE(), t.due_date) AS daysOverdue
         FROM tasks t
        WHERE t.deleted_at IS NULL
          AND t.assignee_id IS NOT NULL
          AND t.due_date < CURDATE()
          AND t.status NOT IN ('done','closed','cancelled')
          AND DATEDIFF(CURDATE(), t.due_date) >= 3`
    );
    let created = 0;
    for (const t of rows) {
      await notif.create({
        userId: t.assigneeId, entityId: t.entityId,
        title: `Task overdue ${t.daysOverdue} hari`,
        body: t.title,
        event: 'task.overdue',
        subjectType: 'task', subjectId: t.id,
        actionUrl: `/tasks/${t.id}`,
      });
      created++;
    }
    logger.info({ created }, '[overdueTaskScan] done');
    console.log(`[overdueTaskScan] ${created} notifikasi dibuat`);
  } catch (e) {
    logger.error({ err: e.message }, '[overdueTaskScan] failed');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
