require('dotenv').config();
const pool = require('../db/pool');
const notif = require('../services/notification.service');
const logger = require('../utils/logger');

/**
 * Dijalankan lewat cPanel Cron Job (sekali sehari).
 * Perintah: node /path/to/backend/src/jobs/itReminders.js
 *
 * Reminder yang dibuat (SOW bagian 10.2):
 *  - warranty akan jatuh tempo (30 hari)
 *  - subscription akan renewal (30 hari)
 *  - invoice belum diupload
 *  - payment belum diproses Finance
 *  - idle license (assigned tapi tidak dipakai > 60 hari)
 *  - device belum dikembalikan saat offboarding (assignment lewat expected_return_date)
 */
async function main() {
  const today = new Date();
  let created = 0;

  try {
    // 1. Warranty due (30 hari)
    const [warranty] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.asset_code AS assetCode,
              d.warranty_end AS warrantyEnd, d.current_assignee_id AS assigneeId
         FROM devices d
        WHERE d.deleted_at IS NULL AND d.warranty_end IS NOT NULL
          AND d.warranty_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
    );
    for (const w of warranty) {
      const userId = w.assigneeId;
      if (!userId) continue;
      await notif.create({
        userId, entityId: w.entityId,
        title: 'Warranty device akan berakhir',
        body: `${w.assetCode} berakhir ${w.warrantyEnd}`,
        event: 'it.warranty_expiring',
        subjectType: 'device', subjectId: w.id,
        actionUrl: `/it/devices/${w.id}`,
      });
      created++;
    }

    // 2. Subscription renewal due (30 hari)
    const [renewals] = await pool.query(
      `SELECT id, entity_id AS entityId, product_name AS productName,
              renewal_date AS renewalDate, pic_user_id AS picUserId
         FROM software_subscriptions
        WHERE deleted_at IS NULL AND status IN ('active','expiring')
          AND renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
    );
    for (const r of renewals) {
      await pool.query(
        `UPDATE software_subscriptions SET status='expiring'
          WHERE id=? AND status='active'`, [r.id]
      );
      if (r.picUserId) {
        await notif.create({
          userId: r.picUserId, entityId: r.entityId,
          title: 'Subscription akan renewal',
          body: `${r.productName} - ${r.renewalDate}`,
          event: 'it.subscription_renewal_due',
          subjectType: 'software_subscription', subjectId: r.id,
          actionUrl: `/it/subscriptions/${r.id}`,
        });
        created++;
      }
    }

    // 3. Invoice pending upload / verify
    const [invoices] = await pool.query(
      `SELECT i.id, i.status, s.entity_id AS entityId, s.pic_user_id AS picUserId,
              s.product_name AS productName, i.invoice_number AS invoiceNumber
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE i.status IN ('pending_upload','uploaded') AND s.pic_user_id IS NOT NULL`
    );
    for (const inv of invoices) {
      await notif.create({
        userId: inv.picUserId, entityId: inv.entityId,
        title: 'Invoice subscription perlu ditindaklanjuti',
        body: `${inv.productName} - ${inv.invoiceNumber} (${inv.status})`,
        event: 'it.invoice_pending',
        subjectType: 'subscription_invoice', subjectId: inv.id,
        actionUrl: `/it/subscriptions`,
      });
      created++;
    }

    // 4. Payment pending
    const [payments] = await pool.query(
      `SELECT p.id, s.entity_id AS entityId, s.pic_user_id AS picUserId,
              s.product_name AS productName
         FROM subscription_payments p
         JOIN software_subscriptions s ON s.id = p.subscription_id
        WHERE p.status='pending' AND s.pic_user_id IS NOT NULL`
    );
    for (const p of payments) {
      await notif.create({
        userId: p.picUserId, entityId: p.entityId,
        title: 'Payment subscription belum diproses',
        body: p.productName,
        event: 'it.payment_pending',
        subjectType: 'subscription_payment', subjectId: p.id,
        actionUrl: `/it/subscriptions`,
      });
      created++;
    }

    // 5. Idle license (assigned > 60 hari tidak dipakai)
    const [idle] = await pool.query(
      `SELECT l.id, s.entity_id AS entityId, s.pic_user_id AS picUserId,
              s.product_name AS productName, l.seat_label AS seatLabel
         FROM subscription_licenses l
         JOIN software_subscriptions s ON s.id = l.subscription_id
        WHERE l.status='assigned'
          AND (l.last_used_at IS NULL OR l.last_used_at <= DATE_SUB(CURDATE(), INTERVAL 60 DAY))
          AND s.pic_user_id IS NOT NULL`
    );
    for (const l of idle) {
      await pool.query(`UPDATE subscription_licenses SET status='idle' WHERE id=?`, [l.id]);
      await notif.create({
        userId: l.picUserId, entityId: l.entityId,
        title: 'Idle license terdeteksi',
        body: `${l.productName} - ${l.seatLabel || ''}`,
        event: 'it.license_idle',
        subjectType: 'subscription_license', subjectId: l.id,
        actionUrl: `/it/subscriptions`,
      });
      created++;
    }

    // 6. Device belum dikembalikan (expected_return_date sudah lewat)
    const [lateReturns] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId, a.assigned_to AS assignedTo,
              a.expected_return_date AS expectedReturnDate, d.asset_code AS assetCode
         FROM device_assignments a
         JOIN devices d ON d.id = a.device_id
        WHERE a.status='active'
          AND a.expected_return_date IS NOT NULL
          AND a.expected_return_date < CURDATE()`
    );
    for (const a of lateReturns) {
      await notif.create({
        userId: a.assignedTo, entityId: a.entityId,
        title: 'Device belum dikembalikan',
        body: `${a.assetCode} — jatuh tempo ${a.expectedReturnDate}`,
        event: 'it.device_return_late',
        subjectType: 'device_assignment', subjectId: a.id,
        actionUrl: `/it/devices`,
      });
      created++;
    }

    logger.info(`[itReminders] ${created} notifikasi dibuat pada ${today.toISOString()}`);
    console.log(`[itReminders] Done. ${created} notifications created.`);
  } catch (e) {
    logger.error({ err: e.message }, '[itReminders] failed');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();
module.exports = main;
