// Prakasa AI reads daily work and documents (Wave B): tasks, Project Tracker,
// approvals, delegations, signature requests, documents, division storage and
// document templates. The tools run against the real services and the real
// local schema inside ONE transaction that is always rolled back (nothing is
// left behind, nothing is notified, Google is never called).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = '../src';
const { pool, dbReady, inRolledBackTransaction, makeUser, departmentId, tag } = require('./fixtures/gaDb');
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const { PERSONAL_KEY, MONEY_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const registry = require(`${B}/services/aiToolRegistry.service`);
const taskService = require(`${B}/services/task.service`);
const trackerChat = require(`${B}/services/trackerChat.service`);
const chatUser = require(`${B}/services/googleChatUser.service`);
const lifecycle = require(`${B}/services/approvalSubjectLifecycle.service`);
const approvalRead = require(`${B}/services/approvalRead.service`);
const notification = require(`${B}/services/notification.service`);

test.after(() => pool.end());

const FILES = ['work.js', 'approvals.js', 'documents.js'];
const NAMES = [
  'tugas_saya', 'detail_tugas', 'ringkasan_papan', 'proyek_saya', 'issue_saya',
  'persetujuan_menunggu_saya', 'pengajuan_saya', 'delegasi_persetujuan_saya', 'tanda_tangan_saya',
  'cari_dokumen', 'dokumen_divisi', 'template_dokumen',
];
const PAGE_KEYS = ['tasks', 'projects', 'approvals', 'approval-delegations', 'signatures', 'documents', 'division-storage', 'templates', 'doc-templates'];
const tool = (name) => agentTools.byName.get(name);
const run = (name, user, input = {}) => tool(name).run(user, input);
const MONEY = 987654321;
const BAIT = 'SENTINEL-RAHASIA';

function keysMatching(pattern, value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => keysMatching(pattern, item, found));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (pattern.test(key)) found.push(key);
      keysMatching(pattern, child, found);
    }
  }
  return found;
}

// Every result of this file: no rupiah-shaped or personal key, no bait, no amount.
function assertSafe(out, label) {
  const json = JSON.stringify(out);
  assert.deepEqual(keysMatching(MONEY_KEY, out), [], `${label}: rupiah key`);
  assert.deepEqual(keysMatching(PERSONAL_KEY, out), [], `${label}: personal key`);
  assert.ok(!json.includes(String(MONEY)), `${label}: leaked an amount`);
  assert.ok(!json.includes(BAIT), `${label}: leaked bait`);
  return json;
}

// Records every statement the services run, to prove the tools only read.
function recordSql(conn) {
  const seen = [];
  const original = conn.query.bind(conn);
  conn.query = (...args) => { seen.push(String(args[0]?.sql || args[0])); return original(...args); };
  // fixture(fn): rows the test itself writes between tool calls are not the tools' statements.
  const fixture = async (fn) => {
    const mine = conn.query;
    conn.query = original;
    try { return await fn(); } finally { conn.query = mine; }
  };
  return { seen, fixture, restore: () => { conn.query = original; } };
}

function noSideEffects(t) {
  t.mock.method(notification, 'create', async () => { throw new Error('a read tool must not notify'); });
  t.mock.method(chatUser, 'getSpace', async () => { throw new Error('a read tool must not call Google here'); });
  t.mock.method(chatUser, 'createMessage', async () => { throw new Error('a read tool must not post to a space'); });
}

async function people(conn) {
  const mk = (name, division, role) => makeUser(conn, { name: `AI ${name}`, division, roles: [role], withPerson: false });
  const out = {
    salesMember: await mk('Sales Member', 'sales', 'sales.member'),
    salesMember2: await mk('Sales Member 2', 'sales', 'sales.member'),
    salesSup: await mk('Sales Sup', 'sales', 'sales.supervisor'),
    salesHead: await mk('Sales Head', 'sales', 'sales.head'),
    finMember: await mk('Finance Member', 'finance', 'finance.member'),
    finHead: await mk('Finance Head', 'finance', 'finance.head'),
    moHead: await mk('MO Head', 'management_office', 'management_office.head'),
  };
  for (const [key, person] of Object.entries(out)) person.user.email = `${key.toLowerCase()}@uji.invalid`;
  return out;
}

async function insert(conn, table, row) {
  const [result] = await conn.query(`INSERT INTO ${table} SET ?`, [row]);
  return result.insertId;
}

// ---------------------------------------------------------------- contract

test('the work, approval and document tools exist, keep the contract and serve their nine page keys', () => {
  const files = agentTools.toolFiles();
  for (const file of FILES) assert.ok(files.includes(file), file);
  const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
  const mine = agentTools.TOOLS.filter((t) => FILES.includes(t.file));
  assert.deepEqual(mine.map((t) => t.name).sort(), [...NAMES].sort());
  assert.deepEqual(contract.validateTools(mine, { moduleKeys }), []);
  const served = new Set(mine.flatMap((t) => t.module));
  for (const key of PAGE_KEYS) assert.ok(served.has(key), `${key} has a tool`);
  for (const t of mine) {
    assert.equal(t.privateOnly, true, `${t.name}: division or own data → private conversations only`);
    assert.notEqual(t.money, true, `${t.name}: these tools never carry rupiah`);
    assert.match(t.name, /^[a-z_]+$/);
    assert.match(t.description, contract.NOT_RETURNED);
    assert.ok(agentTools.PRIVATE_ONLY_TOOLS.includes(t.name));
  }
  // The page's own read permission.
  const perm = (name) => tool(name).permission;
  assert.equal(perm('tugas_saya'), 'task.view');
  assert.equal(perm('detail_tugas'), 'task.view');
  assert.equal(perm('ringkasan_papan'), 'task.view');
  assert.equal(perm('proyek_saya'), 'google.chat.use');
  assert.equal(perm('issue_saya'), 'google.chat.use');
  assert.equal(perm('persetujuan_menunggu_saya'), 'approval.view');
  assert.equal(perm('pengajuan_saya'), 'approval.view');
  assert.equal(perm('delegasi_persetujuan_saya'), 'approval_delegation.view');
  assert.equal(perm('tanda_tangan_saya'), 'signature.view');
  assert.equal(perm('cari_dokumen'), 'document.view');
  assert.equal(perm('dokumen_divisi'), 'document.view');
  assert.equal(perm('template_dokumen'), 'template.view');
  for (const t of mine) {
    for (const key of t.module.filter((m) => m !== 'general')) {
      assert.ok([].concat(registry.TOOLS_BY_KEY.get(key).readPermission).includes(t.permission), `${t.name} uses the read permission of ${key}`);
    }
  }
});

