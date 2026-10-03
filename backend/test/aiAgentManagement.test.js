// Prakasa AI reads the home page, the search and the management pages (Wave B):
// tools/home.js and tools/management.js. The services are mocked for the
// shape, money and scope rules; the last tests run the real services against
// the local schema inside a transaction that is always rolled back.
const test = require('node:test');
const assert = require('node:assert/strict');

// First: the fixture loads backend/.env before the pool is created.
const {
  pool, dbReady, inRolledBackTransaction, makeUser, departmentId, shutdown,
} = require('./fixtures/gaDb');

const B = '../src';
const { STANDARD_ROLES } = require(`${B}/config/standardOrganization`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const contract = require(`${B}/services/ai/agent/toolContract`);
const { MONEY_KEY, PERSONAL_KEY } = require(`${B}/services/ai/agent/outputGuard`);
const registry = require(`${B}/services/aiToolRegistry.service`);
const divisionDashboard = require(`${B}/services/divisionDashboard.service`);
const escalation = require(`${B}/services/escalation.service`);
const targets = require(`${B}/services/targets.service`);
const roadmap = require(`${B}/services/roadmap.service`);
const globalSearch = require(`${B}/services/globalSearch.service`);
const taskService = require(`${B}/services/task.service`);
const approvalRead = require(`${B}/services/approvalRead.service`);
const workSummaryPage = require(`${B}/controllers/workSummary.controller`);
const morningBriefing = require('../src/services/morningBriefing.service');
// The morning briefing has its own tests (morningBriefing.test.js): here it is switched off,
// so these tests keep checking the calls the home tool makes itself.
const NO_BRIEFING = { headline: { text: 'Semua beres', total: 0, parts: [] }, allClear: true, items: [], tertunda: [], gagal: [] };
const notification = require(`${B}/services/notification.service`);

// Closes the pool and any gate a cancelled test left waiting: the file always ends.
test.after(() => shutdown());
// A database test that cannot finish in this time fails by itself instead of hanging the run.
const DB_TEST = { timeout: 90000 };

const SKIP = 'butuh database lokal dengan skema terbaru';
const HOME = ['pekerjaan_saya_hari_ini', 'pencarian_global'];
const MANAGEMENT = ['dashboard_divisi', 'angka_rupiah_divisi', 'eskalasi_terbuka', 'target_realisasi', 'target_realisasi_rupiah', 'peta_program'];
const MINE = [...HOME, ...MANAGEMENT];
const MONEY_TOOLS = ['angka_rupiah_divisi', 'target_realisasi_rupiah'];
const tool = (name) => agentTools.byName.get(name);
const permsOf = (key) => STANDARD_ROLES.find((r) => r.key === key).permissions;
const MONEY = 987654321;
const BAIT = 'Rp 987.654.321';

// Every key of a result, at any depth.
function keysOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) { out.push(k); keysOf(v, out); }
  }
  return out;
}
const noMoney = (out, label) => {
  const json = JSON.stringify(out);
  assert.ok(!json.includes(String(MONEY)), `${label} leaked a rupiah figure`);
  assert.ok(!/Rp\s?\d|IDR\s?\d|987\.654/.test(json), `${label} leaked a rupiah text`);
  assert.deepEqual(keysOf(out).filter((k) => MONEY_KEY.test(k)), [], `${label} has a money key`);
};
const forbidden = (e) => e.status === 403 && e.code === 'FORBIDDEN';

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ key: `2026-${String(i + 1).padStart(2, '0')}`, label: `B${i + 1}`, partial: i === 11 }));
const series = (v) => MONTHS.map((_, i) => (i === 11 ? v : v - 1));
const DIVISIONS = [{ id: 5, name: 'Sales', code: 'sales' }, { id: 9, name: 'Warehouse', code: 'warehouse' }];

// What divisionDashboard.build answers, with rupiah bait in every place a figure can sit.
function fakeDashboard(division) {
  return {
    division,
    divisions: [],
    months: MONTHS,
    kpis: [
      { provider: 'sales', providerLabel: 'Sales & Pelanggan', key: 'active_customers', label: 'Pelanggan aktif', unit: 'item', value: 42, sub: '14 dormant', alert: true, restricted: false, error: false },
      { provider: 'sales', providerLabel: 'Sales & Pelanggan', key: 'revenue_this_month', label: 'Omzet bulan ini', unit: 'rupiah', value: MONEY, sub: '3 faktur', alert: false, restricted: false, error: false },
      { provider: 'finance', providerLabel: 'Finance', key: 'finance_pending', label: 'Pembayaran menunggu', unit: 'item', value: 2, sub: `${BAIT} menunggu`, alert: false, restricted: false, error: false },
      { provider: 'procurement', providerLabel: 'Procurement', key: 'procurement_po_value_month', label: 'Nilai PO bulan ini', unit: 'rupiah', value: null, sub: 'Hanya untuk yang berwenang melihat harga beli', alert: false, restricted: true, error: false },
    ],
    metrics: [
      { provider: 'sales', providerLabel: 'Sales & Pelanggan', key: 'sales_orders', label: 'Jumlah sales order', unit: 'item', better: 'higher', cumulative: true, averaged: false, billedMonthly: false, values: series(76), targets: series(80) },
      { provider: 'sales', providerLabel: 'Sales & Pelanggan', key: 'sales_revenue', label: 'Omzet (sebelum PPN)', unit: 'rupiah', better: 'higher', cumulative: true, averaged: false, billedMonthly: true, values: [...series(MONEY).slice(0, -1), null], targets: series(MONEY) },
    ],
    escalations: {
      total: 1,
      bySource: [{ key: 'sales_invoice_overdue', label: 'Faktur terlambat', count: 1 }],
      top: [{ source: 'sales_invoice_overdue', sourceLabel: 'Faktur terlambat', title: 'Toko Uji', reference: 'SI.1', context: `Sisa tagihan ${BAIT}`, daysLate: 40, severity: 'high', link: '/sales/customers/1' }],
    },
    generatedAt: '2026-10-02T00:00:00.000Z',
  };
}

function mockDashboard(t) {
  const calls = [];
  t.mock.method(divisionDashboard, 'listDivisions', async (user) => (
    (user.permissions || []).includes('management_dashboard.view') ? DIVISIONS : DIVISIONS.filter((d) => d.id === Number(user.departmentId))));
  t.mock.method(divisionDashboard, 'build', async (user, { division }) => {
    calls.push({ permissions: user.permissions, division });
    const picked = division === 'all' ? { id: null, name: 'Seluruh perusahaan', code: 'all' }
      : DIVISIONS.find((d) => d.id === Number(division ?? user.departmentId));
    return fakeDashboard(picked);
  });
  return calls;
}

