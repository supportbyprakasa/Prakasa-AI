// Prakasa AI reads Retail Commerce, Marketing and Finance (Wave B): the tools
// run against the real services with a mocked pool (no database, no writes),
// against mocked services (shape, caps, what is never copied), and — when the
// local database is there — against real rows inside a rolled-back transaction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool, dbReady, inRolledBackTransaction, makeUser } = require('./fixtures/gaDb');

const B = '../src';
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const { MONEY_KEY, PERSONAL_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const notif = require(`${B}/services/notification.service`);
const retail = require(`${B}/services/retailCommerce.service`);
const insights = require(`${B}/services/marketingInsights.service`);
const campaigns = require(`${B}/services/marketingCampaigns.service`);
const requests = require(`${B}/services/financeRequests.service`);
const receivables = require(`${B}/services/financeReceivables.service`);
const payables = require(`${B}/services/financePayables.service`);

test.after(() => pool.end());

const FILES = ['retailCommerce.js', 'marketing.js', 'finance.js'];
const MINE = agentTools.TOOLS.filter((t) => FILES.includes(t.file));
const tool = (name) => agentTools.byName.get(name);
const PRIVATE = { visibility: 'private' };

const EXPECTED = {
  ringkasan_marketplace: { module: ['retail-commerce'], permission: 'retail.insight.view', money: true },
  produk_terlaris_marketplace: { module: ['retail-commerce'], permission: 'retail.insight.view', money: true },
  pengiriman_marketplace_tertunda: { module: ['retail-commerce'], permission: 'retail.insight.view', money: false },
  tagihan_marketplace_belum_lunas: { module: ['retail-commerce'], permission: 'retail.insight.view', money: true },
  penjualan_channel_dan_produk: { module: ['marketing-insights'], permission: 'marketing.insight.view', money: true },
  lead_dan_customer_baru: { module: ['marketing-insights'], permission: 'marketing.insight.view', money: false },
  daftar_kampanye: { module: ['marketing-campaigns'], permission: 'marketing.insight.view', money: false },
  hasil_kampanye: { module: ['marketing-campaigns'], permission: 'marketing.insight.view', money: true },
  pengajuan_pembayaran_saya: { module: ['finance'], permission: ['finance.request', 'finance.view'], money: true },
  daftar_pengajuan_pembayaran: { module: ['finance'], permission: ['finance.request', 'finance.view'], money: true },
  pengajuan_pembayaran_perlu_tindakan: { module: ['finance'], permission: ['finance.request', 'finance.view'], money: true },
  detail_pengajuan_pembayaran: { module: ['finance'], permission: ['finance.request', 'finance.view'], money: true },
  ringkasan_piutang: { module: ['finance-receivables'], permission: 'finance.receivable.view', money: true },
  ringkasan_utang: { module: ['finance-payables'], permission: 'finance.payable.view', money: true },
};

const keysOf = (value, found = []) => {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) { found.push(key); keysOf(child, found); }
  }
  return found;
};
const longest = (value, max = 0) => {
  if (Array.isArray(value)) return value.reduce((m, item) => longest(item, m), Math.max(max, value.length));
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.values(value).reduce((m, child) => longest(child, m), max);
  return max;
};

// ------------------------------------------------------------------ contract

test('the three files add exactly these tools, each with the page\'s permission, private-only, and passing the contract', () => {
  assert.deepEqual(MINE.map((t) => t.name).sort(), Object.keys(EXPECTED).sort());
  assert.deepEqual(contract.validateTools(MINE), []);
  for (const t of MINE) {
    const want = EXPECTED[t.name];
    assert.deepEqual([...t.module], want.module, t.name);
    assert.deepEqual(t.permission, want.permission, t.name);
    assert.equal(t.privateOnly, true, `${t.name}: division data or the user's own`);
    assert.equal(Boolean(t.money), want.money, t.name);
    assert.match(t.description, contract.NOT_RETURNED, t.name);
    assert.ok(t.name.length <= contract.MAX_NAME, t.name);
  }
  for (const key of ['retail-commerce', 'marketing-insights', 'marketing-campaigns', 'finance', 'finance-receivables', 'finance-payables']) {
    assert.ok(MINE.some((t) => t.module.includes(key)), `${key} is served`);
  }
});

