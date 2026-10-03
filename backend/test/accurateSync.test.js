const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const connection = require('../src/services/accurate/accurateConnection.service');
const batches = require('../src/services/salesAccurateBatches.service');
const sync = require('../src/services/accurate/accurateSync.service');

// Never talks to Accurate: a fake Accurate answers list/detail/open-db.

process.env.ACCURATE_SYNC_DELAY_MS = '0';

const CUSTOMERS = [
  { id: 1, customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu', category: { name: 'GT' }, suspended: false, createDate: '01/01/2026' },
  { id: 2, customerNo: 'PFN-IN-SHP-JKT-0370', name: 'Ecommerce Shopee', category: { name: 'Intercompany' }, suspended: false, createDate: '02/01/2026' },
];
const ORDERS = [
  { id: 10, number: 'SO1', transDate: '01/09/2026', statusName: 'Terproses', dppAmount: 900, totalAmount: 999, percentShipped: 100, customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' } },
  { id: 11, number: 'DFT.1', transDate: '28/09/2026', statusName: 'Draf', dppAmount: 5, totalAmount: 5, customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' } },
];
const INVOICES = [
  { id: 20, number: 'SI1', transDate: '02/09/2026', dueDate: '16/09/2026', statusName: 'Belum Lunas', dppAmount: 900, tax1Amount: 99, totalAmount: 999, primeOwing: 999, customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' }, lastUpdate: 'L1' },
  { id: 21, number: 'SI2', transDate: '03/09/2026', dueDate: '03/09/2026', statusName: 'Lunas', dppAmount: 100, tax1Amount: 11, totalAmount: 111, primeOwing: 0, customer: { customerNo: 'PFN-IN-SHP-JKT-0370', name: 'Ecommerce Shopee' }, lastUpdate: 'L2' },
  { id: 22, number: 'SI3', transDate: '04/09/2026', statusName: 'Draf', dppAmount: 1, customer: { customerNo: 'PFN-PR-GT-JKT-0001' }, lastUpdate: 'L3' },
];

const DOS = [{ id: 30, number: 'DO1', transDate: '02/09/2026', statusName: 'Difaktur', customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' }, lastUpdate: 'D1' }];
const RECEIPTS = [{ id: 40, number: 'RC1', transDate: '05/09/2026', totalPayment: 111, customer: { customerNo: 'PFN-IN-SHP-JKT-0370', name: 'Ecommerce Shopee' }, bank: { name: 'BCA' }, lastUpdate: 'R1' }];
const ITEMS = [{ id: 50, no: 'BEV-ERG-34G-001-01', name: 'Energen 34g', itemTypeName: 'Persediaan', itemCategory: { name: 'Beverage' }, unitPrice: 1500, suspended: false }];

function fakeAccurate({ invoices = INVOICES } = {}) {
  const calls = [];
  const respond = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    const u = new URL(url);
    if (u.pathname === '/api/open-db.do') return respond({ host: 'https://odin.accurate.id', session: 'sess' });
    const list = (rows) => respond({ s: true, d: rows, sp: { pageCount: 1, rowCount: rows.length } });
    if (u.pathname.endsWith('/customer/list.do')) return list(CUSTOMERS);
    if (u.pathname.endsWith('/sales-order/list.do')) return list(ORDERS);
    if (u.pathname.endsWith('/sales-invoice/list.do')) return list(invoices);
    // A detail exists only for what the list holds (a deleted document answers s:false).
    const known = (rows) => rows.some((r) => String(r.id) === u.searchParams.get('id'));
    if (u.pathname.endsWith('/detail.do') && !known([...invoices, ...DOS, ...RECEIPTS, ...CUSTOMERS, ...ORDERS, ...ITEMS])) {
      return respond({ s: false, d: ['Data tidak ditemukan'] });
    }
    if (u.pathname.endsWith('/sales-invoice/detail.do')) {
      return respond({ s: true, d: { masterSalesmanName: 'Fajar', detailItem: [
        { salesOrder: { number: 'SO1' }, item: { no: 'BEV-ERG-34G-001-01', name: 'Energen 34g' }, quantity: 2, itemUnit: { name: 'Renceng' }, salesAmount: 500 },
        { salesOrder: { number: 'SO1' }, item: { no: 'FOD-GLO-250G-005-11', name: 'Abon' }, quantity: 1, itemUnit: { name: 'Tin' }, salesAmount: 400 },
      ] } });
    }
    if (u.pathname.endsWith('/delivery-order/list.do')) return list(DOS);
    if (u.pathname.endsWith('/delivery-order/detail.do')) return respond({ s: true, d: { detailItem: [{ salesOrder: { number: 'SO1' } }] } });
    if (u.pathname.endsWith('/sales-receipt/list.do')) return list(RECEIPTS);
    if (u.pathname.endsWith('/sales-receipt/detail.do')) return respond({ s: true, d: { detailInvoice: [{ invoice: { number: 'SI2' }, paymentAmount: 111 }] } });
    if (u.pathname.endsWith('/sales-return/list.do')) return list([]);
    if (u.pathname.endsWith('/item/list.do')) return list(ITEMS);
    return respond({ s: false, d: ['unknown'] });
  };
  return { fetchImpl, calls };
}

// The MySQL named lock that keeps pulls from overlapping across processes.
const namedLock = { held: false };
function fakeLockConnection(t) {
  t.mock.method(pool, 'getConnection', async () => ({
    async query(sql) {
      if (/GET_LOCK/.test(sql)) { const got = namedLock.held ? 0 : 1; namedLock.held = true; return [[{ got }]]; }
      if (/RELEASE_LOCK/.test(sql)) { namedLock.held = false; return [[{ released: 1 }]]; }
      throw new Error(`unexpected lock query ${sql}`);
    },
    release() {},
  }));
}

function mirrorDb(t, mirrorRows = [], pendingItems = []) {
  const calls = [];
  namedLock.held = false;
  fakeLockConnection(t);
  t.mock.method(connection, 'getAccessToken', async () => ({ accessToken: 'tok', dbId: 7 }));
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batch_items i/.test(sql)) return [pendingItems];
    if (/FROM accurate_records r/.test(sql)) return [mirrorRows];
    if (/INSERT INTO sales_sync_runs/.test(sql)) return [{ insertId: 55 }];
    return [[]];
  });
  return calls;
}

test('only final documents are read in; drafts are left out; dates and amounts are normalized', () => {
  assert.equal(sync.toDate('24/06/2026'), '2026-06-24');
  assert.equal(sync.toDate(''), null);
  assert.ok(sync.NOT_FINAL.has('Draf') && sync.NOT_FINAL.has('Diajukan') && sync.NOT_FINAL.has('Ditolak'));
  const row = sync.invoiceRow(INVOICES[0], new Map([['PFN-PR-GT-JKT-0001', 'GT']]), { salesman: 'Fajar', soNumbers: ['SO1'] });
  assert.equal(sync.customerRow(CUSTOMERS[1]).channel, 'Shopee', 'channel from the customer number, not Accurate\'s category');
  assert.equal(sync.customerRow(CUSTOMERS[1]).data.category, 'Intercompany');
  assert.deepEqual(
    [row.trans_date, row.due_date, row.channel, row.salesman, row.dpp_amount, row.outstanding_amount, row.data.so_numbers],
    ['2026-09-02', '2026-09-16', 'GT', 'Fajar', 900, 999, ['SO1']],
  );
  assert.deepEqual(sync.invoiceExtra({ detailItem: [{ salesmanName: 'Aris', salesOrder: { number: 'SO5' }, item: { no: 'A-1', name: 'Abon' }, quantity: 3, itemUnit: { name: 'Tin' }, salesAmount: 270 }] }), {
    salesman: 'Aris', soNumbers: ['SO5'], lines: [{ item_no: 'A-1', item_name: 'Abon', qty: 3, unit: 'Tin', amount: 270 }],
  });
  assert.deepEqual(sync.receiptRow(RECEIPTS[0], new Map(), { detailInvoice: [{ invoice: { number: 'SI2' }, paymentAmount: 111 }] }).data.invoices, [{ number: 'SI2', amount: 111 }]);
  assert.deepEqual(sync.itemRow(ITEMS[0]), { number: 'BEV-ERG-34G-001-01', name: 'Energen 34g', status: 'Aktif', data: { category: 'Beverage', type: 'Persediaan', unit_price: 1500 } });
});

test('a first pull proposes everything as new; a dry run writes nothing at all', async (t) => {
  const calls = mirrorDb(t);
  const { fetchImpl, calls: accurateCalls } = fakeAccurate();
  const result = await sync.runSync({ entityId: 1, requestedBy: 2, dryRun: true, fetchImpl });
  assert.deepEqual(result.changes, {
    customer: { create: 2, update: 0, missing: 0 },
    item: { create: 1, update: 0, missing: 0 },
    sales_order: { create: 1, update: 0, missing: 0 },
    sales_invoice: { create: 2, update: 0, missing: 0 },
    delivery_order: { create: 1, update: 0, missing: 0 },
    sales_receipt: { create: 1, update: 0, missing: 0 },
  });
  assert.deepEqual(result.categories, ['GT', 'Intercompany']);
  assert.equal(result.detailCalls, 4, 'detail for the 2 final invoices, the delivery order and the receipt');
  assert.ok(calls.every((c) => /^\s*SELECT/.test(c.sql)), 'dry run: only reads');
  assert.ok(accurateCalls.every((c) => c.method === 'GET'), 'Accurate is only ever read');
});

test('later pulls propose only what changed, mark what is gone, and skip unchanged detail reads', async (t) => {
  const channels = new Map([['PFN-PR-GT-JKT-0001', 'GT'], ['PFN-IN-SHP-JKT-0370', 'Shopee']]);
  const asMirror = (type, id, row, extra = {}) => ({
    record_type: type, accurate_id: id, version: 1, missing: 0, ...row, data: row.data,
    content_hash: batches.contentHash(type, { ...row, missing: false }), ...extra,
  });
  const inv0 = sync.invoiceRow(INVOICES[0], channels, { salesman: 'Fajar', soNumbers: ['SO1'] });
  const mirror = [
    ...CUSTOMERS.map((c) => asMirror('customer', c.id, sync.customerRow(c))),
    asMirror('sales_order', 10, sync.orderRow(ORDERS[0], channels)),
    asMirror('sales_invoice', 20, inv0),
    asMirror('sales_invoice', 99, { number: 'SI-OLD', trans_date: '2026-08-01', customer_no: 'PFN-PR-GT-JKT-0001', dpp_amount: 5, data: {} }),
  ];
  mirrorDb(t, mirror);
  const paid = { ...INVOICES[0], primeOwing: 0, statusName: 'Lunas', lastUpdate: 'L1b' };
  const { fetchImpl, calls } = fakeAccurate({ invoices: [paid, INVOICES[1]] });
  const { changes } = await sync.collectChanges(1, { fetchImpl });
  const summary = changes.filter((c) => c.recordType === 'sales_invoice').map((c) => [c.recordType, c.action, c.externalKey]).sort();
  assert.deepEqual(summary, [
    ['sales_invoice', 'create', '21'],
    ['sales_invoice', 'missing', '99'],
    ['sales_invoice', 'update', '20'],
  ]);
  const update = changes.find((c) => c.externalKey === '20');
  assert.equal(update.before.outstanding_amount, 999);
  assert.equal(update.after.outstanding_amount, 0);
  const details = calls.filter((c) => c.url.includes('/sales-invoice/detail.do'));
  assert.equal(details.filter((c) => !c.url.includes('id=99')).length, 2, 'lastUpdate changed → detail re-read; new → read');
  assert.equal(details.filter((c) => c.url.includes('id=99')).length, 1, 'the one gone from the list is confirmed once before it is marked');

  // Same lastUpdate as the mirror: no detail call, no change.
  t.mock.restoreAll();
  mirrorDb(t, mirror);
  const again = fakeAccurate({ invoices: [INVOICES[0]] });
  const second = await sync.collectChanges(1, { fetchImpl: again.fetchImpl });
  assert.equal(again.calls.filter((c) => c.url.includes('/sales-invoice/detail.do') && !c.url.includes('id=99')).length, 0);
  assert.deepEqual(second.changes.filter((c) => c.externalKey === '20'), []);
});

test('JSON key order from MySQL, or an older stored hash, never reads as a change; a real change does', async (t) => {
  const channels = new Map([['PFN-IN-SHP-JKT-0370', 'Shopee']]);
  const detail = { detailInvoice: [{ invoice: { number: 'SI2' }, paymentAmount: 111 }] };
  const fresh = sync.receiptRow(RECEIPTS[0], channels, detail);
  // As MySQL returns it: nested keys reordered, plus a hash computed the old way.
  const stored = { ...fresh, data: { _last_update: 'R1', bank: 'BCA', invoices: [{ amount: 111, number: 'SI2' }] } };
  const mirrorRow = { record_type: 'sales_receipt', accurate_id: 40, version: 1, missing: 0, ...stored, content_hash: 'computed-the-old-way' };
  mirrorDb(t, [mirrorRow]);
  const { fetchImpl } = fakeAccurate();
  const { changes } = await sync.collectChanges(1, { fetchImpl });
  assert.deepEqual(changes.filter((c) => c.recordType === 'sales_receipt'), [], 'same receipt, only key order differs');

  t.mock.restoreAll();
  // Accurate edited the receipt (new lastUpdate), so its detail is read again.
  mirrorDb(t, [{ ...mirrorRow, data: { ...stored.data, _last_update: 'R0', invoices: [{ amount: 100, number: 'SI2' }] } }]);
  const next = await sync.collectChanges(1, { fetchImpl: fakeAccurate().fetchImpl });
  assert.deepEqual(next.changes.filter((c) => c.recordType === 'sales_receipt').map((c) => c.action), ['update'], 'a paid amount that changed is a change');
});

test('a Sales list read that came back short never marks anything "tidak ada lagi"', async (t) => {
  const asMirror = { record_type: 'sales_invoice', accurate_id: 99, version: 1, missing: 0, number: 'SI-OLD', trans_date: '2026-08-01', customer_no: 'PFN-PR-GT-JKT-0001', dpp_amount: 5, data: {}, content_hash: 'x' };
  mirrorDb(t, [asMirror]);
  const { fetchImpl } = fakeAccurate();
  const short = async (url, init) => {
    const res = await fetchImpl(url, init);
    if (!url.includes('/sales-invoice/list.do')) return res;
    const body = await res.json();
    return { ...res, json: async () => ({ ...body, sp: { ...body.sp, rowCount: body.sp.rowCount + 5 } }) };
  };
  const { changes } = await sync.collectChanges(1, { fetchImpl: short });
  assert.ok(!changes.some((c) => c.action === 'missing' && c.recordType === 'sales_invoice'), 'short read: SI-OLD stays');
  t.mock.restoreAll();
  mirrorDb(t, [asMirror]);
  const full = await sync.collectChanges(1, { fetchImpl: fakeAccurate().fetchImpl });
  assert.ok(full.changes.some((c) => c.action === 'missing' && c.externalKey === '99'), 'a complete read does mark it');
});

test('a sudden drop is stopped for a person to look at, before anything is staged', async (t) => {
  const mirror = Array.from({ length: 60 }, (_, i) => ({
    record_type: 'sales_invoice', accurate_id: 1000 + i, version: 1, missing: 0, number: `X${i}`, data: {}, content_hash: 'h',
  }));
  const calls = mirrorDb(t, mirror);
  const stage = t.mock.method(batches, 'stageChanges', async () => ({ batches: [], skipped: [] }));
  const { fetchImpl } = fakeAccurate({ invoices: [] });
  await assert.rejects(sync.runSync({ entityId: 1, requestedBy: 2, fetchImpl }), (e) => e.code === 'SUSPICIOUS_DROP');
  assert.equal(stage.mock.callCount(), 0);
  assert.ok(calls.some((c) => /UPDATE sales_sync_runs SET status = 'failed'/.test(c.sql)), 'the run is logged as failed');
});

test('a real run stages batches and logs the run; two runs never overlap', async (t) => {
  const calls = mirrorDb(t);
  const stage = t.mock.method(batches, 'stageChanges', async ({ changes }) => ({ batches: [{ id: 3, departmentId: 5, itemCount: changes.length }], skipped: [] }));
  const { fetchImpl } = fakeAccurate();
  const first = sync.runSync({ entityId: 1, requestedBy: 2, fetchImpl });
  await assert.rejects(sync.runSync({ entityId: 1, requestedBy: 2, fetchImpl }), (e) => e.code === 'SYNC_RUNNING');
  const result = await first;
  assert.equal(stage.mock.calls[0].arguments[0].syncRunId, 55);
  assert.deepEqual(result.batches, [{ id: 3, departmentId: 5, items: 8 }]);
  assert.ok(calls.some((c) => /UPDATE sales_sync_runs SET status = \?/.test(c.sql) && c.args[0] === 'success'));
});

test('a pull already running in another process (the scheduled job) is not started twice', async (t) => {
  mirrorDb(t);
  namedLock.held = true;
  const { fetchImpl, calls } = fakeAccurate();
  await assert.rejects(sync.runSync({ entityId: 1, requestedBy: 2, fetchImpl }), (e) => e.code === 'SYNC_RUNNING');
  assert.equal(calls.length, 0, 'Accurate is not read');
  namedLock.held = false;
});

test('when every division still has a batch waiting, the pull is skipped without reading Accurate', async (t) => {
  const calls = [];
  fakeLockConnection(t);
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches b JOIN departments d/.test(sql)) return [[{ code: 'sales' }, { code: 'retail_commerce' }]];
    return [[]];
  });
  const { fetchImpl, calls: accurateCalls } = fakeAccurate();
  const result = await sync.runSync({ entityId: 1, requestedBy: 2, fetchImpl });
  assert.deepEqual(result, { scope: 'sales', skipped: 'ALL_PENDING', batches: [] });
  assert.equal(accurateCalls.length, 0);
  assert.ok(!calls.some((c) => /INSERT INTO sales_sync_runs/.test(c.sql)), 'no run row for a skipped pull');
  const pending = calls.find((c) => /FROM sales_accurate_batches b JOIN departments d/.test(c.sql));
  assert.deepEqual(pending.args, [1, ['retail_commerce', 'sales']]);
  assert.deepEqual(sync.syncDivisions(), ['retail_commerce', 'sales']);
  assert.deepEqual(sync.syncDivisions('warehouse'), ['warehouse']);
  await assert.rejects(() => sync.runSync({ entityId: 1, requestedBy: 2, scope: 'payroll', fetchImpl }), (e) => e.code === 'VALIDATION_ERROR');
});

