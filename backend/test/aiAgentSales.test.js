// Prakasa AI reads the Sales module (Wave B): the tools run against the real
// Sales handlers and services with a mocked pool (no database, no writes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = '../src';
const pool = require(`${B}/db/pool`);
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
const salesTools = require(`${B}/services/ai/agent/tools/sales`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const { forbiddenKeys, MONEY_KEY, PERSONAL_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const registry = require(`${B}/services/aiToolRegistry.service`);
const notifications = require(`${B}/services/notification.service`);

const NAMES = ['sales_perlu_tindakan', 'pipeline_sales', 'customer_lead_sales', 'status_sales_order', 'omzet_sales', 'piutang_sales', 'batch_data_accurate'];
const MONEY_TOOLS = ['omzet_sales', 'piutang_sales'];
const sealed = (name) => agentTools.byName.get(name);

const MONEY = 987654321;
const COST = 123456789;
const DAY = (v) => new Date(`${v}T00:00:00Z`);
// One row carrying every column the Sales handlers read, plus bait: contact
// data, coordinates, tax and bank data, purchase cost.
const ROW = {
  n: 3, total: 3, id: 5, user_id: 5, entity_id: 7, department_id: 2, departmentId: 2,
  // to-do list
  title: 'DOC.1', reference: 'Toko Uji', context: 'GT', salesPersonName: 'Sales Uji', since: DAY('2026-08-20'), days: 43, amount: MONEY, note: '40% terkirim',
  customerId: 5, source: 'accurate',
  // funnel, customers, leads
  stage: 'dormant', name: 'Toko Uji', code: 'PFN-PR-GT-JKT-0001', channel: 'GT', city: 'Jakarta', segment: 'Retail', status: 'dormant', ownerName: 'PIC Uji',
  nooDate: DAY('2026-01-10'), lastOrderDate: DAY('2026-08-20'), daysSinceOrder: 43, lastVisitDate: DAY('2026-09-01'), daysSinceVisit: 31,
  customer_code: 'PFN-PR-GT-JKT-0001', sales_person_name: 'Sales Uji', noo_date: DAY('2026-01-10'), last_order_date: DAY('2026-08-20'),
  outletCode: 'PFN-CS-260900001', area: 'Jakarta Barat', firstVisitDate: DAY('2026-08-01'), visitCount: 2, lastNote: 'belum mau order',
  customerName: 'Toko Uji', customerCode: 'PFN-PR-GT-JKT-0001',
  open: 4, needs_visit: 2, converted: 1, dropped: 0, all: 5, needsVisit: 2, aktif: 1, dormant: 1, lost: 1, neverOrdered: 0,
  visitDate: DAY('2026-09-01'), summary: { counts: { sales_invoice: { create: 2, update: 1, missing: 0 } }, revenue: MONEY, checks: { complete: false } },
  durationMinutes: 12, isPlanned: 1, geoMismatch: 0, checkInTime: '09:00',
  // orders, documents, receivables
  orderNumber: 'SO.1', transactionDate: DAY('2026-09-20'), doNumbers: 'Terkirim 40%', invoiceNumbers: 'SI.1', totalAmount: MONEY, outstandingAmount: MONEY,
  invoiceCount: 1, orderDpp: MONEY, invoicedDpp: MONEY,
  dueDate: DAY('2026-09-25'), number: 'SI.1', date: DAY('2026-09-20'), orderNumbers: 'SO.1', dppAmount: MONEY, revenue: MONEY, outstanding: MONEY, orders: 4,
  term_days: 7, bucket: 'd1_30', invoices: 2, month: '2026-09', units: [{ unit: 'Ctns', qty: 3 }], base_qty: null, base_unit: null,
  net: MONEY, returns: 0, owed: MONEY, overdue: MONEY, last_invoice: DAY('2026-09-20'), last_receipt: DAY('2026-09-10'),
  monthOrders: 2, monthRevenue: MONEY, yearOrders: 9, yearRevenue: MONEY, customers: 3,
  revenue_target: MONEY, noo_target: 2, by_name: 1, by_customer: 0, departmentName: 'Sales',
  // Accurate batches
  item_count: 12, approval_request_id: 9, approval_status: 'pending', department_name: 'Sales', requested_by_name: 'Pengaju Uji',
  decided_by_name: null, decided_at: null, decision_note: null, applied_at: null, created_at: new Date(Date.now() - 30 * 3600 * 1000),
  // bait
  phone: '0812SENTINEL', business_phone: '021SENTINEL', businessPhone: '021SENTINEL', email: 'sentinel@x.invalid', address: 'Jl. SENTINEL 1',
  contact_person: 'Kontak SENTINEL', contactPerson: 'Kontak SENTINEL', latitude: -6.1234567, longitude: 106.7654321, notes: 'catatan SENTINEL',
  npwp: 'NPWP-SENTINEL', bank: 'BANK-SENTINEL', bank_accounts: 'REK-SENTINEL', cost_price: COST, costPrice: COST, unit_price: COST, tax_amount: COST,
  totalSales: COST, total_sales: COST,
};

// `accurate`: whether a Sales batch was approved (the Tahap B switch).
// `rowsFor(sql)`: return a list to override what one query answers.
function mockDb(t, { accurate = true, rowsFor = () => null } = {}) {
  const calls = [];
  t.mock.method(notifications, 'create', async () => { throw new Error('a read tool must never notify'); });
  t.mock.method(pool, 'getConnection', async () => { throw new Error('a read tool must never open a transaction'); });
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    calls.push({ sql: text, args });
    if (/COUNT\(\*\) AS n FROM sales_accurate_batches b\s+JOIN departments/.test(text)) return [[{ n: accurate ? 1 : 0 }]];
    const custom = rowsFor(text, args);
    if (custom) return [custom];
    return [[{ ...ROW }]];
  });
  return calls;
}

