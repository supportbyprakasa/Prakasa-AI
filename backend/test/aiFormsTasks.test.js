// Wave C2 — the Tasks, Project Tracker and Calendar forms Prakasa AI may fill
// (docs/prakasa-ai-rencana.md §9.9, §9.11). The policy of each form is pinned
// here; the round trips prove that a status, an assignee, a guest list or a
// column outside the policy sent by the model never reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const pool = require('../src/db/pool');
const bridge = require('../src/services/ai/agent/clientBridge');
const formCatalog = require('../src/services/ai/agent/formCatalog');
const { fieldClass, moneyLike } = require('../src/services/ai/agent/fieldPolicy');
const { signAgentToken } = require('../src/services/ai/agent/agentToken');
const ctrl = require('../src/controllers/aiAgent.controller');
const commandCtrl = require('../src/controllers/aiCommand.controller');

const USER = 15;
const USER_ONLY = 'Kolom ini hanya diisi pengguna.';
const EVENT = ['summary', 'location', 'description', 'allDay', 'startDate', 'startTime', 'endDate', 'endTime'];
const EVENT_USER = ['attendees', 'addMeet', 'notify'];
const SPRINT = ['name', 'goal', 'startDate', 'endDate'];
const TASK_DETAIL = 'pages/tasks/TaskDetail.jsx';

// id → [module, permission, mode, record, route, file, fields.ai, fields.userOnly]
const EXPECTED = {
  task: ['tasks', 'task.create', 'create', undefined, '/tasks?board=<id papan>&baru=1', 'pages/tasks/TaskBoard.jsx', ['title', 'description', 'columnId', 'priority', 'progressPercent', 'startDate', 'dueDate'], ['assigneeId']],
  'task-board': ['tasks', 'board.manage', 'create', undefined, '/tasks?baru=papan', 'pages/tasks/TaskBoard.jsx', ['name', 'departmentId', 'description', 'columns', 'columns.name', 'columns.wipLimit'], []],
  'task-edit': ['tasks', 'task.update', 'edit', 'task', '/tasks/<id tugas>', TASK_DETAIL, ['title', 'description', 'priority', 'progressPercent', 'startDate', 'dueDate'], ['status', 'assigneeId']],
  'task-comment': ['tasks', 'task.update', 'create', undefined, '/tasks/<id tugas>', TASK_DETAIL, ['comment'], []],
  'task-checklist-item': ['tasks', 'task.checklist.manage', 'create', undefined, '/tasks/<id tugas>?form=checklist', 'components/tasks/TaskChecklist.jsx', ['title'], []],
  'task-dependency': ['tasks', 'task.dependency.manage', 'create', undefined, '/tasks/<id tugas>?form=dependensi', 'components/tasks/TaskDependencies.jsx', ['mode', 'otherId'], []],
  'tracker-issue': ['projects', 'google.chat.use', 'create', undefined, '/projects/<id space>?baru=1', 'pages/projects/CreateIssueModal.jsx',
    ['type', 'title', 'description', 'priority', 'startDate', 'dueDate', 'storyPoints', 'sprintId', 'columnId', 'parentId', 'labels'], ['assigneeEmail']],
  'tracker-issue-comment': ['projects', 'google.chat.use', 'create', undefined, '/projects/<id space>?issue=<id issue>', 'pages/projects/IssueDrawer.jsx', ['comment'], []],
  'tracker-sprint': ['projects', 'google.chat.use', 'create', undefined, '/projects/<id space>?baru=sprint', 'pages/projects/SprintDialog.jsx', SPRINT, []],
  'tracker-sprint-edit': ['projects', 'google.chat.use', 'edit', 'tracker_sprint', '/projects/<id space>?ubah=<id sprint>', 'pages/projects/SprintDialog.jsx', SPRINT, []],
  'tracker-project-division': ['projects', 'google.chat.use', 'edit', 'tracker_project', '/projects/<id space>?form=divisi', 'pages/projects/DivisionDialog.jsx', ['departmentId'], []],
  'calendar-event': ['calendar', 'meeting.create', 'create', undefined, '/calendar?baru=1', 'pages/calendar/EventFormModal.jsx', EVENT, EVENT_USER],
  'calendar-event-edit': ['calendar', 'meeting.create', 'edit', 'calendar_event', '/calendar?ubah=<id event>', 'pages/calendar/EventFormModal.jsx', EVENT, EVENT_USER],
};
const MODULES = ['tasks', 'projects', 'calendar'];

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// The database as the tool endpoint sees it; every activity_logs row is kept.
function agentDb(t, permissions) {
  const audit = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (/INSERT INTO activity_logs/.test(sql)) { audit.push({ metadata: JSON.parse(params[5]), raw: params[5] }); return [{}]; }
    if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ id: USER, entity_id: 1, department_id: 5, email: 'uji@example.invalid', status: 'active' }]];
    if (/FROM permissions p/.test(sql)) return [permissions.map((code) => ({ code }))];
    if (/FROM ai_sessions/.test(sql)) return [[{ id: 9, entity_id: 1, department_id: 5, owner_user_id: USER, visibility: 'private', status: 'active', deleted_at: null, web_research: 0 }]];
    return [[]];
  });
  return audit;
}

