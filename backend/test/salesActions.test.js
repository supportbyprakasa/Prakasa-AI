const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const notif = require('../src/services/notification.service');
const actions = require('../src/services/salesActions.service');
const targets = require('../src/services/salesTargets.service');
const reminders = require('../src/services/salesReminders.service');
const records = require('../src/services/salesRecords.service');

const member = { sub: 32, entityId: 1, permissions: ['sales.customer.view'] };
const manager = { sub: 2, entityId: 1, permissions: ['sales.customer.view', 'sales.data.view_all', 'sales.order.manage'] };

test('the to-do badge counts urgent work only — prospects to revisit are listed but not counted', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM sales_customers c/.test(sql)) return [[{ n: 12 }]];
    if (/do_numbers IS NULL/.test(sql)) return [[{ n: 3 }]];
    if (/due_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/.test(sql)) return [[{ n: 2 }]];
    if (/FROM sales_leads l/.test(sql)) return [[{ n: 192 }]];
    return [[{ n: 0 }]];
  });
  const { counts, badge } = await actions.counts(manager);
  assert.deepEqual(counts, { dormant: 12, no_do: 3, overdue: 2, leads: 192 });
  assert.equal(badge, 17);
});

test('a member\'s to-do list holds only their own records', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [/COUNT/.test(sql) ? [{ n: 0 }] : []]; });
  await actions.counts(member);
  for (const type of Object.keys(actions.TYPES)) await actions.list(member, type, { page: 1, limit: 25, offset: 0, q: '' });
  for (const { sql, args } of calls.filter((c) => !/FROM sales_accurate_batches/.test(c.sql))) {
    assert.match(sql, /sales_owner_links k WHERE k\.record_type = '(customer|order|lead)'/, sql.split('\n')[0]);
    assert.equal(args[0], 1);
    assert.ok(args.includes(32));
  }
  const noDo = calls.find((c) => /do_numbers IS NULL/.test(c.sql) && /LIMIT/.test(c.sql));
  assert.match(noDo.sql, new RegExp(`INTERVAL ${actions.SHIP_WINDOW_DAYS} DAY`), 'old imported orders are not a to-do');
});

test('targets: a member sees only their own row; progress is actual over target', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM users u JOIN departments d/.test(sql)) return [[{ id: 32, name: 'Fajar', departmentName: 'Sales' }]];
    if (/FROM sales_person_targets/.test(sql)) return [[{ user_id: 32, revenue_target: '10000000', noo_target: 4 }]];
    if (/SUM\(o\.dpp_amount\)/.test(sql)) return [[{ user_id: 32, orders: 5, revenue: '7500000' }]];
    if (/c\.noo_date BETWEEN/.test(sql)) return [[{ user_id: 32, n: 1 }]];
    return [[]];
  });
  const result = await targets.listTargets(member, '2026-09');
  assert.equal(result.month, '2026-09');
  assert.deepEqual(result.rows[0], {
    userId: 32, name: 'Fajar', departmentName: 'Sales', linked: true, orders: 5,
    revenueActual: 7500000, revenueTarget: 10000000, revenuePct: 75,
    nooActual: 1, nooTarget: 4, nooPct: 25,
  });
  assert.match(calls[0].sql, /AND u\.id = \?/);
  assert.deepEqual(calls[0].args, [1, 32]);
  const revenue = calls.find((c) => /SUM\(o\.dpp_amount\)/.test(c.sql));
  assert.deepEqual(revenue.args.slice(-2), ['2026-09-01', '2026-09-30']);
  await assert.rejects(() => targets.listTargets(member, '2026-13'), (e) => e.status === 400);
});

function fakeConnection(handlers, calls) {
  return {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [re, value] of handlers) if (re.test(sql)) return typeof value === 'function' ? value(sql, args) : value;
      return [{ affectedRows: 1, insertId: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
}

test('an invoice gets its due date from the payment terms, fixed at invoicing', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]);
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_orders x/, [[{ id: 5, order_number: 'SO65/HRC-PFN/IX/2026' }]]],
    [/FROM sales_order_lines l JOIN sales_orders o/, [[]]],
    [/payment_terms_days/, [[{ days: 14 }]]],
  ], calls));
  await records.setDocument(manager, 5, 'SI', { date: '2026-09-30' });
  const due = calls.find((c) => /SET due_date = \?/.test(c.sql));
  assert.equal(due.args[0], '2026-10-14');

  calls.length = 0;
  await records.setDocument(manager, 5, 'SI', { date: '2026-09-30', dueDate: '2026-10-30' });
  assert.equal(calls.find((c) => /SET due_date = \?/.test(c.sql)).args[0], '2026-10-30', 'a date chosen by hand wins');
  await assert.rejects(() => records.setDocument(manager, 5, 'SI', { date: '2026-09-30', dueDate: '2026-09-01' }), (e) => e.status === 400);
});

test('late invoices remind their PIC, or the division supervisors when nobody owns them', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM sales_orders o/.test(sql)) {
      return [[
        { id: 7, orderNumber: 'SO1', invoiceNumber: 'SI1', customerName: 'Toko A', departmentId: 5, outstanding: '500000', dueDate: '2026-09-20', days: 9, kind: 'overdue' },
        { id: 8, orderNumber: 'SO2', invoiceNumber: 'SI2', customerName: 'Toko B', departmentId: 5, outstanding: '900000', dueDate: '2026-08-01', days: 59, kind: 'overdue_30' },
      ]];
    }
    if (/FROM sales_owner_links k/.test(sql)) return [[{ orderId: 7, userId: 32 }]];
    if (/sales\.master\.manage/.test(sql)) return [[{ userId: 15, departmentId: 5 }]];
    return [[]];
  });
  const create = t.mock.method(notif, 'create', async () => ({}));
  const plan = await reminders.runInvoices(1, { dryRun: true });
  assert.deepEqual(plan.notes.map((n) => [n.userId, n.orderId, n.kind]), [[32, 7, 'overdue'], [15, 8, 'overdue_30']]);
  assert.match(plan.notes[1].title, /terlambat 59 hari/);
  assert.match(plan.notes[0].body, /sisa Rp 500\.000/);
  assert.equal(create.mock.callCount(), 0, 'a dry run sends nothing');
});

test('a salesperson is notified when someone else makes them PIC — never about their own records', async (t) => {
  const sent = [];
  t.mock.method(notif, 'create', async (n) => { sent.push(n); return {}; });
  t.mock.method(pool, 'query', async () => [{ insertId: 1 }]);
  const leadDb = (ownerId) => fakeConnection([
    [/FROM users u JOIN departments d/, [[{ id: ownerId, name: 'Fajar' }]]],
    [/FROM sales_leads WHERE entity_id = \? FOR UPDATE/, [[]]],
    [/FROM departments WHERE/, [[{ id: 5, code: 'sales' }]]],
    [/INSERT INTO sales_leads/, [{ insertId: 70 }]],
    [/^\s*SELECT/, [[]]],
  ], []);
  t.mock.method(pool, 'getConnection', async () => leadDb(32));
  await records.createLead(manager, { name: 'Kafe Baru', ownerUserId: 32 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, 32);
  assert.equal(sent[0].event, 'sales.assigned');
  assert.equal(sent[0].actionUrl, '/sales/leads?lead=70');

  sent.length = 0;
  await records.createLead({ ...manager, sub: 32 }, { name: 'Kafe Sendiri', ownerUserId: 32 });
  assert.equal(sent.length, 0);
});
