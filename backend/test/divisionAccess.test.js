// Cross-division (IDOR) scoping: data is per division inside a company;
// cross-division roles (Management Office, Super Admin) see across divisions.
// DB tests run on the real local schema inside one rolled-back transaction.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, dbReady, inRolledBackTransaction, makeUser, departmentId, tag } = require('./fixtures/gaDb');
const division = require('../src/services/divisionAccess');
const taskAccess = require('../src/services/taskAccess.service');
const taskSvc = require('../src/services/task.service');
const watcherSvc = require('../src/services/taskWatcher.service');
const checklistSvc = require('../src/services/taskChecklist.service');
const dependencySvc = require('../src/services/taskDependency.service');
const dependencyGraphSvc = require('../src/services/taskDependencyGraph.service');
const gantt = require('../src/services/gantt.service');
const boardSvc = require('../src/services/board.service');
const engine = require('../src/services/approvalEngine.service');
const approvals = require('../src/controllers/approvals.controller');
const documents = require('../src/controllers/documents.controller');
const signatures = require('../src/controllers/signatures.controller');
const delegations = require('../src/controllers/approvalDelegations.controller');
const activityLogs = require('../src/controllers/activityLogs.controller');
const { requireEntityScope } = require('../src/middleware/entityScope');
const globalSearch = require('../src/services/globalSearch.service');
const drive = require('../src/services/googleDrive.service');

test.after(() => pool.end());

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(handler, req) {
  const res = responseDouble();
  let thrown = null;
  await handler({ query: {}, params: {}, body: {}, entityScope: { entityId: 1 }, ...req }, res, (e) => { thrown = e; });
  if (thrown) throw thrown;
  return res;
}

const CROSS = ['workspace.cross_division.view', 'management_dashboard.view'];
const withoutCross = (user) => ({ ...user, permissions: user.permissions.filter((p) => !CROSS.includes(p)) });
const withPerms = (user, extra) => ({ ...user, permissions: [...new Set([...user.permissions, ...extra])] });

async function rejects404(promise) {
  await assert.rejects(promise, (e) => e.status === 404);
}

/* ------------------------------------------------------------- unit rules */

test('spansDivisions / sameDivision follow the shared rule', () => {
  assert.equal(division.spansDivisions({ permissions: ['workspace.cross_division.view'] }), true);
  assert.equal(division.spansDivisions({ permissions: ['management_dashboard.view'] }), true);
  assert.equal(division.spansDivisions({ permissions: ['task.view'] }), false);
  assert.equal(division.sameDivision({ departmentId: 5 }, null), true);
  assert.equal(division.sameDivision({ departmentId: 5 }, '5'), true);
  assert.equal(division.sameDivision({ departmentId: 5 }, 3), false);
  assert.equal(division.sameDivision({ departmentId: null }, 3), false);
});

test('assertBoardAccess hides another division\'s board as 404 (pure)', () => {
  const finance = { sub: 1, entityId: 1, departmentId: 3, permissions: ['board.view'] };
  const board = { id: 9, entity_id: 1, department_id: 5, created_by: 2 };
  assert.throws(() => taskAccess.assertBoardAccess({ user: finance, board, action: 'view' }), (e) => e.status === 404);
  assert.doesNotThrow(() => taskAccess.assertBoardAccess({ user: { ...finance, sub: 2 }, board, action: 'view' }));
  assert.doesNotThrow(() => taskAccess.assertBoardAccess({ user: { ...finance, permissions: CROSS }, board, action: 'view' }));
  assert.throws(() => taskAccess.assertBoardAccess({ user: { ...finance, entityId: 2, permissions: CROSS }, board, action: 'view' }), (e) => e.status === 404);
});

/* ------------------------------------------------------------- DB fixtures */