test('the tool files hold no SQL, no database handle, no Google client and nothing that writes or sends', () => {
  for (const file of FILES) {
    const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, file), 'utf8');
    assert.doesNotMatch(code, /db\/pool|\.query\(|googleapis|googleDrive|googleChat\.service|googleChatUser|notification\.service|gmail/i, file);
    assert.doesNotMatch(code, /\b(SELECT|INSERT|UPDATE|DELETE)\s/, file);
    assert.doesNotMatch(code, /createTask|updateTask|deleteTask|addComment|decideStep|createApprovalRequest|requestRevision|withdrawRequest|createIssue|updateIssue|postUpdate|generate\(/, file);
  }
  // The read services added for these tools only SELECT.
  for (const file of ['approvalRead.service.js', 'signatureRead.service.js', 'documentRead.service.js']) {
    const code = fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8');
    assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|REPLACE INTO)\b/i, file);
    assert.doesNotMatch(code, /googleapis|googleDrive|googleChat|notification\.service|activityLog/, file);
  }
});

test('without the permission a tool refuses (403) and is not offered; in a shared chat or with web research none is offered', async () => {
  const nobody = { sub: 1, entityId: 1, departmentId: 5, permissions: [] };
  for (const name of NAMES) {
    await assert.rejects(run(name, nobody, {}), (e) => e.status === 403 && e.code === 'FORBIDDEN', name);
  }
  assert.deepEqual(agentTools.toolsFor(nobody, { visibility: 'private' }).map((t) => t.name).filter((n) => NAMES.includes(n)), []);

  const all = { sub: 1, entityId: 1, permissions: ['task.view', 'google.chat.use', 'approval.view', 'approval_delegation.view', 'signature.view', 'document.view', 'template.view'] };
  const offered = (session) => agentTools.toolsFor(all, session).map((t) => t.name).filter((n) => NAMES.includes(n));
  assert.deepEqual(offered({ visibility: 'private' }).sort(), [...NAMES].sort());
  assert.deepEqual(offered({ visibility: 'department' }), []);
  assert.deepEqual(offered({ visibility: 'entity' }), []);
  assert.deepEqual(offered({ visibility: 'private', web_research: 1 }), []);
  assert.deepEqual(offered(null), []);

  // One permission opens only its own tools.
  const onlyTasks = { sub: 1, entityId: 1, permissions: ['task.view'] };
  assert.deepEqual(agentTools.toolsFor(onlyTasks, { visibility: 'private' }).map((t) => t.name).filter((n) => NAMES.includes(n)), ['tugas_saya', 'detail_tugas', 'ringkasan_papan']);
  // A member has no approval_delegation.view (Supervisor/Head only).
  const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
  for (const role of STANDARD_ROLES.filter((r) => r.key.endsWith('.member'))) {
    assert.equal(role.permissions.includes('approval_delegation.view'), false, role.key);
  }
});

test('the size cap: a tool never asks its service for more than 50 rows, and a runaway list is cut to 100 and marked', async (t) => {
  const user = { sub: 1, entityId: 1, departmentId: 5, permissions: ['task.view'] };
  let asked = null;
  t.mock.method(taskService, 'listTasksForUser', async ({ filters }) => {
    asked = filters;
    return {
      counts: { open: 150, overdue: 0, dueSoon: 0, done: 0 },
      total: 150,
      rows: Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: `Tugas ${i}`, status: 'open', priority: 'normal' })),
    };
  });
  const out = await run('tugas_saya', user, { jumlah: 999 });
  assert.ok(asked.limit <= 50);
  assert.equal(asked.mine, true, 'default scope is the user\'s own tasks');
  assert.equal(out.tugas.length, contract.MAX_LIST_ITEMS);
  assert.equal(out.terpotong, true);
  await run('tugas_saya', user, {});
  assert.equal(asked.limit, 20);
});

test('the page of an approval is the module page where a human decides, never the closed /approvals page', () => {
  assert.equal(approvalRead.pageOf({ subjectType: 'ga_request', subjectId: 5 }), '/ga/requests/5');
  assert.equal(approvalRead.pageOf({ subjectType: 'finance_payment_request', subjectId: 9 }), '/finance/payment-requests/9');
  assert.equal(approvalRead.pageOf({ subjectType: 'sales_accurate_batch', subjectId: 3 }), '/data-accurate/3');
  assert.equal(approvalRead.pageOf({ subjectType: 'warehouse_inbound', subjectId: 2 }), '/warehouse/movements/inbound/2');
  assert.equal(approvalRead.pageOf({ subjectType: 'document', subjectId: 2 }), null);
  assert.equal(approvalRead.pageOf({ subjectType: 'ga_request', subjectId: null }), null);
});

// ---------------------------------------------------------------- tasks

