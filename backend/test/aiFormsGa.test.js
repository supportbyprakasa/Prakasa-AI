// Wave C2 — the GA forms Prakasa AI may fill (docs/prakasa-ai-rencana.md §9.9,
// §9.11): Layanan GA (requests, room booking, rooms, "Tugaskan") and Operasional
// GA (upkeep schedules, contracts, utility bills, "Catat perawatan"). The policy
// of each form is pinned here; the round trips prove that a rupiah field, a
// status or a paid date sent by the model never reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');

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
const MAINTENANCE = ['name', 'category', 'locationId', 'vendorName', 'intervalDays', 'lastDoneOn', 'nextDueOn', 'notes'];
const CONTRACT = ['vendorName', 'kind', 'description', 'locationId', 'startOn', 'endOn', 'noticeDays', 'notes'];
const BILL = ['utility', 'locationId', 'period', 'usageAmount', 'dueOn', 'notes'];
const BILL_USER = ['customerNumber', 'amount', 'paidOn'];
const ROOM = ['name', 'locationId', 'capacity', 'notes'];

// id → [permission, mode, record, route, file, fields.ai, fields.userOnly]
const EXPECTED = {
  'ga-request-atk': ['ga.request.create', 'create', undefined, '/ga?baru=atk', 'pages/ga/GaForms.jsx', ['locationId', 'note', 'items', 'items.itemName', 'items.qty', 'items.unit'], []],
  'ga-request-facility_repair': ['ga.request.create', 'create', undefined, '/ga?baru=facility_repair', 'pages/ga/GaForms.jsx', ['locationId', 'area', 'description', 'urgent'], ['photo']],
  'ga-request-other': ['ga.request.create', 'create', undefined, '/ga?baru=other', 'pages/ga/GaForms.jsx', ['locationId', 'title', 'description'], []],
  'ga-booking-room': ['ga.request.create', 'create', undefined, '/ga?form=pinjam-ruang', 'pages/ga/GaForms.jsx', ['resourceId', 'date', 'start', 'end', 'purpose'], []],
  'ga-resource': ['ga.resource.manage', 'create', undefined, '/ga?tab=sumber&form=ruang', 'pages/ga/GaForms.jsx', ROOM, []],
  'ga-resource-edit': ['ga.resource.manage', 'edit', 'ga_resource', '/ga?tab=sumber&ubah=<id ruang>', 'pages/ga/GaForms.jsx', ROOM, []],
  'ga-request-assign': ['ga.request.process', 'edit', 'ga_request', '/ga/requests/<id permintaan>?form=tugaskan', 'pages/ga/GaRequestDetail.jsx', ['assignee'], []],
  'ga-ops-maintenance': ['ga.ops.manage', 'create', undefined, '/ga/operations?tab=maintenance&baru=1', 'pages/ga/GaOpsDialogs.jsx', MAINTENANCE, []],
  'ga-ops-maintenance-edit': ['ga.ops.manage', 'edit', 'ga_maintenance_item', '/ga/operations?tab=maintenance&ubah=<id jadwal perawatan>', 'pages/ga/GaOpsDialogs.jsx', MAINTENANCE, ['status']],
  'ga-ops-contract': ['ga.ops.manage', 'create', undefined, '/ga/operations?tab=contracts&baru=1', 'pages/ga/GaOpsDialogs.jsx', CONTRACT, ['monthlyCost']],
  'ga-ops-contract-edit': ['ga.ops.manage', 'edit', 'ga_contract', '/ga/operations?tab=contracts&ubah=<id kontrak>', 'pages/ga/GaOpsDialogs.jsx', CONTRACT, ['monthlyCost', 'status']],
  'ga-ops-bill': ['ga.ops.manage', 'create', undefined, '/ga/operations?tab=bills&baru=1', 'pages/ga/GaOpsDialogs.jsx', BILL, BILL_USER],
  'ga-ops-bill-edit': ['ga.ops.manage', 'edit', 'ga_utility_bill', '/ga/operations?tab=bills&ubah=<id tagihan>', 'pages/ga/GaOpsDialogs.jsx', BILL, BILL_USER],
  'ga-ops-maintenance-log': [['ga.ops.manage', 'ga.request.process'], 'create', undefined, '/ga/operations?tab=maintenance&open=<id jadwal perawatan>&form=catat-perawatan', 'pages/ga/GaOpsDialogs.jsx', ['doneOn', 'result', 'note'], ['cost']],
};

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
const currentAnswer = () => `ga-answer-${answerNo}`;
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