let answerNo = 1;
const currentAnswer = () => `tasks-answer-${answerNo}`;
const tokenFor = () => signAgentToken({ userId: USER, entityId: 1, sessionId: 9, tools: ['buka_halaman', 'baca_formulir', 'isi_form'], surface: 'panel', answerId: currentAnswer() });

async function call(name, input, token) {
  const req = { headers: { authorization: `Bearer ${token}` }, params: { name }, body: { input } };
  const res = fakeRes();
  let passed = false;
  await ctrl.requireAgent(req, res, () => { passed = true; });
  if (!passed) return res;
  await ctrl.callTool(req, res, (e) => { throw e; });
  return res;
}

// A browser that answers through the same endpoint the real one uses.
function fakeBrowser({ route, respond }) {
  const seen = [];
  const close = bridge.open({
    answerId: currentAnswer(), sessionId: 9, userId: USER, route,
    emit: (request) => {
      seen.push(request);
      setImmediate(() => {
        const res = fakeRes();
        commandCtrl.toolResult({ params: { id: '9' }, user: { sub: USER }, body: { callId: request.callId, ...respond(request) } }, res, (e) => { throw e; });
      });
    },
  });
  return { seen, close };
}

test.afterEach(() => { bridge.reset(); answerNo += 1; });

test('the task, tracker and calendar forms: id, module, permission, mode, record, route, file and field policy', () => {
  for (const [id, [module, permission, mode, record, route, file, ai, userOnly]] of Object.entries(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    assert.ok(form, `${id} is in the catalog`);
    assert.equal(form.module, module, id);
    assert.equal(form.permission, permission, id);
    assert.equal(form.mode, mode, id);
    assert.equal(form.record, record, id);
    assert.equal(form.route, route, id);
    assert.equal(form.file, file, id);
    assert.deepEqual([...form.fields.ai], ai, id);
    assert.deepEqual([...form.fields.userOnly], userOnly, id);
    assert.deepEqual([...form.money], [], `${id}: no rupiah field`);
    assert.ok(form.note.length > 20, `${id}: the note says what stays with the user`);
  }
  // Nothing else lives in these three files.
  assert.deepEqual(formCatalog.FORMS.filter((form) => MODULES.includes(form.module)).map((form) => form.id).sort(), Object.keys(EXPECTED).sort());
});

test('what is never the AI\'s on these forms: assignees, status, guests and invitations, bare record IDs', () => {
  const ai = (id) => formCatalog.byId.get(id).fields.ai;
  // A task's assignee is a bare account ID (no people picker); its status is a decision.
  for (const id of ['task', 'task-edit']) assert.ok(!ai(id).includes('assigneeId'), id);
  assert.ok(!ai('task-edit').includes('status'));
  assert.ok(!ai('task-edit').includes('columnId'), 'moving a task between columns is not part of the edit form');
  // The other task of a dependency is a task ID: not personal, shown on the page — fillable as a number
  // (Wave C2 decision, §9.12); the save endpoint checks the task exists and the user may see it.
  assert.ok(ai('task-dependency').includes('otherId'));
  // An issue's assignee is told about it when the issue is saved.
  assert.ok(!ai('tracker-issue').includes('assigneeEmail'));
  assert.ok(!ai('tracker-issue').includes('assigneeId'));
  // Starting or completing a sprint is a status change: no status, no "move open issues" choice.
  for (const id of ['tracker-sprint', 'tracker-sprint-edit']) {
    assert.ok(!ai(id).includes('status'), id);
    assert.ok(!ai(id).includes('moveOpenIssuesTo'), id);
  }
  // Announcing in Google Chat is never a field.
  for (const id of Object.keys(EXPECTED)) {
    assert.ok(!ai(id).includes('postUpdates'), id);
    assert.ok(!ai(id).includes('postUpdatesToSpace'), id);
  }
  // Guests get a real Google invitation; the email to them and Google Meet are the user's.
  for (const id of ['calendar-event', 'calendar-event-edit']) {
    for (const name of ['attendees', 'guests', 'guestDraft', 'notify', 'addMeet', 'meetLocked']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  }
  // No forbidden class and no rupiah anywhere, rows included.
  for (const id of Object.keys(EXPECTED)) {
    for (const name of ai(id)) {
      for (const part of name.split('.')) assert.equal(fieldClass(part), 'open', `${id}: ${name}`);
      assert.equal(moneyLike(name.split('.').pop()), false, `${id}: ${name}`);
    }
  }
});

test('forms that are not registered stay out of the catalog: watchers, enabling a tracker, starting or completing a sprint, the Space message', () => {
  const ids = formCatalog.FORMS.map((form) => form.id);
  for (const id of ['task-watcher', 'tracker-enable', 'tracker-sprint-start', 'tracker-sprint-complete', 'tracker-issue-edit', 'task-space-message']) assert.ok(!ids.includes(id), id);
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/src/components/ai/formInventory/tasks.json'), 'utf8'));
  assert.equal(inventory.filter((entry) => entry.status === 'pending').length, 0, 'nothing is left pending in tasks.json');
  assert.deepEqual(inventory.filter((entry) => entry.status === 'registered').map((entry) => entry.id).sort(), Object.keys(EXPECTED).sort());
  const excluded = inventory.filter((entry) => entry.status === 'excluded').map((entry) => entry.form).sort();
  assert.deepEqual(excluded, ['AddWatcherModal', 'EnableTracker', 'IssueDrawer (ubah issue)', 'SpacePanel', 'SprintDialog (mulai)', 'SprintDialog (selesaikan)']);
  // The issue drawer registers its comment box only: its other fields save as they change.
  const drawer = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/projects/IssueDrawer.jsx'), 'utf8');
  assert.equal((drawer.match(/defineAIForm\(/g) || []).length, 1);
  assert.equal((drawer.match(/ai\.field\(/g) || []).length, 1);
  assert.match(drawer, /ai\.field\('comment'\)/);
});

test('which routes open these forms: the browser is told to wait for them', () => {
  const opens = (pathname, search = '') => formCatalog.FORMS.filter((form) => MODULES.includes(form.module) && form.opens({ pathname, search })).map((form) => form.id).sort();
  assert.deepEqual(opens('/tasks', 'baru=papan'), ['task-board']);
  assert.deepEqual(opens('/tasks', 'board=7&baru=1'), ['task']);
  assert.deepEqual(opens('/tasks', 'board=7'), []);
  assert.deepEqual(opens('/tasks'), []);
  assert.deepEqual(opens('/tasks/41'), ['task-comment', 'task-edit']);
  assert.deepEqual(opens('/tasks/41', 'form=checklist'), ['task-checklist-item', 'task-comment', 'task-edit']);
  assert.deepEqual(opens('/tasks/41', 'form=dependensi'), ['task-comment', 'task-dependency', 'task-edit']);
  assert.deepEqual(opens('/projects/AAAAspace1', 'baru=1'), ['tracker-issue']);
  assert.deepEqual(opens('/projects/AAAAspace1', 'baru=sprint'), ['tracker-sprint']);
  assert.deepEqual(opens('/projects/AAAAspace1', 'ubah=12'), ['tracker-sprint-edit']);
  assert.deepEqual(opens('/projects/AAAAspace1', 'form=divisi'), ['tracker-project-division']);
  assert.deepEqual(opens('/projects/AAAAspace1', 'issue=88'), ['tracker-issue-comment']);
  // A project page on its own opens no form: the browser does not wait.
  assert.deepEqual(opens('/projects/AAAAspace1'), []);
  assert.deepEqual(opens('/projects/AAAAspace1', 'view=backlog'), []);
  assert.deepEqual(opens('/projects'), []);
  assert.deepEqual(opens('/calendar', 'baru=1'), ['calendar-event']);
  assert.deepEqual(opens('/calendar', 'ubah=abc123'), ['calendar-event-edit']);
  assert.deepEqual(opens('/calendar', 'view=week&date=2026-10-05'), []);
});

// What the page reports for "Tambah board" — with what a careless page might add.
const BOARD_FORM = {
  id: 'task-board', judul: 'Tambah board', izin: 'board.manage', belum_disimpan: false,
  kolom: [
    { nama: 'name', label: 'Nama board', jenis: 'text', wajib: true, bisa_diisi: true, isi: '' },
    { nama: 'departmentId', label: 'Divisi', jenis: 'select', bisa_diisi: true, pilihan: ['Sales', 'Finance'], isi: '' },
    { nama: 'description', label: 'Deskripsi', jenis: 'textarea', bisa_diisi: true, isi: '' },
    { nama: 'googleChatSpaceUrl', label: 'Space', jenis: 'text', bisa_diisi: true, isi: 'https://chat.example.invalid/x' },
    {
      nama: 'columns', label: 'Kolom', jenis: 'rows', wajib: true, bisa_diisi: true, maks_baris: 12, boleh_tambah: true,
      kolom_baris: [
        { nama: 'name', label: 'Nama kolom', jenis: 'text', wajib: true, bisa_diisi: true },
        { nama: 'wipLimit', label: 'Batas WIP', jenis: 'number', bisa_diisi: true, min: 1, kelipatan: 1 },
        { nama: 'position', label: 'Urutan', jenis: 'number', bisa_diisi: true },
        { nama: 'token', label: 'Token', jenis: 'text', bisa_diisi: true },
      ],
      baris: [
        { no: 1, isi: { name: 'Backlog', wipLimit: '', position: '0', token: 'rahasia-kolom' }, diisi_pengguna: true },
        { no: 2, isi: { name: 'Dikerjakan', wipLimit: '', position: '1' }, diisi_pengguna: true },
        { no: 3, isi: { name: 'Selesai', wipLimit: '', position: '2' }, diisi_pengguna: true },
      ],
    },
  ],
};

test('Tambah board (rows): only the columns of the policy reach the browser, and the user\'s columns cannot be asked away', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'board.view', 'board.manage']);
  const browser = fakeBrowser({
    route: '/tasks',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/tasks', formulir: [BOARD_FORM] } }
      : { ok: true, result: { diisi: ['name', 'columns'], baris: { columns: 2 }, ditolak: [{ nama: 'columns[3].wipLimit', alasan: 'Paling kecil 1.' }] } }),
  });
  const token = tokenFor();
  const read = await call('baca_formulir', {}, token);
  const form = read.body.data.formulir[0];
  assert.equal(form.kolom.find((k) => k.nama === 'googleChatSpaceUrl').bisa_diisi, false, 'registered by a page, not named by the policy');
  const columns = form.kolom.find((k) => k.nama === 'columns');
  assert.deepEqual(columns.kolom_baris.map((k) => [k.nama, k.bisa_diisi]), [['name', true], ['wipLimit', true], ['position', false]]);
  assert.deepEqual(columns.baris.map((row) => [row.isi.name, row.diisi_pengguna]), [['Backlog', true], ['Dikerjakan', true], ['Selesai', true]]);
  assert.doesNotMatch(JSON.stringify(read.body.data), /rahasia-kolom|chat\.example\.invalid/);

  const res = await call('isi_form', {
    formulir: 'task-board',
    isian: [
      { kolom: 'name', isi: 'Papan Operasional' },
      { kolom: 'googleChatSpaceUrl', isi: 'https://evil.example/x' },
      {
        kolom: 'columns',
        cara: 'hapus-semua',
        baris: [
          { name: 'QA', wipLimit: '3', position: '9', token: 'abc', budget: '1000000' },
          { name: 'Rilis', assigneeId: '7' },
          { name: 'Arsip', wipLimit: '0' },
        ],
      },
    ],
  }, token);
  const sent = browser.seen.find((r) => r.op === 'fillForm');
  assert.deepEqual(sent.input, {
    formulir: 'task-board',
    isian: [
      { kolom: 'name', isi: 'Papan Operasional' },
      { kolom: 'columns', cara: 'tambah', baris: [{ name: 'QA', wipLimit: '3' }, { name: 'Rilis' }, { name: 'Arsip', wipLimit: '0' }] },
    ],
  }, 'only allowed cells reach the browser; "cara" is tambah or ganti, never a delete');
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  assert.equal(refused.googleChatSpaceUrl, USER_ONLY);
  assert.equal(refused['columns[1].position'], USER_ONLY);
  assert.equal(refused['columns[1].token'], USER_ONLY);
  assert.equal(refused['columns[1].budget'], 'Kolom ini tidak ada di formulir.');
  assert.equal(refused['columns[2].assigneeId'], 'Kolom ini tidak ada di formulir.');
  assert.equal(refused['columns[3].wipLimit'], 'Paling kecil 1.');
  assert.deepEqual(res.body.data.diisi, ['name', 'columns']);
  assert.deepEqual(res.body.data.baris_ditambahkan, { columns: 2 });
  assert.match(res.body.data.catatan, /BELUM tersimpan/);
  // Audit: names and a row count — never a cell.
  const row = audit.at(-1);
  assert.deepEqual([row.metadata.formId, row.metadata.filled, row.metadata.rows], ['task-board', ['name', 'columns'], { columns: 2 }]);
  assert.doesNotMatch(row.raw, /Papan Operasional|QA|Rilis|Arsip|evil/);
  browser.close();
});

