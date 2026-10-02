const pool = require('../db/pool');
const { numbersFromAccurate, transactionSource } = require('./salesSource');
const { unitQuantities, baseQtyOf } = require('./salesQuery');
const rules = require('./warehouseRules');
const { openReceivableSql } = require('./invoiceRules');
const { wibClock } = require('../utils/wibTime');

// Retail Commerce: marketplace performance (migration 120).
//
// Retail Commerce sells through marketplaces. Its numbers are the approved
// Accurate mirror, the rows the views route to the retail_commerce department
// (today Shopee and TokoPedia customers; the GRAB/GOJEK/TikTok routing is an
// open owner decision, so the platform list is read from the data, never
// hard-coded). Read-only: nothing here writes.
//
//   revenue  = invoice DPP (before VAT) net of returns, without down-payment
//              invoices: sales_revenue_accurate, the same rule as Sales.
//   orders   = Accurate sales orders (sales_so_accurate); invoices counted apart.
//   shipping = wh_so_fulfilment_accurate by the SELLING division
//              (sales_department_id), against the Warehouse promise.
//
// Like Sales, the numbers only count once a Sales/RC Accurate batch has been
// approved (salesSource.numbersFromAccurate). Before that every endpoint says
// so instead of showing the old recap. Every query is bound to the caller's
// entity first, then to the Retail Commerce department.

const RC_CODE = 'retail_commerce';
const TODAY = rules.TODAY;
const MONTHS_DEFAULT = 12;
const MONTHS_MIN = 3;
const MONTHS_MAX = 24;
const TOP_PRODUCTS = 15;
const SHIPMENTS_LIMIT = 50;
const RECEIVABLES_LIMIT = 100;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// How a marketplace is called on screen. Accurate spells Tokopedia "TokoPedia"
// (the customer category); anything else keeps its own name.
const PLATFORM_LABELS = Object.freeze({ Shopee: 'Shopee', TokoPedia: 'Tokopedia' });
const OTHER = 'Lainnya';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v) => Math.round(num(v) * 100) / 100;
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));
const ratio = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 1000) / 10 : null);

function platformLabel(channel) {
  if (channel === null || channel === undefined || channel === '') return OTHER;
  return PLATFORM_LABELS[channel] || String(channel);
}
const platformKey = (channel) => (channel === null || channel === undefined || channel === '' ? '' : String(channel));

/** One month as the charts read it: { key: 'YYYY-MM', label, start, end }. */
function monthOf(key) {
  const [y, m] = key.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { key, label: `${MONTH_NAMES[m - 1]} ${y}`, start: `${key}-01`, end };
}

/** The last `count` months up to the current WIB month, oldest first. */
function monthsBack(count = MONTHS_DEFAULT, today = wibClock()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    out.push(monthOf(d.toISOString().slice(0, 7)));
  }
  return out;
}

function previousMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function clampMonths(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return MONTHS_DEFAULT;
  return Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, n));
}

/** The entity's Retail Commerce department, or null when it has none. */
async function rcDepartment(entityId) {
  const [[row]] = await pool.query(
    'SELECT id, name FROM departments WHERE entity_id = ? AND code = ? AND deleted_at IS NULL LIMIT 1',
    [entityId, RC_CODE],
  );
  return row ? { id: Number(row.id), name: row.name } : null;
}

/**
 * Whether the page has numbers to show. Returns { department } when it does,
 * else { reason } — 'no_department', 'app_mode' (transactions are recorded in
 * the app, not Accurate) or 'not_approved' (no approved Sales/RC batch yet).
 */
async function source(entityId) {
  const department = await rcDepartment(entityId);
  if (!department) return { department: null, reason: 'no_department' };
  if (transactionSource() !== 'accurate') return { department, reason: 'app_mode' };
  if (!(await numbersFromAccurate(entityId))) return { department, reason: 'not_approved' };
  return { department, reason: null };
}

// ------------------------------------------------------------------ overview

function emptyMonthly(n) {
  return { revenue: Array(n).fill(0), gross: Array(n).fill(0), returns: Array(n).fill(0), invoices: Array(n).fill(0), orders: Array(n).fill(0) };
}

/**
 * Pure: the platform table, monthly series and headline figures from the
 * grouped rows. Kept apart from SQL so the arithmetic is tested on its own.
 */