test.afterEach(() => { bridge.reset(); answerNo += 1; });

test('the GA catalog: every form, its permission, mode, record, route and field policy', () => {
  const ga = formCatalog.FORMS.filter((form) => form.module === 'ga');
  assert.deepEqual(ga.map((form) => form.id).sort(), Object.keys(EXPECTED).sort());
  for (const [id, [permission, mode, record, route, file, ai, userOnly]] of Object.entries(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    assert.ok(form, id);
    assert.deepEqual(form.permission, permission, id);
    assert.equal(form.mode, mode, id);
    assert.equal(form.record, record, id);
    assert.equal(form.route, route, id);
    assert.equal(form.file, file, id);
    assert.deepEqual([...form.fields.ai], ai, id);
    assert.deepEqual([...form.fields.userOnly], userOnly, id);
    assert.deepEqual([...form.money], [], `${id}: no rupiah field is fillable`);
    for (const name of form.fields.ai) {
      const field = name.split('.').pop();
      assert.equal(fieldClass(field), 'open', `${id}: ${name}`);
      assert.equal(moneyLike(field), false, `${id}: ${name} looks like rupiah`);
    }
  }
});

test('what is never the AI\'s on the GA forms: rupiah, customer / meter number, paid date, status, uploads', () => {
  const ai = (id) => formCatalog.byId.get(id).fields.ai;
  for (const id of ['ga-ops-bill', 'ga-ops-bill-edit']) {
    for (const name of ['amount', 'customerNumber', 'paidOn']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
    // Usage (kWh / m³) is not rupiah: a reviewed exception (fieldPolicy.js NOT_MONEY).
    assert.ok(ai(id).includes('usageAmount'), id);
    assert.equal(moneyLike('usageAmount'), false);
    assert.equal(moneyLike('amount'), true);
  }
  for (const id of ['ga-ops-contract', 'ga-ops-contract-edit']) {
    assert.ok(!ai(id).includes('monthlyCost'), id);
    assert.ok(!ai(id).includes('status'), id);
  }
  for (const id of ['ga-ops-maintenance', 'ga-ops-maintenance-edit']) assert.ok(!ai(id).includes('status'), id);
  assert.ok(!ai('ga-ops-maintenance-log').includes('cost'));
  assert.ok(!ai('ga-request-facility_repair').includes('photo'));
  for (const id of ['ga-resource', 'ga-resource-edit']) {
    assert.ok(!ai(id).includes('isActive'), `${id}: turning a room off is a decision`);
    assert.ok(!ai(id).includes('plateNumber'), `${id}: vehicles live in TrackCar`);
  }
  // Decisions on a request are dialogs of their own and are no form at all.
  assert.deepEqual(ai('ga-request-assign'), ['assignee']);
  for (const id of Object.keys(EXPECTED)) {
    for (const name of ['status', 'decision', 'approve', 'reject', 'reason', 'file', 'photo', 'version']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  }
  // Vehicles are borrowed in TrackCar: there is no vehicle form to open.
  assert.equal(formCatalog.FORMS.some((form) => /vehicle|kendaraan/i.test(`${form.id} ${form.route}`)), false);
});

test('who is offered which GA form, and which routes open one', () => {
  const idsFor = (permissions) => formCatalog.formsFor({ permissions }).map((form) => form.formulir).filter((id) => id.startsWith('ga-'));
  assert.deepEqual(idsFor(['ga.request.create']), ['ga-request-facility_repair', 'ga-request-other', 'ga-request-atk', 'ga-booking-room']);
  // "Catat perawatan" is saved by the Supervisor / Head OR by GA staff (any of) — looking alone is not enough.
  // "Catat perawatan" also needs the page's own ga.ops.view, as its endpoint does (aiFormsPermissions.test.js).
  assert.deepEqual(idsFor(['ga.request.process']), ['ga-request-assign']);
  assert.deepEqual(idsFor(['ga.request.process', 'ga.ops.view']), ['ga-request-assign', 'ga-ops-maintenance-log']);
  assert.deepEqual(idsFor(['ga.resource.manage']), ['ga-resource', 'ga-resource-edit']);
  assert.deepEqual(idsFor(['ga.ops.view']), []);
  assert.equal(idsFor(['ga.ops.manage']).length, 6);
  assert.equal(idsFor(['ga.ops.manage', 'ga.ops.view']).length, 7);
  const edit = formCatalog.formsFor({ permissions: ['ga.ops.manage'] }).find((form) => form.formulir === 'ga-ops-bill-edit');
  assert.equal(edit.mode, 'ubah');

  const opens = (pathname, search) => formCatalog.opensForm({ pathname, search });
  assert.equal(opens('/ga', 'form=pinjam-ruang'), true);
  assert.equal(opens('/ga', 'tab=sumber&form=ruang'), true);
  assert.equal(opens('/ga', 'tab=sumber&ubah=4'), true);
  assert.equal(opens('/ga', 'tab=sumber'), false);
  assert.equal(opens('/ga/requests/12', 'form=tugaskan'), true);
  assert.equal(opens('/ga/requests/12', ''), false);
  assert.equal(opens('/ga/operations', 'tab=contracts&baru=1'), true);
  assert.equal(opens('/ga/operations', 'tab=bills&ubah=7'), true);
  assert.equal(opens('/ga/operations', 'tab=maintenance&open=3&form=catat-perawatan'), true);
  assert.equal(opens('/ga/operations', 'tab=maintenance&open=3'), false);
  assert.equal(opens('/ga', 'baru=vehicle'), false);
});

const BILL_FORM = {
  id: 'ga-ops-bill-edit', judul: 'Ubah tagihan', izin: 'ga.ops.manage', mode: 'ubah', rekaman: { jenis: 'ga_utility_bill', id: '7' },
  kolom: [
    { nama: 'utility', label: 'Jenis', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Listrik', 'Air', 'Gas', 'Lainnya'], isi: 'Listrik' },
    { nama: 'locationId', label: 'Lokasi', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Kantor pusat', 'Gudang'], isi: 'Kantor pusat' },
    // What a careless page might mark fillable: the catalog decides.
    { nama: 'customerNumber', label: 'ID pelanggan / nomor meter', jenis: 'text', bisa_diisi: true, isi: '5312-0099-8871' },
    { nama: 'period', label: 'Periode', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Okt 2026', 'Sep 2026'], isi: 'Sep 2026' },
    { nama: 'amount', label: 'Jumlah tagihan (Rp)', jenis: 'number', wajib: true, bisa_diisi: true, isi: '4250000' },
    { nama: 'usageAmount', label: 'Pemakaian', jenis: 'number', bisa_diisi: true, isi: '3100' },
    { nama: 'dueOn', label: 'Jatuh tempo', jenis: 'date', bisa_diisi: true, isi: '' },
    { nama: 'paidOn', label: 'Tanggal dibayar', jenis: 'date', bisa_diisi: true, isi: '' },
    { nama: 'notes', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, isi: '' },
  ],
};

test('edit a utility bill: the amount, the meter number and the paid date never reach the browser; the usage (kWh) may be filled', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'ga.ops.view', 'ga.ops.manage']);
  const browser = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [BILL_FORM] } }
    : { ok: true, result: { diisi: ['dueOn', 'notes'], ditolak: [] } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.equal(read.mode, 'ubah');
  const shown = Object.fromEntries(read.kolom.map((k) => [k.nama, k]));
  for (const name of BILL) assert.equal(shown[name].bisa_diisi, true, name);
  for (const name of BILL_USER) {
    assert.equal(shown[name].bisa_diisi, false, name);
    assert.equal(shown[name].isi, undefined, `${name}: its value is not read`);
  }
  assert.doesNotMatch(JSON.stringify(read), /4250000|5312-0099-8871/);

  const res = await call('isi_form', {
    formulir: 'ga-ops-bill-edit',
    isian: [
      { kolom: 'dueOn', isi: '2026-10-20' }, { kolom: 'notes', isi: 'Tagihan PLN September' },
      { kolom: 'amount', isi: '1' }, { kolom: 'usageAmount', isi: '9999' }, { kolom: 'customerNumber', isi: '0000' }, { kolom: 'paidOn', isi: '2026-10-02' },
      { kolom: 'status', isi: 'Selesai' },
    ],
  }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian, [{ kolom: 'dueOn', isi: '2026-10-20' }, { kolom: 'notes', isi: 'Tagihan PLN September' }, { kolom: 'usageAmount', isi: '9999' }]);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  for (const name of BILL_USER) assert.equal(refused[name], USER_ONLY, name);
  assert.ok('status' in refused);
  assert.deepEqual(res.body.data.diisi, ['dueOn', 'notes']);
  const row = audit.at(-1);
  assert.deepEqual([row.metadata.formId, row.metadata.mode, row.metadata.recordType, row.metadata.recordId], ['ga-ops-bill-edit', 'edit', 'ga_utility_bill', '7']);
  assert.doesNotMatch(row.raw, /PLN|2026-10-20|9999/);
  browser.close();
});

test('a contract and an upkeep record: the rupiah and the status stay with the user; without ga.ops.manage nothing is filled', async (t) => {
  const contract = {
    id: 'ga-ops-contract', judul: 'Tambah kontrak', izin: 'ga.ops.manage',
    kolom: [
      { nama: 'vendorName', label: 'Vendor', jenis: 'text', wajib: true, bisa_diisi: true, isi: '' },
      { nama: 'monthlyCost', label: 'Biaya per bulan (Rp)', jenis: 'number', bisa_diisi: true, isi: '' },
      { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: true, pilihan: ['Aktif', 'Selesai'], isi: 'Aktif' },
    ],
  };
  const log = {
    id: 'ga-ops-maintenance-log', judul: 'Catat perawatan', izin: ['ga.ops.manage', 'ga.request.process'],
    kolom: [
      { nama: 'doneOn', label: 'Tanggal dikerjakan', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-02' },
      { nama: 'cost', label: 'Biaya (Rp)', jenis: 'number', bisa_diisi: true, isi: '' },
      { nama: 'note', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, isi: '' },
    ],
  };
  agentDb(t, ['ai_command.use', 'ga.ops.view', 'ga.ops.manage']);
  const browser = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [contract, log] } }
    : { ok: true, result: { diisi: request.input.isian.map((item) => item.kolom), ditolak: [] } }));
  const token = tokenFor();
  const a = await call('isi_form', { formulir: 'ga-ops-contract', isian: [{ kolom: 'vendorName', isi: 'PT Bersih Selalu' }, { kolom: 'monthlyCost', isi: '12000000' }, { kolom: 'status', isi: 'Selesai' }] }, token);
  const b = await call('isi_form', { formulir: 'ga-ops-maintenance-log', isian: [{ kolom: 'note', isi: 'Filter diganti' }, { kolom: 'cost', isi: '350000' }] }, token);
  const sent = browser.seen.filter((r) => r.op === 'fillForm').map((r) => r.input.isian);
  assert.deepEqual(sent, [[{ kolom: 'vendorName', isi: 'PT Bersih Selalu' }], [{ kolom: 'note', isi: 'Filter diganti' }]]);
  assert.deepEqual(a.body.data.ditolak.map((x) => [x.kolom, x.alasan]), [['monthlyCost', USER_ONLY], ['status', USER_ONLY]]);
  assert.deepEqual(b.body.data.ditolak.map((x) => [x.kolom, x.alasan]), [['cost', USER_ONLY]]);
  browser.close();
  bridge.reset();
  answerNo += 1;

  // People & Culture staff who may only look: the register forms are not theirs.
  agentDb(t, ['ai_command.use', 'ga.ops.view']);
  const viewer = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [contract] } }
    : { ok: true, result: { diisi: ['vendorName'] } }));
  const refused = await call('isi_form', { formulir: 'ga-ops-contract', isian: [{ kolom: 'vendorName', isi: 'x' }] }, tokenFor());
  assert.deepEqual(refused.body.data, { berhasil: false, alasan: 'Pengguna tidak punya izin untuk formulir ini.' });
  // …and neither is the upkeep record: it needs ga.ops.manage OR ga.request.process.
  viewer.close();
  bridge.reset();
  answerNo += 1;
  agentDb(t, ['ai_command.use', 'ga.ops.view']);
  const looker = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [log] } }
    : { ok: true, result: { diisi: ['note'] } }));
  const noLog = await call('isi_form', { formulir: 'ga-ops-maintenance-log', isian: [{ kolom: 'note', isi: 'x' }] }, tokenFor());
  assert.deepEqual(noLog.body.data, { berhasil: false, alasan: 'Pengguna tidak punya izin untuk formulir ini.' });
  assert.equal(looker.seen.some((r) => r.op === 'fillForm'), false);
  looker.close();
  bridge.reset();
  answerNo += 1;
  // GA staff (ga.request.process, without ga.ops.manage) may record upkeep: any of the two permissions.
  agentDb(t, ['ai_command.use', 'ga.ops.view', 'ga.request.process']);
  const staff = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [log] } }
    : { ok: true, result: { diisi: request.input.isian.map((item) => item.kolom), ditolak: [] } }));
  const logged = await call('isi_form', { formulir: 'ga-ops-maintenance-log', isian: [{ kolom: 'note', isi: 'Filter diganti' }] }, tokenFor());
  assert.deepEqual(logged.body.data.diisi, ['note']);
  // A page that declares a permission the user does not hold is refused, even when the catalog's is held.
  staff.close();
  bridge.reset();
  answerNo += 1;
  agentDb(t, ['ai_command.use', 'ga.ops.view', 'ga.request.process']);
  const liar = fakeBrowser('/ga/operations', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/operations', formulir: [{ ...log, izin: ['ga.ops.manage'] }] } }
    : { ok: true, result: { diisi: ['note'] } }));
  const lied = await call('isi_form', { formulir: 'ga-ops-maintenance-log', isian: [{ kolom: 'note', isi: 'x' }] }, tokenFor());
  assert.equal(lied.body.data.berhasil, false);
  liar.close();
  assert.equal(viewer.seen.some((r) => r.op === 'fillForm'), false);
  viewer.close();
});

