const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const approvalEngine = require('../src/services/approvalEngine.service');
const notificationCenter = require('../src/services/notificationCenter.service');
const aiInbox = require('../src/services/aiInbox.service');

function inboxUser(overrides = {}) {
  return {
    sub: 7,
    entityId: 1,
    departmentId: 2,
    permissions: [],
    ...overrides,
  };
}

function emptyNotifications(t) {
  t.mock.method(notificationCenter, 'listForUser', async () => ({
    rows: [],
    meta: { unreadCount: 0 },
  }));
}

test('inbox reports the full authorized proposal count while returning a bounded preview', async (t) => {
  emptyNotifications(t);
  const proposals = Array.from({ length: 31 }, (_, index) => ({
    id: index + 1,
    session_id: index + 101,
    proposal_entity_id: 1,
    action_type: 'create_task',
    payload_json: JSON.stringify({ title: `Proposal ${index + 1}` }),
    created_at: new Date('2026-09-24T00:00:00Z'),
    expires_at: null,
    session_title: `Session ${index + 1}`,
    owner_user_id: 7,
    entity_id: 1,
    department_id: 2,
    visibility: 'private',
    status: 'active',
    deleted_at: null,
  }));

  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('COUNT(*) AS total') && statement.includes('ai_action_proposals')) {
      return [[{ total: 31 }]];
    }
    if (statement.includes('FROM ai_action_proposals')) return [proposals];
    throw new Error(`Unexpected query: ${statement}`);
  });

  const result = await aiInbox.getInbox({
    user: inboxUser({ permissions: ['ai_command.action.confirm'] }),
  });

  assert.equal(result.proposals.length, 30);
  assert.equal(result.counts.proposals, 31);
  assert.equal(result.counts.total, 31);
});

test('inbox scans beyond the newest 100 approvals and counts all authorized requests', async (t) => {
  emptyNotifications(t);
  let approvalPage = 0;
  const unauthorized = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    entity_id: 1,
    title: `Unrelated ${index + 1}`,
    request_type: 'purchase',
    document_type_id: null,
    amount: null,
    currency: 'IDR',
    created_at: new Date('2026-09-24T00:00:00Z'),
    requester_name: 'Pemohon lain',
  }));
  const authorized = Array.from({ length: 31 }, (_, index) => ({
    id: index + 101,
    entity_id: 1,
    title: `Perlu keputusan ${index + 1}`,
    request_type: 'purchase',
    document_type_id: null,
    amount: null,
    currency: 'IDR',
    created_at: new Date('2026-09-23T00:00:00Z'),
    requester_name: 'Pemohon',
  }));

  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM user_roles')) return [[]];
    if (statement.includes('FROM approval_requests')) {
      approvalPage += 1;
      if (approvalPage === 1) return [unauthorized];
      if (approvalPage === 2) return [authorized];
      return [[]];
    }
    throw new Error(`Unexpected query: ${statement}`);
  });
  t.mock.method(approvalEngine, 'getActiveSteps', async (requestId) => [
    { authorized: Number(requestId) > 100 },
  ]);
  t.mock.method(approvalEngine, 'canDecide', async ({ step }) => step.authorized);

  const result = await aiInbox.getInbox({
    user: inboxUser({ permissions: ['approval.decide'] }),
  });

  assert.equal(result.approvals.length, 30);
  assert.equal(result.approvals[0].id, 101);
  assert.equal(result.counts.approvals, 31);
  assert.equal(result.counts.total, 31);
  assert.equal(approvalPage, 2);
});

test('Warehouse approvals appear only when the module allows this user to decide', async (t) => {
  emptyNotifications(t);
  const approvalLifecycle = require('../src/services/approvalSubjectLifecycle.service');
  const requests = [
    { id: 201, entity_id: 1, department_id: 9, subject_type: 'warehouse_inbound', subject_id: 5, title: 'Barang Masuk milik saya', request_type: 'warehouse_inbound', currency: 'IDR', created_at: new Date() },
    { id: 202, entity_id: 1, department_id: 9, subject_type: 'warehouse_outbound', subject_id: 6, title: 'Barang Keluar tim', request_type: 'warehouse_outbound', currency: 'IDR', created_at: new Date() },
  ];
  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM user_roles')) return [[{ roleId: 28 }]];
    if (statement.includes('FROM approval_requests')) return [requests];
    throw new Error(`Unexpected query: ${statement}`);
  });
  t.mock.method(approvalEngine, 'getActiveSteps', async () => [{ approver_role_id: 28 }]);
  t.mock.method(approvalEngine, 'canDecide', async () => true);
  t.mock.method(approvalLifecycle, 'canUserDecide', async ({ approval }) => approval.id !== 201);

  const result = await aiInbox.getInbox({
    user: inboxUser({ permissions: ['approval.decide', 'warehouse.movement.approve'] }),
  });

  assert.deepEqual(result.approvals.map((item) => item.id), [202]);
  assert.equal(result.approvals[0].subjectType, 'warehouse_outbound');
  assert.equal(result.counts.approvals, 1);
});
