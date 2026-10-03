require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const reminders = require('../services/salesReminders.service');
const { transactionsReliable } = require('../services/salesSource');
const logger = require('../utils/logger');

/**
 * Cron harian: ingatkan sales saat customer-nya mulai dormant (30 hari tanpa
 * order) dan 10 hari sebelum Lost, serta saat invoice lewat jatuh tempo (dan
 * lagi di hari ke-30). Tiap pengingat hanya dikirim sekali.
 *   0 8 * * * /usr/local/bin/node /path/to/jobs/salesDormantReminder.js
 *   --dry-run  hanya tampilkan rencana, tanpa mengirim apa pun
 */
(async () => {
  try {
    const entityId = Number(process.env.SALES_ENTITY_ID || 1);
    const dryRun = process.argv.includes('--dry-run');
    // Dormant and late-invoice reminders are built on transactions; while they
    // are still the old sheet recap (Accurate not connected yet) they are held,
    // so nobody is alarmed by wrong numbers.
    if (!(await transactionsReliable(entityId))) {
      logger.info({ entityId }, '[salesDormantReminder] ditahan: transaksi belum tersambung Accurate');
      console.log('[salesDormantReminder] ditahan: transaksi belum tersambung Accurate');
      return;
    }
    const result = await reminders.run(entityId, { dryRun });
    const invoices = await reminders.runInvoices(entityId, { dryRun });
    if (dryRun) {
      console.log(JSON.stringify({ invoices: { due: invoices.due, notes: invoices.notes.map((x) => ({ userId: x.userId, orderId: x.orderId, kind: x.kind, title: x.title })) } }, null, 1));
      console.log(JSON.stringify({
        due: result.due,
        direct: result.direct.map((n) => ({ userId: n.userId, customerId: n.customerId, kind: n.kind, title: n.title })),
        digests: result.digests.map((d) => ({ userId: d.userId, title: d.title, customers: d.customers.length })),
      }, null, 1));
    } else {
      logger.info({ entityId, ...result }, '[salesDormantReminder] done');
      logger.info({ entityId, ...invoices }, '[salesDormantReminder] invoices');
      console.log(`[salesDormantReminder] ${result.direct} pengingat dormant, ${result.digests} ringkasan, ${invoices.sent} pengingat tagihan`);
    }
  } catch (e) {
    logger.error({ err: e.message }, '[salesDormantReminder] failed');
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await drainAndEnd(pool).catch(() => {});
  }
})();