test('tasks: a member sees own and own-division tasks only; another division gets "tidak ditemukan"; Management Office sees across', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  noSideEffects(t);
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const mark = `[UJI-AI ${tag()}]`;
    const sales = await departmentId(conn, 'sales');
    const finance = await departmentId(conn, 'finance');
    const finBoard = await insert(conn, 'boards', { entity_id: 1, department_id: finance, name: `${mark} Papan Finance`, created_by: p.finHead.id });
    const finCol = await insert(conn, 'board_columns', { board_id: finBoard, name: 'To Do', position: 0, wip_limit: 3 });
    const salesBoard = await insert(conn, 'boards', { entity_id: 1, department_id: sales, name: `${mark} Papan Sales`, created_by: p.salesHead.id });
    const salesCol = await insert(conn, 'board_columns', { board_id: salesBoard, name: 'To Do', position: 0 });
    const base = { entity_id: 1, status: 'open', priority: 'normal' };
    const t1 = await insert(conn, 'tasks', { ...base, department_id: sales, board_id: salesBoard, column_id: salesCol, title: `${mark} Tugas A`, description: 'Siapkan penawaran', assignee_id: p.salesMember.id, reporter_id: p.salesHead.id, due_date: '2020-01-05' });
    const t2 = await insert(conn, 'tasks', { ...base, department_id: sales, board_id: salesBoard, column_id: salesCol, title: `${mark} Tugas B`, assignee_id: p.salesMember2.id, reporter_id: p.salesHead.id });
    const t3 = await insert(conn, 'tasks', { ...base, department_id: finance, board_id: finBoard, column_id: finCol, title: `${mark} Tugas Finance`, assignee_id: p.finMember.id, reporter_id: p.finHead.id });
    await insert(conn, 'tasks', { ...base, department_id: sales, title: `${mark} Tugas Selesai`, status: 'done', assignee_id: p.salesMember.id, reporter_id: p.salesMember.id });
    await insert(conn, 'task_checklist_items', { task_id: t1, title: 'Hitung kebutuhan', is_done: 1, position: 0, created_by: p.salesHead.id });
    await insert(conn, 'task_checklist_items', { task_id: t1, title: 'Minta tanda tangan', is_done: 0, position: 1, created_by: p.salesHead.id });
    await insert(conn, 'task_dependencies', { predecessor_task_id: t2, successor_task_id: t1, dependency_type: 'blocks', created_by: p.salesHead.id });
    await insert(conn, 'task_dependencies', { predecessor_task_id: t3, successor_task_id: t1, dependency_type: 'blocks', created_by: p.salesHead.id });
    await insert(conn, 'task_comments', { task_id: t1, user_id: p.salesHead.id, body: 'Tolong selesaikan minggu ini' });

    const sql = recordSql(conn);
    const titles = (out) => out.tugas.map((x) => x.judul.replace(`${mark} `, '')).sort();

    // Member: own tasks by default.
    const mine = await run('tugas_saya', p.salesMember.user, { cari: mark });
    assert.deepEqual(titles(mine), ['Tugas A', 'Tugas Selesai']);
    assert.deepEqual(mine.ringkasan, { aktif: 1, terlambat: 1, jatuh_tempo_7_hari: 0, selesai: 1 });
    const a = mine.tugas.find((x) => x.id === t1);
    assert.equal(a.tenggat, '2020-01-05');
    assert.ok(a.terlambat_hari > 365);
    assert.equal(a.peran_anda, 'penanggung jawab');
    assert.equal(a.rute, `/tasks/${t1}`);
    assert.match(a.papan, /Papan Sales/);
    assertSafe(mine, 'tugas_saya');
    assert.deepEqual(titles(await run('tugas_saya', p.salesMember.user, { cari: mark, status: 'terlambat' })), ['Tugas A']);
    assert.deepEqual(titles(await run('tugas_saya', p.salesMember.user, { cari: mark, status: 'selesai' })), ['Tugas Selesai']);

    // Division scope: own division, never Finance.
    const division = await run('tugas_saya', p.salesMember.user, { cari: mark, cakupan: 'divisi' });
    assert.deepEqual(titles(division), ['Tugas A', 'Tugas B', 'Tugas Selesai']);
    assert.deepEqual(titles(await run('tugas_saya', p.finMember.user, { cari: mark, cakupan: 'divisi' })), ['Tugas Finance']);
    assert.deepEqual(titles(await run('tugas_saya', p.finMember.user, { cari: mark, cakupan: 'divisi', papan_id: salesBoard })), []);
    // Management Office spans divisions (management_dashboard.view), as on the page.
    assert.deepEqual(titles(await run('tugas_saya', p.moHead.user, { cari: mark, cakupan: 'divisi' })), ['Tugas A', 'Tugas B', 'Tugas Finance', 'Tugas Selesai']);
    assert.deepEqual(titles(await run('tugas_saya', p.moHead.user, { cari: mark })), [], 'own scope: nothing is assigned to the MO head');

    // Detail: checklist, dependencies (the Finance task is hidden from Sales), comments.
    const detail = await run('detail_tugas', p.salesMember.user, { tugas_id: t1 });
    assert.equal(detail.ditemukan, true);
    assert.equal(detail.terlambat, true);
    assert.deepEqual(detail.checklist, { selesai: 1, total: 2, persen: 50, butir: [{ judul: 'Hitung kebutuhan', selesai: true }, { judul: 'Minta tanda tangan', selesai: false }] });
    assert.deepEqual(detail.ketergantungan.harus_selesai_dulu.map((x) => x.id), [t2]);
    assert.equal(detail.komentar_terakhir[0].isi, 'Tolong selesaikan minggu ini');
    assert.match(detail.papan.nama, /Papan Sales/);
    assert.equal(detail.kolom, 'To Do');
    assertSafe(detail, 'detail_tugas');
    const foreign = await run('detail_tugas', p.finMember.user, { tugas_id: t1 });
    assert.equal(foreign.ditemukan, false);
    assert.ok(!JSON.stringify(foreign).includes('Tugas A'));
    assert.equal((await run('detail_tugas', p.salesMember.user, { tugas_id: t3 })).ditemukan, false);
    assert.equal((await run('detail_tugas', p.moHead.user, { tugas_id: t3 })).ditemukan, true);
    assert.equal((await run('detail_tugas', p.salesMember.user, { tugas_id: 2147483000 })).ditemukan, false);

    // Boards.
    const boardNames = (out) => out.papan.map((b) => b.nama).filter((n) => n.startsWith(mark));
    assert.deepEqual(boardNames(await run('ringkasan_papan', p.salesMember.user, {})), [`${mark} Papan Sales`]);
    assert.deepEqual(boardNames(await run('ringkasan_papan', p.finMember.user, {})), [`${mark} Papan Finance`]);
    assert.equal(boardNames(await run('ringkasan_papan', p.moHead.user, {})).length, 2);
    const board = await run('ringkasan_papan', p.salesMember.user, { papan_id: salesBoard });
    assert.equal(board.ditemukan, true);
    assert.equal(board.total_tugas, 2);
    assert.equal(board.terlambat, 1);
    assert.deepEqual(board.per_kolom, [{ kolom: 'To Do', jumlah: 2, batas_wip: null }]);
    assert.deepEqual(board.tugas_terlambat.map((x) => x.id), [t1]);
    assert.equal(board.beban_per_orang.length, 2);
    assertSafe(board, 'ringkasan_papan');
    assert.equal((await run('ringkasan_papan', p.salesMember.user, { papan_id: finBoard })).ditemukan, false);
    assert.equal((await run('ringkasan_papan', p.finMember.user, { papan_id: finBoard })).per_kolom[0].batas_wip, 3);

    sql.restore();
    assert.ok(sql.seen.length > 20);
    for (const statement of sql.seen) assert.match(statement.trim(), /^\(?\s*SELECT\b/i, `only reads: ${statement.slice(0, 80)}`);
  });
});

