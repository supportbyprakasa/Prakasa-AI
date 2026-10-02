const pool = require('../db/pool');
const { numbersFromAccurate } = require('./salesSource');
const { CUSTOMER_CHANNELS } = require('./salesNumbers');
const analytics = require('./googleAnalytics.service');

// Marketing → "Produk & channel" (migration 119): what sells, where, and who
// is new — read from the approved Accurate mirror and the Sales app's leads.
//
// Aggregates only. Marketing holds sales.data.view_all but not
// sales.order.view, so nothing here returns an invoice, a customer or a
// salesperson: every query groups by month / channel / product / area and
// sums. Revenue is DPP (owner's decision): the channel figures come from
// sales_revenue_accurate (invoices + DPP, returns − DPP, down payments left
// out — the same number as the Sales pages); product figures from
// mg_invoice_lines_accurate, each line's share of its invoice DPP (vouchers
// and header discounts spread pro rata), before returns.
//
// Accurate numbers count only once the division approved its first Sales /
// Retail Commerce batch (salesSource.numbersFromAccurate). Until then the
// Accurate sections come back empty with `accurate: false`; leads (the
// Sales app's own data) still show.

const WINDOW_MONTHS = 12;
const TOP_PRODUCTS = 20;
const MOVERS = 5;
const LEAD_AREAS = 30;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LATEST = 'latest';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Customer channel codes (salesNumbers.CUSTOMER_CHANNELS) → Indonesian labels.
const CHANNEL_LABELS = Object.freeze({
  GT: 'General Trade',
  MT: 'Modern Trade',
  FoodService: 'Food Service',
  Shopee: 'Shopee',
  TokoPedia: 'Tokopedia',
  GRAB: 'GrabMart',
  GOJEK: 'GoMart',
  Export: 'Ekspor',
});
const NO_CHANNEL = 'none';
const channelKey = (code) => (code === null || code === undefined || String(code).trim() === '' ? NO_CHANNEL : String(code));
const channelLabel = (key) => (key === NO_CHANNEL ? 'Tanpa channel' : (CHANNEL_LABELS[key] || key));

const wibToday = (now = Date.now()) => new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
const num = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

class MarketingError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ------------------------------------------------------------ month helpers
function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const monthLabel = (month) => {
  const m = MONTH_RE.exec(String(month || ''));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : '';
};
const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** The month asked for (YYYY-MM, not in the future), else this month (WIB). */
function resolveMonth(value, today = wibToday()) {
  const current = today.slice(0, 7);
  if (value === undefined || value === null || value === '') return current;
  if (!MONTH_RE.test(String(value))) throw new MarketingError('VALIDATION_ERROR', 'Bulan berbentuk TTTT-BB, misalnya 2026-09', 400, { field: 'month' });
  if (value > current) throw new MarketingError('VALIDATION_ERROR', 'Bulan tidak boleh di masa depan', 400, { field: 'month' });
  if (value < '2015-01') throw new MarketingError('VALIDATION_ERROR', 'Bulan terlalu lama', 400, { field: 'month' });
  return String(value);
}

/** The 12 months ending at `month`, oldest first: [{ key, label }]. */
function windowMonths(month, count = WINDOW_MONTHS) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = addMonths(month, -i);
    out.push({ key, label: monthLabel(key) });
  }
  return out;
}

/** (current − previous) ÷ previous, in %; null when there is no base to compare with. */
function changePct(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev <= 0) return null;
  return round1(((cur - prev) / prev) * 100);
}

