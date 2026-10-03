// "Jadwal kirim" (program 2.2): sales orders not fully shipped, from approved
// Accurate data, with Accurate's stock allocated to them in promise order —
// so each SO says whether the stock covers it. Quantities only (D1), in base
// units for the allocation (qty × unit ratio), never across items. The promise
// ("Janji kirim", program 3.4) is warehouseRules.promisedSql: Tgl kirim when
// Sales set it after the SO date, otherwise the SO date + 2×24 jam (a Sunday
// moves to Monday: promiseShifted).
const pool = require('../db/pool');
const rules = require('./warehouseRules');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const num = (v) => (v === null || v === undefined ? null : Number(v));
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));
const round4 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000);

// Every open line with the stock left for it once SOs promised earlier took theirs.
const ALLOCATED = `SELECT l.so_id, l.number, l.ship_date, l.trans_date, ${rules.promisedSql('l')} AS promised_date,
         l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio,
         l.shipped_qty, l.remaining_qty, l.remaining_base, l.warehouse,
         COALESCE(t.qty, 0) AS stock_base,
         SUM(l.remaining_base) OVER (PARTITION BY l.item_no ORDER BY ${rules.promisedSql('l')}, l.so_id, l.line_no ROWS UNBOUNDED PRECEDING) AS demand_to_here
    FROM wh_so_open_lines_accurate l
    LEFT JOIN wh_stock_total_accurate t ON t.entity_id = l.entity_id AND t.item_no = l.item_no
   WHERE l.entity_id = ? AND l.remaining_base > 0`;

const lineDto = (l) => ({
  lineNo: Number(l.line_no), itemNo: l.item_no, itemName: l.item_name, unit: l.unit, unitRatio: num(l.unit_ratio),
  qty: round4(l.qty), shippedQty: round4(l.shipped_qty), remainingQty: round4(l.remaining_qty),
  enough: Number(l.stock_base) >= Number(l.demand_to_here), warehouse: l.warehouse,
});

async function lines(entityId, soId = null) {
  const [rows] = await pool.query(
    soId ? `SELECT a.* FROM (${ALLOCATED}) a WHERE a.so_id = ? ORDER BY a.line_no` : ALLOCATED,
    soId ? [entityId, soId] : [entityId],
  );
  return rows;
}

const promiseDto = (o) => ({
  promisedDate: o.promised_date, promiseSource: Number(o.promised_in_so) ? 'so' : 'standard', slaDays: rules.SHIP_SLA_DAYS,
  promiseShifted: Boolean(Number(o.promise_shifted)),
});

// Each open SO: when it is promised, how many lines are left, and how many the stock does not cover.
async function schedule(entityId, { q, status, from, to } = {}) {
  const [orders] = await pool.query(
    `SELECT s.id, s.number, s.trans_date, s.ship_date, ${rules.promisedSql('s')} AS promised_date,
            COALESCE(s.ship_date > s.trans_date, FALSE) AS promised_in_so, ${rules.promiseShiftedSql('s')} AS promise_shifted,
            s.customer_no, s.customer_name, s.channel, s.percent_shipped, s.line_count,
            DATEDIFF(${TODAY}, ${rules.promisedSql('s')}) AS days_late, ${rules.marketplaceRecapSql('s')} AS is_recap
       FROM wh_so_open_accurate s WHERE s.entity_id = ? ORDER BY promised_date, s.number`,
    [entityId],
  );
  const perSo = new Map();
  for (const l of await lines(entityId)) {
    const e = perSo.get(Number(l.so_id)) || { open: 0, short: 0 };
    e.open += 1;
    if (Number(l.stock_base) < Number(l.demand_to_here)) e.short += 1;
    perSo.set(Number(l.so_id), e);
  }
  const all = orders.map((o) => {
    const e = perSo.get(Number(o.id)) || { open: 0, short: 0 };
    return {
      id: Number(o.id), number: o.number, date: o.trans_date, shipDate: o.ship_date, ...promiseDto(o), customerNo: o.customer_no, customerName: o.customer_name,
      channel: o.channel, percentShipped: num(o.percent_shipped) ?? 0, openLines: e.open, shortLines: e.short,
      stock: e.short ? 'short' : 'enough', daysLate: Number(o.days_late) > 0 ? Number(o.days_late) : 0,
      // Before OTIF_FROM: listed, never escalated or counted in OTIF.
      legacy: Boolean(day(o.trans_date) && day(o.trans_date) < rules.otifFrom()),
      // A monthly marketplace recap SO (warehouseRules.marketplaceRecapSql): listed, never late.
      recap: Boolean(Number(o.is_recap)),
    };
  }).map((o) => {
    // "Terlambat" is the shared late-SO rule (warehouseRules.lateSoSql), so the
    // count matches the management KPI, Retail Commerce and Alur penjualan.
    const late = o.daysLate > 0 && !o.legacy && !o.recap;
    return { ...o, late };
  }).filter((o) => o.openLines > 0);
  const text = String(q || '').toLowerCase();
  const inRange = (o) => (!from || (day(o.promisedDate) && day(o.promisedDate) >= from)) && (!to || (day(o.promisedDate) && day(o.promisedDate) <= to));
  const matches = (o) => !text || `${o.number} ${o.customerName || ''} ${o.customerNo || ''}`.toLowerCase().includes(text);
  const base = all.filter((o) => inRange(o) && matches(o));
  const items = base.filter((o) => (status === 'short' ? o.stock === 'short' : status === 'late' ? o.late : true));
  return {
    items,
    otifFrom: rules.otifFrom(),
    counts: { all: base.length, short: base.filter((o) => o.stock === 'short').length, late: base.filter((o) => o.late).length },
  };
}

async function order(entityId, id) {
  const [[o]] = await pool.query(
    `SELECT s.id, s.number, s.trans_date, s.ship_date, ${rules.promisedSql('s')} AS promised_date,
            COALESCE(s.ship_date > s.trans_date, FALSE) AS promised_in_so, ${rules.promiseShiftedSql('s')} AS promise_shifted,
            DATEDIFF(${TODAY}, ${rules.promisedSql('s')}) AS days_late,
            s.customer_no, s.customer_name, s.channel, s.status, s.percent_shipped
       FROM wh_so_open_accurate s WHERE s.entity_id = ? AND s.id = ? LIMIT 1`,
    [entityId, id],
  );
  if (!o) return null;
  const ls = (await lines(entityId, id)).map(lineDto);
  return {
    id: Number(o.id), number: o.number, date: o.trans_date, shipDate: o.ship_date, ...promiseDto(o), customerNo: o.customer_no, customerName: o.customer_name,
    channel: o.channel, status: o.status, percentShipped: num(o.percent_shipped) ?? 0, daysLate: Number(o.days_late) > 0 ? Number(o.days_late) : 0,
    lines: ls, shortLines: ls.filter((l) => !l.enough).length,
  };
}

// An open SO (still in the shipping schedule) by its number.
async function findOpenSoId(entityId, number) {
  const [[row]] = await pool.query('SELECT id FROM wh_so_open_accurate WHERE entity_id = ? AND number = ? LIMIT 1', [entityId, number]);
  return row ? Number(row.id) : null;
}

module.exports = { schedule, order, findOpenSoId };