const TASK_EDIT_FORM = {
  id: 'task-edit', judul: 'Detail tugas', izin: 'task.update', mode: 'ubah', rekaman: { jenis: 'task', id: '41' }, belum_disimpan: false,
  kolom: [
    { nama: 'title', label: 'Judul', jenis: 'text', wajib: true, bisa_diisi: true, isi: 'Siapkan laporan stok' },
    { nama: 'description', label: 'Deskripsi', jenis: 'textarea', bisa_diisi: true, isi: '' },
    { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: true, pilihan: ['Terbuka', 'Selesai', 'Dibatalkan'], isi: 'Terbuka' },
    { nama: 'priority', label: 'Prioritas', jenis: 'select', bisa_diisi: true, pilihan: ['Rendah', 'Normal', 'Tinggi', 'Mendesak'], isi: 'Normal' },
    { nama: 'progressPercent', label: 'Progres (%)', jenis: 'number', bisa_diisi: true, isi: '0' },
    { nama: 'assigneeId', label: 'ID penanggung jawab', jenis: 'number', bisa_diisi: true, isi: '7' },
    { nama: 'startDate', label: 'Tanggal mulai', jenis: 'date', bisa_diisi: true, isi: '' },
    { nama: 'dueDate', label: 'Jatuh tempo', jenis: 'date', bisa_diisi: true, isi: '' },
  ],
};

