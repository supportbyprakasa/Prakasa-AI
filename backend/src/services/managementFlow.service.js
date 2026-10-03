// Alur & Margin (program 3.3, Management): what the page reads apart from
// purchase prices. Read-only over the approved Accurate mirror (migrations 099–
// 102); it never writes and never calls Accurate. Purchase prices live only in
// procurementPrices.service (marginLines, latestCosts), behind prices === true.
//
// Every MySQL number (DECIMAL, SUM, COUNT) is read through int()/num() before
// any arithmetic: the driver hands them back as strings.
const pool = require('../db/pool');
const { openReceivableSql, revenueInvoiceSql } = require('./invoiceRules');
const rules = require('./flowRules');
const procurementRules = require('./procurementRules');
const warehouseRules = require('./warehouseRules');
const salesSource = require('./salesSource');
const prices = require('./procurementPrices.service');
const { MIN_HISTORY_DAYS } = require('./warehouseStock.service');

const { TODAY } = rules;
const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));
const flag = (v) => Boolean(Number(v));

// Divisions whose Accurate batch still waits for a decision: the page says its
// figures do not include them yet.
async function pendingDivisions(entityId) {
  const [rows] = await pool.query(
    `SELECT d.code FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id
      WHERE b.entity_id = ? AND b.status = 'pending' GROUP BY d.code ORDER BY d.code`,
    [entityId],
  );
  return rows.map((r) => r.code);
}

// ------------------------------------------------------------------ sales flow

const SALES_STEPS = Object.freeze([
  { key: 'order_to_start', label: 'SO → mulai dikirim' },
  { key: 'order_to_full', label: 'SO → terkirim lengkap' },
  { key: 'ship_to_bill', label: 'Surat jalan → faktur' },
  { key: 'bill_to_paid', label: 'Faktur → lunas' },
  { key: 'order_to_paid', label: 'SO → lunas' },
]);
const emptyStages = () => ({ total: 0, started: 0, shippedFull: 0, billed: 0, paid: 0, closed: 0, ordered: 0 });

function emptySalesFlow(period, pending) {
  return {
    period, ready: false, pending, otifFrom: warehouseRules.otifFrom(),
    stages: emptyStages(), shippedBy: { delivery: 0, invoice: 0 },
    steps: SALES_STEPS.map((s) => ({ ...s, ...rules.stepStats([]) })),
    byDivision: [],
    stuck: { notShipped: { count: 0, escalated: 0, items: [] }, notBilled: { count: 0, escalated: 0, items: [] }, overdue: { count: 0, amount: 0 } },
    invoicesWithoutSo: 0,
  };
}

