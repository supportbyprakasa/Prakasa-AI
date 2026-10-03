// Langganan software: invoices and payments as a register (revision F25/F26,
// 3 Oct 2026). Nothing here sends money, talks to a bank or writes Accurate:
// "Catat invoice" and "Catat pembayaran" record what IT and Finance already did
// outside the app.
//
// Decisions recorded with the revision (docs/revisi-2026-10-03-hasil.md):
// - An invoice may be recorded before its PDF exists: it stays "pending_upload"
//   until a valid PDF is attached, and only then is "uploaded". Verification is
//   done on an uploaded invoice; "void" is refused once a payment is recorded.
// - A partial payment is allowed: it lowers the outstanding amount and the
//   invoice stays unpaid until the recorded payments cover its total.
// - A payment above the outstanding amount is refused (record the excess as a
//   payment without an invoice if it really happened).
// - A payment uses the invoice's currency; there is no conversion.
// - A payment may be recorded on an invoice that is not verified yet (the
//   register follows what was paid); a void or paid invoice takes no payment.

const pool = require('../db/pool');
const { logWith } = require('./activityLog.service');

const PAYABLE_STATUSES = Object.freeze(['pending_upload', 'uploaded', 'verified']);
const MAX_CENTS = 999999999999999; // DECIMAL(15,2)

function billingError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

// Money as integer cents: positive (or zero when allowed), at most two decimals.
function toCents(value, { field, allowZero = false } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw billingError(400, 'VALIDATION_ERROR', `${field} harus berupa angka`);
  const cents = Math.round(n * 100);
  if (Math.abs(cents - n * 100) > 1e-6) throw billingError(400, 'VALIDATION_ERROR', `${field} maksimal dua angka desimal`);
  if (cents < 0 || (!allowZero && cents === 0)) throw billingError(400, 'VALIDATION_ERROR', allowZero ? `${field} tidak boleh negatif` : `${field} harus lebih dari nol`);
  if (cents > MAX_CENTS) throw billingError(400, 'VALIDATION_ERROR', `${field} terlalu besar`);
  return cents;
}

const fromCents = (cents) => Number((cents / 100).toFixed(2));

function normalizeCurrency(value, fallback) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return fallback;
  if (!/^[A-Z]{3}$/.test(text)) throw billingError(400, 'VALIDATION_ERROR', 'Mata uang harus kode tiga huruf, misalnya IDR atau USD');
  return text;
}

function todayWib(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function validDate(value, field, { notAfterToday = false, now } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw billingError(400, 'VALIDATION_ERROR', `${field} tidak valid`);
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) throw billingError(400, 'VALIDATION_ERROR', `${field} tidak valid`);
  if (notAfterToday && text > todayWib(now)) throw billingError(400, 'VALIDATION_ERROR', `${field} tidak boleh di masa depan`);
  return text;
}

// What an invoice's recorded payments mean, from the ledger. An invoice marked
// paid whose recorded payments fall short (older data: zero or partial
// payments before the revision) is 'paid_short', never shown as settled.
function paymentState(invoice, paidCents) {
  const totalCents = Math.round(Number(invoice.total_amount ?? invoice.totalAmount ?? 0) * 100);
  const outstanding = Math.max(0, totalCents - paidCents);
  let state = 'unpaid';
  if (invoice.status === 'void') state = 'void';
  else if (totalCents > 0 && outstanding === 0) state = 'paid';
  else if (invoice.status === 'paid') state = 'paid_short';
  else if (paidCents > 0) state = 'partial';
  return { paidAmount: fromCents(paidCents), outstandingAmount: fromCents(outstanding), paymentState: state };
}

// The invoice's own amounts: subtotal + tax must equal the total.
function validateInvoiceAmounts({ amount, taxAmount = 0, totalAmount }) {
  const sub = toCents(amount, { field: 'Subtotal', allowZero: true });
  const tax = toCents(taxAmount ?? 0, { field: 'Pajak', allowZero: true });
  const total = toCents(totalAmount, { field: 'Total' });
  if (sub + tax !== total) {
    throw billingError(400, 'INVOICE_TOTAL_MISMATCH', `Total harus sama dengan subtotal + pajak (${fromCents(sub + tax)}).`);
  }
  return { amount: fromCents(sub), taxAmount: fromCents(tax), totalAmount: fromCents(total) };
}

