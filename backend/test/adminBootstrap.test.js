const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const mysql = require('mysql2/promise');
const { buildDbConnectionConfig } = require('../src/db/connectionConfig');
const pool = require('../src/db/pool');
const { bootstrapFirstAdmin } = require('../src/services/adminBootstrap.service');

// npm run bootstrap:admin on a fresh database: migration 032 found no Super
// Admin role to tag, so the role made by the bootstrap must carry role_key
// 'system.super_admin' itself — the app recognises Super Admin by that key and
// otherwise shows "Akses belum disiapkan". Runs in a throw-away database with
// copies of the tables (no rows from the real database), dropped at the end.

const SCRATCH = `pwos_boot_${process.pid}`;
const TABLES = ['entities', 'roles', 'permissions', 'role_permissions', 'users', 'user_roles'];
let admin = null;
let scratch = null;

test.before(async () => {
  const config = buildDbConnectionConfig();
  try {
    admin = await mysql.createConnection(config);
    const [[has]] = await admin.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'roles' AND column_name = 'role_key'",
      [config.database],
    );
    if (!Number(has.n)) return;
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
  } catch { return; }
  for (const t of TABLES) await admin.query(`CREATE TABLE ${SCRATCH}.${t} LIKE ${config.database}.${t}`);
  await admin.query(`INSERT INTO ${SCRATCH}.entities (id, name, brand_code) VALUES (1, 'Uji', 'UJI'), (2, 'Uji 2', 'UJI2')`);
  await admin.query(`INSERT INTO ${SCRATCH}.permissions (id, code) VALUES (1, 'document.view'), (2, 'subscription.manage')`);
  scratch = mysql.createPool({ ...config, database: SCRATCH, connectionLimit: 4 });
});

test.after(async () => {
  if (scratch) await scratch.end();
  if (admin) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`); } finally { await admin.end(); }
  }
});

const useScratch = (t) => t.mock.method(pool, 'getConnection', () => scratch.getConnection());
const input = (email, entityId = 1) => ({ email, name: 'Super Admin Uji', password: 'Uji-Lokal-2026!x', entityId, mustChangePassword: false });

test('fresh database: the new Super Admin role is the global system.super_admin role with every permission', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  const out = await bootstrapFirstAdmin(input('pertama@prakasagroup.com'));
  assert.equal(out.created, true);
  const [[role]] = await scratch.query('SELECT name, role_key, role_level, department_id, is_system_template FROM roles WHERE id = ?', [out.roleId]);
  assert.deepEqual({ ...role }, { name: 'Super Admin', role_key: 'system.super_admin', role_level: 'admin', department_id: null, is_system_template: 1 });
  const [[perms]] = await scratch.query('SELECT COUNT(*) AS n FROM role_permissions WHERE role_id = ?', [out.roleId]);
  assert.equal(Number(perms.n), 2);
  // A second admin reuses the same role.
  const again = await bootstrapFirstAdmin(input('kedua@prakasagroup.com'));
  assert.equal(again.roleId, out.roleId);
});

test('an older untagged "Super Admin" role is tagged instead of duplicated; other keyed roles are left alone', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  await scratch.query(`INSERT INTO roles (id, entity_id, name, role_key, role_level) VALUES
    (90, 2, 'Administrator', 'system.admin', 'admin'), (91, 2, 'Super Admin', NULL, NULL)`);
  const out = await bootstrapFirstAdmin(input('lama@prakasagroup.com', 2));
  assert.equal(out.roleId, 91);
  const [rows] = await scratch.query('SELECT id, role_key FROM roles WHERE entity_id = 2 ORDER BY id');
  assert.deepEqual(rows.map((r) => [r.id, r.role_key]), [[90, 'system.admin'], [91, 'system.super_admin']]);
});