async function salesFlow(entityId, period) {
  const pending = await pendingDivisions(entityId);
  if (!(await salesSource.numbersFromAccurate(entityId))) return emptySalesFlow(period, pending);
  const otifFrom = warehouseRules.otifFrom();
  const [[rows], [late], [unbilled], [[overdue]], [[orphans]]] = await Promise.all([
    pool.query(
      `SELECT f.so_id, f.department_id, d.name AS department_name, f.stage, f.shipped_by, f.so_state, f.closed,
              f.started_on IS NOT NULL AS started,
              DATEDIFF(f.started_on, f.ordered_on) AS order_to_start,
              DATEDIFF(f.shipped_on, f.ordered_on) AS order_to_full,
              IF(f.shipped_by = 'delivery', DATEDIFF(f.billed_on, f.delivered_on), NULL) AS ship_to_bill,
              DATEDIFF(f.paid_on, f.billed_on) AS bill_to_paid,
              DATEDIFF(f.paid_on, f.ordered_on) AS order_to_paid
         FROM mg_sales_flow_accurate f
         LEFT JOIN departments d ON d.id = f.department_id
        WHERE f.entity_id = ? AND f.ordered_on BETWEEN ? AND ?`,
      [entityId, period.from, period.to],
    ),
    // Not shipped by the Warehouse promise (099): the list only, by the shared
    // late-SO rule (warehouseRules.lateSoSql: from OTIF_FROM, monthly marketplace
    // recap SOs left out) — the same SOs warehouse_so_late escalates, once.
    pool.query(
      `SELECT x.id AS so_id, x.number AS so_number, x.customer_name, x.sales_department_id AS department_id,
              x.trans_date AS ordered_on, x.percent_shipped, x.promised_date AS due_on, NOT x.promised_in_so AS due_estimated,
              ${warehouseRules.promiseShiftedSql('x')} AS due_shifted,
              DATEDIFF(${TODAY}, x.promised_date) AS days_late, TRUE AS escalated
         FROM wh_so_fulfilment_accurate x
        WHERE x.entity_id = ? AND ${warehouseRules.lateSoSql('x')}
        ORDER BY days_late DESC, x.id`,
      [entityId],
    ),
    pool.query(
      `SELECT f.so_id, f.so_number, f.customer_name, f.department_id, f.ordered_on, f.delivered_on,
              DATEDIFF(${TODAY}, f.delivered_on) - ${rules.BILL_GRACE_DAYS} AS days_late,
              f.delivered_on >= ${TODAY} - INTERVAL ${rules.BILL_WINDOW_DAYS} DAY AS escalated
         FROM mg_sales_flow_accurate f
        WHERE f.entity_id = ? AND ${rules.notBilledSql('f')}
        ORDER BY days_late DESC, f.so_id`,
      [entityId],
    ),
    // The same rule as the Sales KPI "Tagihan terlambat" (escalated by Sales).
    pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(i.outstanding_amount), 0) AS amount
         FROM sales_invoices_accurate i
        WHERE i.entity_id = ? AND ${openReceivableSql('i')} AND i.due_date < ${TODAY}`,
      [entityId],
    ),
    pool.query(
      `SELECT COUNT(*) AS n FROM sales_invoices_accurate i
        WHERE i.entity_id = ? AND ${revenueInvoiceSql('i')} AND i.trans_date BETWEEN ? AND ? AND COALESCE(JSON_LENGTH(i.so_numbers), 0) = 0`,
      [entityId, period.from, period.to],
    ),
  ]);

  const stages = emptyStages();
  const shippedBy = { delivery: 0, invoice: 0 };
  const values = Object.fromEntries(SALES_STEPS.map((s) => [s.key, []]));
  const divisions = new Map();
  for (const r of rows) {
    stages.total += 1;
    const started = flag(r.started);
    if (started) stages.started += 1;
    if (r.so_state === 'shipped') stages.shippedFull += 1;
    if (r.stage === 'billed' || r.stage === 'paid') stages.billed += 1;
    if (r.stage === 'paid') stages.paid += 1;
    if (flag(r.closed)) stages.closed += 1;
    if (r.stage === 'ordered') stages.ordered += 1;
    if (started && (r.shipped_by === 'delivery' || r.shipped_by === 'invoice')) shippedBy[r.shipped_by] += 1;
    for (const s of SALES_STEPS) values[s.key].push(r[s.key]);
    const id = r.department_id == null ? null : Number(r.department_id);
    if (!divisions.has(id)) divisions.set(id, { departmentId: id, departmentName: r.department_name || null, total: 0, shippedFull: 0, billed: 0, paid: 0 });
    const dv = divisions.get(id);
    dv.total += 1;
    if (r.so_state === 'shipped') dv.shippedFull += 1;
    if (r.stage === 'billed' || r.stage === 'paid') dv.billed += 1;
    if (r.stage === 'paid') dv.paid += 1;
  }

  const lateItem = (r) => ({
    soId: Number(r.so_id), soNumber: r.so_number, customerName: r.customer_name || null,
    departmentId: r.department_id == null ? null : Number(r.department_id),
    orderedOn: dateOnly(r.ordered_on), dueOn: dateOnly(r.due_on), dueEstimated: flag(r.due_estimated), dueShifted: flag(r.due_shifted),
    percentShipped: round1(num(r.percent_shipped) ?? 0), daysLate: int(r.days_late), escalated: flag(r.escalated),
  });
  const billItem = (r) => ({
    soId: Number(r.so_id), soNumber: r.so_number, customerName: r.customer_name || null,
    departmentId: r.department_id == null ? null : Number(r.department_id),
    orderedOn: dateOnly(r.ordered_on), deliveredOn: dateOnly(r.delivered_on), daysLate: int(r.days_late), escalated: flag(r.escalated),
  });
  const list = (items, map) => ({
    count: items.length,
    escalated: items.filter((r) => flag(r.escalated)).length,
    items: items.slice(0, rules.STUCK_ITEMS_MAX).map(map),
  });

  return {
    period, ready: true, pending, otifFrom,
    stages, shippedBy,
    steps: SALES_STEPS.map((s) => ({ ...s, ...rules.stepStats(values[s.key]) })),
    byDivision: [...divisions.values()].sort((a, b) => b.total - a.total),
    stuck: {
      notShipped: list(late, lateItem),
      notBilled: list(unbilled, billItem),
      overdue: { count: int(overdue?.n), amount: Math.round(num(overdue?.amount) ?? 0) },
    },
    invoicesWithoutSo: int(orphans?.n),
  };
}

// ------------------------------------------------------------------ purchase flow

const PO_STATES = Object.freeze(['open', 'partial', 'late', 'received', 'closed', 'legacy']);
const PURCHASE_STEPS = Object.freeze([
  { key: 'po_to_first', label: 'PO → barang pertama datang' },
  { key: 'po_to_complete', label: 'PO → diterima lengkap' },
]);

async function purchaseFlow(entityId, period) {
  const lateFrom = procurementRules.lateFrom();
  const [[[ready]], [rows], [now], pending] = await Promise.all([
    pool.query(
      `SELECT EXISTS(SELECT 1 FROM pc_po_accurate p WHERE p.entity_id = ?) AS po_ready,
              EXISTS(SELECT 1 FROM wh_documents_accurate w WHERE w.entity_id = ? AND w.doc_type = 'receipt') AS receipts_ready`,
      [entityId, entityId],
    ),
    // Cohort: POs dated in the period. Quantities and dates only.
    pool.query(
      `SELECT b.po_id, ${procurementRules.displayStateSql('b')} AS state,
              DATEDIFF(b.first_received_on, b.trans_date) AS po_to_first,
              DATEDIFF(b.completed_on, b.trans_date) AS po_to_complete,
              b.completed_on IS NOT NULL AS completed, b.completed_on <= b.due_date_eff AS on_time
         FROM mg_buy_flow_accurate b
        WHERE b.entity_id = ? AND b.trans_date BETWEEN ? AND ?`,
      [lateFrom, entityId, period.from, period.to],
    ),
    pool.query(
      `SELECT x.state, COUNT(*) AS n FROM (SELECT ${procurementRules.displayStateSql('p')} AS state
         FROM pc_po_accurate p WHERE p.entity_id = ?) x GROUP BY x.state`,
      [lateFrom, entityId],
    ),
    pendingDivisions(entityId),
  ]);
  const poReady = flag(ready?.po_ready);
  const receiptsReady = flag(ready?.receipts_ready);
  const stages = Object.fromEntries(PO_STATES.map((s) => [s, 0]));
  const values = { po_to_first: [], po_to_complete: [] };
  let completed = 0;
  let onTime = 0;
  for (const r of rows) {
    if (stages[r.state] !== undefined) stages[r.state] += 1;
    values.po_to_first.push(r.po_to_first);
    values.po_to_complete.push(r.po_to_complete);
    if (flag(r.completed)) {
      completed += 1;
      if (flag(r.on_time)) onTime += 1;
    }
  }
  const current = Object.fromEntries(PO_STATES.map((s) => [s, 0]));
  for (const r of now) if (current[r.state] !== undefined) current[r.state] = int(r.n);
  const stat = (key) => (receiptsReady ? rules.stepStats(values[key]) : { count: 0, avgDays: null, medianDays: null, p90Days: null });
  return {
    period, ready: poReady, receiptsReady, pending, lateFrom,
    total: rows.length,
    stages,
    steps: PURCHASE_STEPS.map((s) => ({ ...s, ...stat(s.key) })),
    // "Lengkap tepat waktu": of the POs of the period already received in full
    // (with Warehouse-approved receipts), the share that arrived by their due
    // date. Not the target metric "PO datang tepat waktu" (procurement_on_time_rate),
    // which the page links to.
    onTime: { completed, onTime, pct: receiptsReady && completed ? round1((100 * onTime) / completed) : null },
    stuck: [
      { state: 'late', count: current.late, link: '/procurement?tab=orders&state=late' },
      { state: 'partial', count: current.partial, link: '/procurement?tab=orders&state=partial' },
      { state: 'legacy', count: current.legacy, link: '/procurement?tab=orders&state=legacy' },
    ],
  };
}

// ------------------------------------------------------------------ margin (non-price parts)

// Revenue of the same slices from sales_revenue_accurate (DPP, down payments
// out), per month and division, with returns (positive) beside it.
async function marginContext(entityId, { from, to }, departmentId = null) {
  const s = departmentId == null ? { sql: '', args: [] } : { sql: ' AND r.department_id = ?', args: [Number(departmentId)] };
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(r.trans_date, '%Y-%m') AS month, r.department_id,
            COALESCE(SUM(CASE WHEN r.kind = 'invoice' THEN r.amount END), 0) AS invoiced,
            COALESCE(SUM(CASE WHEN r.kind = 'return' THEN -r.amount END), 0) AS returns
       FROM sales_revenue_accurate r
      WHERE r.entity_id = ?${s.sql} AND r.trans_date BETWEEN ? AND ?
      GROUP BY DATE_FORMAT(r.trans_date, '%Y-%m'), r.department_id`,
    [entityId, ...s.args, from, to],
  );
  const slices = rows.map((r) => ({
    month: r.month, departmentId: r.department_id == null ? null : Number(r.department_id),
    invoiced: num(r.invoiced) ?? 0, returns: num(r.returns) ?? 0,
  }));
  return {
    invoiced: slices.reduce((t, x) => t + x.invoiced, 0),
    returns: slices.reduce((t, x) => t + x.returns, 0),
    slices,
  };
}

