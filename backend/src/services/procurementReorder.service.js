// "Saran pesan ulang" (program 3.1): which items run out before a new order can
// arrive, and how much to order. Policy (Head Supply Chain, 30 Sep 2026),
// everything in days of cover:
//   position     = MAX(total stock, 0) + quantity on order (open/partial POs dated
//                  from LATE_FROM, in base units; "PO lama" shown, never counted)
//   critical     = position < daily outflow × lead time (runs out before it arrives)
//   reorder      = position < daily outflow × (lead time + SAFETY_DAYS)
//   out          = no stock, nothing on order, outflow unknown, bought in 180 days
//   suggested    = ⌈(daily outflow × (lead + safety + order cycle) − position) ÷
//                  purchase ratio⌉ purchase units, at least 1
// Daily outflow is the Warehouse's own hari-cukup source (wh_stock_cover_accurate);
// lead time is the last vendor's average from Warehouse-approved receipts (≥ 3
// POs in 90 days, never below the age of its oldest PO still waiting), else
// DEFAULT_LEAD_DAYS, labelled "(perkiraan)".
// Read-only; TOTAL stock only (never per gudang, D2 extended); prices only through
// procurementPrices.service and only for procurement.price.view (P1).
const pool = require('../db/pool');
const rules = require('./procurementRules');
const prices = require('./procurementPrices.service');
const { COVER_DAYS, MIN_HISTORY_DAYS } = require('./warehouseStock.service');

const TODAY = rules.TODAY;
const SAFETY_DAYS = COVER_DAYS;
const ORDER_CYCLE_DAYS = 14;
const MIN_LEAD_SAMPLES = 3;
const LEAD_WINDOW_DAYS = rules.ACTIVE_VENDOR_DAYS;
const REGULAR_ITEM_DAYS = 180;
const URGENCIES = Object.freeze(['critical', 'reorder', 'out']);

const rulesMeta = () => ({
  safetyDays: SAFETY_DAYS, orderCycleDays: ORDER_CYCLE_DAYS, defaultLeadDays: rules.DEFAULT_LEAD_DAYS, minHistoryDays: MIN_HISTORY_DAYS,
  minLeadSamples: MIN_LEAD_SAMPLES, regularItemDays: REGULAR_ITEM_DAYS, lateFrom: rules.lateFrom(),
});