test('the home and management tools are registered, serve their pages and keep the contract', () => {
  const moduleKeys = new Set(registry.TOOLS.map((entry) => entry.key));
  const mine = MINE.map(tool);
  assert.ok(mine.every(Boolean), 'every tool is loaded');
  assert.deepEqual(contract.validateTools(mine, { moduleKeys }), []);
  const served = new Set(mine.flatMap((x) => x.module));
  for (const key of ['dashboard', 'search', 'division-dashboard', 'escalations', 'roadmap', 'targets', 'management']) assert.ok(served.has(key), key);
  assert.equal(served.has('management-flow'), false, 'Alur & margin stays without a tool');
  for (const x of mine) {
    assert.equal(x.privateOnly, true, `${x.name} reads division or own data`);
    assert.equal(Boolean(x.money), MONEY_TOOLS.includes(x.name), x.name);
    assert.equal(x.public, undefined, x.name);
    assert.ok(['home.js', 'management.js'].includes(x.file));
  }
});

test('the management tools never touch the Alur & margin service or a purchase-price view', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['home.js', 'management.js']) {
    const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, file), 'utf8');
    assert.doesNotMatch(code, /require\([^)]*(managementFlow|flowRules|margin|slowMovers)/i, file);
    assert.doesNotMatch(code, /pc_po_price/i, file);
    assert.doesNotMatch(code, /db\/pool/, file);
  }
});

test('role matrix: members get the home and the search only; supervisors the division dashboard; heads the management pages', () => {
  const names = (key, session = { visibility: 'private' }) => agentTools.toolsFor({ permissions: permsOf(key) }, session).map((x) => x.name).filter((n) => MINE.includes(n));
  assert.deepEqual(names('sales.member'), HOME);
  assert.deepEqual(names('sales.supervisor'), [...HOME, 'dashboard_divisi', 'angka_rupiah_divisi']);
  assert.deepEqual(names('sales.head'), MINE);
  assert.deepEqual(names('management_office.member'), HOME);
  assert.deepEqual(names('management_office.supervisor'), MINE);
  // A shared conversation, or one with web research, gets none of them — the money tools least of all.
  for (const session of [{ visibility: 'department' }, { visibility: 'entity' }, { visibility: 'private', web_research: 1 }, null]) {
    assert.deepEqual(names('management_office.head', session), [], JSON.stringify(session));
  }
});

test('a user without the permission is refused inside run(), before any service is asked', async (t) => {
  const asked = [];
  for (const [service, method] of [[divisionDashboard, 'build'], [divisionDashboard, 'listDivisions'], [escalation, 'list'], [targets, 'list'], [roadmap, 'get'],
    [globalSearch, 'search'], [workSummaryPage, 'build'], [taskService, 'listTasksForUser'], [approvalRead, 'pendingForUser']]) {
    t.mock.method(service, method, async () => { asked.push(method); return {}; });
  }
  const member = { sub: 1, entityId: 7, departmentId: 5, permissions: ['task.view', 'approval.view'] };
  for (const name of MINE) await assert.rejects(tool(name).run(member, { kata_kunci: 'uji' }), forbidden, name);
  // The division dashboard alone does not open Pusat Eskalasi, targets or the roadmap.
  const supervisor = { ...member, permissions: ['division_dashboard.view'] };
  for (const name of ['eskalasi_terbuka', 'target_realisasi', 'target_realisasi_rupiah', 'peta_program']) await assert.rejects(tool(name).run(supervisor, {}), forbidden, name);
  assert.deepEqual(asked, []);
});

test('division dashboard: no rupiah without the money tool, purchase prices restricted for everyone, own division only', async (t) => {
  const calls = mockDashboard(t);
  const supervisor = { sub: 1, entityId: 7, departmentId: 5, permissions: ['division_dashboard.view', 'procurement.price.view'] };

  const out = await tool('dashboard_divisi').run(supervisor, { metrik: 'sales order' });
  noMoney(out, 'dashboard_divisi');
  assert.equal(out.divisi, 'Sales');
  assert.equal(out.rute, '/division-dashboard?division=5');
  assert.deepEqual(out.angka_kunci.map((k) => k.kunci), ['active_customers', 'finance_pending']);
  assert.equal(out.angka_kunci[1].angka, 2);
  assert.equal(out.angka_kunci[1].keterangan, '(nilai rupiah tidak ditampilkan) menunggu');
  assert.deepEqual(out.metrik.map((m) => m.kunci), ['sales_orders']);
  assert.deepEqual([out.metrik[0].bulan_ini, out.metrik[0].bulan_lalu, out.metrik[0].target_bulan_ini], [76, 75, 80]);
  assert.equal(out.jumlah_angka_uang_tidak_ditampilkan, 3);
  assert.equal(out.tren.kunci, 'sales_orders');
  assert.equal(out.tren.bulan.length, 12);
  assert.deepEqual(out.tren.bulan[11], { bulan: '2026-12', angka: 76, target: 80, berjalan: true });
  assert.equal(out.eskalasi_terbuka.teratas[0].keterangan, 'Sisa tagihan (nilai rupiah tidak ditampilkan)');
  assert.equal(out.eskalasi_terbuka.teratas[0].hari_terlambat, 40);
  // The services never see procurement.price.view: "Nilai PO" is not computed for the AI.
  assert.ok(calls.length > 0 && calls.every((c) => !c.permissions.includes('procurement.price.view')));

  // A rupiah metric's trend is refused by the non-money tool, with a pointer.
  const pointer = await tool('dashboard_divisi').run(supervisor, { metrik: 'omzet' });
  assert.equal('tren' in pointer, false);
  assert.match(pointer.catatan, /angka_rupiah_divisi/);
  noMoney(pointer, 'dashboard_divisi (rupiah metric asked)');

  const money = await tool('angka_rupiah_divisi').run(supervisor, {});
  assert.deepEqual(money.angka_kunci.map((k) => k.kunci), ['revenue_this_month', 'finance_pending', 'procurement_po_value_month']);
  assert.equal(money.angka_kunci[0].nilai_rupiah, MONEY);
  assert.equal(money.angka_kunci[1].keterangan, `${BAIT} menunggu`);
  assert.deepEqual([money.angka_kunci[2].nilai_rupiah, money.angka_kunci[2].dibatasi], [null, true]);
  assert.equal(money.metrik[0].kunci, 'sales_revenue');
  assert.equal(money.metrik[0].ditagih_bulanan, true);
  assert.equal(money.metrik[0].bulan[11].nilai_rupiah, null, 'billed monthly: the running month is unknown, not 0');
  assert.equal(money.metrik[0].bulan[10].nilai_rupiah, MONEY - 1);
  assert.deepEqual(keysOf(money).filter((k) => PERSONAL_KEY.test(k)), []);

  // Another division, or the whole company, is refused for a non-management user.
  for (const divisi of ['Warehouse', 'warehouse', 'semua', 'Divisi Lain']) {
    await assert.rejects(tool('dashboard_divisi').run(supervisor, { divisi }), forbidden, divisi);
    await assert.rejects(tool('angka_rupiah_divisi').run(supervisor, { divisi }), forbidden, divisi);
  }
  assert.equal((await tool('dashboard_divisi').run(supervisor, { divisi: 'sales' })).divisi, 'Sales');

  // Management names any division or the whole company.
  const management = { sub: 2, entityId: 7, departmentId: 7, permissions: ['management_dashboard.view'] };
  calls.length = 0;
  assert.equal((await tool('dashboard_divisi').run(management, { divisi: 'Warehouse' })).divisi, 'Warehouse');
  assert.equal((await tool('dashboard_divisi').run(management, { divisi: 'semua', modul: 'finance' })).angka_kunci.length, 1);
  assert.deepEqual(calls.map((c) => c.division), [9, 'all']);
  const unknown = await tool('dashboard_divisi').run(management, { divisi: 'Tidak Ada' });
  assert.deepEqual(unknown, { divisi_tidak_dikenal: 'Tidak Ada', divisi_tersedia: ['Sales', 'Warehouse'] });
});

