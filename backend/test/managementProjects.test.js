const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const ctrl = require('../src/controllers/managementDashboard.controller');
const router = require('../src/routes/managementDashboard.routes');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM boards b/.test(sql) && /updated_ts/.test(sql)) {
      return [[{ id: 5, name: 'Sales Ops', project_key: 'SODO', google_chat_space_name: 'spaces/AAAA1234', department_id: 5, department_name: 'Sales', updated_ts: 1790580000 }]];
    }
    if (/AS open_issues/.test(sql)) return [[{ open_issues: 4, in_progress: 1, done_this_week: 2, overdue: 1 }]];
    if (/GROUP BY t.board_id/.test(sql)) return [[{ board_id: 5, open_count: 4, in_progress_count: 1, done_count: 3, overdue_count: 1 }]];
    if (/s.status = 'active'/.test(sql)) return [[{ id: 2, board_id: 5, name: 'Sprint 2', end_date: new Date('2026-10-02T00:00:00Z'), issue_count: 4, done_count: 1, points: 10, done_points: 4 }]];
    if (/LIMIT 20/.test(sql)) return [[{ email: 'budi@prakasafoods.com', name: 'Budi', open_count: 3, overdue_count: 1 }]];
    if (/LIMIT 15/.test(sql)) {
      return [[{ project_key: 'SODO', issue_number: 12, title: 'Perbaiki invoice', project_name: 'Sales Ops', status_name: 'Done', category: 'done', assignee_name: null, assignee_email: 'budi@prakasafoods.com', updated_ts: 1790580000 }]];
    }
    if (/GROUP BY b.department_id/.test(sql)) {
      return [[{ department_id: 5, department_name: 'Sales', project_count: 1, open_count: 4, in_progress_count: 1, done_count: 3, overdue_count: 1 }]];
    }
    if (/created_count/.test(sql)) return [[{ week_start: '2026-09-28', created_count: 6 }]];
    if (/completed_count/.test(sql)) return [[{ week_start: '2026-09-28', completed_count: 2 }]];
    if (/days_since_update/.test(sql)) {
      return [[{ id: 31, project_key: 'SODO', issue_number: 9, title: 'Audit stok', project_name: 'Sales Ops', status_name: 'Backlog', category: 'todo', assignee_name: null, assignee_email: null, days_since_update: 21 }]];
    }
    if (/FROM departments WHERE id/.test(sql)) return [[{ name: 'Sales' }]];
    return [[]];
  };
}

test('the management dashboard exposes exactly its routes (targets has GET and PUT)', () => {
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.deepEqual(paths, ['/division', '/summary', '/projects', '/escalations', '/escalations/:source/:sourceId', '/roadmap', '/targets', '/targets',
    // Alur & Margin (program 3.3): management only; see managementMargin/SlowMovers tests for their gates.
    '/flow/sales', '/flow/purchase', '/margin', '/slow-movers']);
});

test('projects returns entity-scoped aggregates in the contract shape', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const res = responseDouble();
  await ctrl.projects({ user: { sub: 1, entityId: 3, permissions: ['management_dashboard.view'] }, query: {} }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  const data = res.body.data;
  assert.deepEqual(data.totals, { projects: 1, openIssues: 4, inProgress: 1, doneThisWeek: 2, overdue: 1 });
  assert.deepEqual(data.projects[0], {
    projectId: 5, name: 'Sales Ops', key: 'SODO', spaceName: 'spaces/AAAA1234',
    departmentId: 5, departmentName: 'Sales',
    open: 4, inProgress: 1, done: 3, overdue: 1,
    activeSprint: { name: 'Sprint 2', endDate: '2026-10-02', progressPct: 40 },
    updatedAt: new Date(1790580000 * 1000).toISOString(),
  });
  assert.deepEqual(data.workload, [{ email: 'budi@prakasafoods.com', name: 'Budi', open: 3, overdue: 1 }]);
  assert.deepEqual(data.recent[0], {
    issueKey: 'SODO-12', title: 'Perbaiki invoice', projectName: 'Sales Ops', statusName: 'Done',
    category: 'done', assigneeName: 'budi@prakasafoods.com', updatedAt: new Date(1790580000 * 1000).toISOString(),
  });
  // Never selects issue bodies, and every query is bound to the caller's entity.
  assert.ok(calls.every((c) => !/description|task_comments/.test(c.sql)));
  assert.ok(calls.filter((c) => /b\.entity_id = \?/.test(c.sql)).every((c) => c.args[0] === 3));
});

