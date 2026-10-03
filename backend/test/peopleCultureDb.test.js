const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// This file talks to the local database: read its settings before the pool is created.
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const pool = require('../src/db/pool');
const { serialized } = require('./fixtures/gaDb');
const directory = require('../src/services/peopleDirectory.service');
const lifecycle = require('../src/services/deviceLifecycle.service');
const importer = require('../src/services/itAssetImport.service');
const { buildPlan } = require('../src/services/itAssetImportModel');
const hrga = require('../src/management/providers/hrga');
const it = require('../src/management/providers/it');
const { buildReport } = require('./fixtures/deviceReport');

// People & Culture wave 1 against the real local schema (migrations 106/107):
// every statement runs inside ONE transaction that is always rolled back, so
// no row is left behind. Skipped when no database with those migrations is
// reachable (e.g. CI without MySQL).

const ENV = { GOOGLE_ALLOWED_DOMAIN: 'prakasagroup.com,prakasafoods.com' };
let ready = null;

// The pool keeps the process alive otherwise.
test.after(() => pool.end());

async function dbReady() {
  if (ready !== null) return ready;
  try {
    const conn = await Promise.race([
      pool.getConnection(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    try {
      const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'status_changed_at'`,
      );
      const [[entity]] = await conn.query("SELECT id FROM entities WHERE id = 1 AND deleted_at IS NULL");
      ready = Number(row.n) === 1 && Boolean(entity);
    } finally { conn.release(); }
  } catch {
    ready = false;
  }
  return ready;
}

// Runs fn(conn) in a transaction that is rolled back whatever happens. The
// services' own pool calls are routed to the same connection, and their own
// "transactions" become part of this one.
async function inRolledBackTransaction(t, fn) {
  return serialized(() => rolledBack(t, fn));
}

// Takes its turn with the other database tests (fixtures/gaDb.js `serialized`):
// two long test transactions on the same tables deadlocked under parallel load.
async function rolledBack(t, fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  const shared = {
    query: (...args) => conn.query(...args),
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  };
  t.mock.method(pool, 'query', (...args) => conn.query(...args));
  t.mock.method(pool, 'getConnection', async () => shared);
  try {
    return await fn(conn);
  } finally {
    await conn.rollback();
    conn.release();
    pool.query.mock.restore();
    pool.getConnection.mock.restore();
  }
}

const expectSqlError = async (promise, code) => {
  await assert.rejects(promise, (e) => e.code === code, code);
};

test('db: the new tables and every column are utf8mb4_0900_ai_ci, like users and departments', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migrations 106/107');
  const [tables] = await pool.query(
    `SELECT table_name AS t, table_collation AS c FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN ('people_directory', 'org_locations', 'users', 'departments', 'devices')`,
  );
  for (const row of tables) assert.equal(row.c, 'utf8mb4_0900_ai_ci', row.t);
  const [cols] = await pool.query(
    `SELECT table_name AS t, column_name AS col, collation_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name IN ('people_directory', 'org_locations') AND collation_name IS NOT NULL`,
  );
  for (const row of cols) assert.equal(row.c, 'utf8mb4_0900_ai_ci', `${row.t}.${row.col}`);
});

test('db: exactly one holder per assignment, serial unique per entity (trimmed, uppercased), same-entity keys', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migrations 106/107');
  await inRolledBackTransaction(t, async (conn) => {
    const [loc] = await conn.query("INSERT INTO org_locations (entity_id, name) VALUES (1, '[UJI] Lokasi PC')");
    const [dev] = await conn.query("INSERT INTO devices (entity_id, device_type, serial_number, location_id) VALUES (1, 'laptop', 'uji-sn-1', ?)", [loc.insertId]);
    await expectSqlError(conn.query("INSERT INTO devices (entity_id, device_type, serial_number) VALUES (1, 'monitor', ' UJI-SN-1 ')"), 'ER_DUP_ENTRY');
    // A soft-deleted device frees its serial.
    await conn.query('UPDATE devices SET deleted_at = NOW() WHERE id = ?', [dev.insertId]);
    await conn.query("INSERT INTO devices (entity_id, device_type, serial_number) VALUES (1, 'monitor', 'UJI-SN-1')");
    // Asset numbers may repeat.
    await conn.query("INSERT INTO devices (entity_id, device_type, asset_code) VALUES (1, 'laptop', 'UJI/A/1'), (1, 'laptop', 'UJI/A/1')");

    await expectSqlError(conn.query('INSERT INTO device_assignments (entity_id, device_id) VALUES (1, ?)', [dev.insertId]), 'ER_CHECK_CONSTRAINT_VIOLATED');
    await expectSqlError(conn.query("INSERT INTO device_assignments (entity_id, device_id, assigned_to, holder_label) VALUES (1, ?, 1, 'x')", [dev.insertId]), 'ER_CHECK_CONSTRAINT_VIOLATED');
    await conn.query("INSERT INTO device_assignments (entity_id, device_id, holder_label) VALUES (1, ?, 'Ops Team')", [dev.insertId]);
    await expectSqlError(conn.query("UPDATE devices SET current_assignee_id = 1, holder_label = 'x' WHERE id = ?", [dev.insertId]), 'ER_CHECK_CONSTRAINT_VIOLATED');

    // Another entity's person or location can never be referenced.
    const [other] = await conn.query("INSERT INTO entities (name, brand_code) VALUES ('[UJI] Entitas Lain', 'UJI_PC_OTHER')");
    const [otherPerson] = await conn.query("INSERT INTO people_directory (entity_id, full_name) VALUES (?, '[UJI] Orang Lain')", [other.insertId]);
    const [mine] = await conn.query("INSERT INTO people_directory (entity_id, full_name) VALUES (1, '[UJI] Orang PFN')");
    await expectSqlError(conn.query('UPDATE people_directory SET manager_id = ? WHERE id = ?', [otherPerson.insertId, mine.insertId]), 'ER_NO_REFERENCED_ROW_2');
    await expectSqlError(conn.query('INSERT INTO device_assignments (entity_id, device_id, person_id) VALUES (1, ?, ?)', [dev.insertId, otherPerson.insertId]), 'ER_NO_REFERENCED_ROW_2');
    await expectSqlError(conn.query("INSERT INTO people_directory (entity_id, full_name, status) VALUES (1, '[UJI] X', 'resigned')"), 'ER_CHECK_CONSTRAINT_VIOLATED');
    await expectSqlError(conn.query("INSERT INTO people_directory (entity_id, full_name, kind) VALUES (1, '[UJI] Y', 'excluded')"), 'ER_CHECK_CONSTRAINT_VIOLATED');
    const [[key]] = await conn.query('SELECT name_key FROM people_directory WHERE id = ?', [mine.insertId]);
    assert.equal(key.name_key, '[uji] orang pfn');
  });
});

test('db: directory writes run for real — manager cycle refused, resign dated, account link, list and org chart', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migrations 106/107');
  await inRolledBackTransaction(t, async (conn) => {
    const a = await directory.createPerson(1, null, { name: '[UJI] Atasan PC' });
    const b = await directory.createPerson(1, null, { name: '[UJI] Staf PC', managerKey: a.key, position: 'Staf' });
    await assert.rejects(() => directory.update(1, null, a.key, { managerKey: b.key }), (e) => e.code === 'MANAGER_CYCLE');
    await assert.rejects(() => directory.update(1, null, a.key, { managerKey: a.key }), (e) => e.code === 'MANAGER_SELF');
    await directory.update(1, null, b.key, { status: 'resigned', resignedOn: '2026-09-20' });
    const [[row]] = await conn.query('SELECT status, DATE_FORMAT(resigned_on, "%Y-%m-%d") AS d, resigned_on_source FROM people_directory WHERE id = ?', [b.personId]);
    assert.deepEqual({ ...row }, { status: 'resigned', d: '2026-09-20', resigned_on_source: 'entered' });

    const summary = await directory.summary(1);
    assert.equal(typeof summary.headcount, 'number');
    const list = await directory.list(1, { q: '[UJI] Atasan' }, { canManage: false });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0].key, a.key);
    const resigned = await directory.list(1, { q: '[UJI] Staf', status: 'resigned' }, { canManage: true });
    assert.equal(resigned.rows[0].resignedOn, '2026-09-20');
    const org = await directory.orgChart(1);
    assert.ok(org.nodes.some((n) => n.key === a.key));
    const detail = await directory.detail(1, a.key, { canManage: true });
    assert.deepEqual(detail.directReports, [], 'a resigned report is not listed');
    // An account reviewed through its u-key gets its row.
    const [[account]] = await conn.query("SELECT id FROM users WHERE entity_id = 1 AND deleted_at IS NULL AND status = 'active' ORDER BY id LIMIT 1");
    const own = await directory.update(1, null, `u${account.id}`, { position: '[UJI] Jabatan' });
    const [[linked]] = await conn.query('SELECT user_id, full_name, work_email FROM people_directory WHERE id = ?', [own.personId]);
    assert.deepEqual({ ...linked }, { user_id: account.id, full_name: null, work_email: null });
    const [logs] = await conn.query("SELECT action FROM activity_logs WHERE subject_type = 'people_directory' AND subject_id IN (?, ?, ?)", [a.personId, b.personId, own.personId]);
    assert.ok(logs.length >= 4, 'every write logged in the same transaction');
  });
});

test('db: import apply, statuses, holders and the providers — company and each division, 0 errors', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migrations 106/107');
  await inRolledBackTransaction(t, async (conn) => {
    const payload = { ...buildReport(), createLocations: true };
    const preview = await importer.preview(1, payload, { db: conn, env: ENV });
    const out = await importer.apply(conn, { entityId: 1, actorId: null, env: ENV, payload: { ...payload, companyCode: 'PFN', fingerprint: preview.fingerprint } });
    assert.equal(out.devicesCreated, 10);
    assert.equal(out.assignmentsCreated, preview.devices.filter((d) => d.status === 'assigned' && d.holder).length);

    // Re-running the same file changes nothing.
    const again = await importer.preview(1, payload, { db: conn, env: ENV });
    assert.equal(again.counts.devices.new, 0);
    assert.equal(again.counts.devices.updatable, 0);

    const [[counts]] = await conn.query(
      `SELECT SUM(status = 'assigned') AS aktif, SUM(status = 'damaged') AS rusak,
              SUM(holder_label IS NOT NULL) AS labels, SUM(holder_person_id IS NOT NULL) AS persons
         FROM devices WHERE entity_id = 1 AND deleted_at IS NULL AND serial_key LIKE 'PF01SN%'`,
    );
    assert.equal(Number(counts.rusak), 1);
    assert.ok(Number(counts.labels) >= 2);

    // A status change through the one code path, then the management layer.
    const [[laptop]] = await conn.query("SELECT id, status FROM devices WHERE entity_id = 1 AND serial_key = 'PF01SN003' FOR UPDATE");
    await lifecycle.changeStatus(conn, { entityId: 1, device: { ...laptop, entity_id: 1 }, status: 'damaged', actorId: null });
    const [[closed]] = await conn.query("SELECT COUNT(*) AS n FROM device_assignments WHERE device_id = ? AND status = 'active'", [laptop.id]);
    assert.equal(Number(closed.n), 0);

    const [departments] = await conn.query('SELECT id FROM departments WHERE entity_id = 1 AND deleted_at IS NULL');
    for (const departmentId of [null, ...departments.map((d) => Number(d.id))]) {
      for (const provider of [hrga, it]) {
        for (const e of provider.escalations) {
          const items = await e.list(1, { departmentId });
          assert.ok(Array.isArray(items), e.key);
        }
        for (const k of provider.kpis) {
          const v = await k.value(1, { departmentId });
          // Wave 2 §4.5: the Google Workspace KPI reads "Belum ada review" (value null) until a first review.
          if (k.key === 'it_gws_risk_flags' && v.value === null) assert.equal(v.sub, 'Belum ada review');
          else assert.equal(typeof v.value, 'number', k.key);
        }
      }
    }
    const problematic = await it.kpis.find((k) => k.key === 'it_devices_problematic').value(1, { departmentId: null });
    assert.ok(problematic.value >= 2);

    // The IT dashboard and device list read the same rows.
    const dash = require('../src/controllers/itDashboard.controller');
    const devices = require('../src/controllers/devices.controller');
    const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
    const user = { sub: null, entityId: 1, permissions: [] };
    const r1 = res();
    await dash.summary({ query: {}, user }, r1, (e) => { throw e; });
    assert.ok(r1.body.data.devices.total >= 10);
    const r2 = res();
    await devices.list({ query: { problematic: '1', limit: '100' }, user }, r2, (e) => { throw e; });
    assert.ok(r2.body.data.every((d) => ['damaged', 'retired'].includes(d.status)));
    const r3 = res();
    await devices.exportRows({ query: {}, user }, r3, (e) => { throw e; });
    assert.ok(r3.body.data.rows.length >= 10);
    // The export imports back as the same devices.
    const roundTrip = buildPlan({ devices: [r3.body.data.columns, ...r3.body.data.rows], people: null }, await importer.loadContext(conn, 1), { entityCode: 'PFN', currentYear: 2026, env: ENV });
    assert.equal(roundTrip.counts.devices.new, 0);
  });
});
