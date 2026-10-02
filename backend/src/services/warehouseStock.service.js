const pool = require('../db/pool');
const { int } = require('./salesQuery');

// Stock from approved Accurate data, for the Warehouse team (Warehouse stage 1).
// Read-only: it reads the wh_*_accurate views (migration 075) and the item
// master Sales approved; it never writes and never calls Accurate.
//
// Quantities only (owner D1). Every response is built from an explicit list of
// fields, so nothing else a view might carry can reach the page. The company
// always comes from the signed-in user.
//
// An item without a stock row has 0: rows are stored only while stock is (or
// was) there. "Persediaan" items of the approved item master are the full list,
// so an item with no stock anywhere still shows, as Habis.

const STATUSES = Object.freeze(['ada', 'habis', 'minus', 'menipis']);
// "Menipis" (owner decision D7): the stock lasts fewer days than this at the
// average daily outflow of the last 30 days — judged only once there are this
// many days of approved history (before that, the cover is unknown).
const COVER_DAYS = 7;
const MIN_HISTORY_DAYS = 7;
const num = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 10000) / 10000);
const statusOf = (qty, daysCover = null) => {
  if (qty < 0) return 'minus';
  if (qty === 0) return 'habis';
  return daysCover !== null && daysCover < COVER_DAYS ? 'menipis' : 'ada';
};

const WAREHOUSE_DIVISION_SQL = "SELECT id FROM departments WHERE entity_id = ? AND code = 'warehouse' AND deleted_at IS NULL ORDER BY id LIMIT 1";

// The latest applied Warehouse batch: when the stock shown was pulled and who approved it.
// By id, not applied_at: a division has one pending batch at a time, so the
// highest id was applied last, and applied_at mixes clocks across the time-zone fix.
async function status(entityId) {
  const [[applied]] = await pool.query(
    `SELECT b.id, b.decided_at, b.applied_at, u.name AS decided_by, r.started_at AS pulled_at
       FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'warehouse'
       LEFT JOIN users u ON u.id = b.decided_by
       LEFT JOIN sales_sync_runs r ON r.id = b.sync_run_id
      WHERE b.entity_id = ? AND b.status = 'applied'
      ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  const [[pending]] = await pool.query(
    `SELECT b.id, b.item_count, b.created_at FROM sales_accurate_batches b
       JOIN departments d ON d.id = b.department_id AND d.code = 'warehouse'
      WHERE b.entity_id = ? AND b.status = 'pending' ORDER BY b.id DESC LIMIT 1`,
    [entityId],
  );
  // Documents (stage 2): switched on, and approved data present?
  const [[docs]] = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM accurate_records r WHERE r.entity_id = ?
                     AND r.record_type IN ('wh_transfer', 'wh_adjustment', 'wh_receipt', 'wh_delivery')) AS ready`,
    [entityId],
  );
  return {
    ready: Boolean(applied),
    documents: { enabled: process.env.ACCURATE_WAREHOUSE_DOCUMENTS === '1', ready: Boolean(Number(docs?.ready)) },
    asOf: applied ? {
      batchId: Number(applied.id), pulledAt: applied.pulled_at || null, approvedAt: applied.decided_at || applied.applied_at, approvedBy: applied.decided_by || null,
    } : null,
    pending: pending ? { batchId: Number(pending.id), items: int(pending.item_count), createdAt: pending.created_at } : null,
  };
}

async function warehouses(entityId) {
  const [rows] = await pool.query(
    `SELECT id, name, status, is_default, is_scrap FROM wh_warehouses_accurate
      WHERE entity_id = ? AND missing = 0 ORDER BY is_default DESC, name`,
    [entityId],
  );
  return rows.map((w) => ({ id: Number(w.id), name: w.name, active: w.status !== 'Nonaktif', isDefault: Boolean(w.is_default), isScrap: Boolean(w.is_scrap) }));
}