const ALL = [...new Set(STANDARD_ROLES.flatMap((r) => r.permissions))];
const permsOf = (key) => STANDARD_ROLES.find((r) => r.key === key).permissions;
const head = { sub: 5, entityId: 7, departmentId: 2, permissions: ALL };
const member = { sub: 4242, entityId: 7, departmentId: 2, permissions: permsOf('sales.member') };
const marketing = { sub: 4343, entityId: 7, departmentId: 3, permissions: permsOf('marketing.member') };

const INPUTS = {
  sales_perlu_tindakan: [{}, { jenis: 'belum_terkirim', cari: 'toko', jumlah: 5 }, { jenis: 'tagihan_terlambat' }, { jenis: 'lead' }],
  pipeline_sales: [{}, { tahap: 'lost', cari: 'toko' }, { tahap: 'prospek', jumlah: 3 }],
  customer_lead_sales: [{}, { cari: 'toko', status_customer: 'dormant', channel: 'GT' }, { jenis: 'lead', status_lead: 'perlu_dikunjungi' }, { id_customer: 5 }, { id_lead: 5 }],
  status_sales_order: [{}, { nomor: 'SO.1' }, { status: 'belum_terkirim', dari: '2026-09-01', sampai: '2026-09-30', channel: 'GT', id_customer: 5 }],
  omzet_sales: [{}, { bulan: '2026-09' }],
  piutang_sales: [{}, { id_customer: 5 }, { cari: 'toko', semua_belum_lunas: true }],
  batch_data_accurate: [{}, { status: 'disetujui', jumlah: 3 }],
};

