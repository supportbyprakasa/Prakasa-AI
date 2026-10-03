const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('./fixtures/refuseProduction');
const mysql = require('mysql2/promise');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('../src/db/connectionConfig');
const pool = require('../src/db/pool');
const billing = require('../src/services/subscriptionBilling.service');
const licenses = require('../src/services/licenseAssignment.service');

// Revision F25/F27 (3 Oct 2026): payments and seats under real concurrency.
// Like hrgaConcurrency.test.js it needs real commits on separate connections,
// so it runs in a throw-away database with copies of the tables involved (same
// columns and keys, no rows from the real database), dropped at the end.
// Skipped when no database with migration 143 is reachable.

const SCRATCH = `pwos_subs_cc_${process.pid}`;
const TABLES = ['users', 'activity_logs', 'software_subscriptions', 'subscription_invoices', 'subscription_payments', 'subscription_licenses', 'software_assignments'];
let admin = null;
let scratch = null;

async function setup() {
  const config = buildDbConnectionConfig();
  const source = config.database;
  try {
    admin = await mysql.createConnection({ ...config, multipleStatements: false });
    const [[has]] = await admin.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'subscription_payments' AND column_name = 'request_key'",
      [source],
    );
    if (!Number(has.n)) return false;
    await admin.query(`CREATE DATABASE ${SCRATCH}`);
  } catch {
    return false;
  }
  for (const t of TABLES) await admin.query(`CREATE TABLE ${SCRATCH}.${t} LIKE ${source}.${t}`);
  await admin.query(`INSERT INTO ${SCRATCH}.users (id, entity_id, name, email, status) VALUES
    (1, 1, 'Head PC', 'head.pc@prakasafoods.com', 'active'), (2, 1, 'Pemegang A', 'a@prakasafoods.com', 'active'),
    (3, 1, 'Pemegang B', 'b@prakasafoods.com', 'active')`);
  await admin.query(`INSERT INTO ${SCRATCH}.software_subscriptions (id, entity_id, product_name, total_seats, currency, renewal_date, status)
    VALUES (7, 1, 'Figma', 1, 'IDR', '2027-01-01', 'active')`);
  scratch = mysql.createPool({ ...config, database: SCRATCH, connectionLimit: 12 });
  scratch.on('connection', (c) => c.query(SESSION_TIME_ZONE_SQL));
  return true;
}

// The services use the app's pool: point it at the scratch database.
function useScratch(t) {
  t.mock.method(pool, 'getConnection', () => scratch.getConnection());
  t.mock.method(pool, 'query', (...args) => scratch.query(...args));
}

