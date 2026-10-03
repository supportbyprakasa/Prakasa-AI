const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const engine = require('../src/services/approvalEngine.service');
const notif = require('../src/services/notification.service');
const approvalAudit = require('../src/services/approvalAudit.service');
const activityLog = require('../src/services/activityLog.service');
const batches = require('../src/services/salesAccurateBatches.service');
const transport = require('../src/services/accurate/accurateWriteTransport');
const lifecycle = require('../src/services/approvalSubjectLifecycle.service');
const { approvalActionUrl } = require('../src/services/approvalLink');
const { STANDARD_ROLES } = require('../src/config/standardOrganization');
const service = require('../src/services/accurateWriteRequests.service');

// Pengajuan ke Accurate (owner, 3 Oct 2026): proposed in the app, decided by
// the division's Supervisor or Head, queued for Accurate — and, with the send
// channel closed, never sent. These tests run without a database.

const USER = { sub: 11, entityId: 1, departmentId: 5, permissions: ['accurate.write.request'] };
const OVERSEER = { sub: 12, entityId: 1, departmentId: 5, permissions: ['accurate.batch.view'] };

function fakeConnection(handlers, calls) {
  return {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [re, value] of handlers) if (re.test(sql)) return typeof value === 'function' ? value(sql, args) : value;
      return [{ affectedRows: 1, insertId: 1 }];
    },
    beginTransaction: async () => { calls.push({ sql: 'BEGIN' }); },
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
  };
}

const row = (extra = {}) => ({
  id: 7, entity_id: 1, department_id: 5, record_type: 'customer', action: 'create', local_id: 40, accurate_id: null, accurate_number: 'C-900',
  title: 'Pelanggan baru: Toko Maju (C-900)', payload: JSON.stringify({ number: 'C-900', name: 'Toko Maju', city: 'Bandung' }), before_data: null,
  payload_hash: 'x', request_key: 'req-0001-abcd', status: 'pending', approval_request_id: 901, requested_by: 11, decided_by: null, decided_at: null,
  decision_note: null, attempts: 0, last_attempt_at: null, last_error: null, sent_at: null, accurate_response: null, confirmed_at: null,
  created_at: '2026-10-03 10:00:00', updated_at: '2026-10-03 10:00:00', department_name: 'Sales', department_code: 'sales',
  requested_by_name: 'Budi', decided_by_name: null, ...extra,
});

const silence = (t) => {
  t.mock.method(activityLog, 'log', async () => {});
  t.mock.method(notif, 'create', async () => null);
  t.mock.method(approvalAudit, 'log', async () => {});
};

// ------------------------------------------------------------------ pure rules

test('payload: only the listed fields, trimmed, the name required, a valid email', () => {
  assert.deepEqual(service.cleanPayload('customer', { name: ' Toko Maju ', city: 'Bandung', notes: '' }), { name: 'Toko Maju', city: 'Bandung' });
  assert.throws(() => service.cleanPayload('customer', { name: 'X', npwp: '12' }), (e) => e.code === 'VALIDATION_ERROR' && /npwp/.test(e.message));
  assert.throws(() => service.cleanPayload('vendor', { city: 'Bandung' }), (e) => /Nama wajib/.test(e.message));
  assert.throws(() => service.cleanPayload('customer', { name: 'X', email: 'bukan-email' }), (e) => /Email/.test(e.message));
  assert.throws(() => service.cleanPayload('customer', { name: 'x'.repeat(121) }), (e) => /maksimal 120/.test(e.message));
});

test('diff: what changes against the approved mirror snapshot; untouched mirror-only fields are not changes', () => {
  const before = { number: 'C-1', name: 'Toko Lama', category: 'Grosir', status: 'Aktif' };
  assert.deepEqual(service.diffFields(before, { number: 'C-1', name: 'Toko Baru' }), [{ field: 'name', before: 'Toko Lama', after: 'Toko Baru' }]);
  assert.deepEqual(service.diffFields(before, { number: 'C-1', name: 'Toko Lama' }), []);
  assert.deepEqual(service.diffFields(before, { name: 'Toko Lama', city: 'Bandung' }), [{ field: 'city', before: null, after: 'Bandung' }]);
});

