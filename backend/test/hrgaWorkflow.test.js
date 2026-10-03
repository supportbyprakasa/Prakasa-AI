const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  pool, dbReady, inRolledBackTransaction, makeUser, runTx, res,
} = require('./fixtures/hrgaDbHarness');
const svc = require('../src/services/hrgaWorkflow.service');
const rules = require('../src/services/hrgaChecklist');
const directory = require('../src/services/peopleDirectory.service');
const approvals = require('../src/controllers/approvals.controller');
const hrgaCtrl = require('../src/controllers/hrga.controller');
const { schemas } = require('../src/routes/hrga.routes');
const { todayWib } = require('../src/utils/wibTime');

// People & Culture wave 2, row 2.1 — onboarding & offboarding ready for use.
// Pure rules first, then the whole flow against the local schema inside one
// rolled-back transaction (docs/rancangan-people-culture-g2.md §2.1.9).

test.after(() => pool.end());

const TODAY = todayWib();
const day = (n) => rules.addDays(TODAY, n);
const ENV_DOMAINS = 'prakasagroup.com,prakasafoods.com';

// ------------------------------------------------------------------ pure rules

test('checklist: due dates are relative to the join/last day and never before the approval day (D5)', () => {
  assert.equal(rules.dueDate('2026-10-12', -2, '2026-10-01'), '2026-10-10');
  assert.equal(rules.dueDate('2026-10-02', -2, '2026-10-01'), '2026-10-01', 'floored at the approval day');
  assert.equal(rules.dueDate('2026-09-28', 0, '2026-10-01'), '2026-10-01');
});

test('checklist: needs filter the items, one licence item per subscription, holdings become linked return items', () => {
  const on = rules.planItems({
    workflowType: 'onboarding', templateItems: rules.BUILT_IN.onboarding,
    needs: { google: true, app: false, device: 'none', licenses: [7, 8], phone: 'none', desk: true, idCard: false },
    subscriptions: [{ id: 7, productName: 'Figma' }, { id: 8, productName: 'Canva' }],
    baseDay: '2026-10-12', approvalDay: '2026-10-01',
  });
  const cats = on.map((i) => i.category);
  assert.ok(cats.includes('google_workspace_access') && cats.includes('shared_drive_access') && cats.includes('desk_setup'));
  assert.ok(!cats.includes('app_account') && !cats.includes('device_handover') && !cats.includes('phone_line') && !cats.includes('id_card'));
  assert.deepEqual(on.filter((i) => i.category === 'software_license').map((i) => [i.title, i.linkedSubscriptionId]), [['Berikan lisensi Figma', 7], ['Berikan lisensi Canva', 8]]);
  assert.equal(on.find((i) => i.category === 'google_workspace_access').dueDate, '2026-10-10');
  assert.deepEqual([...new Set(on.map((i) => i.ownerGroup))], ['it', 'ga', 'manager', 'pc'], 'grouped by team');

  const off = rules.planItems({
    workflowType: 'offboarding', templateItems: rules.BUILT_IN.offboarding, hasAccount: false,
    holdings: { devices: [{ assignmentId: 3, name: 'Lenovo' }], licenses: [{ licenseId: 4, subscriptionId: 7, productName: 'Figma' }], phoneLines: [{ id: 5, label: '+62812' }] },
    baseDay: '2026-10-15', approvalDay: '2026-10-01',
  });
  assert.ok(!off.some((i) => i.category === 'app_account_deactivation'), 'no account, no app deactivation item');
  assert.equal(off.find((i) => i.category === 'device_return').linkedDeviceAssignmentId, 3);
  assert.equal(off.find((i) => i.category === 'software_license').linkedSubscriptionLicenseId, 4);
  assert.equal(off.find((i) => i.category === 'phone_line_return').linkedPhoneLineId, 5);
  assert.ok(off.some((i) => i.category === 'access_revoke'), 'access is always revoked (decision 22)');
  assert.equal(rules.missingHoldingItems(off, [{ linked_device_assignment_id: 3 }]).length, 2);
  assert.match(rules.templateItemProblem('offboarding', { category: 'device_return' }), /otomatis/);
  assert.equal(rules.templateItemProblem('onboarding', { category: 'desk_setup' }), null);
});