test('the tool files never query the database, call Accurate, or reach for books, tax or bank data', () => {
  for (const file of FILES) {
    const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, file), 'utf8');
    assert.doesNotMatch(code, /db\/pool|pool\.query|getConnection/, file);
    assert.doesNotMatch(code, /\b(create|update|remove|submit|processPayment|cancel|addAttachment|runDocumentCheck|applyDecidedApproval|createCampaign|updateCampaign)\(/, `${file} calls a write`);
    assert.doesNotMatch(code, /payeeBank|payeeAccountNumber|payeeAccountName|webViewLink|salesPersonName|\.term\b/, `${file} copies a field it must not`);
    assert.doesNotMatch(code, /webSessions|googleAnalytics/, `${file}: Google Analytics is not read by the agent`);
  }
  const finance = MINE.filter((t) => t.file === 'finance.js');
  for (const t of finance) assert.match(t.description, /jurnal|buku besar/i, `${t.name} says it has no books`);
  for (const t of finance.filter((x) => x.module.includes('finance'))) assert.match(t.description, /nomor rekening/i, `${t.name} says it has no account number`);
  assert.match(tool('ringkasan_marketplace').description, /satu faktur rekap per bulan/);
  for (const name of ['ringkasan_marketplace', 'produk_terlaris_marketplace', 'penjualan_channel_dan_produk', 'hasil_kampanye']) {
    assert.match(tool(name).description, /DPP/, `${name}: revenue is on DPP`);
  }
});

// ------------------------------------------------------------------ permission and session gates

test('permission refusal: without the page permission run() answers 403 and the tool is not offered', async () => {
  const strangers = [
    { sub: 9, entityId: 1, departmentId: 3, permissions: [] },
    { sub: 9, entityId: 1, departmentId: 3, permissions: ['task.view', 'warehouse.stock.view', 'sales.order.view', 'notification.view'] },
  ];
  for (const user of strangers) {
    for (const t of MINE) {
      await assert.rejects(t.run(user, {}), (e) => e.status === 403 && e.code === 'FORBIDDEN', t.name);
    }
    const offered = agentTools.toolsFor(user, PRIVATE).map((t) => t.name);
    assert.deepEqual(offered.filter((n) => EXPECTED[n]), []);
  }
});

test('role matrix: each division gets its own module, money reports only Finance and the Management Office', () => {
  const RC = ['ringkasan_marketplace', 'produk_terlaris_marketplace', 'pengiriman_marketplace_tertunda', 'tagihan_marketplace_belum_lunas'];
  const MKT = ['penjualan_channel_dan_produk', 'lead_dan_customer_baru', 'daftar_kampanye', 'hasil_kampanye'];
  const REQ = ['pengajuan_pembayaran_saya', 'daftar_pengajuan_pembayaran', 'pengajuan_pembayaran_perlu_tindakan', 'detail_pengajuan_pembayaran'];
  const REPORTS = ['ringkasan_piutang', 'ringkasan_utang'];
  const expected = {
    finance: [...REQ, ...REPORTS],
    'retail_commerce': [...RC, ...REQ],
    marketing: [...MKT, ...REQ],
    'sales.member': REQ,
    sales: [...RC, ...MKT, ...REQ],
    'management_office.member': REQ,
    management_office: [...RC, ...MKT, ...REQ, ...REPORTS],
  };
  for (const role of STANDARD_ROLES) {
    const names = agentTools.toolsFor({ permissions: role.permissions }, PRIVATE).map((t) => t.name).filter((n) => EXPECTED[n]);
    const want = expected[role.key] ?? expected[role.departmentCode] ?? REQ;
    assert.deepEqual([...names].sort(), [...want].sort(), role.key);
  }
});

test('money gate: nothing here in a shared conversation or next to web research', () => {
  const user = { permissions: [...new Set(STANDARD_ROLES.flatMap((r) => r.permissions))] };
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }, null]) {
    const names = agentTools.toolsFor(user, session).map((t) => t.name);
    assert.deepEqual(names.filter((n) => EXPECTED[n]), [], JSON.stringify(session));
  }
  const names = agentTools.toolsFor(user, PRIVATE).map((t) => t.name);
  for (const name of Object.keys(EXPECTED)) {
    assert.ok(names.includes(name), name);
    assert.ok(agentTools.PRIVATE_ONLY_TOOLS.includes(name), name);
  }
});

// ------------------------------------------------------------------ real services, mocked pool