test('Detail tugas (edit): status and assignee sent by the model never reach the browser, and the audit names the task', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'task.view', 'task.update']);
  let form = TASK_EDIT_FORM;
  const browser = fakeBrowser({
    route: '/tasks/41',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/tasks/41', formulir: [form] } }
      : { ok: true, result: { diisi: request.input.isian.map((x) => x.kolom), ditolak: [] } }),
  });
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.equal(read.mode, 'ubah');
  for (const name of ['status', 'assigneeId']) {
    const field = read.kolom.find((k) => k.nama === name);
    assert.equal(field.bisa_diisi, false, name);
    assert.equal('isi' in field, false, `${name}: listed without its value`);
  }
  const res = await call('isi_form', {
    formulir: 'task-edit',
    isian: [
      { kolom: 'priority', isi: 'Tinggi' }, { kolom: 'dueDate', isi: '2026-10-09' }, { kolom: 'progressPercent', isi: '50' },
      { kolom: 'status', isi: 'Selesai' }, { kolom: 'assigneeId', isi: '99' }, { kolom: 'columnId', isi: '3' },
    ],
  }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian, [
    { kolom: 'priority', isi: 'Tinggi' }, { kolom: 'dueDate', isi: '2026-10-09' }, { kolom: 'progressPercent', isi: '50' },
  ]);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  assert.equal(refused.status, USER_ONLY);
  assert.equal(refused.assigneeId, USER_ONLY);
  assert.ok(refused.columnId, 'a field the form does not have is refused');
  assert.deepEqual(res.body.data.diisi, ['priority', 'dueDate', 'progressPercent']);
  assert.deepEqual([audit.at(-1).metadata.formId, audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['task-edit', 'edit', 'task', '41']);
  assert.doesNotMatch(audit.at(-1).raw, /Tinggi|2026-10-09|Selesai/);

  // A page that names no task, or another kind of record: nothing is filled.
  for (const rekaman of [null, { jenis: 'tracker_sprint', id: '41' }]) {
    bridge.channelOf(currentAnswer()).forms.clear();
    form = { ...TASK_EDIT_FORM, rekaman };
    const none = await call('isi_form', { formulir: 'task-edit', isian: [{ kolom: 'title', isi: 'x' }] }, token);
    assert.equal(none.body.data.berhasil, false, JSON.stringify(rekaman));
  }
  assert.equal(browser.seen.filter((r) => r.op === 'fillForm').length, 1);
  browser.close();
});