test('routes: strict bodies refuse an entity, a personal phone, a free-text reason and KantorKu documents', () => {
  const base = {
    workflowType: 'onboarding', employeeFullName: 'Calon', departmentId: 9, joinDate: '2026-10-12',
    needs: { google: true, app: true, device: 'laptop', licenses: [], phone: 'none', desk: true, idCard: true },
  };
  assert.equal(schemas.createBody.safeParse(base).success, true);
  for (const extra of [{ entityId: 2 }, { employeePhone: '0812' }, { autoCreateLinkedTasks: true }, { employeeDivision: 'X' }]) {
    assert.equal(schemas.createBody.safeParse({ ...base, ...extra }).success, false, Object.keys(extra)[0]);
  }
  const off = { workflowType: 'offboarding', personKey: 'p4', lastWorkingDate: '2026-10-15', reasonCode: 'resign' };
  assert.equal(schemas.createBody.safeParse(off).success, true);
  assert.equal(schemas.createBody.safeParse({ ...off, reason: 'cerita panjang' }).success, false);
  assert.equal(schemas.createBody.safeParse({ ...off, reasonCode: 'dipecat' }).success, false);
  assert.equal(schemas.updateBody.safeParse({ notes: 'x' }).success, false, 'version is required');
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/hrga.routes.js'), 'utf8');
  assert.match(src, /attachmentType: z\.enum\(\['handover_note', 'other'\]\)/);
  assert.doesNotMatch(src, /id_document|offer_letter|resignation_letter/);
});

test('apply-approval and the free-form task link are gone (410)', () => {
  const r1 = res();
  hrgaCtrl.applyApprovalResult({}, r1);
  assert.equal(r1.statusCode, 410);
  assert.equal(r1.body.error.code, 'APPROVAL_VIA_ENGINE');
  const r2 = res();
  hrgaCtrl.linkTask({}, r2);
  assert.equal(r2.statusCode, 410);
});

test('migration 108: additive, hrga.manage revoked only from the People & Culture Member system roles', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/108_hrga_wave2.sql'), 'utf8');
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN|INDEX|FOREIGN)/i);
  const deletes = sql.match(/DELETE[\s\S]*?;/g) || [];
  assert.equal(deletes.length, 1, 'one revoke only');
  assert.match(deletes[0], /r\.is_system_template = 1 AND d\.code = 'people_culture' AND r\.role_level = 'member'\s+AND p\.code = 'hrga\.manage'/);
  assert.match(sql, /'hrga_onboarding:default'/);
  assert.match(sql, /existing\.id IS NULL/, 'the matrix seed never duplicates an active rule');
  assert.match(sql, /UNIQUE KEY uq_hrga_open_person \(entity_id, workflow_type, open_person_key\)/);
  const org = require('../src/config/standardOrganization');
  assert.ok(!org.permissionsForStandardRole('people_culture.member').includes('hrga.manage'));
  assert.ok(org.permissionsForStandardRole('people_culture.supervisor').includes('hrga.manage'));
});

// ------------------------------------------------------------------ database