const MONEY = 987654321;
const ROW = {
  id: 5, entity_id: 7, department_id: 3, name: 'Uji', n: 1, total: 1, live: 1, month: '2026-09', channel: 'Shopee', d: new Date('2026-09-30T00:00:00Z'),
  revenue: MONEY, gross: MONEY, returns: 0, invoices: 2, orders: 3, outstanding: MONEY, overdue: MONEY, overdue_invoices: 1, oldest_due: new Date('2026-08-31T00:00:00Z'),
  open_orders: 2, late_orders: 1, oldest: new Date('2026-09-01T00:00:00Z'), code: 'OAT-1', units: '[{"unit":"Ctns","qty":4}]', base_qty: 24, base_unit: 'Pcs', channels: 'Shopee',
  products: 1, number: 'SO.1', trans_date: new Date('2026-09-20T00:00:00Z'), customer_name: 'Shopee Official', status: 'Menunggu diproses', so_state: 'open',
  percent_shipped: 0, promised_date: new Date('2026-09-22T00:00:00Z'), promised_in_so: 0, judged: 1, is_late: 1, is_recap: 0, days_open: 12, days_late: 10,
  invoice_number: 'INV.1', due_date: new Date('2026-08-31T00:00:00Z'), outstanding_amount: MONEY, days_overdue: 32, item_code: 'OAT-1', item_name: 'Oatside',
  unit: 'Ctns', qty: 4, qty_base: 24, has_ratio: 1, customers: 2, area: 'Surabaya', open_count: 1, visited: 1, converted: 0, dropped: 0, new_in_month: 1,
  current_count: 4, previous_count: 2, start_on: new Date('2026-09-01T00:00:00Z'), end_on: new Date('2026-09-15T00:00:00Z'), objective: 'penjualan',
  version: 1, item_count: 1, campaign_id: 5, item_no: 'OAT-1', noo: 1, baseline_noo: 0, running: 1, draft: 0, ended_open: 1, done: 0,
  workflow_type: 'payment_request', request_number: 'PR-202609-0001', title: 'Tagihan uji', requested_by: 9, requester_name: 'Pengaju Uji', department_name: 'Sales',
  payee_name: 'PT Vendor Uji', request_date: new Date('2026-09-20T00:00:00Z'), attachment_type: 'invoice', order_index: 1, bucket: 'd31_60', grp: 'Shopee',
  customer_code: 'C-1', customer_id: 11, overdue_amount: MONEY, oldest_days: 32, days_left: 3, count: 2, applied_at: new Date('2026-09-29T10:00:00Z'),
  decided_at: new Date('2026-09-29T10:00:00Z'), decided_by: 'Head Uji', vendor_no: 'V-1', vendor_name: 'PT Pemasok', vendors: 1, days: 5, payments: 1,
  over90_invoices: 0, due_soon_invoices: 1, non_idr: 1, dp_open: 2, receipts_month: 1, approval_request_id: null,
  // values the page shows but a tool must copy only into a money tool
  amount: MONEY, total_amount: MONEY, dpp_amount: MONEY, tax_amount: MONEY, budget: MONEY, over90_amount: MONEY, due_soon_amount: MONEY, collected_month: MONEY, billed_90: MONEY,
  // bait: never in any result
  payee_bank: 'BANK-SENTINEL', payee_account_number: 'ACC-SENTINEL', payee_account_name: 'HOLDER-SENTINEL', term_name: 'NET-SENTINEL',
  sales_person_name: 'SALES-SENTINEL', address: 'Jl. SENTINEL 1', phone: '0812SENTINEL', email: 'sentinel@x', npwp: 'NPWP-SENTINEL', web_view_link: 'https://sentinel.invalid/x',
  unit_price: 123454321, margin: 123454321, cost: 123454321,
};

function mockDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    calls.push({ sql: String(sql), args });
    return [[{ ...ROW }]];
  });
  return calls;
}

const ALL = [...new Set(STANDARD_ROLES.flatMap((r) => r.permissions))];
const INPUTS = {
  ringkasan_marketplace: [{}, { bulan: 6 }],
  produk_terlaris_marketplace: [{}, { bulan: '2026-08', jumlah: 3 }],
  pengiriman_marketplace_tertunda: [{}, { hanya_terlambat: true, jumlah: 5 }],
  tagihan_marketplace_belum_lunas: [{}, { hanya_lewat_jatuh_tempo: true }],
  penjualan_channel_dan_produk: [{}, { bulan: '2026-09', jumlah: 5 }],
  lead_dan_customer_baru: [{}, { bulan: '2026-09' }],
  daftar_kampanye: [{}, { status: 'berjalan', hanya_lewat_tanggal: true, cari: 'uji' }],
  hasil_kampanye: [{ id: 5 }],
  pengajuan_pembayaran_saya: [{}, { status: 'dibayar', jenis: 'reimbursement', cari: 'uji' }],
  daftar_pengajuan_pembayaran: [{}, { status: 'menunggu_persetujuan' }],
  pengajuan_pembayaran_perlu_tindakan: [{}],
  detail_pengajuan_pembayaran: [{ id: 5 }, { nomor: 'PR-202609-0001' }],
  ringkasan_piutang: [{}, { daftar: 'segera_jatuh_tempo', jumlah: 5 }],
  ringkasan_utang: [{}, { daftar: 'pemasok_terbesar' }, { daftar: 'segera_jatuh_tempo' }],
};