test('the Sales tools keep the contract: Indonesian nouns, private, rupiah only in the two money tools', () => {
  const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
  assert.deepEqual(contract.validateTools(salesTools, { moduleKeys }), []);
  assert.deepEqual(salesTools.map((tool) => tool.name), NAMES);
  for (const tool of salesTools) {
    assert.equal(tool.privateOnly, true, `${tool.name} holds division data`);
    assert.equal(Boolean(tool.money), MONEY_TOOLS.includes(tool.name), tool.name);
    assert.equal(sealed(tool.name).file, 'sales.js');
    assert.ok(INPUTS[tool.name], `${tool.name} has test inputs`);
    assert.doesNotMatch(sealed(tool.name).impl.toString(), /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b/i, `${tool.name} must not write`);
  }
  for (const name of MONEY_TOOLS) assert.equal(sealed(name).permission, 'sales.order.view', 'the page rule: money only for those who may see orders');
  const served = new Set(salesTools.flatMap((tool) => tool.module));
  for (const key of ['sales-pipeline', 'sales-customers', 'sales-leads', 'sales-orders', 'accurate-batches']) assert.ok(served.has(key), key);
});

test('every Sales tool only reads, binds the company, and never returns contact, tax, bank or cost data', async (t) => {
  for (const accurate of [true, false]) {
    const calls = mockDb(t, { accurate });
    for (const name of NAMES) {
      const tool = sealed(name);
      for (const input of INPUTS[name]) {
        calls.length = 0;
        const out = await tool.run(head, input);
        const json = JSON.stringify(out);
        const where = `${name} ${JSON.stringify(input)} accurate=${accurate}`;
        assert.ok(!/SENTINEL|sentinel@|106\.7654321|-6\.1234567/.test(json), `${where} leaked contact data or coordinates`);
        assert.ok(!json.includes(String(COST)), `${where} leaked a cost, unit price or tax amount`);
        assert.deepEqual(keysLike(PERSONAL_KEY, out), [], where);
        if (!tool.money) {
          assert.ok(!json.includes(String(MONEY)), `${where} leaked rupiah from a tool that is not a money tool`);
          assert.deepEqual(keysLike(MONEY_KEY, out), [], where);
          assert.deepEqual(forbiddenKeys(out), [], where);
        }
        assert.ok(calls.length > 0, where);
        for (const { sql, args } of calls) {
          assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `${where} ran a non-SELECT`);
          assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|REPLACE)\s/, where);
          if (sql.includes('?')) assert.ok(args.includes(7) || /WHERE u\.id = \? LIMIT 1/.test(sql) || /WHERE p\.order_id|WHERE l\.order_id/.test(sql), `${where} unbound company: ${sql.slice(0, 90)}`);
        }
      }
    }
    pool.query.mock.restore();
    pool.getConnection.mock.restore();
    notifications.create.mock.restore();
  }
});

function keysLike(pattern, value, found = []) {
  if (Array.isArray(value)) value.forEach((item) => keysLike(pattern, item, found));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (pattern.test(key)) found.push(key);
      keysLike(pattern, child, found);
    }
  }
  return found;
}

test('a user without the permission gets a refusal, not data — and no query runs', async (t) => {
  const calls = mockDb(t);
  for (const name of NAMES) {
    for (const user of [{ sub: 1, entityId: 7, permissions: [] }, { sub: 1, entityId: 7, permissions: permsOf('warehouse.member') }, { sub: 1, entityId: 7, permissions: permsOf('finance.member') }]) {
      await assert.rejects(sealed(name).run(user, {}), (e) => e.status === 403 && e.code === 'FORBIDDEN', name);
      // The tool's own function refuses too (run() alone is safe).
      await assert.rejects(sealed(name).impl(user, {}), (e) => e.status === 403, name);
    }
  }
  assert.equal(calls.length, 0);
});

test('role matrix: who gets which Sales tool', () => {
  const customerTools = ['sales_perlu_tindakan', 'pipeline_sales', 'customer_lead_sales'];
  const orderTools = ['status_sales_order', 'omzet_sales', 'piutang_sales'];
  const expected = {
    'sales.member': [...customerTools, ...orderTools],
    'sales.supervisor': NAMES,
    'sales.head': NAMES,
    'retail_commerce.member': [...customerTools, ...orderTools],
    'retail_commerce.supervisor': NAMES,
    'retail_commerce.head': NAMES,
    // Marketing sees customers and leads but has no sales.order.view: no order status, no rupiah.
    'marketing.member': customerTools,
    'marketing.supervisor': customerTools,
    'marketing.head': customerTools,
  };
  const batchOnly = ['finance.supervisor', 'finance.head', 'procurement.supervisor', 'procurement.head', 'warehouse.supervisor', 'warehouse.head', 'management_office.head'];
  for (const role of STANDARD_ROLES) {
    const names = agentTools.toolsFor({ permissions: role.permissions }, { visibility: 'private' }).map((tool) => tool.name).filter((n) => NAMES.includes(n));
    const want = expected[role.key] || (batchOnly.includes(role.key) ? ['batch_data_accurate'] : []);
    assert.deepEqual(names, want, role.key);
  }
});