test('transport: Accurate parameter names are mapped, and the channel is closed whatever the flag says', async () => {
  const request = { recordType: 'customer', action: 'update', accurateId: '55', payload: { number: 'C-1', name: 'Toko', phone: '0812', notes: '' } };
  assert.deepEqual(transport.toAccurateParams(request), { id: '55', customerNo: 'C-1', name: 'Toko', mobilePhone: '0812' });
  assert.throws(() => transport.toAccurateParams({ recordType: 'item', payload: {} }), /tidak dikenal/);
  const was = process.env.ACCURATE_WRITE_ENABLED;
  try {
    delete process.env.ACCURATE_WRITE_ENABLED;
    const off = await transport.send(request);
    assert.equal(off.sent, false);
    assert.equal(off.reason, 'ACCURATE_WRITE_DISABLED');
    process.env.ACCURATE_WRITE_ENABLED = '1';
    const on = await transport.send(request);
    assert.equal(on.sent, false);
    assert.equal(on.reason, 'ACCURATE_WRITE_NOT_WIRED');
  } finally {
    if (was === undefined) delete process.env.ACCURATE_WRITE_ENABLED; else process.env.ACCURATE_WRITE_ENABLED = was;
  }
});

test('the transport never names an Accurate host: the read-only gate stays the only caller', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/accurate/accurateWriteTransport.js'), 'utf8');
  assert.equal(/fetch\(|https?:\/\//.test(src), false);
});

// ------------------------------------------------------------------ create

function creationDb(t, calls, { mirror = null, open = null, existing = null } = {}) {
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/SELECT id FROM accurate_write_requests WHERE entity_id = \? AND request_key/.test(sql)) return [existing ? [existing] : []];
    if (/FROM accurate_write_requests w/.test(sql)) return [[row()]];
    return [[]];
  });
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM departments WHERE/, [[{ id: 5, code: 'sales', name: 'Sales' }, { id: 8, code: 'retail_commerce', name: 'Retail Commerce' }]]],
    [/FROM accurate_latest/, [mirror ? [mirror] : []]],
    [/SELECT id, status FROM accurate_write_requests/, [open ? [open] : []]],
    [/INSERT INTO accurate_write_requests/, [{ insertId: 7 }]],
  ], calls));
  t.mock.method(engine, 'createApprovalRequest', async (ctx) => { calls.push({ sql: 'createApprovalRequest', args: ctx }); return { id: 901, flowType: 'sequential' }; });
  t.mock.method(batches, 'ensureDecider', async () => false);
  t.mock.method(batches, 'ensureOwnerDecider', async () => false);
  t.mock.method(batches, 'deciderIds', async () => [3, 4]);
}

