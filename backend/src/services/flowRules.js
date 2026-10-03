// The one definition of the 3.3 flow rules (docs/program-4-divisi.md 3.3),
// shared by the Alur & Margin page (managementFlow.service), the management
// provider (providers/flow.js) and their tests.
//
// Deliberately NOT here: when an SO is late to ship. That is the Warehouse
// promise (warehouseRules.promisedSql, view wh_so_fulfilment_accurate of
// migrations 099 and 103; decision "Janji kirim SO dan OTIF", Head Supply
// Chain 30 Sep 2026) and it is escalated once, by warehouse_so_late. The flow
// page reads the same view and never escalates late shipping a second time.
const { todayWib } = require('../utils/wibTime');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';

// A surat jalan without a faktur after this many days (Sales Ops) escalates to
// its Sales / Retail Commerce division, for at most BILL_WINDOW_DAYS after the
// surat jalan; older ones are listed on the page, not escalated.
const BILL_GRACE_DAYS = 2;
const BILL_WINDOW_DAYS = 30;
// "Pesanan sampai lunas": SOs fully paid in the last PAID_WINDOW_DAYS.
const PAID_WINDOW_DAYS = 90;
// Barang lambat laku (Head Supply Chain): no approved sale for SLOW_DAYS is
// "lambat laku", for DEAD_DAYS "tidak laku".
const SLOW_DAYS = 60;
const DEAD_DAYS = 90;
// Below this share of revenue with a known purchase cost, the margin card warns.
const LOW_COVERAGE_PCT = 80;
const MAX_PERIOD_DAYS = 366;
const STUCK_ITEMS_MAX = 50;
const PRESETS = Object.freeze(['month', 'prev', '3m', 'ytd']);
const DEFAULT_PRESET = '3m';

// `f` is a row of mg_sales_flow_accurate. A surat jalan with no faktur yet,
// past the grace days — and only while the mirror can judge it: when a Sales /
// RC batch of the SO's division waits for approval, data_through is the day of
// the last approved pull, and a faktur due after that day may sit in the
// waiting batch (the same rule as wh_so_fulfilment_accurate.judged; a pull that
// skipped the division never counts, migration 103).
const notBilledSql = (f) => `${f}.stage = 'shipped'
    AND ${f}.delivered_on < ${TODAY} - INTERVAL ${BILL_GRACE_DAYS} DAY
    AND (${f}.data_through IS NULL OR ${f}.delivered_on + INTERVAL ${BILL_GRACE_DAYS} DAY < ${f}.data_through)`;
// …and escalated only within BILL_WINDOW_DAYS of the surat jalan.
const notBilledRecentSql = (f) => `${notBilledSql(f)}
    AND ${f}.delivered_on >= ${TODAY} - INTERVAL ${BILL_WINDOW_DAYS} DAY`;

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

// Days between two steps: count, average (1 decimal), median and p90 (nearest
// rank). Negative and non-numeric values are dropped; nothing → nulls.
function stepStats(values) {
  const v = (values || []).map((x) => (x === null || x === undefined || x === '' ? NaN : Number(x)))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { count: 0, avgDays: null, medianDays: null, p90Days: null };
  const avg = v.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return {
    count: n,
    avgDays: Math.round(avg * 10) / 10,
    medianDays: Math.round(median * 10) / 10,
    p90Days: v[Math.ceil(0.9 * n) - 1],
  };
}

// Dates as 'YYYY-MM-DD', computed on the calendar (Date.UTC), never the clock.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const parts = (iso) => iso.split('-').map(Number);
function validDate(iso) {
  if (!DATE_RE.test(String(iso || ''))) return false;
  const [y, m, d] = parts(iso);
  return ymd(y, m - 1, d) === iso;
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The period of the page: an explicit from/to, or a preset counted in WIB.
function parsePeriod({ preset, from, to } = {}, today = todayWib()) {
  if (from || to) {
    if (!validDate(from) || !validDate(to)) throw httpError(400, 'VALIDATION_ERROR', 'Tanggal periode harus berformat YYYY-MM-DD.');
    if (from > to) throw httpError(400, 'VALIDATION_ERROR', 'Tanggal awal periode harus sebelum tanggal akhir.');
    if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) throw httpError(400, 'VALIDATION_ERROR', `Periode paling panjang ${MAX_PERIOD_DAYS} hari.`);
    return { from, to, preset: null };
  }
  const key = preset || DEFAULT_PRESET;
  if (!PRESETS.includes(key)) throw httpError(400, 'VALIDATION_ERROR', 'Periode tidak dikenal.');
  const [y, m] = parts(today);
  switch (key) {
    case 'month': return { from: ymd(y, m - 1, 1), to: today, preset: key };
    case 'prev': return { from: ymd(y, m - 2, 1), to: ymd(y, m - 1, 0), preset: key };
    case 'ytd': return { from: ymd(y, 0, 1), to: today, preset: key };
    default: return { from: ymd(y, m - 3, 1), to: today, preset: key };
  }
}

module.exports = {
  TODAY, BILL_GRACE_DAYS, BILL_WINDOW_DAYS, PAID_WINDOW_DAYS, SLOW_DAYS, DEAD_DAYS, LOW_COVERAGE_PCT,
  MAX_PERIOD_DAYS, STUCK_ITEMS_MAX, PRESETS, DEFAULT_PRESET,
  notBilledSql, notBilledRecentSql, stepStats, parsePeriod, validDate, httpError,
};
