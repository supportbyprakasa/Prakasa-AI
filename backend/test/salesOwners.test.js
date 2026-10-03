const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const notif = require('../src/services/notification.service');
const owners = require('../src/services/salesOwners.service');
const reminders = require('../src/services/salesReminders.service');

const users = [
  { id: 32, name: 'Fajar Rizky Pratama' },
  { id: 24, name: 'Muhammad Aris' },
  { id: 30, name: 'Windy Kresna' },
  { id: 40, name: 'Selin Kusno' },
  { id: 41, name: 'Aris Setiawan' },
];

test('a salesperson field with several people is split per person', () => {
  assert.deepEqual(owners.splitNames('Liani / Windy'), ['Liani', 'Windy']);
  assert.deepEqual(owners.splitNames('Aleng, Ruly & Sella'), ['Aleng', 'Ruly', 'Sella']);
  assert.deepEqual(owners.splitNames('Budi Rajasa'), ['Budi Rajasa']);
  assert.deepEqual(owners.splitNames(null), []);
});

test('a suggestion is only offered when exactly one account fits', () => {
  assert.equal(owners.suggestUser('Fajar', users), 32);
  assert.equal(owners.suggestUser('Windy', users), 30);
  assert.equal(owners.suggestUser('Muhammad Aris', users), 24, 'full name wins over the other Aris');
  assert.equal(owners.suggestUser('Aris', users), null, 'two accounts named Aris: a person decides');
  assert.equal(owners.suggestUser('Sella', users), null, 'Selin is not Sella');
});

test('everyone with view_all sees all; others only what is linked to them', () => {
  assert.deepEqual(owners.ownScope({ sub: 2, permissions: ['sales.data.view_all'] }, 'customer', 'c.id'), { sql: '', args: [] });
  const s = owners.ownScope({ sub: 32, permissions: ['sales.customer.view'] }, 'order', 'o.id');
  assert.match(s.sql, /^ AND EXISTS \(SELECT 1 FROM sales_owner_links k WHERE k\.record_type = 'order' AND k\.record_id = o\.id AND k\.user_id = \?\)$/);
  assert.deepEqual(s.args, [32]);
  assert.deepEqual(owners.ownScope({ permissions: [] }, 'lead', 'l.id').args, [0], 'no user id never matches anyone');
  assert.throws(() => owners.ownScope({ sub: 1 }, 'invoice', 'x.id'));
});

test('ownership follows the mapped names; orders without a salesperson follow their customer', async () => {
  const inserted = [];
  const db = {
    async query(sql, args) {
      if (/FROM sales_person_accounts/.test(sql)) return [[{ name: 'Liani', userId: 33 }, { name: 'windy', userId: 30 }, { name: 'Fajar', userId: 32 }]];
      if (/FROM sales_orders/.test(sql)) {
        return [[
          { id: 10, name: null, ownerUserId: null, customerName: 'Liani / Windy', customerOwner: null },
          { id: 11, name: 'Fajar', ownerUserId: null, customerName: 'Aleng', customerOwner: null },
          { id: 12, name: null, ownerUserId: null, customerName: 'Aleng', customerOwner: null },
          { id: 13, name: null, ownerUserId: 41, customerName: 'Aleng', customerOwner: null },
        ]];
      }
      if (/FROM sales_customers/.test(sql)) return [[{ id: 1, name: 'Liani / Windy', ownerUserId: null }, { id: 2, name: 'Aleng', ownerUserId: null }, { id: 3, name: null, ownerUserId: 41 }]];
      if (/FROM sales_leads/.test(sql)) return [[{ id: 20, name: 'Fajar', ownerUserId: null }]];
      if (/INSERT IGNORE INTO sales_owner_links/.test(sql)) inserted.push(...args[0]);
      return [{ affectedRows: 0 }];
    },
  };
  const count = await owners.refreshLinks(db, 1);
  const set = new Set(inserted.map(([, type, id, user]) => `${type}:${id}:${user}`));
  assert.deepEqual([...set].sort(), [
    'customer:1:30', 'customer:1:33', // both people of "Liani / Windy", case-insensitive
    'lead:20:32',
    'order:10:30', 'order:10:33', // e-Commerce style order: its customer's owners
    'order:11:32',
    'customer:3:41', 'order:13:41', // entered in the app: the PIC account owns it directly
  ].sort());
  assert.equal(count, 8, 'Aleng has no account, so customer 2 and its unnamed order 12 belong to nobody');
  assert.ok(inserted.every((row) => row[0] === 1), 'every link carries the entity');
});

const dormantRows = [
  { id: 1, name: 'OLSE', code: 'C1', departmentId: 5, lastOrderDate: '2026-08-01', days: 59, kind: 'near_lost' },
  { id: 2, name: 'Kopi A', code: 'C2', departmentId: 5, lastOrderDate: '2026-08-29', days: 31, kind: 'dormant' },
];

function reminderDb(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: 0 }]];
    if (/FROM sales_customers c/.test(sql)) return [dormantRows];
    if (/FROM sales_owner_links k/.test(sql)) return [[{ customerId: 2, userId: 32 }]];
    if (/sales\.master\.manage/.test(sql)) return [[{ userId: 15, departmentId: 5 }]];
    return [{ affectedRows: 1 }];
  };
}

test('a dry run plans reminders without sending or recording anything', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', reminderDb(calls));
  const create = t.mock.method(notif, 'create', async () => ({}));
  const plan = await reminders.run(1, { dryRun: true });
  assert.equal(plan.due, 2);
  assert.deepEqual(plan.direct.map((n) => [n.userId, n.customerId, n.kind]), [[32, 2, 'dormant']]);
  assert.equal(plan.digests.length, 1);
  assert.equal(plan.digests[0].userId, 15, 'the unmapped customer goes to the division supervisor');
  assert.match(plan.digests[0].body, /OLSE.*1 hampir Lost/);
  assert.equal(create.mock.callCount(), 0);
  assert.ok(!calls.some((c) => /INSERT/.test(c.sql)));
});

test('sending notifies owners and supervisors once, and records every reminder', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', reminderDb(calls));
  const sent = [];
  t.mock.method(notif, 'create', async (n) => { sent.push(n); return {}; });
  const result = await reminders.run(1);
  assert.deepEqual(result, { due: 2, direct: 1, digests: 1 });
  assert.equal(sent[0].userId, 32);
  assert.equal(sent[0].event, 'sales.customer_dormant');
  assert.equal(sent[0].actionUrl, '/sales/customers/2');
  assert.match(sent[0].title, /mulai dormant/);
  assert.equal(sent[1].userId, 15);
  const recorded = calls.filter((c) => /INSERT IGNORE INTO sales_reminders/.test(c.sql)).map((c) => [c.args[1], c.args[3]]);
  assert.deepEqual(recorded, [[1, 'near_lost'], [2, 'dormant']]);
  // Already-reminded customers are excluded in SQL, per last order and kind.
  const dueQuery = calls.find((c) => /FROM sales_customers c/.test(c.sql));
  assert.match(dueQuery.sql, /NOT EXISTS \(\s*SELECT 1 FROM sales_reminders r/);
});
