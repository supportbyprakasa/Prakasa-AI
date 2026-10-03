const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const drive = require('../services/googleDrive.service');
const billing = require('../services/subscriptionBilling.service');

async function list(req, res, next) {
  try {
    // Invoices belong to the company of their subscription: the signed-in user's.
    const where = ['s.entity_id = ?'];
    const args = [req.user.entityId];
    if (req.query.status) { where.push('i.status = ?'); args.push(req.query.status); }
    if (req.query.subscriptionId) { where.push('i.subscription_id = ?'); args.push(req.query.subscriptionId); }

    const [rows] = await pool.query(
      `SELECT i.id, i.subscription_id AS subscriptionId,
              s.product_name AS productName, i.invoice_number AS invoiceNumber,
              i.invoice_date AS invoiceDate, i.amount, i.total_amount AS totalAmount,
              i.currency, i.status, i.document_id AS documentId,
              i.jurnal_reference_id AS jurnalReferenceId,
              i.uploaded_at AS uploadedAt, i.verified_at AS verifiedAt
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

function billingFail(res, e, next) {
  if (e.status) return fail(res, e.code, e.message, e.status);
  return next(e);
}

/**
 * "Catat invoice": with a valid PDF the invoice is "uploaded"; without one it
 * stays "pending_upload" until the PDF is attached (subscriptionBilling.service).
 */
async function upload(req, res, next) {
  try {
    const result = await billing.recordInvoice({
      entityId: req.user.entityId, subscriptionId: Number(req.params.id), actorId: req.user.sub,
      body: req.body, file: req.file || null, drive,
    });
    return ok(res, result, undefined, 201);
  } catch (e) { return billingFail(res, e, next); }
}

async function attachFile(req, res, next) {
  try {
    const result = await billing.attachInvoiceFile({
      entityId: req.user.entityId, invoiceId: Number(req.params.id), actorId: req.user.sub, file: req.file || null, drive,
    });
    return ok(res, result);
  } catch (e) { return billingFail(res, e, next); }
}

async function verify(req, res, next) {
  try {
    const result = await billing.verifyInvoice({
      entityId: req.user.entityId, invoiceId: Number(req.params.id), actorId: req.user.sub, status: req.body.status,
    });
    return ok(res, result);
  } catch (e) { return billingFail(res, e, next); }
}

async function pendingUpload(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.subscription_id AS subscriptionId, s.product_name AS productName,
              i.invoice_number AS invoiceNumber, i.status,
              DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.invoice_date) AS daysOld
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE s.entity_id = ?
          AND (i.status='pending_upload' OR (i.status='uploaded' AND i.verified_at IS NULL))
        ORDER BY i.invoice_date ASC`, [req.user.entityId]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, upload, attachFile, verify, pendingUpload };
