const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const stock = require('../src/services/warehouseStock.service');
const ctrl = require('../src/controllers/warehouseAccurate.controller');
const accurateSync = require('../src/services/accurate/accurateSync.service');
const { FORBIDDEN_DATA_RE } = require('../src/services/accurate/warehouseRecordTypes');

// Stock from approved Accurate data (Warehouse stage 1): read-only, the user's
// own company, quantities only.

const user = { sub: 7, entityId: 1, permissions: ['warehouse.stock.view'] };
const writes = (calls) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

function fakeDb(t, rows = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 3, ada: 1, habis: 1, minus: 1 }]];
    if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 3 }]];
    if (/SELECT s\.\*/.test(sql)) return [rows.items || []];
    if (/FROM wh_stock_accurate/.test(sql)) return [rows.pairs || []];
    if (/FROM accurate_records r/.test(sql)) return [rows.history || []];
    if (/FROM item_units_accurate/.test(sql)) return [rows.units || []];
    return [[]];
  });
  return calls;
}

function run(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; resolve(this); return this; },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

test('the stock list reads only the user\'s company, and sends quantities — nothing a view might add', async (t) => {
  const calls = fakeDb(t, {
    items: [{ item_id: 50, item_no: 'BEV-ERG', item_name: 'Energen', category: 'Beverage', qty: '120.0000', qty_all_units: '5 Ctns', shown_qty: '120', unit_cost: 777 }],
    pairs: [{ item_id: 50, warehouse_id: 1, warehouse_name: 'Gudang Utama', qty: '120.0000', qty_all_units: '5 Ctns', total_cost: 999 }],
  });
  const res = await run(ctrl.listStock, { user, query: { q: 'ener', status: 'ada' } });
  assert.deepEqual(res.body.data, [{
    itemId: 50, itemNo: 'BEV-ERG', name: 'Energen', category: 'Beverage', qty: 120, qtyAllUnits: '5 Ctns', daysCover: null, coverReason: null, status: 'ada',
    warehouses: [{ warehouseId: 1, warehouse: 'Gudang Utama', qty: 120, qtyAllUnits: '5 Ctns' }],
  }]);
  assert.deepEqual(res.body.meta.counts, { total: 3, ada: 1, habis: 1, minus: 1, menipis: 0 });
  const fieldNames = res.body.data.flatMap((i) => [...Object.keys(i), ...i.warehouses.flatMap((w) => Object.keys(w))]);
  assert.equal(fieldNames.join(' ').match(FORBIDDEN_DATA_RE), null, 'no cost or price field reaches the page');
  for (const c of calls) {
    const ids = (c.args || []).filter((a) => a === 1).length;
    assert.ok(ids >= 1 || !/wh_|accurate_latest/.test(c.sql), 'every read is bound to the company');
  }
  assert.ok(calls.every((c) => !/entity_id = 2/.test(c.sql)));
  assert.deepEqual(writes(calls), []);
});

test('with a gudang chosen, Ada/Habis/Minus is about that gudang', async (t) => {
  const calls = fakeDb(t);
  await stock.listStock(1, { warehouseId: 3, status: 'minus' });
  const list = calls.find((c) => /SELECT s\.\*/.test(c.sql));
  assert.match(list.sql, /w\.warehouse_id = \?/);
  assert.match(list.sql, /WHERE \(SELECT COALESCE\(SUM\(w\.qty\), 0\)[^)]*\) < 0/);
  assert.ok(list.args.includes(3));
  const unknown = fakeDb(t);
  await stock.listStock(1, { status: 'semua' });
  assert.doesNotMatch(unknown.find((c) => /SELECT s\.\*/.test(c.sql)).sql, /\) s\s+WHERE/, 'an unknown status filters nothing');
});