async function people(conn) {
  const salesMember = await makeUser(conn, { name: 'Sales Anggota', division: 'sales', roles: ['sales.member'] });
  const salesOther = await makeUser(conn, { name: 'Sales Anggota 2', division: 'sales', roles: ['sales.member'] });
  const financeMember = await makeUser(conn, { name: 'Finance Anggota', division: 'finance', roles: ['finance.member'] });
  const financeOther = await makeUser(conn, { name: 'Finance Anggota 2', division: 'finance', roles: ['finance.member'] });
  const financeHead = await makeUser(conn, { name: 'Finance Head', division: 'finance', roles: ['finance.head'] });
  const moMember = await makeUser(conn, { name: 'MO Anggota', division: 'management_office', roles: ['management_office.member'] });
  const sales = await departmentId(conn, 'sales');
  const finance = await departmentId(conn, 'finance');
  return { salesMember, salesOther, financeMember, financeOther, financeHead, moMember, sales, finance };
}

async function board(conn, { dept, createdBy, name }) {
  const [r] = await conn.query('INSERT INTO boards (entity_id, department_id, name, created_by) VALUES (1, ?, ?, ?)', [dept, name, createdBy]);
  return r.insertId;
}

async function task(conn, { dept, boardId = null, title, reporter = null, assignee = null }) {
  const [r] = await conn.query(
    'INSERT INTO tasks (entity_id, department_id, board_id, title, reporter_id, assignee_id) VALUES (1, ?, ?, ?, ?, ?)',
    [dept, boardId, title, reporter, assignee],
  );
  return r.insertId;
}

/* ------------------------------------------------------------- tasks */

test('db: tasks are scoped per division; participants and management keep access', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = tag();
    const salesBoard = await board(conn, { dept: p.sales, createdBy: p.salesMember.id, name: `[UJI] Sales ${k}` });
    const salesTask = await task(conn, { dept: p.sales, boardId: salesBoard, title: `[UJI] Tugas sales ${k}`, reporter: p.salesMember.id });

    const finance = p.financeMember.user;
    // Cross-division GET / PATCH / DELETE and sub-resources answer 404.
    await rejects404(taskSvc.getTaskDetail({ taskId: salesTask, user: finance }));
    await rejects404(taskSvc.updateTask({ taskId: salesTask, patch: { title: 'diubah' }, user: finance }));
    await rejects404(taskSvc.deleteTask({ taskId: salesTask, user: finance }));
    await rejects404(taskSvc.addComment({ taskId: salesTask, user: finance, body: 'halo' }));
    const loaded = await taskAccess.loadTask(salesTask);
    await rejects404(watcherSvc.list({ task: loaded, user: finance }));
    await rejects404(checklistSvc.list({ task: loaded, user: finance }));
    await rejects404(taskSvc.listTasksByBoard({ boardId: salesBoard, user: finance }));

    // Own division and management.
    const detail = await taskSvc.getTaskDetail({ taskId: salesTask, user: p.salesOther.user });
    assert.equal(detail.id, salesTask);
    await taskSvc.updateTask({ taskId: salesTask, patch: { title: `[UJI] diubah ${k}` }, user: p.salesOther.user });
    assert.equal((await taskSvc.getTaskDetail({ taskId: salesTask, user: p.moMember.user })).id, salesTask);

    // A finance user who is the assignee, or a watcher, of a sales task may open it.
    const assigned = await task(conn, { dept: p.sales, title: `[UJI] Ditugaskan ${k}`, assignee: p.financeMember.id });
    assert.equal((await taskSvc.getTaskDetail({ taskId: assigned, user: finance })).id, assigned);
    const watched = await task(conn, { dept: p.sales, title: `[UJI] Dipantau ${k}` });
    await rejects404(taskSvc.getTaskDetail({ taskId: watched, user: finance }));
    await conn.query('INSERT INTO task_watchers (task_id, user_id) VALUES (?, ?)', [watched, p.financeMember.id]);
    assert.equal((await taskSvc.getTaskDetail({ taskId: watched, user: finance })).id, watched);

    // Deleting own-division task still works.
    assert.equal((await taskSvc.deleteTask({ taskId: salesTask, user: p.salesOther.user })).id, salesTask);
  });
});

