const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const pool = require('../src/db/pool');
const { serialized } = require('./fixtures/gaDb');
const importer = require('../src/services/itInfraImport.service');
const config = require('../src/config/itInfra');

// Import of the owner's IT report into the infrastructure registers
// (docs/rancangan-people-culture-g2.md §4.3): allow-listed columns only,
// secret headers never read, strict server schema, location mapping with
// skip counts, identity and diffs, re-import 0 changes, apply re-validates.

const MODEL = pathToFileURL(path.join(__dirname, '../../frontend/src/pages/it/infraModel.js')).href;
const model = () => import(MODEL);

test.after(() => pool.end());

// The owner's report layout (ref-structure: 03 - Network Devices, 04_ISP_Info,
// 08_CCTV_System) with its secret columns filled, to prove they are never read.
const SHEETS = [
  {
    sheet: '03 - Network Devices',
    data: [
      ['No', 'Device Type (Router/Switch/AP/NVR)', 'Serial Number', 'Brand/Model', 'Lokasi', 'IP Address', 'Tahun Install', 'ISP Terkait', 'Firmware Update Terakhir', 'Username', 'Password', 'Status', 'Notes'],
      [1, 'Router', 'RBIG67601092LR7', 'Asus AX6000', 'PFN Office', '192.168.1.1', null, 'Biznet', null, 'admin', 'S3cret!', 'Active', null],
      [2, 'Switch', null, 'NBS3100-24GT4SFP-P-V2', 'PFN Office', '192.168.1.2', 2026, 'Biznet', new Date('2026-08-01T00:00:00Z'), 'admin', 'S3cret!', 'Active', 'password: admin'],
      [3, 'Access Point (NET-PG-AP-01)', 'G1U62UF023726', 'RAP2260(G)', 'PMK Office', '10.0.0.5', 2025, 'Indihome', null, 'root', 'x', 'Active', null],
    ],
  },
  {
    sheet: '04_ISP_Info',
    data: [
      ['No', 'Lokasi', 'Provider', 'No Pelanggan', 'Bandwidth', 'IP Public  Dedicated (Yes/No)', 'Backup ISP (Yes/No)', 'Password Wifi', 'Note'],
      [1, 'PFN Office', 'Biznet', 1000789826, '150 Mbps', 'No', 'No', 'wifi-secret', 'Atas nama kantor'],
      [2, 'PMK Office', 'Indihome', '121703287235', '1 Gbps', 'No', 'No', 'wifi-secret', null],
    ],
  },
  {
    sheet: '08_CCTV_System',
    data: [
      ['No', 'Lokasi', 'Jumlah Kamera', 'Model', 'DVR/NVR', 'Remote Access (Yes/No)', 'Serial Number', 'Satu Network  dengan PC (Yes/No)', 'Catatan'],
      [1, 'PFN Office', 18, 'DS-7732NI-M4', 'NVR', 'No', 'GM4946749', 'Need to reconfirm', 'NVR di ruang utama'],
      [null, null, null, null, null, null, null, null, 'Lantai 2: 6 kamera'],
      [2, 'PMK Office', 11, 'iDs-7216HQHI-M1/XT', 'DVR', 'No', '1620250218CCWRFW', 'Yes', null],
    ],
  },
];

// ------------------------------------------------------------ browser side
test('allow-list parity: the browser and the server read exactly the same columns', async () => {
  const m = await model();
  assert.deepEqual(Object.keys(m.IMPORT_COLUMNS).sort(), [...config.IMPORT_KINDS].sort());
  for (const kind of config.IMPORT_KINDS) {
    assert.deepEqual(
      m.IMPORT_COLUMNS[kind].map((c) => ({ field: c.field, headers: c.headers, required: Boolean(c.required) })),
      config.IMPORT_COLUMNS[kind].map((c) => ({ field: c.field, headers: [...c.headers], required: Boolean(c.required) })),
      kind,
    );
  }
  assert.equal(m.SECRET_HEADER_RE.source, config.SECRET_HEADER_RE.source);
  // No allow-listed header is itself a secret header.
  for (const kind of config.IMPORT_KINDS) {
    for (const c of config.IMPORT_COLUMNS[kind]) for (const h of c.headers) assert.ok(!config.SECRET_HEADER_RE.test(h), h);
  }
});

test('headers: trimmed, spaces collapsed, case ignored ("IP Public  Dedicated")', async () => {
  const m = await model();
  assert.equal(m.normalizeHeader('  IP Public  Dedicated (Yes/No) '), 'ip public dedicated (yes/no)');
  assert.equal(m.normalizeHeader('IP Public  Dedicated (Yes/No)'), config.normalizeHeader('IP Public Dedicated (Yes/No)'));
});

