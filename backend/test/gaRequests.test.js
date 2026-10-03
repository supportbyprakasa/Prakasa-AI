const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, dbReady, inRolledBackTransaction, makeUser, makeLocation, asUser,
} = require('./fixtures/gaDb');
const rules = require('../src/services/gaRules');
const requests = require('../src/services/gaRequests.service');
const { schemas } = require('../src/routes/ga.routes');
const approvals = require('../src/controllers/approvals.controller');

// Layanan GA — Permintaan (docs/rancangan-people-culture-g2.md §3.2, §3.7):
// status machine, time targets stored when the clock starts, approval only
// for "Lainnya", cancel rules, the process permission, attachment limits,
// strict schemas, separation of duties at the decision.

test.after(() => pool.end());

const SKIP = 'no database with migration 109';
const code = (expected) => (error) => {
  assert.equal(error.code, expected, `${error.code}: ${error.message}`);
  return true;
};

// The real decision path: the approvals controller, on the test transaction.
async function decide(approvalId, user, action, note = null) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let thrown = null;
  await approvals.decide({ entityScope: { entityId: user.entityId }, params: { id: approvalId }, body: { action, note }, user }, res, (e) => { thrown = e; });
  if (thrown) throw thrown;
  return res;
}

// ------------------------------------------------------------------ pure rules

test('SLA: ATK 2 days, facility repair 3 (urgent 1), other 5 — calendar days from the clock start', () => {
  assert.equal(rules.slaDaysFor('atk'), 2);
  assert.equal(rules.slaDaysFor('facility_repair', 'normal'), 3);
  assert.equal(rules.slaDaysFor('facility_repair', 'urgent'), 1);
  assert.equal(rules.slaDaysFor('other'), 5);
  const start = new Date('2026-10-01T02:00:00Z');
  assert.equal(rules.dueAtFrom(start, 2).toISOString(), '2026-10-03T02:00:00.000Z');
  assert.equal(rules.needsApproval('other'), true);
  assert.equal(rules.needsApproval('atk'), false);
  assert.equal(rules.needsApproval('facility_repair'), false);
});

test('status machine: GA moves open → in progress → done, and may reject while running; nothing else', () => {
  assert.ok(rules.canProcessTransition('open', 'in_progress'));
  assert.ok(rules.canProcessTransition('in_progress', 'done'));
  assert.ok(rules.canProcessTransition('open', 'rejected'));
  assert.ok(rules.canProcessTransition('in_progress', 'rejected'));
  for (const [from, to] of [['open', 'done'], ['done', 'in_progress'], ['rejected', 'open'], ['cancelled', 'open'], ['pending_approval', 'open'], ['done', 'rejected']]) {
    assert.equal(rules.canProcessTransition(from, to), false, `${from} → ${to}`);
  }
  assert.deepEqual([...rules.CANCELLABLE_REQUEST], ['pending_approval', 'open']);
});

test('API times carry the WIB offset; the WIB day changes at 17:00 UTC', () => {
  assert.equal(rules.toApiTime(new Date('2026-10-01T16:30:00Z')), '2026-10-01T23:30:00+07:00');
  assert.equal(rules.toApiTime(new Date('2026-10-01T17:30:00Z')), '2026-10-02T00:30:00+07:00');
  assert.equal(rules.wibDay(new Date('2026-10-01T16:59:00Z')), '2026-10-01');
  assert.equal(rules.wibDay(new Date('2026-10-01T17:00:00Z')), '2026-10-02');
  assert.equal(rules.toApiTime(null), null);
});