test('Detail tugas is refused without task.update — the page\'s word is not enough', async (t) => {
  agentDb(t, ['ai_command.use', 'task.view']);
  const browser = fakeBrowser({
    route: '/tasks/41',
    respond: (request) => (request.op === 'readForms' ? { ok: true, result: { rute: '/tasks/41', formulir: [TASK_EDIT_FORM] } } : { ok: true, result: { diisi: ['title'], ditolak: [] } }),
  });
  const res = await call('isi_form', { formulir: 'task-edit', isian: [{ kolom: 'title', isi: 'x' }] }, tokenFor());
  assert.notDeepEqual(res.body?.data?.diisi, ['title']);
  assert.equal(browser.seen.filter((r) => r.op === 'fillForm').length, 0);
  browser.close();
});

const EVENT_FORM = {
  id: 'calendar-event-edit', judul: 'Ubah event', izin: 'meeting.create', mode: 'ubah', rekaman: { jenis: 'calendar_event', id: 'evt7abc' }, belum_disimpan: false,
  kolom: [
    { nama: 'summary', label: 'Judul', jenis: 'text', wajib: true, bisa_diisi: true, isi: 'Rapat mingguan' },
    { nama: 'location', label: 'Lokasi', jenis: 'text', bisa_diisi: true, isi: '' },
    { nama: 'allDay', label: 'Seharian', jenis: 'checkbox', bisa_diisi: true, isi: false },
    { nama: 'startDate', label: 'Tanggal mulai', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-05' },
    { nama: 'startTime', label: 'Jam mulai', jenis: 'time', wajib: true, bisa_diisi: true, isi: '09:00' },
    { nama: 'endDate', label: 'Tanggal selesai', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-05' },
    { nama: 'endTime', label: 'Jam selesai', jenis: 'time', wajib: true, bisa_diisi: true, isi: '10:00' },
    // A careless page marks these fillable and shows their values:
    { nama: 'attendees', label: 'Tambah tamu', jenis: 'text', bisa_diisi: true, isi: 'tamu@example.invalid' },
    { nama: 'addMeet', label: 'Tambahkan Google Meet', jenis: 'checkbox', bisa_diisi: true, isi: false },
    { nama: 'notify', label: 'Kirim pemberitahuan perubahan email ke tamu', jenis: 'checkbox', bisa_diisi: true, isi: true },
  ],
};

test('Ubah event (edit): guests, the email to them and Google Meet never reach the browser', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'meeting.view', 'meeting.create']);
  const browser = fakeBrowser({
    route: '/calendar',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/calendar', formulir: [EVENT_FORM] } }
      : { ok: true, result: { diisi: request.input.isian.map((x) => x.kolom), ditolak: [] } }),
  });
  const token = tokenFor();
  const read = await call('baca_formulir', {}, token);
  for (const name of EVENT_USER) {
    const field = read.body.data.formulir[0].kolom.find((k) => k.nama === name);
    assert.equal(field.bisa_diisi, false, name);
    assert.equal('isi' in field, false, name);
  }
  assert.doesNotMatch(JSON.stringify(read.body.data), /tamu@example\.invalid/, 'a guest\'s address is never read');
  const res = await call('isi_form', {
    formulir: 'calendar-event-edit',
    isian: [
      { kolom: 'location', isi: 'Ruang rapat lt. 2' }, { kolom: 'startTime', isi: '14:00' }, { kolom: 'endTime', isi: '15:00' },
      { kolom: 'attendees', isi: 'orang@example.invalid' }, { kolom: 'notify', isi: 'ya' }, { kolom: 'addMeet', isi: 'ya' },
    ],
  }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian, [
    { kolom: 'location', isi: 'Ruang rapat lt. 2' }, { kolom: 'startTime', isi: '14:00' }, { kolom: 'endTime', isi: '15:00' },
  ]);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  for (const name of EVENT_USER) assert.equal(refused[name], USER_ONLY, name);
  assert.deepEqual([audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['edit', 'calendar_event', 'evt7abc']);
  assert.doesNotMatch(audit.at(-1).raw, /Ruang rapat|example\.invalid/);
  browser.close();
});

