// Wave C2 — the Sales and Marketing forms Prakasa AI may fill
// (docs/prakasa-ai-rencana.md §9.9): the server's own word on each form (its
// permission, its record, what stays with the user), and that a price, a phone
// number or a bank account sent by the model never reaches the browser.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const pool = require('../src/db/pool');
const bridge = require('../src/services/ai/agent/clientBridge');
const formCatalog = require('../src/services/ai/agent/formCatalog');
const { moneyLike, fieldClass } = require('../src/services/ai/agent/fieldPolicy');
const { signAgentToken } = require('../src/services/ai/agent/agentToken');
const ctrl = require('../src/controllers/aiAgent.controller');
const commandCtrl = require('../src/controllers/aiCommand.controller');

const USER = 15;
const PAGE_TOOLS = ['buka_halaman', 'baca_formulir', 'isi_form'];
const SALES = ['ai_command.use', 'sales.customer.view', 'sales.customer.manage', 'sales.order.view', 'sales.order.manage'];

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function agentDb(t, permissions = SALES) {
  const audit = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (/INSERT INTO activity_logs/.test(sql)) { audit.push({ action: params[2], metadata: JSON.parse(params[5]), raw: params[5] }); return [{}]; }
    if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ id: USER, entity_id: 1, department_id: 5, email: 'uji@example.invalid', status: 'active' }]];
    if (/FROM permissions p/.test(sql)) return [permissions.map((code) => ({ code }))];
    if (/FROM ai_sessions/.test(sql)) return [[{ id: 9, entity_id: 1, department_id: 5, owner_user_id: USER, visibility: 'private', status: 'active', deleted_at: null, web_research: 0 }]];
    return [[]];
  });
  return audit;
}
let answerNo = 1;
const currentAnswer = () => `sales-answer-${answerNo}`;
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
    answerId: currentAnswer(), sessionId: 9, userId: USER, route: '/sales/orders/new',
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

// id → [permission, mode, record, userOnly]
const EXPECTED = {
  'sales-lead': ['sales.customer.manage', 'create', undefined, []],
  'sales-lead-edit': ['sales.customer.manage', 'edit', 'sales_lead', []],
  'sales-lead-link': ['sales.customer.manage', 'edit', 'sales_lead', []],
  'sales-visit': ['sales.customer.manage', 'create', undefined, []],
  'sales-customer': ['sales.customer.manage', 'create', undefined, ['phone', 'businessPhone']],
  'sales-customer-convert': ['sales.customer.manage', 'create', undefined, ['phone', 'businessPhone']],
  'sales-customer-edit': ['sales.customer.manage', 'edit', 'sales_customer', ['phone', 'businessPhone', 'customerCode']],
  'sales-order': ['sales.order.manage', 'create', undefined, ['orderNumber', 'deliveryFee', 'lines.unitPrice', 'lines.taxable']],
  'sales-order-edit': ['sales.order.manage', 'edit', 'sales_order', ['customer', 'orderNumber', 'deliveryFee', 'lines.unitPrice', 'lines.taxable']],
  'sales-order-delivery': ['sales.order.manage', 'edit', 'sales_order', []],
  'sales-order-invoice': ['sales.order.manage', 'edit', 'sales_order', []],
  'sales-product': ['sales.master.manage', 'create', undefined, ['price', 'costPrice']],
  'sales-product-edit': ['sales.master.manage', 'edit', 'sales_product', ['skuCode', 'price', 'costPrice', 'isActive']],
  'sales-document-settings': ['sales.master.manage', 'edit', 'sales_document_settings', ['npwp', 'phone', 'bankAccounts']],
  'sales-exchange': ['sales.order.manage', 'create', undefined, []],
  'sales-exchange-edit': ['sales.order.manage', 'edit', 'sales_invoice_exchange', []],
  'marketing-campaign': ['marketing.campaign.manage', 'create', undefined, ['budget', 'status']],
  'marketing-campaign-edit': ['marketing.campaign.manage', 'edit', 'marketing_campaign', ['budget', 'status']],
};