test('db: dependency lists, graph and gantt leave out tasks of other divisions', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = tag();
    const salesTask = await task(conn, { dept: p.sales, title: `[UJI] Sales dep ${k}` });
    const financeTask = await task(conn, { dept: p.finance, title: `[UJI] Finance dep ${k}` });
    await conn.query("INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type, created_by) VALUES (?, ?, 'blocks', ?)", [salesTask, financeTask, p.salesMember.id]);
    const finance = p.financeMember.user;

    const own = await taskAccess.loadTask(financeTask);
    const deps = await dependencySvc.list({ task: own, user: finance });
    assert.equal(deps.blockedBy.length, 0, 'sales predecessor hidden');
    const graph = await dependencyGraphSvc.buildGraph({ taskId: financeTask, user: finance });
    assert.ok(!JSON.stringify(graph).includes(`Sales dep ${k}`));
    assert.equal((await dependencySvc.list({ task: own, user: p.moMember.user })).blockedBy.length, 1);

    // Linking to a task the user cannot see is refused as not found.
    const other = await task(conn, { dept: p.sales, title: `[UJI] Sales lain ${k}` });
    await rejects404(dependencySvc.add({ task: own, user: finance, predecessorTaskId: other, successorTaskId: financeTask }));

    const shown = async (user) => (await gantt.buildGantt({ user })).tasks.map((x) => Number(x.id));
    const forFinance = await shown(finance);
    assert.ok(forFinance.includes(financeTask) && !forFinance.includes(salesTask));
    assert.ok((await shown(p.moMember.user)).includes(salesTask));
  });
});

/* ------------------------------------------------------------- boards */

test('db: board list and detail are filtered by division', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = tag();
    const salesBoard = await board(conn, { dept: p.sales, createdBy: p.salesMember.id, name: `[UJI] Sales ${k}` });
    const financeBoard = await board(conn, { dept: p.finance, createdBy: p.financeOther.id, name: `[UJI] Finance ${k}` });
    const companyBoard = await board(conn, { dept: null, createdBy: p.salesMember.id, name: `[UJI] Umum ${k}` });
    const ownSalesBoard = await board(conn, { dept: p.sales, createdBy: p.financeMember.id, name: `[UJI] Buatan finance ${k}` });

    const ids = (rows) => rows.map((r) => Number(r.id));
    const forFinance = ids(await boardSvc.listBoards({ user: p.financeMember.user }));
    assert.ok(!forFinance.includes(salesBoard), 'sales board hidden from finance');
    assert.ok(forFinance.includes(financeBoard));
    assert.ok(forFinance.includes(companyBoard));
    assert.ok(forFinance.includes(ownSalesBoard), 'the creator keeps their board');
    // departmentId filter cannot widen the scope.
    assert.ok(!ids(await boardSvc.listBoards({ user: p.financeMember.user, filters: { departmentId: p.sales } })).includes(salesBoard));

    const forMo = ids(await boardSvc.listBoards({ user: p.moMember.user }));
    assert.ok(forMo.includes(salesBoard) && forMo.includes(financeBoard));

    await rejects404(boardSvc.getBoardDetail({ boardId: salesBoard, user: p.financeMember.user }));
    const manager = withPerms(p.financeMember.user, ['board.manage']);
    await rejects404(boardSvc.deleteBoard({ boardId: salesBoard, user: manager }));
    assert.equal((await boardSvc.getBoardDetail({ boardId: salesBoard, user: p.salesOther.user })).id, salesBoard);
  });
});

/* ------------------------------------------------------------- approvals */

async function approvalRequest(conn, { dept, requestedBy, title, subjectType = 'document' }) {
  const [r] = await conn.query(
    "INSERT INTO approval_requests (entity_id, department_id, subject_type, request_type, title, status, requested_by) VALUES (1, ?, ?, ?, ?, 'pending', ?)",
    [dept, subjectType, subjectType, title, requestedBy],
  );
  return r.insertId;
}

