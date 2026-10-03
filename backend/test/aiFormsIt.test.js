// Wave C2 — the IT forms Prakasa AI may fill (docs/prakasa-ai-rencana.md §9.9,
// src/services/ai/agent/forms/it.js): tickets, devices, BAST, subscriptions,
// the infrastructure registers and locations. The catalog is the server's own
// word on each form: its permission, what the AI may fill and what stays with
// the user. Infrastructure identifiers (IP address, serial number, customer
// number, portal address), phone numbers and rupiah are never filled and their
// value never reaches the model — whatever a browser says.
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
const registry = require('../src/services/aiToolRegistry.service');

const USER = 15;
const PAGE_TOOLS = ['buka_halaman', 'baca_formulir', 'isi_form'];
const form = (id) => formCatalog.byId.get(id);

// id → [permission, mode, record, userOnly]
const EXPECTED = {
  'it-ticket-comment': ['it_ticket.comment', 'create', undefined, []],
  'it-device': ['device.manage', 'create', undefined, ['serialNumber', 'imei', 'macAddress', 'purchasePrice']],
  'it-device-edit': ['device.manage', 'edit', 'device', ['serialNumber', 'imei', 'macAddress', 'purchasePrice']],
  'it-device-status': ['device.manage', 'edit', 'device', ['status']],
  'it-device-return': ['device.assign', 'edit', 'device_assignment', []],
  'it-device-maintenance': ['device.log.manage', 'create', undefined, ['cost']],
  'it-device-repair': ['device.log.manage', 'create', undefined, []],
  'it-bast-device': [['device.handover.manage', 'ga.ops.manage'], 'create', undefined, ['acknowledgerUserId']],
  'it-bast-phone': [['it.infra.manage', 'ga.ops.manage'], 'create', undefined, ['acknowledgerUserId']],
  'it-location': ['device.manage', 'create', undefined, []],
  'it-location-edit': ['device.manage', 'edit', 'it_location', ['isActive']],
  'it-subscription': ['subscription.manage', 'create', undefined, ['unitPrice']],
  'it-subscription-invoice': ['subscription.invoice.manage', 'create', undefined, ['amount', 'taxAmount', 'totalAmount', 'currency', 'file']],
  'it-license': ['subscription.license.manage', 'create', undefined, []],
  'it-infra-network': ['it.infra.manage', 'create', undefined, ['serialNumber', 'ipAddress', 'status']],
  'it-infra-network-edit': ['it.infra.manage', 'edit', 'it_network_device', ['serialNumber', 'ipAddress', 'status']],
  'it-infra-isp': ['it.infra.manage', 'create', undefined, ['customerNumber', 'monthlyCost', 'status']],
  'it-infra-isp-edit': ['it.infra.manage', 'edit', 'it_isp_link', ['customerNumber', 'monthlyCost', 'status']],
  'it-infra-cctv': ['it.infra.manage', 'create', undefined, ['serialNumber']],
  'it-infra-cctv-edit': ['it.infra.manage', 'edit', 'it_cctv', ['serialNumber']],
  'it-infra-backup': ['it.infra.manage', 'create', undefined, []],
  'it-infra-backup-edit': ['it.infra.manage', 'edit', 'it_backup', ['status']],
  'it-infra-phone': ['it.infra.manage', 'create', undefined, ['number', 'monthlyCost']],
  'it-infra-phone-edit': ['it.infra.manage', 'edit', 'it_phone_line', ['number', 'monthlyCost', 'status']],
  'it-infra-vendor': [['it.infra.manage', 'software_vendor.manage'], 'create', undefined, ['phone', 'portalUrl']],
  'it-infra-vendor-edit': [['it.infra.manage', 'software_vendor.manage'], 'edit', 'it_vendor', ['phone', 'portalUrl']],
  'it-cctv-status': ['it.infra.manage', 'edit', 'it_cctv', ['status']],
  'it-backup-check': ['it.infra.manage', 'create', undefined, []],
  'it-gws-review': ['it.infra.manage', 'create', undefined, []],
  'it-phone-holder': ['it.infra.manage', 'edit', 'it_phone_line', []],
};

