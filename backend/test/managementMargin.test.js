const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const prices = require('../src/services/procurementPrices.service');
const flowService = require('../src/services/managementFlow.service');
const { aggregateMargin } = require('../src/services/marginModel');
const ctrl = require('../src/controllers/managementFlow.controller');
const router = require('../src/routes/managementDashboard.routes');

// Program 3.3: "Perkiraan margin (harga PO)" — management with purchase-price
// permission only; every price read goes through procurementPrices.service.

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// Rows as MySQL hands them back: DECIMAL and flags as strings.
const line = (over) => ({
  department_id: 5, month: '2026-09', item_code: 'MKR-164', item_name: 'Teh Kotak', unit: 'Pcs',
  qty: '100.0000', qty_base: '100.00000000', revenue: '300000.00000000',
  cost_per_base: '2500.000000000000', cost_date: new Date('2026-09-01T00:00:00Z'), cost_after: 0, ...over,
});

// ------------------------------------------------------------------ price service

test('marginLines and latestCosts refuse without prices === true, before any query', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => { calls.push(sql); return [[]]; });
  for (const flag of [undefined, false, 'true', 1]) {
    await assert.rejects(() => prices.marginLines(1, { from: '2026-09-01', to: '2026-09-30' }, { prices: flag }), (e) => e.status === 403);
    await assert.rejects(() => prices.latestCosts(1, ['MKR-1'], { prices: flag }), (e) => e.status === 403);
  }
  assert.equal(calls.length, 0);
});

test('marginLines: one query, entity and division first, the cost rules in SQL', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[line()]]; });
  await prices.marginLines(1, { from: '2026-09-01', to: '2026-09-30', departmentId: 5 }, { prices: true });
  await prices.marginLines(1, { from: '2026-09-01', to: '2026-09-30' }, { prices: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [1, 5, '2026-09-01', '2026-09-30', 1, 1, 1]);
  assert.deepEqual(calls[1].args, [1, '2026-09-01', '2026-09-30', 1, 1, 1]);
  const { sql } = calls[0];
  assert.match(sql, /x\.department_id = \?/);
  assert.match(sql, /NOT x\.is_dp/);
  assert.match(sql, /cost_per_base >= 10/);
  assert.match(sql, /c\.trans_date <= lb\.trans_date DESC, ABS\(DATEDIFF\(c\.trans_date, lb\.trans_date\)\)/, 'latest PO on or before the sale, else the nearest later one');
  assert.match(sql, /FROM pc_po_price_costs_accurate pc/);
  assert.match(sql, /NO_MERGE\(c\)/, 'costs materialised once (performance)');
  assert.doesNotMatch(calls[1].sql, /department_id = \?/);
});

test('latestCosts: an empty list runs no query; one query per list, latest per item', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ item_no: 'MKR-1', cost_per_base: '19739.000000000000', trans_date: new Date('2026-09-02T00:00:00Z') }]]; });
  assert.equal((await prices.latestCosts(1, [], { prices: true })).size, 0);
  assert.equal(calls.length, 0);
  const map = await prices.latestCosts(1, ['MKR-1', 'MKR-1', 'MKR-2'], { prices: true });
  assert.deepEqual(calls[0].args, [1, ['MKR-1', 'MKR-2'], 10]);
  assert.deepEqual(map.get('MKR-1'), { costPerBase: 19739, date: '2026-09-02' });
});

// ------------------------------------------------------------------ margin model

test('aggregateMargin: no price before no unit; margin % on costed revenue only; coverage counts fakturs without lines', () => {
  const rows = [
    line(),                                                                   // ok: 300,000 revenue, cost 250,000
    line({ item_code: 'MKR-2', revenue: '100000.00', cost_per_base: null, qty_base: null }), // no price (wins over no unit)
    line({ item_code: 'MKR-3', revenue: '50000.00', qty_base: null }),        // no unit
    line({ item_code: 'MKR-4', revenue: '200000.00', cost_per_base: '1500.0000', cost_after: '1', cost_date: new Date('2026-09-20T00:00:00Z') }), // later PO
    line({ month: '2026-08', revenue: '100000.00', cost_per_base: '1200' }),  // August
  ];
  const context = { slices: [
    { month: '2026-08', departmentId: 5, invoiced: 100000, returns: 0 },
    { month: '2026-09', departmentId: 5, invoiced: 750000, returns: 20000 },
  ] };
  const out = aggregateMargin(rows, { context, divisionNames: new Map([[5, 'Sales']]) });
  // Costed: 300,000 + 200,000 + 100,000 = 600,000; cost 250,000 + 150,000 + 120,000 = 520,000.
  assert.equal(out.summary.lineRevenue, 750000);
  assert.equal(out.summary.revenue, 850000, 'fakturs without lines count as revenue');
  assert.equal(out.summary.revenueWithoutLines, 100000);
  assert.equal(out.summary.costedRevenue, 600000);
  assert.equal(out.summary.cost, 520000);
  assert.equal(out.summary.margin, 80000);
  assert.equal(out.summary.marginPct, 13.3, 'on costed revenue, never assuming zero cost');
  assert.equal(out.summary.coveragePct, 70.6);
  assert.equal(out.summary.afterPricePct, 33.3);
  assert.equal(out.summary.noPriceRevenue, 100000);
  assert.equal(out.summary.noUnitRevenue, 50000);
  assert.equal(out.summary.returns, 20000);
  assert.deepEqual(out.months.map((m) => m.month), ['2026-08', '2026-09']);
  assert.equal(out.months[1].revenue, 750000);
  assert.equal(out.months[1].revenueWithoutLines, 100000);
  assert.deepEqual(out.divisions.map((d) => [d.departmentId, d.departmentName]), [[5, 'Sales']]);

  const product = (code) => out.products.find((p) => p.itemCode === code);
  assert.equal(product('MKR-164').coverage, 'ok');
  assert.equal(product('MKR-164').qtyBase, 200);
  assert.deepEqual(product('MKR-164').qtyByUnit, [{ unit: 'Pcs', qty: 200 }]);
  assert.equal(product('MKR-2').coverage, 'no_price');
  assert.equal(product('MKR-2').margin, null);
  assert.equal(product('MKR-2').qtyBase, null, 'no sum when a line has no ratio');
  assert.equal(product('MKR-3').coverage, 'no_unit');
  assert.equal(product('MKR-4').costAfter, true);
  assert.equal(product('MKR-4').lastCostDate, '2026-09-20');
  assert.deepEqual(out.products.map((p) => p.itemCode), ['MKR-164', 'MKR-4', 'MKR-2', 'MKR-3'], 'by revenue');
});

