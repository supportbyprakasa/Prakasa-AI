// Wave C2 — the People & Culture and document forms Prakasa AI may fill
// (docs/prakasa-ai-rencana.md §9.9, §9.11): onboarding / offboarding drafts,
// checklist task dialogs, checklist templates and their PIC, a person's work
// profile, document templates, kop & footer, and the "new file / folder"
// dialogs. The policy of each form is pinned here. The HRIS is KantorKu: no
// personal field (salary, bank, NIK/KTP, NPWP, BPJS, birth date, home address,
// personal phone) is fillable or read back, and the reason for leaving and the
// free-text People & Culture notes stay with the user. The round trips prove
// that such a value sent by the model never reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const pool = require('../src/db/pool');
const bridge = require('../src/services/ai/agent/clientBridge');
const formCatalog = require('../src/services/ai/agent/formCatalog');
const { fieldClass, moneyLike, wordsOf } = require('../src/services/ai/agent/fieldPolicy');
const { signAgentToken } = require('../src/services/ai/agent/agentToken');
const ctrl = require('../src/controllers/aiAgent.controller');
const commandCtrl = require('../src/controllers/aiCommand.controller');

const USER = 15;
const USER_ONLY = 'Kolom ini hanya diisi pengguna.';
const WORKFLOW = 'pages/hrga/WorkflowFormDialog.jsx';
const TASKS = 'pages/hrga/TaskDialogs.jsx';
const TEMPLATES = 'pages/hrga/ChecklistTemplates.jsx';
const PERSON = 'pages/people/PersonFormDialog.jsx';
const DOC = 'pages/documents/DocTemplateDialogs.jsx';
const ONBOARDING = [
  'employeeFullName', 'employeePosition', 'departmentId', 'managerKey', 'locationId', 'plannedWorkEmail', 'personKey', 'joinDate',
  'needGoogle', 'needApp', 'needIdCard', 'needDesk', 'needDevice', 'needPhone', 'needLicenses', 'hrgaPicUserId',
];
const ROWS = ['items', 'items.ownerGroup', 'items.category', 'items.title', 'items.offsetDays', 'items.requires'];
const PERSON_AI = ['name', 'workEmail', 'departmentId', 'position', 'managerKey', 'locationId'];
const PERSON_USER = ['workPhone', 'kind', 'excludedReason', 'status', 'resignedOn', 'notes'];