test('a new customer: one pending request, one approval request the Head holds from the start, deciders told', async (t) => {
  const calls = [];
  const notified = [];
  silence(t);
  t.mock.method(notif, 'create', async (n) => { notified.push(n); return null; });
  creationDb(t, calls);
  const result = await service.createRequest(USER, {
    recordType: 'customer', action: 'create', requestKey: 'req-0001-abcd', localId: 40,
    payload: { number: 'C-900', name: ' Toko Maju ', city: 'Bandung', notes: '' },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.approvalRequestId, 901);
  const insert = calls.find((c) => /INSERT INTO accurate_write_requests/.test(c.sql));
  assert.ok(insert);
  assert.equal(insert.args[2], 'customer');
  assert.equal(insert.args[6], 'C-900');
  assert.deepEqual(JSON.parse(insert.args[8]), { number: 'C-900', name: 'Toko Maju', city: 'Bandung' });
  const approval = calls.find((c) => c.sql === 'createApprovalRequest').args;
  assert.equal(approval.requestType, 'accurate_write');
  assert.equal(approval.subjectType, 'accurate_write_request');
  assert.equal(approval.departmentId, 5);
  assert.ok(calls.some((c) => /SET s.escalated_at = NOW\(\), s.escalated_to_role_id = am.escalation_role_id/.test(c.sql)), 'the Head holds the step from the start');
  assert.ok(calls.some((c) => c.sql === 'COMMIT'));
  assert.deepEqual(notified.map((n) => n.userId), [3, 4]);
  assert.equal(notified[0].actionUrl, '/data-accurate/pengajuan/7');
  // Nothing of the app's own data or the mirror changes, and nothing is sent.
  assert.equal(calls.some((c) => /(INSERT INTO|UPDATE|DELETE FROM)\s+(sales_customers|accurate_records)\b/.test(c.sql)), false);
});

test('the same request key submitted twice is the same request', async (t) => {
  const calls = [];
  silence(t);
  creationDb(t, calls, { existing: { id: 7 } });
  const result = await service.createRequest(USER, { recordType: 'customer', action: 'create', requestKey: 'req-0001-abcd', payload: { name: 'Toko Maju' } });
  assert.equal(result.id, 7);
  assert.equal(result.repeated, true);
  assert.equal(calls.some((c) => /INSERT INTO accurate_write_requests/.test(c.sql)), false);
});

test('refused: a number Accurate already has, a target with an open request, an update of a record the mirror lacks, a change that changes nothing', async (t) => {
  silence(t);
  const calls = [];
  creationDb(t, calls, { mirror: { accurate_id: '55', number: 'C-900', name: 'Toko Maju', status: 'Aktif', data: '{"category":"Grosir"}' } });
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'customer', action: 'create', requestKey: 'req-0002-abcd', payload: { number: 'C-900', name: 'Toko Maju' } }),
    (e) => e.code === 'DUPLICATE',
  );
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'customer', action: 'update', accurateId: '55', requestKey: 'req-0003-abcd', payload: { number: 'C-900', name: 'Toko Maju', category: 'Grosir' } }),
    (e) => e.code === 'NO_CHANGE',
  );
  assert.ok(calls.every((c) => c.sql !== 'COMMIT'), 'a refusal commits nothing');

  const calls2 = [];
  creationDb(t, calls2, { open: { id: 3, status: 'queued' } });
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'customer', action: 'create', requestKey: 'req-0004-abcd', payload: { number: 'C-901', name: 'Toko Lain' } }),
    (e) => e.code === 'ALREADY_REQUESTED' && /#3/.test(e.message),
  );
  const calls3 = [];
  creationDb(t, calls3);
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'vendor', action: 'update', accurateId: '77', requestKey: 'req-0005-abcd', payload: { name: 'PT Baru' } }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'vendor', action: 'update', requestKey: 'req-0006-abcd', payload: { name: 'PT Baru' } }),
    (e) => e.code === 'VALIDATION_ERROR' && /sudah ada/.test(e.message),
  );
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'vendor', action: 'create', requestKey: 'short', payload: { name: 'PT Baru' } }),
    (e) => /requestKey/.test(e.message),
  );
});

test('a vendor proposal is decided by Procurement even when a Sales member files it; no division → refused', async (t) => {
  silence(t);
  const calls = [];
  creationDb(t, calls);
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM departments WHERE/, [[{ id: 9, code: 'procurement', name: 'Procurement' }]]],
    [/FROM accurate_latest/, [[]]],
    [/SELECT id, status FROM accurate_write_requests/, [[]]],
    [/INSERT INTO accurate_write_requests/, [{ insertId: 8 }]],
  ], calls));
  await service.createRequest(USER, { recordType: 'vendor', action: 'create', requestKey: 'req-0007-abcd', payload: { name: 'PT Sumber' } });
  assert.equal(calls.find((c) => c.sql === 'createApprovalRequest').args.departmentId, 9);

  t.mock.method(pool, 'getConnection', async () => fakeConnection([[/FROM departments WHERE/, [[]]]], []));
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'vendor', action: 'create', requestKey: 'req-0008-abcd', payload: { name: 'PT Sumber' } }),
    (e) => e.code === 'DIVISION_MISSING',
  );
});