function fakeEscalations(count = 3) {
  const items = Array.from({ length: count }, (_, i) => ({
    source: i % 2 ? 'approval_aged' : 'sales_invoice_overdue',
    sourceId: i + 1,
    title: `Uji ${i + 1}`,
    reference: `REF.${i + 1}`,
    context: i % 2 ? 'Menunggu keputusan' : `Sisa tagihan ${BAIT}`,
    departmentId: 5,
    departmentName: 'Sales',
    ownerName: 'Uji Pemilik',
    severity: 'high',
    daysLate: 100 - i,
    since: '2026-06-01T00:00:00.000Z',
    link: i === 0 ? 'https://luar.invalid/x' : `/sales/customers/${i}`,
    followup: i === 1 ? { status: 'acknowledged', ownerName: 'Uji PJ', note: `Janji bayar ${BAIT}`, updatedAt: '2026-09-30T00:00:00.000Z' } : null,
  }));
  return {
    scope: { entityWide: false, departmentId: 5, departmentName: 'Sales' },
    sources: [
      { key: 'sales_invoice_overdue', label: 'Faktur terlambat', provider: 'sales', providerLabel: 'Sales & Pelanggan' },
      { key: 'approval_aged', label: 'Approval tertahan', provider: 'approvals', providerLabel: 'Approval' },
    ],
    totals: { all: count, open: count, acknowledged: 0, resolved: 0, bySource: { sales_invoice_overdue: Math.ceil(count / 2), approval_aged: Math.floor(count / 2) } },
    items,
  };
}

test('escalations: the Head reads only their division, no rupiah in the texts, outside links dropped, list capped', async (t) => {
  const asked = [];
  t.mock.method(divisionDashboard, 'listDivisions', async (user) => (
    (user.permissions || []).includes('management_dashboard.view') ? DIVISIONS : DIVISIONS.filter((d) => d.id === Number(user.departmentId))));
  t.mock.method(escalation, 'list', async (entityId, options) => { asked.push({ entityId, ...options }); return fakeEscalations(60); });
  const head = { sub: 1, entityId: 7, departmentId: 5, permissions: ['management_dashboard.division'] };

  const out = await tool('eskalasi_terbuka').run(head, {});
  noMoney(out, 'eskalasi_terbuka');
  assert.deepEqual(asked[0], { entityId: 7, departmentId: 5, status: 'open', source: null });
  assert.equal(out.cakupan, 'divisi Sales');
  assert.equal(out.total_cocok, 60);
  assert.equal(out.eskalasi.length, 20, 'default 20');
  assert.equal(out.eskalasi[0].rute, null, 'an outside URL never leaves the tool');
  // What opens the follow-up form of each escalation: its source, the source's id, and the route built from them.
  assert.deepEqual([out.eskalasi[0].sumber, out.eskalasi[0].id_sumber, out.eskalasi[0].rute_tindak_lanjut], ['sales_invoice_overdue', 1, '/escalations?ubah=sales_invoice_overdue-1']);
  assert.equal(out.eskalasi[1].rute_tindak_lanjut, '/escalations?ubah=approval_aged-2');
  const formCatalog = require(`${B}/services/ai/agent/formCatalog`);
  assert.equal(formCatalog.byId.get('management-escalation-followup').opens({ pathname: '/escalations', search: 'ubah=approval_aged-2' }), true);
  assert.equal(out.eskalasi[0].hari_terlambat, 100);
  assert.equal(out.eskalasi[0].tingkat, 'tinggi');
  assert.equal(out.eskalasi[0].keterangan, 'Sisa tagihan (nilai rupiah tidak ditampilkan)');
  assert.deepEqual(out.eskalasi[1].tindak_lanjut, { status: 'ditangani', ditangani_oleh: 'Uji PJ', catatan: 'Janji bayar (nilai rupiah tidak ditampilkan)', diperbarui: '2026-09-30T00:00:00.000Z' });
  assert.equal((await tool('eskalasi_terbuka').run(head, { jumlah: 500 })).eskalasi.length, 50, 'never more than 50');
  const perModule = await tool('eskalasi_terbuka').run(head, { modul: 'approval', status: 'semua', sumber: 'approval_aged' });
  assert.ok(perModule.eskalasi.every((i) => i.sumber === 'approval_aged'));
  assert.deepEqual([asked.at(-1).status, asked.at(-1).source], ['all', 'approval_aged']);

  const before = asked.length;
  const unknownSource = await tool('eskalasi_terbuka').run(head, { sumber: 'tidak_ada' });
  assert.equal(unknownSource.sumber_tidak_dikenal, 'tidak_ada');
  assert.ok(unknownSource.sumber_tersedia.length > 0);
  for (const divisi of ['Warehouse', 'semua']) await assert.rejects(tool('eskalasi_terbuka').run(head, { divisi }), forbidden, divisi);
  await assert.rejects(tool('eskalasi_terbuka').run({ ...head, departmentId: null }, {}), forbidden, 'no division: nothing, never everything');
  assert.equal(asked.length, before, 'a refused or unknown request never reaches the service');

  const management = { sub: 2, entityId: 7, departmentId: 7, permissions: ['management_dashboard.view'] };
  await tool('eskalasi_terbuka').run(management, {});
  assert.equal(asked.at(-1).departmentId, null);
  await tool('eskalasi_terbuka').run(management, { divisi: 'warehouse' });
  assert.equal(asked.at(-1).departmentId, 9);
});