test('no Sales tool in a shared conversation or next to web research', () => {
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }, null]) {
    const names = agentTools.toolsFor(head, session).map((tool) => tool.name);
    assert.deepEqual(names.filter((n) => NAMES.includes(n)), [], JSON.stringify(session));
  }
  const own = agentTools.toolsFor(head, { visibility: 'private' }).map((tool) => tool.name);
  for (const name of NAMES) {
    assert.ok(own.includes(name), name);
    assert.ok(agentTools.PRIVATE_ONLY_TOOLS.includes(name), `${name} locks the chat against sharing`);
  }
});

test('a Sales Member reads only their own records; a supervisor everything', async (t) => {
  const calls = mockDb(t);
  // Queries that carry no record list of their own: the source switch, the
  // member's mapped names, channel names, and the member's own target row.
  // The target figures are computed for the accounts the user may see (asserted
  // below: a member's account list is their own account only).
  const helper = /sales_accurate_batches b|FROM sales_person_accounts WHERE entity_id = \? AND user_id = \?|SELECT DISTINCT channel|FROM sales_person_targets|u\.id IN \(\?\)|k\.user_id IN \(\?\)/;
  const listTools = {
    sales_perlu_tindakan: INPUTS.sales_perlu_tindakan,
    pipeline_sales: INPUTS.pipeline_sales,
    customer_lead_sales: [{}, { cari: 'toko' }, { jenis: 'lead' }],
    status_sales_order: [{}, { status: 'belum_terkirim' }, { nomor: 'SO.1' }],
    omzet_sales: [{}],
    piutang_sales: [{}, { cari: 'toko' }],
  };
  for (const [name, inputs] of Object.entries(listTools)) {
    for (const input of inputs) {
      calls.length = 0;
      const out = await sealed(name).run(member, input);
      assert.match(out.cakupan, /hanya data milik Anda/, name);
      const scoped = calls.filter((c) => !helper.test(c.sql));
      assert.ok(scoped.length > 0, name);
      for (const { sql, args } of scoped) {
        assert.ok(args.includes(4242), `${name} ${JSON.stringify(input)}: a member query without the member's id: ${sql.slice(0, 120)}`);
        assert.match(sql, /sales_owner_links|u\.id = \?|u\.id IN \(\?\)/, `${name}: ${sql.slice(0, 120)}`);
      }
      // The same question from a supervisor carries no owner filter.
      calls.length = 0;
      const all = await sealed(name).run(head, input);
      assert.equal(all.cakupan, 'semua data Sales');
      assert.ok(calls.some((c) => !helper.test(c.sql) && !/sales_owner_links k WHERE k\.record_type = '(customer|order|lead)' AND k\.record_id = \S+ AND k\.user_id = \?\)/.test(c.sql)));
    }
  }
  // Omzet per salesperson is for those who see everyone; a member gets their own target row only.
  calls.length = 0;
  const own = await sealed('omzet_sales').run(member, {});
  assert.equal('per_sales' in own, false);
  assert.equal('persen_tercapai' in own.target, false);
  const accounts = calls.find((c) => /FROM users u JOIN departments d/.test(c.sql));
  assert.match(accounts.sql, /AND u\.id = \?/);
  assert.deepEqual(accounts.args, [7, 4242]);
  assert.ok(Array.isArray((await sealed('omzet_sales').run(head, {})).per_sales));
});