test('schemas are strict: no entity, requester, status or number from the body; a union per request type', () => {
  const ok = schemas.requestBody.safeParse({ requestType: 'atk', locationId: 1, items: [{ itemName: 'Kertas A4', qty: 2, unit: 'rim' }] });
  assert.ok(ok.success);
  for (const extra of [{ entityId: 2 }, { requesterUserId: 3 }, { status: 'done' }, { requestNumber: 'GA-1' }, { slaDays: 9 }]) {
    const r = schemas.requestBody.safeParse({ requestType: 'atk', locationId: 1, items: [{ itemName: 'Kertas', qty: 1, unit: 'rim' }], ...extra });
    assert.equal(r.success, false, JSON.stringify(extra));
  }
  assert.equal(schemas.requestBody.safeParse({ requestType: 'atk', locationId: 1, items: [] }).success, false);
  assert.equal(schemas.requestBody.safeParse({
    requestType: 'atk', locationId: 1, items: Array.from({ length: 21 }, () => ({ itemName: 'x', qty: 1, unit: 'pcs' })),
  }).success, false, 'max 20 lines');
  assert.equal(schemas.requestBody.safeParse({ requestType: 'atk', locationId: 1, items: [{ itemName: 'x', qty: 0, unit: 'pcs' }] }).success, false, 'qty > 0');
  assert.equal(schemas.requestBody.safeParse({ requestType: 'facility_repair', locationId: 1, area: 'AC', description: 'Bocor', urgent: true }).success, true);
  assert.equal(schemas.requestBody.safeParse({ requestType: 'facility_repair', locationId: 1, title: 'x', description: 'y' }).success, false, 'repair needs an area');
  assert.equal(schemas.requestBody.safeParse({ requestType: 'other', locationId: 1, title: 'Sewa tenda', description: 'Acara' }).success, true);
  assert.equal(schemas.requestBody.safeParse({ requestType: 'catering', locationId: 1 }).success, false);
  assert.equal(schemas.statusBody.safeParse({ status: 'open', version: 1 }).success, false, 'GA cannot reopen');
  assert.equal(schemas.statusBody.safeParse({ status: 'done', note: 'ok', version: 1, assignedTo: 5 }).success, false);
  assert.equal(schemas.cancelBody.safeParse({ reason: '', version: 1 }).success, false, 'reason required');
});

test('attachments: images or PDF only, at most 10 MB', () => {
  assert.throws(() => requests.checkAttachment(null), code('VALIDATION_ERROR'));
  assert.throws(() => requests.checkAttachment({ mimetype: 'application/zip', size: 10 }), code('FILE_TYPE_NOT_ALLOWED'));
  assert.throws(() => requests.checkAttachment({ mimetype: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }), code('FILE_TOO_LARGE'));
  assert.doesNotThrow(() => requests.checkAttachment({ mimetype: 'application/pdf', size: 1024 }));
});

// ------------------------------------------------------------------ database

test('db: ATK and repair open at once with the target stored at creation; numbers GA-YYYYMM-NNNN in sequence', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf Sales', division: 'sales', roles: ['sales.member'] });
    const before = Date.now();
    const atk = await requests.create(staff.user, {
      requestType: 'atk', locationId: loc, note: 'Untuk minggu ini',
      items: [{ itemName: 'Kertas A4', qty: 2, unit: 'rim' }, { itemName: 'Pulpen', qty: 12, unit: 'pcs' }],
    });
    assert.equal(atk.status, 'open');
    assert.equal(atk.slaDays, 2);
    assert.match(atk.requestNumber, /^GA-\d{6}-\d{4}$/);
    assert.equal(atk.title, 'ATK: Kertas A4 (+1 barang lain)');
    assert.equal(atk.items.length, 2);
    const due = new Date(atk.dueAt).getTime();
    assert.ok(due - before >= 2 * 86400e3 - 5000 && due - before <= 2 * 86400e3 + 5000, 'due = clock start + 2 days');
    assert.equal(atk.approvalRequestId, null, 'no approval for ATK');
    assert.ok(atk.dueAt.endsWith('+07:00'));

    const repair = await requests.create(staff.user, { requestType: 'facility_repair', locationId: loc, area: 'AC ruang rapat', description: 'Bocor', urgent: true });
    assert.equal(repair.status, 'open');
    assert.equal(repair.slaDays, 1);
    assert.equal(repair.urgency, 'urgent');
    const n1 = Number(atk.requestNumber.slice(-4));
    assert.equal(repair.requestNumber, `${atk.requestNumber.slice(0, -4)}${String(n1 + 1).padStart(4, '0')}`);

    const [[row]] = await conn.query('SELECT department_id, sla_days, clock_started_at, due_at FROM ga_requests WHERE id = ?', [repair.id]);
    assert.equal(Number(row.department_id), staff.user.departmentId, "the requester's division");
    assert.equal(new Date(row.due_at).getTime() - new Date(row.clock_started_at).getTime(), 86400e3);
    // An inactive location is refused.
    await conn.query('UPDATE org_locations SET is_active = 0 WHERE id = ?', [loc]);
    await assert.rejects(requests.create(staff.user, { requestType: 'other', locationId: loc, title: 'x', description: 'y' }), code('LOCATION_INVALID'));
  });
});