test('secret headers are never read, even when the column is filled', async () => {
  const m = await model();
  const found = m.readWorkbook(SHEETS);
  assert.deepEqual(found.map((s) => s.kind), ['network', 'isp', 'cctv']);
  assert.deepEqual(found[0].secretColumns, ['Username', 'Password']);
  assert.deepEqual(found[1].secretColumns, ['Password Wifi']);
  const payload = JSON.stringify(found.map((s) => s.rows));
  for (const secret of ['S3cret!', 'wifi-secret', '"admin"', 'root']) assert.ok(!payload.includes(secret), secret);
  for (const s of found) {
    const allowed = new Set(['rowNumber', ...config.IMPORT_COLUMNS[s.kind].map((c) => c.field)]);
    for (const row of s.rows) for (const key of Object.keys(row)) assert.ok(allowed.has(key), `${s.kind}.${key}`);
  }
  // A secret-looking note is dropped in the browser, a continuation line joins the row above.
  assert.equal(found[0].droppedSecrets, 1);
  assert.equal(found[0].rows[1].notes, null);
  assert.equal(found[2].rows.length, 2);
  assert.equal(found[2].rows[0].notes, 'NVR di ruang utama\nLantai 2: 6 kamera');
  assert.equal(found[0].rows[1].firmware, '2026-08-01');
});

test('location mapping: an exact company location maps, anything else is skipped', async () => {
  const m = await model();
  const values = m.locationValues(m.readWorkbook(SHEETS));
  assert.deepEqual(values, [{ text: 'PFN Office', rows: 4 }, { text: 'PMK Office', rows: 3 }]);
  assert.deepEqual(m.defaultLocationMap(values, [{ id: 3, name: 'pfn office', isActive: true }, { id: 4, name: 'Gudang', isActive: true }]), { 'PFN Office': 3, 'PMK Office': null });
});

// ------------------------------------------------------------ server schema
async function validateImport(body) {
  const layer = require('../src/routes/itInfrastructure.routes').stack.find((l) => l.route && l.route.path === '/import/preview');
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  await layer.route.stack[1].handle({ body }, res, () => { passed = true; });
  return passed ? 200 : res.statusCode;
}

test('strict schema: an extra key in a row (a password column smuggled in) is a 400', async () => {
  assert.equal(await validateImport({ network: [{ rowNumber: 2, deviceType: 'Router', location: 'PFN Office' }], locationMap: { 'PFN Office': 1 } }), 200);
  assert.equal(await validateImport({ network: [{ rowNumber: 2, deviceType: 'Router', location: 'PFN Office', password: 'x' }], locationMap: {} }), 400);
  assert.equal(await validateImport({ isp: [{ rowNumber: 2, provider: 'Biznet', location: 'A', passwordWifi: 'x' }], locationMap: {} }), 400);
  assert.equal(await validateImport({ cctv: [], locationMap: {}, entityId: 2 }), 400);
  assert.equal(await validateImport({ backup: [], locationMap: {} }), 400, 'Backup, Vendor and Google Workspace are not imported');
});

// ------------------------------------------------------------ plan (pure, fake context)
function ctxWith(existing = {}) {
  return {
    locations: [{ id: 3, name: 'PFN Office', is_active: 1 }],
    locationName: new Map([[3, 'PFN Office']]),
    existing: { network: [], isp: [], cctv: [], ...existing },
    ispName: new Map((existing.isp || []).map((r) => [Number(r.id), r.provider_name])),
    recorderName: new Map(),
  };
}

async function bodyFromSheets(locationMap) {
  const m = await model();
  return m.importBody(m.readWorkbook(SHEETS), locationMap);
}

test('plan: non-company rows are skipped and counted per location; normalisation of the report words', async () => {
  const body = await bodyFromSheets({ 'PFN Office': 3, 'PMK Office': null });
  const plan = importer.buildPlan(body, ctxWith());
  assert.deepEqual(plan.skippedByLocation, { 'PMK Office': 3 });
  assert.deepEqual(plan.counts.network, { rows: 3, new: 2, exists: 0, different: 0, skip: 1 });
  assert.deepEqual(plan.counts.isp, { rows: 2, new: 1, exists: 0, different: 0, skip: 1 });
  assert.deepEqual(plan.counts.cctv, { rows: 2, new: 1, exists: 0, different: 0, skip: 1 });
  const isp = plan.rows.isp[0].fields;
  assert.deepEqual({ ...isp }, { locationId: 3, providerName: 'Biznet', customerNumber: '1000789826', bandwidthMbps: 150, publicIpDedicated: false, isBackup: false, notes: 'Atas nama kantor' });
  const [router, sw] = plan.rows.network;
  assert.equal(router.fields.deviceType, 'router');
  assert.equal(router.fields.status, 'active');
  assert.equal(router.ispRowKey, 'isp:2', 'the ISP created by the same file');
  assert.equal(sw.fields.installedYear, 2026);
  assert.equal(sw.fields.firmwareUpdatedOn, '2026-08-01');
  assert.ok(sw.issues.some((i) => i.code === 'NO_SERIAL' || i.code === 'IP_INVALID') || sw.fields.ipAddress === '192.168.1.2');
  const cctv = plan.rows.cctv[0];
  assert.equal(cctv.fields.sameNetworkAsPc, null, '"Need to reconfirm" stays unknown');
  assert.equal(cctv.fields.recorderType, 'nvr');
  assert.equal(importer.parseBandwidth('1 Gbps').mbps, 1000);
  assert.equal(importer.parseBandwidth('100 Mbps').mbps, 100);
  assert.equal(importer.parseBandwidth('cepat').note, 'cepat');
});

