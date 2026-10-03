// Vendors from approved Accurate data (docs/program-4-divisi.md 2.1). Only what
// the vendor list gives — no contact, tax or bank data exists in the mirror.
// PO counts and fill rate for everyone in Procurement; spend and last prices
// only for price viewers (P1).
const pool = require('../db/pool');
const rules = require('./procurementRules');
const prices = require('./procurementPrices.service');

const FILTERS = Object.freeze(['active', 'late', 'no_po', 'inactive']);
const TODAY = rules.TODAY;
const STATED = `SELECT p.*, ${rules.displayStateSql('p')} AS display_state FROM pc_po_accurate p WHERE p.entity_id = ?`;
const int = (v) => Number(v || 0);
const round1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

// Per vendor: POs, open and late ones, the last PO date. Binds: LATE_FROM, company, company.
const GROUPED = `SELECT v.id, v.vendor_no, v.name, v.category, v.status,
         COUNT(s.id) AS po_count,
         COALESCE(SUM(s.display_state IN ('open', 'partial', 'late')), 0) AS open_count,
         COALESCE(SUM(s.display_state = 'late'), 0) AS late_count,
         MAX(s.trans_date) AS last_po_date
    FROM pc_vendors_accurate v
    LEFT JOIN (${STATED}) s ON s.vendor_no = v.vendor_no
   WHERE v.entity_id = ?
   GROUP BY v.id, v.vendor_no, v.name, v.category, v.status`;