test('every tool only SELECTs, binds the caller\'s company, and never returns bank, contact, term, salesperson or price bait — even for an all-permission user', async (t) => {
  const calls = mockDb(t);
  const user = { sub: 9, entityId: 7, departmentId: 3, permissions: ALL };
  for (const tl of MINE) {
    for (const input of INPUTS[tl.name]) {
      calls.length = 0;
      const out = await tl.run(user, input);
      const json = JSON.stringify(out);
      assert.ok(!/SENTINEL|sentinel/.test(json), `${tl.name} ${JSON.stringify(input)} leaked bait: ${json.match(/.{30}SENTINEL.{10}/i)?.[0]}`);
      assert.ok(!json.includes('123454321'), `${tl.name} leaked a price/margin`);
      assert.deepEqual(keysOf(out).filter((k) => PERSONAL_KEY.test(k)), [], tl.name);
      if (!tl.money) {
        assert.deepEqual(keysOf(out).filter((k) => MONEY_KEY.test(k)), [], `${tl.name} has a rupiah key`);
        assert.ok(!json.includes(String(MONEY)), `${tl.name} ${JSON.stringify(input)} carries a rupiah figure`);
      }
      assert.ok(calls.length > 0, tl.name);
      for (const { sql, args } of calls) {
        assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `${tl.name} ran a non-SELECT: ${sql.slice(0, 60)}`);
        assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|REPLACE INTO)\b/i, tl.name);
        assert.doesNotMatch(sql, /pc_po_price|gl_|journal/i, tl.name);
        if (/entity_id = \?/.test(sql)) assert.ok(args.includes(7), `${tl.name} unbound company: ${sql.slice(0, 80)}`);
      }
      assert.ok(longest(out) <= contract.MAX_LIST_ITEMS, tl.name);
    }
  }
});

test('Retail Commerce reads only the Retail Commerce division of the caller\'s company', async (t) => {
  const calls = mockDb(t);
  const user = { sub: 9, entityId: 7, departmentId: 99, permissions: ['retail.insight.view'] };
  for (const name of ['ringkasan_marketplace', 'produk_terlaris_marketplace', 'pengiriman_marketplace_tertunda', 'tagihan_marketplace_belum_lunas']) {
    calls.length = 0;
    await tool(name).run(user, {});
    assert.ok(calls.some((c) => /FROM departments WHERE entity_id = \? AND code = \?/.test(c.sql) && c.args[0] === 7 && c.args[1] === 'retail_commerce'), name);
    const data = calls.filter((c) => /(department_id|sales_department_id) = \?/.test(c.sql));
    assert.ok(data.length > 0, name);
    // The division id is the one read from `departments` (ROW.id = 5), never the caller's own (99) or an input.
    for (const c of data) assert.ok(c.args[0] === 7 && c.args[1] === 5 && !c.args.includes(99), `${name}: ${c.sql.slice(0, 70)}`);
  }
});

test('payment requests: "saya" is bound to the asker; a member\'s list is their own; a Head\'s adds the division; Finance reads all', async (t) => {
  const calls = mockDb(t);
  const listSql = () => calls.filter((c) => /FROM\s+finance_workflows f/.test(c.sql) && /ORDER BY f\.id DESC/.test(c.sql));
  const member = { sub: 41, entityId: 7, departmentId: 3, permissions: ['finance.request'] };

  await tool('pengajuan_pembayaran_saya').run(member, {});
  for (const c of listSql()) assert.ok(/f\.requested_by = \?/.test(c.sql) && c.args.includes(41), 'mine');

  calls.length = 0;
  await tool('daftar_pengajuan_pembayaran').run(member, {});
  assert.equal(listSql().length, 1);
  assert.ok(/AND f\.requested_by = \?/.test(listSql()[0].sql) && !/f\.department_id = \?/.test(listSql()[0].sql), 'a member reads only their own');

  calls.length = 0;
  await tool('daftar_pengajuan_pembayaran').run({ ...member, permissions: ['finance.request', 'management_dashboard.division'] }, {});
  assert.match(listSql()[0].sql, /\(f\.requested_by = \? OR f\.department_id = \?\)/);
  assert.ok(listSql()[0].args.includes(41) && listSql()[0].args.includes(3));

  calls.length = 0;
  await tool('daftar_pengajuan_pembayaran').run({ ...member, permissions: ['finance.view', 'finance.process'] }, {});
  assert.doesNotMatch(listSql()[0].sql, /requested_by = \?/, 'Finance reads the whole company');

  // Even Finance asking for "saya" stays on their own rows.
  calls.length = 0;
  await tool('pengajuan_pembayaran_saya').run({ ...member, permissions: ['finance.view', 'finance.process'] }, {});
  assert.ok(/f\.requested_by = \?/.test(listSql()[0].sql) && listSql()[0].args.includes(41));

  // "Siap dibayar" is Finance's step only; a user who cannot decide gets an empty decision queue without a query for it.
  calls.length = 0;
  const plain = await tool('pengajuan_pembayaran_perlu_tindakan').run(member, {});
  assert.equal('siap_dibayar' in plain, false);
  assert.deepEqual(plain.menunggu_keputusan_saya, { total: 0, pengajuan: [] });
  assert.ok(calls.every((c) => !/status = 'pending_approval'/.test(c.sql)));
  const cashier = await tool('pengajuan_pembayaran_perlu_tindakan').run({ ...member, permissions: ['finance.view', 'finance.process'] }, {});
  assert.ok(Array.isArray(cashier.siap_dibayar.pengajuan) && Array.isArray(cashier.sedang_diproses.pengajuan));
});

