const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pool, dbReady, inRolledBackTransaction, makeUser,
} = require('./fixtures/gaDb');
const notif = require('../src/services/notification.service');
const svc = require('../src/services/financeRequests.service');
const ctrl = require('../src/controllers/finance.controller');
const { schemas } = require('../src/routes/finance.routes');
const approvals = require('../src/controllers/approvals.controller');
const lifecycle = require('../src/services/approvalSubjectLifecycle.service');
const { validateProvider } = require('../src/management/contract');
const provider = require('../src/management/providers/finance');

// Finance — pengajuan pembayaran & reimbursement: the employee bank-account rule,
// who reads what (own / division / Finance), the status machine, the approval
// hook and the management provider contract.

test.after(() => pool.end());

const user = (permissions, extra = {}) => ({ sub: 10, entityId: 1, departmentId: 4, permissions, ...extra });
const row = (extra = {}) => ({ id: 1, entity_id: 1, department_id: 4, requested_by: 10, status: 'draft', workflow_type: 'payment_request', ...extra });
const code = (expected) => (error) => {
  assert.equal(error.code, expected, `${error.code}: ${error.message}`);
  return true;
};
function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// ------------------------------------------------------------------ personal data

test('a reimbursement never takes an employee bank account; a vendor payment may', () => {
  assert.equal(svc.employeeBankField('reimbursement', { payeeAccountNumber: '1234567890' }), 'payeeAccountNumber');
  assert.equal(svc.employeeBankField('reimbursement', { payeeBank: 'BCA' }), 'payeeBank');
  assert.equal(svc.employeeBankField('reimbursement', { payeeAccountName: 'Budi' }), 'payeeAccountName');
  assert.equal(svc.employeeBankField('reimbursement', { payeeAccountNumber: '  ', payeeBank: null }), null);
  assert.equal(svc.employeeBankField('payment_request', { payeeBank: 'BCA', payeeAccountNumber: '1234567890' }), null);
  assert.match(svc.EMPLOYEE_ACCOUNT_MESSAGE, /KantorKu/);
});