// One row per item in scope, with its urgency (NULL = fine). Binds: reorderBinds().
// The company's last PO lines, POs and total stock are read once (WITH) and
// reused: every read of a mirror view re-expands its latest versions. DISTINCT
// changes no row (each is unique already); it keeps MySQL from merging the WITH
// back into every place that reads it.
const REORDER_SQL = `WITH lp AS (SELECT DISTINCT q.* FROM pc_item_last_po_accurate q WHERE q.entity_id = ?),
     po AS (SELECT DISTINCT p.id, p.number, p.trans_date, p.vendor_no, p.po_state, p.due_date_eff FROM pc_po_accurate p WHERE p.entity_id = ?),
     st AS (SELECT DISTINCT s.entity_id, s.item_id, s.item_no, s.item_name, s.qty, s.qty_all_units FROM wh_stock_total_accurate s WHERE s.entity_id = ?)
SELECT b.*,
       GREATEST(b.stock_qty, 0) + b.on_order_base AS position_base,
       (GREATEST(b.stock_qty, 0) + b.on_order_base) / b.daily_out AS cover_days,
       (CASE
          WHEN b.daily_out IS NULL THEN
            (CASE WHEN b.stock_qty <= 0 AND b.on_order_base = 0
                   AND b.last_po_date >= ${TODAY} - INTERVAL ${REGULAR_ITEM_DAYS} DAY THEN 'out' END)
          WHEN GREATEST(b.stock_qty, 0) + b.on_order_base < b.daily_out * b.lead_days THEN 'critical'
          WHEN GREATEST(b.stock_qty, 0) + b.on_order_base < b.daily_out * (b.lead_days + ${SAFETY_DAYS}) THEN 'reorder'
        END) COLLATE utf8mb4_unicode_ci AS urgency
  FROM (SELECT k.entity_id, k.item_id, k.item_no, COALESCE(k.item_name, lp.item_name) AS item_name,
               (SELECT d.id FROM departments d WHERE d.entity_id = k.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
               k.stock_qty, k.qty_all_units, c.out_30d, c.history_days,
               (CASE WHEN c.history_days >= ${MIN_HISTORY_DAYS} AND c.out_30d > 0 THEN c.out_30d / c.history_days END) AS daily_out,
               (CASE WHEN c.item_id IS NULL OR c.history_days < ${MIN_HISTORY_DAYS} THEN 'history'
                     WHEN c.out_30d = 0 THEN 'no_outflow' END) AS cover_reason,
               COALESCE(o.on_order_base, 0) AS on_order_base, COALESCE(o.open_pos, 0) AS open_pos,
               COALESCE(o.late_pos, 0) AS late_pos, o.next_due,
               COALESCE(o.legacy_base, 0) AS legacy_base, COALESCE(o.legacy_pos, 0) AS legacy_pos,
               v.id AS vendor_id, lp.vendor_no, lp.vendor_name, v.name AS vendor_master_name, v.status AS vendor_status,
               lp.unit AS po_unit, COALESCE(lp.ratio, 1) AS po_ratio, lp.qty AS last_po_qty,
               lp.po_id AS last_po_id, lp.po_number AS last_po_number, lp.trans_date AS last_po_date,
               COALESCE(iu.unit_name, IF(lp.ratio = 1, lp.unit, NULL)) AS base_unit,
               vl.received_pos AS lead_samples, COALESCE(vl.lead_days, ${rules.DEFAULT_LEAD_DAYS}) AS lead_days
          FROM (SELECT ids.entity_id, ids.item_id,
                       COALESCE(t.item_no, m.number) AS item_no, COALESCE(t.item_name, m.name) AS item_name,
                       COALESCE(t.qty, 0) AS stock_qty, t.qty_all_units
                  FROM (SELECT st.entity_id, st.item_id FROM st
                        UNION
                        SELECT i.entity_id, i.accurate_id
                          FROM (SELECT DISTINCT q.item_no FROM lp q
                                 WHERE q.trans_date >= ${TODAY} - INTERVAL ${REGULAR_ITEM_DAYS} DAY) q
                          JOIN accurate_records i ON i.entity_id = ? AND i.record_type = 'item' AND i.number = q.item_no
                         WHERE i.missing = 0
                           AND i.version = (SELECT MAX(v.version) FROM accurate_records v
                                             WHERE v.entity_id = i.entity_id AND v.record_type = 'item' AND v.accurate_id = i.accurate_id)
                           AND JSON_UNQUOTE(JSON_EXTRACT(i.data, '$.type')) = 'Persediaan') ids
                  LEFT JOIN st t ON t.item_id = ids.item_id
                  LEFT JOIN accurate_latest m ON m.entity_id = ? AND m.record_type = 'item' AND m.accurate_id = ids.item_id
                 WHERE COALESCE(m.status, 'Aktif') <> 'Nonaktif') k
          LEFT JOIN wh_stock_cover_accurate c ON c.entity_id = ? AND c.item_id = k.item_id
          LEFT JOIN lp ON lp.item_no = k.item_no
          LEFT JOIN pc_vendors_accurate v ON v.entity_id = ? AND v.vendor_no = lp.vendor_no
          LEFT JOIN item_units_accurate iu ON iu.entity_id = ? AND iu.item_no = k.item_no AND iu.is_base = 1
          LEFT JOIN (SELECT x.item_no,
                            SUM(IF(x.cur, x.remaining_base, 0)) AS on_order_base,
                            COUNT(DISTINCT IF(x.cur, x.po_id, NULL)) AS open_pos,
                            COUNT(DISTINCT IF(x.cur AND x.late, x.po_id, NULL)) AS late_pos,
                            MIN(IF(x.cur, x.due_date_eff, NULL)) AS next_due,
                            SUM(IF(x.cur, 0, x.remaining_base)) AS legacy_base,
                            COUNT(DISTINCT IF(x.cur, NULL, x.po_id)) AS legacy_pos
                       FROM (SELECT l.item_no, l.po_id, l.remaining_base, p.due_date_eff,
                                    p.trans_date >= ? AS cur,
                                    p.due_date_eff < ${TODAY} - INTERVAL ${rules.PO_LATE_GRACE_DAYS} DAY AS late
                               FROM pc_po_lines_accurate l
                               JOIN po p ON p.id = l.po_id
                              WHERE l.entity_id = ? AND p.po_state IN ('open', 'partial') AND l.remaining_base > 0) x
                      GROUP BY x.item_no) o ON o.item_no = k.item_no
          -- Vendor lead time: average of recent fully received POs, but never
          -- below the age of that vendor's oldest PO still waiting — early on the
          -- first received POs are the fast ones (no survivor bias).
          LEFT JOIN (SELECT p.vendor_no, SUM(g.last_receipt IS NOT NULL) AS received_pos,
                            GREATEST(1, CEIL(AVG(DATEDIFF(g.last_receipt, p.trans_date))),
                                     COALESCE(MAX(IF(p.po_state IN ('open', 'partial'), DATEDIFF(${TODAY}, p.trans_date), NULL)), 0)) AS lead_days
                       FROM po p
                       LEFT JOIN (SELECT r.po_number, MAX(r.received_on) AS last_receipt FROM pc_po_receipts_accurate r
                                   WHERE r.entity_id = ? GROUP BY r.po_number) g
                         ON g.po_number = p.number AND p.po_state = 'received'
                        AND g.last_receipt >= ${TODAY} - INTERVAL ${LEAD_WINDOW_DAYS} DAY
                      WHERE p.po_state IN ('received', 'open', 'partial') AND p.trans_date >= ?
                      GROUP BY p.vendor_no
                     HAVING SUM(g.last_receipt IS NOT NULL) >= ${MIN_LEAD_SAMPLES}) vl ON vl.vendor_no = lp.vendor_no) b`;