async function step(conn, { requestId, approverUserId = null, approverRoleId = null }) {
  const [r] = await conn.query(
    "INSERT INTO approval_steps (approval_request_id, level, order_index, approver_user_id, approver_role_id, status, activated_at) VALUES (?, 1, 1, ?, ?, 'pending', NOW())",
    [requestId, approverUserId, approverRoleId],
  );
  return r.insertId;
}

test('db: approval list/detail are division-scoped; requester and approvers keep access', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = tag();
    const salesReq = await approvalRequest(conn, { dept: p.sales, requestedBy: p.salesMember.id, title: `[UJI] Sales ${k}` });
    await step(conn, { requestId: salesReq });
    const askedFinance = await approvalRequest(conn, { dept: p.sales, requestedBy: p.salesMember.id, title: `[UJI] Minta finance ${k}` });
    await step(conn, { requestId: askedFinance, approverUserId: p.financeMember.id });
    const byFinance = await approvalRequest(conn, { dept: p.sales, requestedBy: p.financeMember.id, title: `[UJI] Diajukan finance ${k}` });
    await step(conn, { requestId: byFinance });

    const listIds = async (user) => {
      const res = await call(approvals.list, { user, query: { limit: '100' } });
      return res.body.data.map((r) => Number(r.id));
    };
    const finance = await listIds(p.financeMember.user);
    assert.ok(!finance.includes(salesReq), 'other division hidden');
    assert.ok(finance.includes(askedFinance), 'named approver sees it');
    assert.ok(finance.includes(byFinance), 'requester sees it');
    const mo = await listIds(p.moMember.user);
    assert.ok(mo.includes(salesReq) && mo.includes(askedFinance));

    assert.equal((await call(approvals.detail, { user: p.financeMember.user, params: { id: salesReq } })).statusCode, 404);
    assert.equal((await call(approvals.detail, { user: p.financeMember.user, params: { id: askedFinance } })).statusCode, 200);
    assert.equal((await call(approvals.detail, { user: p.salesOther.user, params: { id: salesReq } })).statusCode, 200);
    assert.equal((await call(approvals.myPendingSteps, { user: p.financeMember.user, params: { id: salesReq } })).statusCode, 404);
  });
});

test('db: the requester can never decide their own approval request', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const sup = await makeUser(conn, { name: 'Sales Supervisor', division: 'sales', roles: ['sales.supervisor'] });
    const sales = await departmentId(conn, 'sales');
    const req = await approvalRequest(conn, { dept: sales, requestedBy: sup.id, title: `[UJI] Sendiri ${tag()}` });
    const stepId = await step(conn, { requestId: req, approverUserId: sup.id });

    const res = await call(approvals.decide, { user: sup.user, params: { id: req }, body: { action: 'approve' } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'SELF_APPROVAL_FORBIDDEN');
    assert.equal(res.body.error.message, 'Anda tidak bisa memutuskan pengajuan Anda sendiri');

    const [[approval]] = await conn.query('SELECT * FROM approval_requests WHERE id = ?', [req]);
    await assert.rejects(engine.decideStep({
      approvalRequest: approval, stepId, action: 'approve', userId: sup.id, userRoleIds: [], userPermissions: sup.user.permissions, conn,
    }), (e) => e.status === 403 && e.message === 'Anda tidak bisa memutuskan pengajuan Anda sendiri');
    const [[s]] = await conn.query('SELECT status FROM approval_steps WHERE id = ?', [stepId]);
    assert.equal(s.status, 'pending');
  });
});

test('db: an unassigned step is decided only by a same-division approval.decide holder who is not the requester', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const req = await approvalRequest(conn, { dept: p.sales, requestedBy: p.salesMember.id, title: `[UJI] Tanpa approver ${tag()}` });
    const stepId = await step(conn, { requestId: req });
    const [[row]] = await conn.query('SELECT * FROM approval_steps WHERE id = ?', [stepId]);
    const can = (user) => engine.canDecide({ step: row, userId: user.sub, userRoleIds: [], userPermissions: user.permissions, entityId: 1, conn });

    assert.equal(await can(withPerms(p.salesOther.user, ['approval.decide'])), true, 'same division decider');
    assert.equal(await can(p.salesOther.user), false, 'no approval.decide');
    assert.equal(await can(withPerms(p.financeMember.user, ['approval.decide'])), false, 'other division');
    assert.equal(await can(withPerms(p.salesMember.user, ['approval.decide'])), false, 'requester');
    assert.equal(await can(withPerms(p.moMember.user, ['approval.decide'])), true, 'cross-division role');
  });
});

