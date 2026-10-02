// Utang (accounts payable) for Finance: purchase invoices and purchase
// payments from approved Accurate data (fin_purchase_invoices_accurate,
// fin_purchase_payments_accurate; the 'finance' pull, ACCURATE_FINANCE=1).
// Read only. Until the Finance Supervisor/Head approves the first Finance
// batch, every figure answers { ready: false, reason } — nothing is guessed.
//
// Rules: rupiah as Accurate owes it (primeOwing, including PPN). Invoices in
// another currency are counted, never added to rupiah; down-payment invoices
// are left out of the figures (as in Sales) and counted on their own.
// `departmentId` exists for the management provider: utang belongs to the
// Finance division, so another division's scope reads nothing.
const pool = require('../db/pool');
const { scope } = require('../management/helpers');
const {
  BUCKETS, TODAY, DUE_SOON_DAYS, OVER_DAYS, MONTHS, bucketSql, agingFromRows, windowStart, fillMonths, money, int, dateOnly,
} = require('./financeAging');
const { todayWib } = require('../utils/wibTime');

const NOT_READY = 'Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance';
// Owed in rupiah, not a down payment.
const OPEN = "NOT p.is_dp AND p.outstanding_amount > 0 AND p.currency = 'IDR'";
const OVERDUE = `p.due_date < ${TODAY}`;
const notReady = (state) => ({ ready: false, reason: NOT_READY, enabled: state.enabled, pending: state.pending });