async function setup(conn) {
  const before = process.env.GOOGLE_ALLOWED_DOMAIN;
  process.env.GOOGLE_ALLOWED_DOMAIN = ENV_DOMAINS;
  const pcHead = await makeUser(conn, { name: 'Uji PC Head', departmentCode: 'people_culture', roles: ['people_culture.head'] });
  const pcMember = await makeUser(conn, { name: 'Uji PC Member', departmentCode: 'people_culture', roles: ['people_culture.member'] });
  const whHead = await makeUser(conn, { name: 'Uji Warehouse Head', departmentCode: 'warehouse', roles: ['warehouse.head'] });
  const whHead2 = await makeUser(conn, { name: 'Uji Warehouse Head Dua', departmentCode: 'warehouse', roles: ['warehouse.head'] });
  const whMember = await makeUser(conn, { name: 'Uji Warehouse Member', departmentCode: 'warehouse', roles: ['warehouse.member'] });
  const salesMember = await makeUser(conn, { name: 'Uji Sales Member', departmentCode: 'sales', roles: ['sales.member'] });
  const [[wh]] = await conn.query("SELECT id FROM departments WHERE entity_id = 1 AND code = 'warehouse'");
  const [[sales]] = await conn.query("SELECT id FROM departments WHERE entity_id = 1 AND code = 'sales'");
  const [sub] = await conn.query(
    "INSERT INTO software_subscriptions (entity_id, product_name, renewal_date, status, total_seats) VALUES (1, 'Uji Figma', ?, 'active', 2)",
    [day(200)],
  );
  const [lic] = await conn.query("INSERT INTO subscription_licenses (subscription_id, seat_label, status) VALUES (?, 'Seat uji 1', 'available')", [sub.insertId]);
  const [dev] = await conn.query("INSERT INTO devices (entity_id, device_type, brand, model, status) VALUES (1, 'laptop', 'Uji', 'Laptop A', 'available')");
  await runTx(conn, (tx) => svc.putPicSettings(tx, pcHead, { itUserId: pcHead.sub, gaUserId: null }));
  return {
    pcHead, pcMember, whHead, whHead2, whMember, salesMember, warehouseId: Number(wh.id), salesId: Number(sales.id),
    subscriptionId: Number(sub.insertId), licenseId: Number(lic.insertId), deviceId: Number(dev.insertId),
    restore: () => { if (before === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN; else process.env.GOOGLE_ALLOWED_DOMAIN = before; },
  };
}

async function decide(approvalId, user, action, note = null) {
  const r = res();
  let err = null;
  await approvals.decide({
    params: { id: approvalId }, body: { action, ...(note ? { note } : {}) }, user, entityScope: { entityId: 1 },
  }, r, (e) => { err = e; });
  if (err) throw err;
  return r;
}

const codeOf = async (promise) => {
  try { await promise; } catch (e) { return e.code; }
  return null;
};

test('db: onboarding — draft, preview, separation of duties, approval creates the person and the checklist, tasks, cancel', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 108');
  await inRolledBackTransaction(t, async (conn) => {
    const f = await setup(conn);
    try {
      const body = {
        workflowType: 'onboarding', employeeFullName: 'Calon Karyawan Uji', employeePosition: 'Admin Gudang',
        departmentId: f.warehouseId, managerKey: `u${f.whHead.sub}`, joinDate: day(7), plannedWorkEmail: ' Calon.Uji@PrakasaFoods.com ',
        needs: { google: true, app: true, device: 'laptop', licenses: [f.subscriptionId], phone: 'none', desk: true, idCard: false },
      };
      const created = await runTx(conn, (tx) => svc.create(tx, f.pcMember, body));
      assert.match(created.workflowNumber, /^ONB-\d{6}-\d{4}$/);
      const [[row]] = await conn.query('SELECT * FROM hrga_workflows WHERE id = ?', [created.id]);
      assert.equal(row.entity_id, 1);
      assert.equal(row.planned_work_email, 'calon.uji@prakasafoods.com');
      const [[noTasks]] = await conn.query('SELECT COUNT(*) AS n FROM hrga_workflow_tasks WHERE hrga_workflow_id = ?', [created.id]);
      assert.equal(Number(noTasks.n), 0, 'the checklist is created at approval, not at draft');

      const preview = await svc.checklistPreview(f.pcMember, created.id);
      assert.ok(preview.items.some((i) => i.title === 'Berikan lisensi Uji Figma'));
      assert.ok(!preview.items.some((i) => i.category === 'id_card'), 'needs filter the preview');
      assert.equal(preview.items.find((i) => i.category === 'google_workspace_access').dueDate, day(5));

      // A member edits only their own draft; another member's draft needs hrga.manage.
      const other = await runTx(conn, (tx) => svc.create(tx, f.pcHead, { ...body, employeeFullName: 'Calon Lain', plannedWorkEmail: null }));
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateDraft(tx, f.pcMember, other.id, { version: 1, notes: 'x' }))), 'FORBIDDEN');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateDraft(tx, f.pcMember, created.id, { version: 9, notes: 'x' }))), 'VERSION_CONFLICT');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateDraft(tx, f.pcMember, created.id, { version: 1, notes: 'password: rahasia' }))), 'SECRET_TEXT');
      await runTx(conn, (tx) => svc.updateDraft(tx, f.pcMember, created.id, { version: 1, notes: 'Mulai di gudang Alsut' }));

      const submitted = await runTx(conn, (tx) => svc.submit(tx, f.pcMember, created.id));
      assert.equal(submitted.approverBasis, 'manager');
      const [[step]] = await conn.query('SELECT approver_user_id, approver_role_id, matrix_rule_id FROM approval_steps WHERE approval_request_id = ?', [submitted.approvalRequestId]);
      assert.equal(Number(step.approver_user_id), f.whHead.sub);
      assert.ok(step.matrix_rule_id, 'the matrix rule stays attached (reminder / escalation)');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateDraft(tx, f.pcMember, created.id, { version: 3, notes: 'x' }))), 'CONFLICT');

      // Separation of duties at the decision point.
      const [[approval]] = await conn.query('SELECT * FROM approval_requests WHERE id = ?', [submitted.approvalRequestId]);
      assert.equal(await codeOf(svc.assertCanDecide({ approval, user: f.pcMember, action: 'approve', conn })), 'SELF_APPROVAL_FORBIDDEN');
      assert.equal(await codeOf(svc.assertCanDecide({ approval: { ...approval, id: approval.id + 100000 }, user: f.whHead, action: 'approve', conn })), 'STALE_APPROVAL');
      const [[denied]] = await conn.query("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'hrga.decision_denied' AND subject_id = ?", [created.id]);
      assert.equal(Number(denied.n), 1, 'a refused decision is logged');
      const whPerson = await directory.ensurePersonForUser(conn, 1, f.whHead.sub, null);
      await conn.query("UPDATE people_directory SET kind = 'excluded', excluded_reason = 'akun uji' WHERE id = ?", [whPerson.id]);
      assert.equal(await codeOf(svc.assertCanDecide({ approval, user: f.whHead, action: 'approve', conn })), 'APPROVER_EXCLUDED');
      assert.equal(await svc.canUserDecide({ approval, user: f.whHead, conn }), false);
      await conn.query("UPDATE people_directory SET kind = 'employee', excluded_reason = NULL WHERE id = ?", [whPerson.id]);
      assert.equal(await svc.canUserDecide({ approval, user: f.whHead, conn }), true);
      const viewer = await svc.detail(f.whHead, created.id);
      assert.equal(viewer.viewer.canDecide, true);
      assert.equal(viewer.limited, true, 'the manager outside People & Culture reads the limited view');
      assert.equal('kantorkuReferenceUrl' in viewer || 'notes' in viewer || 'attachments' in viewer, false);

      // A failing approval rolls back completely: the subscription is gone, so the licence item cannot be written.
      await conn.query('SAVEPOINT before_fail');
      await conn.query('DELETE FROM software_subscriptions WHERE id = ?', [f.subscriptionId]);
      await assert.rejects(decide(approval.id, f.whHead, 'approve'));
      const [[stillPending]] = await conn.query('SELECT h.status, a.status AS a_status FROM hrga_workflows h JOIN approval_requests a ON a.id = h.approval_request_id WHERE h.id = ?', [created.id]);
      assert.deepEqual({ ...stillPending }, { status: 'pending_approval', a_status: 'pending' });
      await conn.query('ROLLBACK TO SAVEPOINT before_fail');

      const r = await decide(approval.id, f.whHead, 'approve');
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      const wf = await svc.detail(f.pcHead, created.id);
      assert.equal(wf.status, 'approved');
      assert.ok(wf.personId && wf.personCreated);
      const [[person]] = await conn.query("SELECT full_name, work_email, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts, department_id, manager_id FROM people_directory WHERE id = ?", [wf.personId]);
      assert.deepEqual({ ...person }, { full_name: 'Calon Karyawan Uji', work_email: 'calon.uji@prakasafoods.com', starts: day(7), department_id: f.warehouseId, manager_id: whPerson.id });
      const summary = await directory.summary(1, conn);
      assert.ok(summary.upcoming >= 1, 'not counted before the join date');
      const entry = await directory.detail(1, `p${wf.personId}`, { canManage: false });
      assert.equal(entry.startsOn, day(7));

      const byCat = Object.fromEntries(wf.tasks.map((x) => [x.category, x]));
      assert.equal(byCat.google_workspace_access.dueDate, day(5));
      assert.equal(byCat.google_workspace_access.responsibleUserId, f.pcHead.sub, 'IT PIC from the setting');
      assert.equal(byCat.team_orientation.responsibleUserId, f.whHead.sub, 'the manager');
      assert.equal(byCat.email_account.responsibleUserId, f.pcMember.sub, 'the workflow PIC (requester)');
      assert.equal(byCat.desk_setup.responsibleUserId, null, 'no GA PIC set yet');
      assert.equal(byCat.software_license.linkedSubscriptionId, f.subscriptionId);
      const [[tasksLinked]] = await conn.query("SELECT COUNT(*) AS n FROM tasks WHERE source_type = 'hrga_workflow' AND source_id = ?", [created.id]);
      assert.equal(Number(tasksLinked.n), 0, 'one list only: nothing in the Tasks module (decision 11)');

      // Task rules.
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.pcHead, created.id, byCat.device_handover.id, { status: 'completed' }))), 'USE_TASK_ACTION');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.pcHead, created.id, byCat.google_workspace_access.id, { status: 'completed' }))), 'CONFIRM_REQUIRED');
      await runTx(conn, (tx) => svc.updateTask(tx, f.pcHead, created.id, byCat.google_workspace_access.id, { status: 'completed', confirmedInAdminConsole: true }));
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.pcHead, created.id, byCat.shared_drive_access.id, { status: 'skipped' }))), 'SKIP_REASON_REQUIRED');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.salesMember, created.id, byCat.team_orientation.id, { status: 'completed' }))), 'NOT_FOUND');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.pcMember, created.id, byCat.team_orientation.id, { status: 'completed' }))), 'FORBIDDEN');
      const own = await runTx(conn, (tx) => svc.updateTask(tx, f.whHead, created.id, byCat.team_orientation.id, { status: 'completed' }));
      assert.equal(own.workflowStatus, 'in_progress', 'the manager completes their own task; the first change starts the workflow');

      // Typed action: hand over a spare device to the new directory person.
      const handed = await runTx(conn, (tx) => svc.deviceHandover(tx, f.pcHead, created.id, byCat.device_handover.id, { deviceId: f.deviceId }));
      const [[assignment]] = await conn.query('SELECT person_id, assigned_to, status FROM device_assignments WHERE id = ?', [handed.assignmentId]);
      assert.deepEqual({ ...assignment }, { person_id: wf.personId, assigned_to: null, status: 'active' });
      assert.equal(await codeOf(runTx(conn, (tx) => svc.licenseAssign(tx, f.pcHead, created.id, byCat.software_license.id, { licenseId: f.licenseId }))), 'ACCOUNT_REQUIRED');

      // Read rule: a Warehouse Head reads their division's workflow (limited), Sales does not.
      assert.equal((await svc.detail(f.whHead2, created.id)).limited, true);
      assert.equal(await codeOf(svc.detail(f.salesMember, created.id)), 'NOT_FOUND');

      // Cancel: open tasks skipped, the new person excluded (never deleted), the assignment listed.
      const cancelled = await runTx(conn, (tx) => svc.cancel(tx, f.pcHead, created.id, 'Kandidat batal bergabung'));
      assert.equal(cancelled.directory, 'excluded');
      assert.equal(cancelled.openAssignments.length, 1);
      const [[ex]] = await conn.query('SELECT kind, excluded_reason FROM people_directory WHERE id = ?', [wf.personId]);
      assert.equal(ex.kind, 'excluded');
      assert.match(ex.excluded_reason, /Onboarding dibatalkan ONB-/);
      assert.equal(await codeOf(runTx(conn, (tx) => svc.updateTask(tx, f.pcHead, created.id, byCat.desk_setup.id, { status: 'completed' }))), 'WORKFLOW_NOT_RUNNING');
    } finally { f.restore(); }
  });
});

