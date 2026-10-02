const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const ctrl = require('../src/controllers/salesCustomers.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const user = { sub: 2, entityId: 1, permissions: ['sales.customer.view', 'sales.data.view_all'] };
const run = async (handler, req) => {
  const res = responseDouble();
  await handler({ query: {}, params: {}, body: {}, ...req }, res, (e) => { throw e; });
  return res;
};

test('customer detail is scoped to the caller\'s entity and only summarises the paged lists', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_customers c/.test(sql)) return [[{ id: 7, entity_id: 1, name: 'Toko Kopi Sejahtera' }]];
    return [[{ n: 3, total: '100', outstanding: '0' }]];
  });
  const res = await run(ctrl.detail, { user, params: { id: '7' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.data).sort(), ['customer', 'summary']);
  assert.equal(res.body.data.summary.visits, 3);
  assert.equal(res.body.data.summary.orders, null, 'no sales.order.view, no order figures');
  assert.ok(!calls.some((c) => /FROM sales_orders/.test(c.sql)));
  for (const c of calls) {
    assert.match(c.sql, /entity_id = \?/);
    assert.ok(c.args.includes(1));
  }
});

test('a customer of another entity, or a malformed id, is refused', async (t) => {
  const query = t.mock.method(pool, 'query', async () => [[]]);
  assert.equal((await run(ctrl.detail, { user, params: { id: '7' } })).statusCode, 404);
  const before = query.mock.callCount();
  assert.equal((await run(ctrl.detail, { user, params: { id: 'abc' } })).statusCode, 400);
  assert.equal(query.mock.callCount(), before, 'no query for a malformed id');
});

test('the customer list pages on the server and searches there', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return [/COUNT\(\*\) AS total/.test(sql) ? [{ total: 378 }] : /FROM sales_accurate_batches/.test(sql) ? [{ n: 0 }] : []];
  });
  const res = await run(ctrl.list, { user, query: { page: '3', limit: '50', q: '50%_off', status: 'dormant' } });
  calls.splice(0, calls.length, ...calls.filter((c) => !/FROM sales_accurate_batches/.test(c.sql)));
  assert.equal(res.statusCode, 200);
  assert.deepEqual({ page: res.body.meta.page, limit: res.body.meta.limit, total: res.body.meta.total }, { page: 3, limit: 50, total: 378 });
  const list = calls[0];
  assert.match(list.sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(list.args.slice(-2), [50, 100]);
  assert.ok(list.args.includes('%50\\%\\_off%'), 'the search text is matched literally');
  assert.ok(res.body.meta.channels.includes('FoodService'));
});

test('the page size is capped so one request never loads everything', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ total: 0 }]]; });
  await run(ctrl.list, { user, query: { limit: '5000' } });
  const list = calls.find((c) => /LIMIT \? OFFSET \?/.test(c.sql));
  assert.equal(list.args.at(-2), 100);
});

test('a Sales member without view_all only reaches the customers linked to them', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [/COUNT\(\*\) AS total/.test(sql) ? [{ total: 0 }] : []]; });
  const member = { sub: 32, entityId: 1, permissions: ['sales.customer.view', 'sales.customer.manage'] };
  await run(ctrl.list, { user: member });
  const res = await run(ctrl.detail, { user: member, params: { id: '7' } });
  assert.equal(res.statusCode, 404, 'someone else\'s customer is not found');
  const scoped = calls.filter((c) => /FROM sales_customers c/.test(c.sql));
  assert.ok(scoped.length >= 3);
  for (const c of scoped) {
    assert.match(c.sql, /sales_owner_links k WHERE k\.record_type = 'customer' AND k\.record_id = c\.id AND k\.user_id = \?/);
    assert.ok(c.args.includes(32));
  }
});
