const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const notif = require('../src/services/notification.service');
const licenses = require('../src/services/licenseAssignment.service');
const ctrl = require('../src/controllers/subscriptionLicenses.controller');
const subs = require('../src/controllers/softwareSubscriptions.controller');

// Revision F05/F06/F27 (3 Oct 2026): one seat state machine for the Langganan
// page and the People & Culture checklist. A tiny in-memory seat table stands
// in for MySQL; writes inside a transaction apply only on COMMIT.

function seats({ license = { id: 5, subscription_id: 7, status: 'available', assigned_to: null }, assignments = [], users = [{ id: 20, entity_id: 1, status: 'active', deleted_at: null }] } = {}) {
  const state = { license: { ...license }, assignments: assignments.map((a) => ({ ...a })), logs: [] };
  const run = (target) => async (sql, args = []) => {
    const text = String(sql);
    if (/FROM subscription_licenses l\s+JOIN software_subscriptions s/.test(text)) {
      return [[Number(args[0]) === target.license.id && Number(args[1]) === 1 ? { ...target.license, product_name: 'Figma', sub_entity_id: 1 } : undefined].filter(Boolean)];
    }
    if (/FROM users WHERE id = \? AND entity_id = \?/.test(text)) {
      return [users.filter((u) => u.id === Number(args[0]) && u.entity_id === Number(args[1]))];
    }
    if (/^UPDATE software_assignments SET status = 'revoked'/.test(text.trim())) {
      target.assignments.filter((a) => a.status === 'active').forEach((a) => { a.status = 'revoked'; });
      return [{ affectedRows: 1 }];
    }
    if (/^UPDATE subscription_licenses SET status = 'assigned'/.test(text.trim())) {
      Object.assign(target.license, { status: 'assigned', assigned_to: Number(args[0]) });
      return [{ affectedRows: 1 }];
    }
    if (/^UPDATE subscription_licenses SET status = 'available'/.test(text.trim())) {
      Object.assign(target.license, { status: 'available', assigned_to: null });
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO software_assignments/.test(text.trim())) {
      target.assignments.push({ id: target.assignments.length + 1, user_id: Number(args[2]), status: 'active' });
      return [{ insertId: target.assignments.length }];
    }
    if (/^INSERT INTO activity_logs/.test(text.trim())) { target.logs.push(JSON.parse(args[5] || 'null')); return [{ insertId: 1 }]; }
    return [[]];
  };
  const clone = () => ({ license: { ...state.license }, assignments: state.assignments.map((a) => ({ ...a })), logs: [...state.logs] });
  const conn = () => {
    let tx = null;
    return {
      query: async (sql, args) => run(tx || state)(sql, args),
      beginTransaction: async () => { tx = clone(); },
      commit: async () => { Object.assign(state, tx); tx = null; },
      rollback: async () => { tx = null; },
      release: () => {},
    };
  };
  return { state, conn, query: run(state) };
}

function use(t, options) {
  const db = seats(options);
  t.mock.method(pool, 'getConnection', async () => db.conn());
  t.mock.method(pool, 'query', db.query);
  t.mock.method(notif, 'create', async () => 1);
  return db;
}

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const user = { sub: 3, entityId: 1, permissions: ['subscription.license.manage'] };
const call = async (fn, req) => { const r = res(); await fn({ query: {}, params: {}, body: {}, user, ...req }, r, (e) => { throw e; }); return r; };
const active = (db) => db.state.assignments.filter((a) => a.status === 'active');

