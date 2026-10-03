const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const mysql = require('mysql2/promise');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('../src/db/connectionConfig');
const { CHECKS, runReport } = require('../src/services/subscriptionReconcile.service');

// The reconciliation report of older Langganan data (3 Oct 2026). It only
// reads: every statement is a SELECT inside a READ ONLY transaction that is
// rolled back. The database part runs in a throw-away database with copies of
// the tables (no rows from the real database), dropped at the end.

test('the report only reads: SELECTs inside a READ ONLY transaction, always rolled back', async () => {
  const statements = [];
  const conn = { query: async (sql) => { statements.push(String(sql).trim()); return [[]]; } };
  const report = await runReport(conn);
  assert.equal(report.total, 0);
  assert.equal(report.checks.length, CHECKS.length);
  assert.deepEqual(statements.slice(0, 2), ['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY']);
  assert.equal(statements.at(-1), 'ROLLBACK');
  for (const sql of statements.slice(2, -1)) assert.match(sql, /^SELECT\b/, sql.slice(0, 60));
  for (const check of CHECKS) assert.doesNotMatch(check.sql, /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/i, check.key);
});

test('a failing check still rolls back', async () => {
  const statements = [];
  const conn = { query: async (sql) => { statements.push(String(sql).trim()); if (/^SELECT/.test(String(sql).trim())) throw new Error('boom'); return [[]]; } };
  await assert.rejects(runReport(conn), /boom/);
  assert.equal(statements.at(-1), 'ROLLBACK');
});

const SCRATCH = `pwos_subs_rc_${process.pid}`;
const TABLES = ['software_subscriptions', 'subscription_invoices', 'subscription_payments', 'subscription_licenses', 'software_assignments'];
let admin = null;
let scratch = null;

test.before(async () => {
  const config = buildDbConnectionConfig();
  try {
    admin = await mysql.createConnection(config);
    const [[has]] = await admin.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'subscription_payments'",
      [config.database],
    );
    if (!Number(has.n)) return;
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
  } catch { return; }
  for (const t of TABLES) await admin.query(`CREATE TABLE ${SCRATCH}.${t} LIKE ${config.database}.${t}`);
  scratch = await mysql.createConnection({ ...config, database: SCRATCH });
  await scratch.query(SESSION_TIME_ZONE_SQL);
  const q = (sql) => scratch.query(sql);
  await q(`INSERT INTO software_subscriptions (id, entity_id, product_name, renewal_date, status) VALUES
    (1, 1, 'Bersih', '2027-01-01', 'active'), (2, 1, 'Bermasalah', '2027-01-01', 'active'), (3, 2, 'Perusahaan lain', '2027-01-01', 'active')`);
  // Clean data: a seat held with its assignment, a free seat, a paid invoice covered, a partial one.
  await q(`INSERT INTO subscription_licenses (id, subscription_id, status, assigned_to) VALUES
    (1, 1, 'assigned', 10), (2, 1, 'available', NULL),
    (11, 2, 'idle', 10), (12, 2, 'assigned', NULL), (13, 2, 'assigned', 10), (14, 2, 'available', NULL), (31, 3, 'idle', 30)`);
  await q(`INSERT INTO software_assignments (subscription_id, license_id, user_id, status) VALUES
    (1, 1, 10, 'active'), (1, 2, 11, 'revoked'),
    (2, 11, 10, 'active'), (2, 11, 20, 'active'),
    (2, 13, 22, 'active'), (2, 14, 23, 'active'),
    (3, 31, 30, 'active'), (3, 31, 31, 'active')`);
  await q(`INSERT INTO subscription_invoices (id, subscription_id, invoice_number, invoice_date, amount, tax_amount, total_amount, currency, status, document_id) VALUES
    (1, 1, 'OK-1', '2026-09-01', 900, 100, 1000, 'IDR', 'paid', 5),
    (2, 1, 'OK-2', '2026-09-01', 1000, 0, 1000, 'IDR', 'verified', 6),
    (11, 2, 'BAD-FILE', '2026-09-01', 1000, 0, 1000, 'IDR', 'uploaded', NULL),
    (12, 2, 'BAD-TOTAL', '2026-09-01', 900, 0, 1000, 'IDR', 'pending_upload', NULL),
    (13, 2, 'BAD-PAID', '2026-09-01', 1000, 0, 1000, 'IDR', 'paid', 7),
    (14, 2, 'BAD-OVER', '2026-09-01', 1000, 0, 1000, 'IDR', 'verified', 8),
    (15, 2, 'USD', '2026-09-01', 100, 0, 100, 'USD', 'verified', 9)`);
  await q(`INSERT INTO subscription_payments (subscription_id, invoice_id, amount, currency, status) VALUES
    (1, 1, 1000, 'IDR', 'processed'), (1, 2, 400, 'IDR', 'processed'),
    (2, 13, 100, 'IDR', 'processed'), (2, 13, 0, 'IDR', 'processed'),
    (2, 14, 800, 'IDR', 'processed'), (2, 14, 800, 'IDR', 'processed'),
    (2, 15, 1500000, 'IDR', 'processed'),
    (1, 14, 10, 'IDR', 'processed')`);
});

test.after(async () => {
  if (scratch) await scratch.end();
  if (admin) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`); } finally { await admin.end(); }
  }
});

const ids = (report, key, field) => report.checks.find((c) => c.key === key).rows.map((r) => Number(r[field])).sort((a, b) => a - b);

test('db: each kind of older data is found once, clean rows are not, and nothing changes', async (t) => {
  if (!scratch) return t.skip('no database');
  const snapshot = async () => {
    const out = [];
    for (const table of TABLES) out.push(JSON.stringify((await scratch.query(`SELECT * FROM ${table} ORDER BY id`))[0]));
    return out.join('|');
  };
  const before = await snapshot();
  const report = await runReport(scratch);
  assert.deepEqual(ids(report, 'seat_multiple_active', 'license_id'), [11, 31]);
  assert.deepEqual(ids(report, 'seat_held_without_assignment', 'license_id'), [12]);
  assert.deepEqual(ids(report, 'seat_holder_differs', 'license_id'), [11, 13, 31]);
  assert.deepEqual(ids(report, 'seat_free_with_assignment', 'license_id'), [14]);
  assert.deepEqual(ids(report, 'invoice_uploaded_without_file', 'invoice_id'), [11]);
  assert.deepEqual(ids(report, 'invoice_total_mismatch', 'invoice_id'), [12]);
  assert.deepEqual(ids(report, 'invoice_paid_not_covered', 'invoice_id'), [13]);
  assert.deepEqual(ids(report, 'invoice_overpaid', 'invoice_id'), [14]);
  assert.equal(report.checks.find((c) => c.key === 'payment_not_positive').count, 1);
  assert.equal(report.checks.find((c) => c.key === 'payment_currency_mismatch').count, 1);
  assert.deepEqual(ids(report, 'payment_wrong_subscription', 'invoice_id'), [14]);
  // One company only.
  const one = await runReport(scratch, { entityId: 2 });
  assert.deepEqual(ids(one, 'seat_multiple_active', 'license_id'), [31]);
  assert.equal(one.total, 2);
  assert.equal(await snapshot(), before, 'the report changed nothing');
});
