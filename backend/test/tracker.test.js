const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const chatUser = require('../src/services/googleChatUser.service');
const trackerChat = require('../src/services/trackerChat.service');
const tracker = require('../src/services/tracker.service');
const realtime = require('../src/services/realtime.service');
const M = require('../src/services/trackerModel');
const { computeBurndown } = require('../src/services/trackerReports.service');
const ctrl = require('../src/controllers/tracker.controller');
const router = require('../src/routes/tracker.routes');

const user = { sub: 14, entityId: 1, email: 'owner@prakasafoods.com', permissions: ['google.chat.use'] };
const board = {
  id: 5, entity_id: 1, department_id: null, name: 'Sales Ops', project_key: 'SODO',
  post_updates_to_space: 1, google_chat_space_name: 'spaces/AAAA1234', is_archived: 0,
};

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.beforeEach(() => {
  trackerChat.clearCaches();
  realtime.reset();
});

// ---------------------------------------------------------------- routes

test('every tracker route sits behind requireAuth + google.chat.use', () => {
  const layers = router.stack;
  assert.equal(layers[0].name, 'requireAuth');
  const routes = layers.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  assert.deepEqual(routes.sort(), [
    'DELETE /issues/:issueId',
    'GET /issues/:issueId',
    'GET /projects',
    'GET /projects/:projectId/issues',
    'GET /projects/:projectId/reports',
    'GET /spaces/:spaceId/project',
    'PATCH /issues/:issueId',
    'PATCH /projects/:projectId',
    'PATCH /sprints/:sprintId',
    'POST /issues/:issueId/comments',
    'POST /projects/:projectId/issues',
    'POST /projects/:projectId/sprints',
    'POST /spaces/:spaceId/project',
  ].sort());
});

// ---------------------------------------------------------------- validation

test('ids, space ids and keys are strictly validated', () => {
  assert.equal(M.positiveInt('12', 'id'), 12);
  assert.equal(M.positiveInt(7, 'id'), 7);
  for (const bad of ['0', '-1', '1.5', '1e3', 'abc', '', null, true, 2.5, '99999999999']) {
    assert.throws(() => M.positiveInt(bad, 'id'), /tidak valid/, String(bad));
  }
  assert.equal(M.spaceNameFromId('AAAAbc_12-x'), 'spaces/AAAAbc_12-x');
  for (const bad of ['short', 'spaces/AAAA1234', '../etc/xx', 'AAAA 1234', 'a'.repeat(65), 42]) {
    assert.throws(() => M.spaceNameFromId(bad), /ID space tidak valid/);
  }
  assert.equal(M.keyValue(' sodo '), 'SODO');
  for (const bad of ['S', 'TOOLONGKEY1', 'SO-DO', 'ÄB', 12]) assert.throws(() => M.keyValue(bad));
});

test('issue input: enums whitelisted, limits enforced', () => {
  const ok = tracker.normalizeIssueInput({
    title: '  Perbaiki invoice ', type: 'bug', priority: 'urgent', storyPoints: '2.5',
    labels: ['qa', 'qa', ' finance '], assigneeEmail: 'Budi@PrakasaFoods.com', dueDate: '2026-10-01',
  }, { create: true });
  assert.equal(ok.title, 'Perbaiki invoice');
  assert.equal(ok.storyPoints, 2.5);
  assert.deepEqual(ok.labels, ['qa', 'finance']);
  assert.equal(ok.assigneeEmail, 'budi@prakasafoods.com');

  const bad = [
    { title: '' },
    { title: 'x'.repeat(256) },
    { title: 'x', description: 'd'.repeat(20001) },
    { title: 'x', type: 'feature' },
    { title: 'x', priority: 'critical' },
    { title: 'x', storyPoints: 101 },
    { title: 'x', storyPoints: -1 },
    { title: 'x', storyPoints: 0.25 },
    { title: 'x', labels: Array.from({ length: 11 }, (_, i) => `l${i}`) },
    { title: 'x', labels: ['a'.repeat(31)] },
    { title: 'x', labels: 'qa' },
    { title: 'x', assigneeEmail: 'not-an-email' },
    { title: 'x', dueDate: '2026-02-30' },
    { title: 'x', sprintId: 'abc' },
    { title: 'x', parentId: 0 },
  ];
  for (const input of bad) assert.throws(() => tracker.normalizeIssueInput(input, { create: true }), undefined, JSON.stringify(input).slice(0, 60));

  assert.throws(() => tracker.normalizeIssueInput({ status: 'blocked' }), /status tidak valid/);
  assert.throws(() => tracker.normalizeIssueInput({ position: -1 }), /position/);
  assert.throws(() => tracker.normalizeIssueInput({ columnId: null }), /columnId/);
  assert.deepEqual(tracker.normalizeIssueInput({ assigneeEmail: null, sprintId: null }), { assigneeEmail: null, sprintId: null });
});

