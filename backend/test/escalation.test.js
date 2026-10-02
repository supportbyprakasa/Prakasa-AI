const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const escalation = require('../src/services/escalation.service');
const ctrl = require('../src/controllers/managementDashboard.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const overdueIssue = {
  id: 11, title: 'Stok opname gudang A', project_key: 'CEK', issue_number: 1,
  project_name: 'Cek Task', department_id: 6, department_name: 'People & Culture',
  owner_name: 'Muhammad Wahyudi', days_late: 3, since: '2026-09-25',
};
const staleIssue = {
  id: 12, title: 'Migrasi data supplier', project_key: 'CEK', issue_number: 4,
  project_name: 'Cek Task', department_id: 6, department_name: 'People & Culture',
  owner_name: null, days_late: 21, since: '2026-09-07T00:00:00Z',
};
const agedApproval = {
  id: 3, title: 'Barang Keluar UJI-OUT-001', status: 'pending', department_id: 9,
  department_name: 'Warehouse', owner_name: 'Budi', created_at: '2026-09-24T11:06:32Z', days_late: 4,
};

// Answers every query the service makes. `calls` records the SQL so a test can
// assert the division filter reached the database instead of being applied later.
function fakeQuery(calls, { followups = [] } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM tasks t/.test(sql) && /due_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/.test(sql)) return [[overdueIssue]];
    if (/FROM tasks t/.test(sql) && /INTERVAL 14 DAY/.test(sql)) return [[staleIssue]];
    if (/FROM approval_requests a/.test(sql) && /status IN/.test(sql)) return [[agedApproval]];
    if (/FROM tracker_sprints s/.test(sql) && /s.status = 'active'/.test(sql)) return [[]];
    if (/FROM escalation_followups f/.test(sql)) return [followups];
    if (/FROM departments WHERE id/.test(sql)) return [[{ name: 'Warehouse' }]];
    return [[]];
  };
}

test('the queue merges every source and defaults an untouched breach to open', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const data = await escalation.list(1, { status: 'all' });
  // Only the sources this test feeds are asserted: every other registered
  // provider (Warehouse, Finance…) is free to exist and simply reports 0 here.
  const fed = ['issue_overdue', 'issue_stale', 'approval_aged', 'sprint_overdue'];
  assert.deepEqual(
    Object.fromEntries(fed.map((key) => [key, data.totals.bySource[key]])),
    { issue_overdue: 1, issue_stale: 1, approval_aged: 1, sprint_overdue: 0 },
  );
  // The page renders its filters from this catalogue, so it must list every source it counts.
  assert.deepEqual(new Set(data.sources.map((s) => s.key)), new Set(Object.keys(data.totals.bySource)));
  assert.equal(data.totals.all, 3);
  assert.equal(data.totals.open, 3, 'no follow-up yet still counts as open');
  // Worst breach first.
  assert.deepEqual(data.items.map((i) => i.daysLate), [21, 4, 3]);
  const stale = data.items.find((i) => i.source === 'issue_stale');
  assert.equal(stale.reference, 'CEK-4');
  assert.equal(stale.severity, 'high', '21 days untouched is not merely slow');
  assert.equal(stale.followup, null);
  assert.equal(data.items.find((i) => i.source === 'issue_overdue').severity, 'medium');
});

test('an existing follow-up decides the status the item is filtered by', async (t) => {
  const followups = [{
    source: 'issue_overdue', source_id: 11, status: 'acknowledged', owner_user_id: 2,
    note: 'Sudah dihubungi PIC.', updated_at: '2026-09-28T10:00:00Z',
    owner_name: 'Wahyudi', updated_by_name: 'Wahyudi',
  }];
  t.mock.method(pool, 'query', fakeQuery([], { followups }));
  const open = await escalation.list(1, { status: 'open' });
  assert.equal(open.totals.open, 2);
  assert.equal(open.totals.acknowledged, 1);
  assert.ok(!open.items.some((i) => i.sourceId === 11 && i.source === 'issue_overdue'), 'handled item leaves the open queue');

  const acked = await escalation.list(1, { status: 'acknowledged' });
  assert.equal(acked.items.length, 1);
  assert.equal(acked.items[0].followup.note, 'Sudah dihubungi PIC.');
  assert.equal(acked.items[0].followup.ownerName, 'Wahyudi');
});

test('a division Head is filtered in SQL, never trimmed afterwards', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const data = await escalation.list(1, { departmentId: 9, status: 'all' });
  assert.equal(data.scope.entityWide, false);
  assert.equal(data.scope.departmentId, 9);
  assert.equal(data.scope.departmentName, 'Warehouse');
  const scoped = calls.filter((c) => /department_id = \?/.test(c.sql));
  assert.ok(scoped.length >= 4, 'every source query carries the division filter');
  assert.ok(scoped.every((c) => c.args[0] === 1 && c.args[1] === 9));
});

test('unknown filters are refused rather than silently ignored', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  await assert.rejects(() => escalation.list(1, { status: 'apa-saja' }), (e) => e.status === 400);
  await assert.rejects(() => escalation.list(1, { source: 'apa-saja' }), (e) => e.status === 400);
});

test('writing a follow-up is gated by the same division as reading', async (t) => {
  // The task belongs to division 6; a Head of division 9 must not reach it.
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM tasks t/.test(sql)) return [[{ entity_id: 1, department_id: 6 }]];
    return [[]];
  });
  await assert.rejects(
    () => escalation.saveFollowup({ sub: 8, entityId: 1 }, { source: 'issue_overdue', sourceId: 11, departmentId: 9 }),
    (e) => e.status === 404 && e.code === 'NOT_FOUND',
    'an out-of-scope record is not even confirmed to exist',
  );
});

test('a record of another entity is refused even for an entity-wide manager', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM approval_requests a/.test(sql)) return [[{ entity_id: 7, department_id: 9 }]];
    return [[]];
  });
  await assert.rejects(
    () => escalation.saveFollowup({ sub: 2, entityId: 1 }, { source: 'approval_aged', sourceId: 3, departmentId: null }),
    (e) => e.status === 404,
  );
});

test('follow-up input is validated: source, id, status and note length', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ entity_id: 1, department_id: null }]]);
  const user = { sub: 2, entityId: 1 };
  const base = { source: 'issue_overdue', sourceId: 11, departmentId: null };
  await assert.rejects(() => escalation.saveFollowup(user, { ...base, source: 'lainnya' }), (e) => e.status === 400);
  await assert.rejects(() => escalation.saveFollowup(user, { ...base, sourceId: 0 }), (e) => e.status === 400);
  await assert.rejects(() => escalation.saveFollowup(user, { ...base, status: 'setengah' }), (e) => e.status === 400);
  await assert.rejects(
    () => escalation.saveFollowup(user, { ...base, note: 'x'.repeat(escalation.MAX_NOTE + 1) }),
    (e) => e.status === 400,
  );
});

test('an account with no division is refused instead of shown the whole entity', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const res = responseDouble();
  await ctrl.escalations({
    user: { sub: 7, entityId: 1, departmentId: null, permissions: ['management_dashboard.division'] },
    query: {},
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'NO_DEPARTMENT');
});