const ISSUE_FORM = {
  id: 'tracker-issue', judul: 'Buat issue', izin: 'google.chat.use', belum_disimpan: false,
  kolom: [
    { nama: 'type', label: 'Tipe', jenis: 'radio', wajib: true, bisa_diisi: true, pilihan: ['Task', 'Bug', 'Story', 'Epic', 'Sub-task'], isi: 'Task' },
    { nama: 'title', label: 'Judul', jenis: 'text', wajib: true, bisa_diisi: true, maks: 255, isi: '' },
    { nama: 'priority', label: 'Prioritas', jenis: 'select', bisa_diisi: true, pilihan: ['Rendah', 'Normal', 'Tinggi', 'Mendesak'], isi: 'Normal' },
    { nama: 'assigneeEmail', label: 'Penanggung jawab', jenis: 'select', bisa_diisi: true, pilihan: ['Budi', 'Sari'], isi: 'Budi' },
    { nama: 'labels', label: 'Label', jenis: 'multiselect', bisa_diisi: true, pilihan: ['frontend', 'gudang'], isi: '' },
  ],
};

test('Buat issue: the assignee is refused on the server even when the page says it is fillable', async (t) => {
  agentDb(t, ['ai_command.use', 'google.chat.use']);
  const browser = fakeBrowser({
    route: '/projects/AAAAspace1',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/projects/AAAAspace1', formulir: [ISSUE_FORM] } }
      : { ok: true, result: { diisi: request.input.isian.map((x) => x.kolom), ditolak: [] } }),
  });
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  const assignee = read.kolom.find((k) => k.nama === 'assigneeEmail');
  assert.equal(assignee.bisa_diisi, false);
  assert.equal('isi' in assignee, false);
  const res = await call('isi_form', {
    formulir: 'tracker-issue',
    isian: [{ kolom: 'type', isi: 'Bug' }, { kolom: 'title', isi: 'Invoice tidak bisa diunduh' }, { kolom: 'labels', isi: 'frontend; gudang' }, { kolom: 'assigneeEmail', isi: 'Sari' }],
  }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian, [
    { kolom: 'type', isi: 'Bug' }, { kolom: 'title', isi: 'Invoice tidak bisa diunduh' }, { kolom: 'labels', isi: 'frontend; gudang' },
  ]);
  assert.equal(res.body.data.ditolak.find((x) => x.kolom === 'assigneeEmail').alasan, USER_ONLY);
  browser.close();
});
