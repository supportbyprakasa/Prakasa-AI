// "Ringkasan pagi" (Prakasa AI Wave D1): services/morningBriefing.service.js,
// GET /work-summary/briefing, the home tool and the account preference.
// The module services are mocked for scope, order, cache and budget; the last
// test runs the real services against the local schema in a transaction that
// is always rolled back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'uji-secret-panjang-sekali-untuk-tes-saja-0123456789';
const {
  pool, dbReady, inRolledBackTransaction, makeUser, departmentId, shutdown,
} = require('./fixtures/gaDb');

const B = '../src';
const { permissionsForStandardRole } = require(`${B}/config/standardOrganization`);
const briefing = require(`${B}/services/morningBriefing.service`);
const { memo, invalidateFigures } = require(`${B}/utils/memo`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const tasks = require(`${B}/services/task.service`);
const approvalRead = require(`${B}/services/approvalRead.service`);
const workSummary = require(`${B}/controllers/workSummary.controller`);
const salesActions = require(`${B}/services/salesActions.service`);
const salesSource = require(`${B}/services/salesSource`);
const warehouseDocuments = require(`${B}/services/warehouseDocuments.service`);
const procurementOrders = require(`${B}/services/procurementOrders.service`);
const receivables = require(`${B}/services/financeReceivables.service`);
const gaOps = require(`${B}/services/gaOps.service`);
const escalation = require(`${B}/services/escalation.service`);
const targets = require(`${B}/services/targets.service`);
const batches = require(`${B}/services/salesAccurateBatches.service`);
const notification = require(`${B}/services/notification.service`);
const auth = require(`${B}/controllers/auth.controller`);
const authRoutes = require(`${B}/routes/auth.routes`);
const validate = require(`${B}/middleware/validate`);

test.after(() => shutdown());
const DB_TEST = { timeout: 90000 };
const SKIP = 'butuh database lokal dengan skema terbaru';
const tool = (name) => agentTools.byName.get(name);
const MONEY = /\b(?:Rp|IDR)\.?\s*-?\d/;
const BAIT = 'Rp 987.654.321';

const NOW = Date.parse('2026-10-02T02:00:00Z'); // 09:00 WIB
const userOf = (roleKey, { sub = 15, departmentId: dept = 5 } = {}) => ({
  sub, entityId: 7, departmentId: dept, email: 'uji@example.invalid', permissions: permissionsForStandardRole(roleKey),
});

// Every module service the briefing reads, answered from one fixture; `asked`
// records who asked what (the user object is what scopes the real services).
function mockServices(t, overrides = {}) {
  const asked = [];
  const data = {
    taskCounts: { open: 6, overdue: 2, dueSoon: 3, dueToday: 1, done: 9 },
    approvals: { total: 2, complete: true, items: [
      { id: 8, title: `Pembayaran ${BAIT} vendor`, createdAt: new Date(NOW - 50 * 3600000), page: '/finance/payment-requests/3' },
      { id: 9, title: 'Data Accurate — Sales (3 perubahan)', createdAt: new Date(NOW - 3600000), page: '/data-accurate/41' },
    ] },
    cards: [
      { key: 'finance_approval', group: 'action', title: 'Pembayaran menunggu persetujuan Anda', count: 1, to: '/finance/payment-requests', items: [] },
      { key: 'signatures', group: 'action', title: 'Dokumen menunggu tanda tangan Anda', count: 1, to: '/signatures', items: [{ id: 1, title: 'Kontrak Uji', meta: 'Siap ditandatangani', to: '/signatures/1' }] },
      { key: 'finance_revise', group: 'action', title: 'Pengajuan pembayaran Anda yang perlu dilengkapi', count: 1, to: '/finance/payment-requests', items: [{ id: 2, title: 'PR-0002', meta: 'Perlu revisi', to: '/finance/payment-requests/2' }] },
      { key: 'it_mine', group: 'mine', title: 'Tiket IT saya yang masih berjalan', count: 4, to: '/it/tickets', items: [] },
      { key: 'finance_queue', group: 'team', title: 'Antrean pembayaran untuk diproses', count: 5, to: '/finance/payment-requests', items: [] },
    ],
    salesCounts: { dormant: 12, no_do: 3, overdue: 2, leads: 40 },
    warehouse: { attention: { inTransit: 2, stuckTransfers: 1, stockMinus: 4, soDue: 6 } },
    procurement: { attention: { late: 2, dueSoon: 5, noExpectedDate: 0, legacy: 0 }, expected: [{ number: 'PO.2026.10.00001' }] },
    receivables: { overdue: { invoices: 9, amount: 123456789 } },
    ga: { maintenanceOverdue: 1, contractsEnding: 2, billsOverdue: 3 },
    it: { perangkat: { bermasalah: 2 }, langganan_software: { perpanjangan_dalam_30_hari: [{ produk: 'Software Uji', rute: '/it/subscriptions/4' }] } },
    escalations: { totals: { open: 7 }, items: [{ title: `Faktur ${BAIT} terlambat`, severity: 'high', link: '/sales/customers/1' }] },
    targets: {
      metrics: [{ key: 'sales.revenue', label: 'Omzet (DPP)' }, { key: 'sales.visits', label: 'Kunjungan' }],
      cells: [{ metricKey: 'sales.revenue', target: 100, status: 'off_track' }, { metricKey: 'sales.visits', target: 10, status: 'on_track' }, { metricKey: 'sales.visits', target: null, status: 'off_track' }],
    },
    batches: { items: [{ id: 41, departmentId: 5, departmentName: 'Sales', status: 'pending', itemCount: 3, summary: { counts: {} }, approvalRequestId: 9, createdAt: new Date(NOW - 30 * 3600000) }], total: 1 },
    deciders: [15],
    ...overrides,
  };
  t.mock.method(tasks, 'listTasksForUser', async ({ user, filters }) => {
    asked.push(['tasks', user.sub, filters.mine, filters.state]);
    return { counts: data.taskCounts, total: 2, rows: [{ id: 5, title: `Tugas ${BAIT}`, dueDate: new Date('2026-10-02T00:00:00Z') }, { id: 6, title: 'Tugas B', dueDate: new Date('2026-10-05T00:00:00Z') }] };
  });
  t.mock.method(approvalRead, 'pendingForUser', async (user) => { asked.push(['approvals', user.sub]); return data.approvals; });
  t.mock.method(workSummary, 'build', async (user) => { asked.push(['cards', user.sub]); return { cards: data.cards, notifications: { unread: 0, recent: [] } }; });
  t.mock.method(salesSource, 'transactionsReliable', async () => true);
  t.mock.method(salesSource, 'numbersFromAccurate', async () => true);
  t.mock.method(salesActions, 'counts', async (user) => { asked.push(['sales', user.sub, user.permissions.includes('sales.data.view_all')]); return { counts: data.salesCounts, badge: 17 }; });
  t.mock.method(salesActions, 'list', async (user, type) => ({ items: [{ title: `${type}-contoh`, amount: 5000000 }], total: 1, page: 1, limit: 3 }));
  t.mock.method(warehouseDocuments, 'today', async (entityId) => { asked.push(['warehouse', entityId]); return { date: '2026-10-02', totals: { deliveries: 0, receipts: 0 }, incomingPos: [], deliveries: [], receipts: [], ...data.warehouse }; });
  t.mock.method(procurementOrders, 'today', async (entityId) => { asked.push(['procurement', entityId]); return { date: '2026-10-02', arrivals: [], ...data.procurement }; });
  t.mock.method(procurementOrders, 'status', async () => ({ ready: true }));
  t.mock.method(receivables, 'status', async () => ({ ready: true, asOf: null }));
  t.mock.method(receivables, 'summary', async (entityId) => { asked.push(['receivables', entityId]); return data.receivables; });
  t.mock.method(gaOps, 'readFor', async (user, key = null) => { if (key) return []; asked.push(['ga', user.sub]); return data.ga; });
  const get = agentTools.byName.get.bind(agentTools.byName);
  t.mock.method(agentTools.byName, 'get', (name) => (name === 'ringkasan_it'
    ? { run: async (user) => { asked.push(['it', user.sub]); return data.it; } } : get(name)));
  t.mock.method(escalation, 'list', async (entityId, options) => {
    asked.push(['escalations', entityId, options.departmentId, options.status]);
    return { scope: { entityWide: options.departmentId == null, departmentName: 'Sales' }, sources: [], totals: { all: 9, open: data.escalations.totals.open, acknowledged: 1, resolved: 1, bySource: {} }, items: data.escalations.items };
  });
  t.mock.method(targets, 'list', async (entityId, options) => {
    asked.push(['targets', entityId, options.departmentId, options.permissions.includes('procurement.price.view')]);
    return { ...data.targets, divisions: [], restricted: [], period: { key: '2026-Q4', ended: false }, scope: {} };
  });
  t.mock.method(batches, 'listBatches', async (user, options) => { asked.push(['batches', user.sub, options.status]); return data.batches; });
  t.mock.method(batches, 'deciderIds', async () => data.deciders);
  return { asked, data };
}

const keys = (out) => out.items.map((i) => i.key);
const count = (out, key) => out.items.find((i) => i.key === key)?.count;

test('a Sales Member gets their own work and Sales rows — nothing of management, money, batches or other modules', async (t) => {
  const { asked } = mockServices(t);
  const user = userOf('sales.member');
  const out = await briefing.compute(user, { now: NOW });
  assert.deepEqual(out.tertunda, []);
  assert.deepEqual(out.gagal, []);
  // The services are asked as this very user: their own-data rule (a member's own customers) applies.
  assert.ok(asked.some((a) => a[0] === 'sales' && a[1] === 15 && a[2] === false), 'salesActions is asked as the member, without view_all');
  assert.ok(asked.filter((a) => a[0] === 'tasks').every((a) => a[2] === true), 'only my own tasks');
  for (const part of ['warehouse', 'procurement', 'receivables', 'escalations', 'targets', 'batches', 'it', 'ga']) {
    assert.ok(!asked.some((a) => a[0] === part), `${part} is not read for a Sales Member`);
  }
  assert.ok(keys(out).includes('sales_dormant') && keys(out).includes('sales_leads'));
  assert.equal(count(out, 'sales_dormant'), 12);
  assert.ok(!keys(out).some((k) => /^(warehouse|procurement|finance_receivables|escalations|targets|accurate|ga_|it_)/.test(k)));
  assert.doesNotMatch(JSON.stringify(out), MONEY, 'no rupiah anywhere, not even inside a title');
});

test('a Warehouse Member gets warehouse rows only: no sales, no receivables, no rupiah', async (t) => {
  const { asked } = mockServices(t);
  const out = await briefing.compute(userOf('warehouse.member', { departmentId: 6 }), { now: NOW });
  assert.ok(asked.some((a) => a[0] === 'warehouse' && a[1] === 7), 'bound to the company');
  for (const part of ['sales', 'receivables', 'escalations', 'targets', 'batches']) assert.ok(!asked.some((a) => a[0] === part), part);
  assert.deepEqual(keys(out).filter((k) => k.startsWith('warehouse_')).sort(), ['warehouse_so_due', 'warehouse_stock_minus', 'warehouse_transfers_stuck']);
  assert.ok(!keys(out).some((k) => /^(sales_|finance_receivables|escalations|targets|accurate)/.test(k)));
  assert.doesNotMatch(JSON.stringify(out), MONEY);
});

test('a division Head gets the division\'s escalations, targets off track and the batches they decide, with age', async (t) => {
  const { asked } = mockServices(t);
  const out = await briefing.compute(userOf('sales.head'), { now: NOW });
  assert.deepEqual(asked.find((a) => a[0] === 'escalations'), ['escalations', 7, 5, 'open'], 'own division only, open ones');
  assert.deepEqual(asked.find((a) => a[0] === 'targets').slice(0, 3), ['targets', 7, 5]);
  assert.equal(asked.find((a) => a[0] === 'targets')[3], false, 'purchase-price metrics stay restricted');
  assert.equal(count(out, 'escalations_open'), 7);
  assert.equal(count(out, 'targets_off_track'), 1, 'only cells with a target that are off track');
  const batch = out.items.find((i) => i.key === 'accurate_batches_waiting');
  assert.deepEqual([batch.count, batch.ageHours, batch.severity, batch.route], [1, 30, 'danger', '/data-accurate/41']);
  assert.equal(batch.counted, false, 'a batch is an approval request too: not counted twice in the headline');
  const approvals = out.items.find((i) => i.key === 'approvals_waiting');
  assert.deepEqual([approvals.count, approvals.ageHours, approvals.severity], [2, 50, 'danger']);
  assert.ok(!keys(out).includes('finance_approval'), 'a "menunggu persetujuan Anda" card is inside the approvals row');
  assert.ok(!keys(out).includes('it_mine'), 'my own running requests need nothing from me');
  assert.doesNotMatch(JSON.stringify(out), MONEY);

  // Without a division nothing of management is read; management_dashboard.view reads the company.
  const before = asked.length;
  await briefing.compute({ ...userOf('sales.head'), departmentId: null }, { now: NOW });
  assert.ok(!asked.slice(before).some((a) => a[0] === 'escalations'));
  await briefing.compute({ ...userOf('management_office.head') }, { now: NOW });
  assert.equal(asked.filter((a) => a[0] === 'escalations').pop()[2], null);
});

test('order and headline are deterministic: what is late and what waits for a decision first', async (t) => {
  mockServices(t);
  const user = userOf('sales.head');
  const out = await briefing.compute(user, { now: NOW });
  const again = await briefing.compute(user, { now: NOW });
  assert.deepEqual(keys(out), keys(again));
  assert.deepEqual(keys(out).slice(0, 3), ['tasks_overdue', 'approvals_waiting', 'accurate_batches_waiting']);
  const groups = out.items.map((i) => i.group);
  assert.deepEqual(groups, [...groups].sort((a, b) => ['action', 'attention', 'upcoming'].indexOf(a) - ['action', 'attention', 'upcoming'].indexOf(b)));
  // 2 overdue + 2 approvals + 1 due today + 1 signature + 1 revision = 7
  assert.equal(out.headline.total, 7);
  assert.equal(out.headline.lead, '7 hal perlu Anda tindak hari ini');
  assert.equal(out.headline.text, '7 hal perlu Anda tindak hari ini: 2 tugas lewat tenggat, 2 persetujuan menunggu, 1 tugas jatuh tempo hari ini, 1 dokumen menunggu tanda tangan');
  assert.equal(out.allClear, false);
  for (const item of out.items) {
    assert.ok(item.examples.length <= 3 && item.count > 0 && item.route.startsWith('/'), item.key);
    assert.ok(['danger', 'warning', 'info'].includes(item.severity));
    assert.equal('phrase' in item, false);
  }
  assert.deepEqual(out.items.find((i) => i.key === 'targets_off_track').examples, [{ title: 'Omzet (DPP)', translate: true }]);
});

test('all clear: nothing waits, nothing to watch', async (t) => {
  mockServices(t, {
    taskCounts: { open: 0, overdue: 0, dueSoon: 0, dueToday: 0, done: 3 }, approvals: { total: 0, complete: true, items: [] }, cards: [],
    salesCounts: { dormant: 0, no_do: 0, overdue: 0, leads: 0 }, escalations: { totals: { open: 0 }, items: [] }, targets: { metrics: [], cells: [] }, batches: { items: [], total: 0 },
  });
  const out = await briefing.compute(userOf('sales.head'), { now: NOW });
  assert.deepEqual(out.items, []);
  assert.equal(out.allClear, true);
  assert.equal(out.headline.text, 'Semua beres. Tidak ada yang perlu Anda tindak hari ini');
  assert.equal(out.headline.total, 0);
});

test('the same numbers as the tools that answer the same question', async (t) => {
  mockServices(t);
  const head = { ...userOf('sales.head'), permissions: [...permissionsForStandardRole('sales.head'), 'warehouse.stock.view', 'procurement.view', 'ga.ops.view'] };
  const out = await briefing.compute(head, { now: NOW });
  const mine = await tool('tugas_saya').run(head, { status: 'aktif' });
  assert.deepEqual([count(out, 'tasks_overdue'), count(out, 'tasks_due_week')], [mine.ringkasan.terlambat, mine.ringkasan.jatuh_tempo_7_hari]);
  assert.equal(count(out, 'approvals_waiting'), (await tool('persetujuan_menunggu_saya').run(head, {})).total_menunggu);
  const sales = (await tool('sales_perlu_tindakan').run(head, {})).ringkasan;
  assert.deepEqual([count(out, 'sales_dormant'), count(out, 'sales_not_shipped'), count(out, 'sales_overdue_invoices'), count(out, 'sales_leads')],
    [sales.customer_dormant, sales.so_belum_terkirim, sales.tagihan_terlambat, sales.lead_perlu_dikunjungi]);
  assert.equal(count(out, 'escalations_open'), (await tool('eskalasi_terbuka').run(head, {})).ringkasan_semua_sumber.terbuka);
  const gudang = (await tool('gudang_hari_ini').run(head, {})).perlu_perhatian;
  assert.deepEqual([count(out, 'warehouse_so_due'), count(out, 'warehouse_stock_minus'), count(out, 'warehouse_transfers_stuck')],
    [gudang.so_jadwal_kirim_sampai_hari_ini, gudang.barang_stok_minus, gudang.pindah_gudang_belum_diterima_3_hari]);
  const po = (await tool('procurement_hari_ini').run(head, {})).perlu_perhatian;
  assert.deepEqual([count(out, 'procurement_po_late'), count(out, 'procurement_po_week')], [po.po_terlambat, po.jatuh_tempo_7_hari]);
  const ga = (await tool('operasional_ga').run(head, {})).ringkasan;
  assert.deepEqual([count(out, 'ga_bills_overdue'), count(out, 'ga_maintenance_overdue'), count(out, 'ga_contracts_ending')],
    [ga.tagihan_lewat_jatuh_tempo, ga.perawatan_lewat_jadwal, ga.kontrak_segera_berakhir]);
  const batchList = await tool('batch_data_accurate').run(head, {});
  assert.equal(count(out, 'accurate_batches_waiting'), batchList.batch.filter((b) => b.anda_bisa_memutuskan).length);
});

test('pekerjaan_saya_hari_ini returns the card\'s own briefing: same ids, counts and order', async (t) => {
  mockServices(t);
  const user = userOf('sales.head');
  const card = await briefing.compute(user, { now: Date.now() });
  const out = await tool('pekerjaan_saya_hari_ini').run(user, {});
  assert.deepEqual(out.ringkasan_pagi.butir.map((b) => [b.id, b.jumlah]), card.items.map((i) => [i.key, i.count]));
  assert.equal(out.ringkasan_pagi.judul, card.headline.text);
  assert.equal(out.ringkasan_pagi.jumlah_perlu_ditindak, card.headline.total);
  assert.deepEqual(out.ringkasan_pagi.butir.map((b) => b.rute), card.items.map((i) => i.route));
  assert.deepEqual(out.ringkasan_pagi.butir[0].contoh, card.items[0].examples.map((e) => e.title));
  assert.doesNotMatch(JSON.stringify(out.ringkasan_pagi), MONEY);
});

test('cached per user for five minutes, one computation for concurrent callers, dropped by writes', async (t) => {
  const { asked } = mockServices(t);
  memo.setEnabled(true);
  t.after(() => { memo.setEnabled(null); memo.clear(); });
  memo.clear();
  const user = userOf('sales.member');
  const builds = () => asked.filter((a) => a[0] === 'cards').length;
  const [a, b] = await Promise.all([briefing.build(user), briefing.build(user)]);
  assert.equal(a, b, 'concurrent callers share one computation');
  assert.equal(builds(), 1);
  const meta = {};
  await briefing.build(user, meta);
  assert.equal(meta.outcome, 'hit');
  assert.equal(builds(), 1);
  // Another user never gets this one's answer.
  await briefing.build({ ...user, sub: 16 });
  assert.equal(builds(), 2);
  // A module write (routes/index.js `writes`), an approved Accurate batch, or the service's own call drops it.
  briefing.invalidate();
  await briefing.build(user);
  assert.equal(builds(), 3);
  invalidateFigures();
  await briefing.build(user);
  assert.equal(builds(), 4);
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/index.js'), 'utf8');
  assert.match(routes, /const MANAGEMENT = \[[^\]]*'brief:'/, 'every module write drops the briefings');
  assert.match(routes, /'\/signatures', invalidateOnWrite\('brief:'\)/);
  assert.equal(briefing.CACHE_TTL_MS, 5 * 60 * 1000);
});

test('time budget: a hanging section is skipped and named, the rest is returned', async () => {
  const hang = { name: 'Lambat', allowed: () => true, run: () => new Promise(() => {}) };
  const boom = { name: 'Rusak', allowed: () => true, run: async () => { throw new Error('boom'); } };
  const fast = { name: 'Cepat', allowed: () => true, run: async () => [{ key: 'x', label: 'X', count: 2, severity: 'warning', group: 'action', counted: true, route: '/tasks', examples: [], phrase: '2 hal' }] };
  const denied = { name: 'Terlarang', allowed: () => false, run: async () => { throw new Error('never'); } };
  const started = Date.now();
  const out = await briefing.compute(userOf('sales.member'), { sections: [hang, boom, fast, denied], budget: 200 });
  assert.ok(Date.now() - started < 1500, 'the page never waits for a slow section');
  assert.deepEqual(out.tertunda, ['Lambat']);
  assert.deepEqual(out.gagal, ['Rusak']);
  assert.deepEqual(keys(out), ['x']);
  assert.equal(out.allClear, false);
  // A partial answer is not kept for five minutes.
  assert.ok(briefing.PARTIAL_TTL_MS < briefing.CACHE_TTL_MS);
});

test('the briefing never notifies, never mails, never writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/morningBriefing.service.js'), 'utf8');
  // Everything the file can reach: its requires. Read services and helpers only.
  const required = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(required.sort(), [
    '../controllers/workSummary.controller', '../utils/logger', '../utils/mapLimit', '../utils/memo', '../utils/wibTime',
    './ai/agent/agentTools', './approvalRead.service', './escalation.service', './financeReceivables.service', './gaOps.service',
    './procurementOrders.service', './salesAccurateBatches.service', './salesActions.service', './salesSource', './targets.service',
    './task.service', './warehouseDocuments.service',
  ]);
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /notif\w*\.|notification\.service|mail|chat\b|\.create\(|\.send\(/i, 'no notification, no email, no chat message');
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE)\b|pool\.query/, 'no SQL of its own: only through the module services');
  assert.doesNotMatch(code, /runModule|provider/, 'no model');
});

