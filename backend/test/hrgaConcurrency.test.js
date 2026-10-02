const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const mysql = require('mysql2/promise');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('../src/db/connectionConfig');
const svc = require('../src/services/hrgaWorkflow.service');

// Concurrency (critique D1, D3) needs real commits on separate connections, so
// it runs in a throw-away database with copies of the tables involved (same
// columns, keys and checks; no rows from the real database), dropped at the end.

const SCRATCH = `pwos_hrga_cc_${process.pid}`;
const TABLES = ['departments', 'users', 'settings', 'activity_logs', 'people_directory', 'hrga_workflows', 'hrga_workflow_tasks'];
let admin = null;
let scratch = null;

async function setup() {
  const config = buildDbConnectionConfig();
  const source = config.database;
  try {
    admin = await mysql.createConnection({ ...config, multipleStatements: false });
    const [[has]] = await admin.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'hrga_workflows' AND column_name = 'open_person_key'",
      [source],
    );
    if (!Number(has.n)) return false;
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
  } catch {
    return false;
  }
  for (const t of TABLES) await admin.query(`CREATE TABLE ${SCRATCH}.${t} LIKE ${source}.${t}`);
  await admin.query(`INSERT INTO ${SCRATCH}.departments (id, entity_id, name, code) VALUES (9, 1, 'Warehouse', 'warehouse')`);
  await admin.query(`INSERT INTO ${SCRATCH}.users (id, entity_id, name, email, status) VALUES (1, 1, 'Uji', 'uji@prakasafoods.com', 'active')`);
  scratch = mysql.createPool({ ...config, database: SCRATCH, connectionLimit: 12 });
  scratch.on('connection', (c) => c.query(SESSION_TIME_ZONE_SQL));
  return true;
}

async function inOwnTransaction(fn) {
  const conn = await scratch.getConnection();
  const tx = { conn, effects: [], cleanups: [] };
  try {
    await conn.beginTransaction();
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    for (const c of tx.cleanups) await c();
    conn.release();
  }
}

const manager = { sub: 1, entityId: 1, departmentId: 9, permissions: ['hrga.view', 'hrga.request', 'hrga.manage'] };

test.before(async () => { await setup(); });
test.after(async () => {
  if (scratch) await scratch.end();
  if (admin) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`); } finally { await admin.end(); }
  }
});

test('10 onboardings created at the same moment get 10 different numbers (D1)', async (t) => {
  if (!scratch) return t.skip('no database');
  const body = (i) => ({
    workflowType: 'onboarding', employeeFullName: `Paralel ${i}`, departmentId: 9, joinDate: '2026-10-20',
    needs: { google: false, app: false, device: 'none', licenses: [], phone: 'none', desk: false, idCard: false },
  });
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => inOwnTransaction((tx) => svc.create(tx, manager, body(i)))));
  const numbers = out.map((o) => o.workflowNumber);
  assert.equal(new Set(numbers).size, 10, numbers.join(', '));
  const seqs = numbers.map((n) => Number(n.slice(-4))).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the last two checklist items completed at the same moment complete the workflow exactly once (D3)', async (t) => {
  if (!scratch) return t.skip('no database');
  const [w] = await scratch.query(
    `INSERT INTO hrga_workflows (entity_id, department_id, workflow_type, workflow_number, employee_full_name, effective_date, status, requested_by)
     VALUES (1, 9, 'onboarding', 'ONB-209901-0001', 'Paralel Selesai', '2026-10-20', 'in_progress', 1)`,
  );
  const ids = [];
  for (const title of ['Satu', 'Dua']) {
    const [r] = await scratch.query(
      "INSERT INTO hrga_workflow_tasks (hrga_workflow_id, category, owner_group, title, status) VALUES (?, 'custom', 'pc', ?, 'pending')",
      [w.insertId, title],
    );
    ids.push(r.insertId);
  }
  const results = await Promise.all(ids.map((taskId) => inOwnTransaction((tx) => svc.updateTask(tx, manager, w.insertId, taskId, { status: 'completed' }))));
  assert.deepEqual(results.map((r) => r.workflowStatus).sort(), ['completed', 'in_progress']);
  const [[wf]] = await scratch.query('SELECT status, completed_at FROM hrga_workflows WHERE id = ?', [w.insertId]);
  assert.equal(wf.status, 'completed');
  const [[logs]] = await scratch.query("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'hrga.completed' AND subject_id = ?", [w.insertId]);
  assert.equal(Number(logs.n), 1);
});
