// Shared harness for the onboarding/offboarding database tests (wave 2, row 2.1).
// Every statement runs inside ONE transaction on the local database that is
// always rolled back. The services' own transactions become savepoints, so a
// failed decision really undoes its half (as a real rollback would) without
// ending the outer transaction. Skipped when no database with migration 108.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('./refuseProduction');
const pool = require('../../src/db/pool');
const { loadUser } = require('../../src/middleware/requireAuth');
const { serialized } = require('./gaDb');

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
        `SELECT COUNT(*) AS n FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'hrga_workflows' AND column_name = 'open_person_key'`,
      );
      const [[entity]] = await conn.query('SELECT id FROM entities WHERE id = 1 AND deleted_at IS NULL');
      ready = Number(row.n) === 1 && Boolean(entity);
    } finally { conn.release(); }
  } catch {
    ready = false;
  }
  return ready;
}

// Takes its turn with the other database tests (fixtures/gaDb.js `serialized`):
// two long test transactions on the same tables deadlocked under parallel load.
async function inRolledBackTransaction(t, fn) {
  return serialized(() => rolledBack(t, fn));
}

async function rolledBack(t, fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  let depth = 0;
  const shared = {
    query: (...args) => conn.query(...args),
    beginTransaction: async () => { depth += 1; await conn.query(`SAVEPOINT sp_${depth}`); },
    commit: async () => { if (depth > 0) { await conn.query(`RELEASE SAVEPOINT sp_${depth}`); depth -= 1; } },
    rollback: async () => { if (depth > 0) { await conn.query(`ROLLBACK TO SAVEPOINT sp_${depth}`); depth -= 1; } },
    release: () => {},
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

let seq = 0;
/** A test account of entity 1 with the given system roles; returns the request user. */
async function makeUser(conn, { name, departmentCode = null, roles = [] }) {
  seq += 1;
  const [[dept]] = departmentCode
    ? await conn.query('SELECT id FROM departments WHERE entity_id = 1 AND code = ? AND deleted_at IS NULL LIMIT 1', [departmentCode])
    : [[null]];
  const [ins] = await conn.query(
    "INSERT INTO users (entity_id, department_id, name, email, status) VALUES (1, ?, ?, ?, 'active')",
    [dept ? dept.id : null, name, `hrga.uji.${process.pid}.${seq}@prakasafoods.com`],
  );
  for (const key of roles) {
    const [[role]] = await conn.query('SELECT id FROM roles WHERE entity_id = 1 AND role_key = ? AND deleted_at IS NULL', [key]);
    if (!role) throw new Error(`role ${key} missing`);
    await conn.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [ins.insertId, role.id]);
  }
  const loaded = await loadUser(ins.insertId);
  return { sub: Number(ins.insertId), entityId: 1, departmentId: loaded.department_id, permissions: loaded.permissions, name };
}

/** A transaction context for the service on the shared connection. */
function txOf(conn) {
  return { conn, effects: [], cleanups: [] };
}

async function runTx(conn, fn) {
  const tx = txOf(conn);
  await conn.query('SAVEPOINT svc');
  try {
    const out = await fn(tx);
    for (const effect of tx.effects) await effect();
    return out;
  } catch (e) {
    await conn.query('ROLLBACK TO SAVEPOINT svc');
    throw e;
  } finally {
    for (const c of tx.cleanups) await c();
  }
}

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

module.exports = { pool, dbReady, inRolledBackTransaction, makeUser, txOf, runTx, res };