test('columns: 1–12, categories whitelisted, wip 1–999, no duplicate ids', () => {
  assert.deepEqual(tracker.normalizeColumns([{ id: 3, name: ' Done ', category: 'done', wipLimit: 5 }]),
    [{ id: 3, name: 'Done', category: 'done', wipLimit: 5 }]);
  assert.throws(() => tracker.normalizeColumns([]), /Minimal 1/);
  assert.throws(() => tracker.normalizeColumns(Array.from({ length: 13 }, () => ({ name: 'x', category: 'todo' }))), /Maksimal/);
  assert.throws(() => tracker.normalizeColumns([{ name: 'x', category: 'blocked' }]), /category/);
  assert.throws(() => tracker.normalizeColumns([{ name: 'x', category: 'todo', wipLimit: 0 }]), /wipLimit/);
  assert.throws(() => tracker.normalizeColumns([{ id: 1, name: 'a', category: 'todo' }, { id: 1, name: 'b', category: 'done' }]), /duplikat/);
});

test('auto key from the space name', () => {
  assert.equal(M.autoKey('Sales Order Domestik'), 'SOD');
  assert.equal(M.autoKey('Marketing'), 'MARK');
  assert.equal(M.autoKey('Tim IT & Infra 2026'), 'TII2');
  assert.equal(M.autoKey(''), 'PRJ');
  assert.equal(M.autoKey('🚀'), 'PRJ');
});

// ---------------------------------------------------------------- mapping

test('issue rows map to the contract shape', () => {
  const issue = M.mapIssue({
    id: 9, project_key: 'SODO', issue_number: 12, title: 'Perbaiki invoice', description: null,
    issue_type: 'bug', priority: 'high', column_id: 3, category: 'in_progress', column_name: 'In Review',
    assignee_id: null, assignee_email: 'Budi@prakasafoods.com', reporter_id: 14, reporter_name: 'Owner',
    start_date: new Date('2026-09-20T00:00:00Z'), due_date: new Date('2026-10-01T00:00:00Z'), story_points: '3.0', labels: '["qa"]', sprint_id: 2,
    parent_id: 4, parent_number: 3, child_count: 1, comment_count: 2, position: 0,
    created_ts: 1790580000, updated_ts: 1790580060, completed_ts: null,
  }, new Map([['budi@prakasafoods.com', 'Budi']]));
  assert.deepEqual(issue, {
    id: 9, key: 'SODO-12', number: 12, title: 'Perbaiki invoice', description: '', type: 'bug', priority: 'high',
    columnId: 3, status: 'in_progress', statusName: 'In Review',
    assignee: { email: 'budi@prakasafoods.com', name: 'Budi', userId: null },
    reporter: { userId: 14, name: 'Owner' },
    startDate: '2026-09-20', dueDate: '2026-10-01', storyPoints: 3, labels: ['qa'], sprintId: 2, parentId: 4, parentKey: 'SODO-3',
    childCount: 1, commentCount: 2, position: 0,
    createdAt: new Date(1790580000 * 1000).toISOString(), updatedAt: new Date(1790580060 * 1000).toISOString(), completedAt: null,
  });
});