// ------------------------------------------------------------ queries (aggregates only)
// Every SELECT below groups and sums; none returns a document number, a
// customer or a salesperson. test/marketing.test.js checks this.
const SQL = Object.freeze({
  dataThrough: `SELECT MAX(a.trans_date) AS d FROM accurate_records a
                 WHERE a.entity_id = ? AND a.record_type = 'sales_invoice' AND a.missing = 0`,
  revenueByChannel: `SELECT DATE_FORMAT(r.trans_date, '%Y-%m') AS month, r.channel, SUM(r.amount) AS revenue
                       FROM sales_revenue_accurate r
                      WHERE r.entity_id = ? AND r.trans_date BETWEEN ? AND ?
                      GROUP BY month, r.channel`,
  // Quantity in the base unit when Accurate's unit ratio is known; otherwise
  // the faktur unit (has_ratio = 0 tells the page the units are mixed).
  linesByItem: `SELECT DATE_FORMAT(l.trans_date, '%Y-%m') AS month, l.channel, l.item_code, MIN(l.item_name) AS item_name, l.unit,
                       SUM(l.qty) AS qty, SUM(l.qty * iu.ratio) AS qty_base, MIN(iu.ratio IS NOT NULL) AS has_ratio,
                       MIN(iu.base_unit) AS base_unit, SUM(l.revenue) AS revenue
                  FROM mg_invoice_lines_accurate l
                  LEFT JOIN (SELECT u.item_no, u.unit_name, MAX(u.ratio) AS ratio, MIN(u.base_unit) AS base_unit
                               FROM item_units_accurate u WHERE u.entity_id = ? GROUP BY u.item_no, u.unit_name) iu
                    ON iu.item_no = l.item_code COLLATE utf8mb4_unicode_ci AND iu.unit_name = l.unit COLLATE utf8mb4_unicode_ci
                 WHERE l.entity_id = ? AND NOT l.is_dp AND l.trans_date BETWEEN ? AND ?
                 GROUP BY month, l.channel, l.item_code, l.unit`,
  // NOO per Accurate customer (customer number) from the invoices, in the
  // channel of its first order — the same count as Sales and management.
  nooByChannel: `SELECT DATE_FORMAT(c.noo_date, '%Y-%m') AS month, c.channel, COUNT(*) AS customers
                   FROM sales_customer_orders_accurate c
                  WHERE c.entity_id = ? AND c.noo_date BETWEEN ? AND ?
                  GROUP BY month, c.channel`,
  // A lead's day: its first visit, else the WIB day it was recorded (created_at is UTC).
  leadsByArea: `SELECT COALESCE(NULLIF(TRIM(l.area), ''), '') AS area, COUNT(*) AS total,
                       SUM(l.status = 'open' AND l.customer_id IS NULL) AS open_count,
                       SUM(COALESCE(l.visit_count, 0) > 0) AS visited,
                       SUM(l.customer_id IS NOT NULL) AS converted,
                       SUM(l.status = 'dropped') AS dropped,
                       SUM(COALESCE(l.first_visit_date, DATE(l.created_at + INTERVAL 7 HOUR)) BETWEEN ? AND ?) AS new_in_month
                  FROM sales_leads l
                 WHERE l.entity_id = ? AND l.deleted_at IS NULL
                 GROUP BY area
                 ORDER BY total DESC, area ASC
                 LIMIT ${LEAD_AREAS}`,
  leadsNew: `SELECT SUM(COALESCE(l.first_visit_date, DATE(l.created_at + INTERVAL 7 HOUR)) BETWEEN ? AND ?) AS current_count,
                    SUM(COALESCE(l.first_visit_date, DATE(l.created_at + INTERVAL 7 HOUR)) BETWEEN ? AND ?) AS previous_count
               FROM sales_leads l
              WHERE l.entity_id = ? AND l.deleted_at IS NULL`,
});

// ------------------------------------------------------------ shaping (pure)
/**
 * Channel × month series. Months before the first month with any data and
 * after the month the Accurate data reaches are null (unknown), not 0.
 */