test('an item shows its stock per gudang and how its total changed across approved pulls', async (t) => {
  fakeDb(t, {
    items: [{ item_id: 51, item_no: 'DAI-OAT', item_name: 'Oatside', category: 'Dairy', qty: '-4.0000', qty_all_units: '-4 TetraPk' }],
    pairs: [{ item_id: 51, warehouse_id: 1, warehouse_name: 'Gudang Utama', qty: '-4.0000', qty_all_units: '-4 TetraPk' }],
    history: [{ version: 2, approved_at: '2026-09-30', qty: '-4.0000', qty_all_units: '-4 TetraPk' }, { version: 1, approved_at: '2026-09-29', qty: '6.0000', qty_all_units: '6 TetraPk' }],
  });
  const res = await run(ctrl.stockItem, { user, params: { itemId: '51' } });
  assert.equal(res.body.data.status, 'minus');
  assert.deepEqual(res.body.data.history.map((h) => h.qty), [-4, 6]);
  assert.equal(res.body.data.units, null, 'no approved units yet: nothing claimed');
  t.mock.restoreAll();
  fakeDb(t, {
    items: [{ item_id: 51, item_no: 'DAI-OAT', item_name: 'Oatside', category: 'Dairy', qty: '12.0000' }],
    units: [{ unit_name: 'TetraPk', ratio: '1.0000', is_base: 1 }, { unit_name: 'Ctns', ratio: '12.0000', is_base: 0 }],
  });
  const withUnits = await run(ctrl.stockItem, { user, params: { itemId: '51' } });
  assert.deepEqual(withUnits.body.data.units, { base: 'TetraPk', others: [{ name: 'Ctns', ratio: 12 }] });
  t.mock.restoreAll();
  fakeDb(t);
  assert.equal((await run(ctrl.stockItem, { user, params: { itemId: 'x' } })).statusCode, 404);
});

test('the pull button starts a Warehouse pull (read-only, staged for approval), never a Sales one', async (t) => {
  t.mock.method(accurateSync, 'latestRun', async () => ({ running: false }));
  const waiting = t.mock.method(accurateSync, 'everyDivisionWaiting', async () => true);
  const blocked = await run(ctrl.startSync, { user });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error.code, 'PENDING_BATCH');
  assert.deepEqual(waiting.mock.calls[0].arguments, [1, 'warehouse']);
  waiting.mock.mockImplementation(async () => false);
  const pull = t.mock.method(accurateSync, 'runSync', async () => ({}));
  const res = await run(ctrl.startSync, { user: { ...user, sub: 9 } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(pull.mock.calls[0].arguments[0], { entityId: 1, requestedBy: 9, scope: 'warehouse' });
  t.mock.method(accurateSync, 'latestRun', async () => ({ running: true }));
  assert.equal((await run(ctrl.startSync, { user })).statusCode, 409);
});

test('every stock route needs a permission: seeing stock, or starting a pull', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/warehouse.routes.js'), 'utf8');
  for (const [route, perm] of [
    ["get('/accurate/status'", 'warehouse.stock.view'], ["get('/accurate/sync'", 'warehouse.accurate.sync'],
    ["post('/accurate/sync'", 'warehouse.accurate.sync'], ["get('/stock'", 'warehouse.stock.view'], ["get('/stock/:itemId'", 'warehouse.stock.view'],
  ]) {
    const at = src.indexOf(`router.${route}`);
    assert.ok(at >= 0, route);
    assert.match(src.slice(at, at + 160), new RegExp(`requirePermission\\('${perm.replace('.', '\\.')}'\\)`), route);
  }
});

test('the last pull\'s counts (not yet approved) are shown only to whoever may start a pull', async (t) => {
  t.mock.method(stock, 'status', async () => ({ ready: true }));
  t.mock.method(stock, 'warehouses', async () => []);
  const last = t.mock.method(accurateSync, 'latestRun', async () => ({ stats: { checks: { negative_total: 138 } } }));
  const member = await run(ctrl.status, { user });
  assert.equal(member.body.data.lastRun, null);
  assert.equal(last.mock.callCount(), 0);
  const supervisor = await run(ctrl.status, { user: { ...user, permissions: ['warehouse.stock.view', 'warehouse.accurate.sync'] } });
  assert.equal(supervisor.body.data.lastRun.stats.checks.negative_total, 138);
});