test('db: offboarding — holdings become linked tasks, resign on the last day, return actions, one open offboarding per person, cancel reverts', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 108');
  await inRolledBackTransaction(t, async (conn) => {
    const f = await setup(conn);
    try {
      const managerPerson = await directory.ensurePersonForUser(conn, 1, f.whHead.sub, null);
      const leaver = await directory.ensurePersonForUser(conn, 1, f.whMember.sub, null);
      await conn.query('UPDATE people_directory SET manager_id = ? WHERE id = ?', [managerPerson.id, leaver.id]);
      const [a] = await conn.query(
        "INSERT INTO device_assignments (entity_id, device_id, assigned_to, status) VALUES (1, ?, ?, 'active')", [f.deviceId, f.whMember.sub],
      );
      await conn.query("UPDATE devices SET status = 'assigned', current_assignee_id = ? WHERE id = ?", [f.whMember.sub, f.deviceId]);
      await conn.query("UPDATE subscription_licenses SET status = 'assigned', assigned_to = ? WHERE id = ?", [f.whMember.sub, f.licenseId]);

      const body = { workflowType: 'offboarding', personKey: `p${leaver.id}`, lastWorkingDate: day(3), reasonCode: 'resign' };
      const created = await runTx(conn, (tx) => svc.create(tx, f.pcHead, body));
      assert.equal(await codeOf(runTx(conn, (tx) => svc.create(tx, f.pcHead, body))), 'OPEN_WORKFLOW_EXISTS');
      const submitted = await runTx(conn, (tx) => svc.submit(tx, f.pcHead, created.id));
      assert.equal(submitted.approverBasis, 'manager');
      const [[approval]] = await conn.query('SELECT * FROM approval_requests WHERE id = ?', [submitted.approvalRequestId]);
      assert.equal(await codeOf(svc.assertCanDecide({ approval, user: f.whMember, action: 'approve', conn })), 'SELF_APPROVAL_FORBIDDEN', 'the leaver never decides');
      const r = await decide(approval.id, f.whHead, 'approve');
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));

      const [[p]] = await conn.query("SELECT status, DATE_FORMAT(resigned_on, '%Y-%m-%d') AS d, resigned_on_source FROM people_directory WHERE id = ?", [leaver.id]);
      assert.deepEqual({ ...p }, { status: 'resigned', d: day(3), resigned_on_source: 'offboarding' });
      const listed = await directory.list(1, { q: 'Uji Warehouse Member' }, { canManage: false });
      assert.equal(listed.rows[0]?.lastDay, day(3), 'still listed with "Hari terakhir" until the last day');

      const wf = await svc.detail(f.pcHead, created.id);
      const byCat = Object.fromEntries(wf.tasks.map((x) => [x.category, x]));
      assert.equal(byCat.device_return.linkedDeviceAssignmentId, Number(a.insertId));
      assert.equal(byCat.software_license.linkedSubscriptionLicenseId, f.licenseId);
      assert.ok(byCat.app_account_deactivation, 'the leaver has an account');
      assert.ok(byCat.access_revoke);
      assert.equal(wf.holdings.devices.length, 1);

      const back = await runTx(conn, (tx) => svc.deviceReturn(tx, f.pcHead, created.id, byCat.device_return.id, { conditionOnReturn: 'good' }));
      assert.equal(back.newStatus, 'available');
      // F06: the task does not close until the vendor portal step is confirmed.
      await assert.rejects(runTx(conn, (tx) => svc.licenseRevoke(tx, f.pcHead, created.id, byCat.software_license.id)), { code: 'VENDOR_CONFIRM_REQUIRED' });
      await runTx(conn, (tx) => svc.licenseRevoke(tx, f.pcHead, created.id, byCat.software_license.id, { confirmedAtVendor: true }));
      const [[l]] = await conn.query('SELECT status, assigned_to FROM subscription_licenses WHERE id = ?', [f.licenseId]);
      assert.deepEqual({ ...l }, { status: 'available', assigned_to: null });

      // A device received after approval joins the checklist on request (D14), once.
      const [dev2] = await conn.query("INSERT INTO devices (entity_id, device_type, brand, model, status) VALUES (1, 'monitor', 'Uji', 'Monitor B', 'assigned')");
      await conn.query("INSERT INTO device_assignments (entity_id, device_id, assigned_to, status) VALUES (1, ?, ?, 'active')", [dev2.insertId, f.whMember.sub]);
      assert.deepEqual(await runTx(conn, (tx) => svc.holdingsSync(tx, f.pcHead, created.id)), { added: 1 });
      assert.deepEqual(await runTx(conn, (tx) => svc.holdingsSync(tx, f.pcHead, created.id)), { added: 0 });

      // Cancel reverts the resign written by this offboarding only.
      const cancelled = await runTx(conn, (tx) => svc.cancel(tx, f.pcHead, created.id, 'Batal resign'));
      assert.equal(cancelled.directory, 'reverted');
      const [[again]] = await conn.query('SELECT status, resigned_on FROM people_directory WHERE id = ?', [leaver.id]);
      assert.deepEqual({ ...again }, { status: 'active', resigned_on: null });
      // After a cancel the person may be offboarded again.
      await runTx(conn, (tx) => svc.create(tx, f.pcHead, body));
    } finally { f.restore(); }
  });
});