test('db: "Lainnya" waits for the manager; the requester and excluded accounts cannot decide; approval starts the clock', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const boss = await makeUser(conn, { name: 'Atasan Gudang', division: 'warehouse', roles: ['warehouse.supervisor'] });
    const staff = await makeUser(conn, { name: 'Staf Gudang', division: 'warehouse', roles: ['warehouse.member'], managerPersonId: boss.personId });
    const created = await requests.create(staff.user, { requestType: 'other', locationId: loc, title: 'Sewa tenda', description: 'Acara 17-an' });
    assert.equal(created.status, 'pending_approval');
    assert.equal(created.approverBasis, 'manager');
    assert.equal(created.slaDays, null, 'no clock before approval');
    assert.equal(created.dueAt, null);
    const [[step]] = await conn.query('SELECT approver_user_id, approver_role_id, matrix_rule_id FROM approval_steps WHERE approval_request_id = ?', [created.approvalRequestId]);
    assert.equal(Number(step.approver_user_id), boss.id);
    assert.equal(step.approver_role_id, null);
    assert.ok(step.matrix_rule_id, 'the matrix rule stays attached (reminder/escalation)');

    // Manual creation through /approvals is refused for GA request types.
    const lifecycle = require('../src/services/approvalSubjectLifecycle.service');
    assert.ok(lifecycle.isManagedSubject('ga_request_other') && lifecycle.isManagedSubject('ga_vehicle_booking'));

    // The requester, even holding approval.decide through a role, cannot decide.
    await conn.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE entity_id = 1 AND role_key = 'warehouse.supervisor'", [staff.id]);
    await conn.query('UPDATE approval_steps SET approver_role_id = (SELECT id FROM roles WHERE entity_id = 1 AND role_key = ?), approver_user_id = NULL WHERE approval_request_id = ?', ['warehouse.supervisor', created.approvalRequestId]);
    const self = await asUser(conn, staff.id);
    const res = await decide(created.approvalRequestId, self, 'approve');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'SELF_APPROVAL_FORBIDDEN');
    const [[denied]] = await conn.query("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'ga.request.decision_denied' AND subject_id = ?", [created.id]);
    assert.equal(Number(denied.n), 1, 'the denial is logged');
    await conn.query('UPDATE approval_steps SET approver_user_id = ?, approver_role_id = NULL WHERE approval_request_id = ?', [boss.id, created.approvalRequestId]);

    // An excluded account is refused even when it is the approver.
    await conn.query("UPDATE people_directory SET kind = 'excluded', excluded_reason = 'Akun uji' WHERE id = ?", [boss.personId]);
    const excluded = await decide(created.approvalRequestId, boss.user, 'approve');
    assert.equal(excluded.body.error.code, 'APPROVER_EXCLUDED');
    await conn.query("UPDATE people_directory SET kind = 'employee', excluded_reason = NULL WHERE id = ?", [boss.personId]);

    // Revision is not a GA outcome.
    const revision = await decide(created.approvalRequestId, boss.user, 'request_revision', 'lengkapi');
    assert.equal(revision.body.error.code, 'REVISION_NOT_SUPPORTED');

    // The manager sees it and can decide; approval opens it with SLA 5 days from now.
    const seen = await requests.get(boss.user, created.id);
    assert.equal(seen.can.decide, true);
    const approved = await decide(created.approvalRequestId, boss.user, 'approve');
    assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
    const after = await requests.get(staff.user, created.id);
    assert.equal(after.status, 'open');
    assert.equal(after.slaDays, 5);
    assert.ok(Math.abs(new Date(after.dueAt).getTime() - Date.now() - 5 * 86400e3) < 10000);
    assert.equal(after.can.decide, false);
  });
});

