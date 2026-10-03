// Purchase orders from approved Accurate data (docs/program-4-divisi.md 2.1).
// Read-only; quantities and dates for every Procurement viewer, prices only
// when the caller may see them (P1) — then from the price service, so for
// everyone else the price keys are absent, not null.
const pool = require('../db/pool');
const rules = require('./procurementRules');
const prices = require('./procurementPrices.service');

const STATES = Object.freeze(['open', 'partial', 'late', 'received', 'closed', 'legacy']);
const TODAY = rules.TODAY;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const int = (v) => Number(v || 0);

// Every PO with the state the page shows. Binds: LATE_FROM, then the company.
const STATED = `SELECT p.*, ${rules.displayStateSql('p')} AS display_state FROM pc_po_accurate p WHERE p.entity_id = ?`;

// The latest applied and pending Procurement batch, and whether Warehouse
// receipts (D4) are in yet.
async function status(entityId) {
  const [[applied]] = await pool.query(
    `SELECT b.id, b.decided_at, b.applied_at, u.name AS decided_by, r.started_at AS pulled_at
       FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'procurement'
       LEFT JOIN users u ON u.id = b.decided_by
       LEFT JOIN sales_sync_runs r ON r.id = b.sync_run_id
      WHERE b.entity_id = ? AND b.status = 'applied'
      ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  const [[pending]] = await pool.query(
    `SELECT b.id, b.item_count, b.created_at FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'procurement'
      WHERE b.entity_id = ? AND b.status = 'pending' ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  const [[receipts]] = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM accurate_records r WHERE r.entity_id = ? AND r.record_type = 'wh_receipt') AS live",
    [entityId],
  );
  return {
    ready: Boolean(applied),
    receiptsLive: Boolean(Number(receipts?.live)),
    enabled: process.env.ACCURATE_PROCUREMENT === '1',
    asOf: applied ? { batchId: Number(applied.id), pulledAt: applied.pulled_at || null, approvedAt: applied.decided_at || applied.applied_at, approvedBy: applied.decided_by || null } : null,
    pending: pending ? { batchId: Number(pending.id), items: int(pending.item_count), createdAt: pending.created_at } : null,
  };
}

const orderDto = (r) => ({
  id: Number(r.id),
  number: r.number,
  date: r.trans_date,
  status: r.status,
  vendorNo: r.vendor_no,
  vendorName: r.vendor_name,
  expectedDate: r.expected_date,
  estimated: !r.expected_date,
  dueDate: r.due_date_eff,
  percentReceived: num(r.percent_received) ?? 0,
  state: r.display_state,
  lineCount: int(r.line_count),
  daysLate: r.display_state === 'late' ? int(r.days_late) : null,
});

