const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const dataCtrl = require('../src/controllers/salesData.controller');
const ordersCtrl = require('../src/controllers/salesOrders.controller');
const leadsCtrl = require('../src/controllers/salesLeads.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const viewer = { sub: 2, entityId: 1, permissions: ['sales.customer.view', 'sales.order.view', 'sales.data.view_all'] };
const member = { sub: 32, entityId: 1, permissions: ['sales.customer.view', 'sales.order.view', 'sales.pipeline.view'] };

async function call(handler, req) {
  const res = responseDouble();
  await handler({ query: {}, params: {}, body: {}, ...req }, res, (e) => { throw e; });
  return res;
}

const fakeRows = async (sql) => [[/COUNT|SUM\(/.test(sql) ? { n: 0, total: 0, orders: 0 } : {}]];

test('every Sales list pages on the server with LIMIT/OFFSET and reports the total', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return fakeRows(sql); });
  const query = { page: '2', limit: '25' };
  for (const [handler, extra] of [
    [ordersCtrl.listOrders, {}], [ordersCtrl.listDocuments, { type: 'invoice' }],
    [ordersCtrl.listProducts, {}], [leadsCtrl.listLeads, { status: 'all' }], [dataCtrl.funnel, { stage: 'lost' }],
  ]) {
    calls.length = 0;
    const res = await call(handler, { user: viewer, query: { ...query, ...extra } });
    assert.equal(res.statusCode, 200, handler.name);
    assert.equal(res.body.meta.page, 2);
    assert.equal(res.body.meta.limit, 25);
    assert.equal(typeof res.body.meta.total, 'number');
    const page = calls.find((c) => /LIMIT \? OFFSET \?/.test(c.sql));
    assert.ok(page, 'one query is paged');
    assert.deepEqual(page.args.slice(-2), [25, 25]);
  }
});

test('every Sales read is bound to the caller\'s entity', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return fakeRows(sql); });
  await call(dataCtrl.overview, { user: viewer });
  await call(ordersCtrl.listOrders, { user: viewer, query: { from: '2026-09-01', status: 'unpaid', q: 'SO64' } });
  await call(ordersCtrl.listDocuments, { user: viewer, query: { type: 'do' } });
  await call(leadsCtrl.listLeads, { user: viewer, query: { status: 'all' } });
  await call(dataCtrl.funnel, { user: viewer });
  for (const { sql, args } of calls.filter((c) => /FROM sales_(customers|orders|leads|order_lines)/.test(c.sql))) {
    assert.match(sql, /entity_id = \?/, sql.split('\n')[0]);
    assert.equal(args[0], 1, sql.split('\n')[0]);
  }
});

test('a Sales member sees only their own customers, leads and orders', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return fakeRows(sql); });
  await call(dataCtrl.overview, { user: member });
  await call(ordersCtrl.listOrders, { user: member });
  await call(ordersCtrl.listDocuments, { user: member, query: { type: 'invoice' } });
  await call(leadsCtrl.listLeads, { user: member, query: { status: 'all' } });
  await call(dataCtrl.funnel, { user: member, query: { stage: 'prospek' } });
  await call(dataCtrl.funnel, { user: member, query: { stage: 'aktif' } });
  await call(ordersCtrl.orderDetail, { user: member, params: { id: '9' } });
  const data = calls.filter((c) => /FROM sales_(customers|orders|leads) [clo]\b/.test(c.sql));
  assert.ok(data.length >= 10);
  for (const { sql, args } of data) {
    assert.match(sql, /sales_owner_links k WHERE k\.record_type = '(customer|order|lead)'/, sql.split('\n')[0]);
    assert.ok(args.includes(32), sql.split('\n')[0]);
  }
  assert.ok(!calls.some((c) => /GROUP BY name/.test(c.sql)), 'the per-salesperson table is for those who see everyone');
});

test('revenue and receivables are left out for someone without sales.order.view', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ total: 3, aktif: 1 }]]; });
  const res = await call(dataCtrl.overview, { user: { ...viewer, permissions: ['sales.customer.view', 'sales.data.view_all'] } });
  assert.equal(res.body.data.sales, null);
  assert.ok(!calls.some((c) => /FROM sales_orders/.test(c.sql)), 'orders are not even read');
});

test('list filters are validated, never passed through', async (t) => {
  t.mock.method(pool, 'query', fakeRows);
  for (const query of [{ from: '1 Sept' }, { to: '2026-9-1' }, { status: 'semua' }, { customerId: 'x' }]) {
    assert.equal((await call(ordersCtrl.listOrders, { user: viewer, query })).statusCode, 400, JSON.stringify(query));
  }
  assert.equal((await call(ordersCtrl.listDocuments, { user: viewer, query: { type: 'kwitansi' } })).statusCode, 400);
  assert.equal((await call(leadsCtrl.listLeads, { user: viewer, query: { status: 'hot' } })).statusCode, 400);
});

test('an order or lead of another entity is not found', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[]]; });
  assert.equal((await call(ordersCtrl.orderDetail, { user: viewer, params: { id: '9' } })).statusCode, 404);
  assert.deepEqual(calls[0].args.slice(0, 2), [9, 1]);
  assert.equal((await call(leadsCtrl.leadDetail, { user: viewer, params: { id: '4' } })).statusCode, 404);
});

test('the funnel counts every stage and pages the chosen one', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/GROUP BY x\.stage/.test(sql)) return [[{ stage: 'dormant', n: 12 }, { stage: 'aktif', n: 24 }, { stage: 'lost', n: 202 }]];
    if (/FROM sales_leads l WHERE/.test(sql) && /COUNT/.test(sql)) return [[{ n: 312 }]];
    if (/COUNT\(\*\) AS n FROM sales_customers/.test(sql)) return [[{ n: 12 }]];
    if (/FROM sales_customers c WHERE/.test(sql)) return [[{ id: 2, name: 'B', daysSinceOrder: 58 }, { id: 1, name: 'A', daysSinceOrder: 35 }]];
    return [[]];
  });
  const res = await call(dataCtrl.funnel, { user: viewer, query: { stage: 'dormant' } });
  const { stages, stage, items } = res.body.data;
  assert.deepEqual(stages.map((s) => [s.key, s.count]), [
    ['prospek', 312], ['belum_order', 0], ['order_pertama', 0], ['aktif', 24], ['dormant', 12], ['lost', 202],
  ]);
  assert.equal(stage, 'dormant');
  assert.deepEqual(items.map((i) => i.id), [2, 1]);
  assert.equal(res.body.meta.total, 12);
});
