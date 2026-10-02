const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pool = require('../src/db/pool');
const service = require('../src/services/managementFlow.service');
const prices = require('../src/services/procurementPrices.service');
const ctrl = require('../src/controllers/managementFlow.controller');
const router = require('../src/routes/managementDashboard.routes');

// Program 3.3: barang lambat laku — on the management page only (no Warehouse
// KPI), quantities for management with warehouse.stock.view (D2), the rupiah
// value only for price viewers (P1).

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// As MySQL returns them: DECIMAL as strings, flags as 0/1.
const idle = [
  { item_id: 1, item_no: 'MKR-152', item_name: 'Abon Sapi', qty: '84.0000', qty_all_units: '84 Pcs', last_sold_on: new Date('2026-01-13T00:00:00Z'), first_po_on: null, never_sold: 0, idle_since: new Date('2026-01-13T00:00:00Z'), idle_days: 260, out_30d: null },
  { item_id: 2, item_no: 'BEV-1', item_name: 'Jus', qty: '10.0000', qty_all_units: '10 Pcs', last_sold_on: new Date('2026-07-20T00:00:00Z'), first_po_on: null, never_sold: 0, idle_since: new Date('2026-07-20T00:00:00Z'), idle_days: 72, out_30d: '4.0000' },
  { item_id: 3, item_no: 'MKR-003', item_name: 'Kecap Jerigen', qty: '5.0000', qty_all_units: '5 Jrg', last_sold_on: null, first_po_on: null, never_sold: 1, idle_since: new Date('2026-01-02T00:00:00Z'), idle_days: 271, out_30d: null },
];

function fakeQuery(calls, { stock = '438', start = new Date('2026-01-02T00:00:00Z') } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/AS stock_items/.test(sql)) return [[{ stock_items: stock, data_start: start }]];
    if (/FROM mg_stock_idle_accurate s\s+WHERE s\.entity_id = \? AND s\.idle_days >= 60/.test(sql)) return [idle];
    if (/FROM pc_po_price_costs_accurate c/.test(sql)) return [[{ item_no: 'mkr-152', cost_per_base: '111000.0000', trans_date: new Date('2026-01-23T00:00:00Z') }]];
    return [[]];
  };
}

test('slowMovers: sold-before items split from never-sold ones; quantities only without prices', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const latest = t.mock.method(prices, 'latestCosts');
  const out = await service.slowMovers(1, { prices: false });
  assert.equal(latest.mock.callCount(), 0, 'no price read without procurement.price.view');
  assert.ok(!calls.some((c) => /pc_po_price/.test(c.sql)));
  assert.equal(out.ready, true);
  assert.equal(out.stockItems, 438);
  assert.deepEqual(out.horizon, { dataStart: '2026-01-02', slowDays: 60, deadDays: 90 });
  assert.deepEqual(out.counts, { slow: 1, dead: 1, neverSold: 1 });
  assert.deepEqual(out.items.map((i) => i.status), ['not_moving', 'slow_moving', 'never_sold']);
  assert.equal(out.items[0].qty, 84);
  assert.equal(out.items[1].out30d, 4);
  assert.equal(out.items[0].out30d, null);
  assert.equal(out.items[2].lastSoldOn, null);
  assert.equal(out.valueTotals, null);
  assert.ok(out.items.every((i) => !('value' in i)));
  const list = calls.find((c) => /s\.idle_days >= 60/.test(c.sql));
  assert.match(list.sql, /IF\(s\.history_days >= 7, s\.out_30d, NULL\)/, 'outflow only after 7 days of history');
  assert.deepEqual(list.args, [1]);
});

test('slowMovers: the value for price viewers is qty × the latest cost per base unit', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const out = await service.slowMovers(1, { prices: true });
  assert.equal(out.prices, true);
  assert.equal(out.items[0].value, 9324000, 'matched case-insensitively on the item code');
  assert.equal(out.items[1].value, null);
  assert.deepEqual(out.valueTotals, { slow: 0, dead: 9324000, neverSold: 0, unknown: 2 });
  const priceCall = calls.find((c) => /pc_po_price_costs_accurate/.test(c.sql));
  assert.deepEqual(priceCall.args, [1, ['MKR-152', 'BEV-1', 'MKR-003'], 10]);
});

test('slowMovers: not ready without stock or without sales history', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([], { stock: '0' }));
  assert.equal((await service.slowMovers(1, {})).ready, false);
  t.mock.method(pool, 'query', fakeQuery([], { start: null }));
  assert.equal((await service.slowMovers(1, {})).ready, false);
});

test('route /slow-movers: management_dashboard.view AND warehouse.stock.view', () => {
  const layer = router.stack.find((l) => l.route?.path === '/slow-movers' && l.route.methods.get);
  assert.ok(layer);
  const gates = layer.route.stack.slice(0, -2).map((l) => l.handle);
  const run = (permissions) => {
    for (const gate of gates) {
      const res = responseDouble();
      let passed = false;
      gate({ user: { permissions }, query: {} }, res, () => { passed = true; });
      if (!passed) return res.statusCode;
    }
    return 200;
  };
  assert.equal(run(['management_dashboard.view']), 403);
  assert.equal(run(['warehouse.stock.view']), 403);
  assert.equal(run(['management_dashboard.division', 'warehouse.stock.view']), 403, 'a Warehouse Head does not get the management list');
  assert.equal(run(['management_dashboard.view', 'warehouse.stock.view']), 200);
});

test('the controller re-checks both permissions and passes prices only to price viewers', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const res = responseDouble();
  await ctrl.slowMovers({ user: { entityId: 1, permissions: ['management_dashboard.view'] }, query: {} }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
  const ok = responseDouble();
  await ctrl.slowMovers({ user: { entityId: 1, permissions: ['management_dashboard.view', 'warehouse.stock.view'] }, query: {} }, ok, (e) => { throw e; });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.prices, false);
  assert.ok(!calls.some((c) => /pc_po_price/.test(c.sql)));
});

test('no Warehouse KPI or provider change for slow movers (integrator decision)', () => {
  const src = fs.readFileSync(require.resolve('../src/management/providers/warehouse'), 'utf8');
  assert.doesNotMatch(src, /slow_movers|mg_stock_idle_accurate|flowRules/);
});