// ---------------------------------------------------------------- Project Tracker

test('Project Tracker: only projects whose Chat space the user is a member of; a Google failure is "tidak tersedia", never a guess', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  noSideEffects(t);
  await inRolledBackTransaction(t, async (conn) => {
    trackerChat.clearCaches();
    const p = await people(conn);
    const mark = `[UJI-AI ${tag()}]`;
    const key = (n) => `U${String(Date.now()).slice(-5)}${n}`;
    const spaceA = `spaces/UJI-A-${tag()}`;
    const spaceB = `spaces/UJI-B-${tag()}`;
    const mkProject = async (name, space, k) => {
      const board = await insert(conn, 'boards', { entity_id: 1, name: `${mark} ${name}`, project_key: k, google_chat_space_name: space, created_by: p.salesHead.id });
      const todo = await insert(conn, 'board_columns', { board_id: board, name: 'To Do', position: 0, category: 'todo' });
      const done = await insert(conn, 'board_columns', { board_id: board, name: 'Done', position: 1, category: 'done' });
      return { board, todo, done };
    };
    const a = await mkProject('Proyek A', spaceA, key('A'));
    const b = await mkProject('Proyek B', spaceB, key('B'));
    const sprint = await insert(conn, 'tracker_sprints', { board_id: a.board, name: 'Sprint 1', goal: 'Rilis', start_date: new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10), end_date: new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10), status: 'active', created_by: p.salesHead.id });
    const issue = (board, column, title, extra = {}) => insert(conn, 'tasks', {
      entity_id: 1, board_id: board, column_id: column, title: `${mark} ${title}`, status: 'open', priority: 'high', issue_type: 'task', source_type: 'tracker', ...extra,
    });
    const i1 = await issue(a.board, a.todo, 'Issue saya', { issue_number: 1, assignee_id: p.salesMember.id, sprint_id: sprint, story_points: 3, due_date: '2020-02-02' });
    await issue(a.board, a.done, 'Issue selesai', { issue_number: 2, assignee_id: p.salesMember.id, sprint_id: sprint, story_points: 2, status: 'done', completed_at: new Date(Date.now() - 3 * 86400e3) });
    await issue(a.board, a.todo, 'Issue orang lain', { issue_number: 3, assignee_id: p.salesMember2.id });
    await issue(b.board, b.todo, 'Issue di proyek B', { issue_number: 1, assignee_id: p.salesMember.id });

    // Chat decides membership; here: the member is in space A only, the Finance member in none.
    let asked = 0;
    t.mock.method(trackerChat, 'assertMember', async (user, spaceName) => {
      asked += 1;
      if (Number(user.sub) === p.salesMember.id && spaceName === spaceA) return { name: spaceName, displayName: 'A', spaceType: 'SPACE' };
      throw Object.assign(new Error('Anda bukan anggota space ini'), { status: 403, code: 'FORBIDDEN' });
    });

    const sql = recordSql(conn);
    const list = await run('proyek_saya', p.salesMember.user, {});
    assert.equal(list.tersedia, true);
    assert.deepEqual(list.proyek.map((x) => x.nama), [`${mark} Proyek A`]);
    assert.equal(list.proyek[0].issue_terbuka, 2);
    assert.equal(list.proyek[0].issue_selesai, 1);
    assert.equal(list.proyek[0].issue_terlambat, 1);
    assert.equal(list.proyek[0].sprint_aktif.nama, 'Sprint 1');
    assert.equal(list.proyek[0].rute, `/projects/${spaceA.split('/')[1]}`);
    assert.ok(asked > 0, 'membership was checked');
    assertSafe(list, 'proyek_saya');

    const sprintStatus = await run('proyek_saya', p.salesMember.user, { proyek_id: a.board });
    assert.equal(sprintStatus.ditemukan, true);
    assert.equal(sprintStatus.sprint_aktif.poin, 5);
    assert.equal(sprintStatus.sprint_aktif.poin_selesai, 2);
    assert.equal(sprintStatus.sprint_aktif.sisa_poin, 3);
    assert.deepEqual(sprintStatus.per_status.map((s) => [s.status, s.jumlah]), [['belum_mulai', 2], ['dikerjakan', 0], ['selesai', 1]]);
    assert.ok(!JSON.stringify(sprintStatus).includes('@'), 'no email address in a report');
    assertSafe(sprintStatus, 'proyek_saya detail');
    assert.equal((await run('proyek_saya', p.salesMember.user, { proyek_id: b.board })).ditemukan, false, 'not a member of space B');

    const issues = await run('issue_saya', p.salesMember.user, {});
    assert.deepEqual(issues.issue.map((x) => x.judul), [`${mark} Issue saya`]);
    assert.equal(issues.issue[0].terlambat, true);
    assert.equal(issues.issue[0].di_sprint_aktif, true);
    assert.equal(issues.issue[0].rute, `/projects/${spaceA.split('/')[1]}?issue=${i1}`);
    assert.equal(issues.terlambat, 1);
    assertSafe(issues, 'issue_saya');
    assert.deepEqual((await run('issue_saya', p.salesMember.user, { status: 'selesai' })).issue.map((x) => x.judul), [`${mark} Issue selesai`]);
    assert.equal((await run('issue_saya', p.salesMember.user, { proyek_id: b.board })).ditemukan, false);

    // Someone in no space: nothing, whatever their division or role.
    for (const person of [p.finMember, p.salesMember2, p.moHead]) {
      assert.deepEqual((await run('proyek_saya', person.user, {})).proyek, []);
      assert.deepEqual((await run('issue_saya', person.user, {})).issue, []);
    }

    // Tracker issues never show through the task tools (their rule is space membership).
    const viaTasks = await run('tugas_saya', p.salesMember.user, { cari: mark, cakupan: 'divisi' });
    assert.deepEqual(viaTasks.tugas, []);
    assert.equal((await run('ringkasan_papan', p.salesMember.user, { papan_id: a.board })).ditemukan, false);
    assert.ok(!(await run('ringkasan_papan', p.salesMember.user, {})).papan.some((x) => x.nama.startsWith(mark)));

    sql.restore();
    for (const statement of sql.seen) assert.match(statement.trim(), /^\(?\s*SELECT\b/i, `only reads: ${statement.slice(0, 80)}`);

    // Google unreachable / account not linked.
    trackerChat.assertMember.mock.mockImplementation(async () => { throw new Error('invalid_grant'); });
    const down = await run('proyek_saya', p.salesMember.user, {});
    assert.equal(down.tersedia, false);
    assert.match(down.catatan, /belum bisa dibaca/);
    assert.equal('proyek' in down, false);
    assert.equal((await run('issue_saya', p.salesMember.user, {})).tersedia, false);
  });
});