function fakeTargets({ departmentId, permissions }) {
  const cell = (metricKey, status, target, actual, extra = {}) => ({
    departmentId: 5, metricKey, target, actual, note: null, updatedAt: null, updatedByName: null, achievementPct: null, pacePct: null, status, ...extra,
  });
  return {
    scope: { entityWide: departmentId == null, departmentId, departmentName: departmentId == null ? null : 'Sales' },
    period: { type: 'quarter', key: '2026-Q4', start: '2026-10-01', end: '2026-12-31', label: 'Kuartal 4 2026 (Okt–Des)', elapsedPct: 2, ended: false },
    metrics: [
      { key: 'sales_orders', label: 'Jumlah sales order', unit: 'item', better: 'higher', cumulative: true, provider: 'sales', providerLabel: 'Sales & Pelanggan' },
      { key: 'sales_revenue', label: 'Omzet (sebelum PPN)', unit: 'rupiah', better: 'higher', cumulative: true, provider: 'sales', providerLabel: 'Sales & Pelanggan' },
      { key: 'rc_marketplace_revenue', label: 'Omzet marketplace', unit: 'rupiah', better: 'higher', cumulative: true, provider: 'retail_commerce', providerLabel: 'Retail Commerce' },
      { key: 'on_time_rate', label: 'Issue tepat waktu', unit: '%', better: 'higher', cumulative: false, provider: 'project_tracker', providerLabel: 'Project Tracker' },
    ],
    restricted: permissions.includes('procurement.price.view') ? [] : [{ key: 'procurement_po_value', label: 'Nilai PO (sebelum PPN)', provider: 'procurement', providerLabel: 'Procurement', reason: 'Hanya untuk yang berwenang melihat harga beli' }],
    divisions: [{ id: 5, name: 'Sales' }],
    cells: [
      cell('sales_orders', 'on_track', 300, 10, { achievementPct: 3.3, pacePct: 150 }),
      cell('sales_revenue', 'off_track', MONEY, MONEY - 5, { achievementPct: 40, pacePct: 60, note: `Naik dari ${BAIT}` }),
      cell('rc_marketplace_revenue', 'billed_monthly', MONEY, 0),
      cell('on_time_rate', 'no_target', null, 88),
    ],
    canEdit: false,
  };
}

test('targets: pace status incl. billed monthly, rupiah only from the money tool, purchase-price metric restricted for everyone', async (t) => {
  const asked = [];
  t.mock.method(divisionDashboard, 'listDivisions', async () => DIVISIONS.slice(0, 1));
  t.mock.method(targets, 'list', async (entityId, options) => { asked.push({ entityId, ...options }); return fakeTargets(options); });
  const head = { sub: 1, entityId: 7, departmentId: 5, permissions: ['management_dashboard.division', 'procurement.price.view'] };

  const out = await tool('target_realisasi').run(head, {});
  noMoney(out, 'target_realisasi');
  assert.deepEqual([asked[0].entityId, asked[0].departmentId, asked[0].period], [7, 5, null]);
  assert.equal(asked[0].permissions.includes('procurement.price.view'), false);
  assert.equal(asked[0].canEdit, undefined, 'the tool never asks for the edit view');
  assert.deepEqual(out.baris.map((r) => [r.metrik, r.status]), [
    ['sales_revenue', 'tertinggal'],
    ['rc_marketplace_revenue', 'ditagih bulanan (belum dinilai selama periode berjalan)'],
    ['sales_orders', 'sesuai jalur'],
  ], 'only cells with a target, the ones behind first');
  const revenue = out.baris[0];
  assert.deepEqual([revenue.pencapaian_persen, revenue.laju_persen, revenue.angka_uang], [40, 60, 'tidak ditampilkan']);
  assert.equal('target' in revenue || 'realisasi' in revenue, false);
  assert.equal(revenue.catatan_target, 'Naik dari (nilai rupiah tidak ditampilkan)');
  assert.deepEqual([out.baris[2].target, out.baris[2].realisasi, out.baris[2].laju_persen], [300, 10, 150]);
  // The ids the target form's route is built from; the route itself only for whoever may set a target.
  assert.deepEqual([out.baris[2].id_divisi, out.baris[2].metrik], [5, 'sales_orders']);
  assert.equal('rute_ubah' in out.baris[2], false, 'a division Head reads targets but does not set them');
  const setter = await tool('target_realisasi').run({ sub: 2, entityId: 7, departmentId: 5, permissions: ['management_dashboard.view'] }, { divisi: 'Sales' });
  assert.equal(setter.baris.find((r) => r.metrik === 'sales_orders').rute_ubah, '/targets?period=2026-Q4&ubah=5-sales_orders');
  noMoney(setter, 'target_realisasi (route)');
  assert.equal(out.metrik_dibatasi[0].nama, 'Nilai PO (sebelum PPN)');
  assert.equal(out.periode.kunci, '2026-Q4');
  assert.match(out.catatan, /target_realisasi_rupiah/);
  assert.equal((await tool('target_realisasi').run(head, { hanya_bertarget: false })).baris.length, 4);
  assert.deepEqual((await tool('target_realisasi').run(head, { status: 'tertinggal', periode: '2026-09' })).baris.map((r) => r.metrik), ['sales_revenue']);
  assert.equal(asked.at(-1).period, '2026-09');

  const money = await tool('target_realisasi_rupiah').run(head, {});
  assert.deepEqual(money.baris.map((r) => r.metrik), ['sales_revenue', 'rc_marketplace_revenue'], 'rupiah metrics only');
  assert.deepEqual([money.baris[0].target_rupiah, money.baris[0].realisasi_rupiah], [MONEY, MONEY - 5]);
  assert.equal(money.baris[1].status, 'ditagih bulanan (belum dinilai selama periode berjalan)');
  assert.equal(asked.at(-1).permissions.includes('procurement.price.view'), false);

  for (const name of ['target_realisasi', 'target_realisasi_rupiah']) {
    await assert.rejects(tool(name).run(head, { divisi: 'Warehouse' }), forbidden, name);
    await assert.rejects(tool(name).run({ ...head, departmentId: null }, {}), forbidden, name);
  }
});