// A locking read: inside a transaction a plain SELECT reads the snapshot taken
// at the transaction's first read (REPEATABLE READ), which misses payments
// committed while this one waited for the invoice lock. FOR UPDATE reads the
// latest committed rows (and holds them until commit).
async function paidCentsOf(conn, invoiceId) {
  const [[row]] = await conn.query(
    "SELECT COALESCE(SUM(amount), 0) AS paid FROM subscription_payments WHERE invoice_id = ? AND status = 'processed' FOR UPDATE",
    [invoiceId],
  );
  return Math.round(Number(row?.paid || 0) * 100);
}

async function existingByKey(db, subscriptionId, requestKey) {
  if (!requestKey) return null;
  const [[row]] = await db.query(
    'SELECT id, invoice_id AS invoiceId FROM subscription_payments WHERE subscription_id = ? AND request_key = ? LIMIT 1',
    [subscriptionId, requestKey],
  );
  return row || null;
}

/**
 * Record a payment (a register entry, never a transfer). One transaction: the
 * payment, the invoice's new status and the activity log commit together.
 */
async function recordPayment({ entityId, subscriptionId, actorId, body, now }) {
  const amountCents = toCents(body.amount, { field: 'Jumlah' });
  const paidAt = body.paidAt ? validDate(body.paidAt, 'Tanggal bayar', { notAfterToday: true, now }) : todayWib(now);
  const requestKey = body.requestKey ? String(body.requestKey).trim().slice(0, 64) : null;
  if (requestKey !== null && !/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) throw billingError(400, 'VALIDATION_ERROR', 'Kunci permintaan tidak valid');
  const invoiceId = body.invoiceId ? Number(body.invoiceId) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[sub]] = await conn.query(
      'SELECT id, entity_id, currency FROM software_subscriptions WHERE id = ? AND entity_id = ? AND deleted_at IS NULL',
      [subscriptionId, entityId],
    );
    if (!sub) throw billingError(404, 'NOT_FOUND', 'Langganan tidak ditemukan');

    const repeated = await existingByKey(conn, subscriptionId, requestKey);
    if (repeated) {
      await conn.rollback();
      return { id: Number(repeated.id), duplicate: true };
    }

    let invoice = null;
    let currency;
    let paidBefore = 0;
    if (invoiceId) {
      const [[row]] = await conn.query(
        'SELECT * FROM subscription_invoices WHERE id = ? AND subscription_id = ? FOR UPDATE',
        [invoiceId, subscriptionId],
      );
      if (!row) throw billingError(404, 'INVOICE_NOT_FOUND', 'Invoice tidak ditemukan pada langganan ini');
      invoice = row;
      if (!PAYABLE_STATUSES.includes(invoice.status)) {
        throw billingError(409, 'INVOICE_NOT_PAYABLE', invoice.status === 'paid' ? 'Invoice ini sudah lunas.' : 'Invoice ini sudah dibatalkan (void).');
      }
      currency = String(invoice.currency || 'IDR').toUpperCase();
      const asked = normalizeCurrency(body.currency, currency);
      if (asked !== currency) {
        throw billingError(409, 'CURRENCY_MISMATCH', `Mata uang pembayaran (${asked}) berbeda dengan invoice (${currency}). Tidak ada konversi otomatis.`);
      }
      paidBefore = await paidCentsOf(conn, invoiceId);
      const totalCents = Math.round(Number(invoice.total_amount) * 100);
      const outstanding = totalCents - paidBefore;
      if (amountCents > outstanding) {
        throw billingError(409, 'OVERPAYMENT', `Jumlah melebihi sisa tagihan invoice (${currency} ${fromCents(Math.max(0, outstanding))}). Catat kelebihannya sebagai pembayaran tanpa invoice bila memang terjadi.`, {
          outstandingAmount: fromCents(Math.max(0, outstanding)),
        });
      }
    } else {
      currency = normalizeCurrency(body.currency, String(sub.currency || 'IDR').toUpperCase());
    }

    let inserted;
    try {
      [inserted] = await conn.query(
        `INSERT INTO subscription_payments
           (subscription_id, invoice_id, paid_at, amount, currency, payment_method,
            reference_no, jurnal_reference_id, notes, request_key, processed_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed')`,
        [subscriptionId, invoiceId, paidAt, fromCents(amountCents), currency,
          body.paymentMethod || null, body.referenceNo || null, body.jurnalReferenceId || null,
          body.notes || null, requestKey, actorId],
      );
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY' && requestKey) {
        await conn.rollback();
        const again = await existingByKey(pool, subscriptionId, requestKey);
        if (again) return { id: Number(again.id), duplicate: true };
      }
      throw error;
    }

    let state = null;
    if (invoice) {
      const paidAfter = paidBefore + amountCents;
      state = paymentState(invoice, paidAfter);
      if (state.paymentState === 'paid') {
        await conn.query("UPDATE subscription_invoices SET status = 'paid' WHERE id = ? AND subscription_id = ?", [invoiceId, subscriptionId]);
      }
    }

    await logWith(conn, {
      entityId: Number(sub.entity_id), userId: actorId,
      action: 'subscription_payment.create', subjectType: 'subscription_payment',
      subjectId: inserted.insertId,
      metadata: { amount: fromCents(amountCents), currency, invoiceId, ...(state ? { invoicePaymentState: state.paymentState, outstandingAmount: state.outstandingAmount } : { allocated: false }) },
    });
    await conn.commit();
    return { id: Number(inserted.insertId), duplicate: false, invoiceId, currency, ...(state || {}) };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