function buildOverview({ months, revenueRows, orderRows, receivableRows, shipmentRows, dpThisMonth = 0 }) {
  const index = new Map(months.map((m, i) => [m.key, i]));
  const n = months.length;
  const platforms = new Map();
  const platform = (channel) => {
    const key = platformKey(channel);
    if (!platforms.has(key)) {
      platforms.set(key, {
        channel: key || null, label: platformLabel(channel), monthly: emptyMonthly(n),
        receivable: { amount: 0, invoices: 0, overdue: 0, overdueInvoices: 0, oldestDue: null },
        shipments: { open: 0, late: 0, oldest: null },
      });
    }
    return platforms.get(key);
  };

  for (const r of revenueRows) {
    const i = index.get(r.month);
    if (i === undefined) continue;
    const p = platform(r.channel).monthly;
    p.revenue[i] += num(r.revenue);
    p.gross[i] += num(r.gross);
    p.returns[i] += num(r.returns);
    p.invoices[i] += num(r.invoices);
  }
  for (const r of orderRows) {
    const i = index.get(r.month);
    if (i === undefined) continue;
    platform(r.channel).monthly.orders[i] += num(r.orders);
  }
  for (const r of receivableRows) {
    platform(r.channel).receivable = {
      amount: money(r.outstanding), invoices: num(r.invoices),
      overdue: money(r.overdue), overdueInvoices: num(r.overdue_invoices), oldestDue: dateOnly(r.oldest_due),
    };
  }
  for (const r of shipmentRows) {
    platform(r.channel).shipments = { open: num(r.open_orders), late: num(r.late_orders), oldest: dateOnly(r.oldest) };
  }

  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const cur = n - 1;
  const prev = n - 2;
  const list = [...platforms.values()].map((p) => {
    const m = p.monthly;
    const revenue = money(sum(m.revenue));
    const gross = sum(m.gross);
    const returns = money(sum(m.returns));
    const invoices = sum(m.invoices);
    return {
      channel: p.channel,
      label: p.label,
      revenue,
      orders: sum(m.orders),
      invoices,
      aov: invoices > 0 ? money(revenue / invoices) : null,
      returns,
      returnRate: ratio(returns, gross),
      share: null,
      revenueThisMonth: money(m.revenue[cur]),
      revenueLastMonth: prev >= 0 ? money(m.revenue[prev]) : null,
      receivable: p.receivable,
      shipments: p.shipments,
      series: {
        revenue: m.revenue.map(money), orders: m.orders, invoices: m.invoices, returns: m.returns.map(money),
      },
    };
  });
  const total = sum(list.map((p) => p.revenue));
  for (const p of list) p.share = total > 0 ? ratio(p.revenue, total) : null;
  list.sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label));

  const at = (field, i) => (i < 0 ? 0 : sum([...platforms.values()].map((p) => p.monthly[field][i])));
  const revenueThisMonth = money(at('revenue', cur));
  const revenueLastMonth = money(at('revenue', prev));
  const invoicesThisMonth = at('invoices', cur);
  const grossThisMonth = at('gross', cur);
  const returnsThisMonth = money(at('returns', cur));
  // The latest month that has marketplace invoices: marketplaces are billed
  // in one recap invoice per month, so "this month" is often still empty.
  let latest = null;
  for (let i = cur; i >= 0; i -= 1) {
    if (at('invoices', i) > 0 || at('gross', i) !== 0) { latest = months[i]; break; }
  }
  const receivable = list.reduce((a, p) => ({
    amount: money(a.amount + p.receivable.amount), invoices: a.invoices + p.receivable.invoices,
    overdue: money(a.overdue + p.receivable.overdue), overdueInvoices: a.overdueInvoices + p.receivable.overdueInvoices,
  }), { amount: 0, invoices: 0, overdue: 0, overdueInvoices: 0 });
  const shipments = list.reduce((a, p) => ({
    open: a.open + p.shipments.open,
    late: a.late + p.shipments.late,
    oldest: [a.oldest, p.shipments.oldest].filter(Boolean).sort()[0] || null,
  }), { open: 0, late: 0, oldest: null });

  return {
    kpis: {
      revenueThisMonth,
      revenueLastMonth,
      revenueChange: money(revenueThisMonth - revenueLastMonth),
      invoicesThisMonth,
      ordersThisMonth: at('orders', cur),
      ordersLastMonth: at('orders', prev),
      aovThisMonth: invoicesThisMonth > 0 ? money(revenueThisMonth / invoicesThisMonth) : null,
      returnsThisMonth,
      returnRateThisMonth: ratio(returnsThisMonth, grossThisMonth),
      dpInvoicesThisMonth: num(dpThisMonth),
      receivable,
      shipments,
    },
    latestMonth: latest ? { key: latest.key, label: latest.label } : null,
    windowRevenue: money(total),
    platforms: list,
    totals: {
      revenue: months.map((_, i) => money(at('revenue', i))),
      orders: months.map((_, i) => at('orders', i)),
      invoices: months.map((_, i) => at('invoices', i)),
      returns: months.map((_, i) => money(at('returns', i))),
    },
  };
}