// ------------------------------------------------------------------ Warehouse stage 1

const { FORBIDDEN_DATA_RE, splitStockKey } = require('../src/services/accurate/warehouseRecordTypes');
const WAREHOUSES = [{ id: 1, name: 'Gudang Utama', defaultWarehouse: true, scrapWarehouse: false, suspended: false, pic: 'Budi', street: 'Jl. X' },
  { id: 2, name: 'Gudang Transit', defaultWarehouse: false, scrapWarehouse: false, suspended: false }];
const STOCK = (overrides = {}) => [
  { id: 50, no: 'BEV-ERG', name: 'Energen', quantity: 120, quantityInAllUnit: '5 Ctns', upcNo: '899', unitCost: 777, ...overrides[50] },
  { id: 51, no: 'DAI-OAT', name: 'Oatside', quantity: -4, quantityInAllUnit: '-4 TetraPk', upcNo: null, ...overrides[51] },
  { id: 52, no: 'FOD-IDM', name: 'Indomie', quantity: 0, quantityInAllUnit: '0 Bag', upcNo: null, ...overrides[52] },
];
const PER_WAREHOUSE = {
  'Gudang Utama': [{ id: 50, no: 'BEV-ERG', name: 'Energen', quantity: 100, quantityInAllUnit: '4 Ctns' }, { id: 51, no: 'DAI-OAT', name: 'Oatside', quantity: -4, quantityInAllUnit: '-4 TetraPk' }, { id: 52, no: 'FOD-IDM', name: 'Indomie', quantity: 0 }],
  'Gudang Transit': [{ id: 50, no: 'BEV-ERG', name: 'Energen', quantity: 20, quantityInAllUnit: '1 Ctns' }, { id: 51, no: 'DAI-OAT', name: 'Oatside', quantity: 0 }, { id: 52, no: 'FOD-IDM', name: 'Indomie', quantity: 0 }],
};

