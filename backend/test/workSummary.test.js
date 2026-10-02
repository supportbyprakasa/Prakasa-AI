const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const ctrl = require('../src/controllers/workSummary.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const baseUser = (permissions = []) => ({ sub: 10, entityId: 1, departmentId: 9, permissions });

function mockDb(t, handler) {
  const seen = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const text = String(sql);
    seen.push(text);
    return handler(text, args) || [[{ c: 0 }]];
  });
  return seen;
}

test('a user with no module permissions only gets notifications, and no module table is queried', async (t) => {
  const seen = mockDb(t, (sql) => {
    if (sql.includes('FROM notifications') && sql.includes('COUNT')) return [[{ c: 2 }]];
    if (sql.includes('FROM notifications')) return [[{ id: 1, title: 'Halo', action_url: '/x', is_read: 0, created_at: new Date() }]];
    return null;
  });
  const res = responseDouble();
  await ctrl.summary({ user: baseUser([]) }, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.cards, []);
  assert.equal(res.body.data.notifications.unread, 2);
  // Own onboarding/offboarding checklist tasks are the exception: a manager in
  // another division has no HRGA permission but still gets their tasks (wave 2, P6).
  const ownTasks = (sql) => sql.includes('FROM hrga_workflow_tasks t') && sql.includes('t.responsible_user_id=?');
  assert.ok(seen.every((sql) => sql.includes('notifications') || ownTasks(sql)), 'no module table may be queried without permission');
});

test('cards with a zero count are dropped and items carry a working deep link', async (t) => {
  mockDb(t, (sql) => {
    if (sql.includes('COUNT(*) AS c FROM it_tickets') && sql.includes("waiting_on_user")) return [[{ c: 1 }]];
    if (sql.includes('FROM it_tickets') && sql.includes('LIMIT')) return [[{ id: 42, title: 'Laptop mati', priority: 'high', updated_at: new Date() }]];
    if (sql.includes('FROM notifications') && sql.includes('COUNT')) return [[{ c: 0 }]];
    if (sql.includes('FROM notifications')) return [[]];
    return null;
  });
  const res = responseDouble();
  await ctrl.summary({ user: baseUser(['it_ticket.view']) }, res, (e) => { throw e; });

  const { cards } = res.body.data;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, 'it_waiting');
  assert.equal(cards[0].group, 'action');
  assert.equal(cards[0].items[0].to, '/it/tickets/42');
});

test('a failing module is dropped without blanking the whole summary', async (t) => {
  mockDb(t, (sql) => {
    if (sql.includes('FROM it_tickets')) throw new Error('boom');
    if (sql.includes('FROM finance_workflows') && sql.includes("requested_by=?") && sql.includes("'draft','revision_requested'") && sql.includes('COUNT')) return [[{ c: 1 }]];
    if (sql.includes('FROM finance_workflows') && sql.includes('LIMIT')) return [[{ id: 5, title: 'Bayar vendor', request_number: 'PR-1', status: 'draft', updated_at: new Date() }]];
    if (sql.includes('FROM notifications') && sql.includes('COUNT')) return [[{ c: 0 }]];
    if (sql.includes('FROM notifications')) return [[]];
    return null;
  });
  const res = responseDouble();
  await ctrl.summary({ user: baseUser(['it_ticket.view', 'finance.view']) }, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.cards.map((c) => c.key), ['finance_revise']);
});

test('warehouse approval needs both approve permissions and a home department', async (t) => {
  const seen = mockDb(t, (sql) => {
    if (sql.includes('FROM notifications') && sql.includes('COUNT')) return [[{ c: 0 }]];
    if (sql.includes('FROM notifications')) return [[]];
    return null;
  });
  const res = responseDouble();
  await ctrl.summary({ user: baseUser(['warehouse.movement.view', 'warehouse.movement.approve']) }, res, (e) => { throw e; });
  assert.ok(!seen.some((sql) => sql.includes("status='pending_approval'") && sql.includes('warehouse_')), 'approval query must not run without approval.decide');
});