async function overview(user, { months: count } = {}) {
  const entityId = Number(user.entityId);
  const months = monthsBack(clampMonths(count));
  const src = await source(entityId);
  const base = {
    connected: false, reason: src.reason, department: src.department, months,
    rules: { shipSlaDays: rules.SHIP_SLA_DAYS, revenueBasis: 'dpp_net_of_returns' },
    generatedAt: new Date().toISOString(),
  };
  if (src.reason) return base;
  const deptId = src.department.id;
  const from = months[0].start;
  const thisMonth = months[months.length - 1].start;

  const [revenueRows] = await pool.query(
    `SELECT DATE_FORMAT(r.trans_date, '%Y-%m') AS month, r.channel,
            COALESCE(SUM(r.amount), 0) AS revenue,
            COALESCE(SUM(CASE WHEN r.kind = 'invoice' THEN r.amount ELSE 0 END), 0) AS gross,
            COALESCE(SUM(CASE WHEN r.kind = 'return' THEN -r.amount ELSE 0 END), 0) AS returns,
            COALESCE(SUM(r.kind = 'invoice'), 0) AS invoices
       FROM sales_revenue_accurate r
      WHERE r.entity_id = ? AND r.department_id = ?
        AND r.trans_date >= ? AND r.trans_date <= ${TODAY}
      GROUP BY month, r.channel`,
    [entityId, deptId, from],
  );
  const [orderRows] = await pool.query(
    `SELECT DATE_FORMAT(s.trans_date, '%Y-%m') AS month, s.channel, COUNT(*) AS orders
       FROM sales_so_accurate s
      WHERE s.entity_id = ? AND s.department_id = ?
        AND s.trans_date >= ? AND s.trans_date <= ${TODAY}
      GROUP BY month, s.channel`,
    [entityId, deptId, from],
  );
  const [[dp]] = await pool.query(
    `SELECT COUNT(*) AS n FROM sales_invoices_accurate d
      WHERE d.entity_id = ? AND d.department_id = ? AND d.is_dp AND d.trans_date >= ?`,
    [entityId, deptId, thisMonth],
  );
  // Marketplace money not yet paid out: open invoices (amount incl. VAT, as owed).
  const [receivableRows] = await pool.query(
    `SELECT i.channel, COUNT(*) AS invoices, COALESCE(SUM(i.outstanding_amount), 0) AS outstanding,
            COALESCE(SUM(i.due_date < ${TODAY}), 0) AS overdue_invoices,
            COALESCE(SUM(CASE WHEN i.due_date < ${TODAY} THEN i.outstanding_amount ELSE 0 END), 0) AS overdue,
            MIN(i.due_date) AS oldest_due
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ? AND i.department_id = ? AND ${openReceivableSql('i')}
      GROUP BY i.channel`,
    [entityId, deptId],
  );
  // Sales orders not (fully) shipped; late = past the Warehouse promise while
  // the mirror can judge it (no batch of that SO waiting for approval).
  const [shipmentRows] = await pool.query(
    `SELECT x.channel, COUNT(*) AS open_orders,
            COALESCE(SUM(${rules.lateSoSql('x')}), 0) AS late_orders,
            MIN(x.trans_date) AS oldest
       FROM wh_so_fulfilment_accurate x
      WHERE x.entity_id = ? AND x.sales_department_id = ? AND x.so_state IN ('open', 'partial')
      GROUP BY x.channel`,
    [entityId, deptId],
  );

  return {
    ...base,
    connected: true,
    ...buildOverview({ months, revenueRows, orderRows, receivableRows, shipmentRows, dpThisMonth: dp?.n }),
  };
}

// ------------------------------------------------------------ top products

/** Pure: rank rows with last month's revenue and the change. */
function rankProducts(rows, prevRows, monthTotal) {
  const prev = new Map(prevRows.map((r) => [String(r.code), num(r.revenue)]));
  return rows.map((t, i) => {
    const revenue = money(t.revenue);
    const last = prev.has(String(t.code)) ? money(prev.get(String(t.code))) : 0;
    const channels = [...new Set(String(t.channels || '').split(',').map((c) => c.trim()).filter(Boolean))];
    return {
      rank: i + 1,
      code: t.code,
      name: t.name,
      revenue,
      prevRevenue: last,
      change: money(revenue - last),
      changePct: last > 0 ? Math.round(((revenue - last) / last) * 1000) / 10 : null,
      isNew: last === 0,
      share: ratio(revenue, monthTotal),
      qtyByUnit: unitQuantities(t.units),
      baseQty: baseQtyOf(t.base_qty, t.base_unit),
      platforms: channels.map((c) => ({ channel: c, label: platformLabel(c) })),
    };
  });
}

