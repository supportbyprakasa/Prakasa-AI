require('dotenv').config();
const pool = require('../db/pool');
const { runModule } = require('../services/ai/provider');
const logger = require('../utils/logger');

/**
 * Cron harian pagi: generate daily brief untuk semua entity.
 *  0 6 * * * /usr/local/bin/node /path/to/jobs/briefGenerator.js
 */
(async () => {
  try {
    const [entities] = await pool.query(
      `SELECT id, name FROM entities WHERE deleted_at IS NULL`
    );
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;

    for (const e of entities) {
      const [[tasks]] = await pool.query(
        `SELECT
          SUM(status='done' AND DATE(completed_at)=?) AS doneToday,
          SUM(due_date=? AND status NOT IN ('done','closed','cancelled')) AS dueToday,
          SUM(due_date < CURDATE() AND status NOT IN ('done','closed','cancelled')) AS overdue
         FROM tasks WHERE entity_id=? AND deleted_at IS NULL`,
        [today, today, e.id]
      );
      const [[approvals]] = await pool.query(
        `SELECT SUM(status='pending') AS pending FROM approval_requests WHERE entity_id=?`,
        [e.id]
      );
      const [[finance]] = await pool.query(
        `SELECT SUM(status='pending_approval') AS pending,
                SUM(total_amount) AS totalPendingAmount
           FROM finance_workflows WHERE entity_id=? AND deleted_at IS NULL`, [e.id]
      );
      const [[sales]] = await pool.query(
        `SELECT SUM(stage NOT IN ('won','lost')) AS active,
                SUM(stage='won' AND DATE(closed_at)=?) AS wonToday
           FROM sales_pipeline WHERE entity_id=? AND deleted_at IS NULL`, [today, e.id]
      );

      const prompt = `Entity: ${e.name}
Tanggal: ${today}

Tasks: selesai ${tasks.doneToday || 0}, due hari ini ${tasks.dueToday || 0}, overdue ${tasks.overdue || 0}
Approval pending: ${approvals.pending || 0}
Finance pending approval: ${finance.pending || 0} (total ${finance.totalPendingAmount || 0} IDR)
Sales: aktif ${sales.active || 0}, won hari ini ${sales.wonToday || 0}

Buat ringkasan pagi untuk manajemen.`;

      try {
        const r = await runModule('daily_brief', prompt);
        const [ins] = await pool.query(
          `INSERT INTO ai_summaries
           (entity_id, module, subject_type, subject_id, provider, model, content)
           VALUES (?, 'daily_brief', 'entity', ?, ?, ?, ?)`,
          [e.id, e.id, r.provider, r.model, r.content]
        );
        await pool.query(
          `INSERT INTO ai_briefs
           (entity_id, brief_type, brief_date, content, ai_summary_id, provider, model)
           VALUES (?, 'daily', ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE content=VALUES(content),
             ai_summary_id=VALUES(ai_summary_id)`,
          [e.id, today, r.content, ins.insertId, r.provider, r.model]
        );
        created++;
      } catch (err) {
        logger.error({ entityId: e.id, err: err.message }, '[briefGenerator] entity failed');
      }
    }
    console.log(`[briefGenerator] ${created} brief dibuat`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