function fakeWarehouseAccurate({ totals = [STOCK(), STOCK()], perWarehouse = PER_WAREHOUSE, rowCountLies = false, lie = {} } = {}) {
  const calls = [];
  const respond = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const list = (rows, lie = false) => respond({ s: true, d: rows, sp: { pageCount: 1, rowCount: rows.length + (lie ? 1 : 0) } });
  let totalReads = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    const u = new URL(url);
    if (u.pathname === '/api/open-db.do') return respond({ host: 'https://odin.accurate.id', session: 'sess' });
    if (u.pathname.endsWith('/warehouse/list.do')) return list(WAREHOUSES, lie.warehouses);
    if (u.pathname.endsWith('/item/list-stock.do')) {
      const name = u.searchParams.get('warehouseName');
      if (name) return list(perWarehouse[name] || [], rowCountLies);
      const rows = totals[Math.min(totalReads, totals.length - 1)];
      totalReads += 1;
      return list(rows, lie.totals);
    }
    return respond({ s: false, d: ['unknown'] });
  };
  return { fetchImpl, calls };
}

test('Warehouse pull: Accurate\'s own stock per item and per gudang; zero stock never stored, minus kept; no cost, no address', async (t) => {
  mirrorDb(t);
  const { fetchImpl, calls } = fakeWarehouseAccurate();
  const { changes, checks } = await sync.collectWarehouse(1, { fetchImpl });
  assert.ok(calls.every((c) => c.method === 'GET'));
  assert.ok(!calls.some((c) => /stock-mutation-history|get-nearest-cost|vendor-price/.test(c.url)));
  const by = (type) => changes.filter((c) => c.recordType === type);
  assert.deepEqual(by('wh_warehouse').map((c) => c.after.name).sort(), ['Gudang Transit', 'Gudang Utama']);
  assert.deepEqual(by('wh_stock_total').map((c) => [c.after.number, c.after.data.qty]).sort(), [['BEV-ERG', 120], ['DAI-OAT', -4]], 'Indomie at 0 is not stored');
  const pairs = by('wh_stock').map((c) => [c.after.number, c.after.data.warehouse, c.after.data.qty]).sort();
  assert.deepEqual(pairs, [['BEV-ERG', 'Gudang Transit', 20], ['BEV-ERG', 'Gudang Utama', 100], ['DAI-OAT', 'Gudang Utama', -4]]);
  const key = by('wh_stock').find((c) => c.after.data.warehouse === 'Gudang Transit').externalKey;
  assert.deepEqual(splitStockKey(key), { itemId: '50', warehouseId: '2' });
  for (const c of changes) {
    assert.equal(c.amount, null, 'no money on Warehouse records');
    const bad = JSON.stringify(Object.keys(c.after.data || {})).match(FORBIDDEN_DATA_RE);
    assert.equal(bad, null, `${c.recordType} carries ${bad}`);
    assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES[c.recordType], c.after.data), [], c.recordType);
  }
  assert.deepEqual(checks.warehouse.stock_sum, { items: 3, matched: 3, mismatched: 0, unstable: 0, sample: [] });
  assert.equal(checks.warehouse.negative_total, 1);
  assert.equal(checks.warehouse.negative_positions, 1);
  assert.equal(checks.warehouse.complete, true);
});