/** Record an invoice; with a PDF it is "uploaded", without one "pending_upload". */
async function recordInvoice({ entityId, subscriptionId, actorId, body, file, drive }) {
  const invoiceNumber = String(body.invoiceNumber || '').trim();
  if (!invoiceNumber) throw billingError(400, 'VALIDATION_ERROR', 'Nomor invoice wajib diisi');
  const invoiceDate = validDate(body.invoiceDate, 'Tanggal invoice');
  const amounts = validateInvoiceAmounts(body);
  if (file && file.mimetype !== 'application/pdf') throw billingError(400, 'INVOICE_NOT_PDF', 'File invoice harus PDF');

  const [[sub]] = await pool.query(
    'SELECT * FROM software_subscriptions WHERE id = ? AND entity_id = ? AND deleted_at IS NULL',
    [subscriptionId, entityId],
  );
  if (!sub) throw billingError(404, 'NOT_FOUND', 'Langganan tidak ditemukan');
  const currency = normalizeCurrency(body.currency, String(sub.currency || 'IDR').toUpperCase());
  // A retry with the same number is refused before anything reaches Drive.
  const [[dup]] = await pool.query(
    'SELECT id FROM subscription_invoices WHERE subscription_id = ? AND invoice_number = ? LIMIT 1',
    [subscriptionId, invoiceNumber],
  );
  if (dup) throw billingError(409, 'INVOICE_EXISTS', 'Nomor invoice ini sudah tercatat pada langganan ini', { invoiceId: Number(dup.id) });

  const uploaded = file ? await drive.uploadFile({ name: file.originalname, mimeType: file.mimetype, buffer: file.buffer }) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let documentId = null;
    if (uploaded) {
      const [doc] = await conn.query(
        `INSERT INTO documents (entity_id, department_id, title, document_type, status, drive_file_id, drive_folder_id, created_by)
         VALUES (?, ?, ?, 'invoice', 'final', ?, NULL, ?)`,
        [sub.entity_id, sub.department_id, `Invoice ${invoiceNumber} - ${sub.product_name}`, uploaded.id, actorId],
      );
      documentId = doc.insertId;
    }
    const status = uploaded ? 'uploaded' : 'pending_upload';
    const [inv] = await conn.query(
      `INSERT INTO subscription_invoices
         (subscription_id, invoice_number, invoice_date, amount, currency, tax_amount, total_amount,
          status, document_id, jurnal_reference_id, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${uploaded ? 'NOW()' : 'NULL'})`,
      [subscriptionId, invoiceNumber, invoiceDate, amounts.amount, currency, amounts.taxAmount, amounts.totalAmount,
        status, documentId, body.jurnalReferenceId || null, uploaded ? actorId : null],
    );
    await logWith(conn, {
      entityId: Number(sub.entity_id), userId: actorId,
      action: uploaded ? 'subscription_invoice.upload' : 'subscription_invoice.record', subjectType: 'subscription_invoice',
      subjectId: inv.insertId, metadata: { invoiceNumber, subscriptionId: Number(subscriptionId), status },
    });
    await conn.commit();
    return { id: Number(inv.insertId), status, documentId, webViewLink: uploaded?.webViewLink || null };
  } catch (error) {
    await conn.rollback().catch(() => {});
    // The file reached Drive but the record did not: remove it so no orphan
    // file looks like a recorded invoice (best effort).
    if (uploaded?.id) await drive.deleteFile(uploaded.id).catch(() => {});
    if (error && error.code === 'ER_DUP_ENTRY') throw billingError(409, 'INVOICE_EXISTS', 'Nomor invoice ini sudah tercatat pada langganan ini');
    throw error;
  } finally {
    conn.release();
  }
}

