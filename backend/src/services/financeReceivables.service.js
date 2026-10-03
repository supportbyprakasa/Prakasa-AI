// Piutang (accounts receivable) for Finance, from the Sales invoices and
// receipts already mirrored from Accurate and approved by Sales / Retail
// Commerce (sales_invoices_accurate, sales_receipts_accurate). Read only:
// nothing is pulled, stored or changed here.
//
// Finance sees the whole company (every division's customers). `departmentId`
// narrows to one selling division for the management provider; the route
// never passes one.
//
// Rules (as the Sales module): rupiah as Accurate owes it (outstanding,
// including PPN); down-payment invoices (is_dp) are left out of every figure
// and counted on their own; buckets as Sales' "Umur piutang".
const pool = require('../db/pool');
const { openReceivableSql } = require('./invoiceRules');
const { scope } = require('../management/helpers');
const {
  BUCKETS, TODAY, DUE_SOON_DAYS, OVER_DAYS, MONTHS, bucketSql, agingFromRows, windowStart, fillMonths, dso, money, int, dateOnly,
} = require('./financeAging');
const { todayWib } = require('../utils/wibTime');

const OPEN = openReceivableSql('i');
const DSO_DAYS = 90;
const NOT_READY = 'Belum ada faktur penjualan Accurate yang disetujui Supervisor/Head Sales atau Retail Commerce.';
const OVERDUE = `i.due_date < ${TODAY}`;

// Whether any approved Accurate invoice exists, and when Sales data last moved.
async function status(entityId) {
  const [[row]] = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM accurate_records r WHERE r.entity_id = ? AND r.record_type = 'sales_invoice') AS live,
            (SELECT MAX(COALESCE(b.applied_at, b.decided_at)) FROM sales_accurate_batches b
               JOIN departments d ON d.id = b.department_id AND d.code IN ('sales', 'retail_commerce')
              WHERE b.entity_id = ? AND b.status = 'applied') AS applied_at`,
    [entityId, entityId],
  );
  const ready = Boolean(Number(row?.live));
  return { ready, asOf: row?.applied_at || null, ...(ready ? {} : { reason: NOT_READY }) };
}

async function summary(entityId, { departmentId = null } = {}) {
  const s = scope(departmentId, 'i.department_id');
  const [[open]] = await pool.query(
    `SELECT COUNT(*) AS invoices, COUNT(DISTINCT i.customer_code) AS customers,
            COALESCE(SUM(i.outstanding_amount), 0) AS outstanding,
            COALESCE(SUM(${OVERDUE}), 0) AS overdue_invoices,
            COALESCE(SUM(CASE WHEN ${OVERDUE} THEN i.outstanding_amount END), 0) AS overdue_amount,
            COALESCE(SUM(DATEDIFF(${TODAY}, i.due_date) > ${OVER_DAYS}), 0) AS over90_invoices,
            COALESCE(SUM(CASE WHEN DATEDIFF(${TODAY}, i.due_date) > ${OVER_DAYS} THEN i.outstanding_amount END), 0) AS over90_amount,
            COALESCE(SUM(i.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY), 0) AS due_soon_invoices,
            COALESCE(SUM(CASE WHEN i.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY THEN i.outstanding_amount END), 0) AS due_soon_amount
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${s.sql} AND ${OPEN}`,
    [entityId, ...s.args],
  );
  const sr = scope(departmentId, 'r.department_id');
  const [[flow]] = await pool.query(
    `SELECT (SELECT COALESCE(SUM(r.total_amount), 0) FROM sales_receipts_accurate r
              WHERE r.entity_id = ?${sr.sql}
                AND r.trans_date BETWEEN DATE_FORMAT(${TODAY}, '%Y-%m-01') AND ${TODAY}) AS collected_month,
            (SELECT COUNT(*) FROM sales_receipts_accurate r
              WHERE r.entity_id = ?${sr.sql}
                AND r.trans_date BETWEEN DATE_FORMAT(${TODAY}, '%Y-%m-01') AND ${TODAY}) AS receipts_month,
            (SELECT COALESCE(SUM(i.total_amount), 0) FROM sales_invoices_accurate i
              WHERE i.entity_id = ?${s.sql} AND NOT i.is_dp
                AND i.trans_date BETWEEN ${TODAY} - INTERVAL ${DSO_DAYS - 1} DAY AND ${TODAY}) AS billed_90,
            (SELECT COUNT(*) FROM sales_invoices_accurate i
              WHERE i.entity_id = ?${s.sql} AND i.is_dp AND i.outstanding_amount > 0) AS dp_open`,
    [entityId, ...sr.args, entityId, ...sr.args, entityId, ...s.args, entityId, ...s.args],
  );
  const outstanding = money(open?.outstanding);
  return {
    invoices: int(open?.invoices),
    customers: int(open?.customers),
    outstanding,
    overdue: { invoices: int(open?.overdue_invoices), amount: money(open?.overdue_amount) },
    over90: { invoices: int(open?.over90_invoices), amount: money(open?.over90_amount) },
    dueSoon: { days: DUE_SOON_DAYS, invoices: int(open?.due_soon_invoices), amount: money(open?.due_soon_amount) },
    collectedThisMonth: { amount: money(flow?.collected_month), receipts: int(flow?.receipts_month) },
    // Estimated DSO: owed now ÷ billed (incl. PPN, as owed) in the last 90 days × 90.
    dso: { days: dso(outstanding, flow?.billed_90, DSO_DAYS), window: DSO_DAYS, billed: money(flow?.billed_90) },
    downPaymentsOpen: int(flow?.dp_open),
  };
}

// Buckets overall and per channel (Sales' channels: GT, MT, HoReCa, Shopee, …).
async function aging(entityId, { departmentId = null } = {}) {
  const s = scope(departmentId, 'i.department_id');
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(i.channel, ''), 'Lainnya') AS grp, ${bucketSql('i.due_date')} AS bucket,
            COUNT(*) AS invoices, SUM(i.outstanding_amount) AS amount
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${s.sql} AND ${OPEN}
      GROUP BY grp, bucket`,
    [entityId, ...s.args],
  );
  const out = agingFromRows(rows.map((r) => ({ group: r.grp, bucket: r.bucket, invoices: r.invoices, amount: r.amount })));
  return { buckets: out.buckets, total: out.total, channels: out.groups.map((g) => ({ channel: g.name, total: g.total, buckets: g.buckets })) };
}