test('Warehouse pull: stock that moved while reading is left out of the check; a gap per gudang is reported', async (t) => {
  mirrorDb(t);
  const { fetchImpl } = fakeWarehouseAccurate({ totals: [STOCK(), STOCK({ 50: { quantity: 118 } })],
    perWarehouse: { ...PER_WAREHOUSE, 'Gudang Transit': [{ id: 51, no: 'DAI-OAT', quantity: 1 }] } });
  const { checks } = await sync.collectWarehouse(1, { fetchImpl });
  assert.equal(checks.warehouse.stock_sum.unstable, 1, 'Energen moved between the two total reads');
  assert.equal(checks.warehouse.stock_sum.mismatched, 1);
  assert.deepEqual(checks.warehouse.stock_sum.sample, ['DAI-OAT']);
});

test('Warehouse pull: stock gone from a complete read becomes 0 (never "missing"); an incomplete read changes nothing', async (t) => {
  const asMirror = (type, id, row) => ({ record_type: type, accurate_id: id, version: 1, missing: 0, ...row, content_hash: 'x' });
  const mirror = [
    asMirror('wh_stock_total', 60, { number: 'OLD-1', name: 'Barang lama', data: { qty: 7, qty_all_units: '7 Pcs', upc: null } }),
    asMirror('wh_stock', '60000001', { number: 'OLD-1', name: 'Barang lama', data: { item_id: 60, warehouse_id: 1, warehouse: 'Gudang Utama', qty: 7, qty_all_units: '7 Pcs' } }),
  ];
  mirrorDb(t, mirror);
  const complete = await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate().fetchImpl });
  const zeroed = complete.changes.filter((c) => c.externalKey === '60' || c.externalKey === '60000001');
  assert.deepEqual(zeroed.map((c) => [c.recordType, c.action, c.after.data.qty]).sort(), [['wh_stock', 'update', 0], ['wh_stock_total', 'update', 0]]);
  assert.ok(!complete.changes.some((c) => c.action === 'missing'), 'stock is never "missing"');

  t.mock.restoreAll();
  mirrorDb(t, mirror);
  const partial = await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate({ rowCountLies: true }).fetchImpl });
  assert.deepEqual(partial.changes.filter((c) => c.recordType === 'wh_stock' && c.externalKey === '60000001'), [], 'an incomplete per-gudang read zeroes nothing');
  assert.equal(partial.checks.warehouse.complete, false);
});

test('a Warehouse pull reads only Warehouse records from the mirror, and a Sales pull only Sales ones', async (t) => {
  const calls = mirrorDb(t);
  await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate().fetchImpl });
  const whq = calls.find((c) => /FROM accurate_records r/.test(c.sql));
  assert.deepEqual(whq.args[1], [...batches.WAREHOUSE_TYPE_NAMES]);
  assert.ok(whq.args[1].every((name) => name.startsWith('wh_')));
  t.mock.restoreAll();
  const salesCalls = mirrorDb(t);
  await sync.collectChanges(1, { fetchImpl: fakeAccurate().fetchImpl });
  const sq = salesCalls.find((c) => /FROM accurate_records r/.test(c.sql));
  assert.ok(!sq.args[1].some((t2) => t2.startsWith('wh_')));
});

test('revenue is total minus PPN — Accurate\'s own dppAmount (the e-Faktur tax base) is only a note', () => {
  const row = sync.invoiceRow(
    { number: 'SI9', transDate: '29/09/2026', statusName: 'Belum Lunas', dppAmount: 0, tax1Amount: 110, totalAmount: 1110, primeOwing: 1110, customer: { customerNo: 'PFN-PR-GT-JKT-0001' } },
    new Map(), { salesman: null, soNumbers: [] },
  );
  assert.equal(row.dpp_amount, 1000);
  assert.equal(row.data.tax_dpp, 0);
  const so = sync.orderRow({ number: 'SO9', transDate: '29/09/2026', statusName: 'Terproses', dppAmount: 0, tax1Amount: 11, totalAmount: 111, customer: {} }, new Map());
  assert.equal(so.dpp_amount, 100);
});

test('a brief network drop during a pull is retried; a blocked (write) request never is', async (t) => {
  process.env.ACCURATE_SYNC_RETRY_MS = '0';
  t.after(() => { delete process.env.ACCURATE_SYNC_RETRY_MS; });
  mirrorDb(t);
  const { fetchImpl } = fakeAccurate();
  let drops = 2;
  const flaky = async (url, init) => {
    if (url.includes('/customer/list.do') && drops > 0) { drops -= 1; throw new TypeError('fetch failed'); }
    return fetchImpl(url, init);
  };
  const { changes } = await sync.collectChanges(1, { fetchImpl: flaky });
  assert.equal(drops, 0);
  assert.ok(changes.some((c) => c.recordType === 'customer'));
});

test('every request of a pull goes through the read-only gate, and a blocked one is not retried', async (t) => {
  process.env.ACCURATE_SYNC_RETRY_MS = '0';
  t.after(() => { delete process.env.ACCURATE_SYNC_RETRY_MS; });
  const readOnly = require('../src/services/accurate/accurateReadOnly');
  mirrorDb(t);
  const gate = t.mock.method(readOnly, 'accurateGet');
  const { fetchImpl, calls } = fakeAccurate();
  await sync.collectChanges(1, { fetchImpl });
  assert.ok(calls.length > 5);
  assert.equal(gate.mock.callCount(), calls.length, 'no request bypasses accurateGet');
  assert.ok(calls.every((c) => c.method === 'GET'));

  // Accurate hands back a session host over plain HTTP: the first read is blocked, once.
  gate.mock.resetCalls();
  const insecure = async (url, init) => (new URL(url).pathname === '/api/open-db.do'
    ? { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ host: 'http://odin.accurate.id', session: 'sess' }) }
    : fetchImpl(url, init));
  await assert.rejects(() => sync.collectChanges(1, { fetchImpl: insecure }), (e) => e.code === 'ACCURATE_WRITE_BLOCKED');
  assert.equal(gate.mock.callCount(), 2, 'open-db, then one blocked read — no retry');
});

// ------------------------------------------------------------------ Warehouse stage 2: documents

