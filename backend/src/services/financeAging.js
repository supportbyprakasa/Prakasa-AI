// Shared, pure building blocks of the Finance piutang (receivables) and utang
// (payables) reports: the aging buckets (the same five as Sales' "Umur
// piutang", salesReceivables.service.js), their SQL, and the 12-month window.
// Every day is a WIB day (utils/wibTime.js).
const { BUCKETS } = require('./salesReceivables.service');
const { todayWib } = require('../utils/wibTime');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
// "Due soon" is the next two weeks: the payment run Finance plans ahead for.
const DUE_SOON_DAYS = 14;
const OVER_DAYS = 90;
const MONTHS = 12;

// Days past due → bucket. Not yet due (or no due date) is "current"; due today is still current.
function bucketSql(dueColumn) {
  return `CASE WHEN ${dueColumn} IS NULL OR ${dueColumn} >= ${TODAY} THEN 'current'
    WHEN DATEDIFF(${TODAY}, ${dueColumn}) <= 30 THEN 'd1_30'
    WHEN DATEDIFF(${TODAY}, ${dueColumn}) <= 60 THEN 'd31_60'
    WHEN DATEDIFF(${TODAY}, ${dueColumn}) <= 90 THEN 'd61_90'
    ELSE 'd90_plus' END`;
}

const dayNumber = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / 86400000);

/** The JavaScript twin of bucketSql (tests, and anything bucketing a row in memory). */
function bucketOf(dueDate, today = todayWib()) {
  if (!dueDate) return 'current';
  const late = dayNumber(today) - dayNumber(dueDate);
  if (late <= 0) return 'current';
  if (late <= 30) return 'd1_30';
  if (late <= 60) return 'd31_60';
  if (late <= 90) return 'd61_90';
  return 'd90_plus';
}

const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const int = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b.key, { invoices: 0, amount: 0 }]));

/**
 * Rows of { group?, bucket, invoices, amount } → the five buckets in order
 * (with each one's share of the total), the total, and — when rows carry a
 * group (a channel) — the same per group, largest first.
 */
function agingFromRows(rows = []) {
  const totals = emptyBuckets();
  const groups = new Map();
  for (const r of rows) {
    if (!Object.hasOwn(totals, r.bucket)) continue;
    totals[r.bucket].invoices += int(r.invoices);
    totals[r.bucket].amount = money(totals[r.bucket].amount + Number(r.amount || 0));
    if (r.group === undefined) continue;
    const name = r.group || 'Lainnya';
    if (!groups.has(name)) groups.set(name, { name, total: { invoices: 0, amount: 0 }, buckets: emptyBuckets() });
    const g = groups.get(name);
    g.buckets[r.bucket].invoices += int(r.invoices);
    g.buckets[r.bucket].amount = money(g.buckets[r.bucket].amount + Number(r.amount || 0));
    g.total.invoices += int(r.invoices);
    g.total.amount = money(g.total.amount + Number(r.amount || 0));
  }
  const total = Object.values(totals).reduce((a, b) => ({ invoices: a.invoices + b.invoices, amount: money(a.amount + b.amount) }), { invoices: 0, amount: 0 });
  const share = (amount, of) => (of > 0 ? Math.round((amount / of) * 1000) / 10 : 0);
  return {
    buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, ...totals[b.key], share: share(totals[b.key].amount, total.amount) })),
    total,
    groups: [...groups.values()]
      .sort((a, b) => b.total.amount - a.total.amount || a.name.localeCompare(b.name))
      .map((g) => ({ ...g, buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label, ...g.buckets[b.key], share: share(g.buckets[b.key].amount, g.total.amount) })) })),
  };
}

/** The first day of the month `months - 1` months before today's: the 12-month window's start. */
function windowStart(today = todayWib(), months = MONTHS) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - (months - 1), 1));
  return d.toISOString().slice(0, 10);
}

/** The window's months, oldest first, each filled from rows of { month: 'YYYY-MM', amount, count } (missing → 0). */
function fillMonths(rows = [], today = todayWib(), months = MONTHS) {
  const by = new Map(rows.map((r) => [String(r.month), r]));
  const start = windowStart(today, months);
  const [y, m] = start.split('-').map(Number);
  const out = [];
  for (let i = 0; i < months; i += 1) {
    const key = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7);
    const r = by.get(key);
    out.push({ month: key, amount: money(r?.amount), count: int(r?.count) });
  }
  return out;
}

/** Days sales outstanding: what is owed now ÷ what was billed in the last `days` days × `days`. */
function dso(outstanding, billed, days = 90) {
  const b = Number(billed);
  if (!(b > 0)) return null;
  return Math.round(((Number(outstanding) || 0) / b) * days * 10) / 10;
}

const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

module.exports = {
  BUCKETS, TODAY, DUE_SOON_DAYS, OVER_DAYS, MONTHS, bucketSql, bucketOf, agingFromRows, windowStart, fillMonths, dso, money, int, dateOnly,
};
