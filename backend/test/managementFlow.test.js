const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const registry = require('../src/management/registry');
const { validateProvider } = require('../src/management/contract');
const flow = require('../src/management/providers/flow');
const service = require('../src/services/managementFlow.service');
const procurementRules = require('../src/services/procurementRules');
const warehouseRules = require('../src/services/warehouseRules');
const salesSource = require('../src/services/salesSource');

// Program 3.3: the order-to-cash flow reports into management (providers/flow.js)
// and serves the Alur & Margin page (managementFlow.service). Numbers come back
// from MySQL as strings, so the fixtures use those shapes.

const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const ESCALATION_FIELDS = [
  'sourceId', 'title', 'reference', 'context', 'departmentId', 'departmentName',
  'ownerName', 'severity', 'daysLate', 'since', 'link',
].sort();

const notBilledRow = {
  so_id: 4209, so_number: 'SO53/SO-PFN/VIII/2026', customer_name: 'Koat Coffee - Pd Aren', delivered_on: new Date('2026-09-20T00:00:00Z'),
  department_id: 5, department_name: 'Sales', due_on: new Date('2026-09-22T00:00:00Z'), days_late: 8,
};

function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM mg_sales_flow_accurate f\s+LEFT JOIN departments d ON d\.id = f\.department_id\s+WHERE f\.entity_id = \?[^]*LIMIT/.test(sql)) return [[notBilledRow]];
    if (/COUNT\(\*\) AS total, COALESCE\(SUM\(/.test(sql)) return [[{ total: '1231', bill: '2' }]];
    if (/AS order_days/.test(sql)) return [[{ order_days: 5, pay_days: 4 }, { order_days: 9, pay_days: 7 }, { order_days: 3, pay_days: 1 }]];
    if (/FROM sales_invoices_accurate i\s+JOIN mg_invoice_payments_accurate p/.test(sql)) {
      return [[{ department_id: 5, n: 29, days: '10.4138' }, { department_id: null, n: 1, days: '2.0000' }]];
    }
    return [[]];
  };
}

async function runEverything(departmentId) {
  for (const e of flow.escalations) await e.list(1, { departmentId });
  for (const m of flow.metrics) await m.actuals(1, PERIOD, { departmentId });
  for (const k of flow.kpis) await k.value(1, { departmentId });
}

function withSource(t, value) {
  const before = process.env.SALES_TRANSACTION_SOURCE;
  t.after(() => { if (before === undefined) delete process.env.SALES_TRANSACTION_SOURCE; else process.env.SALES_TRANSACTION_SOURCE = before; });
  if (value === undefined) delete process.env.SALES_TRANSACTION_SOURCE; else process.env.SALES_TRANSACTION_SOURCE = value;
}

// ------------------------------------------------------------------ provider contract

test('flow: satisfies the management contract, keys prefixed flow_, claims /management/flow', () => {
  assert.doesNotThrow(() => validateProvider(flow));
  assert.deepEqual(flow.navPaths, ['/management/flow']);
  for (const x of [...flow.escalations, ...flow.metrics, ...flow.kpis]) assert.ok(x.key.startsWith('flow_'), x.key);
  assert.deepEqual(flow.escalations.map((e) => e.key), ['flow_do_not_invoiced']);
  assert.deepEqual(flow.metrics.map((m) => m.key), ['flow_days_to_pay']);
  assert.deepEqual(flow.kpis.map((k) => k.key), ['flow_orders_stuck', 'flow_order_to_cash']);
});

test('flow: one late-SO escalation only — the flow never escalates shipping (warehouse_so_late does)', () => {
  registry.reset();
  const late = registry.escalationSources().filter((s) => /so_(late|not_shipped)|belum dikirim|lewat janji/i.test(`${s.key} ${s.label}`));
  assert.deepEqual(late.map((s) => s.key), ['warehouse_so_late']);
  const src = require('node:fs').readFileSync(require.resolve('../src/management/providers/flow'), 'utf8');
  assert.doesNotMatch(src, /wh_so_open|promised_date|so_state IN/, 'no shipping rule in the flow provider');
});