test('aggregateMargin: a product partly costed is "partial"; a loss is a negative margin; money rounded', () => {
  const out = aggregateMargin([
    line({ revenue: '1000.4', qty_base: '1', cost_per_base: '1500.6' }),
    line({ revenue: '500', qty_base: null, cost_per_base: '1500.6' }),
  ]);
  const [p] = out.products;
  assert.equal(p.coverage, 'partial');
  assert.equal(p.margin, -500);
  assert.equal(p.revenue, 1500);
  assert.equal(out.summary.invoiced, 0);
  assert.deepEqual(aggregateMargin([]).summary.marginPct, null);
  assert.deepEqual(aggregateMargin(null).products, []);
});

// ------------------------------------------------------------------ controller & route

test('the margin needs management AND purchase prices, even when the route is bypassed', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[]]; });
  for (const permissions of [['management_dashboard.view'], ['procurement.price.view'], ['management_dashboard.division', 'procurement.price.view']]) {
    const res = responseDouble();
    await ctrl.margin({ user: { entityId: 1, permissions }, query: {} }, res, (e) => { throw e; });
    assert.equal(res.statusCode, 403, permissions.join('+'));
  }
  assert.equal(calls.length, 0);
});

test('the margin accepts only a Sales or Retail Commerce division', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/code IN \('sales', 'retail_commerce'\)/.test(sql)) return [[{ id: 5, name: 'Sales' }, { id: 8, name: 'Retail Commerce' }]];
    return [[]];
  });
  const user = { entityId: 1, permissions: ['management_dashboard.view', 'procurement.price.view'] };
  const res = responseDouble();
  await ctrl.margin({ user, query: { departmentId: 9 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /Sales atau Retail Commerce/);

  const okRes = responseDouble();
  await ctrl.margin({ user, query: { departmentId: 5, preset: 'month' } }, okRes, (e) => { throw e; });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.data.departmentId, 5);
  assert.equal(okRes.body.data.basis, 'po_price_estimate');
  assert.deepEqual(okRes.body.data.divisionOptions, [{ id: 5, name: 'Sales' }, { id: 8, name: 'Retail Commerce' }]);
});

// The permission gates of a route: every layer before validation and the handler.
function gateOf(path) {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods.get);
  assert.ok(layer, `GET ${path} exists`);
  const gates = layer.route.stack.slice(0, -2).map((l) => l.handle);
  return (permissions) => {
    for (const gate of gates) {
      const res = responseDouble();
      let passed = false;
      gate({ user: { permissions }, query: {} }, res, () => { passed = true; });
      if (!passed) return res.statusCode;
    }
    return 200;
  };
}

test('route /margin: management_dashboard.view AND procurement.price.view', () => {
  const run = gateOf('/margin');
  assert.equal(run(['management_dashboard.view']), 403);
  assert.equal(run(['procurement.price.view']), 403);
  assert.equal(run(['management_dashboard.division', 'procurement.price.view']), 403);
  assert.equal(run(['management_dashboard.view', 'procurement.price.view']), 200);
});

test('routes /flow/*: management_dashboard.view only — a division Head is refused', () => {
  for (const path of ['/flow/sales', '/flow/purchase']) {
    const run = gateOf(path);
    assert.equal(run(['management_dashboard.division']), 403, path);
    assert.equal(run(['management_dashboard.view']), 200, path);
  }
});

test('the margin context reads revenue and returns per month and division, returns positive', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return [[{ month: '2026-09', department_id: 5, invoiced: '750000.00', returns: '20000.00' }]];
  });
  const ctx = await flowService.marginContext(1, { from: '2026-09-01', to: '2026-09-30' }, 5);
  assert.deepEqual(calls[0].args, [1, 5, '2026-09-01', '2026-09-30']);
  assert.match(calls[0].sql, /-r\.amount/);
  assert.deepEqual(ctx, { invoiced: 750000, returns: 20000, slices: [{ month: '2026-09', departmentId: 5, invoiced: 750000, returns: 20000 }] });
});
