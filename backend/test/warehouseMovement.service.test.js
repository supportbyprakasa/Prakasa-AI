const test = require('node:test');
const assert = require('node:assert/strict');
const { createWarehouseMovementService } = require('../src/services/warehouseMovement.service');

const WAREHOUSE = 9;
const PROCUREMENT = 4;
const MEMBER = { sub: 11, entityId: 1, departmentId: WAREHOUSE, permissions: ['warehouse.movement.view', 'warehouse.movement.create', 'warehouse.movement.update', 'warehouse.movement.submit'] };
const SUPERVISOR = { sub: 12, entityId: 1, departmentId: WAREHOUSE, permissions: [...MEMBER.permissions, 'approval.decide', 'warehouse.movement.approve'] };
const HEAD = { sub: 13, entityId: 1, departmentId: WAREHOUSE, permissions: [...SUPERVISOR.permissions, 'warehouse.movement.cancel'] };
const READER = { sub: 14, entityId: 1, departmentId: PROCUREMENT, permissions: ['warehouse.movement.view'] };

const validInput = (overrides = {}) => ({
  movementDate: '2026-09-24',
  referenceNo: 'PO-77',
  party: 'PT Sumber Kopi',
  items: [{ product: 'Kopi Arabika', quantity: 5, unit: 'kg' }],
  ...overrides,
});

function harness({ flowType = 'sequential', failApproval = false } = {}) {
  let movements = new Map();
  let nextId = 1;
  let nextApproval = 100;
  const calls = { createApproval: 0, commits: 0, rollbacks: 0, notified: [], logs: [] };
  const key = (table, id) => `${table}:${id}`;

  const repo = {
    async isSuperAdmin() { return false; },
    async departmentByCode(entityId, code) { return code === 'warehouse' ? WAREHOUSE : null; },
    async insertMovement(config, fields) {
      const id = nextId++;
      movements.set(key(config.table, id), { id, ...fields, version: 1 });
      return id;
    },
    async lockMovement(config, { id, entityId }) {
      const row = movements.get(key(config.table, id));
      return row && row.entity_id === entityId ? { ...row } : null;
    },
    async findMovement(config, scope) { return repo.lockMovement(config, scope); },
    async updateMovement(config, id, patch, expectedVersion) {
      const row = movements.get(key(config.table, id));
      if (!row || (expectedVersion != null && row.version !== expectedVersion)) return 0;
      movements.set(key(config.table, id), { ...row, ...patch, version: row.version + 1 });
      return 1;
    },
    async listMovements(config, filters) {
      const rows = [...movements.entries()]
        .filter(([k]) => k.startsWith(`${config.table}:`))
        .map(([, row]) => row)
        .filter((row) => !filters.statuses || filters.statuses.includes(row.status))
        .filter((row) => filters.departmentId == null || row.department_id === filters.departmentId);
      return { rows, total: rows.length };
    },
    async approvalSummary() { return null; },
    async userRoleIds() { return [28]; },
    async auditRows() { return []; },
  };

  const engine = {
    async createApprovalRequest(context) {
      calls.createApproval += 1;
      if (failApproval) throw Object.assign(new Error('db down'), { status: 500 });
      calls.lastApprovalContext = context;
      return { id: nextApproval++, flowType, stepCount: 1 };
    },
    async getActiveSteps() { return [{ id: 500, approver_role_id: 28, matrix_rule_id: 1 }]; },
    async canDecide({ userRoleIds }) { return userRoleIds.includes(28); },
  };

  const transaction = async (fn) => {
    const snapshot = new Map([...movements].map(([k, v]) => [k, { ...v }]));
    try {
      const result = await fn({ fake: true });
      calls.commits += 1;
      return result;
    } catch (error) {
      movements = snapshot;
      calls.rollbacks += 1;
      throw error;
    }
  };

  const service = createWarehouseMovementService({
    repo,
    engine,
    transaction,
    audit: { log: async (entry) => calls.logs.push(entry), approval: async () => {} },
    notify: { steps: async (stepIds) => calls.notified.push(stepIds) },
  });

  const raw = (type, id) => movements.get(key(type === 'inbound' ? 'warehouse_inbound' : 'warehouse_outbound', id));
  return { service, calls, raw };
}

const approvalFor = (movement, overrides = {}) => ({
  id: movement.approvalRequestId,
  entity_id: 1,
  subject_type: 'warehouse_inbound',
  subject_id: movement.id,
  status: 'pending',
  ...overrides,
});

