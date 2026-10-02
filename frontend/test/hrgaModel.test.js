import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_TYPES, GOOGLE_ADMIN_URL, adminConsoleLink, attachmentTypeLabel, categoryLabel, checklistProgress, groupTasks, headerActions,
  holdingsSummary, needsAdminConsoleConfirm, needsSummary, offsetLabel, previewGroups, statusChips, taskMenuActions, taskPrimaryAction,
  templateCategoryAllowed, templateCategoryOptions, templateErrors, templateItemCount, templateItemsBody, workflowBadge, workflowBody,
  workflowFieldErrorFromApi, workflowFormErrors, workflowFormValues, workflowListQuery,
} from '../src/pages/hrga/hrgaModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

// People & Culture wave 2, row 2.1 (docs/rancangan-people-culture-g2.md §2.1.6, §2.1.9).
const running = (type = 'onboarding', viewer = {}) => ({ workflowType: type, status: 'in_progress', viewer });
const task = (over) => ({ id: 1, category: 'custom', ownerGroup: 'pc', status: 'pending', canAct: true, ...over });
const ALL = ['device.assign', 'subscription.license.manage', 'it.infra.manage', 'hrga.view', 'hrga.manage'];

test('checklist progress counts completed and skipped tasks as done', () => {
  assert.deepEqual(checklistProgress([{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }]), { done: 1, total: 3, pct: 33 });
  assert.deepEqual(checklistProgress([{ status: 'completed' }, { status: 'skipped' }]), { done: 2, total: 2, pct: 100 });
  assert.deepEqual(checklistProgress(undefined), { done: 0, total: 0, pct: 0 });
});

test('template items are counted from JSON text or an array', () => {
  assert.equal(templateItemCount('[{"title":"a"},{"title":"b"}]'), 2);
  assert.equal(templateItemCount([{}, {}, {}]), 3);
  assert.equal(templateItemCount('not json'), 0);
  assert.equal(templateItemCount(null), 0);
});

test('labels: categories, attachments (only handover note and other can be uploaded), statuses', () => {
  assert.equal(categoryLabel('device_handover'), 'Serah terima perangkat');
  assert.equal(categoryLabel('access_revoke'), 'Cabut akses server/NAS dan aplikasi lain');
  assert.equal(categoryLabel('unknown_code'), 'unknown_code');
  assert.deepEqual(ATTACHMENT_TYPES.map((t) => t.value), ['handover_note', 'other']);
  assert.equal(attachmentTypeLabel('offer_letter'), 'Surat penawaran kerja', 'old attachments keep their label');
  assert.equal(attachmentTypeLabel('other'), 'Lainnya');
  assert.equal(statusLabel('skipped'), 'Dilewati');
  assert.deepEqual(workflowBadge('approved'), { status: 'running', label: 'Berjalan' });
  assert.deepEqual(workflowBadge('in_progress'), { status: 'running', label: 'Berjalan' });
  assert.equal(statusTone(workflowBadge('pending_approval').status), 'warning');
  assert.equal(statusTone('person_last_day'), 'warning');
});

test('list chips carry meta.counts; "Perlu revisi" only when there is one or it is selected', () => {
  const counts = { all: 9, draft: 2, pending_approval: 1, revision_requested: 0, running: 4, completed: 1, closed: 1 };
  const chips = statusChips(counts, 'running');
  assert.deepEqual(chips.map((c) => c.label), ['Semua (9)', 'Draf (2)', 'Menunggu approval (1)', 'Berjalan (4)', 'Selesai (1)', 'Ditolak/dibatalkan (1)']);
  assert.equal(chips.find((c) => c.selected).key, 'running');
  assert.ok(statusChips({ ...counts, revision_requested: 3 }).some((c) => c.key === 'revision_requested'));
  assert.ok(statusChips(counts, 'revision_requested').some((c) => c.key === 'revision_requested'));
  assert.equal(statusChips(null)[0].label, 'Semua', 'no counts yet: plain labels');
  assert.deepEqual(workflowListQuery({ type: 'offboarding', status: 'bogus', q: ' ani ' }), { type: 'offboarding', page: 1, limit: 20, q: 'ani' });
  assert.deepEqual(workflowListQuery({ type: 'onboarding', status: 'closed', page: 2 }), { type: 'onboarding', page: 2, limit: 20, status: 'closed' });
});

