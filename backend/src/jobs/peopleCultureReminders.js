require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const notif = require('../services/notification.service');
const logger = require('../utils/logger');
const { todayWib } = require('../utils/wibTime');
const { addDays } = require('../services/hrgaChecklist');

/**
 * Daily People & Culture reminders (wave 2, §2.1.5). cPanel cron at 07:00 WIB:
 *   node /path/to/backend/src/jobs/peopleCultureReminders.js
 *
 * Every notification carries a dedupeKey, so a rerun on the same day sends
 * nothing twice (P9: no daily spam):
 *  - a checklist item due tomorrow or today → its responsible user;
 *  - an overdue item → responsible user + the workflow PIC on day 1, then every 3 days;
 *  - an offboarding whose last day is tomorrow with access/asset items open → PIC + manager.
 * Approval reminders stay with the existing approvalReminders job (matrix 24/48 h).
 */

const ACCESS_ASSET = "('account_deactivation', 'app_account_deactivation', 'device_return', 'software_license', 'phone_line_return', 'access_revoke', 'id_card_return')";
const OPEN = "('pending', 'in_progress', 'blocked')";
const RUNNING = "('approved', 'in_progress')";
const LATE_EVERY_DAYS = 3;

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const url = (id) => `/hrga/workflows/${id}`;

async function send(list, payload) {
  let n = 0;
  for (const userId of [...new Set(list.filter(Boolean).map(Number))]) {
    try {
      const id = await notif.create({ ...payload, userId, dedupeKey: `${payload.dedupeKey}:${userId}` });
      if (id != null) n += 1;
    } catch { /* one failed reminder never stops the others */ }
  }
  return n;
}

async function runOnce({ today = todayWib(), db = pool } = {}) {
  const tomorrow = addDays(today, 1);
  let created = 0;

  const [due] = await db.query(
    `SELECT t.id, t.title, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_day, t.responsible_user_id,
            h.id AS workflow_id, h.entity_id, h.employee_full_name
       FROM hrga_workflow_tasks t JOIN hrga_workflows h ON h.id = t.hrga_workflow_id
      WHERE h.deleted_at IS NULL AND h.status IN ${RUNNING} AND t.status IN ${OPEN}
        AND t.responsible_user_id IS NOT NULL AND t.due_date IN (?, ?)`,
    [today, tomorrow],
  );
  for (const t of due) {
    created += await send([t.responsible_user_id], {
      entityId: t.entity_id,
      title: t.due_day === today ? 'Tugas checklist jatuh tempo hari ini' : 'Tugas checklist jatuh tempo besok',
      body: `${t.title} — ${t.employee_full_name}`,
      event: 'hrga.task_due', subjectType: 'hrga_workflow', subjectId: t.workflow_id, actionUrl: url(t.workflow_id),
      dedupeKey: `hrga_task_due:${t.id}:${today}`,
    });
  }

  const [late] = await db.query(
    `SELECT t.id, t.title, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due_day, t.responsible_user_id,
            h.id AS workflow_id, h.entity_id, h.employee_full_name, COALESCE(h.hrga_pic_user_id, h.requested_by) AS pic
       FROM hrga_workflow_tasks t JOIN hrga_workflows h ON h.id = t.hrga_workflow_id
      WHERE h.deleted_at IS NULL AND h.status IN ${RUNNING} AND t.status IN ${OPEN} AND t.due_date < ?`,
    [today],
  );
  for (const t of late) {
    const daysLate = daysBetween(t.due_day, today);
    // Day 1, then every 3 days: the bucket changes once per 3 days.
    if (daysLate < 1 || (daysLate - 1) % LATE_EVERY_DAYS !== 0) continue;
    const bucket = Math.floor((daysLate - 1) / LATE_EVERY_DAYS);
    created += await send([t.responsible_user_id, t.pic], {
      entityId: t.entity_id, title: `Tugas checklist lewat tenggat ${daysLate} hari`,
      body: `${t.title} — ${t.employee_full_name}`,
      event: 'hrga.task_overdue', subjectType: 'hrga_workflow', subjectId: t.workflow_id, actionUrl: url(t.workflow_id),
      dedupeKey: `hrga_task_late:${t.id}:${bucket}`,
    });
  }

  const [lastDay] = await db.query(
    `SELECT h.id, h.entity_id, h.employee_full_name, COALESCE(h.hrga_pic_user_id, h.requested_by) AS pic,
            mu.id AS manager_user_id, COUNT(t.id) AS open_items
       FROM hrga_workflows h
       JOIN hrga_workflow_tasks t ON t.hrga_workflow_id = h.id AND t.status IN ${OPEN} AND t.category IN ${ACCESS_ASSET}
       LEFT JOIN people_directory mp ON mp.id = h.manager_person_id AND mp.entity_id = h.entity_id
       LEFT JOIN users mu ON mu.id = mp.user_id AND mu.status = 'active' AND mu.deleted_at IS NULL
      WHERE h.deleted_at IS NULL AND h.workflow_type = 'offboarding' AND h.status IN ${RUNNING}
        AND h.last_working_date = ?
      GROUP BY h.id, h.entity_id, h.employee_full_name, pic, mu.id`,
    [tomorrow],
  );
  for (const w of lastDay) {
    created += await send([w.pic, w.manager_user_id], {
      entityId: w.entity_id, title: 'Besok hari terakhir: akses/aset belum selesai',
      body: `${w.employee_full_name} — ${Number(w.open_items)} item akses/aset masih terbuka`,
      event: 'hrga.last_day_open', subjectType: 'hrga_workflow', subjectId: w.id, actionUrl: url(w.id),
      dedupeKey: `hrga_lastday:${w.id}`,
    });
  }

  return { created, due: due.length, late: late.length, lastDay: lastDay.length };
}

async function main() {
  try {
    const result = await runOnce();
    logger.info({ result }, '[peopleCultureReminders] done');
    console.log(`[peopleCultureReminders] ${result.created} notifikasi dibuat`);
    // Layanan GA (wave 2, row 2.2, §3.4): due requests, pending vehicle
    // bookings, expiry, late returns — services/gaReminders.service.js.
    const ga = await require('../services/gaReminders.service').runGaReminders();
    logger.info({ ga }, '[peopleCultureReminders] Layanan GA done');
    console.log(`[peopleCultureReminders] Layanan GA: ${JSON.stringify(ga)}`);
  } catch (e) {
    logger.error({ err: e.message }, '[peopleCultureReminders] failed');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await drainAndEnd(pool);
  }
}

if (require.main === module) main();
module.exports = { runOnce, LATE_EVERY_DAYS };