test('create derives entity, department, and creator from auth, not the request body', async () => {
  const { service, raw } = harness();
  const movement = await service.create({
    user: MEMBER,
    type: 'inbound',
    input: { ...validInput(), entityId: 99, departmentId: 1, createdBy: 77, status: 'approved' },
  });
  const row = raw('inbound', movement.id);
  assert.equal(row.entity_id, 1);
  assert.equal(row.department_id, WAREHOUSE);
  assert.equal(row.created_by, MEMBER.sub);
  assert.equal(movement.status, 'draft');
});

test('users outside the Warehouse division cannot create movements', async () => {
  const { service } = harness();
  await assert.rejects(
    service.create({ user: { ...MEMBER, departmentId: PROCUREMENT }, type: 'inbound', input: validInput() }),
    (error) => error.status === 403,
  );
});

test('update requires an editable state and the current version', async () => {
  const { service } = harness();
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  await assert.rejects(
    service.updateDraft({ user: MEMBER, type: 'inbound', id: movement.id, version: 99, input: validInput() }),
    (error) => error.status === 409 && error.code === 'VERSION_CONFLICT',
  );
  const updated = await service.updateDraft({ user: MEMBER, type: 'inbound', id: movement.id, version: 1, input: validInput({ referenceNo: 'PO-78' }) });
  assert.equal(updated.referenceNo, 'PO-78');
  assert.equal(updated.version, 2);

  await service.submit({ user: MEMBER, type: 'inbound', id: movement.id });
  await assert.rejects(
    service.updateDraft({ user: MEMBER, type: 'inbound', id: movement.id, version: 3, input: validInput() }),
    (error) => error.status === 409,
  );
});

test('repeat submit is idempotent and creates exactly one approval', async () => {
  const { service, calls } = harness();
  const movement = await service.create({ user: MEMBER, type: 'outbound', input: validInput() });
  const first = await service.submit({ user: MEMBER, type: 'outbound', id: movement.id });
  const second = await service.submit({ user: MEMBER, type: 'outbound', id: movement.id });
  assert.equal(calls.createApproval, 1);
  assert.equal(first.movement.status, 'pending_approval');
  assert.equal(second.movement.approvalRequestId, first.movement.approvalRequestId);
  assert.equal(second.alreadySubmitted, true);
  assert.equal(calls.lastApprovalContext.requestType, 'warehouse_outbound');
  assert.equal(calls.lastApprovalContext.departmentId, WAREHOUSE);
  assert.equal(calls.notified.length, 1);
});

test('submit is atomic: a failed approval leaves the movement as an untouched draft', async () => {
  const { service, raw, calls } = harness({ failApproval: true });
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  await assert.rejects(service.submit({ user: MEMBER, type: 'inbound', id: movement.id }));
  assert.equal(raw('inbound', movement.id).status, 'draft');
  assert.equal(raw('inbound', movement.id).approval_request_id ?? null, null);
  assert.equal(calls.rollbacks, 1);
});

test('submit refuses an unassigned fallback approval when no Warehouse matrix exists', async () => {
  const { service, raw } = harness({ flowType: 'legacy' });
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  await assert.rejects(
    service.submit({ user: MEMBER, type: 'inbound', id: movement.id }),
    (error) => error.status === 409 && error.code === 'APPROVAL_MATRIX_MISSING',
  );
  assert.equal(raw('inbound', movement.id).status, 'draft');
});

test('the creator is denied at decision time even with Supervisor permissions', async () => {
  const { service } = harness();
  const movement = await service.create({ user: SUPERVISOR, type: 'inbound', input: validInput() });
  const { movement: submitted } = await service.submit({ user: SUPERVISOR, type: 'inbound', id: movement.id });
  await assert.rejects(
    service.assertCanDecide({ approval: approvalFor(submitted), user: SUPERVISOR, action: 'approve', conn: {} }),
    (error) => error.status === 403 && error.code === 'SELF_APPROVAL_FORBIDDEN',
  );
  assert.equal(await service.canUserDecide({ approval: approvalFor(submitted), user: SUPERVISOR, conn: {} }), false);
});