test('exactly one escalation source reads the Warehouse promise view: warehouse_so_late', async (t) => {
  withSource(t, undefined);
  registry.reset();
  const readers = [];
  for (const source of registry.escalationSources()) {
    const calls = [];
    t.mock.method(pool, 'query', async (sql, args) => { calls.push(sql); return [[]]; });
    try { await source.list(1, { departmentId: null }); } catch { /* a provider needing richer rows is irrelevant here */ }
    if (calls.some((sql) => /wh_so_fulfilment_accurate/.test(sql))) readers.push(source.key);
    t.mock.restoreAll();
  }
  assert.deepEqual(readers, ['warehouse_so_late']);
});

test('flow: a division Head is filtered in SQL — one query per capability, entity first, then division', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(9);
  assert.equal(calls.length, flow.escalations.length + flow.metrics.length + flow.kpis.length, 'one query per capability, no hold query');
  for (const c of calls) {
    assert.match(c.sql, /[a-z]\.department_id = \?/, 'carries the division filter');
    assert.equal(c.args[0], 1, 'entity first');
    assert.equal(c.args[1], 9, 'then the caller\'s division');
    assert.match(c.sql, /\.entity_id = \?/, 'scoped to the entity');
    assert.doesNotMatch(c.sql, /CURDATE|NOW\(\)/);
  }
});

test('flow: the entity-wide view has no division filter', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(null);
  assert.equal(calls.length, flow.escalations.length + flow.metrics.length + flow.kpis.length);
  for (const c of calls) {
    assert.doesNotMatch(c.sql, /department_id = \?/);
    assert.equal(c.args[0], 1);
    assert.ok(!c.args.includes(9) && !c.args.includes(null));
  }
});

test('flow: held without a query while Sales transactions are recorded in the app', async (t) => {
  withSource(t, 'app');
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  for (const e of flow.escalations) assert.deepEqual(await e.list(1, { departmentId: null }), []);
  for (const m of flow.metrics) assert.equal((await m.actuals(1, PERIOD, { departmentId: null })).size, 0);
  for (const k of flow.kpis) assert.deepEqual(await k.value(1, { departmentId: null }), { value: null, sub: 'Transaksi Sales dicatat di aplikasi', alert: false });
  assert.equal(calls.length, 0);
});

test('flow_do_not_invoiced: maps a surat jalan without faktur to Pusat Eskalasi, within the billing window', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await flow.escalations[0].list(1, { departmentId: null });
  assert.deepEqual(Object.keys(item).sort(), ESCALATION_FIELDS);
  assert.equal(item.sourceId, 4209);
  assert.equal(item.title, 'SO53/SO-PFN/VIII/2026 · Koat Coffee - Pd Aren');
  assert.equal(item.reference, 'SO53/SO-PFN/VIII/2026');
  assert.match(item.context, /Surat jalan 2026-09-20 sudah dikirim, faktur belum dibuat/);
  assert.equal(item.departmentId, 5);
  // The SO's surat jalan on Data Sales: searched by the SO number, over a period
  // that reaches back past the billing window (the page opens on this month).
  assert.equal(item.link, '/sales/orders?tab=do&periode=last_3_months&q=SO53%2FSO-PFN%2FVIII%2F2026');
  assert.equal(new URLSearchParams(item.link.split('?')[1]).get('q'), 'SO53/SO-PFN/VIII/2026');
  assert.equal(item.since, '2026-09-22T00:00:00.000Z');
  assert.equal(item.severity, 'medium');
  const [c] = calls;
  assert.match(c.sql, /f\.stage = 'shipped'/);
  assert.match(c.sql, /f\.data_through IS NULL OR f\.delivered_on \+ INTERVAL 2 DAY < f\.data_through/, 'held while a waiting batch may carry the faktur');
  assert.match(c.sql, /INTERVAL 30 DAY/);
});

