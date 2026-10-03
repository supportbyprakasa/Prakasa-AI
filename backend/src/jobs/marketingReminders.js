require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const notif = require('../services/notification.service');
const logger = require('../utils/logger');
const { todayWib } = require('../utils/wibTime');

/**
 * Daily Marketing reminder (migration 119). cPanel cron at 07:00 WIB:
 *   node /path/to/backend/src/jobs/marketingReminders.js
 *
 * A campaign past its end date and still 'berjalan' → the entity's Marketing
 * Supervisors and Heads, and whoever created the campaign: close it and
 * record the result. Event 'marketing.campaign_ended' (in-app only, by
 * config/notificationPolicy.js). One reminder per campaign and end date
 * (dedupeKey), so a rerun sends nothing twice and extending a campaign that
 * then runs late again reminds once more. The same campaigns show in Pusat
 * Eskalasi (management provider "marketing").
 */

const EVENT = 'marketing.campaign_ended';
const ROLES = ['marketing.supervisor', 'marketing.head'];

async function recipients(db, entityId) {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.entity_id = ? AND r.deleted_at IS NULL AND r.role_key IN (?)
        AND u.status = 'active' AND u.deleted_at IS NULL`,
    [entityId, ROLES],
  );
  return rows.map((r) => Number(r.id));
}

async function runOnce({ today = todayWib(), db = pool, notify = notif.create } = {}) {
  const [late] = await db.query(
    `SELECT c.id, c.entity_id, c.name, c.created_by, DATE_FORMAT(c.end_on, '%Y-%m-%d') AS end_on
       FROM mkt_campaigns c
      WHERE c.status = 'berjalan' AND c.end_on < ?
      ORDER BY c.entity_id, c.id`,
    [today],
  );
  const byEntity = new Map();
  let created = 0;
  for (const c of late) {
    if (!byEntity.has(c.entity_id)) byEntity.set(c.entity_id, await recipients(db, c.entity_id));
    const users = [...new Set([...byEntity.get(c.entity_id), c.created_by].filter(Boolean).map(Number))];
    for (const userId of users) {
      try {
        const id = await notify({
          userId,
          entityId: c.entity_id,
          title: 'Kampanye berakhir — catat hasilnya',
          body: `${c.name} berakhir ${c.end_on} dan masih berstatus Berjalan. Tandai Selesai dan catat hasilnya.`,
          event: EVENT,
          subjectType: 'mkt_campaign',
          subjectId: c.id,
          actionUrl: `/marketing/campaigns?open=${c.id}`,
          dedupeKey: `mkt_campaign_ended:${c.id}:${c.end_on}:${userId}`,
        });
        if (id != null) created += 1;
      } catch { /* one failed reminder never stops the others */ }
    }
  }
  return { created, campaigns: late.length };
}

async function main() {
  try {
    const result = await runOnce();
    logger.info({ result }, '[marketingReminders] done');
    console.log(`[marketingReminders] ${result.created} notifikasi dibuat (${result.campaigns} kampanye lewat tanggal selesai)`);
  } catch (e) {
    logger.error({ err: e.message }, '[marketingReminders] failed');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await drainAndEnd(pool);
  }
}

if (require.main === module) main();
module.exports = { runOnce, EVENT, ROLES };