test('roadmap: program status per division, titles and counts only', async (t) => {
  const asked = [];
  t.mock.method(divisionDashboard, 'listDivisions', async () => DIVISIONS.slice(0, 1));
  const project = (id, over = {}) => ({
    id: `project:${id}`, kind: 'project', parentId: null, title: `Program ${id}`, startDate: '2026-09-01', dueDate: '2026-12-31', status: 'in_progress', progressPercent: 50,
    departmentId: 5, departmentName: 'Sales', projectKey: `P${id}`, spaceId: `AAA${id}`, open: 4, inProgress: 2, done: 4, overdue: 0, isFallbackStart: false, isFallbackDue: false, ...over,
  });
  t.mock.method(roadmap, 'get', async (entityId, options) => {
    asked.push({ entityId, ...options });
    return {
      scope: { entityWide: false, departmentId: 5, departmentName: 'Sales' },
      range: { from: '2026-09-01', to: '2026-12-31' },
      items: [
        project(1),
        { ...project(1), id: 'sprint:11', kind: 'sprint', parentId: 'project:1', title: 'Sprint 1', status: 'done' },
        project(2, { overdue: 3, isFallbackDue: true }),
        ...Array.from({ length: 70 }, (_, i) => project(i + 3, { status: 'done', progressPercent: 100 })),
      ],
      links: [],
    };
  });
  const head = { sub: 1, entityId: 7, departmentId: 5, permissions: ['management_dashboard.division'] };
  const out = await tool('peta_program').run(head, { dengan_sprint: true });
  noMoney(out, 'peta_program');
  assert.deepEqual(asked[0], { entityId: 7, departmentId: 5 });
  assert.deepEqual([out.ringkasan.total_program, out.ringkasan.berjalan, out.ringkasan.selesai, out.ringkasan.punya_issue_terlambat], [72, 2, 70, 1]);
  assert.equal(out.program.length, 20);
  assert.equal(out.total_cocok, 72);
  assert.deepEqual([out.program[0].kode, out.program[0].issue_terlambat, out.program[0].tanggal_perkiraan, out.program[0].rute], ['P2', 3, true, '/projects/AAA2']);
  assert.equal(out.program.find((p) => p.kode === 'P1').sprint[0].nama, 'Sprint 1');
  assert.match(out.catatan, /perkiraan/);
  assert.equal((await tool('peta_program').run(head, { jumlah: 999 })).program.length, 50);
  assert.deepEqual((await tool('peta_program').run(head, { hanya_terlambat: true })).program.map((p) => p.kode), ['P2']);
  assert.equal((await tool('peta_program').run(head, { status: 'berjalan', cari: 'program 1' })).program.length, 1);
  await assert.rejects(tool('peta_program').run(head, { divisi: 'semua' }), forbidden);
});

test('home: only the caller\'s own work, each part behind its page permission, no rupiah and no outside link', async (t) => {
  const seen = [];
  t.mock.method(morningBriefing, 'build', async () => NO_BRIEFING);
  t.mock.method(workSummaryPage, 'build', async (user) => {
    seen.push(['build', user.sub]);
    return {
      generatedAt: '2026-10-02T00:00:00.000Z',
      notifications: { unread: 2, recent: [{ id: 1, title: `Pembayaran ${BAIT} disetujui`, isRead: false, at: '2026-10-02T00:00:00.000Z', to: '/notifications' }] },
      cards: [
        { key: 'finance_approval', group: 'action', title: 'Pembayaran menunggu persetujuan Anda', count: 4, to: '/finance/payment-requests', items: Array.from({ length: 5 }, (_, i) => ({ id: i, title: `PR ${i}`, meta: `IDR 987.654.321`, to: `/finance/payment-requests/${i}`, at: null })) },
        { key: 'it_mine', group: 'mine', title: 'Tiket IT saya', count: 1, to: '/it/tickets', items: [{ id: 9, title: 'Laptop', meta: 'Sedang dikerjakan', to: '//luar.invalid', at: null }] },
        { key: 'it_queue', group: 'team', title: 'Antrean tiket IT', count: 7, to: '/it/tickets', items: [] },
      ],
    };
  });
  t.mock.method(taskService, 'listTasksForUser', async ({ user, filters }) => {
    seen.push(['tasks', user.sub, filters]);
    return {
      counts: { open: 3, overdue: 1, dueSoon: 2, done: 9 },
      total: 3,
      rows: [{ id: 5, title: `Tugas uji ${BAIT}`, status: 'open', priority: 'urgent', assigneeId: 15, reporterId: 2, dueDate: new Date('2026-10-01T00:00:00Z'), daysLate: 1, progressPercent: 10, boardName: 'Papan' }],
    };
  });
  t.mock.method(approvalRead, 'pendingForUser', async (user, options) => {
    seen.push(['approvals', user.sub, options.limit]);
    return {
      total: 7,
      complete: false,
      items: [{ id: 8, title: `Pengajuan ${BAIT}`, requestType: 'finance_payment_request', subjectType: 'finance_workflow', subjectId: 3, requesterName: 'Uji Pengaju', departmentName: 'Sales',
        createdAt: new Date('2026-10-01T00:00:00Z'), level: 1, deadlineAt: null, via: 'user', page: '/finance/payment-requests/3' }],
    };
  });
  const user = { sub: 15, entityId: 7, departmentId: 5, permissions: ['notification.view', 'task.view', 'approval.view', 'approval.decide'] };
  const out = await tool('pekerjaan_saya_hari_ini').run(user, { jumlah: 4 });
  noMoney(out, 'pekerjaan_saya_hari_ini');
  // The same service calls, with the same scope, as tugas_saya and persetujuan_menunggu_saya.
  assert.deepEqual(seen, [['build', 15], ['tasks', 15, { mine: true, state: 'open', limit: 4 }], ['approvals', 15, 4]]);
  assert.deepEqual([out.perlu_ditindak.length, out.milik_saya_berjalan.length, out.antrean_tim.length], [1, 1, 1]);
  assert.equal(out.perlu_ditindak[0].jumlah, 4);
  assert.equal(out.perlu_ditindak[0].contoh.length, 3);
  assert.equal(out.perlu_ditindak[0].contoh[0].keterangan, '(nilai rupiah tidak ditampilkan)');
  assert.equal(out.milik_saya_berjalan[0].contoh[0].rute, null);
  assert.deepEqual([out.tugas_saya.aktif, out.tugas_saya.terlambat, out.tugas_saya.jatuh_tempo_7_hari], [3, 1, 2]);
  assert.deepEqual(out.tugas_saya.daftar[0], {
    id: 5, judul: 'Tugas uji (nilai rupiah tidak ditampilkan)', papan: 'Papan', prioritas: 'mendesak', tenggat: '2026-10-01', terlambat_hari: 1, peran_anda: 'penanggung jawab', progres_persen: 10, rute: '/tasks/5',
  });
  assert.equal(out.persetujuan_menunggu_saya.total_menunggu, 7);
  assert.deepEqual([out.persetujuan_menunggu_saya.daftar[0].jenis, out.persetujuan_menunggu_saya.daftar[0].rute], ['Pengajuan pembayaran', '/finance/payment-requests/3']);
  assert.match(out.persetujuan_menunggu_saya.keputusan, /Prakasa AI hanya membaca/);
  assert.equal(out.notifikasi.belum_dibaca, 2);
  assert.match(out.catatan, /bisa belum lengkap/);

  // A failing part is said plainly; the rest of the answer stays.
  approvalRead.pendingForUser.mock.mockImplementation(async () => { throw new Error('boom'); });
  const partial = await tool('pekerjaan_saya_hari_ini').run(user, {});
  assert.equal('persetujuan_menunggu_saya' in partial, false);
  assert.ok(partial.tugas_saya);
  assert.match(partial.catatan, /persetujuan gagal dibaca/);

  // Without task.view the tasks are not read; without approval.decide nothing can wait for a decision
  // (persetujuan_menunggu_saya says the same) — neither service is asked.
  const before = seen.length;
  const bare = await tool('pekerjaan_saya_hari_ini').run({ ...user, permissions: ['notification.view', 'approval.view'] }, {});
  assert.equal('tugas_saya' in bare || 'persetujuan_menunggu_saya' in bare, false);
  assert.deepEqual(seen.slice(before), [['build', 15]]);
});