test('drag & drop placement is deterministic and clamped', () => {
  assert.deepEqual(M.placeAt([1, 2, 3], 9, 0), [9, 1, 2, 3]);
  assert.deepEqual(M.placeAt([1, 2, 3], 9, 1), [1, 9, 2, 3]);
  assert.deepEqual(M.placeAt([1, 2, 3], 9, 99), [1, 2, 3, 9]);
  assert.deepEqual(M.placeAt([1, 2, 3], 9, null), [1, 2, 3, 9]);
  assert.deepEqual(M.placeAt([1, 2, 3], 2, 0), [2, 1, 3], 'moving within the column');
});

test('burndown: ideal line is linear, remaining counts until completion day, future days are null', () => {
  const days = computeBurndown({
    start: '2026-09-25', end: '2026-09-29', today: '2026-09-27',
    issues: [{ points: 3, doneDay: '2026-09-26' }, { points: 5, doneDay: null }, { points: 2, doneDay: '2026-09-27' }],
  });
  assert.deepEqual(days.map((d) => d.date), ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']);
  assert.deepEqual(days.map((d) => d.idealPoints), [10, 7.5, 5, 2.5, 0]);
  assert.deepEqual(days.map((d) => d.remainingPoints), [10, 7, 5, null, null]);
  assert.deepEqual(days.map((d) => d.remainingIssues), [3, 2, 1, null, null]);
});

test('space update texts', () => {
  assert.equal(M.spaceUpdateText({ key: 'SODO-12', title: 'Perbaiki invoice', changes: [{ kind: 'created', assigneeName: 'Budi' }] }),
    '🆕 SODO-12 Perbaiki invoice · ditugaskan ke Budi');
  assert.equal(M.spaceUpdateText({ key: 'SODO-12', title: 'X', changes: [{ kind: 'status', from: 'To Do', to: 'In Progress' }, { kind: 'assigned', assigneeName: 'Ani' }] }),
    '🔄 SODO-12 X · To Do → In Progress\n👤 SODO-12 X · ditugaskan ke Ani');
  assert.equal(M.spaceUpdateText({ key: 'SODO-12', title: 'X', changes: [{ kind: 'completed' }] }), '✅ SODO-12 X · selesai');
});

// ---------------------------------------------------------------- membership

test('membership is checked with Chat AS the user and cached for 2 minutes', async (t) => {
  const getSpace = t.mock.method(chatUser, 'getSpace', async (subject, spaceName) => ({ name: spaceName, displayName: 'Sales Ops', spaceType: 'SPACE' }));
  const space = await trackerChat.assertMember(user, 'spaces/AAAA1234');
  assert.equal(space.displayName, 'Sales Ops');
  await trackerChat.assertMember(user, 'spaces/AAAA1234');
  assert.equal(getSpace.mock.callCount(), 1, 'second call served from cache');
  assert.equal(getSpace.mock.calls[0].arguments[0], user.email, 'subject is the signed-in user');
  await trackerChat.assertMember({ ...user, sub: 99, email: 'other@prakasafoods.com' }, 'spaces/AAAA1234');
  assert.equal(getSpace.mock.callCount(), 2, 'cache is per user');
});

test('non-members get 403 "Anda bukan anggota space ini"; token problems are not treated as membership', async (t) => {
  const notFound = Object.assign(new Error('Not found'), { code: 404 });
  t.mock.method(chatUser, 'getSpace', async () => { throw notFound; });
  await assert.rejects(trackerChat.assertMember(user, 'spaces/BBBB1234'), (e) => e.status === 403 && e.code === 'FORBIDDEN' && e.message === 'Anda bukan anggota space ini');

  trackerChat.clearCaches();
  const scope = Object.assign(new Error('unauthorized_client: Client is unauthorized'), { code: 401 });
  chatUser.getSpace.mock.mockImplementation(async () => { throw scope; });
  await assert.rejects(trackerChat.assertMember(user, 'spaces/BBBB1234'), (e) => e === scope);
});

test('a project of another entity is 404 without asking Google', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ ...board, entity_id: 2 }]]);
  const getSpace = t.mock.method(chatUser, 'getSpace', async () => ({}));
  await assert.rejects(tracker.accessProject(user, '5'), (e) => e.status === 404);
  assert.equal(getSpace.mock.callCount(), 0);
});