test('F27: assigned → idle → revoke → available → assign never leaves two active holders', async (t) => {
  const db = use(t, { license: { id: 5, subscription_id: 7, status: 'idle', assigned_to: 30 }, assignments: [{ id: 1, user_id: 30, status: 'active' }] });
  // Idle still has its holder: a direct assign is refused.
  const direct = await call(ctrl.assignLicense, { params: { id: '5' }, body: { userId: 20 } });
  assert.equal(direct.statusCode, 409);
  assert.equal(direct.body.error.code, 'LICENSE_IDLE_HELD');
  assert.equal(active(db).length, 1);
  // Revoking an idle seat is allowed on this page too (the same rule as the checklist).
  const noConfirm = await call(ctrl.revokeLicense, { params: { id: '5' }, body: {} });
  assert.equal(noConfirm.statusCode, 409);
  assert.equal(noConfirm.body.error.code, 'VENDOR_CONFIRM_REQUIRED');
  const revoked = await call(ctrl.revokeLicense, { params: { id: '5' }, body: { confirmedAtVendor: true } });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.body.data.recordedOnly, true, 'only the Workspace record changed');
  assert.equal(db.state.license.status, 'available');
  assert.equal(active(db).length, 0);
  const given = await call(ctrl.assignLicense, { params: { id: '5' }, body: { userId: 20 } });
  assert.equal(given.statusCode, 200);
  assert.equal(active(db).length, 1);
  assert.equal(active(db)[0].user_id, 20);
  assert.equal(db.state.license.assigned_to, 20);
  assert.equal(db.state.assignments.length, 2, 'history kept: the old assignment is revoked, not deleted');
});

test('F27: revoking an idle seat through the checklist service gives the same result', async (t) => {
  const db = use(t, { license: { id: 5, subscription_id: 7, status: 'idle', assigned_to: 30 }, assignments: [{ id: 1, user_id: 30, status: 'active' }] });
  const conn = db.conn();
  await conn.beginTransaction();
  const out = await licenses.revokeLicense(conn, { entityId: 1, licenseId: 5, actorId: 3, confirmedAtVendor: true });
  await conn.commit();
  assert.equal(out.changed, true);
  assert.equal(db.state.license.status, 'available');
  assert.equal(active(db).length, 0);
  assert.equal(db.state.logs[0].from, 'idle');
  assert.equal(db.state.logs[0].confirmedAtVendor, true);
});

test('F27: an assigned seat is never given to a second person', async (t) => {
  const db = use(t, { license: { id: 5, subscription_id: 7, status: 'assigned', assigned_to: 30 }, assignments: [{ id: 1, user_id: 30, status: 'active' }] });
  const r = await call(ctrl.assignLicense, { params: { id: '5' }, body: { userId: 20 } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error.code, 'LICENSE_NOT_AVAILABLE');
  assert.equal(active(db).length, 1);
});

test('F05: an inactive, deleted or other-company account cannot receive a seat', async (t) => {
  const users = [
    { id: 21, entity_id: 1, status: 'inactive', deleted_at: null },
    { id: 22, entity_id: 1, status: 'active', deleted_at: new Date() },
    { id: 23, entity_id: 2, status: 'active', deleted_at: null },
  ];
  const db = use(t, { users });
  for (const [userId, code] of [[21, 'ACCOUNT_INACTIVE'], [22, 'ACCOUNT_INACTIVE'], [23, 'ACCOUNT_REQUIRED']]) {
    const r = await call(ctrl.assignLicense, { params: { id: '5' }, body: { userId } });
    assert.equal(r.statusCode, 409, String(userId));
    assert.equal(r.body.error.code, code, String(userId));
  }
  assert.equal(db.state.license.status, 'available');
  assert.equal(db.state.assignments.length, 0);
});

test('F05: the picker lists active accounts of the user\'s own company by name or email', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql: String(sql), args }); return [[{ id: 20, name: 'Budi', email: 'budi@prakasafoods.com' }]]; });
  const r = await call(ctrl.assignableUsers, { query: { q: 'budi', entityId: '99' } });
  assert.deepEqual(r.body.data, [{ id: 20, name: 'Budi', email: 'budi@prakasafoods.com' }]);
  assert.match(calls[0].sql, /u\.entity_id = \? AND u\.status = 'active' AND u\.deleted_at IS NULL/);
  assert.equal(calls[0].args[0], 1, 'the signed-in user\'s company, never the query');
  assert.ok(!calls[0].args.includes('99'));
});

// ------------------------------------------------------------------ F03 / F21