function where({ q, filter }) {
  const parts = [];
  const args = [];
  if (q) { parts.push('(g.name LIKE ? OR g.vendor_no LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (filter === 'active') parts.push(`g.last_po_date >= ${TODAY} - INTERVAL ${rules.ACTIVE_VENDOR_DAYS} DAY`);
  if (filter === 'late') parts.push('g.late_count > 0');
  if (filter === 'no_po') parts.push('g.po_count = 0');
  if (filter === 'inactive') parts.push("g.status = 'Nonaktif'");
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', args };
}

// Line-weighted: each line's received / ordered in its own unit, capped at 100%;
// only POs already due in the last 90 days count, and no "PO lama" (the
// management metric's rule).
async function fillRates(entityId, vendorNos) {
  if (!vendorNos.length) return new Map();
  const [rows] = await pool.query(
    `SELECT p.vendor_no, 100 * AVG(LEAST(COALESCE(l.received_qty, 0) / NULLIF(l.qty, 0), 1)) AS fill
       FROM pc_po_lines_accurate l JOIN pc_po_accurate p ON p.id = l.po_id AND p.entity_id = l.entity_id
      WHERE p.entity_id = ? AND p.vendor_no IN (?) AND l.qty > 0 AND p.trans_date >= ?
        AND p.due_date_eff BETWEEN ${TODAY} - INTERVAL ${rules.ACTIVE_VENDOR_DAYS} DAY AND ${TODAY} - INTERVAL 1 DAY
      GROUP BY p.vendor_no`,
    [entityId, vendorNos, rules.lateFrom()],
  );
  return new Map(rows.map((r) => [r.vendor_no, round1(r.fill)]));
}

// Rapor pemasok (program 3.1): of the POs fully received in the last 90 days
// with Warehouse-approved receipts, how many arrived by their due date, and
// how many days they took on average. "—" until receipts are in.
async function deliveryScores(entityId, vendorNos) {
  if (!vendorNos.length) return new Map();
  const [rows] = await pool.query(
    `SELECT p.vendor_no,
            100 * AVG(g.last_receipt <= p.due_date_eff) AS on_time,
            AVG(DATEDIFF(g.last_receipt, p.trans_date)) AS lead_days, COUNT(*) AS n
       FROM pc_po_accurate p
       JOIN (SELECT r.po_number, MAX(r.received_on) AS last_receipt FROM pc_po_receipts_accurate r
              WHERE r.entity_id = ? GROUP BY r.po_number) g ON g.po_number = p.number COLLATE utf8mb4_unicode_ci
      WHERE p.entity_id = ? AND p.vendor_no IN (?) AND p.po_state = 'received' AND p.trans_date >= ?
        AND g.last_receipt >= ${TODAY} - INTERVAL ${rules.ACTIVE_VENDOR_DAYS} DAY
      GROUP BY p.vendor_no`,
    [entityId, entityId, vendorNos, rules.lateFrom()],
  );
  return new Map(rows.map((r) => [r.vendor_no, { onTime: round1(r.on_time), leadDays: round1(r.lead_days), received: int(r.n) }]));
}

const vendorDto = (r, fill) => ({
  id: Number(r.id), vendorNo: r.vendor_no, name: r.name, category: r.category || null, status: r.status,
  poCount: int(r.po_count), openCount: int(r.open_count), lateCount: int(r.late_count), lastPoDate: r.last_po_date || null,
  fillRate: fill ?? null,
});

const scoreDto = (s) => ({ onTimeRate: s ? s.onTime : null, leadTimeDays: s ? s.leadDays : null, receivedPos: s ? s.received : 0 });

async function listVendors(entityId, { q, filter, page = 1, limit = 25 } = {}, { prices: canSeePrices = false } = {}) {
  const w = where({ q, filter: FILTERS.includes(filter) ? filter : null });
  const base = [rules.lateFrom(), entityId, entityId];
  const [rows] = await pool.query(
    `SELECT g.* FROM (${GROUPED}) g${w.sql} ORDER BY g.late_count DESC, g.open_count DESC, g.name LIMIT ? OFFSET ?`,
    [...base, ...w.args, limit, (page - 1) * limit],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM (${GROUPED}) g${w.sql}`, [...base, ...w.args]);
  const nos = rows.map((r) => r.vendor_no);
  const fills = await fillRates(entityId, nos);
  const scores = await deliveryScores(entityId, nos);
  const items = rows.map((r) => ({ ...vendorDto(r, fills.get(r.vendor_no)), ...scoreDto(scores.get(r.vendor_no)) }));
  if (canSeePrices) {
    const spend = await prices.vendorSpend(entityId, nos, { prices: true });
    for (const item of items) item.spend12m = spend.get(item.vendorNo) ?? 0;
  }
  return { items, total: int(count.n) };
}

async function getVendor(entityId, id, { prices: canSeePrices = false } = {}) {
  const [[row]] = await pool.query(`SELECT g.* FROM (${GROUPED}) g WHERE g.id = ?`, [rules.lateFrom(), entityId, entityId, id]);
  if (!row) return null;
  const fills = await fillRates(entityId, [row.vendor_no]);
  const scores = await deliveryScores(entityId, [row.vendor_no]);
  const [orders] = await pool.query(
    `SELECT s.id, s.number, s.trans_date, s.expected_date, s.due_date_eff, s.percent_received, s.display_state, s.line_count
       FROM (${STATED}) s WHERE s.vendor_no = ? ORDER BY s.trans_date DESC, s.id DESC LIMIT 20`,
    [rules.lateFrom(), entityId, row.vendor_no],
  );
  const vendor = {
    ...vendorDto(row, fills.get(row.vendor_no)),
    ...scoreDto(scores.get(row.vendor_no)),
    orders: orders.map((o) => ({
      id: Number(o.id), number: o.number, date: o.trans_date, expectedDate: o.expected_date, estimated: !o.expected_date, dueDate: o.due_date_eff,
      percentReceived: Number(o.percent_received || 0), state: o.display_state, lineCount: int(o.line_count),
    })),
  };
  if (canSeePrices) {
    vendor.spend12m = (await prices.vendorSpend(entityId, [row.vendor_no], { prices: true })).get(row.vendor_no) ?? 0;
    vendor.lastPrices = await prices.lastPrices(entityId, row.vendor_no, { prices: true });
  }
  return vendor;
}

// A vendor by its Accurate number, within the company.
async function findVendorId(entityId, vendorNo) {
  const [[row]] = await pool.query('SELECT id FROM pc_vendors_accurate WHERE entity_id = ? AND vendor_no = ? LIMIT 1', [entityId, vendorNo]);
  return row ? Number(row.id) : null;
}

module.exports = { FILTERS, listVendors, getVendor, findVendorId };