test('flow_do_not_invoiced: the surat jalan list finds a surat jalan by its SO number', async (t) => {
  withSource(t, undefined);
  const ordersCtrl = require('../src/controllers/salesOrders.controller');
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: 1 }]];
    return [[{ n: 0 }]];
  });
  const user = { sub: 2, entityId: 1, permissions: ['sales.order.view', 'sales.data.view_all'] };
  await new Promise((resolve, reject) => {
    const res = { status() { return this; }, json(body) { resolve(body); return this; } };
    Promise.resolve(ordersCtrl.listDocuments({ user, query: { type: 'do', q: 'SO53/SO-PFN/VIII/2026', from: '2026-08-01', to: '2026-10-31' } }, res, reject)).catch(reject);
  });
  const list = calls.find((c) => /FROM sales_do_accurate d WHERE/.test(c.sql) && /LIMIT/.test(c.sql));
  assert.ok(list, 'reads the surat jalan');
  assert.match(list.sql, /OR CAST\(d\.so_numbers AS CHAR\) LIKE \?\)/);
  assert.ok(list.args.includes('%SO53/SO-PFN/VIII/2026%'));
});

test('flow_do_not_invoiced: locate is bound to the company and returns the SO\'s own division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return args[0] === 404 ? [[]] : [[{ entity_id: '1', department_id: '5' }]];
  });
  assert.deepEqual(await flow.escalations[0].locate(4209, { entityId: 1 }), { entityId: 1, departmentId: 5 });
  assert.equal(await flow.escalations[0].locate(404, { entityId: 1 }), null);
  assert.match(calls[0].sql, /FROM sales_so_accurate WHERE id = \? AND entity_id = \?/);
  assert.deepEqual(calls[0].args, [4209, 1]);
});

test('flow_days_to_pay: a Map per division from string averages; records without a division dropped', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const result = await flow.metrics[0].actuals(1, PERIOD, { departmentId: 5 });
  assert.ok(result instanceof Map);
  assert.deepEqual([...result.entries()], [[5, 10.4]]);
  assert.deepEqual(calls[0].args, [1, 5, '2026-09-01', '2026-09-30']);
  assert.match(calls[0].sql, /NOT i\.is_dp AND i\.outstanding_amount = 0/);
});

test('flow KPIs: numbers from strings, never string concatenation; nothing yet reads as waiting', async (t) => {
  withSource(t, undefined);
  t.mock.method(pool, 'query', fakeQuery([]));
  const stuck = await flow.kpis[0].value(1, { departmentId: null });
  assert.deepEqual(stuck, { value: 2, sub: 'lebih dari 2 hari tanpa faktur · telat kirim: lihat Warehouse', alert: true });
  const cash = await flow.kpis[1].value(1, { departmentId: null });
  assert.equal(cash.value, 5);
  assert.match(cash.sub, /^3 SO lunas 90 hari terakhir · faktur→lunas rata-rata 4 hari$/);
  assert.equal(cash.alert, false);

  t.mock.method(pool, 'query', async () => [[{ total: '0', bill: '0' }]]);
  assert.deepEqual(await flow.kpis[0].value(1, { departmentId: null }), { value: null, sub: 'Menunggu data Sales dari Accurate', alert: false });
  assert.deepEqual(await flow.kpis[0].value(1, { departmentId: 9 }), { value: null, sub: 'Tidak ada SO Accurate untuk divisi ini', alert: false });
  t.mock.method(pool, 'query', async () => [[]]);
  assert.deepEqual(await flow.kpis[1].value(1, { departmentId: null }), { value: null, sub: 'Belum ada SO lunas 90 hari terakhir', alert: false });
});

// ------------------------------------------------------------------ page service

const flowRows = [
  // shipped by DO, billed and paid
  { so_id: 1, department_id: 5, department_name: 'Sales', stage: 'paid', shipped_by: 'delivery', so_state: 'shipped', closed: 0, started: 1, order_to_start: 1, order_to_full: 1, ship_to_bill: 0, bill_to_paid: 6, order_to_paid: 7 },
  // shipped on the invoice
  { so_id: 2, department_id: 5, department_name: 'Sales', stage: 'billed', shipped_by: 'invoice', so_state: 'shipped', closed: 0, started: 1, order_to_start: 0, order_to_full: 0, ship_to_bill: null, bill_to_paid: null, order_to_paid: null },
  // part-shipped, its faktur paid: still "billed"
  { so_id: 3, department_id: 8, department_name: 'Retail Commerce', stage: 'billed', shipped_by: 'invoice', so_state: 'partial', closed: 0, started: 1, order_to_start: 2, order_to_full: null, ship_to_bill: null, bill_to_paid: null, order_to_paid: null },
  // nothing yet
  { so_id: 4, department_id: 5, department_name: 'Sales', stage: 'ordered', shipped_by: null, so_state: 'open', closed: 0, started: 0, order_to_start: null, order_to_full: null, ship_to_bill: null, bill_to_paid: null, order_to_paid: null },
];
const lateRows = Array.from({ length: 60 }, (_, i) => ({
  so_id: 100 + i, so_number: `SO.${i}`, customer_name: 'GrabMart', department_id: 5, ordered_on: new Date('2026-09-20T00:00:00Z'),
  percent_shipped: '0.0000', due_on: new Date('2026-09-22T00:00:00Z'), due_estimated: 1, due_shifted: i === 1 ? 1 : 0, days_late: 8, escalated: i < 5 ? 1 : 0,
}));