// ---------------------------------------------------------------- approvals, delegations, signatures

test('approvals: what waits for MY decision (with the module page), my own requests and history; other divisions see nothing; no amount ever', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  noSideEffects(t);
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const mark = `[UJI-AI ${tag()}]`;
    const sales = await departmentId(conn, 'sales');
    // The owning module's own rule (here Layanan GA) is asked too; it has no row for this fixture.
    const asked = [];
    t.mock.method(lifecycle, 'canUserDecide', async ({ approval, user }) => { asked.push([approval.id, user.sub]); return true; });

    const request = (row) => insert(conn, 'approval_requests', {
      entity_id: 1, department_id: sales, title: `${mark} Pengajuan`, description: `${BAIT} Rp ${MONEY}`, amount: MONEY, currency: 'IDR',
      status: 'pending', requested_by: p.salesMember.id, ...row,
    });
    const r1 = await request({ subject_type: 'ga_request', request_type: 'ga_request_other', subject_id: 4242, title: `${mark} Permintaan GA` });
    await insert(conn, 'approval_steps', { approval_request_id: r1, level: 1, order_index: 0, approver_user_id: p.salesHead.id, status: 'pending', activated_at: new Date(Date.now() - 3 * 86400e3), deadline_at: new Date(Date.now() - 86400e3) });
    const r2 = await request({ subject_type: 'document', request_type: 'document', title: `${mark} Dokumen ditolak`, status: 'rejected', decided_by: p.salesHead.id, decided_at: new Date(), decision_note: 'Lampiran kurang' });
    await insert(conn, 'approval_steps', { approval_request_id: r2, level: 1, order_index: 0, approver_user_id: p.salesHead.id, status: 'rejected', activated_at: new Date(), decided_by: p.salesHead.id, decided_at: new Date(), note: 'Lampiran kurang' });
    // A request the Sales head made himself: he never decides his own.
    const r3 = await request({ subject_type: 'document', request_type: 'document', title: `${mark} Milik Head`, requested_by: p.salesHead.id });
    await insert(conn, 'approval_steps', { approval_request_id: r3, level: 1, order_index: 0, approver_user_id: p.salesHead.id, status: 'pending', activated_at: new Date() });

    const sql = recordSql(conn);
    const waitingOf = async (person) => (await run('persetujuan_menunggu_saya', person.user, { jumlah: 50 })).pengajuan.filter((x) => x.judul.startsWith(mark));

    const head = await run('persetujuan_menunggu_saya', p.salesHead.user, { jumlah: 50 });
    const mineToDecide = head.pengajuan.filter((x) => x.judul.startsWith(mark));
    assert.deepEqual(mineToDecide.map((x) => x.id), [r1], 'only the active step assigned to me, never my own request');
    assert.equal(mineToDecide[0].rute, '/ga/requests/4242');
    assert.equal(mineToDecide[0].modul, 'Layanan GA — permintaan');
    assert.equal(mineToDecide[0].lewat_tenggat, true);
    assert.equal(mineToDecide[0].jalur, 'ditunjuk langsung');
    assert.equal(mineToDecide[0].divisi, 'Sales');
    assert.match(mineToDecide[0].diajukan_oleh, /Sales Member/);
    assert.match(head.keputusan, /Prakasa AI hanya membaca/);
    assert.ok(head.total_menunggu >= 1);
    assert.ok(asked.some(([id, sub]) => id === r1 && sub === p.salesHead.id), 'the module rule was asked');
    assertSafe(head, 'persetujuan_menunggu_saya');

    // Nobody else has it waiting: not the requester, not a colleague, not Finance, not even the MO head.
    for (const person of [p.salesMember, p.salesMember2, p.salesSup, p.finMember, p.finHead, p.moHead]) {
      assert.deepEqual(await waitingOf(person), [], 'nothing waits for this user');
    }
    const member = await run('persetujuan_menunggu_saya', p.salesMember.user, {});
    assert.equal(member.total_menunggu, 0);
    assert.match(member.catatan, /tidak memutuskan/);
    // The module's own rule can still say no (e.g. separation of duties).
    lifecycle.canUserDecide.mock.mockImplementation(async () => false);
    assert.deepEqual(await waitingOf(p.salesHead), []);
    lifecycle.canUserDecide.mock.mockImplementation(async () => true);

    // My own requests.
    const own = await run('pengajuan_saya', p.salesMember.user, {});
    const ownRows = own.pengajuan.filter((x) => x.judul.startsWith(mark));
    assert.deepEqual(ownRows.map((x) => x.id).sort(), [r1, r2].sort());
    assert.deepEqual(own.ringkasan, { menunggu: 1, disetujui: 0, ditolak: 1, perlu_revisi: 0, dibatalkan: 0 });
    const pending = ownRows.find((x) => x.id === r1);
    assert.equal(pending.status, 'menunggu');
    assert.match(pending.menunggu, /Sales Head/);
    assert.equal(pending.rute, '/ga/requests/4242');
    assertSafe(own, 'pengajuan_saya');
    assert.deepEqual((await run('pengajuan_saya', p.salesMember.user, { status: 'ditolak' })).pengajuan.map((x) => x.id), [r2]);
    assert.deepEqual((await run('pengajuan_saya', p.finMember.user, {})).pengajuan, [], 'a new user has no requests');

    const history = await run('pengajuan_saya', p.salesMember.user, { pengajuan_id: r2 });
    assert.equal(history.ditemukan, true);
    assert.equal(history.status, 'ditolak');
    assert.equal(history.milik_anda, true);
    assert.equal(history.catatan_keputusan, 'Lampiran kurang');
    assert.equal(history.tahap.length, 1);
    assert.equal(history.tahap[0].status, 'ditolak');
    assert.match(history.tahap[0].diputuskan_oleh, /Sales Head/);
    assert.equal(history.rute, null);
    assert.match(history.catatan, /tidak punya halaman sendiri/);
    assertSafe(history, 'pengajuan_saya detail');

    // Division isolation of one request: Finance never; Sales colleagues and the MO head by the page's rule.
    for (const person of [p.finMember, p.finHead]) {
      const out = await run('pengajuan_saya', person.user, { pengajuan_id: r1 });
      assert.equal(out.ditemukan, false);
      assert.ok(!JSON.stringify(out).includes('Permintaan GA'));
    }
    assert.equal((await run('pengajuan_saya', p.salesHead.user, { pengajuan_id: r1 })).milik_anda, false);
    assert.equal((await run('pengajuan_saya', p.moHead.user, { pengajuan_id: r1 })).ditemukan, true);

    sql.restore();
    assert.ok(sql.seen.length > 20);
    for (const statement of sql.seen) assert.match(statement.trim(), /^\(?\s*SELECT\b/i, `only reads: ${statement.slice(0, 80)}`);
    const [[still]] = await conn.query('SELECT status FROM approval_requests WHERE id = ?', [r1]);
    assert.equal(still.status, 'pending', 'reading never decides');
  });
});