function filters({ state, q, vendor, from, to }) {
  const where = [];
  const args = [];
  if (STATES.includes(state)) { where.push('s.display_state = ?'); args.push(state); }
  if (q) {
    where.push(`(s.number LIKE ? OR s.vendor_name LIKE ? OR EXISTS (SELECT 1 FROM pc_po_lines_accurate l
                  WHERE l.entity_id = s.entity_id AND l.po_id = s.id AND (l.item_no LIKE ? OR l.item_name LIKE ?)))`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (vendor) { where.push('s.vendor_no = ?'); args.push(vendor); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push('s.trans_date >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push('s.trans_date <= ?'); args.push(to); }
  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', args };
}

async function listOrders(entityId, { state, q, vendor, from, to, page = 1, limit = 25 } = {}, { prices: canSeePrices = false } = {}) {
  const f = filters({ state, q, vendor, from, to });
  const base = [rules.lateFrom(), entityId];
  // Waiting and late POs by their deadline; everything else newest first.
  const order = ['open', 'partial', 'late'].includes(state) ? 's.due_date_eff ASC, s.id ASC' : 's.trans_date DESC, s.id DESC';
  const [rows] = await pool.query(
    `SELECT s.*, DATEDIFF(${TODAY}, s.due_date_eff) AS days_late FROM (${STATED}) s WHERE 1 = 1${f.sql}
      ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...base, ...f.args, limit, (page - 1) * limit],
  );
  const noState = filters({ q, vendor, from, to });
  const [[counts]] = await pool.query(
    `SELECT COUNT(*) AS total, ${STATES.map((st) => `COALESCE(SUM(s.display_state = '${st}'), 0) AS ${st}`).join(', ')}
       FROM (${STATED}) s WHERE 1 = 1${noState.sql}`,
    [...base, ...noState.args],
  );
  const items = rows.map(orderDto);
  if (canSeePrices) {
    const values = await prices.orderValues(entityId, items.map((i) => i.id), { prices: true });
    for (const item of items) item.value = values.get(item.id) ?? null;
  }
  const total = STATES.includes(state) ? int(counts[state]) : int(counts.total);
  return {
    items, total,
    counts: { all: int(counts.total), ...Object.fromEntries(STATES.map((st) => [st, int(counts[st])])) },
  };
}

async function getOrder(entityId, id, { prices: canSeePrices = false } = {}) {
  const [[row]] = await pool.query(
    `SELECT s.*, DATEDIFF(${TODAY}, s.due_date_eff) AS days_late FROM (${STATED}) s WHERE s.id = ?`,
    [rules.lateFrom(), entityId, id],
  );
  if (!row) return null;
  const [lines] = await pool.query(
    `SELECT line_no, item_no, item_name, qty, unit, unit_ratio, received_qty, remaining_qty, returned_qty, closed, warehouse
       FROM pc_po_lines_accurate WHERE entity_id = ? AND po_id = ? ORDER BY line_no`,
    [entityId, id],
  );
  const [receipts] = await pool.query(
    `SELECT receipt_id, receipt_number, received_on, COUNT(*) AS line_count, MIN(warehouse) AS warehouse
       FROM pc_po_receipts_accurate WHERE entity_id = ? AND po_number = ?
      GROUP BY receipt_id, receipt_number, received_on ORDER BY received_on, receipt_number`,
    [entityId, row.number],
  );
  const order = {
    ...orderDto(row),
    paymentTerm: row.payment_term || null,
    currency: row.currency || 'IDR',
    lines: lines.map((l) => ({
      lineNo: int(l.line_no), itemNo: l.item_no, itemName: l.item_name, unit: l.unit, unitRatio: num(l.unit_ratio),
      qty: num(l.qty), receivedQty: num(l.received_qty), remainingQty: num(l.remaining_qty), returnedQty: num(l.returned_qty),
      closed: Boolean(Number(l.closed)), warehouse: l.warehouse,
    })),
    receipts: receipts.map((r) => ({ id: Number(r.receipt_id), number: r.receipt_number, date: r.received_on, lineCount: int(r.line_count), warehouse: r.warehouse })),
  };
  if (canSeePrices) {
    const p = await prices.orderPrices(entityId, id, { prices: true });
    order.value = p.value;
    for (const line of order.lines) Object.assign(line, p.lines.get(line.lineNo) || { unitPrice: null, discPct: null, lineTotal: null });
  }
  return order;
}

// The Procurement day: what needs a look, what arrives, what is expected.
async function today(entityId) {
  const base = [rules.lateFrom(), entityId];
  const [[attention]] = await pool.query(
    `SELECT COALESCE(SUM(s.display_state = 'late'), 0) AS late,
            COALESCE(SUM(s.display_state IN ('open', 'partial') AND s.due_date_eff BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${rules.DUE_SOON_DAYS - 1} DAY), 0) AS due_soon,
            COALESCE(SUM(s.display_state IN ('open', 'partial', 'late') AND s.expected_date IS NULL), 0) AS no_expected_date,
            COALESCE(SUM(s.display_state = 'legacy'), 0) AS legacy
       FROM (${STATED}) s`,
    base,
  );
  const [expected] = await pool.query(
    `SELECT s.*, 0 AS days_late FROM (${STATED}) s
      WHERE s.display_state IN ('open', 'partial') AND s.due_date_eff BETWEEN ${TODAY} AND ${TODAY} + INTERVAL 1 DAY
      ORDER BY s.due_date_eff, s.number LIMIT 50`,
    base,
  );
  const [arrivals] = await pool.query(
    `SELECT id, number, vendor_name, po_numbers, line_count FROM pc_receipts_accurate
      WHERE entity_id = ? AND trans_date = ${TODAY} ORDER BY number LIMIT 50`,
    [entityId],
  );
  const [[day]] = await pool.query(`SELECT DATE_FORMAT(${TODAY}, '%Y-%m-%d') AS today`);
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : (v || []));
  return {
    date: day?.today || null,
    attention: { late: int(attention?.late), dueSoon: int(attention?.due_soon), noExpectedDate: int(attention?.no_expected_date), legacy: int(attention?.legacy) },
    expected: expected.map(orderDto),
    arrivals: arrivals.map((r) => ({ id: Number(r.id), number: r.number, vendorName: r.vendor_name, poNumbers: parse(r.po_numbers), lineCount: int(r.line_count) })),
  };
}

// A PO by its number, within the company.
async function findOrderId(entityId, number) {
  const [[row]] = await pool.query('SELECT id FROM pc_po_accurate WHERE entity_id = ? AND number = ? LIMIT 1', [entityId, number]);
  return row ? Number(row.id) : null;
}

module.exports = { STATES, status, listOrders, getOrder, today, findOrderId };
