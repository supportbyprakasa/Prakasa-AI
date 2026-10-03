// Umur piutang per syarat bayar (program 2.3), from approved Accurate invoices.
// The payment term is read from the invoice itself (due date − invoice date, as
// Accurate computes it), so nothing new is pulled. Only invoices with money
// still owed; rupiah as Accurate owes it (outstanding, including PPN).
const pool = require('../db/pool');
const { accurateScope } = require('./salesFacts');
const { openReceivableSql } = require('./invoiceRules');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const BUCKETS = Object.freeze([
  { key: 'current', label: 'Belum jatuh tempo' },
  { key: 'd1_30', label: '1–30 hari' },
  { key: 'd31_60', label: '31–60 hari' },
  { key: 'd61_90', label: '61–90 hari' },
  { key: 'd90_plus', label: '> 90 hari' },
]);
const BUCKET_SQL = `CASE WHEN i.due_date IS NULL OR i.due_date >= ${TODAY} THEN 'current'
    WHEN DATEDIFF(${TODAY}, i.due_date) <= 30 THEN 'd1_30'
    WHEN DATEDIFF(${TODAY}, i.due_date) <= 60 THEN 'd31_60'
    WHEN DATEDIFF(${TODAY}, i.due_date) <= 90 THEN 'd61_90'
    ELSE 'd90_plus' END`;
const TERM_SQL = 'GREATEST(COALESCE(DATEDIFF(i.due_date, i.trans_date), 0), 0)';
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

// Rows: payment terms (in days); columns: how late. Optional one customer.
async function aging(user, { customerId = null } = {}) {
  const sc = accurateScope(user, 'i');
  const cust = customerId ? { sql: ' AND i.customer_id = ?', args: [customerId] } : { sql: '', args: [] };
  const [rows] = await pool.query(
    `SELECT ${TERM_SQL} AS term_days, ${BUCKET_SQL} AS bucket, COUNT(*) AS invoices, SUM(i.outstanding_amount) AS outstanding
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${sc.sql}${cust.sql} AND ${openReceivableSql('i')}
      GROUP BY term_days, bucket`,
    [user.entityId, ...sc.args, ...cust.args],
  );
  const terms = new Map();
  const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, { invoices: 0, outstanding: 0 }]));
  for (const r of rows) {
    const t = Number(r.term_days);
    if (!terms.has(t)) terms.set(t, { termDays: t, total: { invoices: 0, outstanding: 0 }, buckets: Object.fromEntries(BUCKETS.map((b) => [b.key, { invoices: 0, outstanding: 0 }])) });
    const e = terms.get(t);
    e.buckets[r.bucket] = { invoices: Number(r.invoices), outstanding: money(r.outstanding) };
    e.total.invoices += Number(r.invoices);
    e.total.outstanding = money(e.total.outstanding + Number(r.outstanding));
    totals[r.bucket].invoices += Number(r.invoices);
    totals[r.bucket].outstanding = money(totals[r.bucket].outstanding + Number(r.outstanding));
  }
  const grand = Object.values(totals).reduce((a, b) => ({ invoices: a.invoices + b.invoices, outstanding: money(a.outstanding + b.outstanding) }), { invoices: 0, outstanding: 0 });
  return { buckets: BUCKETS, terms: [...terms.values()].sort((a, b) => a.termDays - b.termDays), totals, grand };
}

module.exports = { BUCKETS, BUCKET_SQL, TERM_SQL, aging };
