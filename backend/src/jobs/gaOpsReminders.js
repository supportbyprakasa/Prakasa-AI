require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const notif = require('../services/notification.service');
const logger = require('../utils/logger');
const { todayWib } = require('../utils/wibTime');
const { MAINTENANCE_DUE_SOON, MAINTENANCE_OVERDUE, CONTRACT_ENDING, BILL_OVERDUE } = require('../services/gaOps.service');
const { MAINTENANCE_CATEGORY_LABELS, CONTRACT_KIND_LABELS, UTILITY_LABELS } = require('../config/gaOps');

/**
 * Daily Operasional GA reminders (migration 114). cPanel cron at 07:00 WIB:
 *   node /path/to/backend/src/jobs/gaOpsReminders.js
 * To GA's PIC (People & Culture → PIC setting) and everyone who manages
 * Operasional GA (ga.ops.manage) in the company. Event names and whether
 * they email come from config/notificationPolicy.js:
 *   ga_ops.maintenance_due — upkeep due within 7 days or overdue (in the app);
 *   ga_ops.contract_ending — a contract inside its notice window (email);
 *   ga_ops.bill_overdue    — a utility bill past due and unpaid (email).
 * dedupeKeys make a rerun on the same day send nothing twice; an overdue
 * item is repeated once a week, not daily.
 */

const week = (today) => Math.floor(Date.parse(`${today}T00:00:00Z`) / (7 * 86400000));
const link = (tab, id) => `/ga/operations?tab=${tab}&open=${id}`;

async function recipients(db, entityId) {
  const [[pic]] = await db.query("SELECT value FROM settings WHERE entity_id = ? AND `key` = 'people_culture.pic' LIMIT 1", [entityId]);
  let value = pic?.value;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const [managers] = await db.query(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'ga.ops.manage'
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.role_key <> 'system.super_admin'
      WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL`,
    [entityId],
  );
  return [...new Set([Number(value?.gaUserId) || null, ...managers.map((m) => Number(m.id))].filter(Boolean))];
}

async function send(userIds, payload) {
  let n = 0;
  for (const userId of userIds) {
    try {
      if ((await notif.create({ ...payload, userId, dedupeKey: `${payload.dedupeKey}:${userId}` })) != null) n += 1;
    } catch { /* one failed reminder never stops the others */ }
  }
  return n;
}

async function runOnce({ today = todayWib(), db = pool } = {}) {
  let created = 0;
  const [entities] = await db.query('SELECT DISTINCT entity_id FROM ga_maintenance_items UNION SELECT DISTINCT entity_id FROM ga_contracts UNION SELECT DISTINCT entity_id FROM ga_utility_bills');
  for (const { entity_id: entityId } of entities) {
    const to = await recipients(db, entityId);
    if (!to.length) continue;

    const [items] = await db.query(
      `SELECT m.id, m.name, m.category, DATE_FORMAT(m.next_due_on, '%Y-%m-%d') AS due, ${MAINTENANCE_OVERDUE('m')} AS overdue
         FROM ga_maintenance_items m WHERE m.entity_id = ? AND (${MAINTENANCE_DUE_SOON('m')} OR ${MAINTENANCE_OVERDUE('m')})`,
      [entityId],
    );
    for (const i of items) {
      created += await send(to, {
        entityId, event: 'ga_ops.maintenance_due',
        title: Number(i.overdue) ? `Perawatan lewat jadwal: ${i.name}` : `Perawatan jatuh tempo ${i.due}: ${i.name}`,
        body: `${MAINTENANCE_CATEGORY_LABELS[i.category] || 'Perawatan'} — jadwal ${i.due}. Catat setelah dikerjakan.`,
        subjectType: 'ga_maintenance_item', subjectId: i.id, actionUrl: link('maintenance', i.id),
        dedupeKey: `ga_ops:maint:${i.id}:${i.due}:${Number(i.overdue) ? `w${week(today)}` : 'soon'}`,
      });
    }

    const [contracts] = await db.query(
      `SELECT c.id, c.vendor_name, c.kind, DATE_FORMAT(c.end_on, '%Y-%m-%d') AS end_on
         FROM ga_contracts c WHERE c.entity_id = ? AND ${CONTRACT_ENDING('c')}`,
      [entityId],
    );
    for (const c of contracts) {
      created += await send(to, {
        entityId, event: 'ga_ops.contract_ending',
        title: `Kontrak ${CONTRACT_KIND_LABELS[c.kind] || ''} ${c.vendor_name} berakhir ${c.end_on}`.replace(/\s+/g, ' '),
        body: 'Putuskan perpanjang atau ganti vendor sebelum kontrak berakhir.',
        subjectType: 'ga_contract', subjectId: c.id, actionUrl: link('contracts', c.id),
        dedupeKey: `ga_ops:contract:${c.id}:${c.end_on}:w${week(today)}`,
      });
    }

    const [bills] = await db.query(
      `SELECT b.id, b.utility, b.period, DATE_FORMAT(b.due_on, '%Y-%m-%d') AS due_on, loc.name AS location_name
         FROM ga_utility_bills b LEFT JOIN org_locations loc ON loc.entity_id = b.entity_id AND loc.id = b.location_id
        WHERE b.entity_id = ? AND ${BILL_OVERDUE('b')}`,
      [entityId],
    );
    for (const b of bills) {
      created += await send(to, {
        entityId, event: 'ga_ops.bill_overdue',
        title: `Tagihan ${UTILITY_LABELS[b.utility] || 'utilitas'} ${b.period} lewat jatuh tempo`,
        body: `${b.location_name || 'Lokasi'} — jatuh tempo ${b.due_on}. Ajukan pembayaran ke Finance, lalu catat tanggal lunasnya.`,
        subjectType: 'ga_utility_bill', subjectId: b.id, actionUrl: link('bills', b.id),
        dedupeKey: `ga_ops:bill:${b.id}:w${week(today)}`,
      });
    }
  }
  return { created };
}

if (require.main === module) {
  runOnce()
    .then((r) => { logger.info?.(r, 'gaOpsReminders done'); return drainAndEnd(pool); })
    .catch(async (e) => { logger.error?.({ err: e.message }, 'gaOpsReminders failed'); await drainAndEnd(pool); process.exit(1); });
}

module.exports = { runOnce, recipients };
