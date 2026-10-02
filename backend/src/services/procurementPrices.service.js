// Purchase prices (owner decision P1): only the Procurement Supervisor/Head and
// the Management Office see them. The only reader of the pc_po_price* views
// besides the management provider (saran pesan ulang reads through
// reorderPrices here too); every call must say prices === true.
const pool = require('../db/pool');

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function assertPrices(prices) {
  if (prices !== true) throw httpError(403, 'FORBIDDEN', 'Harga beli hanya untuk Supervisor/Head Procurement dan Management Office.');
}

const money = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

// A line below MIN_COST_PER_BASE rupiah per base unit is a bonus/token line
// (PO.2026.08.00030: MKR-160 576 Pcs at Rp 16.000, then 1 Pcs at Rp 2), never a
// purchase price: every "last price" here, and the cost of slow movers, skips it.
const MIN_COST_PER_BASE = 10;
const REAL_PRICE = (a) => `COALESCE(${a}.price_per_base, ${a}.unit_price) >= ${MIN_COST_PER_BASE}`;

// One PO's value and its lines' prices.
async function orderPrices(entityId, poId, { prices } = {}) {
  assertPrices(prices);
  const [[head]] = await pool.query(
    'SELECT dpp_amount, tax_amount, total_amount, currency FROM pc_po_prices_accurate WHERE entity_id = ? AND po_id = ? LIMIT 1',
    [entityId, poId],
  );
  const [lines] = await pool.query(
    'SELECT line_no, unit_price, disc_pct, line_total FROM pc_po_price_lines_accurate WHERE entity_id = ? AND po_id = ? ORDER BY line_no',
    [entityId, poId],
  );
  return {
    value: head ? { dpp: money(head.dpp_amount), tax: money(head.tax_amount), total: money(head.total_amount), currency: head.currency || 'IDR' } : null,
    lines: new Map(lines.map((l) => [Number(l.line_no), { unitPrice: money(l.unit_price), discPct: l.disc_pct === null ? null : Number(l.disc_pct), lineTotal: money(l.line_total) }])),
  };
}

// Value before PPN per PO, for a page of POs.
async function orderValues(entityId, poIds, { prices } = {}) {
  assertPrices(prices);
  if (!poIds.length) return new Map();
  const [rows] = await pool.query(
    'SELECT po_id, dpp_amount FROM pc_po_prices_accurate WHERE entity_id = ? AND po_id IN (?)',
    [entityId, poIds],
  );
  return new Map(rows.map((r) => [Number(r.po_id), money(r.dpp_amount)]));
}

// Spend per vendor over the last 12 months (rupiah POs that count as spend).
async function vendorSpend(entityId, vendorNos, { prices } = {}) {
  assertPrices(prices);
  if (!vendorNos.length) return new Map();
  const [rows] = await pool.query(
    `SELECT vendor_no, SUM(dpp_amount) AS spend FROM pc_po_prices_accurate
      WHERE entity_id = ? AND vendor_no IN (?) AND currency = 'IDR' AND counts_as_spend = 1
        AND trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 12 MONTH
      GROUP BY vendor_no`,
    [entityId, vendorNos],
  );
  return new Map(rows.map((r) => [r.vendor_no, money(r.spend)]));
}

// The last price per item from one vendor (per item × unit; never across units).
async function lastPrices(entityId, vendorNo, { prices } = {}) {
  assertPrices(prices);
  const [rows] = await pool.query(
    `SELECT item_no, item_name, unit, unit_price, trans_date, po_number FROM (
       SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l.item_no, l.unit ORDER BY l.trans_date DESC, l.po_id DESC, l.line_no) AS rn
         FROM pc_po_price_lines_accurate l WHERE l.entity_id = ? AND l.vendor_no = ? AND ${REAL_PRICE('l')}) x
      WHERE x.rn = 1 ORDER BY x.item_name LIMIT 100`,
    [entityId, vendorNo],
  );
  return rows.map((r) => ({ itemNo: r.item_no, itemName: r.item_name, unit: r.unit, unitPrice: money(r.unit_price), date: r.trans_date, poNumber: r.po_number }));
}

