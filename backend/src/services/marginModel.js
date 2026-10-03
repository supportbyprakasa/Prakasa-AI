// Perkiraan margin (harga PO), program 3.3 — pure aggregation, no SQL, no I/O.
//
// Turns the per-line rows of procurementPrices.marginLines (one row per faktur
// line: revenue allocated to the faktur's DPP, quantity in base units, and the
// purchase cost per base unit of the latest PO on or before the sale — or the
// nearest later PO, flagged) into the page payload.
//
// Decisions (Finance Controller, 30 Sep 2026): margin % is computed only on
// revenue that has a known cost, never by assuming zero cost; coverage = costed
// revenue ÷ all faktur revenue of the period (fakturs without lines count as
// uncovered); quantities are never added across units. An estimate from PO
// prices, not Accurate's accounting HPP, and without principal rebates or
// programmes that never appear on a PO.

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => (v === null || v === undefined ? false : Boolean(Number(v)));
const rupiah = (v) => Math.round(v || 0);
const pct = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

// MySQL hands DECIMAL, SUM and flags back as strings: every number is read
// through num() before any arithmetic.
function normalizeLine(row) {
  const costPerBase = num(row.cost_per_base);
  const qtyBase = num(row.qty_base);
  const costAfter = bool(row.cost_after);
  let reason = 'ok';
  if (costPerBase === null) reason = 'no_price';
  else if (qtyBase === null) reason = 'no_unit';
  else if (costAfter) reason = 'after';
  const costed = reason === 'ok' || reason === 'after';
  return {
    departmentId: row.department_id == null ? null : Number(row.department_id),
    month: row.month ? String(row.month) : null,
    itemCode: row.item_code ? String(row.item_code) : null,
    itemName: row.item_name ? String(row.item_name) : null,
    unit: row.unit ? String(row.unit) : null,
    qty: num(row.qty),
    qtyBase,
    revenue: num(row.revenue) ?? 0,
    costPerBase,
    costDate: dateOnly(row.cost_date),
    reason,
    costed,
    cost: costed ? qtyBase * costPerBase : 0,
  };
}

const emptyBucket = () => ({ revenue: 0, costedRevenue: 0, cost: 0, afterRevenue: 0, noPriceRevenue: 0, noUnitRevenue: 0 });
function add(bucket, line) {
  bucket.revenue += line.revenue;
  if (line.costed) {
    bucket.costedRevenue += line.revenue;
    bucket.cost += line.cost;
    if (line.reason === 'after') bucket.afterRevenue += line.revenue;
  } else if (line.reason === 'no_price') bucket.noPriceRevenue += line.revenue;
  else bucket.noUnitRevenue += line.revenue;
}

// `invoiced`: the faktur revenue (DPP) of the same slice; what the lines do not
// reach (fakturs without lines) is revenue without a cost.
function finish(bucket, invoiced = null) {
  const withoutLines = invoiced === null ? 0 : Math.max(0, invoiced - bucket.revenue);
  const margin = bucket.costedRevenue - bucket.cost;
  return {
    revenue: rupiah(bucket.revenue + withoutLines),
    lineRevenue: rupiah(bucket.revenue),
    revenueWithoutLines: rupiah(withoutLines),
    costedRevenue: rupiah(bucket.costedRevenue),
    cost: rupiah(bucket.cost),
    margin: rupiah(margin),
    marginPct: pct(margin, bucket.costedRevenue),
    coveragePct: pct(bucket.costedRevenue, bucket.revenue + withoutLines),
    afterPricePct: pct(bucket.afterRevenue, bucket.costedRevenue),
    noPriceRevenue: rupiah(bucket.noPriceRevenue),
    noUnitRevenue: rupiah(bucket.noUnitRevenue),
  };
}