// ---------------------------------------------------------------- space updates

test('space updates are posted AS the acting user only when enabled, and never throw', async (t) => {
  const createMessage = t.mock.method(chatUser, 'createMessage', async () => ({ name: 'spaces/AAAA1234/messages/1' }));
  const issue = { key: 'SODO-12', title: 'Perbaiki invoice' };

  assert.equal(await tracker.announce(user, board, issue, [{ kind: 'created', assigneeName: 'Budi' }]), true);
  assert.equal(createMessage.mock.callCount(), 1);
  const [subject, spaceName, payload] = createMessage.mock.calls[0].arguments;
  assert.equal(subject, user.email);
  assert.equal(spaceName, 'spaces/AAAA1234');
  assert.equal(payload.text, '🆕 SODO-12 Perbaiki invoice · ditugaskan ke Budi');

  assert.equal(await tracker.announce(user, { ...board, post_updates_to_space: 0 }, issue, [{ kind: 'completed' }]), false);
  assert.equal(createMessage.mock.callCount(), 1, 'nothing posted when postUpdatesToSpace is off');

  createMessage.mock.mockImplementation(async () => { throw Object.assign(new Error('boom'), { code: 500 }); });
  assert.equal(await tracker.announce(user, board, issue, [{ kind: 'completed' }]), false);
});

// Minimal fake connection: answers by SQL pattern and records every statement.
function fakeDb(handlers) {
  const statements = [];
  const run = async (sql, args = []) => {
    statements.push({ sql, args });
    for (const [pattern, reply] of handlers) {
      if (pattern.test(sql)) return typeof reply === 'function' ? reply(sql, args) : reply;
    }
    return [[]];
  };
  const conn = {
    query: run,
    beginTransaction: async () => { statements.push({ sql: 'BEGIN' }); },
    commit: async () => { statements.push({ sql: 'COMMIT' }); },
    rollback: async () => { statements.push({ sql: 'ROLLBACK' }); },
    release: () => {},
  };
  return { conn, run, statements };
}