/**
 * Best sellers of a month (default: this month, or — when it has no invoice
 * yet — the latest month that has one), with the change vs the month before.
 * Amounts are each invoice line's share of its invoice DPP (before PPN, the
 * same figure as Marketing; down payments left out); quantities per unit, plus one total in the
 * base unit when every unit sold has a conversion (item_units_accurate).
 */
async function topProducts(user, { month } = {}) {
  const entityId = Number(user.entityId);
  const src = await source(entityId);
  if (src.reason) return { connected: false, reason: src.reason, department: src.department, rows: [] };
  const deptId = src.department.id;
  const current = wibClock().toISOString().slice(0, 7);
  let key = MONTH_RE.test(String(month || '')) && String(month) <= current ? String(month) : null;
  let fallback = false;
  if (!key) {
    const [[latest]] = await pool.query(
      `SELECT DATE_FORMAT(MAX(l.trans_date), '%Y-%m') AS month
         FROM sales_invoice_lines_accurate l
        WHERE l.entity_id = ? AND l.department_id = ? AND NOT l.is_dp AND l.trans_date <= ${TODAY}`,
      [entityId, deptId],
    );
    key = latest?.month || current;
    fallback = key !== current;
  }
  const m = monthOf(key);
  const p = monthOf(previousMonth(key));

  const [rows] = await pool.query(
    `SELECT u.code, MIN(u.name) AS name, SUM(u.revenue) AS revenue,
            JSON_ARRAYAGG(JSON_OBJECT('unit', u.unit, 'qty', u.qty)) AS units,
            CASE WHEN SUM(iu.ratio IS NULL) = 0 THEN SUM(u.qty * iu.ratio) END AS base_qty, MIN(iu.base_unit) AS base_unit,
            GROUP_CONCAT(u.channels) AS channels
       FROM (SELECT l.item_code AS code, MIN(l.item_name) AS name, l.unit, SUM(l.qty) AS qty, SUM(l.revenue) AS revenue,
                    GROUP_CONCAT(DISTINCT l.channel) AS channels
               FROM sales_invoice_lines_accurate l
              WHERE l.entity_id = ? AND l.department_id = ? AND NOT l.is_dp AND l.trans_date BETWEEN ? AND ?
              GROUP BY l.item_code, l.unit) u
       LEFT JOIN item_units_accurate iu ON iu.entity_id = ? AND iu.item_no = u.code COLLATE utf8mb4_unicode_ci
             AND iu.unit_name = u.unit COLLATE utf8mb4_unicode_ci
      GROUP BY u.code ORDER BY revenue DESC, u.code LIMIT ${TOP_PRODUCTS}`,
    [entityId, deptId, m.start, m.end, entityId],
  );
  const [[total]] = await pool.query(
    `SELECT COALESCE(SUM(l.revenue), 0) AS revenue, COUNT(DISTINCT l.item_code) AS products
       FROM sales_invoice_lines_accurate l
      WHERE l.entity_id = ? AND l.department_id = ? AND NOT l.is_dp AND l.trans_date BETWEEN ? AND ?`,
    [entityId, deptId, m.start, m.end],
  );
  let prevRows = [];
  if (rows.length) {
    [prevRows] = await pool.query(
      `SELECT l.item_code AS code, SUM(l.revenue) AS revenue
         FROM sales_invoice_lines_accurate l
        WHERE l.entity_id = ? AND l.department_id = ? AND NOT l.is_dp AND l.trans_date BETWEEN ? AND ?
          AND l.item_code IN (?)
        GROUP BY l.item_code`,
      [entityId, deptId, p.start, p.end, rows.map((r) => r.code)],
    );
  }
  return {
    connected: true,
    department: src.department,
    month: { key: m.key, label: m.label },
    prevMonth: { key: p.key, label: p.label },
    fallback,
    monthRevenue: money(total?.revenue),
    products: num(total?.products),
    rows: rankProducts(rows, prevRows, total?.revenue),
  };
}

// ---------------------------------------------------------- pending shipments