test('"Menipis": stock that lasts fewer than 7 days at the last 30 days\' outflow — only with enough history', async (t) => {
  assert.equal(stock.statusOf(10, 3.5), 'menipis');
  assert.equal(stock.statusOf(10, 12), 'ada');
  assert.equal(stock.statusOf(10, null), 'ada', 'unknown cover (short history) is not called low');
  assert.equal(stock.statusOf(0, 1), 'habis');
  assert.equal(stock.statusOf(-3, 1), 'minus');
  const calls = fakeDb(t, { items: [{ item_id: 7, item_no: 'X', item_name: 'Barang', qty: '10', raw_cover: '3.46', days_cover: '3.5', shown_qty: '10' }] });
  const res = await run(ctrl.listStock, { user, query: { status: 'menipis' } });
  assert.equal(res.body.data[0].status, 'menipis');
  assert.equal(res.body.data[0].daysCover, 3.5);
  const list = calls.find((c) => /SELECT s\.\*/.test(c.sql));
  assert.match(list.sql, /WHERE s\.qty > 0 AND s\.raw_cover < 7/, 'the unrounded cover, as in the management KPI');
  assert.match(list.sql, /c\.history_days >= 7 AND c\.out_30d > 0/);
});

test('every stock and document query is bound to the company, once per table it reads', async (t) => {
  const docs = require('../src/services/warehouseDocuments.service');
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ n: 0, total: 0, ready: 0, today: '2026-09-30' }]]; });
  await stock.status(7);
  await stock.warehouses(7);
  await stock.listStock(7, { q: 'x', status: 'minus', warehouseId: 3 });
  await stock.stockItem(7, 51);
  await docs.listDocuments(7, { type: 'delivery', q: 'x', warehouse: 'WH A', status: 'in_transit' });
  await docs.getDocument(7, 'delivery', 51);
  await docs.today(7);
  for (const { sql, args } of calls) {
    const binds = (sql.match(/entity_id = \?/g) || []).length;
    const tables = (sql.match(/\b(FROM|JOIN)\s+(wh_\w+|accurate_latest|accurate_records|sales_accurate_batches|item_units_accurate)\b/g) || []).length;
    assert.ok(binds > 0, sql);
    assert.ok(binds >= tables, `every table bound: ${sql}`);
    assert.equal((args || []).filter((a) => a === 7).length, binds, `the company fills every bind: ${sql}`);
  }
});

test('with a gudang chosen, Menipis means in stock at that gudang and short cover — the chip and the badge agree', async (t) => {
  const calls = fakeDb(t, { items: [{ item_id: 7, item_no: 'X', item_name: 'Barang', qty: '10', raw_cover: '3', days_cover: '3.0', shown_qty: '0' }] });
  const r = await stock.listStock(1, { status: 'menipis', warehouseId: 2 });
  const list = calls.find((c) => /SELECT s\.\*/.test(c.sql));
  assert.match(list.sql, /w\.warehouse_id = \?\) > 0 AND s\.raw_cover < 7/);
  assert.equal(r.items[0].status, 'habis', 'nothing at this gudang: its badge says so (the query would not return it)');
  assert.equal(stock.statusOf(5, 6.96), 'menipis', 'unrounded: 6.96 days is short, although it shows as 7.0');
});

test('the shipping schedule gives the stock to the earliest ship date first, per item in base units', async (t) => {
  const shipping = require('../src/services/warehouseShipping.service');
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM wh_so_open_accurate s WHERE s\.entity_id = \? ORDER BY/.test(sql)) {
      return [[{ id: 1, number: 'SO1', ship_date: '2026-09-28', days_late: 1, percent_shipped: '0', line_count: 1 }, { id: 2, number: 'SO2', ship_date: '2026-09-30', days_late: -1, percent_shipped: '0', line_count: 2 }]];
    }
    if (/SUM\(l\.remaining_base\) OVER/.test(sql)) {
      // 60 in stock: SO1 takes 36 (6 Ctns × 6), SO2 wants 36 more → short; its other item is covered.
      return [[
        { so_id: 1, line_no: 1, item_no: 'OAT', remaining_base: 36, stock_base: 60, demand_to_here: 36 },
        { so_id: 2, line_no: 1, item_no: 'OAT', remaining_base: 36, stock_base: 60, demand_to_here: 72 },
        { so_id: 2, line_no: 2, item_no: 'IDM', remaining_base: 5, stock_base: 40, demand_to_here: 5 },
      ]];
    }
    return [[]];
  });
  const { items, counts } = await shipping.schedule(1, {});
  assert.deepEqual(items.map((o) => [o.number, o.stock, o.shortLines, o.daysLate]), [['SO1', 'enough', 0, 1], ['SO2', 'short', 1, 0]]);
  assert.deepEqual(counts, { all: 2, short: 1, late: 1 });
  assert.deepEqual((await shipping.schedule(1, { status: 'short' })).items.map((o) => o.number), ['SO2']);
});

