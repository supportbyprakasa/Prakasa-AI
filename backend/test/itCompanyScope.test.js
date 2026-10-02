const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

// People & Culture audit (30 Sep 2026): every IT record belongs to the signed-in
// user's company. A company id in the body or query is ignored, and a record of
// another company reads as not found — never shown, changed or deleted.

const ME = 1;
const OTHER = 99;
const user = { sub: 7, entityId: ME, permissions: [] };

function capture(t, rows = [[{ total: 0 }]]) {
  const calls = [];
  const handler = async (sql, args = []) => {
    calls.push({ sql: String(sql), args });
    if (/^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql))) return [{ affectedRows: 0, insertId: 1 }];
    return rows;
  };
  t.mock.method(pool, 'query', handler);
  t.mock.method(pool, 'getConnection', async () => ({
    query: handler, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  }));
  return calls;
}
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const fail = (e) => { throw e; };

// Every statement that touches a company-owned table binds MY company and never the other.
function assertScoped(calls, label) {
  const touching = calls.filter((c) => /\b(devices|device_assignments|device_repair_logs|software_subscriptions|software_vendors|subscription_licenses|subscription_invoices)\b/.test(c.sql)
    && !/^\s*INSERT INTO (device_warranty_logs|device_maintenance_logs|device_repair_logs|device_handover_documents|software_assignments|subscription_payments)/i.test(c.sql)
    // Child rows read by their parent's id run only after the parent passed the company check.
    && !/WHERE (a\.device_id|device_id|l\.subscription_id|subscription_id)=\?/.test(c.sql));
  assert.ok(touching.length, `${label}: queried something`);
  for (const c of touching) {
    assert.ok(c.args.includes(ME), `${label}: binds the user's company — ${c.sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    assert.ok(!c.args.includes(OTHER), `${label}: never the requested company`);
  }
}

test('devices: list, detail, create, update, delete and warranty list are bound to the user\'s company', async (t) => {
  const ctrl = require('../src/controllers/devices.controller');
  for (const [name, req] of [
    ['list', { query: { entityId: String(OTHER) } }],
    ['detail', { params: { id: 5 } }],
    ['create', { body: { entityId: OTHER, assetCode: 'A-1', deviceType: 'laptop' } }],
    ['update', { params: { id: 5 }, body: { brand: 'X', entityId: OTHER } }],
    ['remove', { params: { id: 5 } }],
    ['warrantyDue', { query: { entityId: String(OTHER) } }],
  ]) {
    const calls = capture(t);
    await ctrl[name]({ query: {}, params: {}, body: {}, ...req, user }, res(), fail);
    assertScoped(calls, `devices.${name}`);
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
});

test('assignments, repairs and handovers: the device and the assignment must be the user\'s company', async (t) => {
  const assign = require('../src/controllers/deviceAssignments.controller');
  const logs = require('../src/controllers/deviceLogs.controller');
  const handover = require('../src/controllers/deviceHandoverReturn.controller');
  for (const [label, fn, req] of [
    ['assignments.list', assign.list, { query: {} }],
    ['assignments.create', assign.create, { body: { entityId: OTHER, deviceId: 5, assignedTo: 8 } }],
    ['assignments.return', assign.returnDevice, { params: { id: 3 }, body: {} }],
    ['repairs.update', logs.updateRepair, { params: { id: 3 }, body: { status: 'completed' } }],
    ['handover', handover.uploadHandover, { params: { id: 3 }, body: {} }],
    ['return document', handover.uploadReturn, { params: { id: 3 }, body: {} }],
  ]) {
    const calls = capture(t, [[]]);
    await fn({ query: {}, params: {}, body: {}, ...req, user }, res(), fail);
    assertScoped(calls, label);
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
});

test('subscriptions, licences, invoices and vendors: bound to the user\'s company', async (t) => {
  const subs = require('../src/controllers/softwareSubscriptions.controller');
  const inv = require('../src/controllers/subscriptionInvoices.controller');
  const lic = require('../src/controllers/subscriptionLicenses.controller');
  const vend = require('../src/controllers/softwareVendors.controller');
  for (const [label, fn, req] of [
    ['subscriptions.list', subs.list, { query: { entityId: String(OTHER) } }],
    ['subscriptions.detail', subs.detail, { params: { id: 5 } }],
    ['subscriptions.update', subs.update, { params: { id: 5 }, body: { productName: 'X' } }],
    ['subscriptions.remove', subs.remove, { params: { id: 5 } }],
    ['invoices.list', inv.list, { query: {} }],
    ['invoices.verify', inv.verify, { params: { id: 5 }, body: { status: 'verified' } }],
    ['invoices.pendingUpload', inv.pendingUpload, {}],
    ['licenses.markIdle', lic.markIdle, { params: { id: 5 } }],
    ['vendors.list', vend.list, { query: { entityId: String(OTHER) } }],
    ['vendors.create', vend.create, { body: { entityId: OTHER, name: 'V' } }],
    ['vendors.update', vend.update, { params: { id: 5 }, body: { name: 'V' } }],
    ['vendors.remove', vend.remove, { params: { id: 5 } }],
  ]) {
    const calls = capture(t, [[{ total: 0 }]]);
    await fn({ query: {}, params: {}, body: {}, ...req, user }, res(), fail);
    assertScoped(calls, label);
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
});

test('onboarding/offboarding workflows and checklist templates are bound to the user\'s company', async (t) => {
  const hrga = require('../src/controllers/hrga.controller');
  // The directory person an offboarding is for is read first, also bound to the user's company.
  const touching = (calls) => calls.filter((c) => /\bhrga_(workflows|checklist_templates)\b|\bpeople_directory\b/.test(c.sql) && !/workflow_number LIKE/.test(c.sql));
  for (const [label, fn, req] of [
    ['list', hrga.list, { query: { entityId: String(OTHER) } }],
    ['detail', hrga.detail, { params: { id: 5 } }],
    ['create', hrga.create, { body: { entityId: OTHER, workflowType: 'offboarding', personKey: 'p5', lastWorkingDate: '2026-10-20', reasonCode: 'resign' } }],
    ['update', hrga.update, { params: { id: 5 }, body: { version: 1, notes: 'x' } }],
    ['remove', hrga.remove, { params: { id: 5 } }],
    ['submit', hrga.submitForApproval, { params: { id: 5 } }],
    ['kantorku link', hrga.linkKantorku, { params: { id: 5 }, body: { kantorkuEmployeeId: 'K1' } }],
    ['task update', hrga.updateTask, { params: { id: 5, taskId: 9 }, body: { status: 'completed' } }],
    ['cancel', hrga.cancel, { params: { id: 5 }, body: { reason: 'x' } }],
    ['templates', hrga.listChecklistTemplates, { query: { entityId: String(OTHER) } }],
    ['template create', hrga.createChecklistTemplate, { body: { entityId: OTHER, workflowType: 'onboarding', name: 'T', items: [] } }],
  ]) {
    const calls = capture(t, [[{ c: 0, items: '[]', status: 'draft', total: 0 }]]);
    await fn({ query: {}, params: {}, body: {}, ...req, user }, res(), () => {});
    const hit = touching(calls);
    assert.ok(hit.length, `${label}: queried a workflow/template`);
    for (const c of hit) {
      assert.ok(c.args.includes(ME), `${label}: binds the user's company — ${c.sql.replace(/\s+/g, ' ').slice(0, 90)}`);
      assert.ok(!c.args.includes(OTHER), `${label}: never the requested company`);
    }
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
});

test('an upload without a target folder goes to the Shared Drive, and without a Shared Drive it is refused', async () => {
  const drive = require('../src/services/googleDrive.service');
  const before = process.env.GOOGLE_SHARED_DRIVE_ID;
  try {
    delete process.env.GOOGLE_SHARED_DRIVE_ID;
    await assert.rejects(() => drive.uploadFile({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') }), (e) => e.status === 503 && e.code === 'GOOGLE_DRIVE_NOT_CONFIGURED');
  } finally {
    if (before === undefined) delete process.env.GOOGLE_SHARED_DRIVE_ID; else process.env.GOOGLE_SHARED_DRIVE_ID = before;
  }
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/services/googleDrive.service.js'), 'utf8');
  assert.match(src, /requestBody: \{ name, parents: \[parentId\] \}/, 'a file is never created without a parent');
});