test('without a matrix rule the request is not created at all', async (t) => {
  silence(t);
  const calls = [];
  creationDb(t, calls);
  t.mock.method(engine, 'createApprovalRequest', async () => ({ id: 902, flowType: 'legacy' }));
  await assert.rejects(
    () => service.createRequest(USER, { recordType: 'customer', action: 'create', requestKey: 'req-0009-abcd', payload: { name: 'Toko' } }),
    (e) => e.code === 'APPROVAL_MATRIX_MISSING',
  );
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
});

// ------------------------------------------------------------------ decision

test('deciding: registered in the lifecycle; only approve/reject, with a reason to reject, never by the requester', async (t) => {
  assert.ok(lifecycle.isManagedSubject('accurate_write_request'));
  assert.ok(lifecycle.isManagedSubject('accurate_write'));
  assert.equal(approvalActionUrl({ id: 901, subjectType: 'accurate_write_request', subjectId: 7 }), '/data-accurate/pengajuan/7');
  const approval = { id: 901, entity_id: 1, subject_id: 7 };
  const conn = fakeConnection([[/FROM accurate_write_requests WHERE id = \? AND entity_id/, [[row()]]]], []);
  await assert.rejects(() => service.assertCanDecide({ approval, user: USER, action: 'approve', conn }), (e) => e.code === 'SELF_APPROVAL_FORBIDDEN');
  await assert.rejects(() => service.assertCanDecide({ approval, user: OVERSEER, action: 'request_revision', conn }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => service.assertCanDecide({ approval, user: OVERSEER, action: 'reject', note: ' ', conn }), (e) => /alasan/.test(e.message));
  await service.assertCanDecide({ approval, user: OVERSEER, action: 'approve', conn });
  const stale = fakeConnection([[/FROM accurate_write_requests WHERE id = \? AND entity_id/, [[row({ approval_request_id: 800 })]]]], []);
  await assert.rejects(() => service.assertCanDecide({ approval, user: OVERSEER, action: 'approve', conn: stale }), (e) => e.code === 'STALE_APPROVAL');
  const decided = fakeConnection([[/FROM accurate_write_requests WHERE id = \? AND entity_id/, [[row({ status: 'queued' })]]]], []);
  await assert.rejects(() => service.assertCanDecide({ approval, user: OVERSEER, action: 'approve', conn: decided }), (e) => e.code === 'CONFLICT');
  assert.equal(await service.canUserDecide({ approval, conn: fakeConnection([[/SELECT status FROM accurate_write_requests/, [[{ status: 'pending' }]]]], []) }), true);
  assert.equal(await service.canUserDecide({ approval, conn: fakeConnection([[/SELECT status FROM accurate_write_requests/, [[{ status: 'rejected' }]]]], []) }), false);
});

test('approving queues the request (nothing is sent inside the decision); rejecting closes it', async (t) => {
  const approval = { id: 901, entity_id: 1, subject_id: 7 };
  for (const [decision, expected] of [['approved', 'queued'], ['rejected', 'rejected']]) {
    const calls = [];
    const conn = fakeConnection([[/FROM accurate_write_requests WHERE id = \? AND entity_id/, [[row()]]]], calls);
    const outcome = await service.applyApprovalDecision({ approval, result: { status: decision }, actorUserId: 12, note: 'ok', conn });
    assert.equal(outcome.status, expected);
    const update = calls.find((c) => /UPDATE accurate_write_requests SET status = \?/.test(c.sql));
    assert.equal(update.args[0], expected);
    assert.equal(update.args[1], 12);
  }
  assert.deepEqual(await service.applyApprovalDecision({ approval, result: { status: 'revision_requested' }, actorUserId: 12, conn: fakeConnection([], []) }), { changed: false });
  // After the commit: the queue is tried once, and with the channel closed
  // the request stays queued with the reason on it.
  t.mock.method(activityLog, 'log', async () => {});
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/SELECT \* FROM accurate_write_requests WHERE id = \? LIMIT 1/.test(sql)) return [[row({ status: 'queued' })]];
    return [{ affectedRows: 1 }];
  });
  await service.afterDecision({ changed: true, status: 'queued', requestId: 7, entityId: 1 }, 12);
  const note = calls.find((c) => /SET last_attempt_at = NOW\(\), last_error = \?/.test(c.sql));
  assert.ok(note, 'the reason is recorded');
  assert.match(note.args[0], /belum dinyalakan|belum disambungkan/);
  assert.equal(calls.some((c) => /status = 'sent'/.test(c.sql)), false);
});