test('"Tugaskan": the name goes to the page\'s own list; an ambiguous name is not set and its candidates come back', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'ga.request.create', 'ga.request.process']);
  let form = {
    id: 'ga-request-assign', judul: 'Tugaskan permintaan', izin: 'ga.request.process', mode: 'ubah', rekaman: { jenis: 'ga_request', id: '12' },
    kolom: [
      { nama: 'assignee', label: 'Penanggung jawab', jenis: 'person', wajib: true, bisa_diisi: true, isi: '' },
      // Not a field of this dialog: a page that added it would still not get it filled.
      { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: true, pilihan: ['Diproses', 'Selesai', 'Ditolak'], isi: 'Diproses' },
    ],
  };
  let answer = { diisi: [], ditolak: [{ nama: 'assignee', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Budi Santoso', 'Budi Hartono', 'c', 'd', 'e', 'f', { id: 31 }] }] };
  const browser = fakeBrowser('/ga/requests/12', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga/requests/12', formulir: [form] } }
    : { ok: true, result: answer }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.deepEqual(read.kolom.map((k) => [k.nama, k.bisa_diisi]), [['assignee', true], ['status', false]]);
  assert.match(read.kolom[0].cara_isi, /direktori/);

  const many = await call('isi_form', { formulir: 'ga-request-assign', isian: [{ kolom: 'assignee', isi: 'Budi' }, { kolom: 'status', isi: 'Selesai' }] }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian, [{ kolom: 'assignee', isi: 'Budi' }], 'a text, never an id; the status is not sent');
  const refused = Object.fromEntries(many.body.data.ditolak.map((x) => [x.kolom, x]));
  assert.deepEqual(refused.assignee.kandidat, ['Budi Santoso', 'Budi Hartono', 'c', 'd', 'e']);
  assert.equal(refused.status.alasan, USER_ONLY);
  assert.deepEqual(many.body.data.diisi, []);

  answer = { diisi: ['assignee'], ditolak: [] };
  const one = await call('isi_form', { formulir: 'ga-request-assign', isian: [{ kolom: 'assignee', isi: 'Budi Santoso' }] }, token);
  assert.deepEqual(one.body.data.diisi, ['assignee']);
  assert.deepEqual([audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['edit', 'ga_request', '12']);
  assert.doesNotMatch(audit.at(-1).raw, /Budi/);

  // The page does not say which request is being assigned: nothing is filled.
  bridge.channelOf(currentAnswer()).forms.clear();
  form = { ...form, rekaman: { jenis: 'ga_booking', id: '12' } };
  const none = await call('isi_form', { formulir: 'ga-request-assign', isian: [{ kolom: 'assignee', isi: 'Budi Santoso' }] }, token);
  assert.deepEqual(none.body.data, { berhasil: false, alasan: 'Formulir ubah ini tidak menyebut data yang diubah.' });
  assert.equal(browser.seen.filter((r) => r.op === 'fillForm').length, 2);
  browser.close();

  // Without ga.request.process the dialog is not the user's to fill.
  bridge.reset();
  answerNo += 1;
  agentDb(t, ['ai_command.use', 'ga.request.create']);
  form = { ...form, rekaman: { jenis: 'ga_request', id: '12' } };
  const requester = fakeBrowser('/ga/requests/12', (request) => (request.op === 'readForms' ? { ok: true, result: { rute: '/ga/requests/12', formulir: [form] } } : { ok: true, result: { diisi: ['assignee'] } }));
  const denied = await call('isi_form', { formulir: 'ga-request-assign', isian: [{ kolom: 'assignee', isi: 'Budi Santoso' }] }, tokenFor());
  assert.equal(denied.body.data.berhasil, false);
  assert.equal(requester.seen.some((r) => r.op === 'fillForm'), false);
  requester.close();
});

test('book a room: the five fields of the form, and a field the form does not have is refused', async (t) => {
  agentDb(t, ['ai_command.use', 'ga.request.create']);
  const room = {
    id: 'ga-booking-room', judul: 'Pinjam ruang', izin: 'ga.request.create',
    kolom: [
      { nama: 'resourceId', label: 'Ruang', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Ruang rapat lantai 2 · 12 orang · Kantor pusat'], isi: '' },
      { nama: 'date', label: 'Tanggal', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-02' },
      { nama: 'start', label: 'Mulai', jenis: 'time', wajib: true, bisa_diisi: true, isi: '10:15' },
      { nama: 'end', label: 'Selesai', jenis: 'time', wajib: true, bisa_diisi: true, isi: '11:15' },
      { nama: 'purpose', label: 'Keperluan', jenis: 'text', wajib: true, bisa_diisi: true, maks: 255, isi: '' },
    ],
  };
  const browser = fakeBrowser('/ga', (request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/ga', formulir: [room] } }
    : { ok: true, result: { diisi: ['resourceId', 'date', 'start', 'purpose'], ditolak: [{ nama: 'end', alasan: 'Bentrok dengan 13.00–14.00 · Sales.' }] } }));
  const token = tokenFor();
  const opened = await call('buka_halaman', { rute: '/ga?form=pinjam-ruang' }, token);
  assert.equal(opened.statusCode, 200);
  assert.deepEqual(browser.seen[0].input, { rute: '/ga?form=pinjam-ruang', harap_formulir: true });
  const res = await call('isi_form', {
    formulir: 'ga-booking-room',
    isian: [
      { kolom: 'resourceId', isi: 'Ruang rapat lantai 2' }, { kolom: 'date', isi: 'besok' }, { kolom: 'start', isi: '13:00' }, { kolom: 'end', isi: '14:00' },
      { kolom: 'purpose', isi: 'Rapat bulanan' }, { kolom: 'needsDriver', isi: 'ya' }, { kolom: 'destination', isi: 'Bandung' },
    ],
  }, token);
  assert.deepEqual(browser.seen.find((r) => r.op === 'fillForm').input.isian.map((item) => item.kolom), ['resourceId', 'date', 'start', 'end', 'purpose']);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  assert.equal(refused.end, 'Bentrok dengan 13.00–14.00 · Sales.', 'the form\'s own clash check reaches the model');
  assert.ok('needsDriver' in refused && 'destination' in refused, 'vehicle fields are not part of any form here');
  browser.close();
});