// The divisions a margin can be filtered by: Sales and Retail Commerce.
async function marginDivisions(entityId) {
  const [rows] = await pool.query(
    `SELECT id, name FROM departments
      WHERE entity_id = ? AND deleted_at IS NULL AND code IN ('sales', 'retail_commerce') ORDER BY name`,
    [entityId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

// ------------------------------------------------------------------ slow movers

// Items with Accurate stock above zero and no approved sale for SLOW_DAYS.
// Split (Head Supply Chain): sold before and now idle, versus never sold since
// the sales history starts — mostly old item codes whose stock was never moved
// to the new code, which Warehouse/Procurement should check in Accurate.
async function slowMovers(entityId, { prices: canSeePrices = false } = {}) {
  const [[[head]], [rows], pending] = await Promise.all([
    pool.query(
      `SELECT (SELECT COUNT(*) FROM wh_stock_total_accurate t WHERE t.entity_id = ? AND t.qty > 0) AS stock_items,
              (SELECT MIN(s.data_start) FROM mg_stock_idle_accurate s WHERE s.entity_id = ?) AS data_start`,
      [entityId, entityId],
    ),
    pool.query(
      `SELECT s.item_id, s.item_no, s.item_name, s.qty, s.qty_all_units, s.last_sold_on, s.first_po_on, s.never_sold,
              s.idle_since, s.idle_days, IF(s.history_days >= ${MIN_HISTORY_DAYS}, s.out_30d, NULL) AS out_30d
         FROM mg_stock_idle_accurate s
        WHERE s.entity_id = ? AND s.idle_days >= ${rules.SLOW_DAYS}
        ORDER BY s.never_sold, s.idle_days DESC, s.item_no`,
      [entityId],
    ),
    pendingDivisions(entityId),
  ]);
  const dataStart = dateOnly(head?.data_start);
  const items = rows.map((r) => {
    const neverSold = flag(r.never_sold);
    const idleDays = int(r.idle_days);
    return {
      itemId: Number(r.item_id), itemNo: r.item_no, itemName: r.item_name || null,
      qty: num(r.qty), qtyAllUnits: r.qty_all_units || null,
      lastSoldOn: dateOnly(r.last_sold_on), firstPoOn: dateOnly(r.first_po_on), neverSold,
      idleSince: dateOnly(r.idle_since), idleDays,
      out30d: num(r.out_30d),
      status: neverSold ? 'never_sold' : (idleDays >= rules.DEAD_DAYS ? 'not_moving' : 'slow_moving'),
    };
  });
  const counts = {
    slow: items.filter((i) => i.status === 'slow_moving').length,
    dead: items.filter((i) => i.status === 'not_moving').length,
    neverSold: items.filter((i) => i.status === 'never_sold').length,
  };
  let valueTotals = null;
  if (canSeePrices === true && items.length) {
    const costs = await prices.latestCosts(entityId, items.map((i) => i.itemNo), { prices: true });
    const byCode = new Map([...costs.entries()].map(([k, v]) => [String(k).toLowerCase(), v]));
    valueTotals = { slow: 0, dead: 0, neverSold: 0, unknown: 0 };
    for (const item of items) {
      const c = byCode.get(String(item.itemNo).toLowerCase());
      item.value = c && c.costPerBase !== null && item.qty !== null ? Math.round(item.qty * c.costPerBase) : null;
      if (item.value === null) valueTotals.unknown += 1;
      else valueTotals[{ slow_moving: 'slow', not_moving: 'dead', never_sold: 'neverSold' }[item.status]] += item.value;
    }
  }
  return {
    ready: int(head?.stock_items) > 0 && dataStart !== null,
    stockItems: int(head?.stock_items),
    horizon: { dataStart, slowDays: rules.SLOW_DAYS, deadDays: rules.DEAD_DAYS },
    counts,
    items,
    prices: canSeePrices === true,
    valueTotals,
    pending,
  };
}

module.exports = {
  SALES_STEPS, PURCHASE_STEPS, PO_STATES,
  pendingDivisions, salesFlow, purchaseFlow, marginContext, marginDivisions, slowMovers,
};
