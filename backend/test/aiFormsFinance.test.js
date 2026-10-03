// Wave C2 — the Finance, Warehouse and Management forms Prakasa AI may fill
// (docs/prakasa-ai-rencana.md §9.9; catalog: src/services/ai/agent/forms/
// {finance,warehouse,management}.js). The policy is checked here by name, and a
// round trip shows that a user-only or forbidden cell never reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const pool = require('../src/db/pool');
const bridge = require('../src/services/ai/agent/clientBridge');
const clientTools = require('../src/services/ai/agent/clientTools');
const formCatalog = require('../src/services/ai/agent/formCatalog');
const registry = require('../src/services/aiToolRegistry.service');
const { fieldClass, moneyLike } = require('../src/services/ai/agent/fieldPolicy');
const { signAgentToken } = require('../src/services/ai/agent/agentToken');
const ctrl = require('../src/controllers/aiAgent.controller');
const commandCtrl = require('../src/controllers/aiCommand.controller');

const USER = 15;
const PAGE_TOOLS = ['buka_halaman', 'baca_formulir', 'isi_form'];
const MOVEMENT_AI = ['movementDate', 'referenceNo', 'party', 'notes',
  'items', 'items.sku', 'items.product', 'items.unit', 'items.batchNo', 'items.expiresOn', 'items.location', 'items.note'];
const WAREHOUSE_PERMISSIONS = ['ai_command.use', 'warehouse.movement.view', 'warehouse.movement.create', 'warehouse.movement.update'];

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function agentDb(t, permissions) {
  const audit = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (/INSERT INTO activity_logs/.test(sql)) { audit.push({ metadata: JSON.parse(params[5]), raw: params[5] }); return [{}]; }
    if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ id: USER, entity_id: 1, department_id: 5, email: 'uji@example.invalid', status: 'active' }]];
    if (/FROM permissions p/.test(sql)) return [permissions.map((code) => ({ code }))];
    if (/FROM ai_sessions/.test(sql)) {
      return [[{ id: 9, entity_id: 1, department_id: 5, owner_user_id: USER, visibility: 'private', status: 'active', deleted_at: null, web_research: 0 }]];
    }
    return [[]];
  });
  return audit;
}

let answerNo = 1;
const currentAnswer = () => `finance-answer-${answerNo}`;
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

// id → [permission, mode, record, route, fields.ai, fields.userOnly]
const EXPECTED = {
  'payment-request': ['finance.request', 'create', undefined, '/finance/payment-requests?baru=1',
    ['workflowType', 'title', 'category', 'description', 'payeeName', 'amount', 'taxAmount', 'requestedPaymentDate', 'dueDate', 'notes'],
    ['payeeBank', 'payeeAccountNumber', 'payeeAccountName', 'totalAmount']],
  'warehouse-movement-inbound': ['warehouse.movement.create', 'create', undefined, '/warehouse/movements/inbound/new', MOVEMENT_AI, ['items.quantity']],
  'warehouse-movement-outbound': ['warehouse.movement.create', 'create', undefined, '/warehouse/movements/outbound/new', MOVEMENT_AI, ['items.quantity']],
  'warehouse-movement-inbound-edit': ['warehouse.movement.update', 'edit', 'warehouse_movement', '/warehouse/movements/inbound/<id pergerakan>/edit', MOVEMENT_AI, ['items.quantity']],
  'warehouse-movement-outbound-edit': ['warehouse.movement.update', 'edit', 'warehouse_movement', '/warehouse/movements/outbound/<id pergerakan>/edit', MOVEMENT_AI, ['items.quantity']],
  'warehouse-checklist': ['warehouse.checklist.manage', 'create', undefined, '/warehouse/operations?tab=checklist&baru=1', ['checklistDate', 'title', 'items'], []],
  'warehouse-incident': ['warehouse.incident.manage', 'create', undefined, '/warehouse/operations?tab=incidents&baru=1', ['incidentDate', 'category', 'severity', 'description'], []],
  'management-escalation-followup': [['management_dashboard.view', 'management_dashboard.division'], 'edit', 'escalation_followup', '/escalations?ubah=<sumber>-<id sumber>', ['note'], ['status', 'ownerUserId']],
  'management-target': ['management_dashboard.view', 'edit', 'division_target', '/targets?ubah=<id divisi>-<kunci metrik>', ['note'], ['value']],
};