// Every stock item: those with a stock row, and the "Persediaan" items of the
// approved item master (0 when they have none).
const ITEMS_SQL = `
  SELECT ids.item_id,
         COALESCE(t.item_no, m.number) AS item_no,
         COALESCE(t.item_name, m.name) AS item_name,
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.data, '$.category')), 'null') COLLATE utf8mb4_unicode_ci AS category,
         COALESCE(t.qty, 0) AS qty,
         t.qty_all_units,
         -- Days of cover: unrounded for every test (the same as the management KPI),
         -- rounded only for display; and why it is unknown when it is.
         CASE WHEN c.history_days >= ${MIN_HISTORY_DAYS} AND c.out_30d > 0
              THEN COALESCE(t.qty, 0) / (c.out_30d / c.history_days) END AS raw_cover,
         CASE WHEN c.history_days >= ${MIN_HISTORY_DAYS} AND c.out_30d > 0
              THEN ROUND(COALESCE(t.qty, 0) / (c.out_30d / c.history_days), 1) END AS days_cover,
         CASE WHEN c.item_id IS NULL OR c.history_days < ${MIN_HISTORY_DAYS} THEN 'history'
              WHEN c.out_30d = 0 THEN 'no_outflow' END AS cover_reason
    FROM (SELECT item_id FROM wh_stock_total_accurate WHERE entity_id = ?
          UNION
          SELECT accurate_id FROM accurate_latest
           WHERE entity_id = ? AND record_type = 'item'
             AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.type')) = 'Persediaan') ids
    LEFT JOIN wh_stock_total_accurate t ON t.entity_id = ? AND t.item_id = ids.item_id
    LEFT JOIN accurate_latest m ON m.entity_id = ? AND m.record_type = 'item' AND m.accurate_id = ids.item_id
    LEFT JOIN wh_stock_cover_accurate c ON c.entity_id = ? AND c.item_id = ids.item_id`;

function stockDto(row, perWarehouse) {
  const qty = num(row.qty);
  const daysCover = row.days_cover === null || row.days_cover === undefined ? null : Number(row.days_cover);
  const rawCover = row.raw_cover === null || row.raw_cover === undefined ? null : Number(row.raw_cover);
  return {
    itemId: Number(row.item_id),
    itemNo: row.item_no,
    name: row.item_name,
    category: row.category || null,
    qty,
    qtyAllUnits: row.qty_all_units || null,
    daysCover,
    coverReason: row.cover_reason || null,
    status: statusOf(qty, rawCover),
    warehouses: (perWarehouse || []).map((w) => ({
      warehouseId: Number(w.warehouse_id), warehouse: w.warehouse_name, qty: num(w.qty), qtyAllUnits: w.qty_all_units || null,
    })),
  };
}

