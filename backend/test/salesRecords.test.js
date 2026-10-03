const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const numbers = require('../src/services/salesNumbers');
const records = require('../src/services/salesRecords.service');

// ------------------------------------------------------------------ numbers

test('new customer codes follow the Customer List format and continue its numbering', () => {
  const existing = ['PFN-PR-GT-JKT-0377', 'PFN-PR-HRC-TGR-0378', 'CS-1', null];
  assert.equal(numbers.customerCode({ legalForm: 'PT', channel: 'FoodService', cityCode: 'bks' }, existing), 'PFN-PT-HRC-BKS-0379');
  assert.equal(numbers.customerCode({ legalForm: 'XX', channel: 'Shopee', cityCode: '' }, []), 'PFN-PR-SHP-JKT-0001');
  assert.equal(numbers.channelCode('Lazada'), 'LAZ');
});

test('lead codes carry the month and continue the running number', () => {
  assert.equal(numbers.leadCode('2026-09-29', ['PFN-CS-260900360', 'CS-260900222']), 'PFN-CS-260900361');
  assert.equal(numbers.leadCode('2026-10-01', []), 'PFN-CS-261000001');
});

test('order numbers run per month across prefixes; DO and SI mirror the order', () => {
  const existing = ['SO64/HRC-PFN/IX/2026', 'SO12/SO-PFN/IX/2026', 'SO99/SO-PFN/VIII/2026', '11147'];
  assert.equal(numbers.orderNumber({ date: '2026-09-29', channel: 'GT' }, existing), 'SO65/SO-PFN/IX/2026');
  assert.equal(numbers.orderNumber({ date: '2026-09-29', channel: 'FoodService' }, existing), 'SO65/HRC-PFN/IX/2026');
  assert.equal(numbers.orderNumber({ date: '2026-10-02', channel: 'MT' }, existing), 'SO1/MT-PFN/X/2026');
  assert.equal(numbers.documentNumber('SO65/HRC-PFN/IX/2026', 'DO'), 'DO65/HRC-PFN/IX/2026');
  assert.equal(numbers.documentNumber('SO68/SO-PFN/VII/2026', 'SI'), 'SI68/SI-PFN/VII/2026');
  assert.equal(numbers.documentNumber('11147', 'DO'), 'DO-11147');
  assert.equal(numbers.orderChannelFor('Shopee'), 'e-Commerce');
  assert.equal(numbers.orderChannelFor('GOJEK'), 'QuickCommerce');
  assert.equal(numbers.orderChannelFor('FoodService'), 'FoodService');
});

test('order totals: goods plus delivery; PPN recorded on taxable lines; delivery owed on the first line', () => {
  const o = records.computeOrder([
    { productName: 'Abon 100g', qty: 10, unitPrice: 30000, taxable: true },
    { productName: 'Abon 250g', qty: 2, unitPrice: 70000.5 },
  ], 50000);
  assert.equal(o.subtotal, 440001);
  assert.equal(o.deliveryFee, 50000);
  assert.equal(o.totalAmount, 490001);
  assert.equal(o.taxAmount, 33000);
  assert.equal(o.dppAmount, 410271.27, '300000 / 1.11 + 140001 (non-taxable)');
  assert.deepEqual(o.lines.map((l) => [l.lineNo, l.lineTotal, l.deliveryFee, l.outstanding]), [
    [1, 300000, 50000, 350000], [2, 140001, 0, 140001],
  ]);
});

// ------------------------------------------------------------------ writes

// A connection double: answers by SQL pattern and records every statement.
function fakeConnection(handlers, calls) {
  const db = {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [re, value] of handlers) if (re.test(sql)) return typeof value === 'function' ? value(sql, args) : value;
      return [{ affectedRows: 1, insertId: 99 }];
    },
    beginTransaction: async () => { calls.push({ sql: 'BEGIN' }); },
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
  };
  return db;
}

const member = { sub: 32, entityId: 1, permissions: ['sales.order.manage'] };
const manager = { sub: 2, entityId: 1, permissions: ['sales.order.manage', 'sales.data.view_all'] };

test('a member cannot enter an order for someone else\'s customer', async (t) => {
  const calls = [];
  t.mock.method(pool, 'getConnection', async () => fakeConnection([[/FROM sales_customers x/, [[]]]], calls));
  await assert.rejects(
    () => records.createOrder(member, { customerId: 7, orderDate: '2026-09-29', lines: [{ productName: 'A', qty: 1, unitPrice: 1 }] }),
    (e) => e.status === 404,
  );
  const lookup = calls.find((c) => /FROM sales_customers x/.test(c.sql));
  assert.match(lookup.sql, /sales_owner_links/);
  assert.ok(lookup.args.includes(32));
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some((c) => /INSERT INTO sales_orders/.test(c.sql)));
});

