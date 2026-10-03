const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Part of this file talks to the local database: read its settings before the pool is created.
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const pool = require('../src/db/pool');
const { serialized } = require('./fixtures/gaDb');
const registers = require('../src/services/itRegisters.service');
const secret = require('../src/services/secretText');
const config = require('../src/config/itInfra');
const it = require('../src/management/providers/it');
const infraItems = require('../src/management/itInfraItems');
const { validateProvider } = require('../src/management/contract');

// People & Culture wave 2, row 2.3 — IT infrastructure registers and company
// phone lines (docs/rancangan-people-culture-g2.md §4.1–4.6). Static checks
// first; the DB tests run every statement inside ONE transaction that is
// always rolled back, and are skipped without a database that has migration 110.

const ROOT = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(ROOT, 'migrations/110_it_registers.sql'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'src/routes/itInfrastructure.routes.js'), 'utf8');
const itRoutesSrc = fs.readFileSync(path.join(ROOT, 'src/routes/it.routes.js'), 'utf8');
const TABLES = ['it_isp_links', 'it_network_devices', 'it_cctv_systems', 'it_backup_jobs', 'it_backup_checks', 'it_gws_reviews', 'it_phone_lines'];

test.after(() => pool.end());

// ------------------------------------------------------------ migration 110
test('migration 110: new tables only, utf8mb4_0900_ai_ci, guarded ALTERs, no data change', () => {
  for (const table of TABLES) {
    const block = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`));
    assert.ok(block, `${table} is created idempotently with the collation`);
    assert.match(block[1], new RegExp(`UNIQUE KEY uq_${table}_entity_id \\(entity_id, id\\)`), `${table} UNIQUE (entity_id, id)`);
  }
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
  assert.doesNotMatch(migration, /^\s*(DELETE|UPDATE|TRUNCATE)\b/im, 'no existing data is changed');
  assert.match(migration, /ADD UNIQUE KEY uq_devices_entity_id \(entity_id, id\)/);
  assert.match(migration, /ADD UNIQUE KEY uq_software_vendors_entity_id \(entity_id, id\)/);
  assert.match(migration, /vendor_kind ENUM\('software','isp','cctv','network','hardware','service','other'\) NOT NULL DEFAULT 'software'/);
  assert.match(migration, /fk_hrga_task_phone FOREIGN KEY \(linked_phone_line_id\) REFERENCES it_phone_lines\(id\)/);
  // Every ALTER is behind an information_schema guard.
  const alters = migration.match(/ALTER TABLE/g).length;
  const guards = migration.match(/PREPARE stmt FROM @sql/g).length;
  assert.equal(alters, guards);
});

test('migration 110: no column for a password, username, login, PIN/PUK, ICCID or licence key', () => {
  const columns = [...migration.matchAll(/^\s{2}([a-z_]+) (?:INT|SMALLINT|VARCHAR|DECIMAL|DATE|TIMESTAMP|TINYINT|ENUM)/gm)].map((m) => m[1]);
  assert.ok(columns.length > 60);
  for (const c of columns) assert.doesNotMatch(c, /pass|sandi|user_?name|login|pin\b|puk|iccid|license|licence|secret|token|ssid/, c);
});

test('migration 110: enums equal the config lists', () => {
  const enumOf = (column) => migration.match(new RegExp(`\\b${column} ENUM\\(([^)]*)\\)`))[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual(enumOf('device_type'), [...config.NETWORK_TYPES]);
  assert.deepEqual(enumOf('recorder_type'), [...config.CCTV_RECORDERS]);
  assert.deepEqual(enumOf('frequency'), [...config.BACKUP_FREQUENCIES]);
  assert.deepEqual(enumOf('storage_location'), [...config.BACKUP_STORAGE]);
  assert.deepEqual(enumOf('last_result'), [...config.BACKUP_RESULTS]);
  assert.deepEqual(enumOf('kind'), [...config.PHONE_KINDS]);
  for (const [labels, list] of [[config.NETWORK_TYPE_LABELS, config.NETWORK_TYPES], [config.PHONE_STATUS_LABELS, config.PHONE_STATUSES], [config.VENDOR_KIND_LABELS, config.VENDOR_KINDS]]) {
    assert.deepEqual(Object.keys(labels).sort(), [...list].sort());
  }
});

test('permissions: it.infra.view for People & Culture member+, it.infra.manage for supervisor+ (migration mirrors standardOrganization)', () => {
  const { permissionsForStandardRole } = require('../src/config/standardOrganization');
  assert.ok(permissionsForStandardRole('people_culture.member').includes('it.infra.view'));
  assert.ok(!permissionsForStandardRole('people_culture.member').includes('it.infra.manage'));
  for (const role of ['people_culture.supervisor', 'people_culture.head']) {
    assert.ok(permissionsForStandardRole(role).includes('it.infra.view'), role);
    assert.ok(permissionsForStandardRole(role).includes('it.infra.manage'), role);
  }
  assert.ok(!permissionsForStandardRole('sales.head').includes('it.infra.view'));
  assert.match(migration, /p\.code = 'it\.infra\.view'\s+WHERE r\.deleted_at IS NULL AND r\.role_key IN \('people_culture\.member', 'people_culture\.supervisor', 'people_culture\.head'\)/);
  assert.match(migration, /p\.code = 'it\.infra\.manage'\s+WHERE r\.deleted_at IS NULL AND r\.role_key IN \('people_culture\.supervisor', 'people_culture\.head'\)/);
});

// ------------------------------------------------------------ routes
function routeTable() {
  const router = require('../src/routes/itInfrastructure.routes');
  return router.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    methods: Object.keys(l.route.methods),
    handles: l.route.stack.map((s) => s.handle),
  }));
}

test('routes: no DELETE anywhere; reads need it.infra.view, writes it.infra.manage, writes pass the secret guard', () => {
  const table = routeTable();
  assert.ok(table.length >= 20);
  for (const r of table) assert.ok(!r.methods.includes('delete'), `${r.path} has no DELETE`);
  assert.doesNotMatch(routesSrc, /router\.delete/);
  const reads = routesSrc.match(/router\.get\([^\n]*VIEW/g) || [];
  assert.ok(reads.length >= 4);
  // Every route's first guard: a viewer passes reads and is refused every write.
  const viewer = { user: { permissions: ['it.infra.view'] } };
  const nobody = { user: { permissions: ['device.view'] } };
  const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  for (const r of table) {
    const guard = r.handles[0];
    let passed = false;
    guard(viewer, res(), () => { passed = true; });
    assert.equal(passed, r.methods.includes('get'), `${r.methods} ${r.path}: viewer`);
    let other = false;
    const out = res();
    guard(nobody, out, () => { other = true; });
    assert.equal(other, false, `${r.path}: no access without it.infra.*`);
    assert.equal(out.statusCode, 403);
  }
  // registerRoutes adds guardSecretBody to every POST/PATCH it builds.
  assert.match(routesSrc, /router\.post\(`\/\$\{path\}`, MANAGE, validate\(createBody\(fields\)\), guardSecretBody\(\)/);
  assert.match(routesSrc, /router\.patch\(`\/\$\{path\}\/:id`, MANAGE, validate\(patchBody\(fields, patchExtra\)\), guardSecretBody\(\)/);
  assert.match(itRoutesSrc, /router\.use\('\/infrastructure', require\('\.\/itInfrastructure\.routes'\)\)/);
});

async function runValidation(pathName, method, body) {
  const layer = require('../src/routes/itInfrastructure.routes').stack.find((l) => l.route && l.route.path === pathName && l.route.methods[method]);
  assert.ok(layer, `${method} ${pathName}`);
  const req = { body, user: { permissions: ['it.infra.view', 'it.infra.manage'] } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  for (const s of layer.route.stack.slice(0, -1)) {
    let passed = false;
    await s.handle(req, res, () => { passed = true; });
    if (!passed) return res;
  }
  return { statusCode: 200, body: req.body };
}

test('routes: strict bodies — an unknown key (a password, a licence key) is a 400; every PATCH needs version', async () => {
  const bad = await runValidation('/network-devices', 'post', { locationId: 1, deviceType: 'router', brandModel: 'Asus', password: 'x' });
  assert.equal(bad.statusCode, 400);
  const noVersion = await runValidation('/network-devices/:id', 'patch', { notes: 'x' });
  assert.equal(noVersion.statusCode, 400);
  const ok = await runValidation('/network-devices/:id', 'patch', { notes: 'ganti switch', version: 3 });
  assert.equal(ok.statusCode, 200);
  const cctvStatusInPatch = await runValidation('/cctv/:id', 'patch', { status: 'offline', version: 1 });
  assert.equal(cctvStatusInPatch.statusCode, 400, 'CCTV status changes only through /status');
});

test('secret guard: every free-text field refuses written-down passwords (400 SECRET_TEXT)', async () => {
  for (const text of ['password: rahasia', 'Pass = 123', 'kata sandi: x', 'sandi=abc', 'PIN: 1234', 'puk : 5678', 'pwd=1']) {
    assert.ok(secret.looksSecret(text), text);
  }
  for (const text of ['Pinjam ruang rapat', 'Password WiFi diganti tiap bulan', 'NVR di ruang utama', 'Super admin 2']) {
    assert.ok(!secret.looksSecret(text), text);
  }
  const cases = [
    ['/network-devices', 'post', { locationId: 1, deviceType: 'router', brandModel: 'Asus', notes: 'admin password: admin123' }],
    ['/isp-links', 'post', { locationId: 1, providerName: 'Biznet', notes: 'Wifi pass: abc' }],
    ['/cctv', 'post', { locationId: 1, cameraCount: 4, recorderType: 'nvr', cameraModel: 'pin: 1' }],
    ['/backups', 'post', { dataScope: 'Finance', method: 'NAS sandi: x', frequency: 'daily', storageLocation: 'onsite' }],
    ['/phone-lines', 'post', { locationId: 1, kind: 'mobile', number: '0812', notes: 'PUK: 1234' }],
    ['/gws-reviews', 'post', { reviewedOn: '2026-09-01', activeUsers: 1, superAdmins: 1, mfaEnforced: true, externalSharingRestricted: true, sharedAccountsUsed: false, exUsersActive: 0, notes: 'recovery pwd= x' }],
    ['/backups/:id/checks', 'post', { checkedOn: '2026-09-01', result: 'ok', note: 'password: x' }],
    ['/cctv/:id/status', 'post', { status: 'offline', note: 'login pin: 1' }],
    ['/phone-lines/:id/holder', 'post', { holderLabel: 'Tim pin: 3' }],
  ];
  for (const [p, m, body] of cases) {
    const res = await runValidation(p, m, body);
    assert.equal(res.statusCode, 400, `${m} ${p}`);
    assert.equal(res.body.error.code, 'SECRET_TEXT', `${m} ${p}`);
  }
});

test('licence keys are neither accepted nor returned (S10)', async () => {
  const licenseLayer = require('../src/routes/it.routes').stack.find((l) => l.route && l.route.path === '/subscriptions/:id/licenses');
  const validateMw = licenseLayer.route.stack[1].handle;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  await validateMw({ body: { licenseKey: 'XXXX-YYYY', seatLabel: 'Seat 1' } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 400);
  const ctrl = fs.readFileSync(path.join(ROOT, 'src/controllers/subscriptionLicenses.controller.js'), 'utf8');
  assert.doesNotMatch(ctrl, /license_key/);
  const subs = fs.readFileSync(path.join(ROOT, 'src/controllers/softwareSubscriptions.controller.js'), 'utf8');
  assert.doesNotMatch(subs, /license_key AS licenseKey/);
  assert.match(subs, /AS hasLicenseKey/);
  // The detail answer carries hasLicenseKey only.
  const controller = require('../src/controllers/softwareSubscriptions.controller');
  const calls = [];
  const original = pool.query;
  pool.query = async (sql) => {
    calls.push(sql);
    if (/FROM software_subscriptions s/.test(sql)) return [[{ id: 5, product_name: 'Figma' }]];
    if (/FROM subscription_licenses l/.test(sql)) return [[{ id: 1, hasLicenseKey: 1, seatLabel: 'Seat 1' }]];
    return [[]];
  };
  const out = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  try {
    await controller.detail({ params: { id: 5 }, user: { entityId: 1 } }, out, (e) => { throw e; });
  } finally { pool.query = original; }
  assert.deepEqual(out.body.data.licenses, [{ id: 1, hasLicenseKey: true, seatLabel: 'Seat 1' }]);
  assert.doesNotMatch(JSON.stringify(out.body), /licenseKey"/);
});

// ------------------------------------------------------------ pure helpers
test('phone numbers are normalised to +62…; extensions are digits', () => {
  for (const raw of ['0812-3456-7890', '62 812 3456 7890', '+62 812 3456 7890', '(0812) 3456.7890', '812 3456 7890']) {
    assert.equal(registers.normalizePhone(raw), '+6281234567890', raw);
  }
  assert.equal(registers.normalizePhone('+65 6123 4567'), '+6561234567');
  assert.equal(registers.normalizePhone(''), null);
  assert.throws(() => registers.normalizePhone('08ab'), (e) => e.code === 'NUMBER_INVALID');
  assert.throws(() => registers.normalizePhone('0812'), (e) => e.code === 'NUMBER_INVALID');
  assert.equal(registers.normalizeExtension(' 102 '), '102');
  assert.throws(() => registers.normalizeExtension('10a'), (e) => e.code === 'EXTENSION_INVALID');
  assert.equal(registers.normalizeIp(' 192.168.1.1 '), '192.168.1.1');
  assert.equal(registers.normalizeIp('fe80::1'), 'fe80::1');
  assert.throws(() => registers.normalizeIp('192.168.1.300'), (e) => e.code === 'IP_INVALID');
});

test('Google Workspace risk flags: MFA, sharing, shared accounts, ex-users, overdue review', () => {
  const base = { reviewedOn: '2026-09-01', mfaEnforced: true, externalSharingRestricted: true, sharedAccountsUsed: false, exUsersActive: 0 };
  assert.deepEqual(registers.gwsRiskFlags(base, '2026-10-01'), []);
  const all = registers.gwsRiskFlags({ ...base, mfaEnforced: false, externalSharingRestricted: false, sharedAccountsUsed: true, exUsersActive: 2, reviewedOn: '2026-05-01' }, '2026-10-01');
  assert.deepEqual(all.map((f) => f.key), ['mfa', 'sharing', 'shared_accounts', 'ex_users', 'overdue']);
});

test('IT dashboard block: counts only — no IP address, cost or serial number', async () => {
  const calls = [];
  const db = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (/FROM it_gws_reviews/.test(sql)) return [[{ id: 1, reviewed_on: new Date('2026-09-01T00:00:00Z'), active_users: 34, super_admins: 2, mfa_enforced: 1, external_sharing_restricted: 1, shared_accounts_used: 0, ex_users_active: 0 }]];
      return [[{ total: '2', active: '2', primary_mbps: '150', cameras: '18', systems: '1' }]];
    },
  };
  const block = await registers.infrastructureBlock(db, 1);
  const text = JSON.stringify(block);
  assert.doesNotMatch(text, /ip_?address|ipAddress|cost|serial|customer/i);
  for (const c of calls) {
    assert.equal(c.args[0], 1, 'entity bound');
    assert.doesNotMatch(c.sql, /ip_address|monthly_cost|serial_number|customer_number/);
  }
  assert.equal(block.gws.mfaEnforced, true);
});

test('management: claims /it/infrastructure; new sources fit their columns; no IP/cost/serial in any SQL', () => {
  assert.doesNotThrow(() => validateProvider(it));
  assert.ok(it.navPaths.includes('/it/infrastructure'));
  const keys = [...infraItems.escalations.map((e) => e.key)];
  assert.deepEqual(keys, ['it_isp_contract_ending', 'it_backup_unverified', 'it_cctv_offline', 'it_gws_review_overdue']);
  for (const k of keys) assert.ok(k.length <= 32, k);
  assert.deepEqual(infraItems.metrics.map((m) => m.key), ['it_backup_checks']);
  assert.deepEqual(infraItems.kpis.map((k) => k.key), ['it_cctv_cameras', 'it_bandwidth_mbps', 'it_backup_health', 'it_gws_risk_flags', 'it_phone_lines_active']);
  const src = fs.readFileSync(path.join(ROOT, 'src/management/itInfraItems.js'), 'utf8');
  assert.doesNotMatch(src, /ip_address|monthly_cost|serial_number|customer_number/);
  assert.equal(infraItems.ISP_DECISION_DAYS, 30);
  assert.deepEqual({ ...infraItems.CHECK_DAYS }, { daily: 3, weekly: 10, monthly: 35, other: 35 });
  assert.equal(infraItems.CCTV_OFFLINE_DAYS, 2);
  assert.equal(infraItems.GWS_REVIEW_DAYS, 90);
});

test('management: a renewed contract, a new failure or a new outage is a new episode', async (t) => {
  const rows = {
    isp: { id: 7, provider_name: 'Biznet', is_backup: 0, department_id: 6, contract_end: '2026-10-20', since: '2026-09-20', end_day: '9789', days_late: '11' },
    backup: { id: 8, data_scope: 'Finance', frequency: 'daily', department_id: 6, failing: 1, since: '2026-09-28', since_day: '9767', days_late: '3' },
    cctv: { id: 9, status: 'offline', camera_count: 18, cameras_offline: 18, department_id: 6, since: '2026-09-25', since_day: '9764', days_late: '4' },
  };
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM it_isp_links/.test(sql)) return [[rows.isp]];
    if (/FROM it_backup_jobs/.test(sql)) return [[rows.backup]];
    if (/FROM it_cctv_systems/.test(sql)) return [[rows.cctv]];
    return [[]];
  });
  const [isp, backup, cctv] = infraItems.escalations;
  assert.equal((await isp.list(1, { departmentId: null }))[0].sourceId, 7 * 100000 + 9789);
  assert.equal((await backup.list(1, { departmentId: null }))[0].sourceId, 8 * 100000 + 9767);
  assert.equal((await cctv.list(1, { departmentId: null }))[0].sourceId, 9 * 100000 + 9764);
  assert.equal((await isp.list(1, { departmentId: null }))[0].link, '/it/infrastructure?tab=isp&open=7');
});

// ------------------------------------------------------------ against the database
let ready = null;
async function dbReady() {
  if (ready !== null) return ready;
  try {
    const conn = await Promise.race([
      pool.getConnection(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    try {
      const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'it_phone_lines'");
      const [[pc]] = await conn.query("SELECT id FROM departments WHERE entity_id = 1 AND code = 'people_culture' AND deleted_at IS NULL");
      ready = Number(row.n) === 1 && Boolean(pc);
    } finally { conn.release(); }
  } catch { ready = false; }
  return ready;
}

// Takes its turn with the other database tests (fixtures/gaDb.js `serialized`):
// two long test transactions on the same tables deadlocked under parallel load.
async function rolledBack(t, fn) {
  return serialized(() => rolledBackNow(t, fn));
}

async function rolledBackNow(t, fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  const shared = { query: (...a) => conn.query(...a), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  t.mock.method(pool, 'query', (...a) => conn.query(...a));
  t.mock.method(pool, 'getConnection', async () => shared);
  try { return await fn(conn); } finally {
    await conn.rollback(); conn.release();
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
}

async function setup(conn) {
  const [[user]] = await conn.query('SELECT id FROM users WHERE entity_id = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1');
  const [loc] = await conn.query("INSERT INTO org_locations (entity_id, name, kind) VALUES (1, 'Uji Register Office', 'office')");
  const [ent] = await conn.query("INSERT INTO entities (name, brand_code) VALUES ('Entitas uji register', 'TSTREG110')");
  const [otherLoc] = await conn.query("INSERT INTO org_locations (entity_id, name, kind) VALUES (?, 'Kantor entitas lain', 'office')", [ent.insertId]);
  const [person] = await conn.query("INSERT INTO people_directory (entity_id, full_name, kind) VALUES (1, 'Orang Uji Register', 'employee')");
  const [otherPerson] = await conn.query("INSERT INTO people_directory (entity_id, full_name, kind) VALUES (?, 'Orang entitas lain', 'employee')", [ent.insertId]);
  return { userId: Number(user.id), L: Number(loc.insertId), otherEntity: Number(ent.insertId), otherL: Number(otherLoc.insertId), personId: Number(person.insertId), otherPersonId: Number(otherPerson.insertId) };
}

const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code, code);

test('db: entity scope on every read and write; composite keys refuse another entity', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    const id = await registers.createRow(conn, { ...ctx, key: 'network', body: { locationId: s.L, deviceType: 'router', brandModel: 'Asus AX6000', serialNumber: 'sn-1' } });
    const [[row]] = await conn.query('SELECT department_id FROM it_network_devices WHERE id = ?', [id]);
    const [[pc]] = await conn.query("SELECT id FROM departments WHERE entity_id = 1 AND code = 'people_culture'");
    assert.equal(Number(row.department_id), Number(pc.id), 'owned by People & Culture');
    assert.equal(await registers.getRow(conn, s.otherEntity, 'network', id), null, 'another entity reads not found');
    assert.deepEqual(await registers.listRows(conn, s.otherEntity, 'network'), []);
    await rejects(registers.updateRow(conn, { entityId: s.otherEntity, userId: s.userId, key: 'network', id, body: { version: 1, notes: 'x' } }), 'NOT_FOUND');
    // Another entity's location, person or row cannot be referenced.
    await rejects(registers.createRow(conn, { ...ctx, key: 'isp', body: { locationId: s.otherL, providerName: 'Biznet' } }), 'LOCATION_INVALID');
    const line = await registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '081200000001' } });
    await rejects(registers.setPhoneLineHolder(conn, { ...ctx, id: line, personId: s.otherPersonId }), 'PERSON_INVALID');
    // …and the database refuses it too, whatever the service does.
    await assert.rejects(conn.query('UPDATE it_phone_lines SET person_id = ?, status = \'active\' WHERE id = ?', [s.otherPersonId, line]), (e) => e.code === 'ER_NO_REFERENCED_ROW_2');
    await assert.rejects(conn.query('UPDATE it_network_devices SET location_id = ? WHERE id = ?', [s.otherL, id]), (e) => e.code === 'ER_NO_REFERENCED_ROW_2');
    const [vendor] = await conn.query("INSERT INTO software_vendors (entity_id, name, vendor_kind) VALUES (?, 'ISP lain', 'isp')", [s.otherEntity]);
    await rejects(registers.createRow(conn, { ...ctx, key: 'isp', body: { locationId: s.L, providerName: 'X', vendorId: vendor.insertId } }), 'REFERENCE_INVALID');
    const [device] = await conn.query("INSERT INTO devices (entity_id, device_type, status) VALUES (?, 'smartphone', 'available')", [s.otherEntity]);
    await rejects(registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '081200000002', deviceId: device.insertId } }), 'REFERENCE_INVALID');
  });
});

test('db: version conflicts, status_changed_at, serial unique per entity', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    const id = await registers.createRow(conn, { ...ctx, key: 'network', body: { locationId: s.L, deviceType: 'switch', brandModel: 'NBS3100', serialNumber: ' giu92x ' } });
    await conn.query('UPDATE it_network_devices SET status_changed_at = \'2026-01-01 00:00:00\' WHERE id = ?', [id]);
    const out = await registers.updateRow(conn, { ...ctx, key: 'network', id, body: { version: 1, notes: 'pindah rak' } });
    assert.equal(out.version, 2);
    let [[row]] = await conn.query('SELECT status_changed_at FROM it_network_devices WHERE id = ?', [id]);
    assert.equal(new Date(row.status_changed_at).toISOString().slice(0, 10), '2026-01-01', 'notes do not restart the status clock');
    await rejects(registers.updateRow(conn, { ...ctx, key: 'network', id, body: { version: 1, notes: 'basi' } }), 'VERSION_CONFLICT');
    await registers.updateRow(conn, { ...ctx, key: 'network', id, body: { version: 2, status: 'damaged' } });
    [[row]] = await conn.query('SELECT status_changed_at, status FROM it_network_devices WHERE id = ?', [id]);
    assert.equal(row.status, 'damaged');
    assert.notEqual(new Date(row.status_changed_at).toISOString().slice(0, 10), '2026-01-01');
    await rejects(registers.createRow(conn, { ...ctx, key: 'network', body: { locationId: s.L, deviceType: 'switch', brandModel: 'Lain', serialNumber: 'GIU92X' } }), 'SERIAL_TAKEN');
    await rejects(registers.createRow(conn, { ...ctx, key: 'network', body: { locationId: s.L, deviceType: 'router', brandModel: 'X', ipAddress: '999.1.1.1' } }), 'IP_INVALID');
    // The activity log never holds an IP address.
    await registers.updateRow(conn, { ...ctx, key: 'network', id, body: { version: 3, ipAddress: '10.20.30.40' } });
    const [logs] = await conn.query("SELECT metadata FROM activity_logs WHERE subject_type = 'it_network_device' AND subject_id = ?", [id]);
    assert.ok(logs.length >= 3);
    for (const l of logs) assert.doesNotMatch(JSON.stringify(l.metadata), /10\.20\.30\.40/);
  });
});

test('db: phone lines — normalised, unique among lines not terminated, holder rules', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    const a = await registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '0812-9999-0001' } });
    assert.equal((await registers.getRow(conn, 1, 'phone', a)).number, '+6281299990001');
    assert.equal((await registers.getRow(conn, 1, 'phone', a)).status, 'spare');
    await rejects(registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '+62 812 9999 0001' } }), 'NUMBER_TAKEN');
    await rejects(registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile' } }), 'NUMBER_REQUIRED');
    await rejects(registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '081299990009', status: 'active' } }), 'HOLDER_REQUIRED');
    // Holder: a person → Aktif; nobody → Cadangan; both at once is refused.
    let out = await registers.setPhoneLineHolder(conn, { ...ctx, id: a, personId: s.personId });
    assert.equal(out.status, 'active');
    await rejects(registers.setPhoneLineHolder(conn, { ...ctx, id: a, personId: s.personId, holderLabel: 'Tim' }), 'VALIDATION_ERROR');
    await rejects(registers.updateRow(conn, { ...ctx, key: 'phone', id: a, body: { version: 1, notes: 'x' } }), 'VERSION_CONFLICT');
    out = await registers.setPhoneLineHolder(conn, { ...ctx, id: a, holderLabel: null, personId: null });
    assert.equal(out.status, 'spare');
    // The database keeps the rules on its own.
    await assert.rejects(conn.query("UPDATE it_phone_lines SET status = 'active' WHERE id = ?", [a]), (e) => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    await assert.rejects(conn.query("UPDATE it_phone_lines SET person_id = ?, holder_label = 'Tim' WHERE id = ?", [s.personId, a]), (e) => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    // Terminated frees the number for a new line; a terminated line takes no holder.
    const line = await registers.getRow(conn, 1, 'phone', a);
    await registers.updateRow(conn, { ...ctx, key: 'phone', id: a, body: { version: line.version, status: 'terminated' } });
    await registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'mobile', number: '081299990001' } });
    await rejects(registers.setPhoneLineHolder(conn, { ...ctx, id: a, holderLabel: 'Tim' }), 'LINE_TERMINATED');
    // A person's active lines (directory profile): number/extension only.
    const ext = await registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'ip_phone', extension: '102', monthlyCost: 50000 } });
    await registers.setPhoneLineHolder(conn, { ...ctx, id: ext, personId: s.personId });
    const lines = await registers.companyLinesForPerson(conn, 1, s.personId);
    assert.deepEqual(lines.map((l) => Object.keys(l).sort()), [['extension', 'id', 'kind', 'kindLabel', 'number']]);
    await rejects(registers.createRow(conn, { ...ctx, key: 'phone', body: { locationId: s.L, kind: 'ip_phone', extension: '102' } }), 'EXTENSION_TAKEN');
  });
});

test('db: a backup check updates its job in the same transaction; an older check does not move "last"', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    const job = await registers.createRow(conn, { ...ctx, key: 'backup', body: { dataScope: 'Folder Finance', method: 'Google Drive', frequency: 'weekly', storageLocation: 'cloud' } });
    await registers.addBackupCheck(conn, { ...ctx, jobId: job, checkedOn: '2026-09-20', result: 'failed', restoreTested: false });
    let row = await registers.getRow(conn, 1, 'backup', job);
    assert.equal(row.lastCheckedOn, '2026-09-20');
    assert.equal(row.lastResult, 'failed');
    await registers.addBackupCheck(conn, { ...ctx, jobId: job, checkedOn: '2026-09-10', result: 'ok', restoreTested: true });
    row = await registers.getRow(conn, 1, 'backup', job);
    assert.equal(row.lastResult, 'failed', 'a backdated check keeps the latest result');
    assert.equal(row.restoreTestedOn, '2026-09-10');
    assert.equal(row.checkCount, 2);
    await rejects(registers.addBackupCheck(conn, { ...ctx, jobId: job, checkedOn: '2999-01-01', result: 'ok' }), 'DATE_IN_FUTURE');
    await rejects(registers.addBackupCheck(conn, { entityId: s.otherEntity, userId: s.userId, jobId: job, checkedOn: '2026-09-21', result: 'ok' }), 'NOT_FOUND');
    const history = await registers.listBackupChecks(conn, 1, job);
    assert.deepEqual(history.map((c) => c.checkedOn), ['2026-09-20', '2026-09-10']);
  });
});

test('db: Google Workspace reviews are append-only snapshots', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  assert.equal(typeof registers.updateGwsReview, 'undefined');
  assert.doesNotMatch(routesSrc, /router\.(patch|put|delete)\('\/gws-reviews/);
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    const body = { reviewedOn: '2026-06-01', activeUsers: 34, superAdmins: 2, mfaEnforced: false, externalSharingRestricted: true, sharedAccountsUsed: false, exUsersActive: 1 };
    await registers.addGwsReview(conn, { ...ctx, body });
    await registers.addGwsReview(conn, { ...ctx, body: { ...body, reviewedOn: '2026-09-01', mfaEnforced: true, exUsersActive: 0 } });
    const list = await registers.listGwsReviews(conn, 1);
    assert.equal(list.length >= 2, true);
    assert.equal(list[0].reviewedOn, '2026-09-01');
    await rejects(registers.addGwsReview(conn, { ...ctx, body: { ...body, superAdmins: 40 } }), 'VALIDATION_ERROR');
  });
});

test('db: providers for the company and each division run with 0 errors on real rows', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 110');
  await rolledBack(t, async (conn) => {
    const s = await setup(conn);
    const ctx = { entityId: 1, userId: s.userId };
    await registers.createRow(conn, { ...ctx, key: 'isp', body: { locationId: s.L, providerName: 'Biznet', bandwidthMbps: 150, contractEnd: '2026-10-10' } });
    const cctv = await registers.createRow(conn, { ...ctx, key: 'cctv', body: { locationId: s.L, cameraCount: 18, recorderType: 'nvr' } });
    await registers.setCctvStatus(conn, { ...ctx, id: cctv, status: 'offline' });
    await conn.query("UPDATE it_cctv_systems SET status_changed_at = UTC_TIMESTAMP() - INTERVAL 5 DAY WHERE id = ?", [cctv]);
    const job = await registers.createRow(conn, { ...ctx, key: 'backup', body: { dataScope: 'NAS', method: 'Rsync', frequency: 'daily', storageLocation: 'onsite' } });
    await registers.addBackupCheck(conn, { ...ctx, jobId: job, checkedOn: '2026-09-01', result: 'ok' });
    await registers.addGwsReview(conn, { ...ctx, body: { reviewedOn: '2026-05-01', activeUsers: 34, superAdmins: 2, mfaEnforced: true, externalSharingRestricted: true, sharedAccountsUsed: false, exUsersActive: 0 } });
    const [departments] = await conn.query('SELECT id FROM departments WHERE entity_id = 1 AND deleted_at IS NULL');
    const keys = new Set();
    for (const departmentId of [null, ...departments.map((d) => Number(d.id))]) {
      for (const e of infraItems.escalations) {
        const items = await e.list(1, { departmentId });
        for (const item of items) {
          keys.add(e.key);
          assert.deepEqual(await e.locate(item.sourceId), { entityId: 1, departmentId: item.departmentId });
        }
      }
      for (const k of infraItems.kpis) {
        const v = await k.value(1, { departmentId });
        assert.ok(v.value === null || typeof v.value === 'number', k.key);
      }
      for (const m of infraItems.metrics) assert.ok((await m.actuals(1, { start: '2026-09-01', end: '2026-09-30' }, { departmentId })) instanceof Map);
    }
    for (const key of ['it_isp_contract_ending', 'it_backup_unverified', 'it_cctv_offline', 'it_gws_review_overdue']) assert.ok(keys.has(key), key);
  });
});