test('a record that is not the member\'s own is "not found", and nothing else about it is read', async (t) => {
  // The ownership query answers nothing: the customer or lead is someone else's.
  const calls = mockDb(t, { rowsFor: (sql) => (/sales_owner_links/.test(sql) && /WHERE (c|l)\.id = \?/.test(sql) ? [] : null) });
  const customer = await sealed('customer_lead_sales').run(member, { id_customer: 99 });
  assert.equal(customer.ditemukan, false);
  assert.equal('customer' in customer, false);
  const lead = await sealed('customer_lead_sales').run(member, { id_lead: 99 });
  assert.equal(lead.ditemukan, false);
  calls.length = 0;
  const owed = await sealed('piutang_sales').run(member, { id_customer: 99 });
  assert.equal(owed.ditemukan, false);
  assert.equal('faktur' in owed, false);
  assert.equal('umur_piutang' in owed, false);
  assert.equal(calls.some((c) => /sales_visit_reports|sales_receipts_accurate|sales_revenue_accurate|sales_invoices_accurate i\s+WHERE/.test(c.sql)), false);
  assert.ok(!JSON.stringify([customer, lead, owed]).includes('Toko Uji'));
});

test('Marketing has no sales.order.view: customers and leads without orders, invoices or rupiah', async (t) => {
  const calls = mockDb(t);
  const todo = await sealed('sales_perlu_tindakan').run(marketing, {});
  assert.deepEqual(Object.keys(todo.ringkasan), ['customer_dormant', 'lead_perlu_dikunjungi']);
  for (const jenis of ['belum_terkirim', 'tagihan_terlambat']) {
    await assert.rejects(sealed('sales_perlu_tindakan').run(marketing, { jenis }), (e) => e.status === 403);
  }
  calls.length = 0;
  const detail = await sealed('customer_lead_sales').run(marketing, { id_customer: 5 });
  assert.equal(detail.ditemukan, true);
  assert.equal('jumlah_dokumen_penjualan' in detail.customer, false);
  assert.equal(calls.some((c) => /sales_invoices_accurate|sales_revenue_accurate|sales_orders/.test(c.sql)), false, 'no order figure is even read');
  for (const name of ['status_sales_order', 'omzet_sales', 'piutang_sales', 'batch_data_accurate']) {
    await assert.rejects(sealed(name).run(marketing, {}), (e) => e.status === 403, name);
  }
});

test('money gating: rupiah keys only from omzet_sales and piutang_sales, which need sales.order.view and a private chat', async (t) => {
  mockDb(t);
  const revenue = await sealed('omzet_sales').run(head, { bulan: '2026-09' });
  assert.equal(revenue.bulan, '2026-09');
  assert.equal(revenue.bulan_sebelumnya.bulan, '2026-08');
  assert.equal(revenue.omzet_dpp, MONEY);
  assert.equal(revenue.per_channel[0].selisih_omzet_dpp, 0);
  assert.equal(revenue.target.per_akun[0].target_omzet_dpp, MONEY);
  assert.match(revenue.keterangan_angka, /DPP \(sebelum PPN\)/);
  const owed = await sealed('piutang_sales').run(head, {});
  assert.equal(owed.faktur[0].sisa_tagihan_rp, MONEY);
  assert.equal(owed.umur_piutang.kelompok.length, 5);
  assert.equal(owed.umur_piutang.kelompok.find((k) => k.umur === '1–30 hari').sisa_piutang, MONEY);

  // The same data through a tool that is not a money tool is blocked by the guard.
  for (const name of NAMES.filter((n) => !MONEY_TOOLS.includes(n))) {
    for (const input of INPUTS[name]) assert.deepEqual(keysLike(MONEY_KEY, await sealed(name).run(head, input)), [], name);
  }
  for (const name of MONEY_TOOLS) {
    assert.equal(agentTools.toolsFor(head, { visibility: 'department' }).some((tool) => tool.name === name), false);
    assert.equal(agentTools.toolsFor(head, { visibility: 'private', web_research: 1 }).some((tool) => tool.name === name), false);
    assert.equal(agentTools.toolsFor(marketing, { visibility: 'private' }).some((tool) => tool.name === name), false);
    assert.match(sealed(name).description, /margin/, `${name} says it never returns margin`);
  }
  const code = fs.readFileSync(path.join(__dirname, '../src/services/ai/agent/tools/sales.js'), 'utf8');
  assert.doesNotMatch(code, /costPrice|cost_price|unitPrice|unit_price|\.phone|\.email|\.address|contactPerson|latitude|longitude|npwp/i);
});