function subsDb(t, { current = { status: 'expiring', renewal_date: '2026-10-20' }, total = 3, rows = [] } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    calls.push({ sql: text, args });
    if (/SELECT status, renewal_date FROM software_subscriptions/.test(text)) return [[current].filter(Boolean)];
    if (/COUNT\(\*\) AS total FROM software_subscriptions/.test(text)) return [[{ total }]];
    if (/^\s*UPDATE software_subscriptions SET/.test(text)) return [{ affectedRows: 1 }];
    if (/^\s*INSERT INTO activity_logs/.test(text)) return [{ insertId: 1 }];
    return [rows];
  });
  return calls;
}

test('F03: moving the renewal date after the vendor renewed updates the same row and returns it to active', async (t) => {
  const calls = subsDb(t);
  const r = await call(subs.update, { params: { id: '7' }, body: { renewalDate: '2027-10-20' }, user: { ...user, permissions: ['subscription.manage'] } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.status, 'active');
  const update = calls.find((c) => /^\s*UPDATE software_subscriptions SET/.test(c.sql));
  assert.ok(update.args.includes('2027-10-20'));
  assert.ok(update.args.includes('active'));
  assert.ok(!calls.some((c) => /INSERT INTO software_subscriptions|subscription_renewals|subscription_payments/.test(c.sql)), 'no duplicate, no renewal approval, no payment');
});

test('F03: a date still inside the notice window stays expiring; an explicit status wins; bad dates are refused', async (t) => {
  subsDb(t, { current: { status: 'expiring', renewal_date: '2026-10-20' } });
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const r1 = await call(subs.update, { params: { id: '7' }, body: { renewalDate: soon } });
  assert.equal(r1.body.data.status, 'expiring');
  const r2 = await call(subs.update, { params: { id: '7' }, body: { renewalDate: '2027-10-20', status: 'cancelled' } });
  assert.equal(r2.body.data.status, 'cancelled');
  const r3 = await call(subs.update, { params: { id: '7' }, body: { renewalDate: '2027-02-30' } });
  assert.equal(r3.statusCode, 400);
});

test('F21: the list says when more subscriptions exist than it shows', async (t) => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }));
  subsDb(t, { total: 201, rows });
  const r = await call(subs.list, {});
  assert.equal(r.body.data.length, 200);
  assert.deepEqual(r.body.meta, { total: 201, limit: 200, hasMore: true });
});

test('F02: every subscription write route is behind its own permission', () => {
  const router = require('../src/routes/it.routes');
  const want = {
    'POST /subscriptions': 'subscription.manage',
    'PATCH /subscriptions/:id': 'subscription.manage',
    'POST /subscriptions/:id/invoices': 'subscription.invoice.manage',
    'POST /invoices/:id/file': 'subscription.invoice.manage',
    'PATCH /invoices/:id/verify': 'subscription.invoice.manage',
    'POST /subscriptions/:id/licenses': 'subscription.license.manage',
    'GET /licenses/assignable-users': 'subscription.license.manage',
    'POST /licenses/:id/assign': 'subscription.license.manage',
    'POST /licenses/:id/revoke': 'subscription.license.manage',
    'POST /subscriptions/:id/payments': 'subscription.payment.manage',
  };
  const found = {};
  for (const layer of router.stack.filter((l) => l.route)) {
    for (const method of Object.keys(layer.route.methods)) {
      const key = `${method.toUpperCase()} ${layer.route.path}`;
      if (!want[key]) continue;
      const guard = layer.route.stack.find((s) => s.name === 'requirePermissionMiddleware').handle;
      const allows = (permissions) => { let passed = false; guard({ user: { permissions } }, res(), () => { passed = true; }); return passed; };
      found[key] = { member: allows(['subscription.view']), needed: allows([want[key]]) };
    }
  }
  assert.deepEqual(Object.keys(found).sort(), Object.keys(want).sort());
  for (const [key, result] of Object.entries(found)) assert.deepEqual(result, { member: false, needed: true }, key);
});