test('db: a rejected "Lainnya" keeps the reason; a decision on a withdrawn approval is stale', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const boss = await makeUser(conn, { name: 'Atasan', division: 'finance', roles: ['finance.supervisor'] });
    const staff = await makeUser(conn, { name: 'Staf', division: 'finance', roles: ['finance.member'], managerPersonId: boss.personId });
    const a = await requests.create(staff.user, { requestType: 'other', locationId: loc, title: 'A', description: 'a' });
    const reject = await decide(a.approvalRequestId, boss.user, 'reject', 'Tidak ada anggaran');
    assert.equal(reject.statusCode, 200, JSON.stringify(reject.body));
    const rejected = await requests.get(staff.user, a.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectedReason, 'Tidak ada anggaran');

    const b = await requests.create(staff.user, { requestType: 'other', locationId: loc, title: 'B', description: 'b' });
    await requests.cancel(staff.user, b.id, { reason: 'Tidak jadi', version: b.version });
    const [[approval]] = await conn.query('SELECT status FROM approval_requests WHERE id = ?', [b.approvalRequestId]);
    assert.equal(approval.status, 'cancelled', 'cancel withdraws the pending approval');
    const [[skipped]] = await conn.query("SELECT COUNT(*) AS n FROM approval_steps WHERE approval_request_id = ? AND status = 'skipped'", [b.approvalRequestId]);
    assert.equal(Number(skipped.n), 1);
    const stale = await decide(b.approvalRequestId, boss.user, 'approve');
    assert.equal(stale.statusCode, 409);
  });
});

test('db: resolver for GA — no manager → division Head; a division without a Head → Management Office; never the requester', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const ops = await makeUser(conn, { name: 'Staf Retail', division: 'retail_commerce', roles: ['retail_commerce.member'] });
    const a = await requests.create(ops.user, { requestType: 'other', locationId: loc, title: 'A', description: 'a' });
    const [[holders]] = await conn.query(
      `SELECT COUNT(*) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
        WHERE r.role_key = 'retail_commerce.head' AND u.status = 'active' AND u.deleted_at IS NULL`,
    );
    assert.equal(a.approverBasis, Number(holders.n) ? 'division_head' : 'management_office');

    // A manager without approval.decide is skipped for the division Head.
    const plainBoss = await makeUser(conn, { name: 'Atasan tanpa approval', division: 'warehouse', roles: ['warehouse.member'] });
    const staff = await makeUser(conn, { name: 'Staf', division: 'warehouse', roles: ['warehouse.member'], managerPersonId: plainBoss.personId });
    const b = await requests.create(staff.user, { requestType: 'other', locationId: loc, title: 'B', description: 'b' });
    assert.notEqual(b.approverBasis, 'manager');
    const [[step]] = await conn.query('SELECT approver_user_id FROM approval_steps WHERE approval_request_id = ?', [b.approvalRequestId]);
    assert.notEqual(Number(step.approver_user_id), staff.id, 'never the requester');
  });
});

test('db: only GA processes; the requester cancels while nobody started; done needs a note; versions guard lost updates', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf', division: 'sales', roles: ['sales.member'] });
    const other = await makeUser(conn, { name: 'Staf lain', division: 'sales', roles: ['sales.member'] });
    const ga = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.member'] });
    const r = await requests.create(staff.user, { requestType: 'facility_repair', locationId: loc, area: 'Pintu', description: 'Engsel lepas' });

    await assert.rejects(requests.setStatus(staff.user, r.id, { status: 'in_progress', version: r.version }), code('FORBIDDEN'));
    await assert.rejects(requests.get(other.user, r.id), code('NOT_FOUND'), "another member never sees someone's request");
    await assert.rejects(requests.list(other.user, { scope: 'all' }), code('FORBIDDEN'));
    await assert.rejects(requests.cancel(other.user, r.id, { reason: 'x', version: r.version }), code('NOT_FOUND'));
    await assert.rejects(requests.setStatus(ga.user, r.id, { status: 'done', note: 'ok', version: r.version }), code('INVALID_STATUS'), 'open → done is not a step');
    await assert.rejects(requests.setStatus(ga.user, r.id, { status: 'in_progress', version: r.version + 1 }), code('VERSION_CONFLICT'));

    const started = await requests.setStatus(ga.user, r.id, { status: 'in_progress', version: r.version });
    assert.equal(started.status, 'in_progress');
    assert.equal(started.assignee.id, ga.id, 'whoever starts it takes it when unassigned');
    await assert.rejects(requests.cancel(staff.user, r.id, { reason: 'x', version: started.version }), code('INVALID_STATUS'));
    await assert.rejects(requests.setStatus(ga.user, r.id, { status: 'done', note: '', version: started.version }), code('VALIDATION_ERROR'));
    const done = await requests.setStatus(ga.user, r.id, { status: 'done', note: 'Engsel diganti', version: started.version });
    assert.equal(done.status, 'done');
    assert.equal(done.resolutionNote, 'Engsel diganti');
    assert.equal(done.onTime, true);
    await assert.rejects(requests.setStatus(ga.user, r.id, { status: 'rejected', note: 'x', version: done.version }), code('INVALID_STATUS'), 'no reopen');

    const r2 = await requests.create(staff.user, { requestType: 'atk', locationId: loc, items: [{ itemName: 'Map', qty: 5, unit: 'pcs' }] });
    await assert.rejects(requests.setStatus(ga.user, r2.id, { status: 'rejected', version: r2.version }), code('VALIDATION_ERROR'));
    const rejected = await requests.setStatus(ga.user, r2.id, { status: 'rejected', note: 'Stok kantor masih ada', version: r2.version });
    assert.equal(rejected.rejectedReason, 'Stok kantor masih ada');

    const r3 = await requests.create(staff.user, { requestType: 'atk', locationId: loc, items: [{ itemName: 'Lakban', qty: 1, unit: 'roll' }] });
    const cancelled = await requests.cancel(staff.user, r3.id, { reason: 'Sudah beli sendiri', version: r3.version });
    assert.equal(cancelled.status, 'cancelled');

    // Assign: only to someone who processes GA.
    const r4 = await requests.create(staff.user, { requestType: 'atk', locationId: loc, items: [{ itemName: 'Spidol', qty: 2, unit: 'pcs' }] });
    await assert.rejects(requests.assign(ga.user, r4.id, { userId: other.id }), code('ASSIGNEE_INVALID'));
    const assigned = await requests.assign(ga.user, r4.id, { userId: ga.id });
    assert.equal(assigned.assignee.id, ga.id);

    // Lists: mine for the requester, all (with counts) for GA.
    const mine = await requests.list(staff.user, {});
    assert.equal(mine.meta.scope, 'mine');
    assert.ok(mine.rows.every((x) => x.requester.id === staff.id));
    const all = await requests.list(ga.user, { scope: 'all', status: 'open' });
    assert.ok(all.rows.some((x) => x.id === r4.id));
    assert.ok(all.meta.statusCounts.open >= 1);
  });
});