// Customers with the most money past due: what Finance chases first.
async function customers(entityId, { departmentId = null, limit = 20 } = {}) {
  const s = scope(departmentId, 'i.department_id');
  const [rows] = await pool.query(
    `SELECT i.customer_code, MAX(i.customer_name) AS customer_name, MAX(i.customer_id) AS customer_id, MAX(i.channel) AS channel,
            MAX(i.sales_person_name) AS sales_person_name,
            COUNT(*) AS invoices, SUM(i.outstanding_amount) AS outstanding,
            SUM(${OVERDUE}) AS overdue_invoices,
            COALESCE(SUM(CASE WHEN ${OVERDUE} THEN i.outstanding_amount END), 0) AS overdue_amount,
            MAX(CASE WHEN ${OVERDUE} THEN DATEDIFF(${TODAY}, i.due_date) END) AS oldest_days,
            MIN(CASE WHEN ${OVERDUE} THEN i.due_date END) AS oldest_due
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${s.sql} AND ${OPEN}
      GROUP BY i.customer_code
     HAVING overdue_amount > 0
      ORDER BY overdue_amount DESC, oldest_days DESC, i.customer_code
      LIMIT ?`,
    [entityId, ...s.args, Math.min(Math.max(int(limit), 1), 100)],
  );
  return rows.map((r) => ({
    customerCode: r.customer_code,
    customerName: r.customer_name,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    channel: r.channel,
    salesPersonName: r.sales_person_name || null,
    invoices: int(r.invoices),
    outstanding: money(r.outstanding),
    overdueInvoices: int(r.overdue_invoices),
    overdueAmount: money(r.overdue_amount),
    oldestDays: int(r.oldest_days),
    oldestDue: dateOnly(r.oldest_due),
  }));
}

// Invoices falling due in the next two weeks: who to remind before they are late.
async function dueSoon(entityId, { departmentId = null, days = DUE_SOON_DAYS, limit = 50 } = {}) {
  const s = scope(departmentId, 'i.department_id');
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_number, i.trans_date, i.due_date, i.customer_code, i.customer_name, i.customer_id, i.channel,
            i.sales_person_name, i.total_amount, i.outstanding_amount, DATEDIFF(i.due_date, ${TODAY}) AS days_left
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${s.sql} AND ${OPEN}
        AND i.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ? DAY
      ORDER BY i.due_date, i.outstanding_amount DESC, i.id
      LIMIT ?`,
    [entityId, ...s.args, Math.min(Math.max(int(days), 1), 60), Math.min(Math.max(int(limit), 1), 200)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    invoiceNumber: r.invoice_number,
    date: dateOnly(r.trans_date),
    dueDate: dateOnly(r.due_date),
    customerCode: r.customer_code,
    customerName: r.customer_name,
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    channel: r.channel,
    salesPersonName: r.sales_person_name || null,
    total: money(r.total_amount),
    outstanding: money(r.outstanding_amount),
    daysLeft: int(r.days_left),
  }));
}

// Penerimaan per month, the last 12 months (this month so far included).
async function collections(entityId, { departmentId = null, today = todayWib() } = {}) {
  const s = scope(departmentId, 'r.department_id');
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(r.trans_date, '%Y-%m') AS month, COUNT(*) AS count, SUM(r.total_amount) AS amount
       FROM sales_receipts_accurate r
      WHERE r.entity_id = ?${s.sql} AND r.trans_date BETWEEN ? AND ${TODAY}
      GROUP BY month`,
    [entityId, ...s.args, windowStart(today, MONTHS)],
  );
  return fillMonths(rows, today, MONTHS);
}

// Everything the Piutang page shows, in one answer.
async function overview(entityId) {
  const state = await status(entityId);
  if (!state.ready) return { ready: false, reason: state.reason };
  const [sum, age, top, soon, months] = await Promise.all([
    summary(entityId), aging(entityId), customers(entityId), dueSoon(entityId), collections(entityId),
  ]);
  return { ready: true, asOf: state.asOf, summary: sum, aging: age, customers: top, dueSoon: soon, collections: months };
}

module.exports = { BUCKETS, NOT_READY, status, summary, aging, customers, dueSoon, collections, overview };