test('createIssue: atomic number, WIP check, activity, then realtime + space update after commit', async (t) => {
  const issueRow = {
    id: 77, board_id: 5, entity_id: 1, issue_number: 13, title: 'Perbaiki invoice', issue_type: 'task', priority: 'normal',
    column_id: 1, category: 'todo', column_name: 'To Do', assignee_id: null, assignee_email: null, reporter_id: 14,
    reporter_name: 'Owner', project_key: 'SODO', position: 0, created_ts: 1790580000, updated_ts: 1790580000,
  };
  const db = fakeDb([
    [/FROM boards\s+WHERE id = \?/, [[board]]],
    [/LAST_INSERT_ID\(\) AS n/, [[{ n: 13 }]]],
    [/FROM board_columns\s+WHERE board_id = \? AND category = \?/, [[{ id: 1, name: 'To Do', category: 'todo' }]]],
    [/wip_limit AS wipLimit/, [[{ id: 1, wipLimit: null, entityId: 1, boardDeletedAt: null, isArchived: 0 }]]],
    [/nextPosition/, [[{ nextPosition: 0 }]]],
    [/INSERT INTO tasks/, [{ insertId: 77 }]],
    [/FROM tasks t\s+JOIN boards b/, [[issueRow]]],
  ]);
  t.mock.method(pool, 'query', db.run);
  t.mock.method(pool, 'getConnection', async () => db.conn);
  t.mock.method(chatUser, 'getSpace', async (s, name) => ({ name, displayName: 'Sales Ops', spaceType: 'SPACE' }));
  const posted = [];
  t.mock.method(chatUser, 'createMessage', async (subject, spaceName, { text }) => { posted.push({ subject, text }); return {}; });
  const published = [];
  const off = realtime.subscribe('tracker', (e) => published.push(e));

  const { issue } = await tracker.createIssue(user, '5', { title: 'Perbaiki invoice' });
  off();
  assert.equal(issue.key, 'SODO-13');

  const sqls = db.statements.map((s) => s.sql);
  const seq = sqls.findIndex((s) => /issue_seq = LAST_INSERT_ID\(issue_seq \+ 1\)/.test(s));
  const insert = sqls.findIndex((s) => /INSERT INTO tasks/.test(s));
  const commit = sqls.indexOf('COMMIT');
  assert.ok(sqls.indexOf('BEGIN') < seq && seq < insert && insert < commit, 'numbering + insert inside one transaction');
  assert.ok(sqls.some((s) => /wip_limit AS wipLimit/.test(s)), 'WIP limit enforced');
  const activity = db.statements.find((s) => /INSERT INTO task_activity/.test(s.sql));
  assert.equal(activity.args[3], 'tracker.issue_created');
  const insertArgs = db.statements[insert].args;
  assert.ok(insertArgs.includes(13), 'issue_number stored');

  assert.equal(published.length, 1);
  assert.deepEqual({ ...published[0], at: undefined }, {
    type: 'issue.created', entityId: 1, projectId: 5, spaceName: 'spaces/AAAA1234', issueId: 77, actorUserId: 14, at: undefined,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posted, [{ subject: user.email, text: '🆕 SODO-13 Perbaiki invoice' }]);
});

test('createIssue rolls back and emits nothing when the WIP limit is reached', async (t) => {
  const db = fakeDb([
    [/FROM boards\s+WHERE id = \?/, [[board]]],
    [/LAST_INSERT_ID\(\) AS n/, [[{ n: 14 }]]],
    [/FROM board_columns\s+WHERE board_id = \? AND category = \?/, [[{ id: 1, name: 'To Do', category: 'todo' }]]],
    [/wip_limit AS wipLimit/, [[{ id: 1, wipLimit: 2, entityId: 1, boardDeletedAt: null, isArchived: 0 }]]],
    [/COUNT\(\*\) AS total/, [[{ total: 2 }]]],
  ]);
  t.mock.method(pool, 'query', db.run);
  t.mock.method(pool, 'getConnection', async () => db.conn);
  t.mock.method(chatUser, 'getSpace', async (s, name) => ({ name, displayName: 'Sales Ops', spaceType: 'SPACE' }));
  const createMessage = t.mock.method(chatUser, 'createMessage', async () => ({}));
  const published = [];
  const off = realtime.subscribe('tracker', (e) => published.push(e));
  await assert.rejects(tracker.createIssue(user, '5', { title: 'x' }), (e) => e.code === 'WIP_LIMIT_EXCEEDED' && e.status === 409);
  off();
  assert.ok(db.statements.some((s) => s.sql === 'ROLLBACK'));
  assert.ok(!db.statements.some((s) => /INSERT INTO tasks/.test(s.sql)));
  assert.equal(published.length, 0);
  assert.equal(createMessage.mock.callCount(), 0);
});

test('enable is refused for DMs and group chats', async (t) => {
  t.mock.method(chatUser, 'getSpace', async (s, name) => ({ name, displayName: 'Budi', spaceType: 'DIRECT_MESSAGE' }));
  await assert.rejects(tracker.enableProject(user, 'AAAA1234', {}), (e) => e.status === 400);
});

// A project with no division never shows up in a per-division management report,
// so enabling one records the division of whoever switched it on.
test('enabling a project records the creator\'s division', async (t) => {
  t.mock.method(chatUser, 'getSpace', async (s, name) => ({ name, displayName: 'Gudang', spaceType: 'SPACE' }));
  const inserts = [];
  const conn = {
    query: async (sql, args) => {
      inserts.push({ sql, args });
      if (/INSERT INTO boards/.test(sql)) return [{ insertId: 9 }];
      if (/COALESCE\(MAX\(issue_number\)/.test(sql)) return [[{ maxNumber: 0 }]];
      return [[]];
    },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  };
  t.mock.method(pool, 'getConnection', async () => conn);
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(tracker, 'getSpaceProject', async () => ({ enabled: true }));

  await tracker.enableProject({ ...user, departmentId: 9 }, 'AAAA1234', { key: 'GDG' }).catch(() => {});
  const insert = inserts.find((c) => /INSERT INTO boards/.test(c.sql));
  assert.ok(insert, 'a new board is inserted');
  assert.equal(insert.args[0], 1, 'entity');
  assert.equal(insert.args[1], 9, 'division of the creator');
});

// The "Kirim update ke space" box of the enable form: unticked must be stored
// as off, so nothing is announced in Google Chat. Missing = on (what the form shows).
test('enabling a project honours postUpdatesToSpace: false is stored as off, missing stays on', async (t) => {
  t.mock.method(chatUser, 'getSpace', async (s, name) => ({ name, displayName: 'Gudang', spaceType: 'SPACE' }));
  const createMessage = t.mock.method(chatUser, 'createMessage', async () => ({}));
  let inserts = [];
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(tracker, 'getSpaceProject', async () => ({ enabled: true }));
  const getConnection = t.mock.method(pool, 'getConnection', async () => null);
  const run = async (body) => {
    inserts = [];
    const conn = {
      query: async (sql, args) => {
        inserts.push({ sql, args });
        if (/INSERT INTO boards/.test(sql)) return [{ insertId: 9 }];
        if (/COALESCE\(MAX\(issue_number\)/.test(sql)) return [[{ maxNumber: 0 }]];
        return [[]];
      },
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    };
    getConnection.mock.mockImplementation(async () => conn);
    await tracker.enableProject({ ...user, departmentId: 9 }, 'AAAA1234', body).catch(() => {});
    const insert = inserts.find((c) => /INSERT INTO boards/.test(c.sql));
    assert.ok(insert, 'a new board is inserted');
    assert.match(insert.sql, /post_updates_to_space\)/);
    return insert.args.at(-1);
  };
  assert.equal(await run({ key: 'GDA', postUpdatesToSpace: false }), 0, 'unticked: off');
  assert.equal(await run({ key: 'GDB', postUpdatesToSpace: true }), 1);
  assert.equal(await run({ key: 'GDC' }), 1, 'not sent: the default the form shows (on)');
  await assert.rejects(tracker.enableProject(user, 'AAAA1234', { key: 'GDD', postUpdatesToSpace: 'tidak' }), (e) => e.status === 400);
  assert.equal(createMessage.mock.callCount(), 0, 'enabling never posts to the space');
});

test('a project division can be changed later, and only to a valid id', () => {
  assert.equal(M.positiveInt(7, 'departmentId'), 7);
  assert.throws(() => M.positiveInt(0, 'departmentId'), (e) => e.status === 400);
  assert.throws(() => M.positiveInt('abc', 'departmentId'), (e) => e.status === 400);
});

// ---------------------------------------------------------------- controller

test('controller maps our errors, Google errors and unknown errors correctly', async (t) => {
  t.mock.method(chatUser, 'getSpace', async () => { throw Object.assign(new Error('Forbidden'), { code: 403, response: { status: 403 } }); });
  t.mock.method(pool, 'query', async () => [[board]]);

  let res = responseDouble();
  await ctrl.listIssues({ user, params: { projectId: '5' }, query: {} }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.error, { code: 'FORBIDDEN', message: 'Anda bukan anggota space ini' });

  res = responseDouble();
  await ctrl.listIssues({ user, params: { projectId: 'abc' }, query: {} }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 400);

  trackerChat.clearCaches();
  chatUser.getSpace.mock.mockImplementation(async () => { throw Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }); });
  res = responseDouble();
  await ctrl.getSpaceProject({ user, params: { spaceId: 'AAAA1234' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'GOOGLE_ACCOUNT_NOT_LINKED', 'never a raw Google 401/403');

  res = responseDouble();
  let forwarded = null;
  t.mock.method(pool, 'query', async () => { throw new Error('db down'); });
  await ctrl.listProjects({ user }, res, (e) => { forwarded = e; });
  assert.equal(forwarded?.message, 'db down');
});

// The tasks table always had start_date, but the tracker neither wrote nor read
// it — so every project on the roadmap started on an inferred date.
test('an issue start date is accepted, and must not fall after the due date', () => {
  const ok = tracker.normalizeIssueInput({ title: 'Audit', startDate: '2026-10-05', dueDate: '2026-10-20' }, { create: true });
  assert.equal(ok.startDate, '2026-10-05');
  assert.equal(ok.dueDate, '2026-10-20');
  const same = tracker.normalizeIssueInput({ title: 'Satu hari', startDate: '2026-10-05', dueDate: '2026-10-05' }, { create: true });
  assert.equal(same.startDate, '2026-10-05', 'a one-day issue is valid');
  assert.throws(
    () => tracker.normalizeIssueInput({ title: 'Salah urut', startDate: '2026-11-01', dueDate: '2026-10-01' }, { create: true }),
    (e) => e.status === 400,
  );
  assert.throws(() => tracker.normalizeIssueInput({ title: 'x', startDate: 'besok' }, { create: true }), (e) => e.status === 400);
  // Clearing it is allowed.
  assert.equal(tracker.normalizeIssueInput({ startDate: null }, { create: false }).startDate, null);
});

// F23: an issue linked to an IT ticket moves only as the ticket may move.
function linkedIssueDb(ticketStatus) {
  const taskRow = { id: 900, board_id: 5, entity_id: 1, title: '[Tiket IT #55] Laptop mati', issue_number: 3, column_id: 1, position: 0, assignee_id: null, assignee_email: null, status: 'open', labels: null };
  return fakeDb([
    [/FROM boards\s+WHERE id = \?/, [[board]]],
    [/SELECT id, board_id, entity_id, title, issue_number/, [[taskRow]]],
    [/FROM tasks WHERE id = \? AND deleted_at IS NULL LIMIT 1 FOR UPDATE/, [[taskRow]]],
    [/FROM board_columns WHERE id = \? AND board_id = \?/, (sql, args) => [[Number(args[0]) === 3 ? { id: 3, name: 'Done', category: 'done' } : { id: 1, name: 'To Do', category: 'todo' }]]],
    [/FROM it_tickets WHERE tracker_issue_id/, [[{ id: 55, status: ticketStatus, entity_id: 1 }]]],
    [/SELECT \* FROM it_tickets WHERE id=\? AND entity_id=\?/, [[{ id: 55, status: ticketStatus, entity_id: 1, requester_id: 9, title: 'Laptop mati' }]]],
    [/^\s*UPDATE it_tickets/, [{ affectedRows: 1 }]],
  ]);
}

test('F23: a Space member without it_ticket.manage cannot drag a ticket issue to Done — nothing is written', async (t) => {
  const db = linkedIssueDb('open');
  t.mock.method(pool, 'query', db.run);
  t.mock.method(pool, 'getConnection', async () => db.conn);
  t.mock.method(trackerChat, 'assertMember', async () => ({}));
  await assert.rejects(tracker.updateIssue(user, '900', { columnId: 3 }), (e) => e.status === 403 && e.code === 'IT_TICKET_LINKED');
  const sqls = db.statements.map((s) => s.sql);
  assert.ok(sqls.includes('ROLLBACK'));
  assert.ok(!sqls.some((s) => /^\s*UPDATE (tasks|it_tickets)/.test(s)), 'neither the issue nor the ticket changed');
});

test('F23: an IT ticket manager drags the issue to Done and the board is told the ticket followed', async (t) => {
  const db = linkedIssueDb('in_progress');
  t.mock.method(pool, 'query', db.run);
  t.mock.method(pool, 'getConnection', async () => db.conn);
  t.mock.method(trackerChat, 'assertMember', async () => ({}));
  t.mock.method(chatUser, 'createMessage', async () => ({}));
  const manager = { ...user, permissions: ['google.chat.use', 'it_ticket.manage'] };
  const result = await tracker.updateIssue(manager, '900', { columnId: 3 });
  assert.equal(result.ticketSync.synced, true);
  assert.equal(result.ticketSync.status, 'resolved');
  const ticketUpdate = db.statements.find((s) => /^\s*UPDATE it_tickets SET status = \?/.test(s.sql));
  assert.ok(ticketUpdate, 'the ticket was resolved');
  assert.equal(ticketUpdate.args[0], 'resolved');
});