/* ------------------------------------------------------------- search */

test('db: global search hides other divisions\' tasks, documents and approvals', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = `cari${tag().replace(/[^0-9]/g, '')}`;
    const salesTask = await task(conn, { dept: p.sales, title: `[UJI] ${k} tugas sales` });
    const financeTask = await task(conn, { dept: p.finance, title: `[UJI] ${k} tugas finance` });
    const [sd] = await conn.query("INSERT INTO documents (entity_id, department_id, title, document_type, created_by) VALUES (1, ?, ?, 'memo', ?)", [p.sales, `[UJI] ${k} dok sales`, p.salesMember.id]);
    const [fd] = await conn.query("INSERT INTO documents (entity_id, department_id, title, document_type, created_by) VALUES (1, ?, ?, 'memo', ?)", [p.finance, `[UJI] ${k} dok finance`, p.financeOther.id]);
    const salesReq = await approvalRequest(conn, { dept: p.sales, requestedBy: p.salesMember.id, title: `[UJI] ${k} approval sales` });
    const financeReq = await approvalRequest(conn, { dept: p.finance, requestedBy: p.financeOther.id, title: `[UJI] ${k} approval finance` });

    const perms = ['search.global', 'task.view', 'document.view', 'approval.view'];
    const found = async (user) => {
      const r = await globalSearch.search({ user: withPerms(user, perms), q: k, types: ['task', 'document', 'approval_request'], limit: 50 });
      return new Set(r.rows.map((row) => `${row.type}:${row.id}`));
    };
    const finance = await found(p.financeMember.user);
    assert.ok(finance.has(`task:${financeTask}`) && finance.has(`document:${fd.insertId}`) && finance.has(`approval_request:${financeReq}`));
    assert.ok(!finance.has(`task:${salesTask}`) && !finance.has(`document:${sd.insertId}`) && !finance.has(`approval_request:${salesReq}`));
    const mo = await found(p.moMember.user);
    assert.ok(mo.has(`task:${salesTask}`) && mo.has(`document:${sd.insertId}`) && mo.has(`approval_request:${salesReq}`));
  });
});

/* ------------------------------------------------------------- documents */