test('POST a reimbursement with an account number → 400 in Indonesian, on the field, before any write', async (t) => {
  const query = t.mock.method(pool, 'query', async () => { throw new Error('no query expected'); });
  const res = fakeRes();
  await ctrl.create({
    user: user(['finance.request']),
    body: { workflowType: 'reimbursement', title: 'Taksi klien', amount: 150000, payeeAccountNumber: '1234567890' },
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.message, /rekening payroll karyawan \(data di KantorKu\)/);
  assert.deepEqual(Object.keys(res.body.error.details.fieldErrors), ['payeeAccountNumber']);
  assert.equal(query.mock.callCount(), 0);
});

test('a reimbursement read back never shows bank fields, even on an old row', () => {
  const dto = svc.requestDto(row({ workflow_type: 'reimbursement', payee_bank: 'BCA', payee_account_number: '999', payee_account_name: 'X', amount: '1000.00', total_amount: '1000.00' }));
  assert.equal(dto.payeeBank, null);
  assert.equal(dto.payeeAccountNumber, null);
  assert.equal(dto.payeeAccountName, null);
  const vendor = svc.requestDto(row({ payee_bank: 'BCA', payee_account_number: '999', amount: '1000.00', total_amount: '1000.00', jurnal_reference_id: 'BKK-0001' }));
  assert.equal(vendor.payeeAccountNumber, '999');
  assert.equal(vendor.accurateReference, 'BKK-0001', 'the old jurnal_reference_id column now holds the Accurate proof number');
  assert.equal(vendor.amount, 1000);
});

// ------------------------------------------------------------------ schemas

test('bodies are strict: entity, division, requester and status never come from the client', () => {
  const base = { workflowType: 'payment_request', title: 'Tagihan listrik September', amount: 1000000 };
  assert.ok(schemas.createBody.safeParse(base).success);
  for (const extra of [{ entityId: 1 }, { departmentId: 3 }, { requestedBy: 2 }, { status: 'approved' }]) {
    const parsed = schemas.createBody.safeParse({ ...base, ...extra });
    assert.equal(parsed.success, false, JSON.stringify(extra));
    assert.match(parsed.error.issues[0].message, /tidak dikenal/);
  }
  const missing = schemas.createBody.safeParse({ workflowType: 'payment_request', title: ' ', amount: -1 });
  const messages = missing.error.flatten().fieldErrors;
  assert.match(messages.title[0], /Isi judul/);
  assert.match(messages.amount[0], /tidak boleh minus/);
  assert.equal(schemas.updateBody.safeParse({ workflowType: 'reimbursement' }).success, false, 'the type cannot change');
  assert.equal(schemas.processingBody.safeParse({ status: 'paid', jurnalReferenceUrl: 'https://x' }).success, false, 'no Jurnal.id link any more');
  assert.ok(schemas.processingBody.safeParse({ status: 'paid', accurateReference: 'BKK/2026/10/0001' }).success);
});

// ------------------------------------------------------------------ who reads what

test('reads: Finance and the Management Office all, a division Head their division, others their own', () => {
  assert.deepEqual(svc.readScope(user(['finance.view', 'finance.manage'])), { sql: '', args: [] });
  assert.deepEqual(svc.readScope(user(['finance.process'])), { sql: '', args: [] });
  assert.deepEqual(svc.readScope(user(['management_dashboard.view'])), { sql: '', args: [] });
  assert.deepEqual(svc.readScope(user(['finance.request', 'management_dashboard.division'])), { sql: ' AND (f.requested_by = ? OR f.department_id = ?)', args: [10, 4] });
  // Procurement members hold finance.view, which alone is not "see everything".
  assert.deepEqual(svc.readScope(user(['finance.view', 'finance.request'])), { sql: ' AND f.requested_by = ?', args: [10] });

  const other = row({ requested_by: 99 });
  assert.equal(svc.canRead(user(['finance.request']), other), false);
  assert.equal(svc.canRead(user(['finance.request', 'management_dashboard.division']), other), true);
  assert.equal(svc.canRead(user(['finance.request', 'management_dashboard.division']), row({ requested_by: 99, department_id: 9 })), false);
  assert.equal(svc.canRead(user(['finance.manage']), row({ requested_by: 99, department_id: 9 })), true);
});

test('the list query carries the scope and the entity in SQL', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return /COUNT\(\*\) AS total/.test(sql) ? [[{ total: 0 }]] : [[]];
  });
  await svc.list(user(['finance.view', 'finance.request']), { status: 'paid', q: 'listrik' });
  assert.match(calls[0].sql, /f\.entity_id = \? AND f\.deleted_at IS NULL AND f\.requested_by = \? AND f\.status = \?/);
  assert.deepEqual(calls[0].args.slice(0, 3), [1, 10, 'paid']);
  assert.match(calls[1].sql, /f\.requested_by = \?/, 'the count uses the same scope');

  calls.length = 0;
  await svc.list(user(['finance.request', 'management_dashboard.division']), { status: 'nonsense' });
  assert.match(calls[0].sql, /\(f\.requested_by = \? OR f\.department_id = \?\)/);
  assert.doesNotMatch(calls[0].sql, /f\.status = \?/, 'an unknown status filter is ignored');

  calls.length = 0;
  await svc.list(user(['finance.process']), {});
  assert.doesNotMatch(calls[0].sql, /requested_by = \?|department_id = \?/);
});

// ------------------------------------------------------------------ status machine