const whc = require('../src/services/accurate/warehouseCollector');
const DOC_DETAILS = {
  'item-transfer': { number: 'IT1', transDate: '28/09/2026', itemTransferType: 'TRANSFER_OUT', itemTransferOutStatus: 'SENDING', warehouse: { name: 'WH A' }, referenceWarehouse: { name: 'WH B' }, inTransitWarehouse: { name: 'Transit' }, description: 'catatan', detailItem: [{ item: { no: 'A', name: 'Oat' }, quantity: 2, itemUnit: { name: 'Ctns' }, unitRatio: 6, receivedQuantity: 0, detailNotes: 'x' }] },
  'item-adjustment': { number: 'IA1', transDate: '31/12/2025', approvalStatus: 'APPROVED', openingBalance: true, totalAmount: 999, detailItem: [{ item: { no: 'A', name: 'Oat' }, quantity: 10, itemUnit: { name: 'Pcs' }, unitRatio: 1, warehouse: { name: 'WH A' }, itemAdjustmentType: 'ADJUSTMENT_IN', unitCost: 5000, totalCost: 50000 }] },
  'receive-item': { number: 'RI1', transDate: '27/09/2026', statusName: 'Diterima', receiveNumber: 'SJ-SUP-9', shipDate: '26/09/2026', vendor: { vendorNo: 'V1', name: 'PT Pemasok', npwpNo: '01.234', vendorBankList: [{}] }, detailItem: [{ item: { no: 'A', name: 'Oat' }, quantity: 5, itemUnit: { name: 'Ctns' }, unitRatio: 6, warehouse: { name: 'WH A' }, purchaseOrder: { number: 'PO1' }, unitPrice: 88000, itemCost: 80000 }] },
  'delivery-order': { number: 'DO1', transDate: '29/09/2026', statusName: 'Difaktur', customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' }, toAddress: 'Jl. Satu No. 1, Jakarta. Telp 0812-3456-7890', detailItem: [{ item: { no: 'A', name: 'Oat' }, quantity: 1, itemUnit: { name: 'Ctns' }, unitRatio: 6, warehouse: { name: 'WH A' }, salesOrder: { number: 'SO1' }, unitPrice: 90000 }] },
};

function fakeDocsAccurate({ lists = {} } = {}) {
  const base = fakeWarehouseAccurate();
  const calls = base.calls;
  const respond = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const listOf = (rows) => respond({ s: true, d: rows, sp: { pageCount: 1, rowCount: rows.length } });
  const defaults = {
    'item-transfer': [{ id: 70, number: 'IT1', approvalStatus: 'APPROVED', lastUpdate: 'T1' }],
    'item-adjustment': [{ id: 71, number: 'IA1', approvalStatus: 'APPROVED' }, { id: 72, number: 'IA-DRAFT', approvalStatus: 'WAITING' }],
    'receive-item': [{ id: 73, number: 'RI1', statusName: 'Diterima', approvalStatus: 'APPROVED', lastUpdate: 'R1' }],
    'delivery-order': [{ id: 74, number: 'DO1', statusName: 'Difaktur', approvalStatus: 'APPROVED', lastUpdate: 'D1', customer: { customerNo: 'PFN-PR-GT-JKT-0001' } }],
  };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const m = /\/accurate\/api\/([a-z-]+)\/(list|detail)\.do$/.exec(u.pathname);
    if (m && DOC_DETAILS[m[1]]) {
      calls.push({ url, method: init?.method || 'GET' });
      return m[2] === 'list' ? listOf(lists[m[1]] || defaults[m[1]]) : respond({ s: true, d: DOC_DETAILS[m[1]] });
    }
    return base.fetchImpl(url, init);
  };
  return { fetchImpl, calls };
}

test('warehouse documents are pulled only once switched on', async (t) => {
  mirrorDb(t);
  delete process.env.ACCURATE_WAREHOUSE_DOCUMENTS;
  const off = fakeDocsAccurate();
  const { changes } = await sync.collectWarehouse(1, { fetchImpl: off.fetchImpl });
  assert.ok(!changes.some((c) => ['wh_transfer', 'wh_adjustment', 'wh_receipt', 'wh_delivery'].includes(c.recordType)));
  assert.ok(!off.calls.some((c) => /item-transfer|item-adjustment|receive-item|delivery-order/.test(c.url)));
});

test('warehouse documents: final only, quantities only, no address', async (t) => {
  process.env.ACCURATE_WAREHOUSE_DOCUMENTS = '1';
  t.after(() => { delete process.env.ACCURATE_WAREHOUSE_DOCUMENTS; });
  mirrorDb(t);
  const { fetchImpl, calls } = fakeDocsAccurate();
  const { changes } = await sync.collectWarehouse(1, { fetchImpl });
  assert.ok(calls.every((c) => c.method === 'GET'));
  const doc = (type) => changes.find((c) => c.recordType === type);
  assert.deepEqual(changes.filter((c) => c.recordType === 'wh_adjustment').map((c) => c.after.number), ['IA1'], 'a waiting adjustment is not final');
  assert.equal(doc('wh_adjustment').after.data.kind, 'opening');
  assert.deepEqual(doc('wh_adjustment').after.data.lines[0], { item_no: 'A', item_name: 'Oat', qty: 10, unit: 'Pcs', unit_ratio: 1, warehouse: 'WH A', direction: 'in' });
  assert.deepEqual(doc('wh_transfer').after.data, {
    transfer_type: 'TRANSFER_OUT', out_status: 'SENDING', from_wh: 'WH A', to_wh: 'WH B', transit_wh: 'Transit',
    lines: [{ item_no: 'A', item_name: 'Oat', qty: 2, unit: 'Ctns', unit_ratio: 6, received_qty: 0 }], _rev: 'T1',
  });
  assert.deepEqual({ ...doc('wh_receipt').after.data, lines: undefined }, {
    vendor_no: 'V1', vendor_name: 'PT Pemasok', supplier_do: 'SJ-SUP-9', ship_date: '2026-09-26', po_numbers: ['PO1'], lines: undefined, _rev: 'R1',
  });
  assert.equal(doc('wh_delivery').after.data.ship_to, undefined, 'no address kept');
  for (const c of changes) {
    assert.equal(c.amount, null, c.recordType);
    assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES[c.recordType], c.after.data), [], c.recordType);
    const keys = JSON.stringify(c.after.data, (k, v) => v).match(/"(unitCost|totalCost|unitPrice|itemCost|npwpNo|vendorBankList|description|detailNotes|totalAmount)"/);
    assert.equal(keys, null, `${c.recordType} carries ${keys}`);
  }
});

test('an e-commerce delivery keeps its channel; an unchanged document is not read again', async (t) => {
  process.env.ACCURATE_WAREHOUSE_DOCUMENTS = '1';
  t.after(() => { delete process.env.ACCURATE_WAREHOUSE_DOCUMENTS; });
  const shopee = { ...DOC_DETAILS['delivery-order'], customer: { customerNo: 'PFN-IN-SHP-JKT-0370', name: 'Ecommerce Shopee' }, toAddress: 'Rumah pembeli, 0812 1111 2222' };
  assert.equal(whc.deliveryRow({ lastUpdate: 'D1' }, shopee).data.ship_to, undefined);
  assert.equal(whc.deliveryRow({ lastUpdate: 'D1' }, shopee).channel, 'Shopee');

  const stored = whc.deliveryRow({ lastUpdate: 'D1' }, DOC_DETAILS['delivery-order']);
  mirrorDb(t, [{ record_type: 'wh_delivery', accurate_id: 74, version: 1, missing: 0, ...stored, content_hash: 'x' }]);
  const { fetchImpl, calls } = fakeDocsAccurate();
  const { changes } = await sync.collectWarehouse(1, { fetchImpl });
  assert.ok(!calls.some((c) => /delivery-order\/detail/.test(c.url)), 'same lastUpdate → no detail read');
  assert.deepEqual(changes.filter((c) => c.recordType === 'wh_delivery'), []);
});