test('db: documents are scoped to the entity and division; upload/link cannot target another division', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = `dok${tag().replace(/[^0-9]/g, '')}`;
    const insert = async (dept, by) => {
      const [r] = await conn.query("INSERT INTO documents (entity_id, department_id, title, document_type, created_by) VALUES (1, ?, ?, 'memo', ?)", [dept, `[UJI] ${k}`, by]);
      return r.insertId;
    };
    const salesDoc = await insert(p.sales, p.salesMember.id);
    const financeDoc = await insert(p.finance, p.financeOther.id);
    const companyDoc = await insert(null, p.salesMember.id);
    const ownInSales = await insert(p.sales, p.financeMember.id);

    const finance = p.financeMember.user;
    const listed = (await call(documents.list, { user: finance, query: { q: k, limit: '100' } })).body.data.map((r) => Number(r.id));
    assert.deepEqual(new Set(listed), new Set([financeDoc, companyDoc, ownInSales]));
    // entityId in the query string no longer widens anything.
    const other = (await call(documents.list, { user: finance, query: { q: k, entityId: '999' } })).body.data.map((r) => Number(r.id));
    assert.ok(!other.includes(salesDoc));

    assert.equal((await call(documents.detail, { user: finance, params: { id: salesDoc } })).statusCode, 404);
    assert.equal((await call(documents.versions, { user: finance, params: { id: salesDoc } })).statusCode, 404);
    assert.equal((await call(documents.update, { user: finance, params: { id: salesDoc }, body: { title: 'x', documentType: 'memo', status: 'draft' } })).statusCode, 404);
    assert.equal((await call(documents.remove, { user: finance, params: { id: salesDoc } })).statusCode, 404);
    assert.equal((await call(documents.detail, { user: p.moMember.user, params: { id: salesDoc } })).statusCode, 200);
    assert.equal((await call(documents.update, { user: p.salesOther.user, params: { id: salesDoc }, body: { title: `[UJI] ${k}`, documentType: 'memo', status: 'draft' } })).statusCode, 200);

    t.mock.method(drive, 'uploadFile', async () => { throw new Error('must not upload'); });
    const upload = await call(documents.upload, {
      user: finance,
      body: { entityId: 1, departmentId: p.sales, title: 'x', documentType: 'memo' },
      file: { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 1 },
    });
    assert.equal(upload.statusCode, 403);

    t.mock.method(drive, 'getFileMeta', async () => ({ id: `uji-${k}`, name: 'Uji', mimeType: 'application/pdf', webViewLink: null }));
    const linked = await call(documents.link, { user: finance, body: { entityId: 999, departmentId: p.finance, title: `[UJI] ${k} tautan`, documentType: 'memo', driveFileId: `uji-${k}` } });
    assert.equal(linked.statusCode, 201);
    const [[row]] = await conn.query('SELECT entity_id, department_id FROM documents WHERE id = ?', [linked.body.data.id]);
    assert.equal(Number(row.entity_id), 1, 'entity comes from the session, not the body');
    assert.equal(Number(row.department_id), p.finance);
  });
});

/* ------------------------------------------------------------- signatures */

test('db: signature requests are division-scoped but requester and signer keep access', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const [d] = await conn.query("INSERT INTO documents (entity_id, department_id, title, document_type, created_by) VALUES (1, ?, ?, 'memo', ?)", [p.sales, `[UJI] TTD ${tag()}`, p.salesMember.id]);
    const sig = async (signer) => {
      const [r] = await conn.query(
        "INSERT INTO signature_requests (entity_id, department_id, document_id, assigned_signer_user_id, status, requested_by) VALUES (1, ?, ?, ?, 'pending', ?)",
        [p.sales, d.insertId, signer, p.salesMember.id],
      );
      return r.insertId;
    };
    const plain = await sig(null);
    const forFinance = await sig(p.financeMember.id);

    const listed = (await call(signatures.list, { user: p.financeMember.user })).body.data.map((r) => Number(r.id));
    assert.ok(!listed.includes(plain));
    assert.ok(listed.includes(forFinance), 'assigned signer sees it');
    assert.equal((await call(signatures.detail, { user: p.financeMember.user, params: { id: plain } })).statusCode, 404);
    assert.equal((await call(signatures.detail, { user: p.financeMember.user, params: { id: forFinance } })).statusCode, 200);
    assert.equal((await call(signatures.detail, { user: p.salesMember.user, params: { id: plain } })).statusCode, 200);
  });
});

/* ------------------------------------------------------------- delegations */

test('db: approval delegations cannot be created for another division', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const endsAt = new Date(Date.now() + 7 * 86400e3).toISOString();
    const create = (user, fromUserId, toUserId) => call(delegations.create, { user, body: { fromUserId, toUserId, endsAt } });
    // A division Head without a cross-division permission (the intended policy).
    const head = withoutCross(withPerms(p.financeHead.user, ['approval_delegation.manage']));

    const crossDivision = await create(head, p.salesMember.id, p.financeOther.id);
    assert.equal(crossDivision.statusCode, 403);
    assert.equal((await create(head, p.financeMember.id, p.financeOther.id)).statusCode, 201, 'own division member');
    assert.equal((await create(withPerms(p.financeMember.user, ['approval_delegation.manage']), p.financeOther.id, p.financeHead.id)).statusCode, 403, 'a member delegates only for themself');
    assert.equal((await create(withPerms(p.salesOther.user, ['approval_delegation.manage']), p.salesOther.id, p.salesMember.id)).statusCode, 201, 'self');
    assert.equal((await create(withPerms(p.moMember.user, ['approval_delegation.manage']), p.salesMember.id, p.moMember.id)).statusCode, 201, 'cross-division role');

    // Updating or deleting another division's delegation is refused too.
    const [[row]] = await conn.query('SELECT id FROM approval_delegations WHERE from_user_id = ? ORDER BY id DESC LIMIT 1', [p.salesMember.id]);
    assert.equal((await call(delegations.update, { user: head, params: { id: row.id }, body: { reason: 'x' } })).statusCode, 403);
    assert.equal((await call(delegations.remove, { user: head, params: { id: row.id } })).statusCode, 403);
  });
});