test('an item\'s stock card lists the approved documents that moved it, bound to the company', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/SELECT s\.\*/.test(sql)) return [[{ item_id: 51, item_no: 'DAI-OAT', item_name: 'Oatside', qty: '12.0000' }]];
    if (/FROM wh_document_lines_accurate l/.test(sql)) {
      return [[
        { doc_type: 'delivery', number: 'DO1', trans_date: '2026-09-29', qty: '2.0000', unit: 'Ctns', warehouse: 'WH A', direction: null, party: 'Toko' },
        { doc_type: 'transfer', number: 'IT1', trans_date: '2026-09-28', qty: '1.0000', unit: 'Ctns', warehouse: null, direction: null, from_wh: 'WH A', to_wh: 'WH B' },
      ]];
    }
    return [[]];
  });
  const item = await stock.stockItem(7, 51);
  assert.deepEqual(item.movements.map((m) => [m.type, m.direction, m.qty, m.from, m.to]), [['delivery', 'out', 2, null, null], ['transfer', 'move', 1, 'WH A', 'WH B']]);
  const card = calls.find((c) => /FROM wh_document_lines_accurate l/.test(c.sql));
  assert.deepEqual(card.args, [7, 7, 'DAI-OAT']);
});

test('the schedule filters by the promise ("Janji kirim") and hands out stock in promise order', async (t) => {
  const shipping = require('../src/services/warehouseShipping.service');
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => {
    calls.push(sql);
    if (/FROM wh_so_open_accurate s WHERE s\.entity_id = \? ORDER BY/.test(sql)) {
      return [[
        { id: 1, number: 'SO1', trans_date: new Date('2026-09-29T00:00:00Z'), ship_date: new Date('2026-09-29T00:00:00Z'), promised_date: new Date('2026-10-01T00:00:00Z'), promised_in_so: 0, promise_shifted: 0, days_late: 0, line_count: 1 },
        { id: 2, number: 'SO2', trans_date: new Date('2026-09-29T00:00:00Z'), ship_date: new Date('2026-10-05T00:00:00Z'), promised_date: new Date('2026-10-05T00:00:00Z'), promised_in_so: 1, promise_shifted: 0, days_late: 0, line_count: 1 },
        // A Friday SO: SO date + 2 days is a Sunday, so the standard promise is Monday.
        { id: 3, number: 'SO3', trans_date: new Date('2026-09-25T00:00:00Z'), ship_date: null, promised_date: new Date('2026-09-28T00:00:00Z'), promised_in_so: 0, promise_shifted: 1, days_late: 2, line_count: 1 },
      ]];
    }
    if (/OVER/.test(sql)) return [[{ so_id: 1, stock_base: 10, demand_to_here: 5 }, { so_id: 2, stock_base: 10, demand_to_here: 5 }, { so_id: 3, stock_base: 10, demand_to_here: 5 }]];
    return [[]];
  });
  assert.deepEqual((await shipping.schedule(1, { from: '2026-10-02' })).items.map((o) => o.number), ['SO2']);
  const early = await shipping.schedule(1, { to: '2026-10-01' });
  assert.deepEqual(early.items.map((o) => [o.number, o.promiseSource, o.slaDays, o.promiseShifted]), [['SO1', 'standard', 2, false], ['SO3', 'standard', 2, true]]);
  const rules = require('../src/services/warehouseRules');
  assert.ok(calls.some((s) => s.includes(`${rules.promiseShiftedSql('s')} AS promise_shifted`)), 'moved to Monday by the same rule');
  assert.ok(calls.some((s) => s.includes(`ORDER BY ${rules.promisedSql('l')}, l.so_id, l.line_no`)), 'stock goes to the earliest promise first');
  assert.ok(calls.some((s) => s.includes(`${rules.promisedSql('s')} AS promised_date`)));
});

test('a SO closed in Accurate ("Ditutup" or by hand) leaves the shipping schedule', () => {
  const wh = require('../src/services/accurate/warehouseCollector');
  const base = { statusName: 'Sebagian diproses', approvalStatus: 'APPROVED', percentShipped: 50 };
  assert.equal(wh.isOpenSo(base), true);
  assert.equal(wh.isOpenSo({ ...base, statusName: 'Ditutup' }), false);
  assert.equal(wh.isOpenSo({ ...base, manualClosed: true }), false);
});
