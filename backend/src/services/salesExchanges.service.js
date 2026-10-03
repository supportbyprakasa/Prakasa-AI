// Tukar faktur (program 2.3). Accurate holds none, so Sales records it here
// against the approved Accurate invoice: handed over on, tanda terima number,
// promised pay date. Which invoices need it (recommended default, until the
// owner decides otherwise): credit invoices — due after the invoice date —
// that still have money owed. A record is never deleted; cancelling keeps it.
const pool = require('../db/pool');
const { accurateScope } = require('./salesFacts');
const { log } = require('./activityLog.service');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
// An invoice is due for tukar faktur this many days after its date…
const EXCHANGE_AFTER_DAYS = 7;
// …and only recent ones escalate (older open invoices are the backlog of the
// Accurate opening balance, followed in "Umur piutang").
const EXCHANGE_WINDOW_DAYS = 60;
const CREDIT = 'i.due_date > i.trans_date';
const STATUSES = Object.freeze(['pending', 'done']);

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar date (2026-02-31 is not), so MySQL never refuses it.
const isDate = (v) => DATE_RE.test(String(v || '')) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

const JOIN = `LEFT JOIN sales_invoice_exchanges x ON x.entity_id = i.entity_id AND x.live_invoice = i.invoice_number COLLATE utf8mb4_unicode_ci`;

const dto = (r) => ({
  invoiceNumber: r.invoice_number, date: r.trans_date, dueDate: r.due_date, termDays: Number(r.term_days),
  customerName: r.customer_name, customerCode: r.customer_code, channel: r.channel, salesPersonName: r.sales_person_name,
  outstandingAmount: money(r.outstanding_amount), totalAmount: money(r.total_amount),
  daysSinceInvoice: Number(r.days_since),
  exchange: r.x_id ? {
    id: Number(r.x_id), exchangedOn: r.exchanged_on, receiptNo: r.receipt_no, promisedPayDate: r.promised_pay_date, note: r.note,
  } : null,
});

async function list(user, { status = 'pending', q = '', page = 1, limit = 25 } = {}) {
  const sc = accurateScope(user, 'i');
  const base = [`i.entity_id = ?${sc.sql}`, CREDIT];
  const args = [user.entityId, ...sc.args];
  if (q) { base.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_code LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const pending = 'x.id IS NULL AND i.outstanding_amount > 0';
  const which = status === 'done' ? 'x.id IS NOT NULL' : pending;
  const [rows] = await pool.query(
    `SELECT i.invoice_number, i.trans_date, i.due_date, DATEDIFF(i.due_date, i.trans_date) AS term_days, i.customer_name, i.customer_code,
            i.channel, i.sales_person_name, i.outstanding_amount, i.total_amount, DATEDIFF(${TODAY}, i.trans_date) AS days_since,
            x.id AS x_id, x.exchanged_on, x.receipt_no, x.promised_pay_date, x.note
       FROM sales_invoices_accurate i ${JOIN}
      WHERE ${base.join(' AND ')} AND ${which}
      ORDER BY ${status === 'done' ? 'x.exchanged_on DESC' : 'i.trans_date DESC'}, i.invoice_number
      LIMIT ? OFFSET ?`,
    [...args, limit, (page - 1) * limit],
  );
  const [[counts]] = await pool.query(
    `SELECT COALESCE(SUM(${pending}), 0) AS pending, COALESCE(SUM(x.id IS NOT NULL), 0) AS done
       FROM sales_invoices_accurate i ${JOIN} WHERE ${base.join(' AND ')}`,
    args,
  );
  return {
    items: rows.map(dto),
    total: Number(status === 'done' ? counts.done : counts.pending),
    counts: { pending: Number(counts.pending), done: Number(counts.done) },
  };
}

// The invoice, as this user may see it, and whether it is a credit invoice.
async function visibleInvoice(user, invoiceNumber) {
  const sc = accurateScope(user, 'i');
  const [[inv]] = await pool.query(
    `SELECT i.invoice_number, i.customer_code, ${CREDIT} AS credit FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${sc.sql} AND i.invoice_number = ? LIMIT 1`,
    [user.entityId, ...sc.args, invoiceNumber],
  );
  if (!inv) throw httpError(404, 'NOT_FOUND', 'Faktur tidak ditemukan');
  if (!Number(inv.credit)) throw httpError(400, 'VALIDATION_ERROR', 'Faktur ini tunai (jatuh tempo di hari faktur), tidak perlu tukar faktur');
  return inv;
}

function fields(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.exchangedOn !== undefined) {
    if (!isDate(input.exchangedOn)) throw httpError(400, 'VALIDATION_ERROR', 'Tanggal tukar faktur wajib (YYYY-MM-DD)');
    out.exchanged_on = input.exchangedOn;
  }
  if (input.promisedPayDate !== undefined) {
    if (input.promisedPayDate && !isDate(input.promisedPayDate)) throw httpError(400, 'VALIDATION_ERROR', 'Tanggal janji bayar tidak valid');
    if (input.promisedPayDate && out.exchanged_on && input.promisedPayDate < out.exchanged_on) {
      throw httpError(400, 'VALIDATION_ERROR', 'Janji bayar tidak boleh sebelum tanggal tukar faktur');
    }
    out.promised_pay_date = input.promisedPayDate || null;
  }
  if (input.receiptNo !== undefined) out.receipt_no = String(input.receiptNo || '').trim().slice(0, 80) || null;
  if (input.note !== undefined) out.note = String(input.note || '').trim().slice(0, 255) || null;
  return out;
}