test('db: the delegation list shows own delegations, a lead\'s division, or everything for cross-division roles', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const starts = new Date(Date.now() - 86400e3);
    const ends = new Date(Date.now() + 7 * 86400e3);
    const add = async (from, to) => {
      const [r] = await conn.query(
        `INSERT INTO approval_delegations (entity_id, from_user_id, to_user_id, starts_at, ends_at, reason, is_active, created_by)
         VALUES (1, ?, ?, ?, ?, 'uji daftar', 1, ?)`,
        [from, to, starts, ends, from],
      );
      return r.insertId;
    };
    const financeOnly = await add(p.financeMember.id, p.financeOther.id);
    const salesOnly = await add(p.salesMember.id, p.salesOther.id);
    const salesToFinance = await add(p.salesOther.id, p.financeMember.id);
    const mine = [financeOnly, salesOnly, salesToFinance];

    const view = (user) => withoutCross(withPerms(user, ['approval_delegation.view']));
    const seen = async (user, query = {}) => {
      const res = await call(delegations.list, { user, query });
      assert.equal(res.statusCode, 200);
      return res.body.data.map((row) => row.id).filter((id) => mine.includes(id)).sort((a, b) => a - b);
    };

    assert.deepEqual(await seen(view(p.financeMember.user)), [financeOnly, salesToFinance], 'delegator or delegate');
    assert.deepEqual(await seen(view(p.financeOther.user)), [financeOnly], 'delegate');
    assert.deepEqual(await seen(view(p.salesMember.user)), [salesOnly]);
    assert.deepEqual(await seen(view(p.financeHead.user)), [financeOnly], 'a Head: delegations given by members of the own division');
    assert.deepEqual(await seen(view(p.financeHead.user), { fromUserId: p.salesMember.id }), [], 'a filter never widens the scope');
    assert.deepEqual(await seen(withPerms(p.moMember.user, [...CROSS, 'approval_delegation.view'])), mine, 'Management Office');
    assert.deepEqual(await seen({ ...view(p.salesMember.user), permissions: ['approval_delegation.view', 'entity.cross_access'] }), mine, 'Super Admin');
    assert.deepEqual(await seen({ ...view(p.financeHead.user), departmentId: null }), [], 'a lead without a division sees only the own ones');
  });
});

/* ------------------------------------------------------------- activity logs */

test('db: activity logs are entity-scoped', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const k = `uji.${tag()}`.slice(0, 90);
    await conn.query("INSERT INTO activity_logs (entity_id, user_id, action, subject_type) VALUES (NULL, ?, ?, 'uji')", [p.moMember.id, k]);
    await conn.query("INSERT INTO activity_logs (entity_id, user_id, action, subject_type) VALUES (1, ?, ?, 'uji')", [p.moMember.id, k]);

    const viewer = withPerms(p.moMember.user, ['activity_log.view']);
    const rows = (await call(activityLogs.list, { user: viewer, query: { userId: String(p.moMember.id), limit: '100' } })).body.data;
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => Number(r.entityId) === 1), 'only the caller\'s entity');

    // A user without entity.cross_access cannot ask for another entity.
    const res = responseDouble();
    let passed = false;
    requireEntityScope({ user: viewer, query: { entityId: '999' }, body: {}, params: {} }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
  });
});