test('plan: a secret-looking cell that reaches the server is dropped with a warning', () => {
  const plan = importer.buildPlan({
    isp: [{ rowNumber: 2, location: 'PFN Office', provider: 'Biznet', notes: 'wifi password: abc123' }],
    locationMap: { 'PFN Office': 3 },
  }, ctxWith());
  const row = plan.rows.isp[0];
  assert.equal(row.fields.notes, null);
  assert.ok(row.issues.some((i) => i.code === 'SECRET_DROPPED' && i.message === 'Catatan berisi kata sandi — tidak diimpor'));
  assert.equal(row.action, 'new');
});

test('plan: identity — serial, else (location, type, IP), else (location, type, brand/model) flagged for a manual check', () => {
  assert.equal(importer.identityOf('network', { serialNumber: ' abc ', locationId: 3 }).key, 's:ABC');
  assert.equal(importer.identityOf('network', { locationId: 3, deviceType: 'switch', ipAddress: '10.0.0.2' }).key, 'ip:3|switch|10.0.0.2');
  const weak = importer.identityOf('network', { locationId: 3, deviceType: 'switch', brandModel: 'NBS' });
  assert.equal(weak.weak, true);
  assert.equal(importer.identityOf('isp', { locationId: 3, providerName: 'Biznet', customerNumber: '1' }).key, '3|biznet|1');
  assert.equal(importer.identityOf('cctv', { locationId: 3, recorderType: 'nvr', cameraModel: 'DS' }).key, 'm:3|nvr|ds');
  // Duplicates inside the file are skipped.
  const plan = importer.buildPlan({
    network: [
      { rowNumber: 2, deviceType: 'Router', brandModel: 'Asus', serialNumber: 'X1', location: 'PFN Office' },
      { rowNumber: 3, deviceType: 'Router', brandModel: 'Asus', serialNumber: 'x1 ', location: 'PFN Office' },
    ],
    locationMap: { 'PFN Office': 3 },
  }, ctxWith());
  assert.deepEqual(plan.rows.network.map((r) => r.action), ['new', 'skip']);
});

test('plan: an existing row is "sudah ada" or "berbeda" with field diffs; an empty cell never clears', () => {
  const existing = {
    isp: [{ id: 9, location_id: 3, provider_name: 'Biznet', customer_number: '1000789826', bandwidth_mbps: 100, public_ip_dedicated: 0, is_backup: 0, notes: 'Atas nama kantor', version: 4 }],
  };
  const plan = importer.buildPlan({
    isp: [
      { rowNumber: 2, location: 'PFN Office', provider: 'Biznet', customerNumber: 1000789826, bandwidth: 150, dedicatedIp: 'No', backupIsp: 'No', notes: null },
    ],
    locationMap: { 'PFN Office': 3 },
  }, ctxWith(existing));
  const row = plan.rows.isp[0];
  assert.equal(row.action, 'different');
  assert.equal(row.matchId, 9);
  assert.equal(row.version, 4);
  assert.deepEqual(row.differences, [{ field: 'bandwidthMbps', label: 'Bandwidth (Mbps)', current: '100', incoming: '150' }]);
});

// ------------------------------------------------------------ against the database
let ready = null;
async function dbReady() {
  if (ready !== null) return ready;
  try {
    const conn = await Promise.race([pool.getConnection(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))]);
    try {
      const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'it_cctv_systems'");
      ready = Number(row.n) === 1;
    } finally { conn.release(); }
  } catch { ready = false; }
  return ready;
}