// ------------------------------------------------------------------ queue

test('queue: a blocked send keeps the request queued; a permanent refusal fails it; a success marks it sent', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/SELECT \* FROM accurate_write_requests WHERE id = \? LIMIT 1/.test(sql)) return [[row({ status: 'queued' })]];
    if (/SELECT id FROM accurate_write_requests WHERE status = 'queued'/.test(sql)) return [[{ id: 7 }]];
    return [{ affectedRows: 1 }];
  });
  assert.deepEqual(await service.dispatchQueued(1), { sent: 0, blocked: 1, failed: 0 });
  t.mock.method(transport, 'send', async () => { const e = new Error('Accurate menolak: nomor sudah ada'); e.permanent = true; throw e; });
  assert.equal((await service.dispatchOne(7)).failed, true);
  const failed = calls.filter((c) => /attempts = attempts \+ 1, last_attempt_at = NOW\(\), last_error = \?, status = \?/.test(c.sql)).pop();
  assert.equal(failed.args[1], 'failed');
  t.mock.method(transport, 'send', async () => ({ sent: true, accurateId: '123', number: 'C-900', response: { ok: true } }));
  assert.equal((await service.dispatchOne(7)).sent, true);
  assert.ok(calls.some((c) => /status = 'sent'/.test(c.sql) && c.args[0] === '123'));
  // A request that is not queued is never sent.
  t.mock.method(pool, 'query', async () => [[row({ status: 'pending' })]]);
  assert.deepEqual(await service.dispatchOne(7), { skipped: true });
});

test('confirmation: a sent request is confirmed only when the approved mirror shows the record', async (t) => {
  const calls = [];
  let mirror = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/status = 'sent'/.test(sql) && /SELECT \*/.test(sql)) return [[row({ status: 'sent', accurate_id: '123' })]];
    if (/FROM accurate_latest/.test(sql)) return [mirror];
    return [{ affectedRows: 1 }];
  });
  assert.deepEqual(await service.confirmSent(1), { checked: 1, confirmed: 0 });
  mirror = [{ accurate_id: '123', number: 'C-900', name: 'Toko Maju Jaya', status: 'Aktif', data: null }];
  assert.deepEqual(await service.confirmSent(1), { checked: 1, confirmed: 1 });
  const update = calls.find((c) => /status = 'confirmed'/.test(c.sql));
  assert.match(update.args[2], /berbeda di Accurate: name/);
});

// ------------------------------------------------------------------ cancel & read

test('cancelling: the requester or an overseer, while pending (withdrawing the approval) or queued; never once sent', async (t) => {
  silence(t);
  const calls = [];
  let current = row();
  t.mock.method(pool, 'getConnection', async () => fakeConnection([[/FROM accurate_write_requests WHERE id = \? AND entity_id/, () => [[current]]]], calls));
  t.mock.method(pool, 'query', async (sql) => (/FROM accurate_write_requests w/.test(sql) ? [[row({ status: 'cancelled' })]] : [[]]));
  t.mock.method(engine, 'withdrawRequest', async (args) => { calls.push({ sql: 'withdraw', args }); return { status: 'cancelled' }; });
  await assert.rejects(() => service.cancelRequest(USER, 7, ''), (e) => /alasan/.test(e.message));
  await assert.rejects(() => service.cancelRequest({ ...USER, sub: 99 }, 7, 'salah'), (e) => e.status === 403);
  const result = await service.cancelRequest(USER, 7, 'salah ketik');
  assert.equal(result.status, 'cancelled');
  assert.equal(calls.find((c) => c.sql === 'withdraw').args.approvalRequestId, 901);
  current = row({ status: 'queued' });
  calls.length = 0;
  await service.cancelRequest(OVERSEER, 7, 'tidak jadi');
  assert.equal(calls.some((c) => c.sql === 'withdraw'), false, 'an approved request has no pending approval to withdraw');
  current = row({ status: 'sent' });
  await assert.rejects(() => service.cancelRequest(OVERSEER, 7, 'terlambat'), (e) => e.code === 'CONFLICT');
});