// The latest applied and pending Finance batch (the Procurement status pattern).
async function status(entityId) {
  const [[applied]] = await pool.query(
    `SELECT b.id, b.decided_at, b.applied_at, u.name AS decided_by, r.started_at AS pulled_at
       FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'finance'
       LEFT JOIN users u ON u.id = b.decided_by
       LEFT JOIN sales_sync_runs r ON r.id = b.sync_run_id
      WHERE b.entity_id = ? AND b.status = 'applied'
      ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  const [[pending]] = await pool.query(
    `SELECT b.id, b.item_count, b.created_at FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'finance'
      WHERE b.entity_id = ? AND b.status = 'pending' ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  return {
    ready: Boolean(applied),
    enabled: process.env.ACCURATE_FINANCE === '1',
    asOf: applied ? { batchId: Number(applied.id), pulledAt: applied.pulled_at || null, approvedAt: applied.decided_at || applied.applied_at, approvedBy: applied.decided_by || null } : null,
    pending: pending ? { batchId: Number(pending.id), items: int(pending.item_count), createdAt: pending.created_at } : null,
  };
}

// Every public read: the figures only once the first Finance batch is approved.
const gated = (fn) => async (entityId, opts = {}) => {
  const state = await status(entityId);
  if (!state.ready) return notReady(state);
  return { ready: true, asOf: state.asOf, ...(await fn(entityId, opts)) };
};

async function summaryData(entityId, { departmentId = null } = {}) {
  const s = scope(departmentId, 'p.department_id');
  const [[open]] = await pool.query(
    `SELECT COALESCE(SUM(${OPEN}), 0) AS invoices,
            COUNT(DISTINCT CASE WHEN ${OPEN} THEN p.vendor_no END) AS vendors,
            COALESCE(SUM(CASE WHEN ${OPEN} THEN p.outstanding_amount END), 0) AS outstanding,
            COALESCE(SUM(${OPEN} AND ${OVERDUE}), 0) AS overdue_invoices,
            COALESCE(SUM(CASE WHEN ${OPEN} AND ${OVERDUE} THEN p.outstanding_amount END), 0) AS overdue_amount,
            COALESCE(SUM(${OPEN} AND DATEDIFF(${TODAY}, p.due_date) > ${OVER_DAYS}), 0) AS over90_invoices,
            COALESCE(SUM(CASE WHEN ${OPEN} AND DATEDIFF(${TODAY}, p.due_date) > ${OVER_DAYS} THEN p.outstanding_amount END), 0) AS over90_amount,
            COALESCE(SUM(${OPEN} AND p.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY), 0) AS due_soon_invoices,
            COALESCE(SUM(CASE WHEN ${OPEN} AND p.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY THEN p.outstanding_amount END), 0) AS due_soon_amount,
            COALESCE(SUM(NOT p.is_dp AND p.outstanding_amount > 0 AND p.currency <> 'IDR'), 0) AS non_idr,
            COALESCE(SUM(p.is_dp AND p.outstanding_amount > 0), 0) AS dp_open
       FROM fin_purchase_invoices_accurate p
      WHERE p.entity_id = ?${s.sql}`,
    [entityId, ...s.args],
  );
  const sp = scope(departmentId, 'y.department_id');
  const [[paid]] = await pool.query(
    `SELECT COUNT(*) AS payments, COALESCE(SUM(y.total_amount), 0) AS amount
       FROM fin_purchase_payments_accurate y
      WHERE y.entity_id = ?${sp.sql} AND y.currency = 'IDR'
        AND y.trans_date BETWEEN DATE_FORMAT(${TODAY}, '%Y-%m-01') AND ${TODAY}`,
    [entityId, ...sp.args],
  );
  return {
    summary: {
      invoices: int(open?.invoices),
      vendors: int(open?.vendors),
      outstanding: money(open?.outstanding),
      overdue: { invoices: int(open?.overdue_invoices), amount: money(open?.overdue_amount) },
      over90: { invoices: int(open?.over90_invoices), amount: money(open?.over90_amount) },
      dueSoon: { days: DUE_SOON_DAYS, invoices: int(open?.due_soon_invoices), amount: money(open?.due_soon_amount) },
      paidThisMonth: { amount: money(paid?.amount), payments: int(paid?.payments) },
      nonIdrOpen: int(open?.non_idr),
      downPaymentsOpen: int(open?.dp_open),
    },
  };
}

async function agingData(entityId, { departmentId = null } = {}) {
  const s = scope(departmentId, 'p.department_id');
  const [rows] = await pool.query(
    `SELECT ${bucketSql('p.due_date')} AS bucket, COUNT(*) AS invoices, SUM(p.outstanding_amount) AS amount
       FROM fin_purchase_invoices_accurate p
      WHERE p.entity_id = ?${s.sql} AND ${OPEN}
      GROUP BY bucket`,
    [entityId, ...s.args],
  );
  const out = agingFromRows(rows);
  return { aging: { buckets: out.buckets, total: out.total } };
}

// Vendors owed the most: what the next payment runs must cover.
async function vendorsData(entityId, { departmentId = null, limit = 20 } = {}) {
  const s = scope(departmentId, 'p.department_id');
  const [rows] = await pool.query(
    `SELECT p.vendor_no, MAX(p.vendor_name) AS vendor_name, COUNT(*) AS invoices, SUM(p.outstanding_amount) AS outstanding,
            SUM(${OVERDUE}) AS overdue_invoices,
            COALESCE(SUM(CASE WHEN ${OVERDUE} THEN p.outstanding_amount END), 0) AS overdue_amount,
            MAX(CASE WHEN ${OVERDUE} THEN DATEDIFF(${TODAY}, p.due_date) END) AS oldest_days,
            MIN(CASE WHEN p.due_date >= ${TODAY} THEN p.due_date END) AS next_due
       FROM fin_purchase_invoices_accurate p
      WHERE p.entity_id = ?${s.sql} AND ${OPEN}
      GROUP BY p.vendor_no
      ORDER BY outstanding DESC, p.vendor_no
      LIMIT ?`,
    [entityId, ...s.args, Math.min(Math.max(int(limit), 1), 100)],
  );
  return {
    vendors: rows.map((r) => ({
      vendorNo: r.vendor_no,
      vendorName: r.vendor_name || r.vendor_no,
      invoices: int(r.invoices),
      outstanding: money(r.outstanding),
      overdueInvoices: int(r.overdue_invoices),
      overdueAmount: money(r.overdue_amount),
      oldestDays: r.oldest_days == null ? null : int(r.oldest_days),
      nextDue: dateOnly(r.next_due),
    })),
  };
}

const invoiceDto = (r) => ({
  id: Number(r.id),
  invoiceNumber: r.invoice_number,
  date: dateOnly(r.trans_date),
  dueDate: dateOnly(r.due_date),
  vendorNo: r.vendor_no,
  vendorName: r.vendor_name || r.vendor_no,
  term: r.term_name || null,
  total: money(r.total_amount),
  outstanding: money(r.outstanding_amount),
  days: Number(r.days) || 0,
});
const INVOICE_COLUMNS = 'p.id, p.invoice_number, p.trans_date, p.due_date, p.vendor_no, p.vendor_name, p.term_name, p.total_amount, p.outstanding_amount';

// Due in the next two weeks (days = days left).
async function dueSoonData(entityId, { departmentId = null, days = DUE_SOON_DAYS, limit = 50 } = {}) {
  const s = scope(departmentId, 'p.department_id');
  const [rows] = await pool.query(
    `SELECT ${INVOICE_COLUMNS}, DATEDIFF(p.due_date, ${TODAY}) AS days
       FROM fin_purchase_invoices_accurate p
      WHERE p.entity_id = ?${s.sql} AND ${OPEN}
        AND p.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ? DAY
      ORDER BY p.due_date, p.outstanding_amount DESC, p.id
      LIMIT ?`,
    [entityId, ...s.args, Math.min(Math.max(int(days), 1), 60), Math.min(Math.max(int(limit), 1), 200)],
  );
  return { dueSoon: rows.map(invoiceDto) };
}

// Past due and unpaid, oldest first (days = days late).
async function overdueData(entityId, { departmentId = null, limit = 50 } = {}) {
  const s = scope(departmentId, 'p.department_id');
  const [rows] = await pool.query(
    `SELECT ${INVOICE_COLUMNS}, DATEDIFF(${TODAY}, p.due_date) AS days
       FROM fin_purchase_invoices_accurate p
      WHERE p.entity_id = ?${s.sql} AND ${OPEN} AND ${OVERDUE}
      ORDER BY p.due_date, p.outstanding_amount DESC, p.id
      LIMIT ?`,
    [entityId, ...s.args, Math.min(Math.max(int(limit), 1), 200)],
  );
  return { overdue: rows.map(invoiceDto) };
}

// Pembayaran pembelian per month, the last 12 months (this month so far included).
async function paymentsData(entityId, { departmentId = null, today = todayWib() } = {}) {
  const s = scope(departmentId, 'y.department_id');
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(y.trans_date, '%Y-%m') AS month, COUNT(*) AS count, SUM(y.total_amount) AS amount
       FROM fin_purchase_payments_accurate y
      WHERE y.entity_id = ?${s.sql} AND y.currency = 'IDR' AND y.trans_date BETWEEN ? AND ${TODAY}
      GROUP BY month`,
    [entityId, ...s.args, windowStart(today, MONTHS)],
  );
  return { payments: fillMonths(rows, today, MONTHS) };
}

// Everything the Utang page shows, in one answer.
async function overviewData(entityId) {
  const parts = await Promise.all([
    summaryData(entityId), agingData(entityId), vendorsData(entityId), dueSoonData(entityId), overdueData(entityId), paymentsData(entityId),
  ]);
  return Object.assign({}, ...parts);
}

module.exports = {
  BUCKETS, NOT_READY, status,
  summary: gated(summaryData),
  aging: gated(agingData),
  vendors: gated(vendorsData),
  dueSoon: gated(dueSoonData),
  overdue: gated(overdueData),
  payments: gated(paymentsData),
  overview: gated(overviewData),
  // Ungated reads, for the management provider (which checks readiness itself).
  data: { summaryData, agingData, vendorsData, dueSoonData, overdueData, paymentsData },
};