function serviceQuery(calls, { accurate = true } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches b JOIN departments d ON d\.id = b\.department_id\s+WHERE b\.entity_id = \? AND b\.status = 'pending'/.test(sql)) return [[{ code: 'procurement' }, { code: 'sales' }]];
    if (/b\.status = 'applied'/.test(sql)) return [[{ n: accurate ? 1 : 0 }]];
    if (/AS order_to_start/.test(sql)) return [flowRows];
    if (/FROM wh_so_fulfilment_accurate x/.test(sql)) return [lateRows];
    if (/FROM mg_sales_flow_accurate f\s+WHERE f\.entity_id = \? AND f\.stage = 'shipped'/.test(sql)) return [[]];
    if (/COALESCE\(SUM\(i\.outstanding_amount\), 0\) AS amount/.test(sql)) return [[{ n: 1190, amount: '11163685020.00' }]];
    if (/JSON_LENGTH\(i\.so_numbers\)/.test(sql)) return [[{ n: 1 }]];
    if (/AS po_ready/.test(sql)) return [[{ po_ready: 1, receipts_ready: 0 }]];
    if (/AS po_to_first/.test(sql)) {
      return [[{ po_id: 1, state: 'received', po_to_first: 3, po_to_complete: 5, completed: 1, on_time: 1 }, { po_id: 2, state: 'legacy', po_to_first: null, po_to_complete: null, completed: 0, on_time: null }]];
    }
    if (/SELECT x\.state, COUNT\(\*\) AS n/.test(sql)) return [[{ state: 'late', n: '2' }, { state: 'partial', n: '1' }, { state: 'legacy', n: '90' }]];
    return [[]];
  };
}

test('salesFlow: stages, shipped-by split, steps and divisions from the cohort rows', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', serviceQuery(calls));
  const out = await service.salesFlow(1, { from: '2026-07-01', to: '2026-09-30', preset: '3m' });
  assert.equal(out.ready, true);
  assert.deepEqual(out.pending, ['procurement', 'sales']);
  assert.deepEqual(out.stages, { total: 4, started: 3, shippedFull: 2, billed: 3, paid: 1, closed: 0, ordered: 1 });
  assert.deepEqual(out.shippedBy, { delivery: 1, invoice: 2 });
  const step = (k) => out.steps.find((s) => s.key === k);
  assert.equal(step('ship_to_bill').count, 1, 'surat jalan → faktur only for SOs shipped by surat jalan');
  assert.equal(step('bill_to_paid').count, 1);
  assert.equal(step('order_to_full').medianDays, 0.5);
  assert.deepEqual(out.byDivision.map((d) => [d.departmentName, d.total, d.shippedFull, d.billed, d.paid]), [['Sales', 3, 2, 2, 1], ['Retail Commerce', 1, 0, 1, 0]]);
  assert.equal(out.stuck.notShipped.count, 60, 'the full count is kept');
  assert.equal(out.stuck.notShipped.items.length, 50, 'the list is capped');
  assert.equal(out.stuck.notShipped.escalated, 5);
  assert.deepEqual(out.stuck.notShipped.items[0], {
    soId: 100, soNumber: 'SO.0', customerName: 'GrabMart', departmentId: 5, orderedOn: '2026-09-20', dueOn: '2026-09-22',
    dueEstimated: true, dueShifted: false, percentShipped: 0, daysLate: 8, escalated: true,
  });
  assert.equal(out.stuck.notShipped.items[1].dueShifted, true, 'a standard promise moved from Sunday to Monday');
  assert.deepEqual(out.stuck.overdue, { count: 1190, amount: 11163685020 });
  assert.equal(out.invoicesWithoutSo, 1);
  // The late list is the shared late-SO rule (warehouseRules.lateSoSql: the
  // Warehouse promise, OTIF_FROM, no marketplace recap), bound to the company.
  const late = calls.find((c) => /FROM wh_so_fulfilment_accurate x/.test(c.sql));
  assert.deepEqual(late.args, [1]);
  assert.ok(late.sql.includes(warehouseRules.lateSoSql('x')));
  assert.match(late.sql, /x\.so_state IN \('open', 'partial'\) AND x\.judged AND x\.promised_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/);
  assert.ok(late.sql.includes(`${warehouseRules.promiseShiftedSql('x')} AS due_shifted`), 'the Warehouse rule for a promise moved to Monday');
  const cohort = calls.find((c) => /AS order_to_start/.test(c.sql));
  assert.deepEqual(cohort.args, [1, '2026-07-01', '2026-09-30']);
});