test('lists are capped: at most 50 rows are asked for, and a long result is cut and marked', async (t) => {
  const calls = mockDb(t);
  await sealed('customer_lead_sales').run(head, { jumlah: 5000 });
  await sealed('sales_perlu_tindakan').run(head, { jumlah: 5000 });
  await sealed('status_sales_order').run(head, { jumlah: 5000 });
  const limits = calls.filter((c) => /LIMIT \? OFFSET \?/.test(c.sql)).map((c) => c.args[c.args.length - 2]);
  assert.ok(limits.length >= 4);
  assert.ok(limits.every((n) => n <= 50), JSON.stringify(limits));
  calls.length = 0;
  await sealed('customer_lead_sales').run(head, {});
  assert.ok(calls.filter((c) => /LIMIT \? OFFSET \?/.test(c.sql)).every((c) => c.args[c.args.length - 2] === 15), 'default 15 rows');

  // A service that hands back more than the framework allows is still cut.
  pool.query.mock.mockImplementation(async (sql) => {
    if (/COUNT\(\*\) AS n FROM sales_accurate_batches b\s+JOIN departments/.test(sql)) return [[{ n: 1 }]];
    if (/sales_revenue_accurate/.test(sql) && /GROUP BY t\.channel/.test(sql)) {
      return [Array.from({ length: contract.MAX_LIST_ITEMS + 30 }, (_, i) => ({ channel: `C${i}`, orders: 1, revenue: 10 }))];
    }
    return [[{ ...ROW }]];
  });
  const big = await sealed('omzet_sales').run(head, {});
  assert.equal(big.per_channel.length, contract.MAX_LIST_ITEMS);
  assert.equal(big.terpotong, true);
});

test('before the first approved Accurate batch the figures are marked as old data, and the badge alarm is held', async (t) => {
  mockDb(t, { accurate: false });
  const todo = await sealed('sales_perlu_tindakan').run(head, {});
  assert.match(todo.catatan, /Belum tersambung Accurate/);
  assert.match(todo.catatan, /menunggu persetujuan/);
  assert.equal(todo.ringkasan.mendesak_di_badge_menu, 0);
  const owed = await sealed('piutang_sales').run(head, {});
  assert.equal(owed.umur_piutang, null);
  assert.match(owed.catatan, /Belum tersambung Accurate/);
  assert.equal(owed.faktur[0].nomor_so, 'SO.1');
  const orders = await sealed('status_sales_order').run(head, { nomor: 'SO.1' });
  assert.equal('surat_jalan' in orders.sales_order[0], false, 'surat jalan from Accurate only once it is connected');

  pool.query.mock.restore();
  pool.getConnection.mock.restore();
  notifications.create.mock.restore();
  mockDb(t, { accurate: true });
  const live = await sealed('sales_perlu_tindakan').run(head, {});
  assert.equal('catatan' in live, false);
  assert.match(live.sumber, /sudah disetujui/);
  assert.equal(live.ringkasan.mendesak_di_badge_menu > 0, true);
  for (const name of NAMES) assert.match(sealed(name).description, /Accurate/, `${name} says where its data comes from`);
});