test('delegations and signature requests: only the ones that involve me', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  noSideEffects(t);
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const mark = `[UJI-AI ${tag()}]`;
    const sales = await departmentId(conn, 'sales');
    const soon = new Date(Date.now() + 5 * 86400e3);
    await insert(conn, 'approval_delegations', { entity_id: 1, from_user_id: p.salesHead.id, to_user_id: p.salesSup.id, starts_at: new Date(Date.now() - 86400e3), ends_at: soon, reason: `${mark} cuti`, is_active: 1, created_by: p.salesHead.id });
    await insert(conn, 'approval_delegations', { entity_id: 1, from_user_id: p.salesHead.id, to_user_id: p.salesSup.id, starts_at: new Date('2020-01-01'), ends_at: new Date('2020-01-05'), reason: `${mark} lama`, is_active: 1, created_by: p.salesHead.id });

    const sql = recordSql(conn);
    const given = await run('delegasi_persetujuan_saya', p.salesHead.user, {});
    assert.equal(given.saya_berikan.length, 1);
    assert.equal(given.saya_terima.length, 0);
    assert.match(given.saya_berikan[0].kepada, /Sales Sup/);
    assert.equal(given.saya_berikan[0].sedang_berlaku, true);
    assert.equal(given.saya_berikan[0].untuk_jenis_pengajuan, 'semua jenis');
    assertSafe(given, 'delegasi');
    assert.equal((await run('delegasi_persetujuan_saya', p.salesHead.user, { termasuk_berakhir: true })).saya_berikan.length, 2);
    const received = await run('delegasi_persetujuan_saya', p.salesSup.user, {});
    assert.equal(received.saya_terima.length, 1);
    assert.match(received.saya_terima[0].dari, /Sales Head/);
    // Another Head sees none of it (the admin page lists all; the AI only "mine").
    const other = await run('delegasi_persetujuan_saya', p.finHead.user, { termasuk_berakhir: true });
    assert.deepEqual([other.saya_berikan, other.saya_terima], [[], []]);
    assert.ok(!JSON.stringify(other).includes(mark));
    // A member has no approval_delegation.view at all.
    await assert.rejects(run('delegasi_persetujuan_saya', p.salesMember.user, {}), (e) => e.status === 403);

    // Signatures.
    const { doc, approval, s1, s2 } = await sql.fixture(async () => {
    const doc = await insert(conn, 'documents', { entity_id: 1, department_id: sales, title: `${mark} Kontrak`, document_type: 'kontrak', status: 'final', created_by: p.salesMember.id });
    const approval = await insert(conn, 'approval_requests', { entity_id: 1, department_id: sales, subject_type: 'document', title: `${mark} Kontrak`, status: 'pending', requested_by: p.salesMember.id, amount: MONEY });
    const s1 = await insert(conn, 'signature_requests', { entity_id: 1, department_id: sales, document_id: doc, approval_request_id: approval, assigned_signer_user_id: p.salesHead.id, status: 'pending', requested_by: p.salesMember.id });
    const s2 = await insert(conn, 'signature_requests', { entity_id: 1, department_id: sales, document_id: doc, status: 'signed', requested_by: p.salesMember.id, signed_by: p.salesHead.id, signed_at: new Date() });
    return { doc, approval, s1, s2 };
    });
    assert.ok(doc && approval);

    const signer = await run('tanda_tangan_saya', p.salesHead.user, {});
    assert.deepEqual(signer.menunggu_saya.permintaan.map((x) => x.id), [s1]);
    assert.equal(signer.menunggu_saya.permintaan[0].siap_ditandatangani, false);
    assert.equal(signer.menunggu_saya.permintaan[0].menunggu_persetujuan, 'menunggu');
    assert.equal(signer.menunggu_saya.permintaan[0].rute, `/signatures/${s1}`);
    assert.deepEqual(signer.permintaan_saya.permintaan, []);
    assertSafe(signer, 'tanda_tangan_saya');
    await sql.fixture(() => conn.query("UPDATE approval_requests SET status = 'approved' WHERE id = ?", [approval]));
    assert.equal((await run('tanda_tangan_saya', p.salesHead.user, { bagian: 'menunggu_saya' })).menunggu_saya.permintaan[0].siap_ditandatangani, true);

    const requester = await run('tanda_tangan_saya', p.salesMember.user, {});
    assert.equal(requester.menunggu_saya.total, 0);
    assert.deepEqual(requester.permintaan_saya.permintaan.map((x) => x.id).sort(), [s1, s2].sort());
    assert.equal(requester.permintaan_saya.permintaan.find((x) => x.id === s2).status, 'ditandatangani');
    assert.deepEqual((await run('tanda_tangan_saya', p.salesMember.user, { bagian: 'permintaan_saya', status: 'ditandatangani' })).permintaan_saya.permintaan.map((x) => x.id), [s2]);
    for (const person of [p.finMember, p.finHead, p.salesMember2, p.moHead]) {
      const out = await run('tanda_tangan_saya', person.user, {});
      assert.equal(out.menunggu_saya.total, 0);
      assert.equal(out.permintaan_saya.total, 0);
      assert.ok(!JSON.stringify(out).includes(mark));
    }

    sql.restore();
    for (const statement of sql.seen) assert.match(statement.trim(), /^\(?\s*SELECT\b/i, `only reads: ${statement.slice(0, 80)}`);
  });
});