function channelSeries(months, { revenueRows = [], lineRows = [], nooRows = [], firstMonth = null, lastMonth = null }) {
  const index = new Map(months.map((m, i) => [m.key, i]));
  const known = (key) => (!firstMonth || key >= firstMonth) && (!lastMonth || key <= lastMonth);
  const blank = () => months.map((m) => (known(m.key) ? 0 : null));
  const byKey = new Map();
  const get = (code) => {
    const key = channelKey(code);
    if (!byKey.has(key)) byKey.set(key, { key, label: channelLabel(key), revenue: blank(), qty: blank(), noo: blank() });
    return byKey.get(key);
  };
  const add = (series, field, month, value) => {
    const i = index.get(month);
    if (i === undefined || series[field][i] === null) return;
    series[field][i] = round2(series[field][i] + value);
  };
  for (const r of revenueRows) add(get(r.channel), 'revenue', r.month, num(r.revenue));
  for (const r of lineRows) add(get(r.channel), 'qty', r.month, lineQty(r));
  for (const r of nooRows) {
    // A new customer is counted whatever month the Accurate invoices reach.
    const s = get(r.channel);
    const i = index.get(r.month);
    if (i !== undefined) s.noo[i] = (s.noo[i] || 0) + num(r.customers);
  }
  const total = (s) => s.revenue.reduce((a, v) => a + (v || 0), 0);
  return [...byKey.values()]
    .map((s) => ({ ...s, totalRevenue: round2(total(s)) }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue || a.label.localeCompare(b.label));
}

const lineQty = (r) => (Number(r.has_ratio) === 1 && r.qty_base !== null && r.qty_base !== undefined ? num(r.qty_base) : num(r.qty));

/** Per product: this month and last month, the units sold, and its channels. */
function productTotals(lineRows, month, prevMonth) {
  const items = new Map();
  for (const r of lineRows) {
    if (r.month !== month && r.month !== prevMonth) continue;
    const code = String(r.item_code || '').trim();
    if (!code) continue;
    if (!items.has(code)) {
      items.set(code, { itemCode: code, itemName: r.item_name || code, revenue: 0, prevRevenue: 0, units: new Map(), channels: new Map() });
    }
    const it = items.get(code);
    if (r.item_name && it.itemName === code) it.itemName = r.item_name;
    if (r.month === month) {
      it.revenue += num(r.revenue);
      const unit = Number(r.has_ratio) === 1 && r.base_unit ? r.base_unit : (r.unit || '');
      it.units.set(unit, (it.units.get(unit) || 0) + lineQty(r));
      const ch = channelKey(r.channel);
      it.channels.set(ch, (it.channels.get(ch) || 0) + num(r.revenue));
    } else {
      it.prevRevenue += num(r.revenue);
    }
  }
  return [...items.values()].map((it) => ({
    itemCode: it.itemCode,
    itemName: it.itemName,
    revenue: round2(it.revenue),
    prevRevenue: round2(it.prevRevenue),
    change: round2(it.revenue - it.prevRevenue),
    changePct: changePct(it.revenue, it.prevRevenue),
    qty: [...it.units.entries()].filter(([, q]) => q).map(([unit, q]) => ({ unit, qty: round2(q) })),
    channels: [...it.channels.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => ({ key, label: channelLabel(key) })),
  }));
}

function topProducts(products, limit = TOP_PRODUCTS) {
  return products.filter((p) => p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || a.itemName.localeCompare(b.itemName))
    .slice(0, limit);
}

/** Biggest risers and fallers in revenue against last month. */
function movers(products, limit = MOVERS) {
  const rising = products.filter((p) => p.change > 0).sort((a, b) => b.change - a.change).slice(0, limit);
  const falling = products.filter((p) => p.change < 0).sort((a, b) => a.change - b.change).slice(0, limit);
  return { rising, falling };
}

const leadArea = (r) => ({
  area: r.area || 'Tanpa area',
  total: num(r.total),
  open: num(r.open_count),
  visited: num(r.visited),
  converted: num(r.converted),
  dropped: num(r.dropped),
  newInMonth: num(r.new_in_month),
});

// ------------------------------------------------------------ the page
/**
 * GET /marketing/insights?month=YYYY-MM — everything "Produk & channel" shows
 * for the caller's entity, for the 12 months ending at `month`.
 */
async function insights(entityId, { month: requested } = {}, db = pool, { today = wibToday() } = {}) {
  const accurate = await numbersFromAccurate(entityId);
  let dataThrough = null;
  if (accurate) {
    const [[through]] = await db.query(SQL.dataThrough, [entityId]);
    dataThrough = isoDate(through?.d);
  }
  // 'latest': the last month the approved Accurate data reaches (early in a
  // month, this month has no faktur yet), else this month.
  const latest = requested === LATEST;
  const month = latest
    ? (dataThrough && dataThrough.slice(0, 7) < today.slice(0, 7) ? dataThrough.slice(0, 7) : today.slice(0, 7))
    : resolveMonth(requested, today);
  const months = windowMonths(month);
  const prevMonth = addMonths(month, -1);
  const from = `${months[0].key}-01`;
  const to = lastDay(month);
  const monthStart = `${month}-01`;
  const prevStart = `${prevMonth}-01`;
  const prevEnd = lastDay(prevMonth);

  const [[leadsNow]] = await db.query(SQL.leadsNew, [monthStart, to, prevStart, prevEnd, entityId]);
  const [areaRows] = await db.query(SQL.leadsByArea, [monthStart, to, entityId]);
  const leads = {
    newThisMonth: num(leadsNow?.current_count),
    newPrevMonth: num(leadsNow?.previous_count),
    byArea: areaRows.map(leadArea),
  };

  const base = {
    month, latest, currentMonth: today.slice(0, 7), monthLabel: monthLabel(month), prevMonth, prevMonthLabel: monthLabel(prevMonth), months,
    channelLabels: CHANNEL_LABELS, leads,
  };
  if (!accurate) {
    return {
      ...base,
      accurate: false,
      dataThrough: null,
      kpis: { revenue: null, productsSold: null, newCustomers: null, newLeads: { value: leads.newThisMonth, previous: leads.newPrevMonth } },
      channels: [],
      qtyMixedUnits: false,
      topProducts: [],
      movers: { rising: [], falling: [] },
    };
  }

  const [revenueRows] = await db.query(SQL.revenueByChannel, [entityId, from, to]);
  const [lineRows] = await db.query(SQL.linesByItem, [entityId, entityId, from, to]);
  const [nooRows] = await db.query(SQL.nooByChannel, [entityId, from, to]);

  const dataMonths = [...revenueRows, ...lineRows].map((r) => r.month).filter(Boolean).sort();
  const firstMonth = dataMonths[0] || null;
  const lastMonth = dataThrough ? dataThrough.slice(0, 7) : null;
  const channels = channelSeries(months, { revenueRows, lineRows, nooRows, firstMonth, lastMonth });
  const products = productTotals(lineRows, month, prevMonth);
  const sumMonth = (rows, key, m) => round2(rows.filter((r) => r.month === m).reduce((a, r) => a + num(r[key]), 0));
  const soldIn = (m) => new Set(lineRows.filter((r) => r.month === m && num(r.qty) > 0).map((r) => r.item_code)).size;
  const nooIn = (m) => nooRows.filter((r) => r.month === m).reduce((a, r) => a + num(r.customers), 0);
  const inData = (m) => !lastMonth || m <= lastMonth;

  return {
    ...base,
    accurate: true,
    dataThrough,
    kpis: {
      revenue: { value: inData(month) ? sumMonth(revenueRows, 'revenue', month) : null, previous: sumMonth(revenueRows, 'revenue', prevMonth) },
      productsSold: { value: inData(month) ? soldIn(month) : null, previous: soldIn(prevMonth) },
      newCustomers: { value: nooIn(month), previous: nooIn(prevMonth) },
      newLeads: { value: leads.newThisMonth, previous: leads.newPrevMonth },
    },
    channels,
    qtyMixedUnits: lineRows.some((r) => Number(r.has_ratio) !== 1),
    topProducts: topProducts(products),
    movers: movers(products),
  };
}

// ------------------------------------------------------------ web sessions (GA4)
// Read-only, through the existing service account. Shown only when it works:
// any setup problem returns { available: false, reason } and the card hides.
// MARKETING_GA_PROPERTY (properties/123…) picks the company website's
// property when the service account sees several; otherwise the first one.
function setupReason(error) {
  const text = String(error?.response?.data?.error?.message || error?.message || '');
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(text)) return 'API_DISABLED';
  const status = Number(error?.status || error?.code || error?.response?.status);
  if (/unauthorized_client|invalid_grant|insufficient permissions|PERMISSION_DENIED/i.test(text) || status === 401 || status === 403) return 'NO_ACCESS';
  return 'ERROR';
}

