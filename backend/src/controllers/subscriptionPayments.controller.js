const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function create(req, res, next) {
  try {
    const { id } = req.params; // subscription id
    const {
      invoiceId, paidAt, amount, currency = 'IDR',
      paymentMethod, referenceNo, jurnalReferenceId, notes,
    } = req.body;

    const [s] = await pool.query(
      `SELECT * FROM software_subscriptions WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!s[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO subscription_payments
       (subscription_id, invoice_id, paid_at, amount, currency, payment_method,
        reference_no, jurnal_reference_id, notes, processed_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed')`,
      [id, invoiceId || null, paidAt || new Date(), amount, currency,
       paymentMethod || null, referenceNo || null, jurnalReferenceId || null,
       notes || null, req.user.sub]
    );

    if (invoiceId) {
      await pool.query(
        `UPDATE subscription_invoices SET status='paid' WHERE id=?`, [invoiceId]
      );
    }

    await log({
      entityId: s[0].entity_id, userId: req.user.sub,
      action: 'subscription_payment.create', subjectType: 'subscription_payment',
      subjectId: r.insertId, metadata: { amount, invoiceId },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { create };