test('a delivery keeps no address at all — whatever the ship-to text holds', () => {
  const withEverything = { ...DOC_DETAILS['delivery-order'], toAddress: 'Jl. Satu 1 RT 001/002, Jakarta 12190. Telp (021) 555-1234, HP 0812\u00a03456\u00a07890, NIK 3273 1234 5678 9012, budi@mail.com' };
  const row = whc.deliveryRow({ lastUpdate: 'D1' }, withEverything);
  assert.equal(JSON.stringify(row).match(/Jl\.|555|0812|3273|@|ship_to|toAddress/), null);
  assert.deepEqual(Object.keys(row.data).sort(), ['_rev', 'lines', 'so_numbers']);
  assert.equal(batches.RECORD_TYPES.wh_delivery.dataKeys.ship_to, undefined, 'the allowlist refuses an address key');
  assert.match(batches.unlistedDataKeys(batches.RECORD_TYPES.wh_delivery, { ship_to: 'x' }).join(), /ship_to/);
});

test('stock that suddenly reads 0 across the board stops the pull for a person to look at', async (t) => {
  const held = Array.from({ length: 60 }, (_, i) => ({
    record_type: 'wh_stock_total', accurate_id: 1000 + i, version: 1, missing: 0, number: `I${i}`, name: `Barang ${i}`,
    data: { qty: 10, qty_all_units: '10 Pcs', upc: null }, content_hash: 'x',
  }));
  mirrorDb(t, held);
  const zeros = held.map((h) => ({ id: h.accurate_id, no: h.number, name: h.name, quantity: 0, quantityInAllUnit: '0 Pcs' }));
  const { fetchImpl } = fakeWarehouseAccurate({ totals: [zeros, zeros], perWarehouse: {} });
  await assert.rejects(() => sync.collectWarehouse(1, { fetchImpl }), (e) => e.code === 'SUSPICIOUS_DROP');
});

test('while a batch waits, a pull reuses its documents instead of reading them from Accurate again', async (t) => {
  const channels = new Map([['PFN-PR-GT-JKT-0001', 'GT']]);
  const staged = sync.invoiceRow(INVOICES[0], channels, { salesman: 'Fajar', soNumbers: ['SO1'], lines: [] });
  mirrorDb(t, [], [{ record_type: 'sales_invoice', external_key: '20', after_data: JSON.stringify(staged) }]);
  const { fetchImpl, calls } = fakeAccurate({ invoices: [INVOICES[0]] });
  await sync.collectChanges(1, { fetchImpl });
  assert.equal(calls.filter((c) => c.url.includes('/sales-invoice/detail.do')).length, 0, 'same lastUpdate as the pending batch');
  t.mock.restoreAll();
  mirrorDb(t, [], [{ record_type: 'sales_invoice', external_key: '20', after_data: JSON.stringify({ ...staged, data: { ...staged.data, _last_update: 'older' } }) }]);
  const again = fakeAccurate({ invoices: [INVOICES[0]] });
  await sync.collectChanges(1, { fetchImpl: again.fetchImpl });
  assert.equal(again.calls.filter((c) => c.url.includes('/sales-invoice/detail.do')).length, 1, 'edited in Accurate since: read again');
});

test('"tidak ada lagi" is confirmed first: a document still there and final in Accurate is never marked', async (t) => {
  const asMirror = { record_type: 'sales_invoice', accurate_id: 20, version: 1, missing: 0, number: 'SI1', trans_date: '2026-09-02', customer_no: 'PFN-PR-GT-JKT-0001', data: {}, content_hash: 'x' };
  mirrorDb(t, [asMirror]);
  // The list (shifted while paged) no longer shows invoice 20, but Accurate still has it, final.
  const { fetchImpl } = fakeAccurate({ invoices: [INVOICES[1]] });
  const shifted = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/sales-invoice/detail.do') && u.searchParams.get('id') === '20') {
      return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ s: true, d: { ...INVOICES[0], detailItem: [] } }) };
    }
    return fetchImpl(url, init);
  };
  const { changes } = await sync.collectChanges(1, { fetchImpl: shifted });
  assert.ok(!changes.some((c) => c.action === 'missing' && c.externalKey === '20'), 'live and final: not "tidak ada lagi"');
  t.mock.restoreAll();
  mirrorDb(t, [asMirror]);
  const gone = await sync.collectChanges(1, { fetchImpl: fakeAccurate({ invoices: [INVOICES[1]] }).fetchImpl });
  assert.ok(gone.changes.some((c) => c.action === 'missing' && c.externalKey === '20'), 'really deleted: marked');
});

test('a document read again at a new marker with nothing kept changed is not read again on the next pull', async (t) => {
  const channels = new Map([['PFN-PR-GT-JKT-0001', 'GT']]);
  const inMirror = sync.invoiceRow({ ...INVOICES[0], lastUpdate: 'L0' }, channels, sync.invoiceExtra({
    masterSalesmanName: 'Fajar', detailItem: [
      { salesOrder: { number: 'SO1' }, item: { no: 'BEV-ERG-34G-001-01', name: 'Energen 34g' }, quantity: 2, itemUnit: { name: 'Renceng' }, salesAmount: 500 },
      { salesOrder: { number: 'SO1' }, item: { no: 'FOD-GLO-250G-005-11', name: 'Abon' }, quantity: 1, itemUnit: { name: 'Tin' }, salesAmount: 400 },
    ],
  }));
  const mirrorRow = { record_type: 'sales_invoice', accurate_id: 20, version: 1, missing: 0, ...inMirror, content_hash: 'x' };
  const calls1 = mirrorDb(t, [mirrorRow]);
  const first = fakeAccurate({ invoices: [INVOICES[0]] }); // lastUpdate L1: e.g. only printed
  const r1 = await sync.collectChanges(1, { fetchImpl: first.fetchImpl });
  assert.equal(first.calls.filter((c) => c.url.includes('/sales-invoice/detail.do')).length, 1);
  assert.deepEqual(r1.changes.filter((c) => c.recordType === 'sales_invoice' && c.externalKey === '20'), []);
  assert.deepEqual(r1.stats.seenMarkers, { 'sales_invoice:20': 'L1@1' }, 'the marker and the mirror version it was checked against');
  assert.ok(calls1.some((c) => /\$\.seenMarkers/.test(c.sql)));
  t.mock.restoreAll();
  const calls2 = mirrorDb(t, [mirrorRow]);
  t.mock.method(pool, 'query', async (sql, args) => {
    calls2.push({ sql, args });
    if (/\$\.seenMarkers/.test(sql)) return [[{ seen: JSON.stringify({ 'sales_invoice:20': 'L1@1' }) }]];
    if (/FROM accurate_records r/.test(sql)) return [[mirrorRow]];
    return [[]];
  });
  const second = fakeAccurate({ invoices: [INVOICES[0]] });
  await sync.collectChanges(1, { fetchImpl: second.fetchImpl });
  assert.equal(second.calls.filter((c) => c.url.includes('/sales-invoice/detail.do')).length, 0, 'remembered: not read again');
});