test('every Sales and Marketing form is in the catalog with its own permission, mode, record and user-only fields', () => {
  const own = formCatalog.FORMS.filter((form) => ['sales', 'marketing'].includes(form.module)).map((form) => form.id).sort();
  assert.deepEqual(own, Object.keys(EXPECTED).sort());
  for (const [id, [permission, mode, record, userOnly]] of Object.entries(EXPECTED)) {
    const form = formCatalog.byId.get(id);
    assert.ok(form, id);
    assert.equal(form.permission, permission, id);
    assert.equal(form.mode, mode, id);
    assert.equal(form.record, record, id);
    assert.deepEqual([...form.fields.userOnly], userOnly, id);
    assert.equal(form.module, id.startsWith('marketing-') ? 'marketing' : 'sales', id);
    assert.deepEqual([...form.money], [], `${id}: no rupiah field is the AI's`);
  }
});

test('nothing sensitive is AI-fillable: prices, PPN, ongkos kirim, budget, phone numbers, bank account, NPWP, status', () => {
  const ai = (id) => formCatalog.byId.get(id).fields.ai;
  for (const id of ['sales-order', 'sales-order-edit']) {
    for (const name of ['orderNumber', 'deliveryFee', 'lines.unitPrice', 'lines.taxable', 'lines.skuCode', 'lines.productName', 'unitPrice', 'discount']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
    assert.ok(ai(id).includes('lines') && ai(id).includes('lines.product') && ai(id).includes('lines.qty'), id);
  }
  assert.ok(ai('sales-order').includes('customer'));
  assert.ok(!ai('sales-order-edit').includes('customer'), 'the customer of an existing order cannot be changed');
  for (const id of ['sales-customer', 'sales-customer-convert', 'sales-customer-edit']) {
    for (const name of ['phone', 'businessPhone', 'customerCode']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  }
  assert.ok(!ai('sales-customer-edit').includes('cityCode'), 'the ID pelanggan of an existing customer is fixed');
  for (const id of ['sales-product', 'sales-product-edit']) for (const name of ['price', 'costPrice', 'isActive']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  assert.ok(!ai('sales-product-edit').includes('skuCode'));
  for (const name of ['bankAccounts', 'npwp', 'phone']) assert.ok(!ai('sales-document-settings').includes(name), name);
  assert.equal(fieldClass('bankAccounts'), 'userOnly');
  for (const id of ['marketing-campaign', 'marketing-campaign-edit']) for (const name of ['budget', 'status']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  for (const id of ['sales-order-delivery', 'sales-order-invoice']) for (const name of ['amount', 'totalAmount', 'paidAt']) assert.ok(!ai(id).includes(name), `${id}: ${name}`);
  // Not one money-looking or forbidden name in any of them, columns included.
  for (const id of Object.keys(EXPECTED)) {
    for (const name of ai(id)) {
      for (const part of name.split('.')) {
        assert.equal(moneyLike(part), false, `${id}: ${name}`);
        assert.equal(fieldClass(part), 'open', `${id}: ${name}`);
      }
    }
  }
  // Decisions and money dialogs are not forms the AI knows at all.
  for (const id of ['sales-payment', 'sales-target', 'marketing-campaign-close', 'sales-people']) assert.equal(formCatalog.byId.has(id), false, id);
});

test('each form opens by its own route, and only for a user who holds its permission', () => {
  const opens = (id, pathname, search = '') => formCatalog.byId.get(id).opens({ pathname, search });
  assert.ok(opens('sales-customer', '/sales/customers', 'baru=1'));
  assert.ok(opens('sales-customer-edit', '/sales/customers/41', 'ubah=1'));
  assert.ok(!opens('sales-customer-edit', '/sales/customers', 'ubah=1'));
  assert.ok(opens('sales-customer-convert', '/sales/leads', 'lead=7&form=pelanggan'));
  assert.ok(opens('sales-lead-edit', '/sales/leads', 'lead=7&form=ubah'));
  assert.ok(!opens('sales-lead-edit', '/sales/leads', 'lead=7&form=pelanggan'));
  assert.ok(opens('sales-lead-link', '/sales/leads', 'lead=7'));
  assert.ok(opens('sales-order', '/sales/orders/new'));
  assert.ok(opens('sales-order-edit', '/sales/orders/12/edit'));
  assert.ok(!opens('sales-order-edit', '/sales/orders/12'));
  assert.ok(opens('sales-order-delivery', '/sales/orders/12', 'aksi=surat-jalan'));
  assert.ok(opens('sales-order-invoice', '/sales/orders/12', 'aksi=invoice'));
  assert.ok(!opens('sales-order-invoice', '/sales/orders/12', 'aksi=bayar'), 'the payment dialog is never opened for the AI');
  assert.ok(opens('sales-product', '/sales/orders', 'tab=products&baru=1'));
  assert.ok(opens('sales-product-edit', '/sales/orders', 'tab=products&q=FOD-1&ubah=3'));
  assert.ok(opens('sales-document-settings', '/sales/orders', 'form=pengaturan-dokumen'));
  assert.ok(opens('sales-exchange', '/sales/orders', 'tab=exchange&baru=SI.2026.09.00012'));
  assert.ok(!opens('sales-exchange', '/sales/orders', 'tab=products&baru=1'));
  assert.ok(opens('sales-exchange-edit', '/sales/orders', 'tab=exchange&ubah=SI.2026.09.00012'));
  assert.ok(opens('marketing-campaign', '/marketing/campaigns', 'baru=1'));
  assert.ok(opens('marketing-campaign-edit', '/marketing/campaigns', 'ubah=5'));

  const listed = (permissions) => formCatalog.formsFor({ permissions }).map((form) => form.formulir).filter((id) => id in EXPECTED).sort();
  assert.deepEqual(listed(['sales.customer.view', 'sales.order.view', 'marketing.insight.view']), [], 'viewing is not enough');
  assert.deepEqual(listed(['sales.customer.manage']), ['sales-customer', 'sales-customer-convert', 'sales-customer-edit', 'sales-lead', 'sales-lead-edit', 'sales-lead-link', 'sales-visit']);
  assert.deepEqual(listed(['sales.master.manage']), ['sales-document-settings', 'sales-product', 'sales-product-edit']);
  assert.deepEqual(listed(['marketing.campaign.manage']), ['marketing-campaign', 'marketing-campaign-edit']);
});

// The sales order as the page describes it (SalesOrderForm.jsx): a customer
// lookup, lines with a product lookup, and the columns the page marks as the user's.
const SO_FORM = {
  id: 'sales-order', judul: 'Sales order', izin: 'sales.order.manage', belum_disimpan: true,
  kolom: [
    { nama: 'customer', label: 'Pelanggan', jenis: 'lookup', wajib: true, bisa_diisi: true, isi: '' },
    { nama: 'orderNumber', label: 'No. SO', jenis: 'text', bisa_diisi: false },
    { nama: 'orderDate', label: 'Tanggal order', jenis: 'date', wajib: true, bisa_diisi: true, isi: '2026-10-02' },
    { nama: 'channel', label: 'Channel', jenis: 'select', bisa_diisi: true, pilihan: ['GT', 'MT'], isi: '' },
    {
      nama: 'lines', label: 'Barang', jenis: 'rows', wajib: true, bisa_diisi: true, maks_baris: 30, boleh_tambah: true,
      kolom_baris: [
        { nama: 'product', label: 'Produk', jenis: 'lookup', wajib: true, bisa_diisi: true },
        { nama: 'qty', label: 'Qty', jenis: 'number', wajib: true, bisa_diisi: true, min: 0.01 },
        { nama: 'unitPrice', label: 'Harga', jenis: 'number', bisa_diisi: false },
        { nama: 'taxable', label: 'PPN', jenis: 'checkbox', bisa_diisi: false },
      ],
      baris: [{ no: 1, isi: { product: 'Abon Sapi 250 g', qty: '4' }, diisi_pengguna: true }],
    },
    { nama: 'deliveryFee', label: 'Ongkos kirim', jenis: 'number', bisa_diisi: false },
    // What a careless page might add:
    { nama: 'discount', label: 'Diskon', jenis: 'number', bisa_diisi: true, isi: '' },
    { nama: 'notes', label: 'Catatan order', jenis: 'textarea', bisa_diisi: true, isi: '' },
  ],
};

test('sales order round trip: lookups travel as text, a price / PPN / ongkos kirim / No. SO sent by the model never reaches the browser', async (t) => {
  const audit = agentDb(t);
  const browser = fakeBrowser((request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/sales/orders/new', formulir: [SO_FORM] } }
    : {
      ok: true,
      result: {
        diisi: ['lines', 'notes'], baris: { lines: 1 },
        ditolak: [
          { nama: 'customer', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Toko Maju — C-PR-GT-JKT-0001', 'Toko Maju Jaya — C-PR-GT-BKS-0007', 'c', 'd', 'e', 'f'] },
          { nama: 'lines[2].product', alasan: 'Tidak ditemukan. Tanyakan nama yang benar ke pengguna.' },
        ],
      },
    }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  const byName = Object.fromEntries(read.kolom.map((k) => [k.nama, k]));
  assert.equal(byName.customer.bisa_diisi, true);
  assert.match(byName.customer.cara_isi, /Bila hasilnya tidak tepat satu, kolom tidak diisi dan kandidatnya dikembalikan/);
  for (const name of ['orderNumber', 'deliveryFee', 'discount']) assert.equal(byName[name].bisa_diisi, false, name);
  assert.deepEqual(byName.lines.kolom_baris.map((k) => [k.nama, k.bisa_diisi]), [['product', true], ['qty', true], ['unitPrice', false], ['taxable', false]]);

  const res = await call('isi_form', {
    formulir: 'sales-order',
    isian: [
      { kolom: 'customer', isi: 'Toko Maju' },
      { kolom: 'orderNumber', isi: 'SO-9999' },
      { kolom: 'deliveryFee', isi: '25000' },
      { kolom: 'discount', isi: '10' },
      { kolom: 'notes', isi: 'Kirim pagi' },
      {
        kolom: 'lines',
        cara: 'hapus',
        baris: [
          { product: 'Abon Ayam 100 g', qty: '10', unitPrice: '32000', taxable: 'ya', skuCode: 'FOD-X', productName: 'Barang karangan', discount: '5' },
          { product: 'Keripik entah', qty: '2' },
        ],
      },
    ],
  }, token);
  const sent = browser.seen.find((request) => request.op === 'fillForm').input;
  assert.deepEqual(sent, {
    formulir: 'sales-order',
    isian: [
      { kolom: 'customer', isi: 'Toko Maju' },
      { kolom: 'notes', isi: 'Kirim pagi' },
      { kolom: 'lines', cara: 'tambah', baris: [{ product: 'Abon Ayam 100 g', qty: '10' }, { product: 'Keripik entah', qty: '2' }] },
    ],
  }, 'only the customer text, the note and product + qty reach the browser; no id, no price, no way to delete');
  assert.doesNotMatch(JSON.stringify(sent), /32000|25000|SO-9999|Barang karangan|FOD-X/);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x]));
  for (const name of ['orderNumber', 'deliveryFee', 'discount', 'lines[1].unitPrice', 'lines[1].taxable']) {
    assert.equal(refused[name].alasan, 'Kolom ini hanya diisi pengguna.', name);
  }
  // Columns the form does not have: the product comes from the lookup only.
  for (const name of ['lines[1].skuCode', 'lines[1].productName', 'lines[1].discount']) assert.equal(refused[name].alasan, 'Kolom ini tidak ada di formulir.', name);
  assert.deepEqual(refused.customer.kandidat, ['Toko Maju — C-PR-GT-JKT-0001', 'Toko Maju Jaya — C-PR-GT-BKS-0007', 'c', 'd', 'e'], 'at most 5 candidates, to ask the user');
  assert.equal('kandidat' in refused['lines[2].product'], false);
  assert.deepEqual(res.body.data.diisi, ['lines', 'notes']);
  assert.deepEqual(res.body.data.baris_ditambahkan, { lines: 1 });
  // Audit: names and a row count — never a customer, a product or a number.
  const row = audit.at(-1);
  assert.equal(row.metadata.formId, 'sales-order');
  assert.deepEqual(row.metadata.rows, { lines: 1 });
  assert.doesNotMatch(row.raw, /Toko Maju|Abon|Keripik|Kirim pagi|32000/);
  browser.close();
});

test('the customer form: phone numbers sent by the model are refused before the browser is asked; an edit names its record', async (t) => {
  const audit = agentDb(t);
  const form = {
    id: 'sales-customer-edit', judul: 'Ubah pelanggan', izin: 'sales.customer.manage', mode: 'ubah', rekaman: { jenis: 'sales_customer', id: '41' },
    kolom: [
      { nama: 'name', label: 'Nama pelanggan', jenis: 'text', wajib: true, bisa_diisi: true, isi: 'Toko Maju' },
      { nama: 'customerCode', label: 'ID pelanggan', jenis: 'text', hanya_baca: true, bisa_diisi: false, isi: 'C-PR-GT-JKT-0001' },
      { nama: 'phone', label: 'Handphone', jenis: 'text', bisa_diisi: true, isi: '0812-0000-0000' },
      { nama: 'businessPhone', label: 'Telp. bisnis', jenis: 'text', bisa_diisi: false },
      { nama: 'city', label: 'Kota', jenis: 'text', bisa_diisi: true, isi: '' },
    ],
  };
  const browser = fakeBrowser((request) => (request.op === 'readForms' ? { ok: true, result: { rute: '/sales/customers/41', formulir: [form] } } : { ok: true, result: { diisi: ['city'], ditolak: [] } }));
  const token = tokenFor();
  const read = (await call('baca_formulir', {}, token)).body.data.formulir[0];
  assert.equal(read.mode, 'ubah');
  const phone = read.kolom.find((k) => k.nama === 'phone');
  assert.equal(phone.bisa_diisi, false, 'the catalog decides, whatever the page says');
  assert.equal(phone.isi, undefined, 'a phone number is not read to the model');
  const res = await call('isi_form', {
    formulir: 'sales-customer-edit',
    isian: [{ kolom: 'city', isi: 'Bekasi' }, { kolom: 'phone', isi: '0811' }, { kolom: 'businessPhone', isi: '021' }, { kolom: 'customerCode', isi: 'X' }, { kolom: 'cityCode', isi: 'BKS' }],
  }, token);
  assert.deepEqual(browser.seen.find((request) => request.op === 'fillForm').input.isian, [{ kolom: 'city', isi: 'Bekasi' }]);
  assert.deepEqual(res.body.data.diisi, ['city']);
  assert.deepEqual([audit.at(-1).metadata.mode, audit.at(-1).metadata.recordType, audit.at(-1).metadata.recordId], ['edit', 'sales_customer', '41']);
  assert.doesNotMatch(audit.at(-1).raw, /Bekasi|0811|0812/);
  browser.close();
});

test('a campaign: target products travel as text for the page\'s Accurate search; anggaran and status never reach the browser', async (t) => {
  agentDb(t, ['ai_command.use', 'marketing.insight.view', 'marketing.campaign.manage']);
  const form = {
    id: 'marketing-campaign', judul: 'Kampanye', izin: 'marketing.campaign.manage', belum_disimpan: false,
    kolom: [
      { nama: 'name', label: 'Nama kampanye', jenis: 'text', wajib: true, bisa_diisi: true, isi: '' },
      { nama: 'budget', label: 'Anggaran (Rp)', jenis: 'number', bisa_diisi: true, isi: '' },
      { nama: 'status', label: 'Status', jenis: 'select', bisa_diisi: true, pilihan: ['Draf', 'Berjalan'], isi: 'Draf' },
      { nama: 'channels', label: 'Channel', jenis: 'multiselect', bisa_diisi: true, pilihan: ['General Trade', 'Modern Trade'], isi: '' },
      {
        nama: 'items', label: 'Produk target', jenis: 'rows', bisa_diisi: true, maks_baris: 50, boleh_tambah: true,
        kolom_baris: [{ nama: 'itemNo', label: 'Produk Accurate', jenis: 'lookup', wajib: true, bisa_diisi: true }, { nama: 'itemName', label: 'Nama', jenis: 'text', bisa_diisi: true }],
        baris: [],
      },
    ],
  };
  const browser = fakeBrowser((request) => (request.op === 'readForms'
    ? { ok: true, result: { rute: '/marketing/campaigns', formulir: [form] } }
    : { ok: true, result: { diisi: ['name', 'channels'], ditolak: [{ nama: 'items[1].itemNo', alasan: 'Ada beberapa yang cocok. Tanyakan ke pengguna yang dimaksud.', kandidat: ['Abon Sapi 100 g — FOD-ABN-100', 'Abon Sapi 250 g — FOD-ABN-250'] }] } }));
  const token = tokenFor();
  await call('baca_formulir', {}, token);
  const res = await call('isi_form', {
    formulir: 'marketing-campaign',
    isian: [
      { kolom: 'name', isi: 'Promo Oktober' }, { kolom: 'budget', isi: '5000000' }, { kolom: 'status', isi: 'Berjalan' }, { kolom: 'channels', isi: 'General Trade; Modern Trade' },
      { kolom: 'items', baris: [{ itemNo: 'Abon Sapi', itemName: 'Abon karangan' }] },
    ],
  }, token);
  assert.deepEqual(browser.seen.find((request) => request.op === 'fillForm').input.isian, [
    { kolom: 'name', isi: 'Promo Oktober' }, { kolom: 'channels', isi: 'General Trade; Modern Trade' }, { kolom: 'items', cara: 'tambah', baris: [{ itemNo: 'Abon Sapi' }] },
  ]);
  const refused = Object.fromEntries(res.body.data.ditolak.map((x) => [x.kolom, x]));
  assert.equal(refused.budget.alasan, 'Kolom ini hanya diisi pengguna.');
  assert.equal(refused.status.alasan, 'Kolom ini hanya diisi pengguna.');
  assert.ok(refused['items[1].itemName'], 'a product name is never typed in by the AI');
  assert.deepEqual(refused['items[1].itemNo'].kandidat, ['Abon Sapi 100 g — FOD-ABN-100', 'Abon Sapi 250 g — FOD-ABN-250']);
  browser.close();
});

test('without the form\'s own permission isi_form is refused, whatever the page says', async (t) => {
  agentDb(t, ['ai_command.use', 'sales.customer.view', 'sales.order.view']);
  const browser = fakeBrowser((request) => (request.op === 'readForms' ? { ok: true, result: { rute: '/sales/orders/new', formulir: [SO_FORM] } } : { ok: true, result: { diisi: ['notes'], ditolak: [] } }));
  const token = tokenFor();
  await call('baca_formulir', {}, token);
  const res = await call('isi_form', { formulir: 'sales-order', isian: [{ kolom: 'notes', isi: 'x' }] }, token);
  assert.equal(res.body.data.berhasil, false);
  assert.equal(browser.seen.filter((request) => request.op === 'fillForm').length, 0);
  browser.close();
});