test('tasks group IT / GA / Atasan / People & Culture in sort order, empty groups dropped', () => {
  const groups = groupTasks([
    task({ id: 1, ownerGroup: 'pc', sortOrder: 2 }),
    task({ id: 2, ownerGroup: 'it', sortOrder: 5 }),
    task({ id: 3, ownerGroup: 'it', sortOrder: 1 }),
    task({ id: 4, ownerGroup: 'manager', sortOrder: 0 }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['IT', 'Atasan', 'People & Culture']);
  assert.deepEqual(groups[0].tasks.map((t) => t.id), [3, 2]);
  assert.deepEqual(groupTasks(null), []);
});

test('checklist preview keeps the server order inside each team', () => {
  const preview = previewGroups([
    { category: 'team_orientation', ownerGroup: 'manager', title: 'Orientasi', dueDate: '2026-10-12' },
    { category: 'google_workspace_access', ownerGroup: 'it', title: 'Akun Google', dueDate: '2026-10-09' },
    { category: 'device_handover', ownerGroup: 'it', title: 'Laptop', dueDate: '2026-10-12' },
  ]);
  assert.equal(preview.total, 3);
  assert.deepEqual(preview.groups.map((g) => [g.label, g.tasks.map((t) => t.title)]), [['IT', ['Akun Google', 'Laptop']], ['Atasan', ['Orientasi']]]);
  assert.deepEqual(previewGroups(undefined), { total: 0, groups: [] });
});

test('task row action follows the category, the linked record, and the workflow type', () => {
  const on = running('onboarding');
  const off = running('offboarding');
  const key = (t, wf = on) => taskPrimaryAction(task(t), wf, ALL)?.key ?? null;
  assert.equal(key({ category: 'device_handover' }), 'device_handover');
  assert.equal(key({ category: 'device_handover', linkedDeviceAssignmentId: 7, linkedAssignmentActive: true }), 'complete');
  assert.equal(key({ category: 'device_return', linkedAssignmentActive: true }, off), 'device_return');
  assert.equal(key({ category: 'device_return', linkedAssignmentActive: false }, off), 'complete', 'already returned elsewhere');
  assert.equal(key({ category: 'software_license', linkedSubscriptionId: 3 }), 'license_assign');
  assert.equal(key({ category: 'software_license', linkedSubscriptionId: 3, linkedSubscriptionLicenseId: 9, linkedLicenseActive: true }), 'complete');
  assert.equal(key({ category: 'software_license', linkedSubscriptionLicenseId: 9, linkedLicenseActive: true }, off), 'license_revoke');
  assert.equal(key({ category: 'software_license', linkedSubscriptionLicenseId: 9, linkedLicenseActive: false }, off), 'complete');
  assert.equal(key({ category: 'phone_line' }), 'phone_line');
  assert.equal(key({ category: 'phone_line_return', linkedPhoneLineId: 4 }, off), 'phone_line_return');
  assert.equal(key({ category: 'google_workspace_access' }), 'google_complete');
  assert.equal(key({ category: 'account_deactivation' }, off), 'google_complete');
  assert.equal(key({ category: 'exit_interview' }, off), 'complete');
});

test('task row action: nothing when done, not actionable, or the workflow is not running', () => {
  assert.equal(taskPrimaryAction(task({ status: 'completed' }), running(), ALL), null);
  assert.equal(taskPrimaryAction(task({ status: 'skipped' }), running(), ALL), null);
  assert.equal(taskPrimaryAction(task({ canAct: false }), running(), ALL), null);
  assert.equal(taskPrimaryAction(task(), { workflowType: 'onboarding', status: 'pending_approval' }, ALL), null);
  assert.equal(taskPrimaryAction(task(), { workflowType: 'onboarding', status: 'approved' }, ALL).key, 'complete');
});

test('record actions need their permission; without it the button is disabled with a reason', () => {
  const manager = ['hrga.view'];
  const handover = taskPrimaryAction(task({ category: 'device_handover', ownerGroup: 'it' }), running(), manager);
  assert.equal(handover.allowed, false);
  assert.equal(handover.blockedReason, 'Butuh izin serah terima perangkat.');
  assert.equal(taskPrimaryAction(task({ category: 'device_handover' }), running(), ['device.assign']).allowed, true);
  assert.equal(taskPrimaryAction(task({ category: 'phone_line' }), running(), manager).allowed, false);
  assert.equal(taskPrimaryAction(task({ category: 'team_orientation', ownerGroup: 'manager' }), running(), []).allowed, true, 'a plain task needs no permission');
});

test('Google account tasks need the admin console confirmation and link to the constant console URL', () => {
  assert.equal(needsAdminConsoleConfirm({ category: 'google_workspace_access' }), true);
  assert.equal(needsAdminConsoleConfirm({ category: 'account_deactivation' }), true);
  assert.equal(needsAdminConsoleConfirm({ category: 'app_account_deactivation' }), false);
  assert.equal(adminConsoleLink({ category: 'account_deactivation' }), GOOGLE_ADMIN_URL);
  assert.equal(GOOGLE_ADMIN_URL, 'https://admin.google.com/ac/users');
  assert.equal(adminConsoleLink({ category: 'custom' }), null);
  assert.equal(taskPrimaryAction(task({ category: 'google_workspace_access' }), running(), []).confirm, true);
  assert.equal(taskPrimaryAction(task({ category: 'custom' }), running(), []).confirm, false);
});

test('task ⋮: skip for actionable tasks, reassign for hrga.manage, IT ticket only on IT tasks', () => {
  assert.deepEqual(taskMenuActions(task({ ownerGroup: 'it' }), running('onboarding', { canManage: true })), ['skip', 'assign', 'it_ticket']);
  assert.deepEqual(taskMenuActions(task({ ownerGroup: 'ga' }), running('onboarding', { canManage: false })), ['skip']);
  assert.deepEqual(taskMenuActions(task({ ownerGroup: 'it', canAct: false }), running('onboarding', { canManage: true })), ['assign']);
  assert.deepEqual(taskMenuActions(task({ status: 'completed' }), running('onboarding', { canManage: true })), []);
  assert.deepEqual(taskMenuActions(task(), { status: 'draft', viewer: { canManage: true } }), []);
});

test('header actions per state and viewer: decide in the header, ≤1 primary and 2 secondary, the rest in ⋮', () => {
  const draft = headerActions({ workflowType: 'onboarding', status: 'draft', viewer: { canSubmit: true, canEdit: true, canDelete: true } });
  assert.deepEqual(draft, { primary: ['submit'], secondary: [], menu: ['edit', 'delete'] });
  const revision = headerActions({ workflowType: 'onboarding', status: 'revision_requested', viewer: { canSubmit: true, canEdit: true, canDelete: true } });
  assert.deepEqual(revision, { primary: ['submit'], secondary: [], menu: ['edit'] }, 'delete is for drafts only');
  const approver = headerActions({ workflowType: 'onboarding', status: 'pending_approval', limited: true, viewer: { canDecide: true } });
  assert.deepEqual(approver, { primary: ['approve'], secondary: ['reject', 'request_revision'], menu: [] }, 'a limited approver still decides');
  const requester = headerActions({ workflowType: 'onboarding', status: 'pending_approval', viewer: { canWithdraw: true, canEditKantorku: true } });
  assert.deepEqual(requester, { primary: [], secondary: ['withdraw'], menu: ['kantorku'] });
  const head = headerActions({ workflowType: 'offboarding', status: 'in_progress', viewer: { canManage: true, canCancel: true, canHoldingsSync: true, canEditKantorku: true, canEdit: true } });
  assert.deepEqual(head, { primary: [], secondary: [], menu: ['holdings_sync', 'kantorku', 'cancel'] }, 'no edit once running');
  const member = headerActions({ workflowType: 'offboarding', status: 'in_progress', viewer: { canCancel: false } });
  assert.deepEqual(member, { primary: [], secondary: [], menu: [] });
  const limited = headerActions({ workflowType: 'offboarding', status: 'in_progress', limited: true, viewer: { canCancel: true, canEditKantorku: true } });
  assert.deepEqual(limited.menu, [], 'limited readers never get record management');
  assert.deepEqual(headerActions({ status: 'completed', viewer: { canCancel: true } }).menu, [], 'no cancel after completion');
});

test('form body is strict per type: no personal phone, no free-text reason, version on edit', () => {
  const on = workflowFormValues(null, 'onboarding');
  assert.equal(on.needs.device, 'laptop');
  const body = workflowBody({ ...on, employeeFullName: ' Ani ', departmentId: '4', joinDate: '2026-10-12', needs: { ...on.needs, licenses: ['3', '5'] } });
  assert.deepEqual(Object.keys(body).sort(), ['departmentId', 'employeeFullName', 'employeePosition', 'hrgaPicUserId', 'joinDate', 'locationId', 'managerKey', 'needs', 'notes', 'personKey', 'plannedWorkEmail', 'workflowType']);
  assert.equal(body.employeeFullName, 'Ani');
  assert.equal(body.departmentId, 4);
  assert.deepEqual(body.needs.licenses, [3, 5]);
  assert.equal('employeePhone' in body, false);
  const off = workflowBody({ ...workflowFormValues(null, 'offboarding'), personKey: 'p12', lastWorkingDate: '2026-10-15', reasonCode: 'resign' });
  assert.deepEqual(off, { workflowType: 'offboarding', personKey: 'p12', lastWorkingDate: '2026-10-15', reasonCode: 'resign', hrgaPicUserId: null, notes: null });
  const edit = workflowBody({ ...workflowFormValues(null, 'offboarding'), personKey: 'p12' }, { version: 3 });
  assert.equal(edit.version, 3);
  assert.equal('workflowType' in edit, false);
});

test('form values come from the detail DTO; required fields per type', () => {
  const values = workflowFormValues({ workflowType: 'onboarding', employeeName: 'Ani', departmentId: 4, joinDate: '2026-10-12', needs: { google: false, device: 'pc', licenses: [3] }, picUserId: 8 });
  assert.equal(values.employeeFullName, 'Ani');
  assert.equal(values.departmentId, '4');
  assert.equal(values.hrgaPicUserId, '8');
  assert.deepEqual(values.needs, { google: false, app: true, device: 'pc', licenses: ['3'], phone: 'none', desk: true, idCard: true });
  assert.deepEqual(Object.keys(workflowFormErrors(workflowFormValues(null, 'onboarding'))).sort(), ['departmentId', 'employeeFullName', 'joinDate']);
  assert.deepEqual(Object.keys(workflowFormErrors(workflowFormValues(null, 'offboarding'))).sort(), ['lastWorkingDate', 'personKey', 'reasonCode']);
  assert.equal(workflowFormErrors({ workflowType: 'onboarding', employeeFullName: 'A', departmentId: '1', joinDate: '2026-10-12', plannedWorkEmail: 'x' }).plannedWorkEmail, 'Format email tidak valid.');
  const conflict = { response: { data: { error: { code: 'OPEN_WORKFLOW_EXISTS', message: 'Sudah ada offboarding berjalan.' } } } };
  assert.deepEqual(workflowFieldErrorFromApi(conflict), { personKey: 'Sudah ada offboarding berjalan.' });
  const validation = { response: { data: { error: { code: 'VALIDATION_ERROR', details: { fieldErrors: { joinDate: ['Tanggal tidak valid'] } } } } } };
  assert.deepEqual(workflowFieldErrorFromApi(validation), { joinDate: 'Tanggal tidak valid' });
});

test('summaries: needs and holdings', () => {
  assert.equal(needsSummary({ google: true, app: false, device: 'laptop', phone: 'mobile', desk: false, idCard: true }, [{ productName: 'Canva' }]), 'Akun Google · Laptop · HP · Kartu akses · Lisensi Canva');
  assert.equal(needsSummary(null), '');
  assert.equal(holdingsSummary({ devices: [{}, {}], licenses: [{}], phoneLines: [] }), '2 perangkat · 1 lisensi · 0 nomor');
  assert.equal(holdingsSummary(null), '0 perangkat · 0 lisensi · 0 nomor');
});

test('templates: holdings-generated categories are never offered; rows validated; requires only for onboarding', () => {
  assert.equal(templateCategoryAllowed('device_return', 'offboarding'), false);
  assert.equal(templateCategoryAllowed('phone_line_return', 'offboarding'), false);
  assert.equal(templateCategoryAllowed('software_license', 'offboarding'), false);
  assert.equal(templateCategoryAllowed('software_license', 'onboarding'), true);
  assert.ok(!templateCategoryOptions('offboarding').some((o) => o.value === 'device_return'));
  const errors = templateErrors({ name: '', rows: [{ ownerGroup: 'it', category: 'device_return', title: '', offsetDays: '40' }], workflowType: 'offboarding' });
  assert.equal(errors.name, 'Nama template wajib diisi.');
  assert.deepEqual(Object.keys(errors.rows[0]).sort(), ['category', 'offsetDays', 'title']);
  assert.equal(templateErrors({ name: 'A', rows: [], workflowType: 'onboarding' }).form, 'Tambahkan minimal satu item.');
  assert.equal(templateErrors({ name: 'A', rows: [{ ownerGroup: 'pc', category: 'custom', title: 'X', offsetDays: '-3' }], workflowType: 'onboarding' }), null);
  const rows = [{ ownerGroup: 'it', category: 'device_handover', title: ' Laptop ', offsetDays: '-1', requires: 'device', description: '' }];
  assert.deepEqual(templateItemsBody(rows, 'onboarding'), [{ category: 'device_handover', title: 'Laptop', ownerGroup: 'it', offsetDays: -1, requires: 'device' }]);
  assert.equal('requires' in templateItemsBody(rows, 'offboarding')[0], false);
  assert.equal(offsetLabel(-3, 'onboarding'), '3 hari sebelum tanggal mulai');
  assert.equal(offsetLabel(0, 'offboarding'), 'Pada hari terakhir');
});