/** Marketplace sales orders not yet (fully) delivered, oldest first. */
async function pendingShipments(user) {
  const entityId = Number(user.entityId);
  const src = await source(entityId);
  if (src.reason) return { connected: false, reason: src.reason, department: src.department, rows: [], total: 0 };
  const deptId = src.department.id;
  const [rows] = await pool.query(
    `SELECT x.id, x.number, x.trans_date, x.channel, x.customer_name, x.status, x.so_state, x.percent_shipped,
            x.promised_date, x.promised_in_so, x.judged, s.dpp_amount,
            ${rules.lateSoSql('x')} AS is_late, ${rules.marketplaceRecapSql('x')} AS is_recap,
            DATEDIFF(${TODAY}, x.trans_date) AS days_open,
            GREATEST(DATEDIFF(${TODAY}, x.promised_date), 0) AS days_late
       FROM wh_so_fulfilment_accurate x
       LEFT JOIN sales_so_accurate s ON s.entity_id = x.entity_id AND s.id = x.id
      WHERE x.entity_id = ? AND x.sales_department_id = ? AND x.so_state IN ('open', 'partial')
      ORDER BY x.trans_date, x.id
      LIMIT ${SHIPMENTS_LIMIT}`,
    [entityId, deptId],
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS n FROM wh_so_fulfilment_accurate x
      WHERE x.entity_id = ? AND x.sales_department_id = ? AND x.so_state IN ('open', 'partial')`,
    [entityId, deptId],
  );
  return {
    connected: true,
    department: src.department,
    total: num(count?.n),
    limit: SHIPMENTS_LIMIT,
    shipSlaDays: rules.SHIP_SLA_DAYS,
    rows: rows.map((r) => ({
      id: Number(r.id),
      number: r.number,
      date: dateOnly(r.trans_date),
      channel: r.channel || null,
      platform: platformLabel(r.channel),
      customerName: r.customer_name || null,
      status: r.status || null,
      state: r.so_state,
      percentShipped: Math.round(num(r.percent_shipped) * 10) / 10,
      promisedDate: dateOnly(r.promised_date),
      promisedInSo: Boolean(Number(r.promised_in_so)),
      judged: Boolean(Number(r.judged)),
      amount: r.dpp_amount == null ? null : money(r.dpp_amount),
      daysOpen: num(r.days_open),
      daysLate: Number(r.judged) ? num(r.days_late) : 0,
      // The shared late-SO rule (warehouseRules.lateSoSql): a monthly marketplace
      // recap SO is never late; the count matches Warehouse and Alur penjualan.
      late: Boolean(Number(r.is_late)),
      recap: Boolean(Number(r.is_recap)),
    })),
  };
}

// --------------------------------------------------------------- receivables

/** Open marketplace invoices (not yet paid out), oldest due date first. */
async function receivables(user) {
  const entityId = Number(user.entityId);
  const src = await source(entityId);
  if (src.reason) return { connected: false, reason: src.reason, department: src.department, rows: [], total: 0 };
  const deptId = src.department.id;
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_number, i.trans_date, i.due_date, i.channel, i.dpp_amount, i.total_amount, i.outstanding_amount,
            GREATEST(DATEDIFF(${TODAY}, i.due_date), 0) AS days_overdue
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ? AND i.department_id = ? AND ${openReceivableSql('i')}
      ORDER BY i.due_date, i.id
      LIMIT ${RECEIVABLES_LIMIT}`,
    [entityId, deptId],
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS n FROM sales_invoices_accurate i
      WHERE i.entity_id = ? AND i.department_id = ? AND ${openReceivableSql('i')}`,
    [entityId, deptId],
  );
  return {
    connected: true,
    department: src.department,
    total: num(count?.n),
    limit: RECEIVABLES_LIMIT,
    rows: rows.map((r) => ({
      id: Number(r.id),
      number: r.invoice_number,
      date: dateOnly(r.trans_date),
      dueDate: dateOnly(r.due_date),
      channel: r.channel || null,
      platform: platformLabel(r.channel),
      dpp: money(r.dpp_amount),
      total: money(r.total_amount),
      outstanding: money(r.outstanding_amount),
      paid: money(num(r.total_amount) - num(r.outstanding_amount)),
      daysOverdue: num(r.days_overdue),
    })),
  };
}

module.exports = {
  RC_CODE, PLATFORM_LABELS, TOP_PRODUCTS, SHIPMENTS_LIMIT, RECEIVABLES_LIMIT,
  platformLabel, monthsBack, monthOf, previousMonth, clampMonths, buildOverview, rankProducts,
  rcDepartment, source, overview, topProducts, pendingShipments, receivables,
};