test('a sales order is followed from SO to delivery to invoice, in words', async (t) => {
  mockDb(t);
  const out = await sealed('status_sales_order').run(head, { nomor: 'SO.1' });
  const so = out.sales_order[0];
  assert.equal(so.nomor_so, 'SO.1');
  assert.equal(so.pengiriman, 'Terkirim 40%');
  assert.equal(so.nomor_faktur, 'SI.1');
  assert.equal(so.jatuh_tempo, '2026-09-25');
  assert.match(so.status_tagihan, /^belum lunas, terlambat \d+ hari$/);
  assert.deepEqual(so.surat_jalan, [{ nomor: 'SI.1', tanggal: '2026-09-20', status: 'dormant' }]);
  assert.equal(so.rute, '/sales/customers/5');
  await assert.rejects(sealed('status_sales_order').run(head, { dari: 'kemarin' }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
});

test('Accurate batches: counts and age only, own division only, and whether the asker decides', async (t) => {
  const calls = mockDb(t, {
    rowsFor: (sql) => {
      if (/ORDER BY b\.id DESC/.test(sql)) return [{ ...ROW, status: 'pending' }];
      if (/SELECT d\.id, d\.code FROM users u/.test(sql)) return [{ id: 2, code: 'sales' }];
      return null;
    },
  });
  const out = await sealed('batch_data_accurate').run(head, {});
  const batch = out.batch[0];
  assert.equal(batch.id_batch, 5);
  assert.equal(batch.status, 'menunggu keputusan');
  assert.deepEqual(batch.isi, [{ jenis: 'Faktur', baru: 2, berubah: 1, tidak_ada_lagi: 0 }]);
  assert.equal(batch.menunggu_jam, 30);
  assert.equal(batch.lebih_dari_1_hari, true);
  assert.equal(batch.anda_bisa_memutuskan, true, 'user 5 is among the deciders');
  assert.deepEqual(batch.peringatan, ['bacaan Accurate tidak lengkap (tidak ada yang dinolkan)']);
  assert.equal(batch.rute, '/data-accurate/5');
  assert.ok(!JSON.stringify(out).includes(String(MONEY)), 'the batch revenue never leaves');
  const list = calls.find((c) => /FROM sales_accurate_batches b\s+JOIN departments d/.test(c.sql) && /ORDER BY b\.id DESC/.test(c.sql));
  assert.match(list.sql, /b\.department_id = \? OR EXISTS/, 'own division, or a batch the user stands in for');
  assert.deepEqual(list.args.slice(0, 4), [7, 2, 5, 'pending']);
  assert.equal(calls.some((c) => /sales_accurate_batch_items/.test(c.sql)), false, 'the documents inside a batch are not read');

  const other = await sealed('batch_data_accurate').run({ ...head, sub: 77 }, {});
  assert.equal(other.batch[0].anda_bisa_memutuskan, false);
  // A Sales Member has no accurate.batch.view.
  await assert.rejects(sealed('batch_data_accurate').run(member, {}), (e) => e.status === 403);
});

test('the Sales tool file reads through the module, never the database or an outside system', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/services/ai/agent/tools/sales.js'), 'utf8');
  assert.doesNotMatch(code, /db\/pool/);
  assert.doesNotMatch(code, /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/);
  assert.doesNotMatch(code, /accurateSync|accurateReadOnly|runSync|stageChanges|applyBatch|records\.(create|update|delete)|saveTargets|saveMapping/);
  // Only GET handlers of the Sales routes are called.
  const handlers = [...code.matchAll(/(dataCtrl|customersCtrl|leadsCtrl|ordersCtrl)\.(\w+)/g)].map((m) => m[2]);
  assert.deepEqual([...new Set(handlers)].sort(), ['detail', 'funnel', 'leadDetail', 'list', 'listDocuments', 'listLeads', 'listOrders', 'overview', 'receivablesAging', 'visits']);
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/sales.routes.js'), 'utf8');
  for (const m of code.matchAll(/(dataCtrl|customersCtrl|leadsCtrl|ordersCtrl)\.(\w+)/g)) {
    const line = routes.split('\n').find((l) => l.includes(`${m[1]}.${m[2]})`) || l.includes(`${m[1]}.${m[2]},`));
    assert.match(line || '', /^router\.get\(/, `${m[1]}.${m[2]} must be a GET handler`);
  }
});