// 10 × company and 2 × LATE_FROM, in text order.
function reorderBinds(entityId) {
  const n = Number(entityId);
  const f = rules.lateFrom();
  return [n, n, n, n, n, n, n, n, f, n, n, f];
}

// The first approved stock version: MIN(created_at), read in index order
// (idx_accurate_records_type_created, migration 105) instead of over every version.
const READINESS_SQL = `SELECT f.first_stock_at,
       DATE_FORMAT(DATE(f.first_stock_at) + INTERVAL ${MIN_HISTORY_DAYS} DAY, '%Y-%m-%d') AS cover_from,
       LEAST(30, GREATEST(0, DATEDIFF(NOW(), f.first_stock_at))) AS history_days,
       EXISTS(SELECT 1 FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id AND d.code = 'warehouse'
               WHERE b.entity_id = ? AND b.status = 'pending') AS stock_pending,
       EXISTS(SELECT 1 FROM accurate_records r WHERE r.entity_id = ? AND r.record_type = 'pc_po') AS po_ready,
       EXISTS(SELECT 1 FROM accurate_records r WHERE r.entity_id = ? AND r.record_type = 'wh_receipt') AS receipts_ready
  FROM (SELECT (SELECT r.created_at FROM accurate_records r
                 WHERE r.record_type = 'wh_stock_total' AND r.entity_id = ? AND r.created_at IS NOT NULL
                 ORDER BY r.created_at LIMIT 1) AS first_stock_at) f`;

const OPEN_ORDERS_SQL = `SELECT l.item_no, p.id, p.number, p.trans_date, p.due_date_eff, p.expected_date,
       ${rules.displayStateSql('p')} AS display_state, l.remaining_qty, l.unit, l.remaining_base
  FROM pc_po_lines_accurate l JOIN pc_po_accurate p ON p.entity_id = ? AND p.id = l.po_id
 WHERE l.entity_id = ? AND l.item_no IN (?) AND p.po_state IN ('open', 'partial') AND l.remaining_base > 0
 ORDER BY p.trans_date DESC, p.id DESC, l.line_no`;

const int = (v) => Number(v || 0);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