test('a request of another person in another division reads as not found for a member (mocked row)', async (t) => {
  mockDb(t);
  const stranger = { sub: 77, entityId: 7, departmentId: 8, permissions: ['finance.request'] };
  const out = await tool('detail_pengajuan_pembayaran').run(stranger, { id: 5 });
  assert.deepEqual(out, { ditemukan: false, catatan: 'Pengajuan tidak ditemukan atau bukan untuk Anda.' });
  const owner = await tool('detail_pengajuan_pembayaran').run({ ...stranger, sub: 9 }, { id: 5 });
  assert.equal(owner.ditemukan, true);
  assert.equal(owner.pengajuan.total_rupiah, MONEY);
  assert.equal(owner.pengajuan.rute, '/finance/payment-requests/5');
});

// ------------------------------------------------------------------ mocked services: shape, caps, notes

test('before the first approved Accurate batch every figure says so instead of guessing', async (t) => {
  const user = { sub: 1, entityId: 1, permissions: ALL };
  const off = { connected: false, reason: 'not_approved', department: { id: 1, name: 'RC' }, rows: [], total: 0, months: [] };
  for (const fn of ['overview', 'topProducts', 'pendingShipments', 'receivables']) t.mock.method(retail, fn, async () => off);
  for (const name of ['ringkasan_marketplace', 'produk_terlaris_marketplace', 'pengiriman_marketplace_tertunda', 'tagihan_marketplace_belum_lunas']) {
    const out = await tool(name).run(user, {});
    assert.equal(out.tersedia, false, name);
    assert.match(out.catatan, /menunggu persetujuan/i, name);
  }
  t.mock.method(receivables, 'overview', async () => ({ ready: false, reason: receivables.NOT_READY }));
  t.mock.method(payables, 'overview', async () => ({ ready: false, reason: payables.NOT_READY, enabled: true, pending: { batchId: 1 } }));
  for (const name of ['ringkasan_piutang', 'ringkasan_utang']) {
    const out = await tool(name).run(user, {});
    assert.equal(out.tersedia, false, name);
    assert.match(out.catatan, /menunggu persetujuan/i, name);
    assert.deepEqual(keysOf(out).sort(), ['catatan', 'rute', 'tersedia']);
  }
  t.mock.method(insights, 'insights', async () => ({
    month: '2026-10', prevMonth: '2026-09', months: [{ key: '2026-09' }, { key: '2026-10' }], accurate: false, dataThrough: null, channels: [],
    leads: { newThisMonth: 3, newPrevMonth: 1, byArea: [{ area: 'Surabaya', total: 4, open: 2, visited: 1, converted: 1, dropped: 0, newInMonth: 3 }] },
    kpis: { revenue: null, productsSold: null, newCustomers: null }, topProducts: [], movers: { rising: [], falling: [] },
  }));
  const sales = await tool('penjualan_channel_dan_produk').run(user, {});
  assert.equal(sales.tersedia, false);
  assert.match(sales.catatan, /menunggu persetujuan/i);
  const leads = await tool('lead_dan_customer_baru').run(user, {});
  assert.equal(leads.lead_baru, 3, 'leads are the app\'s own data and still show');
  assert.equal(leads.customer_baru, null);
  assert.equal(leads.lead_per_area[0].area, 'Surabaya');
  assert.match(leads.catatan, /menunggu persetujuan/i);
});

test('a bad month is a plain note, never an error or a guess', async () => {
  const user = { sub: 1, entityId: 1, permissions: ALL };
  for (const name of ['produk_terlaris_marketplace', 'penjualan_channel_dan_produk', 'lead_dan_customer_baru']) {
    const out = await tool(name).run(user, { bulan: 'sept' });
    assert.equal(out.tersedia, false, name);
    assert.match(out.catatan, /YYYY-MM/, name);
  }
});