test('status machine: Finance processes approved requests only; cancel rules per role', () => {
  assert.ok(svc.canProcessTo('approved', 'processing'));
  assert.ok(svc.canProcessTo('approved', 'paid'));
  assert.ok(svc.canProcessTo('processing', 'paid'));
  for (const [from, to] of [['draft', 'paid'], ['pending_approval', 'paid'], ['rejected', 'processing'], ['paid', 'processing'], ['cancelled', 'paid'], ['processing', 'processing']]) {
    assert.equal(svc.canProcessTo(from, to), false, `${from} → ${to}`);
  }
  const requester = user(['finance.request']);
  const finance = user(['finance.process'], { sub: 50 });
  for (const status of ['draft', 'revision_requested', 'pending_approval']) assert.ok(svc.canCancel(requester, row({ status })), status);
  for (const status of ['approved', 'processing', 'paid', 'rejected']) assert.equal(svc.canCancel(requester, row({ status })), false, status);
  for (const status of ['approved', 'processing']) assert.ok(svc.canCancel(finance, row({ status })), status);
  for (const status of ['paid', 'cancelled', 'rejected']) assert.equal(svc.canCancel(finance, row({ status })), false, status);

  const can = svc.permissionsFor(requester, row());
  assert.deepEqual({ edit: can.edit, submit: can.submit, remove: can.remove, process: can.process }, { edit: true, submit: true, remove: true, process: false });
  assert.equal(svc.permissionsFor(user(['finance.request'], { sub: 11 }), row()).edit, false, 'not someone else\'s draft');
  assert.equal(svc.permissionsFor(requester, row({ status: 'pending_approval' })).edit, false);
  assert.equal(svc.permissionsFor(finance, row({ status: 'approved' })).markPaid, true);
  assert.equal(svc.permissionsFor(finance, row({ status: 'paid' })).attach, true, 'Finance may add the transfer proof after paying');
  assert.equal(svc.permissionsFor(user(['finance.approve']), row({ status: 'pending_approval' }), { approvalStatus: 'pending' }).applyDecision, false);
  assert.equal(svc.permissionsFor(user(['finance.approve']), row({ status: 'pending_approval' }), { approvalStatus: 'approved' }).applyDecision, true);
});

test('required documents: an invoice for a payment, a receipt for a reimbursement', () => {
  assert.deepEqual(svc.missingRequired('payment_request', []), ['invoice']);
  assert.deepEqual(svc.missingRequired('payment_request', [{ attachment_type: 'invoice' }]), []);
  assert.deepEqual(svc.missingRequired('reimbursement', [{ attachment_type: 'invoice' }]), ['receipt']);
});

test('the decision on /approvals is applied through the approval lifecycle', () => {
  for (const type of ['finance_workflow', 'finance_payment_request', 'finance_reimbursement']) {
    assert.ok(lifecycle.isManagedSubject(type), type);
  }
});

// ------------------------------------------------------------------ management provider

test('the finance provider is live, valid, division-scoped and gates rupiah behind finance.view', () => {
  const valid = validateProvider(provider);
  assert.deepEqual(valid.navPaths, ['/finance/payment-requests']);
  for (const source of valid.escalations) assert.ok(source.key.length <= 32, source.key);
  for (const metric of valid.metrics.filter((m) => m.unit === 'rupiah')) assert.equal(metric.permission, 'finance.view');
  for (const kpi of valid.kpis) assert.equal(kpi.permission, 'finance.view');
  const registry = require('../src/management/registry');
  registry.reset();
  assert.ok(registry.providers().some((p) => p.key === 'finance'), 'not parked any more');
});

// ------------------------------------------------------------------ against the database

async function decide(approvalId, actor, action, note = null) {
  const res = fakeRes();
  let thrown = null;
  await approvals.decide({ entityScope: { entityId: actor.entityId }, params: { id: approvalId }, body: { action, note }, user: actor }, res, (e) => { thrown = e; });
  if (thrown) throw thrown;
  // The controller answers a refused decision itself (4xx): surface it as an error.
  if (res.statusCode >= 400) throw Object.assign(new Error(res.body?.error?.message), { code: res.body?.error?.code, status: res.statusCode });
  return res;
}

const attach = (conn, id, type) => conn.query(
  "INSERT INTO finance_workflow_attachments (finance_workflow_id, attachment_type, name, drive_file_id) VALUES (?, ?, '[UJI] lampiran.pdf', NULL)",
  [id, type],
);

