// Light approvals (program 1.2): a batch of Accurate data that waits is not
// forgotten. After REMIND_AFTER_HOURS every decider is reminded once; after
// ESCALATE_AFTER_HOURS the Head (or stand-in) and the owner hear again, once a
// day, until someone decides. Run by the Accurate sync job every few minutes;
// the dedupe key makes each message go out once however often it runs.
// Deciding still goes through the approval engine — from the batch page, or
// straight from the notification (POST /approvals/:id/decide).
const pool = require('../db/pool');
const notif = require('./notification.service');
const batches = require('./salesAccurateBatches.service');

// The approval matrix for these batches says the same (migrations 061, 072).
const REMIND_AFTER_HOURS = 8;
const ESCALATE_AFTER_HOURS = 24;

function plan(hours) {
  if (hours >= ESCALATE_AFTER_HOURS) {
    const days = Math.floor(hours / 24);
    return { kind: 'escalated', key: `escalated:${days}`, event: 'accurate.batch_escalated', days };
  }
  if (hours >= REMIND_AFTER_HOURS) return { kind: 'reminder', key: 'reminder', event: 'accurate.batch_reminder' };
  return null;
}

async function run(entityId) {
  const [waiting] = await pool.query(
    `SELECT b.id, b.department_id, b.approval_request_id, b.summary, d.name AS department_name,
            TIMESTAMPDIFF(HOUR, b.created_at, NOW()) AS hours
       FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id
      WHERE b.entity_id = ? AND b.status = 'pending' AND b.approval_request_id IS NOT NULL`,
    [entityId],
  );
  let sent = 0;
  let failed = 0;
  for (const b of waiting) {
    const step = plan(Number(b.hours));
    if (!step) continue;
    try {
      sent += await remind(entityId, b, step);
    } catch {
      failed += 1; // one batch never stops the others' reminders
    }
  }
  return { waiting: waiting.length, sent, failed };
}

async function remind(entityId, b, step) {
  const summary = typeof b.summary === 'string' ? JSON.parse(b.summary) : (b.summary || { counts: {} });
  const recipients = await batches.deciderIds(entityId,
    { approvalRequestId: b.approval_request_id, departmentId: b.department_id },
    { escalationOnly: step.kind === 'escalated' });
  const title = step.kind === 'escalated'
    ? `Data Accurate ${b.department_name} tertunda ${step.days} hari`
    : `Pengingat: data Accurate ${b.department_name} menunggu persetujuan`;
  let sent = 0;
  for (const userId of recipients) {
    const created = await notif.create({
      userId, entityId, title,
      body: batches.noticeText(summary),
      event: step.event,
      subjectType: 'approval_request',
      subjectId: b.approval_request_id,
      actionUrl: `/data-accurate/${b.id}`,
      dedupeKey: `accurate_batch:${b.id}:${step.key}`,
    }).catch(() => null);
    if (created) sent += 1;
  }
  return sent;
}

module.exports = { run, plan, REMIND_AFTER_HOURS, ESCALATE_AFTER_HOURS };