test('another entity requires entity.cross_access', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const res = responseDouble();
  await ctrl.projects({ user: { sub: 1, entityId: 3, permissions: [] }, query: { entityId: '9' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});


test('the entity-wide view reports every division, the 8-week trend and the aging queue', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const res = responseDouble();
  await ctrl.projects({ user: { sub: 1, entityId: 3, permissions: ['management_dashboard.view'] }, query: {} }, res, (e) => { throw e; });
  const data = res.body.data;
  assert.deepEqual(data.scope, { entityWide: true, departmentId: null, departmentName: null });
  assert.deepEqual(data.byDivision, [
    { departmentId: 5, departmentName: 'Sales', projects: 1, open: 4, inProgress: 1, done: 3, overdue: 1 },
  ]);
  assert.equal(data.trend.length, 8, 'always eight buckets, even for a quiet month');
  assert.ok(data.trend.every((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.weekStart)));
  assert.deepEqual(data.aging[0], {
    issueId: 31, issueKey: 'SODO-9', title: 'Audit stok', projectName: 'Sales Ops',
    statusName: 'Backlog', category: 'todo', assigneeName: null, daysSinceUpdate: 21,
  });
});

test('a Head without the entity-wide view only ever sees their own division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const res = responseDouble();
  await ctrl.projects({
    user: { sub: 7, entityId: 3, departmentId: 9, permissions: ['management_dashboard.division'] },
    query: {},
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.scope.entityWide, false);
  assert.equal(res.body.data.scope.departmentId, 9);
  // The division is filtered in SQL, never trimmed from a full-entity result.
  const scoped = calls.filter((c) => /b\.department_id = \?/.test(c.sql));
  assert.ok(scoped.length >= 4, 'every aggregate query is scoped');
  assert.ok(scoped.every((c) => c.args[0] === 3 && c.args[1] === 9));
});

test('a Head with no division is refused rather than shown the whole entity', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const res = responseDouble();
  await ctrl.projects({
    user: { sub: 7, entityId: 3, departmentId: null, permissions: ['management_dashboard.division'] },
    query: {},
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'NO_DEPARTMENT');
});

test('weekBuckets fills quiet weeks with zero and keeps them oldest first', () => {
  const reports = require('../src/services/trackerReports.service');
  const weeks = reports.weekBuckets(
    [{ week_start: '2026-09-28', created_count: 6 }],
    [{ week_start: '2026-09-21', completed_count: 3 }],
    new Date('2026-09-28T09:00:00'),
  );
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.map((w) => w.weekStart).slice(-2), ['2026-09-21', '2026-09-28']);
  assert.deepEqual(weeks.at(-1), { weekStart: '2026-09-28', created: 6, completed: 0 });
  assert.deepEqual(weeks.at(-2), { weekStart: '2026-09-21', created: 0, completed: 3 });
  assert.ok(weeks.slice(0, 6).every((w) => w.created === 0 && w.completed === 0));
});

test('requirePermission accepts any one of several codes', () => {
  const requirePermission = require('../src/middleware/requirePermission');
  const run = (permissions, code) => {
    const res = responseDouble();
    let passed = false;
    requirePermission(code)({ user: { permissions } }, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  };
  assert.equal(run(['management_dashboard.division'], ['management_dashboard.view', 'management_dashboard.division']).passed, true);
  assert.equal(run(['management_dashboard.view'], ['management_dashboard.view', 'management_dashboard.division']).passed, true);
  assert.equal(run([], ['management_dashboard.view', 'management_dashboard.division']).status, 403);
  // A plain string keeps its old single-permission meaning.
  assert.equal(run(['a'], 'a').passed, true);
  assert.equal(run(['b'], 'a').status, 403);
});