test('GET /work-summary/briefing is the signed-in user\'s own briefing', async (t) => {
  mockServices(t);
  const router = require(`${B}/routes/workSummary.routes`);
  const layer = router.stack.find((l) => l.route && l.route.path === '/briefing' && l.route.methods.get);
  assert.ok(layer, 'registered');
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await workSummary.briefing({ user: userOf('sales.member') }, res, (e) => { throw e; });
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data.items) && res.body.data.headline.text);
});

test('preference: the card can be hidden from Akun saya, for the session\'s own account only', async (t) => {
  const run = (body) => {
    const r = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    validate(authRoutes.schemas.preferences)({ body }, r, () => { passed = true; });
    return passed;
  };
  assert.equal(run({ morningBriefing: false }), true);
  assert.equal(run({ morningBriefing: true, language: 'en' }), true);
  for (const body of [{}, { morningBriefing: 'no' }, { morningBriefing: false, userId: 3 }]) assert.equal(run(body), false, JSON.stringify(body));
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => { writes.push({ sql: String(sql), args }); return [{ affectedRows: 1 }]; });
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await auth.updatePreferences({ user: { sub: 5 }, body: { morningBriefing: false, userId: 99 } }, res, (e) => { throw e; });
  assert.deepEqual(res.body.data, { morningBriefing: false });
  assert.match(writes[0].sql, /^UPDATE users SET morning_briefing = \? WHERE id = \?/);
  assert.deepEqual(writes[0].args, [0, 5]);
});