// context: { invoiced, returns, slices: [{ month, departmentId, invoiced, returns }] }
// (sales_revenue_accurate of the same period and division scope).
function aggregateMargin(rows, { context = {}, divisionNames = new Map() } = {}) {
  const lines = (rows || []).map(normalizeLine);
  const slices = (context.slices || []).map((s) => ({
    month: s.month ? String(s.month) : null,
    departmentId: s.departmentId == null ? null : Number(s.departmentId),
    invoiced: num(s.invoiced) ?? 0,
    returns: num(s.returns) ?? 0,
  }));
  const sumSlices = (pick) => slices.filter(pick).reduce((s, x) => s + x.invoiced, 0);

  const total = emptyBucket();
  const months = new Map();
  const divisions = new Map();
  const products = new Map();
  for (const line of lines) {
    add(total, line);
    if (line.month) {
      if (!months.has(line.month)) months.set(line.month, emptyBucket());
      add(months.get(line.month), line);
    }
    if (line.departmentId !== null) {
      if (!divisions.has(line.departmentId)) divisions.set(line.departmentId, emptyBucket());
      add(divisions.get(line.departmentId), line);
    }
    const key = line.itemCode || '';
    if (!products.has(key)) products.set(key, { bucket: emptyBucket(), lines: [] });
    const p = products.get(key);
    add(p.bucket, line);
    p.lines.push(line);
  }
  for (const s of slices) {
    if (s.month && !months.has(s.month)) months.set(s.month, emptyBucket());
    if (s.departmentId !== null && !divisions.has(s.departmentId)) divisions.set(s.departmentId, emptyBucket());
  }

  const invoiced = num(context.invoiced) ?? sumSlices(() => true);
  const returns = num(context.returns) ?? slices.reduce((s, x) => s + x.returns, 0);
  const summary = { ...finish(total, invoiced), invoiced: rupiah(invoiced), returns: rupiah(returns) };

  const monthList = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({ month, ...finish(bucket, sumSlices((s) => s.month === month)) }));
  const divisionList = [...divisions.entries()]
    .map(([departmentId, bucket]) => ({
      departmentId,
      departmentName: divisionNames.get(departmentId) || null,
      ...finish(bucket, sumSlices((s) => s.departmentId === departmentId)),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const productList = [...products.entries()].map(([itemCode, { bucket, lines: pl }]) => {
    const f = finish(bucket);
    const units = new Map();
    for (const l of pl) {
      const u = l.unit || '';
      units.set(u, (units.get(u) || 0) + (l.qty || 0));
    }
    const everyBase = pl.every((l) => l.qtyBase !== null);
    let coverage;
    if (bucket.costedRevenue >= bucket.revenue - 0.5 && pl.some((l) => l.costed)) coverage = 'ok';
    else if (bucket.costedRevenue > 0) coverage = 'partial';
    else coverage = pl.some((l) => l.reason === 'no_price') ? 'no_price' : 'no_unit';
    const named = pl.filter((l) => l.itemName);
    const costDates = pl.map((l) => l.costDate).filter(Boolean).sort();
    return {
      itemCode: itemCode || null,
      itemName: named.length ? named[named.length - 1].itemName : null,
      revenue: f.lineRevenue,
      costedRevenue: f.costedRevenue,
      cost: f.cost,
      margin: coverage === 'no_price' || coverage === 'no_unit' ? null : f.margin,
      marginPct: f.marginPct,
      qtyBase: everyBase ? Math.round(pl.reduce((s, l) => s + l.qtyBase, 0) * 100) / 100 : null,
      qtyByUnit: [...units.entries()].map(([unit, qty]) => ({ unit: unit || null, qty: Math.round(qty * 100) / 100 })),
      coverage,
      costAfter: pl.some((l) => l.reason === 'after'),
      lastCostDate: costDates.length ? costDates[costDates.length - 1] : null,
    };
  }).sort((a, b) => b.revenue - a.revenue || String(a.itemCode).localeCompare(String(b.itemCode)));

  return { summary, months: monthList, divisions: divisionList, products: productList };
}

module.exports = { aggregateMargin, normalizeLine };