test('size cap: long lists are cut to the asked number and never pass the central cap', async (t) => {
  const user = { sub: 1, entityId: 1, departmentId: 2, permissions: ALL };
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  t.mock.method(retail, 'pendingShipments', async () => ({
    connected: true, total: 300, limit: 50, shipSlaDays: 2,
    rows: many(300, (i) => ({ number: `SO.${i}`, date: '2026-09-01', platform: 'Shopee', customerName: 'Shopee', status: 'x', percentShipped: 0, promisedDate: '2026-09-03', daysOpen: 9, daysLate: 7, late: i % 2 === 0, recap: false, judged: true, amount: MONEY })),
  }));
  const ship = await tool('pengiriman_marketplace_tertunda').run(user, {});
  assert.equal(ship.so.length, 20);
  assert.equal(ship.total_so_belum_terkirim, 300);
  assert.ok(!JSON.stringify(ship).includes(String(MONEY)), 'the SO value is not copied');
  assert.equal((await tool('pengiriman_marketplace_tertunda').run(user, { jumlah: 9999 })).so.length, 50);
  assert.ok((await tool('pengiriman_marketplace_tertunda').run(user, { hanya_terlambat: true })).so.every((r) => r.terlambat));

  const dto = (i) => ({
    id: i + 1, requestNumber: `PR-${i}`, workflowType: 'payment_request', title: 'x', status: 'approved', totalAmount: 10, requestDate: '2026-09-01',
    payeeName: 'PT X', payeeBank: 'BANK-SENTINEL', payeeAccountNumber: 'ACC-SENTINEL', payeeAccountName: 'HOLDER-SENTINEL',
  });
  const seen = [];
  t.mock.method(requests, 'list', async (u, q) => { seen.push(q); return { rows: many(Number(q.limit), dto), meta: { page: 1, limit: q.limit, total: 500 } }; });
  const list = await tool('daftar_pengajuan_pembayaran').run(user, { jumlah: 9999 });
  assert.equal(list.pengajuan.length, 50);
  assert.equal(list.total, 500);
  assert.equal(seen[0].limit, 50);
  assert.equal(seen[0].mine, undefined);
  assert.ok(!/SENTINEL/.test(JSON.stringify(list)), 'a vendor\'s bank details are never copied, for anyone');
  assert.equal(list.pengajuan[0].status, 'Disetujui, menunggu diproses Finance');
  await tool('pengajuan_pembayaran_saya').run(user, { status: 'dibayar', jenis: 'reimbursement' });
  assert.deepEqual(seen[1], { limit: 20, mine: '1', status: 'paid', workflowType: 'reimbursement' });

  t.mock.method(campaigns, 'readCampaigns', async () => ({
    summary: { total: 400, running: 400, draft: 0, done: 0, endedOpen: 200 },
    rows: many(400, (i) => ({ id: i + 1, name: `Kampanye ${i}`, status: 'berjalan', statusLabel: 'Berjalan', objectiveLabel: 'Penjualan', channelsLabel: 'Semua channel', startOn: '2026-09-01', endOn: '2026-09-15', days: 15, endedOpen: i % 2 === 0, upcoming: false, itemCount: 1, budget: MONEY })),
  }));
  const camp = await tool('daftar_kampanye').run(user, { hanya_lewat_tanggal: true, jumlah: 9999 });
  assert.equal(camp.kampanye.length, 50);
  assert.equal(camp.cocok, 200);
  assert.equal(camp.ringkasan.berjalan_lewat_tanggal_selesai, 200);
  assert.ok(camp.kampanye.every((c) => c.lewat_tanggal_selesai && c.rute === `/marketing/campaigns?open=${c.id}`));
  assert.ok(!JSON.stringify(camp).includes(String(MONEY)), 'the campaign list carries no budget');
});