test('flow: a Procurement member requests, their Head approves on /approvals, Finance pays', async (t) => {
  if (!(await dbReady())) { t.skip('no database'); return; }
  // Never send a real email or notification from a test.
  t.mock.method(notif, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const requester = await makeUser(conn, { name: 'Peminta', division: 'procurement', roles: ['procurement.member'] });
    const colleague = await makeUser(conn, { name: 'Rekan', division: 'procurement', roles: ['procurement.member'] });
    const head = await makeUser(conn, { name: 'Head Procurement', division: 'procurement', roles: ['procurement.head'] });
    const cashier = await makeUser(conn, { name: 'Kasir Finance', division: 'finance', roles: ['finance.supervisor'] });

    await assert.rejects(svc.create(requester.user, {
      workflowType: 'reimbursement', title: 'Bensin', amount: 50000, payeeAccountNumber: '123',
    }), code('VALIDATION_ERROR'));
    await assert.rejects(svc.create(requester.user, {
      workflowType: 'payment_request', title: 'Uang makan', payeeName: 'Budi', payeeType: 'employee', payeeAccountNumber: '123', amount: 50000,
    }), (e) => e.code === 'VALIDATION_ERROR' && /reimbursement/.test(e.message), 'an employee is paid by reimbursement, never by bank account');

    const created = await svc.create(requester.user, {
      workflowType: 'payment_request', title: '[UJI] Tagihan listrik gudang', category: 'Tagihan GA',
      description: 'Referensi: tagihan PLN September', payeeName: 'PT PLN', payeeBank: 'BRI', payeeAccountNumber: '0011', payeeAccountName: 'PT PLN',
      amount: 1000000, taxAmount: 110000,
    });
    assert.match(created.requestNumber, /^PR-\d{6}-\d{4}$/);
    const draft = await svc.get(requester.user, created.id);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.departmentId, requester.user.departmentId, 'the request belongs to the requester\'s division');
    assert.equal(draft.totalAmount, 1110000, 'total = subtotal + tax');
    assert.equal(draft.can.submit, true);

    // A colleague in the same division does not see it; the Head and Finance do.
    await assert.rejects(svc.get(colleague.user, created.id), code('NOT_FOUND'));
    assert.equal((await svc.get(head.user, created.id)).id, created.id);
    assert.ok((await svc.list(cashier.user, {})).rows.some((r) => r.id === created.id));
    assert.equal((await svc.list(colleague.user, {})).rows.some((r) => r.id === created.id), false);

    await assert.rejects(svc.submit(requester.user, created.id), code('DOCUMENTS_MISSING'));
    await attach(conn, created.id, 'invoice');
    const submitted = await svc.submit(requester.user, created.id);
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.approverBasis, 'division_head');
    await assert.rejects(svc.update(requester.user, created.id, { title: 'Ubah' }), code('INVALID_STATUS'));
    await assert.rejects(svc.processPayment(cashier.user, created.id, { status: 'paid' }), code('INVALID_STATUS'));

    // The requester never decides their own request; the Head does, on /approvals.
    await assert.rejects(decide(submitted.approvalRequestId, requester.user, 'approve'), code('SELF_APPROVAL_FORBIDDEN'));
    assert.equal((await svc.get(head.user, created.id)).can.decide, true);
    const res = await decide(submitted.approvalRequestId, head.user, 'approve');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal((await svc.get(requester.user, created.id)).status, 'approved', 'the hook applied the decision');

    await svc.processPayment(cashier.user, created.id, { status: 'processing' });
    await svc.processPayment(cashier.user, created.id, { status: 'paid', accurateReference: 'BKK/2026/10/0001' });
    const paid = await svc.get(requester.user, created.id);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.accurateReference, 'BKK/2026/10/0001');
    assert.ok(paid.paidAt);
    assert.equal(paid.approvalSteps.at(-1).status, 'approved');
    assert.ok(paid.history.some((h) => h.action === 'finance.paid'));
    await assert.rejects(svc.cancel(requester.user, created.id, { reason: 'salah' }), code('INVALID_STATUS'));
  });
});

