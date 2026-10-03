const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const facts = require('../src/services/salesFacts');
const actions = require('../src/services/salesActions.service');
const ordersCtrl = require('../src/controllers/salesOrders.controller');
const dataCtrl = require('../src/controllers/salesData.controller');

// Tahap B: once an Accurate batch is approved, the Sales numbers read the
// approved Accurate views; before that, the old recap. Nothing here writes.

const manager = { sub: 2, entityId: 1, permissions: ['sales.customer.view', 'sales.order.view', 'sales.data.view_all', 'sales.pipeline.view'] };
const member = { sub: 32, entityId: 1, permissions: ['sales.customer.view', 'sales.order.view'] };

function db(t, { approved }) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: approved ? 1 : 0 }]];
    // One empty row: enough for single-row reads and for lists alike.
    return [[{ n: 0, total: 0 }]];
  });
  return calls;
}

const writes = (calls) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));

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

test('before any approved batch the numbers stay on the recap; after, on approved Accurate invoices', async (t) => {
  db(t, { approved: false });
  const before = await facts.factsFor(manager);
  assert.equal(before.accurate, false);
  assert.equal(before.customers, 'sales_customers');
  t.mock.restoreAll();
  db(t, { approved: true });
  const after = await facts.factsFor(manager);
  assert.equal(after.accurate, true);
  assert.match(after.facts, /FROM sales_invoices_accurate i/);
  assert.equal(after.customers, 'sales_customers_accurate');
  assert.equal(after.unit, 'faktur');
});

test('a member sees their Accurate invoices by mapped salesperson or owned customer; managers see all', () => {
  assert.deepEqual(facts.accurateScope(manager, 'i'), { sql: '', args: [] });
  const own = facts.accurateScope(member, 'i');
  assert.match(own.sql, /sales_person_accounts pa/);
  assert.match(own.sql, /sales_owner_links k/);
  assert.deepEqual(own.args, [32, 32]);
  const soOnly = facts.accurateScope(member, 's', { salesman: false });
  assert.doesNotMatch(soOnly.sql, /sales_person_accounts/, 'Accurate SOs carry no salesperson');
});

test('Pipeline overview reads invoice DPP and invoice-based customer dates, and writes nothing', async (t) => {
  const calls = db(t, { approved: true });
  const res = await run(dataCtrl.overview, { user: manager, query: {} });
  assert.equal(res.body.data.source, 'accurate');
  assert.equal(res.body.data.sales.unit, 'faktur');
  const sqls = calls.map((c) => c.sql).join('\n');
  assert.match(sqls, /FROM sales_customers_accurate c/);
  assert.match(sqls, /FROM sales_invoices_accurate i\)/);
  assert.doesNotMatch(sqls, /FROM sales_orders o/, 'the old recap is not used for numbers any more');
  assert.deepEqual(writes(calls), []);
});

test('Perlu tindakan reads Accurate: unshipped SOs and late invoices', async (t) => {
  const calls = db(t, { approved: true });
  await actions.counts(member);
  const sqls = calls.map((c) => c.sql).join('\n');
  assert.match(sqls, /FROM sales_so_accurate s WHERE s\.entity_id = \?.*s\.percent_shipped < 100/s);
  assert.match(sqls, /FROM sales_invoices_accurate i WHERE i\.entity_id = \?.*i\.due_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/s);
  assert.match(sqls, /FROM sales_customers_accurate c/);
  assert.deepEqual(writes(calls), []);
});