// id → [permission, mode, record, route, file, fields.ai, fields.userOnly]
const EXPECTED = {
  'hr-onboarding': ['hrga.request', 'create', undefined, '/hrga/onboarding?baru=1', WORKFLOW, ONBOARDING, ['notes']],
  'hr-offboarding': ['hrga.request', 'create', undefined, '/hrga/offboarding?baru=1', WORKFLOW, ['personKey', 'lastWorkingDate', 'hrgaPicUserId'], ['reasonCode', 'notes']],
  'hr-onboarding-edit': ['hrga.request', 'edit', 'hrga_workflow', '/hrga/workflows/<id alur>?ubah=1', WORKFLOW, ONBOARDING, ['notes']],
  'hr-offboarding-edit': ['hrga.request', 'edit', 'hrga_workflow', '/hrga/workflows/<id alur>?ubah=1', WORKFLOW, ['lastWorkingDate', 'hrgaPicUserId'], ['personKey', 'reasonCode', 'notes']],
  'hr-checklist-pic': ['hrga.checklist_template.manage', 'edit', 'hrga_pic_setting', '/hrga/checklist-templates', TEMPLATES, ['itUserId', 'gaUserId'], []],
  'hr-checklist-template': ['hrga.checklist_template.manage', 'create', undefined, '/hrga/checklist-templates?baru=1', TEMPLATES, ['workflowType', 'departmentId', 'name', ...ROWS], []],
  'hr-checklist-template-edit': ['hrga.checklist_template.manage', 'edit', 'hrga_checklist_template', '/hrga/checklist-templates?ubah=<id template>', TEMPLATES, ['name', ...ROWS], ['workflowType', 'departmentId']],
  'hr-task-assign': ['hrga.manage', 'edit', 'hrga_task', '/hrga/workflows/<id alur>?form=assign.<id tugas>', TASKS, ['responsibleUserId'], []],
  'hr-task-it-ticket': ['hrga.view', 'create', undefined, '/hrga/workflows/<id alur>?form=it_ticket.<id tugas>', TASKS, ['category', 'title', 'description'], []],
  'hr-task-device-handover': ['device.assign', 'create', undefined, '/hrga/workflows/<id alur>?form=device_handover.<id tugas>', TASKS, ['deviceId', 'expectedReturnDate'], []],
  'hr-task-device-return': ['device.assign', 'create', undefined, '/hrga/workflows/<id alur>?form=device_return.<id tugas>', TASKS, ['conditionOnReturn', 'notes'], []],
  'hr-task-license': ['subscription.license.manage', 'create', undefined, '/hrga/workflows/<id alur>?form=license_assign.<id tugas>', TASKS, ['licenseId'], []],
  'people-person': ['people.directory.manage', 'create', undefined, '/people/directory?baru=1', PERSON, PERSON_AI, PERSON_USER],
  'people-person-edit': ['people.directory.manage', 'edit', 'directory_person', '/people/directory/<key orang>?ubah=1', PERSON, PERSON_AI, PERSON_USER],
  'doc-template': ['template.manage', 'create', undefined, '/doc-templates?baru=1', DOC, ['name', 'scope', 'prefix', 'description'], ['source', 'sourceUrl']],
  'doc-template-edit': ['template.manage', 'edit', 'doc_template', '/doc-templates?ubah=<id template>', DOC, ['name', 'prefix', 'description'], ['isActive']],
  // Field names come from the template's placeholders (dynamicFields): only the title is named here.
  'doc-generate': ['document.create', 'create', undefined, '/doc-templates?buat=<id template>', DOC, ['docTitle'], []],
  'doc-kop': ['template.manage', 'edit', 'doc_kop', '/doc-templates?tab=kop&form=<id divisi atau company>', DOC, ['layout', 'companyName', 'accentColor', 'headerLines', 'footerText', 'showPageNumber'], ['logo']],
  'doc-division-file': ['document.create', 'create', undefined, '/division-storage?baru=<document, spreadsheet, atau presentation>', 'pages/documents/DivisionStorage.jsx', ['name'], []],
  'mydrive-file': ['mydrive.manage', 'create', undefined, '/my-drive?baru=<document, spreadsheet, atau presentation>', 'pages/mydrive/MyDrive.jsx', ['name'], []],
  'mydrive-folder': ['mydrive.manage', 'create', undefined, '/my-drive?baru=folder', 'pages/mydrive/MyDrive.jsx', ['name'], []],
};

// Words that mark personal or payroll data: the HRIS is KantorKu, so no field
// of these forms may carry one — fillable or not.
const PERSONAL_WORDS = new Set([
  'salary', 'gaji', 'upah', 'payroll', 'bank', 'rekening', 'nik', 'ktp', 'npwp', 'bpjs', 'birth', 'birthday', 'birthdate', 'lahir', 'dob',
  'address', 'alamat', 'home', 'rumah', 'religion', 'agama', 'marital', 'family', 'keluarga', 'emergency', 'darurat', 'kantorku', 'passport', 'paspor',
]);
const personal = (name) => wordsOf(name).some((word) => PERSONAL_WORDS.has(word));
// The only phone on these forms is the WORK phone of a directory entry, and it is the user's.
const phoneLike = (name) => wordsOf(name).some((word) => ['phone', 'telepon', 'telp', 'hp', 'handphone', 'mobile', 'whatsapp', 'wa'].includes(word));

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
const currentAnswer = () => `people-answer-${answerNo}`;
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