// Never the AI's, in any IT form: identifiers of the infrastructure and of a
// unit, where a login would be, phone numbers, rupiah, statuses and signatories.
const NEVER_AI = ['ipAddress', 'serialNumber', 'imei', 'macAddress', 'customerNumber', 'portalUrl', 'number', 'phone', 'licenseKey', 'password',
  'wifiPassword', 'credential', 'monthlyCost', 'purchasePrice', 'unitPrice', 'cost', 'amount', 'taxAmount', 'totalAmount', 'file', 'status',
  'acknowledgerUserId', 'isActive', 'userId'];

test('every IT form is in the catalog with its permission, mode, record and user-only fields', () => {
  for (const [id, [permission, mode, record, userOnly]] of Object.entries(EXPECTED)) {
    const listed = form(id);
    assert.ok(listed, `${id} is in formCatalog.byId`);
    assert.equal(listed.module, 'it', id);
    assert.deepEqual(listed.permission, permission, `${id}: permission`);
    assert.equal(listed.mode, mode, `${id}: mode`);
    assert.equal(listed.record, record, `${id}: record`);
    assert.deepEqual([...listed.fields.userOnly].sort(), [...userOnly].sort(), `${id}: userOnly`);
    assert.ok(listed.fields.ai.length >= 1, `${id}: something the AI may fill`);
    assert.deepEqual(listed.money, [], `${id}: no rupiah field is the AI's`);
  }
  const mine = formCatalog.FORMS.filter((item) => item.module === 'it').map((item) => item.id).sort();
  assert.deepEqual(mine, [...Object.keys(EXPECTED), 'it-help', 'it-ticket'].sort(), 'no IT form outside this test');
});

test('nothing sensitive is in fields.ai: infrastructure identifiers, phone numbers, rupiah, statuses, signatories', () => {
  for (const id of Object.keys(EXPECTED)) {
    const { ai } = form(id).fields;
    for (const name of NEVER_AI) assert.ok(!ai.includes(name), `${id}: ${name} must not be AI-fillable`);
    for (const name of ai) {
      assert.equal(fieldClass(name), 'open', `${id}.${name}`);
      assert.equal(moneyLike(name), false, `${id}.${name} looks like rupiah`);
      assert.doesNotMatch(name, /ipAddress|serial|imei|macAddress|password|sandi|secret|token|licen[cs]eKey|credential|customer|portal|url$|login|phone|price|cost|harga|biaya/i, `${id}.${name}`);
    }
  }
  // Named one by one, form by form.
  assert.ok(!form('it-infra-network').fields.ai.includes('ipAddress'));
  assert.ok(!form('it-infra-network-edit').fields.ai.includes('ipAddress'));
  assert.ok(!form('it-infra-network-edit').fields.ai.includes('serialNumber'));
  assert.ok(!form('it-infra-isp-edit').fields.ai.includes('customerNumber'));
  assert.ok(!form('it-infra-isp-edit').fields.ai.includes('monthlyCost'));
  assert.ok(!form('it-infra-cctv-edit').fields.ai.includes('serialNumber'));
  assert.ok(!form('it-infra-phone-edit').fields.ai.includes('number'));
  assert.ok(!form('it-infra-phone-edit').fields.ai.includes('monthlyCost'));
  assert.ok(!form('it-infra-vendor-edit').fields.ai.includes('portalUrl'));
  assert.ok(!form('it-infra-vendor-edit').fields.ai.includes('phone'));
  assert.ok(!form('it-device-edit').fields.ai.includes('purchasePrice'));
  assert.ok(!form('it-device-edit').fields.ai.includes('serialNumber'));
  assert.ok(!form('it-device-edit').fields.ai.includes('imei'));
  assert.ok(!form('it-device-edit').fields.ai.includes('macAddress'));
  assert.ok(!form('it-device-status').fields.ai.includes('status'));
  assert.ok(!form('it-cctv-status').fields.ai.includes('status'));
  assert.ok(!form('it-device-maintenance').fields.ai.includes('cost'));
  assert.ok(!form('it-subscription').fields.ai.includes('unitPrice'));
  assert.ok(!form('it-subscription-invoice').fields.ai.includes('totalAmount'));
  assert.ok(!form('it-subscription-invoice').fields.ai.includes('file'));
  assert.ok(!form('it-bast-device').fields.ai.includes('acknowledgerUserId'));
  assert.ok(!form('it-bast-phone').fields.ai.includes('acknowledgerUserId'));
  assert.ok(!form('it-location-edit').fields.ai.includes('isActive'));
  assert.deepEqual(form('it-license').fields.ai, ['seatLabel'], 'a licence key is not a field at all');
});

