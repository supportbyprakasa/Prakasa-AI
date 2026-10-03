const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const registry = require('../src/management/registry');
const escalation = require('../src/services/escalation.service');
const ctrl = require('../src/controllers/managementDashboard.controller');
const {
  validateProvider, permitted, restrictedText, KEY_MAX, STORED_KEYS, RESTRICTED_TEXT,
} = require('../src/management/contract');

// The owner's rule: every division module — now and every one still to come —
// reports into management (escalations, targets, dashboard KPIs), scoped per
// division. This file is what makes that a rule the code enforces rather than
// something someone has to remember.

const FRONTEND = path.join(__dirname, '../../frontend/src');

function sidebarPaths() {
  const source = fs.readFileSync(path.join(FRONTEND, 'components/navigation.js'), 'utf8');
  const nav = source.slice(0, source.indexOf('export function hasNavPermission'));
  return [...nav.matchAll(/\{ to: '([^']+)'/g)].map((m) => m[1]);
}

// Sidebar routes that are NOT a division module, each with the reason. Anything
// not listed here must be covered by a management provider's navPaths. Adding a
// route to this list is a deliberate decision that the reviewer will see.
const NOT_A_DIVISION_MODULE = new Map([
  ['/', 'Beranda pribadi pengguna'],
  ['/notifications', 'Notifikasi pribadi'],
  ['/panduan', 'Panduan pemakaian, bukan data divisi'],
  ['/ai-command', 'Asisten AI, bukan data divisi'],
  ['/mail', 'Gmail pribadi pengguna'],
  ['/chat', 'Google Chat pribadi pengguna'],
  ['/calendar', 'Kalender pribadi pengguna'],
  ['/docs', 'File Google pribadi pengguna'],
  ['/sheets', 'File Google pribadi pengguna'],
  ['/slides', 'File Google pribadi pengguna'],
  ['/groups', 'Direktori Google Groups'],
  ['/division-storage', 'Penyimpanan file, bukan proses kerja'],
  ['/my-drive', 'Penyimpanan file pribadi'],
  ['/division-dashboard', 'Membaca provider manajemen yang sudah ada (ringkasan per divisi), bukan modul sendiri'],
  ['/data-accurate', 'Batch dan pengajuan Accurate: lapisan integrasi, dibaca provider accurate.js'],
  ['/doc-templates', 'Alat dokumen lintas divisi: template, kop & footer, dokumen di Shared Drive divisi'],
  ['/management', 'Lapisan manajemen itu sendiri'],
  ['/escalations', 'Lapisan manajemen itu sendiri'],
  ['/roadmap', 'Lapisan manajemen itu sendiri'],
  ['/targets', 'Lapisan manajemen itu sendiri'],
  ['/analytics', 'Statistik situs web, bukan proses divisi'],
  ['/activity-logs', 'Jejak audit sistem'],
]);
// Whole areas: placeholders with no module yet, and system administration.
const NOT_A_DIVISION_PREFIX = new Map([
  ['/coming-soon/', 'Placeholder — modulnya belum dibangun. Begitu diganti modul sungguhan, tes ini menuntut provider-nya.'],
  ['/admin/', 'Administrasi sistem'],
]);

const exempt = (route) => NOT_A_DIVISION_MODULE.has(route)
  || [...NOT_A_DIVISION_PREFIX.keys()].some((prefix) => route.startsWith(prefix));

test('every provider in src/management/providers satisfies the contract', () => {
  registry.reset();
  const providers = registry.providers();
  assert.ok(providers.length >= 2, 'the registry discovered the provider files');
  for (const p of providers) assert.doesNotThrow(() => validateProvider(p), p.key);
});

test('every division module in the sidebar reports into management', () => {
  const covered = new Set(registry.providers().flatMap((p) => p.navPaths));
  const missing = sidebarPaths().filter((route) => !exempt(route) && !covered.has(route));
  assert.deepEqual(
    missing,
    [],
    `Modul divisi berikut belum terhubung ke manajemen: ${missing.join(', ')}. `
      + 'Tambahkan provider di backend/src/management/providers/ (lihat docs/management-integration.md), '
      + 'atau — kalau memang bukan modul divisi — daftarkan ke NOT_A_DIVISION_MODULE beserta alasannya.',
  );
});

test('the exemption list only names routes that still exist', () => {
  const routes = new Set(sidebarPaths());
  const stale = [...NOT_A_DIVISION_MODULE.keys()].filter((route) => !routes.has(route));
  assert.deepEqual(stale, [], 'remove exemptions for routes that are gone, so the list never grows silently');
});

test('a provider only claims routes that exist in the sidebar', () => {
  const routes = new Set(sidebarPaths());
  for (const p of registry.providers()) {
    for (const route of p.navPaths) assert.ok(routes.has(route), `${p.key} claims ${route}, which is not in the sidebar`);
  }
});

test('a module that reports nothing must say why', () => {
  assert.throws(
    () => validateProvider({ key: 'kosong', label: 'Kosong', navPaths: ['/x'] }),
    /optOut/,
  );
  assert.doesNotThrow(() => validateProvider({ key: 'kosong', label: 'Kosong', navPaths: ['/x'], optOut: 'Hanya pengaturan' }));
});

test('the contract rejects malformed capabilities with a message naming the field', () => {
  const base = { key: 'contoh', label: 'Contoh', navPaths: ['/contoh'] };
  assert.throws(() => validateProvider({ ...base, escalations: [{ key: 'a_b', label: 'X', list: async () => [] }] }), /locate/);
  assert.throws(
    () => validateProvider({ ...base, metrics: [{ key: 'metrik_contoh', label: 'M', unit: 'ton', better: 'higher', cumulative: true, actuals: async () => new Map() }] }),
    /unit/,
  );
  assert.throws(() => validateProvider({ ...base, kpis: [{ key: 'Bad-Key', label: 'K', value: async () => ({}) }] }), /snake_case/);
});

test('keys stay unique across providers, so two modules never merge their data', () => {
  const sources = registry.escalationSources().map((s) => s.key);
  const metrics = registry.metrics().map((m) => m.key);
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(new Set(metrics).size, metrics.length);
});

// A stored key longer than its column would fail (or be cut short) on the first
// follow-up or target written — long after the provider was accepted.
test('every stored key fits its column: escalation_followups.source (32), division_targets.metric_key (40)', () => {
  assert.equal(STORED_KEYS.escalations.max, 32);
  assert.equal(STORED_KEYS.metrics.max, 40);
  for (const s of registry.escalationSources()) assert.ok(s.key.length <= 32, `${s.key} (${s.key.length}) fits escalation_followups.source`);
  for (const m of registry.metrics()) assert.ok(m.key.length <= 40, `${m.key} (${m.key.length}) fits division_targets.metric_key`);
  for (const k of registry.kpis()) assert.ok(k.key.length <= KEY_MAX, k.key);
});

test('the contract measures each key against where it is stored', () => {
  const base = { key: 'contoh', label: 'Contoh', navPaths: ['/contoh'] };
  const escalationWith = (key) => ({ ...base, escalations: [{ key, label: 'E', list: async () => [], locate: async () => null }] });
  const k32 = `e${'x'.repeat(31)}`;
  const k33 = `e${'x'.repeat(32)}`;
  assert.doesNotThrow(() => validateProvider(escalationWith(k32)));
  assert.throws(
    () => validateProvider(escalationWith(k33)),
    /escalations\[0\]\.key maks 32 karakter \(kolom escalation_followups\.source\)/,
  );
  // Past KEY_RE's 40 the message still names the escalation limit, not 40.
  assert.throws(() => validateProvider(escalationWith(`e${'x'.repeat(44)}`)), /escalations\[0\]\.key harus snake_case \(a-z, 0-9, _\), maks 32 karakter/);
  // KPI keys are never stored and metric keys go into a VARCHAR(40): 33 is fine for both.
  assert.doesNotThrow(() => validateProvider({ ...base, kpis: [{ key: k33, label: 'K', value: async () => ({}) }] }));
  assert.doesNotThrow(() => validateProvider({
    ...base, metrics: [{ key: k33, label: 'M', unit: 'item', better: 'higher', cumulative: true, actuals: async () => new Map() }],
  }));
  assert.throws(() => validateProvider({ ...base, kpis: [{ key: `k${'x'.repeat(40)}`, label: 'K', value: async () => ({}) }] }), /maks 40 karakter/);
});

test('a KPI or metric may sit behind a permission; the contract checks its shape', () => {
  const base = { key: 'contoh', label: 'Contoh', navPaths: ['/contoh'] };
  const kpi = (extra) => ({ ...base, kpis: [{ key: 'nilai', label: 'Nilai', value: async () => ({}), ...extra }] });
  const metric = (extra) => ({
    ...base,
    metrics: [{ key: 'nilai', label: 'Nilai', unit: 'rupiah', better: 'lower', cumulative: true, actuals: async () => new Map(), ...extra }],
  });
  for (const build of [kpi, metric]) {
    assert.doesNotThrow(() => validateProvider(build({ permission: 'procurement.price.view' })));
    assert.doesNotThrow(() => validateProvider(build({ permission: ['procurement.price.view', 'finance.view'], restrictedText: 'Hanya untuk X' })));
    for (const bad of ['', 'harga', 'Procurement.Price', 42, [], ['procurement.price.view', 7], null, { code: 'a.b' }]) {
      assert.throws(() => validateProvider(build({ permission: bad })), /\.permission harus kode izin/, JSON.stringify(bad));
    }
    assert.throws(() => validateProvider(build({ permission: 'a.b', restrictedText: '  ' })), /restrictedText harus berupa teks/);
    assert.throws(() => validateProvider(build({ restrictedText: 'Hanya untuk X' })), /restrictedText hanya dipakai bersama permission/);
  }
  // An escalation has nothing to gate — a permission there would only look enforced.
  assert.throws(
    () => validateProvider({ ...base, escalations: [{ key: 'esc', label: 'E', list: async () => [], locate: async () => null, permission: 'a.b' }] }),
    /permission tidak berlaku untuk eskalasi/,
  );
});

test('permitted() is "any of" like requirePermission; no permission means everyone', () => {
  assert.equal(permitted({ key: 'x' }, []), true);
  assert.equal(permitted({ permission: 'procurement.price.view' }, ['management_dashboard.view']), false);
  assert.equal(permitted({ permission: 'procurement.price.view' }, ['procurement.price.view']), true);
  assert.equal(permitted({ permission: ['a.b', 'c.d'] }, ['c.d']), true);
  assert.equal(permitted({ permission: 'a.b' }, undefined), false, 'no permissions given → none held');
  assert.equal(restrictedText({ permission: 'a.b' }), RESTRICTED_TEXT);
  assert.equal(restrictedText({ permission: 'a.b', restrictedText: 'Hanya untuk X' }), 'Hanya untuk X');
});

// P1: purchase prices only for procurement.price.view. Anything a provider reads
// from the price views must declare it, so management never shows it to others.
test('every KPI and metric that reads purchase prices sits behind procurement.price.view', () => {
  const readsPrices = (fn) => /pc_po_price/.test(String(fn));
  const gated = [
    ...registry.kpis().filter((k) => readsPrices(k.value)),
    ...registry.metrics().filter((m) => readsPrices(m.actuals)),
  ];
  assert.deepEqual(gated.map((x) => x.key).sort(), ['procurement_po_value', 'procurement_po_value_month']);
  for (const x of gated) {
    assert.ok([].concat(x.permission).includes('procurement.price.view'), x.key);
    assert.equal(restrictedText(x), 'Hanya untuk yang berwenang melihat harga beli');
  }
});

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// Every KPI of GET /summary runs against a fake database that answers the PO
// value query with a real-looking total. Mocked once per test.
function fakeSummaryDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM pc_po_prices_accurate v/.test(sql)) return [[{ cur: '125000000.00', prev: '99000000.00', n: 3 }]];
    return [[]];
  });
  t.mock.method(escalation, 'list', async () => ({
    scope: { entityWide: true, departmentId: null, departmentName: null },
    items: [],
    totals: { all: 0, open: 0, acknowledged: 0, resolved: 0, bySource: {} },
  }));
  return calls;
}