// How much to order, in whole purchase units (float noise never adds a unit).
function suggestion({ dailyOut, leadDays, stock, onOrder, ratio }) {
  if (!(dailyOut > 0)) return null;
  const r = ratio > 0 ? ratio : 1;
  const position = Math.max(stock, 0) + onOrder;
  const target = dailyOut * (leadDays + SAFETY_DAYS + ORDER_CYCLE_DAYS);
  const units = Math.max(1, Math.ceil(Math.round(((target - position) / r) * 10000) / 10000));
  const baseQty = round4(units * r);
  return { units, ratio: r, baseQty, coverAfterDays: round1((position + baseQty) / dailyOut) };
}

async function readiness(entityId) {
  const e = Number(entityId);
  const [[r]] = await pool.query(READINESS_SQL, [e, e, e, e]);
  return {
    stockReady: Boolean(r?.first_stock_at), stockPending: Boolean(Number(r?.stock_pending)), historyDays: int(r?.history_days),
    coverFrom: r?.cover_from || null, poReady: Boolean(Number(r?.po_ready)), receiptsReady: Boolean(Number(r?.receipts_ready)),
  };
}

function rowDto(r) {
  const qty = num(r.stock_qty) ?? 0;
  const dailyOut = num(r.daily_out);
  const onOrder = num(r.on_order_base) ?? 0;
  const ratio = num(r.po_ratio) || 1;
  const s = suggestion({ dailyOut, leadDays: int(r.lead_days), stock: qty, onOrder, ratio });
  return {
    itemId: Number(r.item_id), itemNo: r.item_no, name: r.item_name, urgency: r.urgency,
    stock: { qty, qtyAllUnits: r.qty_all_units || null, negative: qty < 0 },
    baseUnit: r.base_unit || null,
    dailyOut: dailyOut === null ? null : round2(dailyOut),
    coverDays: r.cover_days === null || r.cover_days === undefined ? null : round1(Number(r.cover_days)),
    stockCoverDays: dailyOut ? round1(Math.max(qty, 0) / dailyOut) : null,
    coverReason: r.cover_reason || null,
    onOrder: { qty: onOrder, pos: int(r.open_pos), latePos: int(r.late_pos), nextDue: day(r.next_due), legacyQty: num(r.legacy_base) ?? 0, legacyPos: int(r.legacy_pos) },
    leadTime: { days: int(r.lead_days), source: r.lead_samples ? 'vendor' : 'default', samples: int(r.lead_samples) },
    suggestion: s ? { ...s, unit: r.po_unit || r.base_unit || null } : null,
    vendor: r.vendor_no ? { id: r.vendor_id ? Number(r.vendor_id) : null, vendorNo: r.vendor_no, name: r.vendor_name, active: r.vendor_status !== 'Nonaktif' } : null,
    lastPo: r.last_po_id ? { id: Number(r.last_po_id), number: r.last_po_number, date: day(r.last_po_date), qty: num(r.last_po_qty), unit: r.po_unit || null } : null,
    openOrders: [],
  };
}