async function listStock(entityId, { q = '', status: wanted = null, warehouseId = null, page = 1, limit = 25 } = {}) {
  const status = STATUSES.includes(wanted) ? wanted : null;
  const baseArgs = [entityId, entityId, entityId, entityId, entityId];
  // With a gudang chosen, "Ada/Habis/Minus" is about that gudang's quantity.
  const qty = warehouseId
    ? { sql: '(SELECT COALESCE(SUM(w.qty), 0) FROM wh_stock_accurate w WHERE w.entity_id = ? AND w.item_id = s.item_id AND w.warehouse_id = ?)', args: [entityId, Number(warehouseId)] }
    : { sql: 's.qty', args: [] };
  const term = String(q || '').trim().slice(0, 100);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search = term ? { sql: '(s.item_no LIKE ? OR s.item_name LIKE ? OR s.category LIKE ?)', args: [like, like, like] } : null;
  // "Menipis": in stock (at the chosen gudang, or in total) and the item's cover
  // is short (the outflow is known per item, not per gudang).
  const low = { sql: `${qty.sql} > 0 AND s.raw_cover < ${COVER_DAYS}`, args: qty.args };
  const byStatus = !status ? null
    : status === 'menipis'
      ? low
      : { sql: `${qty.sql} ${{ ada: '>', habis: '=', minus: '<' }[status]} 0`, args: qty.args };
  const conds = [search, byStatus].filter(Boolean);
  const where = { sql: conds.length ? `WHERE ${conds.map((c) => c.sql).join(' AND ')}` : '', args: conds.flatMap((c) => c.args) };

  // Chips count within the search, whatever status is chosen.
  const [[counts]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(${qty.sql} > 0) AS ada, SUM(${qty.sql} = 0) AS habis, SUM(${qty.sql} < 0) AS minus,
            SUM(${low.sql}) AS menipis
       FROM (${ITEMS_SQL}) s ${search ? `WHERE ${search.sql}` : ''}`,
    [...qty.args, ...qty.args, ...qty.args, ...low.args, ...baseArgs, ...(search ? search.args : [])],
  );
  const [[filtered]] = await pool.query(`SELECT COUNT(*) AS n FROM (${ITEMS_SQL}) s ${where.sql}`, [...baseArgs, ...where.args]);
  const [rows] = await pool.query(
    `SELECT s.*, ${qty.sql} AS shown_qty FROM (${ITEMS_SQL}) s ${where.sql} ORDER BY s.item_name, s.item_id LIMIT ? OFFSET ?`,
    [...qty.args, ...baseArgs, ...where.args, limit, (page - 1) * limit],
  );
  const ids = rows.map((r) => Number(r.item_id));
  const per = new Map();
  if (ids.length) {
    const [pairs] = await pool.query(
      `SELECT item_id, warehouse_id, warehouse_name, qty, qty_all_units FROM wh_stock_accurate
        WHERE entity_id = ? AND item_id IN (?) AND qty <> 0 ORDER BY warehouse_name`,
      [entityId, ids],
    );
    for (const p of pairs) {
      const key = Number(p.item_id);
      if (!per.has(key)) per.set(key, []);
      per.get(key).push(p);
    }
  }
  return {
    items: rows.map((r) => {
      const dto = stockDto(r, per.get(Number(r.item_id)));
      // With a gudang chosen, the status follows that gudang's quantity (Menipis:
      // in stock there, with the item's short cover) — the same test as the chip.
      const raw = r.raw_cover === null || r.raw_cover === undefined ? null : Number(r.raw_cover);
      return { ...dto, status: warehouseId ? statusOf(num(r.shown_qty), raw) : dto.status };
    }),
    total: int(filtered.n),
    counts: { total: int(counts.total), ada: int(counts.ada), habis: int(counts.habis), minus: int(counts.minus), menipis: int(counts.menipis) },
  };
}

// One item: stock per gudang, and how its total changed across approved pulls.
async function stockItem(entityId, itemId) {
  const [[row]] = await pool.query(`SELECT s.* FROM (${ITEMS_SQL}) s WHERE s.item_id = ?`, [entityId, entityId, entityId, entityId, entityId, itemId]);
  if (!row) return null;
  const [pairs] = await pool.query(
    `SELECT item_id, warehouse_id, warehouse_name, qty, qty_all_units FROM wh_stock_accurate
      WHERE entity_id = ? AND item_id = ? AND qty <> 0 ORDER BY warehouse_name`,
    [entityId, itemId],
  );
  const [history] = await pool.query(
    `SELECT r.version, r.created_at AS approved_at,
            CAST(JSON_EXTRACT(r.data, '$.qty') AS DECIMAL(18,4)) AS qty,
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.qty_all_units')), 'null') AS qty_all_units
       FROM accurate_records r
      WHERE r.entity_id = ? AND r.record_type = 'wh_stock_total' AND r.accurate_id = ?
      ORDER BY r.version DESC LIMIT 30`,
    [entityId, itemId],
  );
  // Its units (program 1.3): the base unit first, then how many base units each other holds.
  const [units] = await pool.query(
    `SELECT unit_name, ratio, is_base FROM item_units_accurate
      WHERE entity_id = ? AND item_id = ? ORDER BY is_base DESC, ratio`,
    [entityId, itemId],
  );
  const base = units.find((u) => Number(u.is_base) === 1);
  // Its stock card (program 2.2): the latest approved documents that moved it.
  const [moves] = await pool.query(
    `SELECT l.doc_type, l.number, l.trans_date, l.qty, l.unit, l.warehouse, l.direction, d.from_wh, d.to_wh, d.party
       FROM wh_document_lines_accurate l
       JOIN wh_documents_accurate d ON d.entity_id = ? AND d.id = l.document_id AND d.doc_type = l.doc_type
      WHERE l.entity_id = ? AND l.item_no = ?
      ORDER BY l.trans_date DESC, l.number DESC LIMIT 50`,
    [entityId, entityId, row.item_no],
  );
  return {
    ...stockDto(row, pairs),
    units: base ? { base: base.unit_name, others: units.filter((u) => Number(u.is_base) !== 1).map((u) => ({ name: u.unit_name, ratio: num(u.ratio) })) } : null,
    movements: moves.map((m) => ({
      type: m.doc_type, number: m.number, date: m.trans_date, qty: num(m.qty), unit: m.unit, warehouse: m.warehouse,
      // In or out of the company's stock; a transfer only moves it between gudang.
      direction: m.doc_type === 'receipt' ? 'in' : m.doc_type === 'delivery' ? 'out' : m.doc_type === 'transfer' ? 'move' : (m.direction || null),
      from: m.from_wh || null, to: m.to_wh || null, party: m.party || null,
    })),
    history: history.map((h) => ({ version: Number(h.version), approvedAt: h.approved_at, qty: num(h.qty), qtyAllUnits: h.qty_all_units || null })),
  };
}

// The base unit of each item (program 1.3), so a stock number says what it counts.
async function baseUnits(entityId, itemIds) {
  if (!itemIds.length) return new Map();
  const [rows] = await pool.query(
    'SELECT item_id, unit_name FROM item_units_accurate WHERE entity_id = ? AND item_id IN (?) AND is_base = 1',
    [entityId, itemIds],
  );
  return new Map(rows.map((r) => [Number(r.item_id), r.unit_name]));
}

async function warehouseDepartmentId(entityId) {
  const [[row]] = await pool.query(WAREHOUSE_DIVISION_SQL, [entityId]);
  return row ? Number(row.id) : null;
}

module.exports = {
  STATUSES, COVER_DAYS, MIN_HISTORY_DAYS, statusOf, status, warehouses, listStock, stockItem, warehouseDepartmentId, baseUnits,
};