test('each stock list zeroes nothing unless its own read was complete', async (t) => {
  const mirror = [
    { record_type: 'wh_warehouse', accurate_id: 3, version: 1, missing: 0, name: 'Gudang Lama', status: 'Aktif', data: { is_default: false, is_scrap: false }, content_hash: 'x' },
    { record_type: 'wh_stock_total', accurate_id: 60, version: 1, missing: 0, number: 'OLD-1', name: 'Barang lama', data: { qty: 7, qty_all_units: '7 Pcs', upc: null }, content_hash: 'x' },
    { record_type: 'wh_stock', accurate_id: '60000003', version: 1, missing: 0, number: 'OLD-1', name: 'Barang lama', data: { item_id: 60, warehouse_id: 3, warehouse: 'Gudang Lama', qty: 7, qty_all_units: '7 Pcs' }, content_hash: 'x' },
  ];
  const touched = (changes) => changes.filter((c) => ['3', '60', '60000003'].includes(c.externalKey)).map((c) => `${c.recordType}:${c.action}`).sort();
  mirrorDb(t, mirror);
  const shortWarehouses = await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate({ lie: { warehouses: true } }).fetchImpl });
  assert.deepEqual(touched(shortWarehouses.changes).filter((x) => !x.startsWith('wh_stock_total')), [], 'short gudang list: no gudang or per-gudang change');
  assert.equal(shortWarehouses.checks.warehouse.complete, false);
  t.mock.restoreAll();
  mirrorDb(t, mirror);
  const shortTotals = await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate({ lie: { totals: true } }).fetchImpl });
  assert.ok(!touched(shortTotals.changes).some((x) => x.startsWith('wh_stock_total')), 'short total list: no total zeroed');
  t.mock.restoreAll();
  mirrorDb(t, mirror);
  const full = await sync.collectWarehouse(1, { fetchImpl: fakeWarehouseAccurate().fetchImpl });
  assert.deepEqual(touched(full.changes), ['wh_stock:update', 'wh_stock_total:update', 'wh_warehouse:missing'], 'a complete read does');
});

test('a remembered marker never hides a change once the mirror has moved to a newer version', async (t) => {
  const channels = new Map([['PFN-PR-GT-JKT-0001', 'GT']]);
  const v2 = { record_type: 'sales_invoice', accurate_id: 20, version: 2, missing: 0,
    ...sync.invoiceRow({ ...INVOICES[0], lastUpdate: 'L0' }, channels, { salesman: 'Fajar', soNumbers: ['SO1'], lines: [] }), content_hash: 'x' };
  t.mock.method(pool, 'query', async (sql) => {
    if (/\$\.seenMarkers/.test(sql)) return [[{ seen: JSON.stringify({ 'sales_invoice:20': 'L1@1' }) }]]; // checked against v1
    if (/FROM accurate_records r/.test(sql)) return [[v2]];
    return [[]];
  });
  namedLock.held = false;
  fakeLockConnection(t);
  t.mock.method(connection, 'getAccessToken', async () => ({ accessToken: 'tok', dbId: 7 }));
  const { fetchImpl, calls } = fakeAccurate({ invoices: [INVOICES[0]] });
  await sync.collectChanges(1, { fetchImpl });
  assert.equal(calls.filter((c) => c.url.includes('/sales-invoice/detail.do') && c.url.includes('id=20')).length, 1, 'read again: v2 was never checked');
});

test('a division whose batch is waiting costs no detail reads or confirmations; the other division is pulled as usual', async (t) => {
  const calls = mirrorDb(t, [{ record_type: 'sales_invoice', accurate_id: 99, version: 1, missing: 0, number: 'SI-OLD', trans_date: '2026-08-01', customer_no: 'PFN-PR-GT-JKT-0001', channel: 'GT', data: {}, content_hash: 'x' }]);
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/SELECT DISTINCT d\.code FROM sales_accurate_batches/.test(sql)) return [[{ code: 'sales' }]];
    if (/FROM accurate_records r/.test(sql)) return [[{ record_type: 'sales_invoice', accurate_id: 99, version: 1, missing: 0, number: 'SI-OLD', trans_date: '2026-08-01', customer_no: 'PFN-PR-GT-JKT-0001', channel: 'GT', data: {}, content_hash: 'x' }]];
    return [[]];
  });
  const { fetchImpl, calls: accurateCalls } = fakeAccurate();
  const { changes } = await sync.collectChanges(1, { fetchImpl });
  const details = accurateCalls.filter((c) => /\/detail\.do/.test(c.url));
  // SI1 (GT → Sales, waiting) is not read; SI2 (Shopee → Retail Commerce) is.
  assert.ok(!details.some((c) => c.url.includes('sales-invoice/detail.do') && c.url.includes('id=20')));
  assert.ok(details.some((c) => c.url.includes('sales-invoice/detail.do') && c.url.includes('id=21')));
  assert.ok(!details.some((c) => c.url.includes('id=99')), 'no confirmation lookup for the waiting division');
  assert.ok(!changes.some((c) => c.externalKey === '99'), 'its "tidak ada lagi" waits for the next pull');
});

test('a waiting division\'s document edited in Accurate stays exactly as the mirror has it — never half new, half old', async (t) => {
  const channels = new Map([['PFN-PR-GT-JKT-0001', 'GT']]);
  const old = { record_type: 'sales_invoice', accurate_id: 20, version: 1, missing: 0,
    ...sync.invoiceRow({ ...INVOICES[0], lastUpdate: 'L0' }, channels, { salesman: 'Fajar', soNumbers: ['SO1'], lines: [] }), content_hash: 'x' };
  mirrorDb(t, [old]);
  t.mock.method(pool, 'query', async (sql) => {
    if (/SELECT DISTINCT d\.code FROM sales_accurate_batches/.test(sql)) return [[{ code: 'sales' }]];
    if (/FROM accurate_records r/.test(sql)) return [[old]];
    return [[]];
  });
  // Edited in Accurate: new marker, new total — but its division's batch is still waiting.
  const edited = { ...INVOICES[0], lastUpdate: 'L1', dppAmount: 1900, tax1Amount: 199, totalAmount: 2099, primeOwing: 2099 };
  const { fetchImpl } = fakeAccurate({ invoices: [edited] });
  const { changes } = await sync.collectChanges(1, { fetchImpl });
  assert.deepEqual(changes.filter((c) => c.externalKey === '20'), [], 'nothing staged for it until the pull after the decision');
});

test('only Accurate\'s own "not found" confirms a document gone; an outage or a refused token stages nothing', async (t) => {
  const asMirror = { record_type: 'sales_invoice', accurate_id: 20, version: 1, missing: 0, number: 'SI1', trans_date: '2026-09-02', customer_no: 'PFN-PR-GT-JKT-0001', data: {}, content_hash: 'x' };
  for (const [label, answer] of [
    ['token refused', () => ({ status: 401, ok: false, headers: { get: () => null }, json: async () => ({ error: 'invalid_token' }) })],
    ['network down', () => { throw new TypeError('fetch failed'); }],
  ]) {
    mirrorDb(t, [asMirror]);
    const { fetchImpl } = fakeAccurate({ invoices: [INVOICES[1]] });
    const flaky = async (url, init) => (/sales-invoice\/detail\.do/.test(url) && url.includes('id=20') ? answer() : fetchImpl(url, init));
    const { changes } = await sync.collectChanges(1, { fetchImpl: flaky });
    assert.ok(!changes.some((c) => c.action === 'missing' && c.externalKey === '20'), label);
    t.mock.restoreAll();
  }
});

test('lookups for "tidak ada lagi" take turns, so candidates that keep answering alive cannot starve the rest', async () => {
  const { confirmMissing } = require('../src/services/accurate/syncCore');
  const changes = Array.from({ length: 70 }, (_, i) => ({ action: 'missing', recordType: 'sales_invoice', externalKey: String(i) }));
  const looked = [];
  const session = { base: 'https://odin.accurate.id', headers: {}, fetchImpl: async (url) => {
    looked.push(new URL(url).searchParams.get('id'));
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ s: true, d: { statusName: 'Belum Lunas' } }) };
  } };
  await confirmMissing(session, changes, { now: 0 });
  const first = new Set(looked);
  looked.length = 0;
  await confirmMissing(session, changes, { now: 60000 * 30 });
  assert.equal(first.size, 60);
  assert.ok(looked.some((id) => !first.has(id)), 'a later pull reaches candidates the first one never looked at');
});