test('db: management reads its own division only; the overdue flag follows the stored target', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf Gudang', division: 'warehouse', roles: ['warehouse.member'] });
    const whHead = await makeUser(conn, { name: 'Head Gudang', division: 'warehouse', roles: ['warehouse.head'] });
    const salesHead = await makeUser(conn, { name: 'Head Sales', division: 'sales', roles: ['sales.head'] });
    const r = await requests.create(staff.user, { requestType: 'atk', locationId: loc, items: [{ itemName: 'Kertas', qty: 1, unit: 'rim' }] });
    const seen = await requests.get(whHead.user, r.id);
    assert.equal(seen.id, r.id);
    assert.equal(seen.can.process, false);
    await assert.rejects(requests.get(salesHead.user, r.id), code('NOT_FOUND'));
    await conn.query('UPDATE ga_requests SET due_at = UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id = ?', [r.id]);
    assert.equal((await requests.get(staff.user, r.id)).overdue, true);
  });
});

test('db: attachments — requester or GA only, max 3, uploaded through the Shared Drive uploader', async (t) => {
  if (!(await dbReady())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf', division: 'sales', roles: ['sales.member'] });
    const other = await makeUser(conn, { name: 'Lain', division: 'sales', roles: ['sales.member'] });
    const r = await requests.create(staff.user, { requestType: 'facility_repair', locationId: loc, area: 'Lampu', description: 'Mati' });
    let uploads = 0;
    const upload = async (file) => { uploads += 1; return { id: `drive-${uploads}`, webViewLink: 'https://drive.google.com/x', name: file.name, mimeType: file.mimeType, size: 3 }; };
    const file = { originalname: 'foto.jpg', mimetype: 'image/jpeg', size: 3, buffer: Buffer.from('abc') };
    await assert.rejects(requests.addAttachment(other.user, r.id, file, { upload }), code('NOT_FOUND'));
    for (let i = 0; i < 3; i += 1) await requests.addAttachment(staff.user, r.id, file, { upload });
    await assert.rejects(requests.addAttachment(staff.user, r.id, file, { upload }), code('ATTACHMENT_LIMIT'));
    assert.equal(uploads, 3, 'nothing is uploaded once the limit is reached');
    const detail = await requests.get(staff.user, r.id);
    assert.equal(detail.attachments.length, 3);
    assert.equal(detail.can.attach, false);
  });
});