test('flow: a rejection needs a reason; a revision goes back to the requester; cancel withdraws a pending approval', async (t) => {
  if (!(await dbReady())) { t.skip('no database'); return; }
  t.mock.method(notif, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const requester = await makeUser(conn, { name: 'Peminta', division: 'procurement', roles: ['procurement.member'] });
    const head = await makeUser(conn, { name: 'Head Procurement', division: 'procurement', roles: ['procurement.head'] });

    const reimb = await svc.create(requester.user, { workflowType: 'reimbursement', title: '[UJI] Taksi ke vendor', amount: 85000 });
    const fresh = await svc.get(requester.user, reimb.id);
    assert.equal(fresh.payeeType, 'employee');
    assert.match(fresh.payeeName, /Peminta/, 'paid to the requester (payroll account, KantorKu)');
    await assert.rejects(svc.update(requester.user, reimb.id, { payeeAccountNumber: '123' }), code('VALIDATION_ERROR'));
    await attach(conn, reimb.id, 'receipt');
    const first = await svc.submit(requester.user, reimb.id);
    await assert.rejects(decide(first.approvalRequestId, head.user, 'reject'), code('VALIDATION_ERROR'));
    await decide(first.approvalRequestId, head.user, 'request_revision', 'Lampirkan nota aslinya');
    assert.equal((await svc.get(requester.user, reimb.id)).status, 'revision_requested');
    await svc.update(requester.user, reimb.id, { description: 'Nota asli terlampir' });
    const second = await svc.submit(requester.user, reimb.id);
    assert.notEqual(second.approvalRequestId, first.approvalRequestId, 'a new approval round');
    await svc.cancel(requester.user, reimb.id, { reason: 'Sudah dibayar kas kecil' });
    const [[approval]] = await conn.query('SELECT status FROM approval_requests WHERE id = ?', [second.approvalRequestId]);
    assert.equal(approval.status, 'cancelled', 'the pending approval was withdrawn');
    assert.equal((await svc.get(requester.user, reimb.id)).status, 'cancelled');

    const other = await svc.create(requester.user, { workflowType: 'payment_request', title: '[UJI] Langganan software IT', payeeName: 'Vendor SaaS', amount: 500000 });
    await attach(conn, other.id, 'invoice');
    const pending = await svc.submit(requester.user, other.id);
    await decide(pending.approvalRequestId, head.user, 'reject', 'Belum dianggarkan');
    assert.equal((await svc.get(requester.user, other.id)).status, 'rejected');
  });
});

test('an attachment by documentId must be a document the requester may read (no cross-division leak)', async (t) => {
  if (!(await dbReady())) { t.skip('no database'); return; }
  t.mock.method(notif, 'create', async () => null);
  await inRolledBackTransaction(t, async (conn) => {
    const requester = await makeUser(conn, { name: 'Peminta Sales', division: 'sales', roles: ['sales.member'] });
    const finance = await makeUser(conn, { name: 'Staf Finance', division: 'finance', roles: ['finance.member'] });
    const created = await svc.create(requester.user, {
      workflowType: 'payment_request', title: '[UJI] Tagihan vendor', payeeName: 'PT Vendor', payeeBank: 'BRI',
      payeeAccountNumber: '0011', payeeAccountName: 'PT Vendor', amount: 100000,
    });
    const insertDoc = async (owner, title) => {
      const [r] = await conn.query(
        "INSERT INTO documents (entity_id, department_id, title, document_type, created_by) VALUES (?, ?, ?, 'invoice', ?)",
        [owner.user.entityId, owner.user.departmentId, title, owner.user.sub],
      );
      return Number(r.insertId);
    };
    const financeDoc = await insertDoc(finance, '[UJI] Dokumen Finance');
    const ownDoc = await insertDoc(requester, '[UJI] Invoice vendor');
    await assert.rejects(
      svc.addAttachment(requester.user, created.id, { attachmentType: 'invoice', documentId: financeDoc }),
      code('NOT_FOUND'),
      'a document of another division is never attached',
    );
    const ok = await svc.addAttachment(requester.user, created.id, { attachmentType: 'invoice', documentId: ownDoc });
    assert.ok(ok.id);
  });
});