test('one warehouse document Accurate will not show is left for the next pull — the pull goes on, stock included', async (t) => {
  process.env.ACCURATE_WAREHOUSE_DOCUMENTS = '1';
  t.after(() => { delete process.env.ACCURATE_WAREHOUSE_DOCUMENTS; });
  mirrorDb(t);
  const { fetchImpl } = fakeDocsAccurate();
  const refusing = async (url, init) => (/item-transfer\/detail\.do/.test(url)
    ? { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ s: false, d: ['Tidak boleh'] }) }
    : fetchImpl(url, init));
  const { changes, checks, stats } = await sync.collectWarehouse(1, { fetchImpl: refusing });
  assert.ok(!changes.some((c) => c.recordType === 'wh_transfer'), 'the unreadable transfer is not staged');
  assert.ok(changes.some((c) => c.recordType === 'wh_receipt') && changes.some((c) => c.recordType === 'wh_stock_total'), 'everything else is');
  assert.deepEqual(checks.warehouse.unread_documents, { wh_transfer: 1 });
  assert.equal(stats.fullCheckAt, null, 'a daily check with an unread document is not counted as done');
});

test('units per item: pulled only once switched on — base unit and ratios, nothing else', async (t) => {
  const ITEM_UNITS = [
    { id: 50, no: 'BEV-ERG', name: 'Energen', itemTypeName: 'Persediaan', unit1: { id: 1, name: 'Renceng' }, unit2: { id: 2, name: 'Ctns', codeUnitTax: 'X' }, ratio2: 24, ratio3: 0, unitPrice: 1500 },
    { id: 51, no: 'DAI-OAT', name: 'Oatside', itemTypeName: 'Persediaan', unit1: { name: 'TetraPk' }, ratio2: 0 },
    { id: 99, no: 'SRV-ONGKIR', name: 'Ongkir', itemTypeName: 'Jasa', unit1: { name: 'Kali' } },
  ];
  const withItems = (base) => async (url, init) => (new URL(url).pathname.endsWith('/item/list.do')
    ? { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ s: true, d: ITEM_UNITS, sp: { pageCount: 1, rowCount: ITEM_UNITS.length } }) }
    : base(url, init));
  mirrorDb(t);
  delete process.env.ACCURATE_ITEM_UNITS;
  const off = await sync.collectWarehouse(1, { fetchImpl: withItems(fakeWarehouseAccurate().fetchImpl) });
  assert.ok(!off.changes.some((c) => c.recordType === 'wh_item_unit'), 'switched off: not pulled');
  t.mock.restoreAll();

  process.env.ACCURATE_ITEM_UNITS = '1';
  t.after(() => { delete process.env.ACCURATE_ITEM_UNITS; });
  mirrorDb(t);
  const on = await sync.collectWarehouse(1, { fetchImpl: withItems(fakeWarehouseAccurate().fetchImpl) });
  const units = on.changes.filter((c) => c.recordType === 'wh_item_unit');
  assert.deepEqual(units.map((c) => [c.externalKey, c.after.data]), [
    ['50', { base_unit: 'Renceng', units: [{ name: 'Ctns', ratio: 24 }] }],
    ['51', { base_unit: 'TetraPk', units: [] }],
  ], 'inventory items only; a unit without a ratio is left out');
  for (const c of units) {
    assert.equal(c.amount, null);
    assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.wh_item_unit, c.after.data), []);
  }
  assert.equal(batches.RECORD_TYPES.wh_item_unit.labelOf(units[0].after), 'Energen (BEV-ERG) · 1 Ctns = 24 Renceng');
});

test('open SOs for the shipping schedule: pulled once switched on, quantities only, and one that got fully shipped leaves only after Accurate confirms', async (t) => {
  const SO = { id: 90, number: 'SO9', transDate: '27/09/2026', statusName: 'Menunggu diproses', approvalStatus: 'APPROVED', percentShipped: 0, shipDate: '28/09/2026', customer: { customerNo: 'PFN-PR-GT-JKT-0001', name: 'Toko Satu' }, lastUpdate: 'S1' };
  const DETAIL = { ...SO, toAddress: 'Jl. Satu No. 1, Telp 0812-3456-7890', detailItem: [{ item: { no: 'A', name: 'Oat' }, quantity: 6, itemUnit: { name: 'Ctns' }, unitRatio: 6, shipQuantity: 2, warehouse: { name: 'WH A' }, closed: false, unitPrice: 90000, availableQuantity: 4 }] };
  const withSo = (base, { list = [SO], detail = () => DETAIL } = {}) => async (url, init) => {
    const u = new URL(url);
    const respond = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
    if (u.pathname.endsWith('/sales-order/list.do')) return respond({ s: true, d: list, sp: { pageCount: 1, rowCount: list.length } });
    if (u.pathname.endsWith('/sales-order/detail.do')) return respond({ s: true, d: detail(u.searchParams.get('id')) });
    return base(url, init);
  };
  mirrorDb(t);
  delete process.env.ACCURATE_WAREHOUSE_SO;
  const off = await sync.collectWarehouse(1, { fetchImpl: withSo(fakeWarehouseAccurate().fetchImpl) });
  assert.ok(!off.changes.some((c) => c.recordType === 'wh_so_open'), 'switched off: not pulled');
  t.mock.restoreAll();

  process.env.ACCURATE_WAREHOUSE_SO = '1';
  t.after(() => { delete process.env.ACCURATE_WAREHOUSE_SO; });
  mirrorDb(t);
  const on = await sync.collectWarehouse(1, { fetchImpl: withSo(fakeWarehouseAccurate().fetchImpl) });
  const so = on.changes.find((c) => c.recordType === 'wh_so_open');
  assert.deepEqual(so.after.data.lines, [{ item_no: 'A', item_name: 'Oat', qty: 6, unit: 'Ctns', unit_ratio: 6, shipped_qty: 2, warehouse: 'WH A', closed: false }]);
  assert.equal(so.after.data.ship_date, '2026-09-28');
  assert.doesNotMatch(JSON.stringify(so.after), /Jl\.|0812|90000|price/i, 'no address, no price');
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.wh_so_open, so.after.data), []);
  t.mock.restoreAll();

  // In the mirror, now fully shipped in Accurate: gone from the open list → confirmed → leaves.
  const inMirror = { record_type: 'wh_so_open', accurate_id: 90, version: 1, missing: 0, ...so.after, content_hash: 'x' };
  mirrorDb(t, [inMirror]);
  const shipped = await sync.collectWarehouse(1, { fetchImpl: withSo(fakeWarehouseAccurate().fetchImpl, { list: [{ ...SO, percentShipped: 100, statusName: 'Terproses' }], detail: () => ({ ...DETAIL, percentShipped: 100, statusName: 'Terproses' }) }) });
  assert.ok(shipped.changes.some((c) => c.recordType === 'wh_so_open' && c.action === 'missing'), 'fully shipped: leaves the schedule');
  t.mock.restoreAll();
  // Still open in Accurate although the list page missed it: stays.
  mirrorDb(t, [inMirror]);
  const shifted = await sync.collectWarehouse(1, { fetchImpl: withSo(fakeWarehouseAccurate().fetchImpl, { list: [] }) });
  assert.ok(!shifted.changes.some((c) => c.recordType === 'wh_so_open' && c.action === 'missing'), 'still open: not marked');
});