test('salesFlow: before the first approved Sales batch, the empty shapes and no flow query', async (t) => {
  withSource(t, undefined);
  const calls = [];
  t.mock.method(pool, 'query', serviceQuery(calls, { accurate: false }));
  const out = await service.salesFlow(1, { from: '2026-07-01', to: '2026-09-30' });
  assert.equal(out.ready, false);
  assert.equal(out.stages.total, 0);
  assert.equal(out.steps.length, 5);
  assert.ok(out.steps.every((s) => s.medianDays === null));
  assert.equal(out.stuck.notShipped.items.length, 0);
  assert.ok(!calls.some((c) => /mg_sales_flow_accurate|wh_so_fulfilment_accurate/.test(c.sql)));
});

test('purchaseFlow: LATE_FROM bound first, cohort in the period, receipts not ready → no step times', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', serviceQuery(calls));
  const out = await service.purchaseFlow(1, { from: '2026-07-01', to: '2026-09-30' });
  const cohort = calls.find((c) => /AS po_to_first/.test(c.sql));
  assert.deepEqual(cohort.args, [procurementRules.lateFrom(), 1, '2026-07-01', '2026-09-30']);
  assert.doesNotMatch(cohort.sql, /price|amount|line_total/i, 'no price in the purchase flow');
  assert.equal(out.ready, true);
  assert.equal(out.receiptsReady, false);
  assert.equal(out.total, 2);
  assert.equal(out.stages.received, 1);
  assert.equal(out.stages.legacy, 1);
  assert.ok(out.steps.every((s) => s.medianDays === null && s.count === 0));
  assert.equal(out.onTime.pct, null);
  assert.deepEqual(out.stuck, [
    { state: 'late', count: 2, link: '/procurement?tab=orders&state=late' },
    { state: 'partial', count: 1, link: '/procurement?tab=orders&state=partial' },
    { state: 'legacy', count: 90, link: '/procurement?tab=orders&state=legacy' },
  ]);
});

test('purchaseFlow: with approved receipts, step times and "lengkap tepat waktu"', async (t) => {
  const calls = [];
  const base = serviceQuery(calls);
  t.mock.method(pool, 'query', async (sql, args) => (/AS po_ready/.test(sql) ? [[{ po_ready: 1, receipts_ready: 1 }]] : base(sql, args)));
  const out = await service.purchaseFlow(1, { from: '2026-07-01', to: '2026-09-30' });
  assert.equal(out.steps[0].medianDays, 3);
  assert.equal(out.steps[1].medianDays, 5);
  assert.deepEqual(out.onTime, { completed: 1, onTime: 1, pct: 100 });
});

test('the page service never touches the Accurate API or writes', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/services/managementFlow.service'), 'utf8');
  assert.doesNotMatch(src, /INSERT|UPDATE |DELETE|accurateSync|accurateClient|fetch\(/);
  assert.equal(typeof salesSource.numbersFromAccurate, 'function');
});