test('piutang and utang say what is left out: down payments, foreign currency, and that the opening balance still counts as owed', async (t) => {
  const user = { sub: 1, entityId: 1, permissions: ALL };
  const buckets = receivables.BUCKETS.map((b) => ({ key: b.key, label: b.label, invoices: 1, amount: 100, share: 20 }));
  const block = { invoices: 1, amount: 100 };
  t.mock.method(receivables, 'overview', async () => ({
    ready: true, asOf: '2026-09-29T10:00:00.000Z',
    summary: { invoices: 5, customers: 2, outstanding: 500, overdue: block, over90: block, dueSoon: { days: 14, ...block }, collectedThisMonth: { amount: 50, receipts: 1 }, dso: { days: 31.5, window: 90, billed: 900 }, downPaymentsOpen: 3 },
    aging: { buckets, total: { invoices: 5, amount: 500 }, channels: [{ channel: 'GT', total: { invoices: 5, amount: 500 }, buckets }] },
    customers: Array.from({ length: 20 }, (_, i) => ({ customerCode: `C-${i}`, customerName: `Toko ${i}`, customerId: i + 1, channel: 'GT', salesPersonName: 'SALES-SENTINEL', invoices: 1, outstanding: 100, overdueInvoices: 1, overdueAmount: 100 - i, oldestDays: 40, oldestDue: '2026-08-20' })),
    dueSoon: [{ id: 1, invoiceNumber: 'INV.9', date: '2026-09-10', dueDate: '2026-10-05', customerCode: 'C-1', customerName: 'Toko 1', channel: 'GT', salesPersonName: 'SALES-SENTINEL', total: 100, outstanding: 100, daysLeft: 3 }],
    collections: [],
  }));
  const ar = await tool('ringkasan_piutang').run(user, {});
  assert.equal(ar.ringkasan.total_piutang, 500);
  assert.equal(ar.umur_piutang.length, 5);
  assert.equal(ar.customer_tunggakan_terbesar.length, 10);
  assert.equal(ar.customer_tunggakan_terbesar[0].rute, '/sales/customers/1');
  assert.equal(ar.tidak_dihitung.faktur_uang_muka_terbuka, 3);
  assert.match(ar.catatan, /Saldo awal Accurate .* TETAP terhitung sebagai piutang/);
  assert.match(ar.catatan, /bukan laporan keuangan/);
  assert.equal('faktur_segera_jatuh_tempo' in ar, false);
  const soon = await tool('ringkasan_piutang').run(user, { daftar: 'segera_jatuh_tempo' });
  assert.equal(soon.faktur_segera_jatuh_tempo[0].nomor_faktur, 'INV.9');
  assert.ok(!/SENTINEL/.test(JSON.stringify([ar, soon])), 'no salesperson name');

  const inv = { id: 1, invoiceNumber: 'PI.1', date: '2026-08-01', dueDate: '2026-08-31', vendorNo: 'V-1', vendorName: 'PT Pemasok', term: 'NET-SENTINEL', total: 200, outstanding: 150, days: 32 };
  t.mock.method(payables, 'overview', async () => ({
    ready: true, asOf: { batchId: 3, approvedAt: '2026-09-29T10:00:00.000Z', approvedBy: 'Head Finance' },
    summary: { invoices: 4, vendors: 2, outstanding: 800, overdue: block, over90: block, dueSoon: { days: 14, ...block }, paidThisMonth: { amount: 70, payments: 2 }, nonIdrOpen: 1, downPaymentsOpen: 2 },
    aging: { buckets, total: { invoices: 4, amount: 800 } },
    vendors: [{ vendorNo: 'V-1', vendorName: 'PT Pemasok', invoices: 2, outstanding: 600, overdueInvoices: 1, overdueAmount: 150, oldestDays: 32, nextDue: '2026-10-10' }],
    dueSoon: [inv], overdue: [inv], payments: [],
  }));
  const ap = await tool('ringkasan_utang').run(user, {});
  assert.equal(ap.ringkasan.total_utang, 800);
  assert.equal(ap.faktur_terlambat[0].terlambat_hari, 32);
  assert.deepEqual([ap.tidak_dihitung.faktur_uang_muka_terbuka, ap.tidak_dihitung.faktur_mata_uang_asing_terbuka], [2, 1]);
  assert.equal(ap.disetujui_oleh, 'Head Finance');
  const vendors = await tool('ringkasan_utang').run(user, { daftar: 'pemasok_terbesar' });
  assert.equal(vendors.pemasok_utang_terbesar[0].total_utang, 600);
  assert.equal('faktur_terlambat' in vendors, false);
  assert.ok(!/SENTINEL/.test(JSON.stringify([ap, vendors])), 'no payment term');
});

test('the marketplace overview carries the billed-monthly note and the last invoiced month', async (t) => {
  const months = retail.monthsBack(3);
  t.mock.method(retail, 'overview', async () => ({
    connected: true, reason: null, months,
    ...retail.buildOverview({
      months,
      revenueRows: [{ month: months[1].key, channel: 'Shopee', revenue: 900, gross: 1000, returns: 100, invoices: 1 }],
      orderRows: [{ month: months[2].key, channel: 'Shopee', orders: 4 }],
      receivableRows: [{ channel: 'Shopee', outstanding: 500, invoices: 1, overdue: 0, overdue_invoices: 0, oldest_due: '2026-10-31' }],
      shipmentRows: [{ channel: 'TokoPedia', open_orders: 2, late_orders: 1, oldest: '2026-09-25' }],
      dpThisMonth: 1,
    }),
  }));
  const out = await tool('ringkasan_marketplace').run({ sub: 1, entityId: 1, permissions: ['retail.insight.view'] }, {});
  assert.equal(out.bulan_ini.revenue_dpp, 0);
  assert.equal(out.bulan_terakhir_berfaktur, months[1].key);
  assert.match(out.catatan, /SATU faktur rekap per marketplace per bulan/);
  assert.deepEqual(out.per_marketplace.map((p) => p.marketplace), ['Shopee', 'Tokopedia']);
  assert.equal(out.per_marketplace[0].revenue_dpp_jendela, 900);
  assert.equal(out.pengiriman.so_terlambat, 1);
  assert.equal(out.revenue_dpp_per_bulan.length, 3);
});

// ------------------------------------------------------------------ real rows (rolled back)