// ---------------------------------------------------------------- documents

test('documents, division storage and templates: own division and company-wide only; metadata and link, never content', async (t) => {
  if (!(await dbReady())) return t.skip('database not available');
  noSideEffects(t);
  const drive = require(`${B}/services/googleDrive.service`);
  for (const method of Object.keys(drive).filter((k) => typeof drive[k] === 'function')) {
    t.mock.method(drive, method, async () => { throw new Error(`a read tool must not call Google Drive (${method})`); });
  }
  await inRolledBackTransaction(t, async (conn) => {
    const p = await people(conn);
    const mark = `[UJI-AI ${tag()}]`;
    const sales = await departmentId(conn, 'sales');
    const finance = await departmentId(conn, 'finance');
    const file = async (name) => {
      const driveId = `uji-${tag()}`;
      await insert(conn, 'drive_files_metadata', { entity_id: 1, drive_file_id: driveId, name, mime_type: 'application/vnd.google-apps.document', web_view_link: `https://docs.google.com/document/d/${driveId}/edit`, owner_email: 'pemilik@uji.invalid' });
      return driveId;
    };
    const doc = async (title, dept, creator, extra = {}) => insert(conn, 'documents', {
      entity_id: 1, department_id: dept, title: `${mark} ${title}`, document_type: 'kontrak', status: 'final', created_by: creator, drive_file_id: await file(title), ...extra,
    });
    const dSales = await doc('Kontrak Sales', sales, p.salesHead.id);
    await doc('Kontrak Finance', finance, p.finHead.id);
    await doc('SOP Perusahaan', null, p.moHead.id, { status: 'draft' });
    await insert(conn, 'documents', { entity_id: 1, department_id: sales, title: `${mark} Catatan tanpa file`, document_type: 'memo', status: 'draft', created_by: p.salesHead.id });
    const template = (name, dept, extra = {}) => insert(conn, 'document_templates', {
      entity_id: 1, department_id: dept, name: `${mark} ${name}`, document_type: 'bast', document_prefix: 'BAST', drive_template_file_id: `tpl-${tag()}`,
      web_view_link: 'https://docs.google.com/document/d/tpl/edit', placeholders_json: JSON.stringify(['nomor_dokumen', 'tanggal', 'karyawan_nama', 'lokasi']),
      checked_at: new Date(), is_active: 1, created_by: p.moHead.id, ...extra,
    });
    const tSales = await template('BAST Sales', sales);
    await template('BAST Finance', finance);
    await template('Surat Perusahaan', null);
    await template('BAST Lama', sales, { is_active: 0 });
    const generated = (dept, title) => insert(conn, 'generated_documents', {
      entity_id: 1, department_id: dept, template_id: tSales, doc_number: `UJI/${tag()}`, title: `${mark} ${title}`, drive_file_id: `gen-${tag()}`,
      web_view_link: 'https://docs.google.com/document/d/gen/edit', field_values: JSON.stringify({ karyawan_nama: BAIT }), created_by: p.salesHead.id,
    });
    await generated(sales, 'BAST laptop Sales');
    await generated(finance, 'BAST laptop Finance');

    const sql = recordSql(conn);
    const titles = (out) => out.dokumen.map((x) => x.judul.replace(`${mark} `, '')).sort();

    const found = await run('cari_dokumen', p.salesMember.user, { cari: mark });
    assert.deepEqual(titles(found), ['Catatan tanpa file', 'Kontrak Sales', 'SOP Perusahaan']);
    const contractDoc = found.dokumen.find((x) => x.id === dSales);
    assert.equal(contractDoc.divisi, 'Sales');
    assert.equal(contractDoc.status, 'final');
    assert.equal(contractDoc.jenis_berkas, 'dokumen');
    assert.match(contractDoc.tautan, /^https:\/\/docs\.google\.com\//);
    assert.match(contractDoc.dibuat_oleh, /Sales Head/);
    assert.equal(found.dokumen.find((x) => /SOP/.test(x.judul)).divisi, 'Seluruh perusahaan');
    const json = assertSafe(found, 'cari_dokumen');
    assert.ok(!json.includes('pemilik@uji.invalid'), 'no owner email');
    assert.deepEqual(titles(await run('cari_dokumen', p.salesMember.user, { cari: mark, status: 'draf' })), ['Catatan tanpa file', 'SOP Perusahaan']);
    assert.deepEqual(titles(await run('cari_dokumen', p.salesMember.user, { cari: mark, jenis: 'memo' })), ['Catatan tanpa file']);
    // Naming another division does not open it.
    const asFinance = await run('cari_dokumen', p.salesMember.user, { cari: mark, divisi: 'Finance' });
    assert.deepEqual(asFinance.dokumen, []);
    assert.deepEqual(titles(await run('cari_dokumen', p.finMember.user, { cari: mark })), ['Kontrak Finance', 'SOP Perusahaan']);
    assert.equal(titles(await run('cari_dokumen', p.moHead.user, { cari: mark })).length, 4);
    assert.deepEqual(titles(await run('cari_dokumen', p.moHead.user, { cari: mark, divisi: 'finance' })), ['Kontrak Finance']);
    assert.ok((await run('cari_dokumen', p.salesMember.user, { divisi: 'Divisi Khayalan' })).divisi_tersedia.includes('Sales'));

    // Division storage: what the app recorded for MY division.
    const storage = await run('dokumen_divisi', p.salesMember.user, { cari: mark });
    assert.equal(storage.divisi, 'Sales');
    assert.deepEqual(storage.dari_template.dokumen.map((x) => x.judul), [`${mark} BAST laptop Sales`]);
    assert.match(storage.dari_template.dokumen[0].template, /BAST Sales/);
    assert.deepEqual(titles(storage.dokumen_tersimpan), ['Kontrak Sales'], 'only records with a Drive file, only this division');
    assert.equal(storage.rute, '/division-storage');
    assert.match(storage.catatan, /tidak tercatat/);
    assertSafe(storage, 'dokumen_divisi');
    const denied = await run('dokumen_divisi', p.salesMember.user, { divisi: 'Finance' });
    assert.equal(denied.ditemukan, false);
    assert.ok(!JSON.stringify(denied).includes(mark));
    // Like the page: only workspace.cross_division.view opens another division's storage.
    const moStorage = await run('dokumen_divisi', p.moHead.user, { divisi: 'Finance', cari: mark });
    if (p.moHead.user.permissions.includes('workspace.cross_division.view')) {
      assert.deepEqual(moStorage.dari_template.dokumen.map((x) => x.judul), [`${mark} BAST laptop Finance`]);
    } else {
      assert.equal(moStorage.ditemukan, false);
    }
    assert.deepEqual((await run('dokumen_divisi', p.finMember.user, { cari: mark })).dari_template.dokumen.map((x) => x.judul), [`${mark} BAST laptop Finance`]);

    // Templates.
    const names = (out) => out.template.map((x) => x.nama.replace(`${mark} `, '')).sort();
    const templates = await run('template_dokumen', p.salesMember.user, { cari: mark });
    assert.deepEqual(names(templates), ['BAST Sales', 'Surat Perusahaan']);
    const bast = templates.template.find((x) => x.id === tSales);
    assert.deepEqual(bast.kolom_isian, [{ kunci: 'karyawan_nama', label: 'Nama karyawan' }, { kunci: 'lokasi', label: 'Lokasi' }]);
    assert.deepEqual(bast.kolom_otomatis, ['Nomor dokumen', 'Tanggal']);
    assert.equal(bast.untuk, 'Sales');
    assert.equal(templates.rute, '/doc-templates');
    assertSafe(templates, 'template_dokumen');
    assert.deepEqual(names(await run('template_dokumen', p.salesMember.user, { cari: mark, hanya_aktif: false })), ['BAST Lama', 'BAST Sales', 'Surat Perusahaan']);
    assert.deepEqual(names(await run('template_dokumen', p.finMember.user, { cari: mark })), ['BAST Finance', 'Surat Perusahaan']);
    assert.deepEqual(names(await run('template_dokumen', p.finMember.user, { template_id: tSales })), [], 'another division\'s template by id');
    assert.deepEqual(names(await run('template_dokumen', p.salesMember.user, { template_id: tSales })), ['BAST Sales']);

    sql.restore();
    assert.ok(sql.seen.length > 20);
    for (const statement of sql.seen) assert.match(statement.trim(), /^\(?\s*SELECT\b/i, `only reads: ${statement.slice(0, 80)}`);
  });
});
