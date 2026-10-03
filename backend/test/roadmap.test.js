const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const roadmap = require('../src/services/roadmap.service');
const ctrl = require('../src/controllers/managementDashboard.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const board = {
  id: 4, name: 'Cek Task', project_key: 'CEK', google_chat_space_name: 'spaces/AAQA1',
  department_id: 6, department_name: 'People & Culture',
};

// `issues` and `sprints` let each test decide which dates a project can be
// derived from; `calls` records the SQL so scoping can be asserted.
function fakeQuery(calls, { issues = [], sprints = [], boards = [board] } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM boards b/.test(sql)) return [boards];
    if (/GROUP BY t.board_id/.test(sql)) return [issues];
    if (/FROM tracker_sprints s/.test(sql)) return [sprints];
    if (/FROM departments WHERE id/.test(sql)) return [[{ name: 'Warehouse' }]];
    return [[]];
  };
}

const issueRow = (over = {}) => ({
  board_id: 4, planned_start: null, planned_due: null,
  first_activity: null, last_activity: null,
  open_count: 4, in_progress_count: 2, done_count: 2, overdue_count: 1, ...over,
});

test('a project with sprints takes its bar from them, and the sprints become child rows', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([], {
    issues: [issueRow({ planned_start: '2026-09-25', planned_due: '2026-09-30' })],
    sprints: [{
      id: 4, board_id: 4, name: 'Sprint 1', start_date: '2026-09-22', end_date: '2026-10-03',
      status: 'active', issue_count: 5, done_count: 2, open_count: 3, in_progress_count: 2, overdue_count: 1,
    }],
  }));
  const data = await roadmap.get(1);
  assert.equal(data.items.length, 2);
  const [project, sprint] = data.items;
  assert.equal(project.id, 'project:4');
  assert.deepEqual([project.startDate, project.dueDate], ['2026-09-22', '2026-10-03'], 'sprint dates win over issue dates');
  assert.equal(project.isFallbackStart, false);
  assert.equal(project.isFallbackDue, false);
  assert.equal(project.spaceId, 'AAQA1', 'the spaces/ prefix is stripped for linking');
  assert.equal(sprint.id, 'sprint:4');
  assert.equal(sprint.parentId, 'project:4');
  assert.equal(sprint.kind, 'sprint');
  assert.equal(sprint.isFallbackStart, false, 'a sprint always has real planned dates');
});

test('without sprints the bar falls back to issue dates, then to actual activity — and says which', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([], {
    issues: [issueRow({ planned_start: '2026-09-10', planned_due: '2026-09-20' })],
  }));
  const planned = await roadmap.get(1);
  assert.deepEqual([planned.items[0].startDate, planned.items[0].dueDate], ['2026-09-10', '2026-09-20']);
  assert.equal(planned.items[0].isFallbackStart, false);
  assert.equal(planned.items[0].isFallbackDue, false);

  t.mock.method(pool, 'query', fakeQuery([], {
    issues: [issueRow({ first_activity: '2026-09-01', last_activity: '2026-09-28' })],
  }));
  const guessed = await roadmap.get(1);
  assert.deepEqual([guessed.items[0].startDate, guessed.items[0].dueDate], ['2026-09-01', '2026-09-28']);
  assert.equal(guessed.items[0].isFallbackStart, true, 'a guessed bar must announce itself');
  assert.equal(guessed.items[0].isFallbackDue, true);
});

test('a project with no dates at all is left off the timeline rather than drawn at today', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([], { issues: [issueRow()] }));
  const data = await roadmap.get(1);
  assert.deepEqual(data.items, []);
  assert.ok(data.range.from < data.range.to, 'an empty roadmap still returns a usable window');
});

test('status and progress follow the issue counts', () => {
  assert.equal(roadmap.statusOf({ open: 0, inProgress: 0, done: 5 }), 'done');
  assert.equal(roadmap.statusOf({ open: 3, inProgress: 1, done: 0 }), 'in_progress');
  assert.equal(roadmap.statusOf({ open: 3, inProgress: 0, done: 0 }), 'open');
  assert.equal(roadmap.statusOf({ open: 0, inProgress: 0, done: 0 }), 'open', 'an empty project is not "done"');
  assert.equal(roadmap.progressOf({ open: 2, inProgress: 0, done: 2 }), 50);
  assert.equal(roadmap.progressOf({ open: 0, inProgress: 0, done: 0 }), 0, 'no issues never divides by zero');
  assert.equal(roadmap.progressOf({ open: 0, inProgress: 0, done: 3 }), 100);
});

test('the window covers every bar, and an explicit range is honoured', async (t) => {
  const sprints = [{
    id: 4, board_id: 4, name: 'Sprint 1', start_date: '2020-01-01', end_date: '2030-12-31',
    status: 'active', issue_count: 1, done_count: 0, open_count: 1, in_progress_count: 0, overdue_count: 0,
  }];
  t.mock.method(pool, 'query', fakeQuery([], { issues: [issueRow()], sprints }));
  const auto = await roadmap.get(1);
  assert.ok(auto.range.from <= '2020-01-01', 'the window stretches to the earliest bar');
  assert.ok(auto.range.to >= '2030-12-31', 'and to the latest');

  const fixed = await roadmap.get(1, { from: '2026-09-01', to: '2026-10-31' });
  assert.deepEqual(fixed.range, { from: '2026-09-01', to: '2026-10-31' });
});

test('malformed or reversed date filters are refused', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  await assert.rejects(() => roadmap.get(1, { from: '01-09-2026' }), (e) => e.status === 400);
  await assert.rejects(() => roadmap.get(1, { to: 'kemarin' }), (e) => e.status === 400);
  await assert.rejects(() => roadmap.get(1, { from: '2026-10-01', to: '2026-09-01' }), (e) => e.status === 400);
});

test('a division Head is filtered in SQL and told whose view this is', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls, { issues: [issueRow()] }));
  const data = await roadmap.get(1, { departmentId: 9 });
  assert.equal(data.scope.entityWide, false);
  assert.equal(data.scope.departmentName, 'Warehouse', 'named even when the division has no project yet');
  const scoped = calls.filter((c) => /b\.department_id = \?/.test(c.sql));
  assert.ok(scoped.length >= 1);
  assert.ok(scoped.every((c) => c.args[0] === 1 && c.args[1] === 9));
});

test('an account with no division is refused instead of shown every division', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const res = responseDouble();
  await ctrl.roadmap({
    user: { sub: 7, entityId: 1, departmentId: null, permissions: ['management_dashboard.division'] },
    query: {},
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'NO_DEPARTMENT');
});