test('every IT form opens on a page the tool registry knows, and its route opens it', () => {
  const concrete = (route) => route.replace(/<[^<>]+>/g, '7');
  for (const id of Object.keys(EXPECTED)) {
    const listed = form(id);
    const [pathname, search = ''] = concrete(listed.route).split('?');
    assert.ok(registry.resolveTool(pathname), `${id}: ${pathname} is a page of the app`);
    assert.equal(listed.opens({ pathname, search }), true, `${id}: its own route opens it`);
    assert.match(listed.file, /^pages\/it\//, id);
    assert.doesNotMatch(listed.note, /sudah (di)?simpan|tersimpan otomatis/i, id);
  }
  // Another tab, or a missing id, does not count as opening the form.
  assert.equal(form('it-infra-isp').opens({ pathname: '/it/infrastructure', search: 'tab=network&baru=1' }), false);
  assert.equal(form('it-infra-isp-edit').opens({ pathname: '/it/infrastructure', search: 'tab=isp' }), false);
  assert.equal(form('it-cctv-status').opens({ pathname: '/it/infrastructure', search: 'tab=cctv&form=status' }), false);
});

test('what the model is told: the forms a user may open, each with what stays with the user', () => {
  const none = formCatalog.formsFor({ permissions: ['ai_command.use', 'it.infra.view', 'device.view'] }).filter((item) => item.formulir.startsWith('it-'));
  assert.deepEqual(none, [], 'viewing is not enough for any IT form');
  const infra = formCatalog.formsFor({ permissions: ['it.infra.manage'] }).map((item) => item.formulir);
  assert.ok(infra.includes('it-infra-network-edit') && infra.includes('it-phone-holder') && infra.includes('it-bast-phone'));
  assert.ok(!infra.includes('it-device') && !infra.includes('it-bast-device') && !infra.includes('it-subscription'));
  assert.match(form('it-infra-network-edit').note, /Alamat IP, nomor seri, dan status diisi pengguna/);
  assert.match(form('it-infra-vendor').note, /alamat portal vendor diisi pengguna/);
  assert.match(form('it-license').note, /Kunci lisensi tidak disimpan/);
});

// ---------------------------------------------------------------- round trip
function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
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
const currentAnswer = () => `it-forms-answer-${answerNo}`;
const tokenFor = () => signAgentToken({ userId: USER, entityId: 1, sessionId: 9, tools: PAGE_TOOLS, surface: 'panel', answerId: currentAnswer() });
async function call(name, input, token) {
  const req = { headers: { authorization: `Bearer ${token}` }, params: { name }, body: { input } };
  const res = fakeRes();
  let passed = false;
  await ctrl.requireAgent(req, res, () => { passed = true; });
  if (!passed) return res;
  await ctrl.callTool(req, res, (e) => { throw e; });
  return res;
}
function fakeBrowser(respond) {
  const seen = [];
  const close = bridge.open({
    answerId: currentAnswer(), sessionId: 9, userId: USER, route: '/it/infrastructure',
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

const IP = '192.168.10.254';
const SERIAL = 'SN-ZX81-0042';
// The edit form of a network device as a careless (or hostile) page might describe it:
// every sensitive field declared fillable, with its value.
const NETWORK_EDIT = {
  id: 'it-infra-network-edit', judul: 'Ubah perangkat jaringan', izin: 'it.infra.manage', mode: 'ubah', rekaman: { jenis: 'it_network_device', id: 12 }, belum_disimpan: false,
  kolom: [
    { nama: 'deviceType', label: 'Tipe', jenis: 'select', wajib: true, bisa_diisi: true, pilihan: ['Router', 'Switch'], isi: 'Router' },
    { nama: 'brandModel', label: 'Merek / model', jenis: 'text', wajib: true, bisa_diisi: true, isi: 'Asus AX6000' },
    { nama: 'serialNumber', label: 'Nomor seri', jenis: 'text', bisa_diisi: true, isi: SERIAL },
    { nama: 'ipAddress', label: 'Alamat IP', jenis: 'text', bisa_diisi: true, isi: IP },
    { nama: 'wifiPassword', label: 'Kata sandi Wi-Fi', jenis: 'text', bisa_diisi: true, isi: 'wifi-kantor-2026' },
    { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: true, pilihan: ['Aktif', 'Rusak'], isi: 'Aktif' },
    { nama: 'notes', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, isi: '' },
  ],
};

test('infrastructure edit form: IP address, serial number and status never reach the model and are never sent to the browser', async (t) => {
  const audit = agentDb(t, ['ai_command.use', 'it.infra.view', 'it.infra.manage']);
  const browser = fakeBrowser((request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/it/infrastructure?tab=network', formulir: [NETWORK_EDIT] } }
    : { ok: true, result: { diisi: ['brandModel', 'notes', 'ipAddress'], ditolak: [], masih_perlu: [] } }));
  const token = tokenFor();

  const read = await call('baca_formulir', {}, token);
  const shown = read.body.data.formulir[0];
  assert.equal(shown.bisa_diisi, true);
  assert.equal(shown.mode, 'ubah');
  const byName = Object.fromEntries(shown.kolom.map((k) => [k.nama, k]));
  assert.equal(byName.brandModel.bisa_diisi, true);
  assert.equal(byName.brandModel.isi, 'Asus AX6000');
  for (const name of ['ipAddress', 'serialNumber', 'status']) {
    assert.equal(byName[name].bisa_diisi, false, name);
    assert.equal('isi' in byName[name], false, `${name}: listed without its value`);
    assert.equal(byName[name].catatan, 'Hanya diisi pengguna.');
  }
  assert.equal('wifiPassword' in byName, false, 'a secret is not even listed');
  assert.doesNotMatch(JSON.stringify(read.body.data), new RegExp(`${IP.replace(/\./g, '\\.')}|${SERIAL}|wifi-kantor`), 'no sensitive value in what the model reads');

  const res = await call('isi_form', {
    formulir: 'it-infra-network-edit',
    isian: [
      { kolom: 'brandModel', isi: 'Mikrotik RB4011' },
      { kolom: 'ipAddress', isi: '10.0.0.1' },
      { kolom: 'serialNumber', isi: 'SN-BARU' },
      { kolom: 'wifiPassword', isi: 'abc12345' },
      { kolom: 'status', isi: 'Rusak' },
      { kolom: 'notes', isi: 'Dipindah ke ruang server' },
    ],
  }, token);
  const sent = browser.seen.find((r) => r.op === 'fillForm');
  assert.deepEqual(sent.input, {
    formulir: 'it-infra-network-edit',
    isian: [{ kolom: 'brandModel', isi: 'Mikrotik RB4011' }, { kolom: 'notes', isi: 'Dipindah ke ruang server' }],
  }, 'only the two descriptive fields reach the browser');
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x.alasan]));
  for (const name of ['ipAddress', 'serialNumber', 'wifiPassword', 'status']) assert.equal(refused[name], 'Kolom ini hanya diisi pengguna.', name);
  assert.deepEqual(res.body.data.diisi, ['brandModel', 'notes'], 'a field the browser claims but the server never asked for is not reported');
  // Audit: names, the record, never a value.
  const row = audit.at(-1);
  assert.equal(row.metadata.formId, 'it-infra-network-edit');
  assert.deepEqual([row.metadata.mode, row.metadata.recordType, String(row.metadata.recordId)], ['edit', 'it_network_device', '12']);
  assert.doesNotMatch(row.raw, /Mikrotik|10\.0\.0\.1|SN-BARU|abc12345|ruang server/);
  browser.close();
});

test('an IT form is refused without its own permission, and an edit form without its record', async (t) => {
  agentDb(t, ['ai_command.use', 'it.infra.view']);
  const browser = fakeBrowser((request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/it/infrastructure', formulir: [NETWORK_EDIT] } }
    : { ok: true, result: { diisi: ['brandModel'] } }));
  const token = tokenFor();
  const read = await call('baca_formulir', {}, token);
  assert.equal(read.body.data.formulir[0].bisa_diisi, false);
  assert.equal(read.body.data.formulir[0].alasan, 'Pengguna tidak punya izin untuk formulir ini.');
  assert.doesNotMatch(JSON.stringify(read.body.data), /Asus|192\.168/);
  await call('isi_form', { formulir: 'it-infra-network-edit', isian: [{ kolom: 'brandModel', isi: 'X' }] }, token);
  assert.equal(browser.seen.some((r) => r.op === 'fillForm'), false, 'the browser is never asked');
  browser.close();
});

test('an edit form that does not name its record cannot be filled', async (t) => {
  agentDb(t, ['ai_command.use', 'it.infra.view', 'it.infra.manage']);
  const { rekaman, ...withoutRecord } = NETWORK_EDIT;
  assert.ok(rekaman);
  const browser = fakeBrowser(() => ({ ok: true, result: { rute: '/it/infrastructure', formulir: [withoutRecord] } }));
  const read = await call('baca_formulir', {}, tokenFor());
  assert.equal(read.body.data.formulir[0].bisa_diisi, false);
  assert.equal(read.body.data.formulir[0].alasan, 'Formulir ubah ini tidak menyebut data yang diubah.');
  browser.close();
});

test('person lookup (pemegang): candidates come back as labels only, and the user-only status is refused', async (t) => {
  agentDb(t, ['ai_command.use', 'device.view', 'device.manage']);
  const STATUS_FORM = {
    id: 'it-device-status', judul: 'Serahkan perangkat', izin: 'device.manage', mode: 'ubah', rekaman: { jenis: 'device', id: 44 }, belum_disimpan: false,
    kolom: [
      { nama: 'status', label: 'Status baru', jenis: 'select', wajib: false, bisa_diisi: false },
      { nama: 'holderMode', label: 'Jenis pemegang', jenis: 'radio', bisa_diisi: true, pilihan: ['Orang di direktori', 'Label tim'], isi: 'Orang di direktori' },
      { nama: 'entryKey', label: 'Pemegang', jenis: 'person', wajib: true, bisa_diisi: true, isi: '' },
      { nama: 'note', label: 'Keperluan', jenis: 'textarea', bisa_diisi: true, isi: '' },
    ],
  };
  const candidates = ['Budi Santoso — Staff Gudang · Warehouse', 'Budi Hartono — Sales · Sales', 'c3', 'c4', 'c5', 'c6 tidak boleh lewat'];
  const browser = fakeBrowser((request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/it/devices/44', formulir: [STATUS_FORM] } }
    : { ok: true, result: { diisi: ['note'], ditolak: [{ nama: 'entryKey', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: candidates, value: 'u15' }] } }));
  const token = tokenFor();
  const read = await call('baca_formulir', {}, token);
  const entry = read.body.data.formulir[0].kolom.find((k) => k.nama === 'entryKey');
  assert.equal(entry.jenis, 'person');
  assert.match(entry.cara_isi, /Tulis nama orangnya/);
  const res = await call('isi_form', { formulir: 'it-device-status', isian: [{ kolom: 'status', isi: 'Dibuang' }, { kolom: 'entryKey', isi: 'Budi' }, { kolom: 'note', isi: 'Laptop kerja' }] }, token);
  const sent = browser.seen.find((r) => r.op === 'fillForm');
  assert.deepEqual(sent.input.isian, [{ kolom: 'entryKey', isi: 'Budi' }, { kolom: 'note', isi: 'Laptop kerja' }], 'the status never reaches the browser');
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x]));
  assert.equal(refused.status.alasan, 'Kolom ini hanya diisi pengguna.');
  assert.deepEqual(refused.entryKey.kandidat, candidates.slice(0, 5), 'at most five labels');
  assert.equal('value' in refused.entryKey, false, 'the option value never leaves the page');
  assert.deepEqual(res.body.data.diisi, ['note']);
  browser.close();
});