test('finance, warehouse and management forms: permission, mode, record, route and the exact field policy', () => {
  const mine = formCatalog.FORMS.filter((form) => ['finance', 'warehouse', 'management', 'procurement'].includes(form.module));
  assert.deepEqual(mine.map((form) => form.id).sort(), Object.keys(EXPECTED).sort(), 'every form of these modules is listed here');
  for (const [id, [permission, mode, record, route, ai, userOnly]] of Object.entries(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    assert.ok(form, id);
    assert.deepEqual(form.permission, permission, id);
    assert.equal(form.mode, mode, id);
    assert.equal(form.record, record, id);
    assert.equal(form.route, route, id);
    assert.deepEqual([...form.fields.ai], ai, id);
    assert.deepEqual([...form.fields.userOnly], userOnly, id);
    assert.ok(form.note.length > 20, `${id}: the note says what stays with the user`);
    // The page each form opens on is one Prakasa AI knows.
    assert.ok(registry.resolveTool(clientTools.parseRoute(route.replace(/<[^>]+>/g, '1')).pathname), `${id}: ${route}`);
  }
});

test('never fillable: payee bank and account, decisions, payment processing, counted quantities, target numbers, prices', () => {
  const payment = formCatalog.byId.get('payment-request');
  for (const name of ['payeeBank', 'payeeAccountNumber', 'payeeAccountName', 'totalAmount', 'paidAt', 'paymentReference', 'accurateProofNo', 'accurateNumber', 'status', 'approvalDecision', 'attachment']) {
    assert.ok(!payment.fields.ai.includes(name), `payment-request: ${name}`);
  }
  // Only the user's own request amount is money, and only on this one form.
  assert.deepEqual([...payment.money], ['amount', 'taxAmount']);
  assert.deepEqual(formCatalog.MONEY_FORMS, ['payment-request']);

  for (const id of Object.keys(EXPECTED).filter((key) => key.startsWith('warehouse-movement-'))) {
    const form = formCatalog.byId.get(id);
    for (const name of ['items.quantity', 'items.unitPrice', 'items.price', 'items.amount', 'items.cost', 'status', 'version', 'approvalDecision', 'reviewNote']) {
      assert.ok(!form.fields.ai.includes(name), `${id}: ${name}`);
      assert.ok(!form.fillable.has(name), `${id}: ${name}`);
    }
    assert.ok(form.fields.userOnly.includes('items.quantity'), `${id}: the counted quantity is the user's`);
    assert.deepEqual([...form.money], [], id);
  }
  for (const name of ['status', 'resolution', 'photos']) assert.ok(!formCatalog.byId.get('warehouse-incident').fields.ai.includes(name), name);
  for (const name of ['completed', 'checked']) assert.ok(!formCatalog.byId.get('warehouse-checklist').fields.ai.includes(name), name);

  const followup = formCatalog.byId.get('management-escalation-followup');
  for (const name of ['status', 'ownerUserId']) assert.ok(!followup.fields.ai.includes(name) && followup.fields.userOnly.includes(name), name);
  const target = formCatalog.byId.get('management-target');
  for (const name of ['value', 'targetValue', 'target']) assert.ok(!target.fields.ai.includes(name), name);
  assert.ok(target.fields.userOnly.includes('value'));

  // Nothing these modules let the AI fill is named like a secret, a bank account, a decision, an upload or money.
  for (const id of Object.keys(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    for (const name of form.fields.ai) {
      for (const part of name.split('.')) assert.equal(fieldClass(part), 'open', `${id}: ${name}`);
      if (!form.money.includes(name)) assert.equal(moneyLike(name.split('.').pop()), false, `${id}: ${name}`);
    }
  }
});

test('which route opens which form: the browser is told to wait for it', () => {
  const opened = (route) => formCatalog.FORMS.filter((form) => form.opens(clientTools.parseRoute(route))).map((form) => form.id);
  assert.deepEqual(opened('/warehouse/movements/inbound/new'), ['warehouse-movement-inbound']);
  assert.deepEqual(opened('/warehouse/movements/outbound/new'), ['warehouse-movement-outbound']);
  assert.deepEqual(opened('/warehouse/movements/inbound/41/edit'), ['warehouse-movement-inbound-edit']);
  assert.deepEqual(opened('/warehouse/movements/outbound/41/edit'), ['warehouse-movement-outbound-edit']);
  assert.deepEqual(opened('/warehouse/movements/inbound/41'), [], 'the detail page opens no form');
  assert.deepEqual(opened('/warehouse/operations?tab=checklist&baru=1'), ['warehouse-checklist']);
  assert.deepEqual(opened('/warehouse/operations?tab=incidents&baru=1'), ['warehouse-incident']);
  assert.deepEqual(opened('/warehouse/operations?tab=incidents'), []);
  assert.deepEqual(opened('/escalations?ubah=approval_aged-41'), ['management-escalation-followup']);
  assert.deepEqual(opened('/escalations'), []);
  assert.deepEqual(opened('/targets?period=2026-Q4&ubah=5-warehouse_movements_approved'), ['management-target']);
  assert.deepEqual(opened('/finance/payment-requests?baru=1'), ['payment-request']);
});

test('the forms are offered only to whoever holds their own permission', () => {
  const ids = (permissions) => formCatalog.formsFor({ permissions }).map((form) => form.formulir).filter((id) => id in EXPECTED);
  assert.deepEqual(ids(['warehouse.movement.view', 'warehouse.stock.view']), []);
  assert.deepEqual(ids(['warehouse.movement.create']), ['warehouse-movement-inbound', 'warehouse-movement-outbound']);
  assert.deepEqual(ids(['warehouse.movement.update']), ['warehouse-movement-inbound-edit', 'warehouse-movement-outbound-edit']);
  assert.deepEqual(ids(['warehouse.checklist.manage', 'warehouse.incident.view']), ['warehouse-checklist']);
  assert.deepEqual(ids(['management_dashboard.view']), ['management-escalation-followup', 'management-target']);
  assert.deepEqual(ids(['finance.view', 'finance.approve']), [], 'approving or paying gives no form to fill');
  const edit = formCatalog.formsFor({ permissions: ['warehouse.movement.update'] }).find((form) => form.formulir === 'warehouse-movement-inbound-edit');
  assert.equal(edit.mode, 'ubah');
});

const MOVEMENT_FORM = {
  id: 'warehouse-movement-inbound', judul: 'Buat barang masuk', izin: 'warehouse.movement.create', belum_disimpan: false,
  kolom: [
    { nama: 'movementDate', label: 'Tanggal transaksi', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-02' },
    { nama: 'referenceNo', label: 'Nomor referensi', jenis: 'text', bisa_diisi: true, maks: 80, isi: '' },
    { nama: 'party', label: 'Supplier', jenis: 'text', bisa_diisi: true, maks: 255, isi: '' },
    {
      nama: 'items', label: 'Barang', jenis: 'rows', wajib: true, bisa_diisi: true, maks_baris: 50, boleh_tambah: true,
      kolom_baris: [
        { nama: 'sku', label: 'Kode barang Accurate', jenis: 'text', bisa_diisi: true },
        { nama: 'product', label: 'Produk', jenis: 'text', wajib: true, bisa_diisi: true },
        // What a careless page might claim: the server's policy still says user-only.
        { nama: 'quantity', label: 'Jumlah', jenis: 'number', wajib: true, bisa_diisi: true },
        { nama: 'unit', label: 'Satuan', jenis: 'text', wajib: true, bisa_diisi: true },
        { nama: 'batchNo', label: 'Batch', jenis: 'text', bisa_diisi: true },
        { nama: 'expiresOn', label: 'Kedaluwarsa', jenis: 'date', bisa_diisi: true },
        { nama: 'location', label: 'Lokasi', jenis: 'text', bisa_diisi: true },
        { nama: 'note', label: 'Catatan', jenis: 'text', bisa_diisi: true },
        { nama: 'unitPrice', label: 'Harga', jenis: 'number', bisa_diisi: true },
      ],
      baris: [],
    },
    { nama: 'notes', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, isi: '' },
    { nama: 'approvalDecision', label: 'Keputusan', jenis: 'select', bisa_diisi: true, pilihan: ['Setujui', 'Tolak'], isi: '' },
  ],
};

test('movement rows: the counted quantity, a price and a decision sent by the model never reach the browser', async (t) => {
  const audit = agentDb(t, WAREHOUSE_PERMISSIONS);
  const browser = fakeBrowser({
    route: '/warehouse/movements/inbound/new',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/warehouse/movements/inbound/new', formulir: [MOVEMENT_FORM] } }
      : { ok: true, result: { diisi: ['referenceNo', 'party', 'items'], ditolak: [], masih_perlu: [], baris: { items: 2 } } }),
  });
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  const items = read.kolom.find((field) => field.nama === 'items');
  assert.deepEqual(items.kolom_baris.map((column) => [column.nama, column.bisa_diisi]), [
    ['sku', true], ['product', true], ['quantity', false], ['unit', true], ['batchNo', true], ['expiresOn', true], ['location', true], ['note', true], ['unitPrice', false],
  ]);
  assert.equal(read.kolom.find((field) => field.nama === 'approvalDecision')?.bisa_diisi ?? false, false);

  const res = await call('isi_form', {
    formulir: 'warehouse-movement-inbound',
    isian: [
      { kolom: 'referenceNo', isi: 'SJ-0912' },
      { kolom: 'party', isi: 'PT Sumber Pangan' },
      { kolom: 'approvalDecision', isi: 'Setujui' },
      { kolom: 'items', baris: [
        { sku: 'MKR-002', product: 'Makaroni 1 kg', quantity: '12', unit: 'Ctns', batchNo: 'B-77', expiresOn: '2027-12-31', unitPrice: '150000' },
        { sku: 'KCP-001', product: 'Kecap 600 ml', quantity: '4', unit: 'Pcs', amount: '90000' },
      ] },
    ],
  }, token);
  const sent = browser.seen.find((request) => request.op === 'fillForm').input;
  assert.equal(sent.formulir, 'warehouse-movement-inbound');
  assert.deepEqual(sent.isian, [
    { kolom: 'referenceNo', isi: 'SJ-0912' },
    { kolom: 'party', isi: 'PT Sumber Pangan' },
    { kolom: 'items', cara: 'tambah', baris: [
      { sku: 'MKR-002', product: 'Makaroni 1 kg', unit: 'Ctns', batchNo: 'B-77', expiresOn: '2027-12-31' },
      { sku: 'KCP-001', product: 'Kecap 600 ml', unit: 'Pcs' },
    ] },
  ]);
  assert.doesNotMatch(JSON.stringify(sent), /quantity|unitPrice|amount|approvalDecision|150000|90000/);
  const refused = Object.fromEntries(res.body.data.ditolak.map((item) => [item.kolom, item.alasan]));
  assert.equal(refused['items[1].quantity'], 'Kolom ini hanya diisi pengguna.');
  assert.equal(refused['items[2].quantity'], 'Kolom ini hanya diisi pengguna.');
  assert.ok(refused['items[1].unitPrice']);
  assert.ok(refused['items[2].amount']);
  assert.ok(refused.approvalDecision);
  assert.deepEqual(res.body.data.diisi, ['referenceNo', 'party', 'items']);
  // The audit names fields and counts rows; it never holds a value.
  assert.equal(audit.at(-1).metadata.formId, 'warehouse-movement-inbound');
  assert.doesNotMatch(audit.at(-1).raw, /Makaroni|Kecap|SJ-0912|Sumber Pangan|MKR-002/);
  browser.close();
});

test('editing a draft movement: the record is named in the audit, and without the update permission nothing is filled', async (t) => {
  const audit = agentDb(t, WAREHOUSE_PERMISSIONS);
  const form = { ...MOVEMENT_FORM, id: 'warehouse-movement-inbound-edit', judul: 'Ubah draft barang masuk', izin: 'warehouse.movement.update', mode: 'ubah', rekaman: { jenis: 'warehouse_movement', id: '41' } };
  const browser = fakeBrowser({
    route: '/warehouse/movements/inbound/41/edit',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/warehouse/movements/inbound/41/edit', formulir: [form] } }
      : { ok: true, result: { diisi: ['notes'], ditolak: [] } }),
  });
  const token = tokenFor();
  assert.equal((await call('baca_formulir', {}, token)).body.data.formulir[0].mode, 'ubah');
  const res = await call('isi_form', { formulir: 'warehouse-movement-inbound-edit', isian: [{ kolom: 'notes', isi: 'Dus penyok 2' }] }, token);
  assert.deepEqual(res.body.data.diisi, ['notes']);
  assert.deepEqual([audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['edit', 'warehouse_movement', '41']);
  assert.doesNotMatch(audit.at(-1).raw, /penyok/);
  browser.close();
});

test('a user without the form\'s permission cannot fill it, whatever the page says', async (t) => {
  agentDb(t, ['ai_command.use', 'warehouse.movement.view']);
  const browser = fakeBrowser({
    route: '/warehouse/movements/inbound/new',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/warehouse/movements/inbound/new', formulir: [MOVEMENT_FORM] } }
      : { ok: true, result: { diisi: ['party'], ditolak: [] } }),
  });
  const token = tokenFor();
  await call('baca_formulir', {}, token);
  const res = await call('isi_form', { formulir: 'warehouse-movement-inbound', isian: [{ kolom: 'party', isi: 'PT X' }] }, token);
  assert.equal(res.body.data.berhasil, false);
  assert.equal(browser.seen.filter((request) => request.op === 'fillForm').length, 0);
  browser.close();
});

test('escalation follow-up and target: only the note travels; the status, the owner and the target number do not', async (t) => {
  agentDb(t, ['ai_command.use', 'management_dashboard.view']);
  const followup = {
    id: 'management-escalation-followup', judul: 'Tindak lanjut eskalasi', izin: 'management_dashboard.view', mode: 'ubah', rekaman: { jenis: 'escalation_followup', id: 'approval_aged-41' },
    kolom: [
      { nama: 'note', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, maks: 1000, isi: '' },
      { nama: 'status', label: 'Status tindak lanjut', jenis: 'select', bisa_diisi: true, pilihan: ['Belum ditangani', 'Sedang ditangani', 'Selesai'], isi: 'Belum ditangani' },
      { nama: 'ownerUserId', label: 'Penanggung jawab tindak lanjut', jenis: 'select', bisa_diisi: true, isi: '' },
    ],
  };
  const target = {
    id: 'management-target', judul: 'Ubah target', izin: 'management_dashboard.view', mode: 'ubah', rekaman: { jenis: 'division_target', id: '5-warehouse_movements_approved' },
    kolom: [
      { nama: 'note', label: 'Catatan', jenis: 'textarea', bisa_diisi: true, maks: 500, isi: '' },
      { nama: 'value', label: 'Target', jenis: 'number', bisa_diisi: true, isi: '40' },
    ],
  };
  const browser = fakeBrowser({
    route: '/escalations',
    respond: (request) => (request.op === 'readForms'
      ? { ok: true, result: { rute: '/escalations', formulir: [followup, target] } }
      : { ok: true, result: { diisi: ['note'], ditolak: [] } }),
  });
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir;
  assert.deepEqual(read[0].kolom.map((field) => [field.nama, field.bisa_diisi, field.isi]), [['note', true, ''], ['status', false, undefined], ['ownerUserId', false, undefined]]);
  assert.deepEqual(read[1].kolom.map((field) => [field.nama, field.bisa_diisi, field.isi]), [['note', true, ''], ['value', false, undefined]]);

  await call('isi_form', { formulir: 'management-escalation-followup', isian: [{ kolom: 'note', isi: 'Sudah dibahas dengan Head.' }, { kolom: 'status', isi: 'Selesai' }, { kolom: 'ownerUserId', isi: '15' }] }, token);
  await call('isi_form', { formulir: 'management-target', isian: [{ kolom: 'value', isi: '100' }, { kolom: 'note', isi: 'Disepakati di rapat kuartal.' }] }, token);
  const fills = browser.seen.filter((request) => request.op === 'fillForm').map((request) => request.input.isian);
  assert.deepEqual(fills, [[{ kolom: 'note', isi: 'Sudah dibahas dengan Head.' }], [{ kolom: 'note', isi: 'Disepakati di rapat kuartal.' }]]);
  browser.close();
});