// A browser that answers every request through the endpoint the real one uses.
function fakeBrowser(route, respond) {
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
const sentFill = (browser) => browser.seen.find((request) => request.op === 'fillForm')?.input.isian;
const refusedOf = (res) => Object.fromEntries((res.body.data.ditolak || []).map((item) => [item.kolom, item]));

test.afterEach(() => { bridge.reset(); answerNo += 1; });

test('the People & Culture and document catalog: every form, its permission, mode, record, route and field policy', () => {
  const own = formCatalog.FORMS.filter((form) => ['people', 'documents'].includes(form.module));
  assert.deepEqual(own.map((form) => form.id).sort(), Object.keys(EXPECTED).sort());
  for (const [id, [permission, mode, record, route, file, ai, userOnly]] of Object.entries(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    assert.ok(form, id);
    assert.equal(form.permission, permission, id);
    assert.equal(form.mode, mode, id);
    assert.equal(form.record, record, id);
    assert.equal(form.route, route, id);
    assert.equal(form.file, file, id);
    assert.deepEqual([...form.fields.ai], ai, id);
    assert.deepEqual([...form.fields.userOnly], userOnly, id);
    assert.ok(form.note.length > 20, `${id}: the note says what stays with the user`);
    assert.ok(fs.existsSync(path.join(__dirname, '../../frontend/src', form.file)), `${id}: ${form.file}`);
    for (const name of form.fields.ai) {
      const column = name.split('.').pop();
      assert.equal(fieldClass(column), 'open', `${id}.${name}`);
      assert.equal(moneyLike(column), false, `${id}.${name}: no rupiah`);
    }
    assert.deepEqual([...form.money], [], id);
  }
});

test('KantorKu is the HRIS: no personal or payroll field on any of these forms, fillable or not', () => {
  for (const id of Object.keys(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    for (const name of [...form.fields.ai, ...form.fields.userOnly]) {
      assert.equal(personal(name), false, `${id}.${name} looks like personal data: it belongs in KantorKu, not in this form`);
    }
    // No phone is ever the AI's. needPhone is "does the newcomer need a company number" (HP / Telepon IP / Tidak), not a number.
    for (const name of form.fields.ai.filter((item) => item !== 'needPhone')) assert.equal(phoneLike(name), false, `${id}.${name}`);
  }
  // The one phone field there is: a directory entry's WORK phone — the user's, never read back.
  for (const id of ['people-person', 'people-person-edit']) {
    const form = formCatalog.byId.get(id);
    assert.ok(form.fields.userOnly.includes('workPhone'), id);
    assert.ok(!form.fields.ai.includes('workPhone'), id);
  }
  // A catalog entry that tried to add one is refused when the server starts (bank), or caught above (the rest).
  const bad = formCatalog.validateForm({ ...formCatalog.byId.get('people-person'), id: 'x-person', fields: { ai: ['name', 'bankAccountNumber'], userOnly: [] } });
  assert.match(bad.join('\n'), /bankAccountNumber.*tidak pernah boleh diisi AI/);
  const salary = formCatalog.validateForm({ ...formCatalog.byId.get('people-person'), id: 'x-person', fields: { ai: ['name', 'salary'], userOnly: [] } });
  assert.match(salary.join('\n'), /salary.*rupiah/);
});

test('what stays with the user: reason for leaving, People & Culture notes, status, resign date, exclusion, decisions', () => {
  const ai = (id) => formCatalog.byId.get(id).fields.ai;
  const userOnly = (id) => formCatalog.byId.get(id).fields.userOnly;
  for (const id of ['hr-offboarding', 'hr-offboarding-edit']) {
    assert.ok(!ai(id).includes('reasonCode'), `${id}: the reason for leaving`);
    assert.ok(userOnly(id).includes('reasonCode'), id);
    assert.ok(!ai(id).includes('reason'), id);
  }
  for (const id of ['hr-onboarding', 'hr-offboarding', 'hr-onboarding-edit', 'hr-offboarding-edit', 'people-person', 'people-person-edit']) {
    assert.ok(!ai(id).includes('notes'), `${id}: free-text HR notes`);
    assert.ok(userOnly(id).includes('notes'), id);
  }
  // The employee of an offboarding cannot be swapped once the draft exists.
  assert.ok(!ai('hr-offboarding-edit').includes('personKey'));
  for (const id of ['people-person', 'people-person-edit']) {
    for (const name of ['workPhone', 'kind', 'excludedReason', 'status', 'resignedOn', 'notes']) assert.ok(!ai(id).includes(name), `${id}.${name}`);
  }
  // Documents: copying a Google Doc, switching a template on or off, the logo file.
  assert.ok(!ai('doc-template').includes('source') && !ai('doc-template').includes('sourceUrl'));
  assert.ok(!ai('doc-template-edit').includes('isActive'));
  assert.ok(!ai('doc-kop').includes('logo') && !ai('doc-kop').includes('logoBase64'));
  // Checklist: no status, no "done", no skip reason; a template is not switched on or off by the AI.
  for (const id of Object.keys(EXPECTED)) {
    for (const name of ['status', 'isActive', 'skippedReason', 'confirmedInAdminConsole', 'completed', 'kantorkuEmployeeId', 'kantorkuReferenceUrl', 'phoneLineId']) {
      assert.ok(!ai(id).includes(name), `${id}.${name}`);
    }
  }
  // Not registered at all: the KantorKu reference, the company number dialog, the Google confirmation, uploads.
  for (const id of ['hr-kantorku', 'hr-task-phone-line', 'hr-task-google', 'hr-attachment']) assert.equal(formCatalog.byId.has(id), false, id);
  // "Buat dokumen dari template" is registered since the catalog knows dynamic field names (test below).
  assert.equal(formCatalog.byId.get('doc-generate').dynamicFields, true);
});

test('routes: each form opens on a page the AI tool registry knows, and the browser is told to wait for it', () => {
  const registry = require('../src/services/aiToolRegistry.service');
  const clientTools = require('../src/services/ai/agent/clientTools');
  for (const id of Object.keys(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    const parsed = clientTools.parseRoute(form.route.replace(/<[^>]+>/g, '1'));
    assert.ok(parsed, `${id}: ${form.route}`);
    assert.ok(registry.resolveTool(parsed.pathname), `${id}: ${parsed.pathname}`);
  }
  const opens = (route) => formCatalog.opensForm(clientTools.parseRoute(route));
  for (const route of ['/hrga/onboarding?baru=1', '/hrga/offboarding?baru=1', '/hrga/workflows/12?ubah=1', '/hrga/checklist-templates', '/hrga/checklist-templates?type=offboarding&ubah=4',
    '/people/directory?baru=1', '/people/directory/u12?ubah=1', '/doc-templates?baru=1', '/doc-templates?ubah=3', '/doc-templates?tab=kop&form=company',
    '/division-storage?baru=document', '/my-drive?baru=folder', '/my-drive?baru=spreadsheet']) assert.equal(opens(route), true, route);
  for (const route of ['/hrga/onboarding', '/hrga/workflows/12', '/people/directory', '/people/directory/u12', '/doc-templates', '/doc-templates?tab=kop', '/my-drive', '/division-storage']) {
    assert.equal(opens(route), false, route);
  }
});

const person = (nama, label, extra = {}) => ({ nama, label, jenis: 'person', bisa_diisi: true, isi: '', ...extra });
const OFFBOARDING_FORM = {
  id: 'hr-offboarding', judul: 'Offboarding', izin: 'hrga.request', belum_disimpan: false,
  kolom: [
    person('personKey', 'Karyawan', { wajib: true }),
    { nama: 'lastWorkingDate', label: 'Hari terakhir', jenis: 'date', wajib: true, bisa_diisi: true, isi: '' },
    { nama: 'reasonCode', label: 'Alasan', jenis: 'select', bisa_diisi: false },
    person('hrgaPicUserId', 'PIC People & Culture'),
    { nama: 'notes', label: 'Catatan', jenis: 'textarea', bisa_diisi: false },
    // What a careless page might add: none of it may ever reach the model or be filled.
    { nama: 'bankAccountNumber', label: 'Nomor rekening', jenis: 'text', bisa_diisi: true, isi: '1234567890' },
    { nama: 'nik', label: 'NIK', jenis: 'text', bisa_diisi: true, isi: '3174000000000001' },
    { nama: 'homeAddress', label: 'Alamat rumah', jenis: 'textarea', bisa_diisi: true, isi: 'Jl. Contoh 1' },
    { nama: 'personalPhone', label: 'Telepon pribadi', jenis: 'text', bisa_diisi: true, isi: '+62 811 0000 000' },
    { nama: 'salary', label: 'Gaji', jenis: 'number', bisa_diisi: true, isi: '9000000' },
  ],
};

test('offboarding: the person is found by the page, the reason and the note never reach the browser, personal fields are not read back', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'hrga.view', 'hrga.request']);
  const browser = fakeBrowser('/hrga/offboarding', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/hrga/offboarding', formulir: [OFFBOARDING_FORM] } }
    : { ok: true, result: { diisi: ['lastWorkingDate'], ditolak: [{ nama: 'personKey', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Budi Santoso — Staff Gudang · Warehouse', 'Budi Hartono — Sales · Sales'] }] } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  const byName = Object.fromEntries(read.kolom.map((k) => [k.nama, k]));
  assert.deepEqual([byName.personKey.bisa_diisi, byName.lastWorkingDate.bisa_diisi, byName.hrgaPicUserId.bisa_diisi], [true, true, true]);
  assert.match(byName.personKey.cara_isi, /direktori/);
  for (const name of ['reasonCode', 'notes', 'bankAccountNumber', 'nik', 'homeAddress', 'personalPhone', 'salary']) {
    if (!byName[name]) continue; // not even listed
    assert.equal(byName[name].bisa_diisi, false, name);
    assert.equal('isi' in byName[name], false, `${name}: its value is never read back`);
  }
  assert.doesNotMatch(JSON.stringify(read), /1234567890|3174000000000001|Jl\. Contoh|811 0000|9000000/);

  const res = await call('isi_form', {
    formulir: 'hr-offboarding',
    isian: [
      { kolom: 'personKey', isi: 'Budi' }, { kolom: 'lastWorkingDate', isi: '2026-10-30' },
      { kolom: 'reasonCode', isi: 'Resign' }, { kolom: 'notes', isi: 'Keluar karena konflik dengan atasan' },
      { kolom: 'bankAccountNumber', isi: '999' }, { kolom: 'nik', isi: '3174' }, { kolom: 'homeAddress', isi: 'Jl. X' }, { kolom: 'personalPhone', isi: '0811' }, { kolom: 'salary', isi: '1' },
    ],
  }, token);
  // Only the two fields of the policy travel; the text of the person goes to the page's own search.
  assert.deepEqual(sentFill(browser), [{ kolom: 'personKey', isi: 'Budi' }, { kolom: 'lastWorkingDate', isi: '2026-10-30' }]);
  const refused = refusedOf(res);
  assert.deepEqual(res.body.data.diisi, ['lastWorkingDate']);
  assert.deepEqual(refused.personKey.kandidat, ['Budi Santoso — Staff Gudang · Warehouse', 'Budi Hartono — Sales · Sales']);
  for (const name of ['reasonCode', 'notes', 'bankAccountNumber', 'nik', 'homeAddress', 'personalPhone', 'salary']) assert.ok(refused[name], `${name} is refused`);
  assert.equal(refused.reasonCode.alasan, USER_ONLY);
  assert.equal(refused.notes.alasan, USER_ONLY);
  // The audit names fields, never their content.
  assert.doesNotMatch(audit.at(-1).raw, /konflik|Budi|2026-10-30/);
  browser.close();
});

const TEMPLATE_FORM = {
  id: 'hr-checklist-template', judul: 'Template checklist', izin: 'hrga.checklist_template.manage', belum_disimpan: false,
  kolom: [
    { nama: 'workflowType', label: 'Jenis', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Onboarding', 'Offboarding'], isi: 'Onboarding' },
    { nama: 'departmentId', label: 'Divisi', jenis: 'select', bisa_diisi: true, pilihan: ['IT', 'Sales'], isi: '' },
    { nama: 'name', label: 'Nama', jenis: 'text', wajib: true, bisa_diisi: true, maks: 120, isi: '' },
    {
      nama: 'items', label: 'Item checklist', jenis: 'rows', wajib: true, bisa_diisi: true, maks_baris: 50, boleh_tambah: true,
      kolom_baris: [
        { nama: 'ownerGroup', label: 'Tim', jenis: 'select', bisa_diisi: true, pilihan: ['IT', 'GA', 'Atasan', 'People & Culture'] },
        { nama: 'category', label: 'Kategori', jenis: 'select', bisa_diisi: true, pilihan: ['Lainnya'] },
        { nama: 'title', label: 'Judul', jenis: 'text', wajib: true, bisa_diisi: true, maks: 200 },
        { nama: 'offsetDays', label: 'Hari relatif', jenis: 'number', bisa_diisi: true, min: -30, maks_angka: 30, kelipatan: 1 },
        { nama: 'requires', label: 'Hanya bila', jenis: 'select', bisa_diisi: true, pilihan: ['Butuh laptop'] },
        // Columns a page must never offer:
        { nama: 'isActive', label: 'Aktif', jenis: 'checkbox', bisa_diisi: true },
        { nama: 'attachment', label: 'Lampiran', jenis: 'text', bisa_diisi: true },
      ],
      baris: [{ no: 1, isi: { ownerGroup: 'IT', category: 'Lainnya', title: 'Siapkan laptop', offsetDays: '-3', requires: '' }, diisi_pengguna: true }],
    },
  ],
};

test('checklist template rows: every cell passes the field policy — a status or an upload column never reaches the browser', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'hrga.view', 'hrga.checklist_template.manage']);
  const browser = fakeBrowser('/hrga/checklist-templates', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/hrga/checklist-templates', formulir: [TEMPLATE_FORM] } }
    : { ok: true, result: { diisi: ['name', 'items'], ditolak: [], baris: { items: 2 } } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  const items = read.kolom.find((k) => k.nama === 'items');
  assert.deepEqual(items.kolom_baris.map((k) => [k.nama, k.bisa_diisi]), [['ownerGroup', true], ['category', true], ['title', true], ['offsetDays', true], ['requires', true], ['isActive', false], ['attachment', false]]);
  assert.deepEqual(items.baris, [{ no: 1, isi: { ownerGroup: 'IT', category: 'Lainnya', title: 'Siapkan laptop', offsetDays: '-3', requires: '' }, diisi_pengguna: true }]);

  const res = await call('isi_form', {
    formulir: 'hr-checklist-template',
    isian: [
      { kolom: 'name', isi: 'Onboarding Sales' },
      { kolom: 'items', baris: [
        { ownerGroup: 'GA', category: 'Lainnya', title: 'Siapkan meja', offsetDays: '-1', isActive: 'ya', attachment: 'x.pdf' },
        { ownerGroup: 'Atasan', title: 'Perkenalan tim', offsetDays: '0', status: 'completed' },
      ] },
    ],
  }, token);
  assert.deepEqual(sentFill(browser), [
    { kolom: 'name', isi: 'Onboarding Sales' },
    { kolom: 'items', cara: 'tambah', baris: [{ ownerGroup: 'GA', category: 'Lainnya', title: 'Siapkan meja', offsetDays: '-1' }, { ownerGroup: 'Atasan', title: 'Perkenalan tim', offsetDays: '0' }] },
  ]);
  const refused = refusedOf(res);
  assert.equal(refused['items[1].isActive'].alasan, USER_ONLY);
  assert.equal(refused['items[1].attachment'].alasan, USER_ONLY);
  assert.ok(refused['items[2].status'], 'a column the form does not have');
  assert.deepEqual(res.body.data.baris_ditambahkan, { items: 2 });
  assert.deepEqual(audit.at(-1).metadata.rows, { items: 2 });
  assert.doesNotMatch(audit.at(-1).raw, /Siapkan meja|Perkenalan/);
  browser.close();
});

test('a person\'s work profile (edit): the record is named, user-only fields are neither read back nor filled', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'people.directory.view', 'people.directory.manage']);
  const form = {
    id: 'people-person-edit', judul: 'Ubah profil kerja', izin: 'people.directory.manage', mode: 'ubah', rekaman: { jenis: 'directory_person', id: 'p7' }, belum_disimpan: false,
    kolom: [
      { nama: 'name', label: 'Nama', jenis: 'text', wajib: true, bisa_diisi: true, isi: 'Sari Dewi' },
      { nama: 'position', label: 'Jabatan', jenis: 'text', bisa_diisi: true, isi: 'Staff' },
      person('managerKey', 'Atasan langsung', { isi: 'Rina' }),
      { nama: 'workPhone', label: 'Telepon kerja', jenis: 'text', bisa_diisi: false, isi: '+62 21 555 1234' },
      { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: false, isi: 'Resign' },
      { nama: 'resignedOn', label: 'Tanggal resign', jenis: 'date', bisa_diisi: false, isi: '2026-09-30' },
      { nama: 'excludedReason', label: 'Alasan dikecualikan', jenis: 'text', bisa_diisi: false, isi: 'Akun uji' },
      { nama: 'notes', label: 'Catatan', jenis: 'textarea', bisa_diisi: false, isi: 'catatan rahasia HR' },
    ],
  };
  const browser = fakeBrowser('/people/directory/p7', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/people/directory/p7', formulir: [form] } }
    : { ok: true, result: { diisi: ['position'], ditolak: [] } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.equal(read.mode, 'ubah');
  assert.deepEqual(read.kolom.map((k) => [k.nama, k.bisa_diisi, k.isi]), [
    ['name', true, 'Sari Dewi'], ['position', true, 'Staff'], ['managerKey', true, 'Rina'],
    ['workPhone', false, undefined], ['status', false, undefined], ['resignedOn', false, undefined], ['excludedReason', false, undefined], ['notes', false, undefined],
  ]);
  assert.doesNotMatch(JSON.stringify(read), /555 1234|2026-09-30|Akun uji|rahasia HR/);

  const res = await call('isi_form', {
    formulir: 'people-person-edit',
    isian: [{ kolom: 'position', isi: 'Supervisor Gudang' }, { kolom: 'workPhone', isi: '+62 811 1111' }, { kolom: 'status', isi: 'Resign' }, { kolom: 'resignedOn', isi: '2026-10-01' }, { kolom: 'notes', isi: 'x' }],
  }, token);
  assert.deepEqual(sentFill(browser), [{ kolom: 'position', isi: 'Supervisor Gudang' }]);
  const refused = refusedOf(res);
  for (const name of ['workPhone', 'status', 'resignedOn', 'notes']) assert.equal(refused[name].alasan, USER_ONLY, name);
  assert.deepEqual([audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['edit', 'directory_person', 'p7']);
  assert.doesNotMatch(audit.at(-1).raw, /Supervisor|811/);
  browser.close();
});

test('a task dialog lookup: the device is chosen by the page; without the form\'s permission nothing is filled', async (t) => {
  const form = {
    id: 'hr-task-device-handover', judul: 'Serahkan perangkat', izin: 'device.assign', belum_disimpan: false,
    kolom: [
      { nama: 'deviceId', label: 'Perangkat', jenis: 'lookup', wajib: true, bisa_diisi: true, isi: '' },
      { nama: 'expectedReturnDate', label: 'Rencana kembali', jenis: 'date', bisa_diisi: true, isi: '' },
    ],
  };
  agentDb(t, ['ai_command.use', 'hrga.view', 'device.assign']);
  const browser = fakeBrowser('/hrga/workflows/12', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/hrga/workflows/12', formulir: [form] } }
    : { ok: true, result: { diisi: [], ditolak: [{ nama: 'deviceId', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['ThinkPad T14 — SN-A1 · Kantor Pusat', 'ThinkPad T14 — SN-B2 · Gudang', 'c', 'd', 'e', 'f'] }] } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.match(read.kolom[0].cara_isi, /halaman mencarinya/);
  const res = await call('isi_form', { formulir: 'hr-task-device-handover', isian: [{ kolom: 'deviceId', isi: 'ThinkPad T14' }, { kolom: 'status', isi: 'completed' }] }, token);
  assert.deepEqual(sentFill(browser), [{ kolom: 'deviceId', isi: 'ThinkPad T14' }]);
  assert.equal(refusedOf(res).deviceId.kandidat.length, 5);
  browser.close();

  // The same page for a user without device.assign: the form is listed as not fillable and no fill is sent.
  bridge.reset();
  answerNo += 1;
  agentDb(t, ['ai_command.use', 'hrga.view']);
  const other = fakeBrowser('/hrga/workflows/12', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/hrga/workflows/12', formulir: [form] } }
    : { ok: true, result: { diisi: ['deviceId'], ditolak: [] } }));
  const token2 = tokenFor();
  const denied = (await call('baca_formulir', {}, token2)).body.data.formulir[0];
  assert.equal(denied.bisa_diisi, false);
  const none = await call('isi_form', { formulir: 'hr-task-device-handover', isian: [{ kolom: 'deviceId', isi: 'ThinkPad T14' }] }, token2);
  assert.equal(none.body.data.berhasil, false);
  assert.equal(other.seen.filter((request) => request.op === 'fillForm').length, 0);
  other.close();
});