test('a decision needs both approval.decide and warehouse.movement.approve in the same division', async () => {
  const { service } = harness();
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  const { movement: submitted } = await service.submit({ user: MEMBER, type: 'inbound', id: movement.id });
  const approval = approvalFor(submitted);

  for (const permissions of [['approval.decide'], ['warehouse.movement.approve']]) {
    await assert.rejects(
      service.assertCanDecide({ approval, user: { ...SUPERVISOR, permissions }, action: 'approve', conn: {} }),
      (error) => error.status === 403,
    );
  }
  await assert.rejects(
    service.assertCanDecide({ approval, user: { ...SUPERVISOR, departmentId: PROCUREMENT }, action: 'approve', conn: {} }),
    (error) => error.status === 403,
  );
  await assert.doesNotReject(service.assertCanDecide({ approval, user: SUPERVISOR, action: 'approve', conn: {} }));
  await assert.rejects(
    service.assertCanDecide({ approval, user: SUPERVISOR, action: 'request_revision', note: ' ', conn: {} }),
    (error) => error.status === 400,
  );
});

test('approval lifecycle updates the movement exactly once and rejects stale approvals', async () => {
  const { service, raw } = harness();
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  const { movement: submitted } = await service.submit({ user: MEMBER, type: 'inbound', id: movement.id });
  const approval = approvalFor(submitted);

  const pending = await service.applyApprovalDecision({ approval, result: { status: 'pending' }, actorUserId: SUPERVISOR.sub, conn: {} });
  assert.equal(pending.changed, false);

  const outcome = await service.applyApprovalDecision({ approval, result: { status: 'approved' }, actorUserId: SUPERVISOR.sub, conn: {} });
  assert.equal(outcome.changed, true);
  const versionAfterApproval = raw('inbound', movement.id).version;
  assert.equal(raw('inbound', movement.id).status, 'approved');
  assert.equal(raw('inbound', movement.id).approved_by, SUPERVISOR.sub);

  const repeat = await service.applyApprovalDecision({ approval, result: { status: 'approved' }, actorUserId: SUPERVISOR.sub, conn: {} });
  assert.equal(repeat.changed, false);
  assert.equal(raw('inbound', movement.id).version, versionAfterApproval);

  await assert.rejects(
    service.applyApprovalDecision({ approval: { ...approval, id: 999 }, result: { status: 'rejected' }, actorUserId: SUPERVISOR.sub, conn: {} }),
    (error) => error.status === 409,
  );
});

test('revision returns the movement to an editable state, then draft on edit', async () => {
  const { service, raw } = harness();
  const movement = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  const { movement: submitted } = await service.submit({ user: MEMBER, type: 'inbound', id: movement.id });
  await service.applyApprovalDecision({ approval: approvalFor(submitted), result: { status: 'revision_requested' }, actorUserId: SUPERVISOR.sub, note: 'Batch salah', conn: {} });
  assert.equal(raw('inbound', movement.id).status, 'revision_requested');
  assert.equal(raw('inbound', movement.id).decision_note, 'Batch salah');
  const edited = await service.updateDraft({ user: MEMBER, type: 'inbound', id: movement.id, version: raw('inbound', movement.id).version, input: validInput() });
  assert.equal(edited.status, 'draft');
});

test('Head cancellation requires an approved movement and a reason', async () => {
  const { service, raw } = harness();
  const movement = await service.create({ user: MEMBER, type: 'outbound', input: validInput() });
  await assert.rejects(
    service.cancel({ user: HEAD, type: 'outbound', id: movement.id, reason: 'Salah input' }),
    (error) => error.status === 409,
  );
  const { movement: submitted } = await service.submit({ user: MEMBER, type: 'outbound', id: movement.id });
  await service.applyApprovalDecision({ approval: approvalFor(submitted, { subject_type: 'warehouse_outbound' }), result: { status: 'approved' }, actorUserId: SUPERVISOR.sub, conn: {} });
  await assert.rejects(
    service.cancel({ user: HEAD, type: 'outbound', id: movement.id, reason: '  ' }),
    (error) => error.status === 400,
  );
  const cancelled = await service.cancel({ user: HEAD, type: 'outbound', id: movement.id, reason: 'Barang batal dikirim' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(raw('outbound', movement.id).cancelled_by, HEAD.sub);
});

test('readers from another division only see approved or cancelled history', async () => {
  const { service } = harness();
  const draft = await service.create({ user: MEMBER, type: 'inbound', input: validInput() });
  await assert.rejects(
    service.get({ user: READER, type: 'inbound', id: draft.id }),
    (error) => error.status === 404,
  );
  const list = await service.list({ user: READER, type: 'inbound' });
  assert.deepEqual(list.statusesVisible, ['approved', 'cancelled']);
});