async function webSessions(entityId, { month: requested, userId = null } = {}, { today = wibToday() } = {}) {
  const month = resolveMonth(requested, today);
  if (!analytics.setupStatus().serviceAccountConfigured) return { available: false, reason: 'NOT_CONFIGURED' };
  try {
    const properties = await analytics.listProperties({ entityId, userId });
    if (!properties.length) return { available: false, reason: 'NO_PROPERTIES' };
    const wanted = process.env.MARKETING_GA_PROPERTY;
    const property = properties.find((p) => p.id === wanted) || properties[0];
    const end = lastDay(month) < today ? lastDay(month) : today;
    const range = analytics.resolveRange({ range: 'custom', start: `${month}-01`, end }, Date.parse(`${today}T12:00:00+07:00`));
    if (range.error) return { available: false, reason: 'ERROR' };
    const report = await analytics.runReport(property.id, range, { entityId, userId });
    const sessions = (report.kpis || []).find((k) => k.key === 'sessions') || {};
    return {
      available: true,
      property: { id: property.id, name: property.name },
      start: range.start,
      end: range.end,
      sessions: num(sessions.value),
      previous: num(sessions.previous),
    };
  } catch (error) {
    return { available: false, reason: setupReason(error) };
  }
}

// ------------------------------------------------------------ item picker
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Up to 20 Accurate products matching code or name, for the campaign form. */
async function searchItems(entityId, q, db = pool) {
  const text = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (text.length < 2) return [];
  const like = `%${likeEscape(text)}%`;
  const [rows] = await db.query(
    `SELECT i.item_code, MIN(i.name) AS name
       FROM sales_items_accurate i
      WHERE i.entity_id = ? AND (i.item_code LIKE ? OR i.name LIKE ?)
      GROUP BY i.item_code
      ORDER BY MAX(i.item_code = ?) DESC, MIN(i.name) ASC
      LIMIT 20`,
    [entityId, like, like, text],
  );
  return rows.map((r) => ({ itemNo: String(r.item_code), itemName: r.name || String(r.item_code) }));
}

module.exports = {
  insights, webSessions, searchItems,
  resolveMonth, windowMonths, addMonths, monthLabel, lastDay, changePct,
  channelSeries, productTotals, topProducts, movers, channelLabel, channelKey,
  CHANNEL_LABELS, CUSTOMER_CHANNELS, NO_CHANNEL, LATEST, SQL, MarketingError, wibToday,
};