// Harga beli (program 3.1): the latest price per vendor × item × unit (never
// compared across units), the one before it from the same vendor, and how
// much it moved. From PO lines — the prices actually ordered at.
const TRENDS = Object.freeze(['up', 'down', 'single']);
const LATEST = `SELECT x.* FROM (
    SELECT l.vendor_no, l.vendor_name, l.item_no, l.item_name, l.unit, l.unit_ratio, l.unit_price, l.price_per_base,
           l.trans_date, l.po_number, l.po_id,
           LAG(l.unit_price) OVER (PARTITION BY l.vendor_no, l.item_no, l.unit ORDER BY l.trans_date, l.po_id, l.line_no) AS prev_price,
           ROW_NUMBER() OVER (PARTITION BY l.vendor_no, l.item_no, l.unit ORDER BY l.trans_date DESC, l.po_id DESC, l.line_no DESC) AS rn,
           COUNT(*) OVER (PARTITION BY l.vendor_no, l.item_no, l.unit) AS n
      FROM pc_po_price_lines_accurate l
     WHERE l.entity_id = ? AND l.unit_price IS NOT NULL AND ${REAL_PRICE('l')}) x
   WHERE x.rn = 1`;

const priceDto = (r) => {
  const price = money(r.unit_price);
  const prev = r.prev_price === null || r.prev_price === undefined ? null : money(r.prev_price);
  return {
    vendorNo: r.vendor_no, vendorName: r.vendor_name, itemNo: r.item_no, itemName: r.item_name, unit: r.unit,
    unitRatio: r.unit_ratio === null ? null : Number(r.unit_ratio), unitPrice: price,
    pricePerBase: r.price_per_base === null || r.price_per_base === undefined ? null : money(r.price_per_base),
    date: r.trans_date, poNumber: r.po_number, previousPrice: prev, count: Number(r.n || 1),
    changePct: prev && prev > 0 && price !== null ? Math.round(((price - prev) / prev) * 1000) / 10 : null,
  };
};