test('a new order gets the next number, the division of its channel, and moves the customer\'s dates', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]); // activity log
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_customers x/, [[{ id: 7, name: 'Toko Uji', customer_code: 'PFN-PR-GT-JKT-0001', channel: 'Shopee', owner_user_id: 32 }]]],
    [/order_number LIKE/, [[{ n: 'SO64/HRC-PFN/IX/2026' }]]],
    [/SELECT id FROM sales_orders WHERE entity_id = \? AND order_number = \?/, [[]]],
    [/FROM users u JOIN departments d/, [[{ id: 32, name: 'Fajar Rizky Pratama' }]]],
    [/FROM departments WHERE/, [[{ id: 5, code: 'sales' }, { id: 8, code: 'retail_commerce' }]]],
    [/INSERT INTO sales_orders/, [{ insertId: 500 }]],
    [/sales_person_accounts/, [[]]],
    [/^\s*SELECT/, [[]]],
  ], calls));
  const result = await records.createOrder(manager, {
    customerId: 7, orderDate: '2026-09-28', deliveryDate: '2026-09-29',
    lines: [{ productName: 'Abon', qty: 2, unitPrice: 50000, taxable: true }], deliveryFee: 10000,
  });
  assert.deepEqual(result, { id: 500, orderNumber: 'SO65/SO-PFN/IX/2026' });
  const insert = calls.find((c) => /INSERT INTO sales_orders/.test(c.sql));
  assert.equal(insert.args[1], 8, 'a Shopee customer orders through e-Commerce → Retail Commerce');
  assert.equal(insert.args[6], 'e-Commerce');
  assert.equal(insert.args[11], '2026-09-29', 'transaction date follows ETD');
  assert.equal(insert.args[14], 90090.09, 'DPP = taxable goods / 1.11, before PPN, delivery excluded');
  assert.equal(insert.args[17], 110000, 'total billed = goods + delivery');
  assert.ok(calls.some((c) => /INSERT INTO sales_order_lines/.test(c.sql)));
  assert.ok(calls.some((c) => /UPDATE sales_customers c\s+LEFT JOIN/.test(c.sql)), 'customer status dates refreshed');
  assert.ok(calls.some((c) => c.sql === 'COMMIT'));
});

test('a member\'s new record always has them as PIC, whatever they ask for', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]);
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM users u JOIN departments d/, (sql, args) => [[{ id: args[0], name: 'Fajar' }]]],
    [/FROM sales_leads WHERE entity_id = \? FOR UPDATE/, [[{ code: 'PFN-CS-260900360' }]]],
    [/FROM departments WHERE/, [[{ id: 5, code: 'sales' }]]],
    [/INSERT INTO sales_leads/, [{ insertId: 70 }]],
    [/^\s*SELECT/, [[]]],
  ], calls));
  await records.createLead(member, { name: 'Kafe Baru', ownerUserId: 99 });
  const ownerLookup = calls.find((c) => /FROM users u JOIN departments d/.test(c.sql));
  assert.equal(ownerLookup.args[0], 32);
  const insert = calls.find((c) => /INSERT INTO sales_leads/.test(c.sql));
  assert.match(insert.args[2], /^PFN-CS-\d{4}00361$/);
  assert.equal(insert.args[9], 32);
});

test('an invoiced or paid order cannot be edited, a paid one cannot be cancelled', async (t) => {
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_orders x/, [[{ id: 5, customer_id: 7, invoice_numbers: 'SI1', settled_amount: '0', order_number: 'SO1' }]]],
  ], []));
  await assert.rejects(() => records.updateOrder(manager, 5, { notes: 'x' }), (e) => e.status === 409 && e.code === 'LOCKED');
  t.mock.restoreAll();
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_orders x/, [[{ id: 5, customer_id: 7, order_number: 'SO1', settled_amount: '1000' }]]],
  ], []));
  await assert.rejects(() => records.cancelOrder(manager, 5), (e) => e.status === 409);
});

test('a payment pays the lines down in order and never exceeds what is owed', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]);
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_orders x/, [[{ id: 5, outstanding_amount: '490000' }]]],
    [/FROM sales_order_lines WHERE order_id = \? ORDER BY line_no FOR UPDATE/, [[{ id: 1, due: '350000' }, { id: 2, due: '140000' }]]],
    [/INSERT INTO sales_order_payments/, [{ insertId: 3 }]],
  ], calls));
  await records.addPayment(manager, 5, { amount: 400000, paidAt: '2026-09-29' });
  const parts = calls.filter((c) => /UPDATE sales_order_lines SET outstanding_amount/.test(c.sql)).map((c) => [c.args[2], c.args[0]]);
  assert.deepEqual(parts, [[1, 350000], [2, 50000]]);
  assert.ok(calls.some((c) => /UPDATE sales_orders o\s+JOIN/.test(c.sql)), 'order totals follow the lines');

  t.mock.restoreAll();
  t.mock.method(pool, 'getConnection', async () => fakeConnection([[/FROM sales_orders x/, [[{ id: 5, outstanding_amount: '1000' }]]]], []));
  await assert.rejects(() => records.addPayment(manager, 5, { amount: 1000.01, paidAt: '2026-09-29' }), (e) => e.status === 400);
});

test('a customer with orders cannot be deleted', async (t) => {
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_customers x/, [[{ id: 7 }]]],
    [/COUNT\(\*\) AS n FROM sales_orders/, [[{ n: 4 }]]],
  ], []));
  await assert.rejects(() => records.deleteCustomer(manager, 7), (e) => e.status === 409 && e.code === 'HAS_ORDERS');
});