test.before(async () => { await setup(); });
test.after(async () => {
  if (scratch) await scratch.end();
  if (admin) {
    try { await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`); } finally { await admin.end(); }
  }
});

test('F25: ten actors paying 200 on an invoice of 1000 at the same moment — exactly five are recorded, paid once', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  await scratch.query(`INSERT INTO subscription_invoices (id, subscription_id, invoice_number, invoice_date, amount, currency, tax_amount, total_amount, status)
    VALUES (11, 7, 'INV-CC-1', '2026-10-01', 1000, 'IDR', 0, 1000, 'verified')`);
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => billing.recordPayment({
    entityId: 1, subscriptionId: 7, actorId: 1, body: { invoiceId: 11, amount: 200, requestKey: `concurrent-${i}-aaaa` },
  })));
  const done = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(done.length, 5);
  assert.ok(refused.every((r) => ['OVERPAYMENT', 'INVOICE_NOT_PAYABLE'].includes(r.reason.code)), refused.map((r) => r.reason.message).join('; '));
  const [[sum]] = await scratch.query("SELECT SUM(amount) AS paid, COUNT(*) AS n FROM subscription_payments WHERE invoice_id = 11 AND status = 'processed'");
  assert.deepEqual([Number(sum.paid), Number(sum.n)], [1000, 5]);
  const [[inv]] = await scratch.query('SELECT status FROM subscription_invoices WHERE id = 11');
  assert.equal(inv.status, 'paid');
  const [[logs]] = await scratch.query("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'subscription_payment.create'");
  assert.equal(Number(logs.n), 5, 'one audit row per recorded payment, none for a refused one');
});

test('F25: the same request sent five times at once is recorded once', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  await scratch.query(`INSERT INTO subscription_invoices (id, subscription_id, invoice_number, invoice_date, amount, currency, tax_amount, total_amount, status)
    VALUES (12, 7, 'INV-CC-2', '2026-10-01', 1000, 'IDR', 0, 1000, 'uploaded')`);
  const out = await Promise.all(Array.from({ length: 5 }, () => billing.recordPayment({
    entityId: 1, subscriptionId: 7, actorId: 1, body: { invoiceId: 12, amount: 100, requestKey: 'same-request-key-01' },
  })));
  assert.equal(new Set(out.map((o) => o.id)).size, 1, 'every retry answers the same payment');
  const [[sum]] = await scratch.query('SELECT COUNT(*) AS n, SUM(amount) AS paid FROM subscription_payments WHERE invoice_id = 12');
  assert.deepEqual([Number(sum.n), Number(sum.paid)], [1, 100]);
  const [[inv]] = await scratch.query('SELECT status FROM subscription_invoices WHERE id = 12');
  assert.equal(inv.status, 'uploaded', 'a partial payment leaves the invoice unpaid');
});

test('F27: two actors assigning the same free seat at once — one holder, one active assignment', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  await scratch.query("INSERT INTO subscription_licenses (id, subscription_id, seat_label, status) VALUES (5, 7, 'Seat #1', 'available')");
  const assign = (userId) => (async () => {
    const conn = await scratch.getConnection();
    try {
      await conn.beginTransaction();
      const out = await licenses.assignLicense(conn, { entityId: 1, licenseId: 5, userId, actorId: 1, via: 'subscription' });
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally { conn.release(); }
  })();
  const results = await Promise.allSettled([assign(2), assign(3)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'LICENSE_NOT_AVAILABLE');
  const [active] = await scratch.query("SELECT user_id FROM software_assignments WHERE license_id = 5 AND status = 'active'");
  const [[seat]] = await scratch.query('SELECT status, assigned_to FROM subscription_licenses WHERE id = 5');
  assert.equal(active.length, 1);
  assert.equal(seat.status, 'assigned');
  assert.equal(Number(seat.assigned_to), Number(active[0].user_id), 'the seat and its active assignment name the same person');
});

test('F27: assigned → idle → revoke → assign keeps one active holder and the history', async (t) => {
  if (!scratch) return t.skip('no database');
  useScratch(t);
  await scratch.query("INSERT INTO subscription_licenses (id, subscription_id, seat_label, status, assigned_to) VALUES (6, 7, 'Seat #2', 'idle', 2)");
  await scratch.query("INSERT INTO software_assignments (subscription_id, license_id, user_id, assigned_by, status) VALUES (7, 6, 2, 1, 'active')");
  const tx = async (fn) => {
    const conn = await scratch.getConnection();
    try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  };
  await assert.rejects(tx((conn) => licenses.assignLicense(conn, { entityId: 1, licenseId: 6, userId: 3, actorId: 1 })), { code: 'LICENSE_IDLE_HELD' });
  const revoked = await tx((conn) => licenses.revokeLicense(conn, { entityId: 1, licenseId: 6, actorId: 1, confirmedAtVendor: true }));
  assert.equal(revoked.changed, true);
  await tx((conn) => licenses.assignLicense(conn, { entityId: 1, licenseId: 6, userId: 3, actorId: 1 }));
  const [rows] = await scratch.query('SELECT user_id, status FROM software_assignments WHERE license_id = 6 ORDER BY id');
  assert.deepEqual(rows.map((r) => [Number(r.user_id), r.status]), [[2, 'revoked'], [3, 'active']]);
});