/** Attach the PDF to an invoice recorded without one: pending_upload → uploaded. */
async function attachInvoiceFile({ entityId, invoiceId, actorId, file, drive }) {
  if (!file) throw billingError(400, 'VALIDATION_ERROR', 'Pilih file PDF invoice');
  if (file.mimetype !== 'application/pdf') throw billingError(400, 'INVOICE_NOT_PDF', 'File invoice harus PDF');
  const [[inv]] = await pool.query(
    `SELECT i.*, s.entity_id, s.department_id, s.product_name FROM subscription_invoices i
       JOIN software_subscriptions s ON s.id = i.subscription_id AND s.deleted_at IS NULL
      WHERE i.id = ? AND s.entity_id = ?`,
    [invoiceId, entityId],
  );
  if (!inv) throw billingError(404, 'NOT_FOUND', 'Invoice tidak ditemukan');
  if (inv.document_id) throw billingError(409, 'INVOICE_HAS_FILE', 'Invoice ini sudah memiliki file');
  if (inv.status === 'void') throw billingError(409, 'INVOICE_VOID', 'Invoice ini sudah dibatalkan (void)');

  const uploaded = await drive.uploadFile({ name: file.originalname, mimeType: file.mimetype, buffer: file.buffer });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [doc] = await conn.query(
      `INSERT INTO documents (entity_id, department_id, title, document_type, status, drive_file_id, drive_folder_id, created_by)
       VALUES (?, ?, ?, 'invoice', 'final', ?, NULL, ?)`,
      [inv.entity_id, inv.department_id, `Invoice ${inv.invoice_number} - ${inv.product_name}`, uploaded.id, actorId],
    );
    // A paid invoice keeps "paid"; an unpaid one without a file becomes "uploaded".
    const [r] = await conn.query(
      `UPDATE subscription_invoices
          SET document_id = ?, uploaded_by = ?, uploaded_at = NOW(),
              status = IF(status = 'pending_upload', 'uploaded', status)
        WHERE id = ? AND document_id IS NULL AND status <> 'void'`,
      [doc.insertId, actorId, invoiceId],
    );
    if (!r.affectedRows) throw billingError(409, 'INVOICE_HAS_FILE', 'Invoice ini baru saja berubah. Muat ulang lalu coba lagi.');
    await logWith(conn, {
      entityId: Number(inv.entity_id), userId: actorId, action: 'subscription_invoice.upload',
      subjectType: 'subscription_invoice', subjectId: Number(invoiceId), metadata: { attachedLater: true },
    });
    await conn.commit();
    return { id: Number(invoiceId), documentId: Number(doc.insertId), webViewLink: uploaded.webViewLink || null };
  } catch (error) {
    await conn.rollback().catch(() => {});
    await drive.deleteFile(uploaded.id).catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// Which check may follow which status: verified only after the PDF is in;
// void never after payment.
function verifyAllowed(invoice, next, hasPayments) {
  if (next === 'verified') {
    if (invoice.status !== 'uploaded') {
      return invoice.status === 'pending_upload' ? 'Unggah PDF invoice dulu sebelum diverifikasi.' : `Invoice berstatus ${invoice.status} tidak dapat diverifikasi.`;
    }
    return null;
  }
  if (next === 'void') {
    if (invoice.status === 'paid') return 'Invoice yang sudah lunas tidak dapat dibatalkan (void).';
    if (invoice.status === 'void') return 'Invoice ini sudah void.';
    if (hasPayments) return 'Invoice yang sudah memiliki pembayaran tercatat tidak dapat dibatalkan (void).';
    return null;
  }
  return 'Status tidak dikenal';
}

async function verifyInvoice({ entityId, invoiceId, actorId, status }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[inv]] = await conn.query(
      `SELECT i.* FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE i.id = ? AND s.entity_id = ? FOR UPDATE`,
      [invoiceId, entityId],
    );
    if (!inv) throw billingError(404, 'NOT_FOUND', 'Invoice tidak ditemukan');
    const hasPayments = (await paidCentsOf(conn, invoiceId)) > 0;
    const refusal = verifyAllowed(inv, status, hasPayments);
    if (refusal) throw billingError(409, 'INVALID_TRANSITION', refusal);
    await conn.query(
      'UPDATE subscription_invoices SET status = ?, verified_by = ?, verified_at = NOW() WHERE id = ?',
      [status, actorId, invoiceId],
    );
    await logWith(conn, {
      entityId, userId: actorId, action: 'subscription_invoice.verify', subjectType: 'subscription_invoice',
      subjectId: Number(invoiceId), metadata: { from: inv.status, status },
    });
    await conn.commit();
    return { id: Number(invoiceId), status };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  PAYABLE_STATUSES, toCents, fromCents, normalizeCurrency, validDate, todayWib, paymentState, validateInvoiceAmounts,
  verifyAllowed, recordPayment, recordInvoice, attachInvoiceFile, verifyInvoice,
};