// ---------------------------------------------------------------- real services

test('real services: three roles read only what is theirs, with SELECTs only and nothing sent', DB_TEST, async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  const sent = t.mock.method(notification, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const member = await makeUser(conn, { name: 'AI Brief Sales Member', division: 'sales', roles: ['sales.member'] });
    const warehouse = await makeUser(conn, { name: 'AI Brief WH Member', division: 'warehouse', roles: ['warehouse.member'] });
    const head = await makeUser(conn, { name: 'AI Brief Sales Head', division: 'sales', roles: ['sales.head'] });
    const sales = await departmentId(conn, 'sales');
    const [[before]] = await conn.query('SELECT (SELECT COUNT(*) FROM notifications) AS n, (SELECT COUNT(*) FROM activity_logs) AS a');
    const statements = [];
    const original = conn.query.bind(conn);
    conn.query = (...args) => { statements.push(String(typeof args[0] === 'string' ? args[0] : args[0]?.sql)); return original(...args); };
    let outs;
    try {
      outs = {
        member: await briefing.compute(member.user),
        warehouse: await briefing.compute(warehouse.user),
        head: await briefing.compute(head.user),
      };
    } finally { delete conn.query; }
    const written = statements.filter((s) => !/^\s*(SELECT|SHOW|\(SELECT|WITH)\b/i.test(s));
    assert.deepEqual(written, [], 'the briefing only reads');
    for (const [who, out] of Object.entries(outs)) {
      assert.deepEqual(out.gagal, [], `${who}: no section failed`);
      assert.doesNotMatch(JSON.stringify(out), MONEY, `${who}: no rupiah`);
      for (const item of out.items) assert.ok(item.examples.length <= 3 && item.route.startsWith('/'), `${who} ${item.key}`);
    }
    // A brand-new member owns no customer: no Sales figure of anyone else reaches them.
    assert.ok(!keys(outs.member).some((k) => /^(sales_dormant|sales_overdue_invoices|sales_not_shipped)$/.test(k)), 'a member sees only their own customers');
    assert.ok(!keys(outs.member).some((k) => /^(escalations|targets|accurate|warehouse_|finance_receivables)/.test(k)));
    assert.ok(!keys(outs.warehouse).some((k) => /^(sales_|escalations|targets|finance_receivables|accurate)/.test(k)));
    // The head's escalations are the division's: the same number the tool gives.
    const queue = await tool('eskalasi_terbuka').run(head.user, {});
    assert.equal(count(outs.head, 'escalations_open') || 0, queue.ringkasan_semua_sumber.terbuka);
    assert.match(queue.cakupan, /^divisi /);
    assert.ok(sales);
    const [[after]] = await conn.query('SELECT (SELECT COUNT(*) FROM notifications) AS n, (SELECT COUNT(*) FROM activity_logs) AS a');
    assert.deepEqual([Number(after.n), Number(after.a)], [Number(before.n), Number(before.a)], 'no notification and no log row');
  });
  assert.equal(sent.mock.callCount(), 0, 'nothing is sent');
});
