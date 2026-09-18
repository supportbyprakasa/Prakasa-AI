const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
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

/**
 * Upload invoice PDF (multipart) + create dokumen Fase 2.
 */
async function upload(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // subscription id
    const {
      invoiceNumber, invoiceDate, amount, taxAmount = 0, totalAmount,
      currency = 'IDR', jurnalReferenceId,
    } = req.body;

    const [s] = await pool.query(
      `SELECT * FROM software_subscriptions WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!s[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    let driveFileId = null;
    let webViewLink = null;
    let documentId = null;

    if (req.file) {
      const up = await drive.uploadFile({
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      driveFileId = up.id; webViewLink = up.webViewLink;

      // Buat dokumen Fase 2 juga
      const [doc] = await pool.query(
        `INSERT INTO documents
         (entity_id, department_id, title, document_type, status,
          drive_file_id, drive_folder_id, created_by)
         VALUES (?, ?, ?, 'invoice', 'final', ?, NULL, ?)`,
        [s[0].entity_id, s[0].department_id,
         `Invoice ${invoiceNumber} - ${s[0].product_name}`,
         up.id, req.user.sub]
      );
      documentId = doc.insertId;
    }

    const [inv] = await pool.query(
      `INSERT INTO subscription_invoices
       (subscription_id, invoice_number, invoice_date, amount, currency,
        tax_amount, total_amount, status, document_id, jurnal_reference_id,
        uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, NOW())`,
      [id, invoiceNumber, invoiceDate, amount, currency,
       taxAmount, totalAmount, documentId || null, jurnalReferenceId || null, req.user.sub]
    );

    await log({
      entityId: s[0].entity_id, userId: req.user.sub,
      action: 'subscription_invoice.upload', subjectType: 'subscription_invoice',
      subjectId: inv.insertId, metadata: { invoiceNumber, subscriptionId: Number(id) },
    });

    return ok(res, {
      id: inv.insertId, documentId, webViewLink,
    }, undefined, 201);
  } catch (e) { next(e); }
  finally { conn.release(); }
}

async function verify(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'verified' | 'void'
    const [r] = await pool.query(
      `UPDATE subscription_invoices
          SET status=?, verified_by=?, verified_at=NOW()
        WHERE id=?`, [status, req.user.sub, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Invoice tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription_invoice.verify', subjectType: 'subscription_invoice',
      subjectId: Number(id), metadata: { status },
    });
    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

async function pendingUpload(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.subscription_id AS subscriptionId, s.product_name AS productName,
              i.invoice_number AS invoiceNumber, i.status,
              DATEDIFF(CURDATE(), i.invoice_date) AS daysOld
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE i.status='pending_upload'
           OR (i.status='uploaded' AND i.verified_at IS NULL)
        ORDER BY i.invoice_date ASC`
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, upload, verify, pendingUpload };