test('database: a member sees only their own request, a colleague and another division nothing, the Head the division, Finance all — never a bank account', async (t) => {
  if (!(await dbReady())) { t.skip('no database'); return; }
  const sent = t.mock.method(notif, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const requester = await makeUser(conn, { name: 'Peminta AI', division: 'sales', roles: ['sales.member'] });
    const colleague = await makeUser(conn, { name: 'Rekan AI', division: 'sales', roles: ['sales.member'] });
    const head = await makeUser(conn, { name: 'Head Sales AI', division: 'sales', roles: ['sales.head'] });
    const outsider = await makeUser(conn, { name: 'Marketing AI', division: 'marketing', roles: ['marketing.head'] });
    const cashier = await makeUser(conn, { name: 'Kasir AI', division: 'finance', roles: ['finance.supervisor'] });

    const title = `[UJI] Sewa booth ${process.pid}-${Date.now()}`;
    const created = await requests.create(requester.user, {
      workflowType: 'payment_request', title, payeeName: 'PT Vendor Uji', payeeBank: 'BANKUJI', payeeAccountNumber: '9988776655', payeeAccountName: 'PEMILIKUJI',
      amount: 1000000, taxAmount: 110000,
    });
    const other = await requests.create(colleague.user, { workflowType: 'reimbursement', title: `${title} rekan`, amount: 50000 });

    const mineTool = tool('pengajuan_pembayaran_saya');
    const listTool = tool('daftar_pengajuan_pembayaran');
    const detailTool = tool('detail_pengajuan_pembayaran');
    const ids = (out) => out.pengajuan.map((r) => r.id);

    const own = await mineTool.run(requester.user, { cari: title });
    assert.deepEqual(ids(own), [created.id], 'own only');
    assert.equal(own.pengajuan[0].total_rupiah, 1110000);
    assert.equal(own.pengajuan[0].status, 'Draf (belum diajukan)');
    assert.equal(own.pengajuan[0].nomor, created.requestNumber);

    assert.deepEqual(ids(await listTool.run(requester.user, { cari: title })), [created.id], 'a member\'s list is their own');
    assert.deepEqual(ids(await listTool.run(colleague.user, { cari: title })), [other.id]);
    assert.deepEqual(ids(await listTool.run(outsider.user, { cari: title })), [], 'another division\'s Head reads nothing of Sales');
    assert.deepEqual(ids(await mineTool.run(head.user, { cari: title })), [], '"saya" is never the division');
    assert.deepEqual(ids(await listTool.run(head.user, { cari: title })).sort(), [created.id, other.id].sort(), 'the division Head reads the division');
    assert.deepEqual(ids(await listTool.run(cashier.user, { cari: title })).sort(), [created.id, other.id].sort(), 'Finance reads all');

    for (const who of [colleague, outsider]) {
      assert.equal((await detailTool.run(who.user, { id: created.id })).ditemukan, false);
      assert.equal((await detailTool.run(who.user, { nomor: created.requestNumber })).ditemukan, false);
    }
    const byNumber = await detailTool.run(requester.user, { nomor: created.requestNumber });
    assert.equal(byNumber.ditemukan, true);
    assert.equal(byNumber.pengajuan.subtotal_rupiah, 1000000);
    assert.equal(byNumber.pengajuan.pajak_rupiah, 110000);
    assert.ok(byNumber.lampiran_wajib_belum_ada.length > 0, 'the missing required documents are named');
    assert.ok(byNumber.yang_bisa_anda_lakukan_di_halaman.includes('mengajukan ke persetujuan'));
    const forFinance = await detailTool.run(cashier.user, { id: created.id });
    assert.equal(forFinance.ditemukan, true);

    const queue = await tool('pengajuan_pembayaran_perlu_tindakan').run(head.user, {});
    assert.ok(!ids(queue.menunggu_keputusan_saya).includes(created.id), 'a draft waits for nobody');
    assert.equal('siap_dibayar' in queue, false);
    assert.ok('siap_dibayar' in await tool('pengajuan_pembayaran_perlu_tindakan').run(cashier.user, {}));

    const everything = JSON.stringify([own, byNumber, forFinance, await listTool.run(cashier.user, { cari: title })]);
    assert.ok(!/BANKUJI|9988776655|PEMILIKUJI/.test(everything), 'the vendor\'s bank details never leave, even for Finance');

    // Division scope of the reports: only the holders of the report permission.
    for (const who of [requester, head, outsider]) {
      await assert.rejects(tool('ringkasan_piutang').run(who.user, {}), (e) => e.status === 403);
      await assert.rejects(tool('ringkasan_utang').run(who.user, {}), (e) => e.status === 403);
    }
    await assert.rejects(tool('ringkasan_marketplace').run(outsider.user, {}), (e) => e.status === 403, 'Marketing does not read Retail Commerce');
    await assert.rejects(tool('daftar_kampanye').run(requester.user, {}), (e) => e.status === 403, 'a Sales member does not read Marketing');
    const ar = await tool('ringkasan_piutang').run(cashier.user, {});
    assert.equal(typeof ar.tersedia, 'boolean');
    const camp = await tool('daftar_kampanye').run(outsider.user, {});
    assert.ok(Array.isArray(camp.kampanye));
    assert.deepEqual(keysOf(camp).filter((k) => MONEY_KEY.test(k)), []);
  });
  assert.equal(sent.mock.callCount(), 0, 'reading notifies nobody');
});
