// Layanan GA tests against the real local schema (migration 109). Everything
// written runs inside ONE transaction that is always rolled back; the
// services' own pool calls and "transactions" are routed onto it.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('./refuseProduction');
const mysql = require('mysql2/promise');
const pool = require('../../src/db/pool');
const { buildDbConnectionConfig } = require('../../src/db/connectionConfig');

let ready = null;

async function dbReady() {
  if (ready !== null) return ready;
  try {
    const conn = await Promise.race([
      pool.getConnection(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    try {
      const [[row]] = await conn.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('ga_resources', 'ga_requests', 'ga_bookings')",
      );
      const [[matrix]] = await conn.query("SELECT COUNT(*) AS n FROM approval_matrix WHERE request_type IN ('ga_vehicle_booking', 'ga_request_other') AND is_active = 1");
      ready = Number(row.n) === 3 && Number(matrix.n) === 2;
    } finally { conn.release(); }
  } catch {
    ready = false;
  }
  return ready;
}

// node --test runs files in parallel processes. A test transaction stays open
// for the whole test (then rolls back), so the locks it took on GA rows would
// make another file's test wait; GA database tests therefore take turns,
// through a named lock held on a connection of its own.
// The other files that keep ONE long transaction on the shared local database
// (fixtures/hrgaDbHarness.js, peopleCultureDb, itRegisters, itInfraImport) take
// the same turn: left outside, one of them and a GA test locked the end of
// people_directory's and approval_steps' indexes in opposite order and MySQL
// rolled one back (ER_LOCK_DEADLOCK, 2 Oct 2026).
// Gates still waiting for their turn: shutdown() closes them, so a test that
// was cancelled (timeout) while waiting never keeps the process alive.
const gates = new Set();

async function serialized(fn) {
  const gate = await mysql.createConnection(buildDbConnectionConfig());
  gates.add(gate);
  try {
    await gate.query("SELECT GET_LOCK('uji:ga-db-tests', 300)");
    return await fn();
  } finally {
    gates.delete(gate);
    await gate.end().catch(() => gate.destroy());
  }
}

/**
 * For `test.after`: closes whatever a cancelled test left open (a gate still
 * waiting for the lock, the pool), so the file always ends. Safe to call twice.
 */
async function shutdown() {
  for (const gate of gates) { try { gate.destroy(); } catch { /* already closed */ } }
  gates.clear();
  await Promise.race([
    pool.end().catch(() => {}),
    new Promise((resolve) => { setTimeout(resolve, 5000).unref(); }),
  ]);
}

async function inRolledBackTransaction(t, fn) {
  return serialized(() => rolledBack(t, fn));
}

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
    try { await conn.query('SELECT RELEASE_ALL_LOCKS()'); } catch { /* ignore */ }
    conn.release();
    pool.query.mock.restore();
    pool.getConnection.mock.restore();
  }
}

let seq = 0;
const tag = () => `${process.pid}-${Date.now()}-${(seq += 1)}`;

async function departmentId(conn, code) {
  const [[row]] = await conn.query('SELECT id FROM departments WHERE entity_id = 1 AND code = ? AND deleted_at IS NULL LIMIT 1', [code]);
  return row ? Number(row.id) : null;
}

/** The signed-in user object the services receive (as requireAuth builds it). */
async function asUser(conn, userId) {
  const [[u]] = await conn.query('SELECT id, entity_id, department_id FROM users WHERE id = ?', [userId]);
  const [perms] = await conn.query(
    `SELECT DISTINCT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?`,
    [userId],
  );
  return { sub: Number(u.id), entityId: Number(u.entity_id), departmentId: u.department_id != null ? Number(u.department_id) : null, permissions: perms.map((p) => p.code) };
}

/** A fictional account with standard roles (by role_key) in the given division. */
async function makeUser(conn, { name = 'Uji GA', division = null, roles = [], managerPersonId = null, excluded = false, withPerson = true } = {}) {
  const dept = division ? await departmentId(conn, division) : null;
  const [created] = await conn.query(
    "INSERT INTO users (entity_id, department_id, name, email, status) VALUES (1, ?, ?, ?, 'active')",
    [dept, `[UJI] ${name}`, `uji-ga-${tag()}@uji.invalid`],
  );
  const id = created.insertId;
  for (const key of roles) {
    const [[role]] = await conn.query('SELECT id FROM roles WHERE entity_id = 1 AND role_key = ? AND deleted_at IS NULL', [key]);
    await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, role.id]);
  }
  let personId = null;
  if (withPerson) {
    const [p] = await conn.query(
      'INSERT INTO people_directory (entity_id, user_id, kind, excluded_reason, manager_id) VALUES (1, ?, ?, ?, ?)',
      [id, excluded ? 'excluded' : 'employee', excluded ? 'Akun uji' : null, managerPersonId],
    );
    personId = p.insertId;
  }
  return { id, personId, user: await asUser(conn, id) };
}

async function makeLocation(conn, name = 'Lokasi GA') {
  const [loc] = await conn.query('INSERT INTO org_locations (entity_id, name) VALUES (1, ?)', [`[UJI] ${name} ${tag()}`]);
  return loc.insertId;
}

async function makeResource(conn, { kind = 'room', locationId, name = null, plate = null }) {
  const [res] = await conn.query(
    'INSERT INTO ga_resources (entity_id, location_id, kind, name, capacity, plate_number) VALUES (1, ?, ?, ?, ?, ?)',
    [locationId, kind, name || `[UJI] ${kind} ${tag()}`, kind === 'room' ? 8 : null, kind === 'vehicle' ? (plate || `B ${Math.floor(Math.random() * 9000) + 1000} UJI${seq}`) : null],
  );
  return res.insertId;
}

// A WIB wall-clock time n days from now, on a 15-minute step: at(1, '09:00').
function at(daysFromNow, hhmm) {
  const day = new Date(Date.now() + 7 * 3600e3 + daysFromNow * 86400e3).toISOString().slice(0, 10);
  return `${day}T${hhmm}:00+07:00`;
}

module.exports = {
  shutdown, pool, serialized, dbReady, inRolledBackTransaction, makeUser, makeLocation, makeResource, asUser, departmentId, at, tag };