test('Data Sales lists Accurate SOs, invoices, delivery orders, receipts, returns and products', async (t) => {
  const calls = db(t, { approved: true });
  const so = await run(ordersCtrl.listOrders, { user: manager, query: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(so.body.meta.source, 'accurate');
  assert.ok(calls.some((c) => /FROM sales_so_accurate s/.test(c.sql)));
  // The SO tab's footnote sums the SOs listed (Nilai SO = their DPP); the invoice tab, the invoices.
  assert.ok(calls.some((c) => /SUM\(s\.dpp_amount\) AS revenue[\s\S]*FROM sales_so_accurate s/.test(c.sql)), 'Nilai SO from SO DPP');
  assert.ok(calls.some((c) => /SUM\(s\.dpp_amount\)[\s\S]*NOT li\.is_dp/.test(c.sql)), 'piutang of the SOs leaves down payments out');
  const inv = await run(ordersCtrl.listDocuments, { user: manager, query: { type: 'invoice' } });
  assert.equal(inv.body.meta.source, 'accurate');
  for (const [type, view] of [['do', 'sales_do_accurate'], ['receipt', 'sales_receipts_accurate'], ['return', 'sales_returns_accurate']]) {
    const docs = await run(ordersCtrl.listDocuments, { user: member, query: { type } });
    assert.equal(docs.body.meta.source, 'accurate', type);
    const q = calls.find((c) => new RegExp(`FROM ${view} d WHERE`).test(c.sql) && /LIMIT/.test(c.sql));
    assert.ok(q, `${type} reads ${view}`);
    assert.match(q.sql, /sales_owner_links k/, 'a member sees only the documents of customers they own');
  }
  const products = await run(ordersCtrl.listProducts, { user: manager, query: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(products.body.meta.source, 'accurate');
  assert.ok(calls.some((c) => /FROM sales_items_accurate p/.test(c.sql) && /FROM sales_invoice_lines_accurate l/.test(c.sql)), 'revenue per product from invoice lines');
  const productSql = calls.find((c) => /FROM sales_items_accurate p/.test(c.sql) && /LIMIT/.test(c.sql)).sql;
  assert.match(productSql, /GROUP BY l\.item_code, l\.unit/, 'quantities are summed per unit');
  assert.doesNotMatch(productSql, /SUM\(l\.qty\) AS qty[^)]*GROUP BY l\.item_code\)/, 'cartons and packs are never added up');
  const formProducts = await run(ordersCtrl.listProducts, { user: manager, query: { customerId: '7' } });
  assert.equal(formProducts.body.meta.source, undefined, 'the order form keeps the app\'s own product list');
  assert.deepEqual(writes(calls), []);
});

test('with Accurate, the badge counts invoices that fell due in the last 30 days — older ones stay listed', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: 1 }]];
    if (/FROM sales_invoices_accurate i/.test(sql) && /DATEDIFF\(DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), i\.due_date\) <= 30/.test(sql)) return [[{ n: 7 }]];
    if (/FROM sales_invoices_accurate i/.test(sql)) return [[{ n: 618 }]];
    if (/FROM sales_customers_accurate c/.test(sql)) return [[{ n: 13 }]];
    if (/FROM sales_so_accurate s/.test(sql)) return [[{ n: 8 }]];
    return [[{ n: 192 }]];
  });
  const { counts, badge } = await actions.counts(manager);
  assert.equal(counts.overdue, 618);
  assert.equal(badge, 13 + 8 + 7);
});

test('only an approved Sales or Retail Commerce batch switches Sales to Accurate', async (t) => {
  const source = require('../src/services/salesSource');
  const calls = db(t, { approved: true });
  assert.equal(await source.accurateConnected(1), true);
  const q = calls.find((c) => /FROM sales_accurate_batches b/.test(c.sql));
  assert.match(q.sql, /JOIN departments d ON d\.id = b\.department_id/);
  assert.match(q.sql, /d\.code IN \(\?\)/);
  assert.deepEqual(q.args, [1, ['sales', 'retail_commerce']], 'a Warehouse or Finance batch does not count');
});

test('unitQuantities keeps each unit apart, largest first, and drops empty units', () => {
  const { unitQuantities } = require('../src/services/salesQuery');
  assert.deepEqual(unitQuantities('[{"unit":"TetraPk","qty":"411.000"},{"unit":"Ctns","qty":"6000.000"},{"unit":"Pcs","qty":"0"}]'),
    [{ unit: 'Ctns', qty: 6000 }, { unit: 'TetraPk', qty: 411 }]);
  assert.deepEqual(unitQuantities([{ unit: null, qty: 2 }]), [{ unit: '', qty: 2 }]);
  assert.deepEqual(unitQuantities(null), []);
});