test('home and its sibling tools read the same thing: tugas_saya and persetujuan_menunggu_saya give the same counts and records', async (t) => {
  const rows = [
    { id: 5, title: 'A', status: 'open', priority: 'high', assigneeId: 15, reporterId: 2, dueDate: new Date('2026-09-30T00:00:00Z'), daysLate: 2, progressPercent: 0, boardName: 'Papan' },
    { id: 6, title: 'B', status: 'in_progress', priority: 'low', assigneeId: 3, reporterId: 15, dueDate: null, daysLate: 0, progressPercent: 50, boardName: null },
  ];
  const asked = [];
  t.mock.method(workSummaryPage, 'build', async () => ({ cards: [], notifications: { unread: 0, recent: [] } }));
  t.mock.method(morningBriefing, 'build', async () => NO_BRIEFING);
  t.mock.method(taskService, 'listTasksForUser', async ({ filters }) => { asked.push(filters); return { counts: { open: 2, overdue: 1, dueSoon: 0, done: 4 }, total: 2, rows }; });
  t.mock.method(approvalRead, 'pendingForUser', async () => ({
    total: 2,
    complete: true,
    items: [
      { id: 8, title: 'X', requestType: 'ga_request', subjectType: 'ga_request', subjectId: 1, requesterName: 'P', departmentName: 'Sales', createdAt: new Date('2026-10-01T00:00:00Z'), level: 1, deadlineAt: new Date('2026-10-01T05:00:00Z'), via: 'role', page: '/ga/requests/1' },
      { id: 9, title: 'Y', requestType: 'uji', subjectType: 'uji', subjectId: null, requesterName: 'Q', departmentName: null, createdAt: new Date('2026-10-02T00:00:00Z'), level: 2, deadlineAt: null, via: 'user', page: null },
    ],
  }));
  const user = { sub: 15, entityId: 7, departmentId: 5, permissions: ['notification.view', 'task.view', 'approval.view', 'approval.decide'] };
  const home = await tool('pekerjaan_saya_hari_ini').run(user, {});
  const mine = await tool('tugas_saya').run(user, { status: 'aktif' });
  const waiting = await tool('persetujuan_menunggu_saya').run(user, {});
  assert.ok(asked.every((filters) => filters.mine === true && filters.state === 'open'), 'both ask for my own open tasks');
  assert.deepEqual([home.tugas_saya.aktif, home.tugas_saya.terlambat, home.tugas_saya.jatuh_tempo_7_hari],
    [mine.ringkasan.aktif, mine.ringkasan.terlambat, mine.ringkasan.jatuh_tempo_7_hari]);
  const same = (x) => [x.id, x.tenggat, x.terlambat_hari, x.peran_anda, x.rute];
  assert.deepEqual(home.tugas_saya.daftar.map(same), mine.tugas.map(same));
  assert.equal(home.tugas_saya.cakupan, mine.cakupan);
  assert.equal(home.persetujuan_menunggu_saya.total_menunggu, waiting.total_menunggu);
  const request = (x) => [x.id, x.judul, x.diajukan_oleh, x.divisi, x.diajukan_pada, x.tenggat_keputusan, x.rute];
  assert.deepEqual(home.persetujuan_menunggu_saya.daftar.map(request), waiting.pengajuan.map(request));
  assert.equal(home.persetujuan_menunggu_saya.keputusan, waiting.keputusan);
});