test('reading: the detail carries the changes and whether sending is on; the list filters open ones', async (t) => {
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/WHERE w\.id = \?/.test(sql)) return [[row({ action: 'update', accurate_id: '55', before_data: JSON.stringify({ number: 'C-900', name: 'Toko Lama' }) })]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ n: 1 }]];
    if (/FROM accurate_write_requests w/.test(sql)) { t.mock.method(pool, 'query', async () => [[]]); return [[row()]]; }
    return [[]];
  });
  const detail = await service.getRequest(USER, 7);
  assert.deepEqual(detail.changes, [{ field: 'name', before: 'Toko Lama', after: 'Toko Maju' }, { field: 'city', before: null, after: 'Bandung' }]);
  assert.equal(detail.sendEnabled, false);
  assert.equal(detail.before.name, 'Toko Lama');
});

test('list: "open" means pending, queued or sent; "mine" narrows to the caller', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\)/.test(sql)) return [[{ n: 0 }]];
    return [[]];
  });
  const result = await service.listRequests(USER, { status: 'open', mine: '1', recordType: 'vendor' });
  assert.deepEqual(result, { items: [], total: 0, page: 1, limit: 25 });
  const list = calls[0];
  assert.match(list.sql, /w.status IN \(\?\)/);
  assert.deepEqual(list.args[1], ['pending', 'queued', 'sent']);
  assert.equal(list.args[2], 'vendor');
  assert.equal(list.args[3], 11);
});

test('reconciliation: app customers Accurate lacks or names differently, with any open request on them', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 10, missing: 2, differs: 1 }]];
    if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 2 }]];
    return [[
      { id: 40, customer_code: 'C-900', name: 'Toko Maju', channel: 'Grosir', accurate_id: null, accurate_name: null, request_id: 7, request_status: 'pending' },
      { id: 41, customer_code: 'C-901', name: 'Toko Lain', channel: null, accurate_id: '56', accurate_name: 'Toko Lain Jaya', request_id: null, request_status: null },
    ]];
  });
  const r = await service.reconcileCustomers(USER, { kind: 'missing' });
  assert.deepEqual(r.summary, { customers: 10, matched: 7, missing: 2, differs: 1 });
  assert.equal(r.items[0].kind, 'missing');
  assert.deepEqual(r.items[0].request, { id: 7, status: 'pending' });
  assert.equal(r.items[0].payload.number, 'C-900');
  assert.equal(r.items[1].kind, 'name');
  assert.equal(r.items[1].accurateName, 'Toko Lain Jaya');
  assert.match(calls[0].sql, /AND a\.accurate_id IS NULL ORDER BY/);
  // Only reads: a reconciliation never changes the app's data or the mirror.
  assert.equal(calls.some((c) => /INSERT|UPDATE|DELETE/.test(c.sql)), false);
});

// ------------------------------------------------------------------ policy

test('standard roles: Sales, Retail Commerce and Procurement may propose; nobody else; migration 145 seeds the permission and the matrix', () => {
  const may = STANDARD_ROLES.filter((r) => r.permissions.includes('accurate.write.request')).map((r) => r.key).sort();
  assert.deepEqual(may, [
    'procurement.head', 'procurement.member', 'procurement.supervisor',
    'retail_commerce.head', 'retail_commerce.member', 'retail_commerce.supervisor',
    'sales.head', 'sales.member', 'sales.supervisor',
  ]);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/145_accurate_write_requests.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS accurate_write_requests/);
  assert.match(sql, /UNIQUE KEY uq_accurate_write_key \(entity_id, request_key\)/);
  assert.match(sql, /\('accurate\.write\.request'/);
  assert.match(sql, /'accurate_write', 1, 1, supervisor\.id, head\.id/);
  assert.match(sql, /d\.code IN \('sales', 'retail_commerce', 'procurement'\)/);
  for (const key of ['sales.member', 'retail_commerce.head', 'procurement.supervisor']) assert.match(sql, new RegExp(`'${key}'`));
});