async function priceList(entityId, { q, vendor, trend, page = 1, limit = 25 } = {}, { prices } = {}) {
  assertPrices(prices);
  const where = [];
  const args = [];
  if (q) { where.push('(p.item_no LIKE ? OR p.item_name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (vendor) { where.push('(p.vendor_no = ? OR p.vendor_name LIKE ?)'); args.push(vendor, `%${vendor}%`); }
  const trendSql = { up: 'p.unit_price > p.prev_price', down: 'p.unit_price < p.prev_price', single: 'p.n = 1' }[trend];
  const base = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const withTrend = trendSql ? `${base ? `${base} AND` : ' WHERE'} ${trendSql}` : base;
  const [rows] = await pool.query(
    `SELECT p.* FROM (${LATEST}) p${withTrend} ORDER BY p.trans_date DESC, p.item_name, p.vendor_name LIMIT ? OFFSET ?`,
    [entityId, ...args, limit, (page - 1) * limit],
  );
  const [[c]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(p.unit_price > p.prev_price), 0) AS up,
            COALESCE(SUM(p.unit_price < p.prev_price), 0) AS down, COALESCE(SUM(p.n = 1), 0) AS single
       FROM (${LATEST}) p${base}`,
    [entityId, ...args],
  );
  const counts = { all: Number(c.total), up: Number(c.up), down: Number(c.down), single: Number(c.single) };
  return { items: rows.map(priceDto), total: trendSql ? counts[trend] : counts.all, counts };
}

// One item's price history from one vendor (same unit), and the other vendors'
// latest price for it in the same unit.
async function priceHistory(entityId, { vendor, item, unit }, { prices } = {}) {
  assertPrices(prices);
  const [history] = await pool.query(
    `SELECT l.trans_date, l.po_number, l.unit_price, l.disc_pct, l.price_per_base
       FROM pc_po_price_lines_accurate l
      WHERE l.entity_id = ? AND l.vendor_no = ? AND l.item_no = ? AND l.unit = ? AND ${REAL_PRICE('l')}
      ORDER BY l.trans_date DESC, l.po_id DESC, l.line_no DESC LIMIT 12`,
    [entityId, vendor, item, unit],
  );
  const [others] = await pool.query(
    `SELECT p.* FROM (${LATEST}) p WHERE p.item_no = ? AND p.unit = ? AND p.vendor_no <> ? ORDER BY p.unit_price, p.vendor_name LIMIT 10`,
    [entityId, item, unit, vendor],
  );
  return {
    history: history.map((h) => ({ date: h.trans_date, poNumber: h.po_number, unitPrice: money(h.unit_price), discPct: h.disc_pct === null ? null : Number(h.disc_pct), pricePerBase: h.price_per_base === null ? null : money(h.price_per_base) })),
    otherVendors: others.map(priceDto),
  };
}

// Saran pesan ulang: the last price of each wanted vendor × item × unit, and
// its net DPP per purchase unit — line total ÷ qty, scaled by the PO's DPP ÷
// the sum of its line totals, so tax-inclusive POs (19 of 347), header
// discounts and discounts missing from disc_pct all land before PPN. IDR POs
// that count as spend only. Matched on the unit (case-insensitive, like the
// SQL partition); never compared across units. A line whose net cost is below
// MIN_COST_PER_BASE per base unit is a bonus line (as in latestCosts), skipped.
async function reorderPrices(entityId, wanted, { prices } = {}) {
  assertPrices(prices);
  if (!wanted.length) return new Map();
  const [rows] = await pool.query(
    `SELECT x.vendor_no, x.item_no, x.unit, x.unit_price, x.disc_pct, x.net_price, x.trans_date FROM (
       SELECT l.vendor_no, l.item_no, l.unit, l.unit_price, l.disc_pct, l.trans_date,
              l.line_total / NULLIF(q.qty, 0) * v.dpp_amount / NULLIF(t.lines_total, 0) AS net_price,
              ROW_NUMBER() OVER (PARTITION BY l.vendor_no, l.item_no, l.unit ORDER BY l.trans_date DESC, l.po_id DESC, l.line_no DESC) AS rn
         FROM pc_po_price_lines_accurate l
         JOIN pc_po_lines_accurate q ON q.entity_id = l.entity_id AND q.po_id = l.po_id AND q.line_no = l.line_no
         JOIN pc_po_prices_accurate v ON v.entity_id = l.entity_id AND v.po_id = l.po_id
         JOIN (SELECT s.po_id, SUM(s.line_total) AS lines_total FROM pc_po_price_lines_accurate s
                WHERE s.entity_id = ? GROUP BY s.po_id) t ON t.po_id = l.po_id
        WHERE l.entity_id = ? AND l.item_no IN (?) AND l.unit_price IS NOT NULL
          AND v.counts_as_spend = 1 AND v.currency = 'IDR'
          AND l.line_total / NULLIF(q.qty_base, 0) * v.dpp_amount / NULLIF(t.lines_total, 0) >= ${MIN_COST_PER_BASE}) x
      WHERE x.rn = 1`,
    [entityId, entityId, [...new Set(wanted.map((w) => w.itemNo))]],
  );
  const key = (vendorNo, itemNo, unit) => [vendorNo, itemNo, unit || ''].map((v) => String(v ?? '').toLowerCase()).join('\u0000');
  const byKey = new Map(rows.map((r) => [key(r.vendor_no, r.item_no, r.unit), r]));
  const found = new Map();
  for (const w of wanted) {
    const r = byKey.get(key(w.vendorNo, w.itemNo, w.unit));
    if (!r) continue;
    found.set(w.itemNo, {
      unitPrice: money(r.unit_price), discPct: r.disc_pct === null || r.disc_pct === undefined ? null : Number(r.disc_pct),
      netPrice: money(r.net_price), date: r.trans_date instanceof Date ? r.trans_date.toISOString().slice(0, 10) : r.trans_date,
    });
  }
  return found;
}

// ------------------------------------------------------------------ program 3.3
// Perkiraan margin (harga PO) and the value of slow movers, for the Management
// Office only (management_dashboard.view AND procurement.price.view). They read
// pc_po_price_costs_accurate (migration 101): the cost per base unit of each PO
// line before PPN and PO header discounts, from POs that count as spend in
// rupiah — the same net price as reorderPrices above. Prakasa AI never calls
// these (guard test).
// Lines below MIN_COST_PER_BASE (top of this file) are bonus lines, not costs.

// One row per approved faktur line of the period (down payments left out): its
// revenue (allocated to the faktur DPP), quantity in base units (unit ratio from
// item_units_accurate, else from PO lines of the same item and unit; unknown →
// NULL, never guessed) and the cost per base unit of the latest PO on or before
// the sale — or, when none exists, of the nearest later PO (cost_after = 1).
// The costs are materialised once (NO_MERGE): merged into the line join, the
// PO JSON would be expanded again for every faktur line (36 s instead of 0.2 s).
async function marginLines(entityId, { from, to, departmentId = null } = {}, { prices } = {}) {
  assertPrices(prices);
  const s = departmentId == null ? { sql: '', args: [] } : { sql: ' AND x.department_id = ?', args: [Number(departmentId)] };
  const [rows] = await pool.query(
    `WITH l AS (SELECT x.invoice_id, x.line_no, x.department_id, x.trans_date, x.item_code, x.item_name, x.qty, x.unit, x.revenue
                  FROM mg_invoice_lines_accurate x
                 WHERE x.entity_id = ?${s.sql} AND NOT x.is_dp AND x.trans_date BETWEEN ? AND ?),
          u AS (SELECT iu.item_no, iu.unit_name AS unit, MAX(iu.ratio) AS ratio FROM item_units_accurate iu
                 WHERE iu.entity_id = ? GROUP BY iu.item_no, iu.unit_name),
          pu AS (SELECT pl.item_no, pl.unit, MAX(pl.unit_ratio) AS ratio FROM pc_po_lines_accurate pl
                  WHERE pl.entity_id = ? AND pl.unit_ratio > 0 AND pl.unit IS NOT NULL GROUP BY pl.item_no, pl.unit),
          c AS (SELECT /*+ NO_MERGE(pc) */ pc.item_no, pc.trans_date, pc.po_id, pc.line_no, pc.cost_per_base FROM pc_po_price_costs_accurate pc
                 WHERE pc.entity_id = ? AND pc.cost_per_base >= ${MIN_COST_PER_BASE}),
          lb AS (SELECT l.*, l.qty * COALESCE(u.ratio, pu.ratio) AS qty_base FROM l
                   LEFT JOIN u ON u.item_no = l.item_code AND u.unit = l.unit
                   LEFT JOIN pu ON pu.item_no = l.item_code AND pu.unit = l.unit),
          k AS (SELECT /*+ NO_MERGE(c) */ lb.invoice_id, lb.line_no, c.cost_per_base, c.trans_date AS cost_date,
                       ROW_NUMBER() OVER (PARTITION BY lb.invoice_id, lb.line_no
                                          ORDER BY c.trans_date <= lb.trans_date DESC, ABS(DATEDIFF(c.trans_date, lb.trans_date)),
                                                   c.po_id DESC, c.line_no DESC) AS rn
                  FROM lb JOIN c ON c.item_no = lb.item_code)
     SELECT lb.department_id, DATE_FORMAT(lb.trans_date, '%Y-%m') AS month, lb.item_code, lb.item_name, lb.unit, lb.qty, lb.qty_base,
            lb.revenue, k.cost_per_base, k.cost_date, k.cost_date > lb.trans_date AS cost_after
       FROM lb LEFT JOIN k ON k.invoice_id = lb.invoice_id AND k.line_no = lb.line_no AND k.rn = 1`,
    [entityId, ...s.args, from, to, entityId, entityId, entityId],
  );
  return rows;
}

// The latest cost per base unit of each item (any vendor), for the value of
// slow movers. Map(item_no → { costPerBase, date }).
async function latestCosts(entityId, itemNos, { prices } = {}) {
  assertPrices(prices);
  if (!itemNos || !itemNos.length) return new Map();
  const [rows] = await pool.query(
    `SELECT x.item_no, x.cost_per_base, x.trans_date FROM (
       SELECT c.item_no, c.cost_per_base, c.trans_date,
              ROW_NUMBER() OVER (PARTITION BY c.item_no ORDER BY c.trans_date DESC, c.po_id DESC, c.line_no DESC) AS rn
         FROM pc_po_price_costs_accurate c
        WHERE c.entity_id = ? AND c.item_no IN (?) AND c.cost_per_base >= ?) x
      WHERE x.rn = 1`,
    [entityId, [...new Set(itemNos)], MIN_COST_PER_BASE],
  );
  return new Map(rows.map((r) => [r.item_no, {
    costPerBase: r.cost_per_base === null || r.cost_per_base === undefined ? null : Number(r.cost_per_base),
    date: r.trans_date instanceof Date ? r.trans_date.toISOString().slice(0, 10) : r.trans_date,
  }]));
}

module.exports = {
  TRENDS, orderPrices, orderValues, vendorSpend, lastPrices, priceList, priceHistory, reorderPrices,
  MIN_COST_PER_BASE, marginLines, latestCosts,
};