const like = (v) => `%${String(v).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
// "Belum ada PO": nothing on order from a current PO (a PO lama does not count) —
// the same test as the escalation procurement_reorder_missed, whose link sets it.
const NO_PO_SQL = 'r.on_order_base = 0';
function filters({ q, vendor, noPo = false }) {
  const where = [];
  const args = [];
  const text = String(q || '').trim().slice(0, 100);
  if (text) { where.push('(r.item_no LIKE ? OR r.item_name LIKE ?)'); args.push(like(text), like(text)); }
  const v = String(vendor || '').trim().slice(0, 120);
  if (v) { where.push('(r.vendor_no = ? OR r.vendor_name LIKE ?)'); args.push(v, like(v)); }
  if (noPo) where.push(NO_PO_SQL);
  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', args };
}

async function listReorder(entityId, { urgency, q, vendor, noPo = false, page = 1, limit = 25 } = {}, { prices: canSeePrices = false } = {}) {
  const ready = await readiness(entityId);
  const empty = { total: 0, critical: 0, reorder: 0, out: 0, unknown: 0 };
  if (!ready.stockReady) return { items: [], total: 0, counts: empty, readiness: ready };
  const f = filters({ q, vendor, noPo });
  const wanted = URGENCIES.includes(urgency) ? { sql: ' AND r.urgency = ?', args: [urgency] } : { sql: ' AND r.urgency IS NOT NULL', args: [] };
  // Counts and the page in one statement, the saran query computed once: DISTINCT
  // (one row per item already) keeps MySQL from merging r into both halves.
  const [rows] = await pool.query(
    `WITH r AS (SELECT DISTINCT x.* FROM (${REORDER_SQL}) x)
     SELECT c.c_total, c.c_critical, c.c_reorder, c.c_out, c.c_unknown, p.*
       FROM (SELECT COALESCE(SUM(r.urgency IS NOT NULL), 0) AS c_total, COALESCE(SUM(r.urgency = 'critical'), 0) AS c_critical,
                    COALESCE(SUM(r.urgency = 'reorder'), 0) AS c_reorder, COALESCE(SUM(r.urgency = 'out'), 0) AS c_out,
                    COALESCE(SUM(r.urgency IS NULL AND r.cover_reason = 'history' AND r.stock_qty > 0), 0) AS c_unknown
               FROM r WHERE 1 = 1${f.sql}) c
       LEFT JOIN (SELECT r.* FROM r WHERE 1 = 1${wanted.sql}${f.sql}
                   ORDER BY FIELD(r.urgency, 'critical', 'reorder', 'out'), r.cover_days IS NULL, r.cover_days, r.last_po_date DESC, r.item_name, r.item_id
                   LIMIT ? OFFSET ?) p ON TRUE
      ORDER BY FIELD(p.urgency, 'critical', 'reorder', 'out'), p.cover_days IS NULL, p.cover_days, p.last_po_date DESC, p.item_name, p.item_id`,
    [...reorderBinds(entityId), ...f.args, ...wanted.args, ...f.args, limit, (page - 1) * limit],
  );
  const c = rows[0] || {};
  const counts = { total: int(c.c_total), critical: int(c.c_critical), reorder: int(c.c_reorder), out: int(c.c_out), unknown: int(c.c_unknown) };
  const items = rows.filter((r) => r.item_id !== null && r.item_id !== undefined).map(rowDto);
  if (items.length) {
    const [open] = await pool.query(OPEN_ORDERS_SQL, [rules.lateFrom(), Number(entityId), Number(entityId), items.map((i) => i.itemNo)]);
    const byItem = new Map(items.map((i) => [i.itemNo, i]));
    for (const o of open) {
      const item = byItem.get(o.item_no);
      if (!item || item.openOrders.length >= 10) continue;
      item.openOrders.push({
        id: Number(o.id), number: o.number, date: day(o.trans_date), dueDate: day(o.due_date_eff), estimated: !o.expected_date, state: o.display_state,
        remainingQty: num(o.remaining_qty), unit: o.unit, remainingBase: num(o.remaining_base), counted: o.display_state !== 'legacy',
      });
    }
  }
  if (canSeePrices) {
    const wantedPrices = items.filter((i) => i.vendor && i.lastPo).map((i) => ({ itemNo: i.itemNo, vendorNo: i.vendor.vendorNo, unit: i.lastPo.unit }));
    const found = await prices.reorderPrices(entityId, wantedPrices, { prices: true });
    for (const item of items) {
      item.lastPrice = found.get(item.itemNo) || null;
      item.estimatedValue = item.lastPrice && item.suggestion ? Math.round(item.suggestion.units * item.lastPrice.netPrice) : null;
    }
  }
  return { items, total: URGENCIES.includes(urgency) ? counts[urgency] : counts.total, counts, readiness: ready };
}

module.exports = {
  SAFETY_DAYS, ORDER_CYCLE_DAYS, MIN_LEAD_SAMPLES, LEAD_WINDOW_DAYS, REGULAR_ITEM_DAYS, URGENCIES, REORDER_SQL, NO_PO_SQL,
  reorderBinds, rulesMeta, suggestion, readiness, filters, listReorder,
};