test('search: the page\'s search with the user\'s own scope; no contact person, never another company', async (t) => {
  const asked = [];
  t.mock.method(globalSearch, 'search', async (args) => {
    asked.push(args);
    return {
      rows: [
        { type: 'customer', id: 3, title: 'Toko Uji', subtitle: 'Pak SENTINEL', status: null, createdAt: '2026-09-01T00:00:00.000Z', actionUrl: '/sales/customers/3', score: 80, meta: { city: 'Surabaya' } },
        { type: 'finance_workflow', id: 4, title: `Bayar ${BAIT}`, subtitle: 'PR-1', status: 'pending_approval', createdAt: new Date('2026-09-02T00:00:00Z'), actionUrl: '/finance/payment-requests/4', score: 60, meta: { currency: 'IDR' } },
      ],
      meta: { page: 1, limit: args.limit, total: 2, allowedTypes: ['customer', 'finance_workflow'], requestedTypes: args.types || ['customer', 'finance_workflow'], partial: true, providerErrors: [{ type: 'task' }] },
    };
  });
  const user = { sub: 15, entityId: 7, departmentId: 5, permissions: ['search.global', 'sales.customer.view', 'finance.view'] };
  const out = await tool('pencarian_global').run(user, { kata_kunci: '  uji ', jumlah: 99 });
  noMoney(out, 'pencarian_global');
  assert.deepEqual([asked[0].q, asked[0].entityId, asked[0].types, asked[0].limit, asked[0].user], ['uji', null, null, 25, user]);
  assert.ok(!JSON.stringify(out).includes('SENTINEL'));
  assert.deepEqual(out.hasil[0], { jenis: 'customer', id: 3, judul: 'Toko Uji', keterangan: 'Surabaya', status: null, tanggal: '2026-09-01', rute: '/sales/customers/3' });
  assert.deepEqual([out.hasil[1].jenis, out.hasil[1].judul, out.hasil[1].tanggal], ['pengajuan_pembayaran', 'Bayar (nilai rupiah tidak ditampilkan)', '2026-09-02']);
  assert.match(out.catatan, /Sebagian modul gagal/);
  await tool('pencarian_global').run(user, { kata_kunci: 'uji', jenis: 'customer' });
  assert.deepEqual(asked.at(-1).types, ['customer']);

  // A type the user may not open is not searched at all; nor is a one-letter query.
  const before = asked.length;
  const refused = await tool('pencarian_global').run(user, { kata_kunci: 'uji', jenis: 'perangkat' });
  assert.deepEqual(refused.hasil, []);
  assert.match(refused.catatan, /tidak termasuk hak akses/);
  assert.deepEqual((await tool('pencarian_global').run(user, { kata_kunci: 'a' })).hasil, []);
  assert.equal(asked.length, before);
});

test('the central cap still applies to these tools', async (t) => {
  t.mock.method(divisionDashboard, 'listDivisions', async () => DIVISIONS.slice(0, 1));
  t.mock.method(escalation, 'list', async () => {
    const data = fakeEscalations(2);
    data.sources = Array.from({ length: 150 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, provider: 'sales', providerLabel: 'Sales' }));
    data.totals.bySource = Object.fromEntries(data.sources.map((s) => [s.key, 1]));
    return data;
  });
  const out = await tool('eskalasi_terbuka').run({ sub: 1, entityId: 7, departmentId: 5, permissions: ['management_dashboard.division'] }, {});
  assert.equal(out.per_sumber.length, contract.MAX_LIST_ITEMS);
  assert.equal(out.terpotong, true);
});

// ---------------------------------------------------------------- real services

// Records every statement the services run on the test connection.
function recordSql(conn) {
  const original = conn.query.bind(conn);
  const statements = [];
  conn.query = (...args) => { statements.push(String(typeof args[0] === 'string' ? args[0] : args[0]?.sql)); return original(...args); };
  return { statements, restore: () => { delete conn.query; } };
}

test('real services: a division Head reads only their own division, with SELECTs only and nothing sent', DB_TEST, async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  const sent = t.mock.method(notification, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const head = await makeUser(conn, { name: 'AI Head Sales', division: 'sales', roles: ['sales.head'] });
    const member = await makeUser(conn, { name: 'AI Member Sales', division: 'sales', roles: ['sales.member'] });
    const sales = await departmentId(conn, 'sales');
    const [[other]] = await conn.query("SELECT name FROM departments WHERE entity_id = 1 AND code = 'warehouse' AND deleted_at IS NULL");
    const spy = recordSql(conn);
    try {
      const dashboard = await tool('dashboard_divisi').run(head.user, {});
      assert.equal(dashboard.rute, `/division-dashboard?division=${sales}`);
      assert.ok(dashboard.angka_kunci.length > 0);
      noMoney(dashboard, 'dashboard_divisi (real)');
      const money = await tool('angka_rupiah_divisi').run(head.user, {});
      assert.ok(money.angka_kunci.every((k) => 'nilai_rupiah' in k || 'angka' in k));

      const queue = await tool('eskalasi_terbuka').run(head.user, { jumlah: 50 });
      assert.match(queue.cakupan, /^divisi /);
      assert.ok(queue.eskalasi.length <= 50);
      noMoney(queue, 'eskalasi_terbuka (real)');

      const target = await tool('target_realisasi').run(head.user, { hanya_bertarget: false, jumlah: 100 });
      assert.ok(target.baris.length > 0 && target.baris.every((r) => r.divisi === target.baris[0].divisi), 'one division only');
      assert.ok(target.metrik_dibatasi.some((m) => /harga beli/.test(m.alasan)), 'the purchase-price metric is restricted');
      noMoney(target, 'target_realisasi (real)');
      const rupiah = await tool('target_realisasi_rupiah').run(head.user, { hanya_bertarget: false });
      assert.ok(rupiah.baris.every((r) => r.satuan === 'rupiah' && r.metrik !== 'procurement_po_value'));

      const program = await tool('peta_program').run(head.user, {});
      assert.match(program.cakupan, /^divisi /);

      for (const name of ['dashboard_divisi', 'angka_rupiah_divisi', 'eskalasi_terbuka', 'target_realisasi', 'target_realisasi_rupiah', 'peta_program']) {
        await assert.rejects(tool(name).run(head.user, { divisi: other.name }), forbidden, `${name}: another division`);
        await assert.rejects(tool(name).run(member.user, {}), forbidden, `${name}: member`);
      }

      assert.ok(spy.statements.length > 20);
      for (const sql of spy.statements) {
        assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `not a SELECT: ${sql.slice(0, 80)}`);
        assert.doesNotMatch(sql, /pc_po_price/i, 'a purchase-price view was read');
      }
    } finally { spy.restore(); }
  });
  assert.equal(sent.mock.callCount(), 0);
});