test('db: apply creates, links ISP and recorder, updates only ticked rows; re-import = 0 changes; apply re-validates the mapping', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  // Takes its turn with the other database tests (fixtures/gaDb.js `serialized`).
  await serialized(async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const [[user]] = await conn.query('SELECT id FROM users WHERE entity_id = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1');
    const [loc] = await conn.query("INSERT INTO org_locations (entity_id, name, kind) VALUES (1, 'Uji Impor PFN', 'office')");
    const L = Number(loc.insertId);
    const body = await bodyFromSheets({ 'PFN Office': L, 'PMK Office': null });
    const ctx = { entityId: 1, userId: Number(user.id) };

    const preview = await importer.preview(conn, 1, body);
    assert.deepEqual(preview.counts.network, { rows: 3, new: 2, exists: 0, different: 0, skip: 1 });
    assert.deepEqual(preview.skippedByLocation, { 'PMK Office': 3 });

    const applied = await importer.apply(conn, { ...ctx, body });
    assert.deepEqual(applied.created, { network: 2, isp: 1, cctv: 1 });
    assert.equal(applied.skipped, 3);

    const [[router]] = await conn.query("SELECT n.isp_link_id, l.provider_name FROM it_network_devices n JOIN it_isp_links l ON l.id = n.isp_link_id WHERE n.entity_id = 1 AND n.serial_key = 'RBIG67601092LR7'");
    assert.equal(router.provider_name, 'Biznet', 'network row linked to the ISP the same file created');
    const [[cctv]] = await conn.query("SELECT c.recorder_device_id, c.camera_count FROM it_cctv_systems c WHERE c.entity_id = 1 AND c.serial_number = 'GM4946749'");
    assert.equal(cctv.camera_count, 18);

    // Re-importing the same file changes nothing.
    const again = await importer.preview(conn, 1, body);
    for (const kind of ['isp', 'network', 'cctv']) {
      assert.equal(again.counts[kind].new, 0, kind);
      assert.equal(again.counts[kind].different, 0, kind);
    }
    const second = await importer.apply(conn, { ...ctx, body });
    assert.deepEqual(second.created, { network: 0, isp: 0, cctv: 0 });
    assert.deepEqual(second.updated, { network: 0, isp: 0, cctv: 0 });

    // A changed file: the row is "berbeda", and changes only when ticked.
    const changed = JSON.parse(JSON.stringify(body));
    changed.isp[0].bandwidth = '300 Mbps';
    const notTicked = await importer.apply(conn, { ...ctx, body: changed });
    assert.equal(notTicked.differentNotTicked, 1);
    let [[isp]] = await conn.query('SELECT bandwidth_mbps, version FROM it_isp_links WHERE entity_id = 1 AND location_id = ?', [L]);
    assert.equal(Number(isp.bandwidth_mbps), 150);
    await importer.apply(conn, { ...ctx, body: { ...changed, updates: ['isp:2'] } });
    [[isp]] = await conn.query('SELECT bandwidth_mbps, version FROM it_isp_links WHERE entity_id = 1 AND location_id = ?', [L]);
    assert.equal(Number(isp.bandwidth_mbps), 300);
    const [logs] = await conn.query("SELECT metadata FROM activity_logs WHERE action IN ('it_isp_link.update', 'it_network_device.create') AND entity_id = 1 ORDER BY id DESC LIMIT 5");
    assert.ok(logs.length >= 2);
    for (const l of logs) assert.doesNotMatch(JSON.stringify(l.metadata), /192\.168\.1\.\d/, 'no IP address in the log');

    // Apply re-validates the mapping: another entity's or an unknown location is refused.
    await assert.rejects(importer.apply(conn, { ...ctx, body: { ...body, locationMap: { 'PFN Office': 99999999 } } }), (e) => e.code === 'LOCATION_INVALID');
  } finally {
    await conn.rollback();
    conn.release();
  }
  });
});

test('the user device inventory is never read as network devices; a cell with two IPs keeps the first', async () => {
  const m = await model();
  const userSheet = [['No', 'Device Type', 'Brand / Model', 'Serial Number', 'Asset No.', 'Purchase Year', 'User Name', 'Location', 'Company', 'Status', 'Notes'], [1, 'Laptop', 'ThinkPad', 'X', 'A1', 2024, 'Budi', 'PFN Office', 'PFN', 'Active', null]];
  assert.equal(m.detectSheet(userSheet), null);
  const issues = [];
  const out = importer.normalizeNetwork({ deviceType: 'Router', brandModel: 'Asus', ipAddress: '192.168.10.1/\n203.0.113.7' }, issues);
  assert.equal(out.fields.ipAddress, '192.168.10.1');
  assert.ok(issues.some((i) => i.code === 'IP_EXTRA'));
  const registers = require('../src/services/itRegisters.service');
  assert.equal(registers.redactIp('router 192.168.1.1/24 dan fe80::1:2'), 'router [IP] dan [IP]');
});