async function record(user, input) {
  const inv = await visibleInvoice(user, String(input.invoiceNumber || '').trim());
  const f = fields(input);
  try {
    const [r] = await pool.query(
      `INSERT INTO sales_invoice_exchanges (entity_id, invoice_number, customer_code, exchanged_on, receipt_no, promised_pay_date, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.entityId, inv.invoice_number, inv.customer_code, f.exchanged_on, f.receipt_no ?? null, f.promised_pay_date ?? null, f.note ?? null, user.sub],
    );
    await log({ entityId: user.entityId, userId: user.sub, action: 'sales.invoice_exchange.create', subjectType: 'sales_invoice_exchange', subjectId: r.insertId, metadata: { invoice: inv.invoice_number } }).catch(() => {});
    return { id: r.insertId };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw httpError(409, 'CONFLICT', 'Tukar faktur untuk faktur ini sudah dicatat');
    throw e;
  }
}

async function liveRecord(user, id) {
  const [[x]] = await pool.query('SELECT id, invoice_number FROM sales_invoice_exchanges WHERE id = ? AND entity_id = ? AND cancelled_at IS NULL LIMIT 1', [id, user.entityId]);
  if (!x) throw httpError(404, 'NOT_FOUND', 'Catatan tukar faktur tidak ditemukan');
  await visibleInvoice(user, x.invoice_number);
  return x;
}

async function update(user, id, input) {
  const x = await liveRecord(user, id);
  const f = fields(input, { partial: true });
  const keys = Object.keys(f);
  if (!keys.length) return { id };
  await pool.query(
    `UPDATE sales_invoice_exchanges SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE id = ?`,
    [...keys.map((k) => f[k]), user.sub, id],
  );
  await log({ entityId: user.entityId, userId: user.sub, action: 'sales.invoice_exchange.update', subjectType: 'sales_invoice_exchange', subjectId: id, metadata: { invoice: x.invoice_number, fields: keys } }).catch(() => {});
  return { id };
}

async function cancel(user, id) {
  const x = await liveRecord(user, id);
  await pool.query('UPDATE sales_invoice_exchanges SET cancelled_at = NOW(), cancelled_by = ? WHERE id = ? AND cancelled_at IS NULL', [user.sub, id]);
  await log({ entityId: user.entityId, userId: user.sub, action: 'sales.invoice_exchange.cancel', subjectType: 'sales_invoice_exchange', subjectId: id, metadata: { invoice: x.invoice_number } }).catch(() => {});
  return { id };
}

module.exports = { STATUSES, EXCHANGE_AFTER_DAYS, EXCHANGE_WINDOW_DAYS, CREDIT, list, record, update, cancel };