test('db: withdraw, templates (one active per division) and the PIC setting', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 108');
  await inRolledBackTransaction(t, async (conn) => {
    const f = await setup(conn);
    try {
      const created = await runTx(conn, (tx) => svc.create(tx, f.pcMember, {
        workflowType: 'onboarding', employeeFullName: 'Calon Tarik', departmentId: f.warehouseId, managerKey: `u${f.whHead.sub}`,
        joinDate: day(10), needs: { google: false, app: false, device: 'none', licenses: [], phone: 'none', desk: false, idCard: false },
      }));
      const s = await runTx(conn, (tx) => svc.submit(tx, f.pcMember, created.id));
      assert.equal(await codeOf(runTx(conn, (tx) => svc.withdraw(tx, f.pcHead, created.id, 'x'))), 'FORBIDDEN');
      await runTx(conn, (tx) => svc.withdraw(tx, f.pcMember, created.id, 'Tanggal mulai berubah'));
      const [[a]] = await conn.query('SELECT status FROM approval_requests WHERE id = ?', [s.approvalRequestId]);
      assert.equal(a.status, 'cancelled');
      const [[w]] = await conn.query('SELECT status FROM hrga_workflows WHERE id = ?', [created.id]);
      assert.equal(w.status, 'draft');

      const items = [{ category: 'desk_setup', title: 'Meja', ownerGroup: 'ga', offsetDays: -1, requires: 'desk' }];
      await runTx(conn, (tx) => svc.createTemplate(tx, f.pcHead, { workflowType: 'onboarding', departmentId: f.warehouseId, name: 'Gudang', items }));
      assert.equal(await codeOf(runTx(conn, (tx) => svc.createTemplate(tx, f.pcHead, { workflowType: 'onboarding', departmentId: f.warehouseId, name: 'Gudang 2', items }))), 'TEMPLATE_ACTIVE_EXISTS');
      assert.equal(await codeOf(runTx(conn, (tx) => svc.createTemplate(tx, f.pcHead, { workflowType: 'offboarding', departmentId: null, name: 'X', items: [{ category: 'device_return', title: 'Y', ownerGroup: 'it', offsetDays: 0 }] }))), 'TEMPLATE_ITEM_INVALID');
      const preview = await svc.checklistPreview(f.pcHead, created.id);
      assert.deepEqual(preview.items.map((i) => i.category), [], 'the division template applies (desk not needed here)');

      assert.equal(await codeOf(runTx(conn, (tx) => svc.putPicSettings(tx, f.pcHead, { itUserId: f.salesMember.sub, gaUserId: null }))), 'PIC_PERMISSION');
      const pic = await svc.getPicSettings(f.pcHead);
      assert.equal(pic.itUserId, f.pcHead.sub);
      assert.ok(pic.candidates.it.some((u) => u.id === f.pcHead.sub));
    } finally { f.restore(); }
  });
});