async function summaryAs(calls, permissions, { departmentId = null } = {}) {
  calls.length = 0;
  const res = responseDouble();
  await ctrl.summary({ user: { sub: 4, entityId: 1, departmentId, permissions }, query: {} }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  const poValue = res.body.data.kpis.find((k) => k.provider === 'procurement' && k.key === 'procurement_po_value_month');
  return { kpis: res.body.data.kpis, poValue, priceQueries: calls.filter((c) => /pc_po_price/.test(c.sql)) };
}

test('summary: no purchase-price rupiah without procurement.price.view — the card says why', async (t) => {
  const calls = fakeSummaryDb(t);
  const { kpis, poValue, priceQueries } = await summaryAs(calls, ['management_dashboard.view']);
  assert.deepEqual(poValue, {
    provider: 'procurement', providerLabel: 'Procurement', key: 'procurement_po_value_month',
    label: 'Nilai PO bulan ini (sebelum PPN)', unit: 'rupiah',
    value: null, sub: 'Hanya untuk yang berwenang melihat harga beli', alert: false, error: false, restricted: true,
  });
  assert.equal(priceQueries.length, 0, 'the price view is never even queried');
  assert.ok(!JSON.stringify(kpis).includes('99.000.000'), 'not even last month in a sub line');
  assert.ok(kpis.filter((k) => k.restricted).every((k) => k.value === null));
  assert.ok(kpis.some((k) => !k.restricted), 'every other KPI is unaffected');

  // A division Head without the price permission (e.g. Finance Head) is treated the same.
  const head = await summaryAs(calls, ['management_dashboard.division'], { departmentId: 2 });
  assert.equal(head.poValue.value, null);
  assert.equal(head.poValue.restricted, true);
  assert.equal(head.priceQueries.length, 0);
});

test('summary: with procurement.price.view (MO, Procurement Head, Super Admin) the value is shown', async (t) => {
  const calls = fakeSummaryDb(t);
  const { poValue, priceQueries } = await summaryAs(calls, ['management_dashboard.view', 'procurement.price.view']);
  assert.equal(poValue.value, 125000000);
  assert.equal(poValue.sub, '3 PO · bulan lalu Rp 99.000.000');
  assert.equal(poValue.restricted, false);
  assert.equal(priceQueries.length, 1);
  assert.deepEqual(priceQueries[0].args, [1], 'entity bound, entity-wide');

  const head = await summaryAs(calls, ['management_dashboard.division', 'procurement.price.view'], { departmentId: 3 });
  assert.equal(head.poValue.value, 125000000);
  assert.deepEqual(head.priceQueries[0].args, [1, 3], 'entity first, then the Head\'s own division');
});

test('one late-SO escalation only: Warehouse "SO lewat janji kirim" (program 3.4, owner decision)', () => {
  const late = registry.escalationSources().filter((s) => /so_(late|not_shipped)|belum dikirim|lewat janji/i.test(`${s.key} ${s.label}`));
  assert.deepEqual(late.map((s) => s.key), ['warehouse_so_late']);
});