test('real services: the home tool lists my own tasks and the approvals I can decide — never someone else\'s, and agrees with tugas_saya and persetujuan_menunggu_saya', DB_TEST, async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  const sent = t.mock.method(notification, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const me = await makeUser(conn, { name: 'AI Saya', division: 'sales', roles: ['sales.supervisor'] });
    const colleague = await makeUser(conn, { name: 'AI Rekan', division: 'sales', roles: ['sales.supervisor'] });
    const member = await makeUser(conn, { name: 'AI Anggota', division: 'sales', roles: ['sales.member'] });
    const sales = await departmentId(conn, 'sales');
    const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
    const task = (title, assignee, reporter, due, status = 'open') => conn.query(
      `INSERT INTO tasks (entity_id, department_id, title, status, priority, assignee_id, reporter_id, due_date)
       VALUES (1, ?, ?, ?, 'high', ?, ?, ${due})`, [sales, title, status, assignee, reporter]);
    await task('[UJI-AI] terlambat', me.id, colleague.id, `${TODAY} - INTERVAL 3 DAY`);
    await task('[UJI-AI] hari ini', me.id, colleague.id, TODAY);
    await task('[UJI-AI] tanpa tenggat', me.id, colleague.id, 'NULL');
    await task('[UJI-AI] saya laporkan', member.id, me.id, `${TODAY} + INTERVAL 2 DAY`);
    await task('[UJI-AI] milik anggota', member.id, member.id, TODAY);
    await task('[UJI-AI] selesai', me.id, colleague.id, TODAY, 'done');

    // One request waiting for me (a step addressed to me) and one waiting for my colleague.
    // Every NOT NULL column is given: entity, subject type, title, requester.
    const request = async (title, requester, approver) => {
      const [a] = await conn.query(
        `INSERT INTO approval_requests (entity_id, department_id, title, requested_by, status, subject_type, request_type, amount)
         VALUES (1, ?, ?, ?, 'pending', 'uji_ai', 'uji_ai', 987654321)`, [sales, title, requester]);
      await conn.query(
        `INSERT INTO approval_steps (approval_request_id, level, order_index, approver_user_id, status, activated_at)
         VALUES (?, 1, 1, ?, 'pending', NOW())`, [a.insertId, approver]);
      return a.insertId;
    };
    await request('[UJI-AI] menunggu saya', member.id, me.id);
    await request('[UJI-AI] untuk rekan', member.id, colleague.id);

    const uji = (list) => list.filter((x) => String(x.judul).startsWith('[UJI-AI]'));
    const spy = recordSql(conn);
    try {
      const out = await tool('pekerjaan_saya_hari_ini').run(me.user, { jumlah: 25 });
      noMoney(out, 'pekerjaan_saya_hari_ini (real)');
      assert.deepEqual(out.tugas_saya.daftar.map((x) => x.judul), ['[UJI-AI] terlambat', '[UJI-AI] hari ini', '[UJI-AI] saya laporkan', '[UJI-AI] tanpa tenggat']);
      assert.deepEqual([out.tugas_saya.aktif, out.tugas_saya.terlambat, out.tugas_saya.jatuh_tempo_7_hari], [4, 1, 2]);
      assert.deepEqual(out.tugas_saya.daftar.map((x) => [x.terlambat_hari, x.peran_anda]), [[3, 'penanggung jawab'], [0, 'penanggung jawab'], [0, 'pelapor'], [0, 'penanggung jawab']]);
      // Real pending requests of the role (an Accurate batch for the Sales Supervisor) may be listed too.
      const mine = uji(out.persetujuan_menunggu_saya.daftar);
      assert.deepEqual(mine.map((x) => x.judul), ['[UJI-AI] menunggu saya'], 'not my colleague\'s step');
      assert.ok(out.persetujuan_menunggu_saya.total_menunggu >= 1);
      assert.equal(mine[0].diajukan_oleh, '[UJI] AI Anggota');
      assert.equal(mine[0].rute, null, 'a request without a module page has no route — never a made-up one');

      // The sibling tools answer the same questions with the same records.
      const tasks = await tool('tugas_saya').run(me.user, { status: 'aktif', jumlah: 25 });
      assert.deepEqual(tasks.tugas.map((x) => x.id), out.tugas_saya.daftar.map((x) => x.id));
      assert.deepEqual([tasks.ringkasan.aktif, tasks.ringkasan.terlambat, tasks.ringkasan.jatuh_tempo_7_hari], [out.tugas_saya.aktif, out.tugas_saya.terlambat, out.tugas_saya.jatuh_tempo_7_hari]);
      const waiting = await tool('persetujuan_menunggu_saya').run(me.user, { jumlah: 25 });
      assert.equal(waiting.total_menunggu, out.persetujuan_menunggu_saya.total_menunggu);
      assert.deepEqual(waiting.pengajuan.map((x) => x.id), out.persetujuan_menunggu_saya.daftar.map((x) => x.id));

      const theirs = await tool('pekerjaan_saya_hari_ini').run(colleague.user, { jumlah: 25 });
      assert.deepEqual(theirs.tugas_saya.daftar.map((x) => x.judul), ['[UJI-AI] terlambat', '[UJI-AI] hari ini', '[UJI-AI] tanpa tenggat'], 'what the colleague reported');
      assert.deepEqual(uji(theirs.persetujuan_menunggu_saya.daftar).map((x) => x.judul), ['[UJI-AI] untuk rekan']);
      // A Member decides nothing: no approvals part, and only their own tasks.
      const members = await tool('pekerjaan_saya_hari_ini').run(member.user, {});
      assert.equal('persetujuan_menunggu_saya' in members, false);
      assert.deepEqual(members.tugas_saya.daftar.map((x) => x.judul).sort(), ['[UJI-AI] milik anggota', '[UJI-AI] saya laporkan']);

      // The search finds my division's task; a user of another division does not.
      const found = await tool('pencarian_global').run(me.user, { kata_kunci: '[UJI-AI] terlambat', jenis: 'tugas' });
      assert.deepEqual(found.hasil.map((x) => [x.jenis, x.judul]), [['tugas', '[UJI-AI] terlambat']]);
      assert.match(found.hasil[0].rute, /^\/tasks\/\d+$/);
      const outsider = await makeUser(conn, { name: 'AI Luar', division: 'warehouse', roles: ['warehouse.member'] });
      assert.deepEqual((await tool('pencarian_global').run(outsider.user, { kata_kunci: '[UJI-AI] terlambat' })).hasil, []);

      const reads = spy.statements.filter((sql) => !/^\s*INSERT INTO (users|user_roles|people_directory)\b/i.test(sql));
      for (const sql of reads) assert.match(sql.trim(), /^\(?\s*SELECT\b/i, `not a SELECT: ${sql.slice(0, 80)}`);
    } finally { spy.restore(); }
  });
  assert.equal(sent.mock.callCount(), 0);
});
