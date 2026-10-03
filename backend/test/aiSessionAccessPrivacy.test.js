const test = require('node:test');
const assert = require('node:assert/strict');
const aiAccess = require('../src/services/aiSessionAccess.service');

function user(overrides = {}) {
  return {
    sub: 10,
    entityId: 1,
    departmentId: 5,
    permissions: [],
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: 100,
    owner_user_id: 10,
    entity_id: 1,
    department_id: 5,
    visibility: 'private',
    status: 'active',
    deleted_at: null,
    ...overrides,
  };
}

test('private session is visible to its owner', () => {
  assert.equal(
    aiAccess.canViewSession({ user: user(), session: session() }),
    true
  );
});

test('private session content stays hidden from admin audit permission', () => {
  assert.equal(
    aiAccess.canViewSession({
      user: user({
        sub: 99,
        permissions: ['ai_command.private_audit', 'ai_command.admin.view'],
      }),
      session: session(),
    }),
    false
  );
});

test('private sessions from other users are excluded from session listing filter', () => {
  const filter = aiAccess.buildVisibilityFilter(
    user({
      sub: 99,
      permissions: ['ai_command.private_audit', 'ai_command.admin.view'],
    }),
    's'
  );

  assert.equal(filter.sql.includes("visibility='private'"), false);
});

test('department session remains shareable only with explicit department permission', () => {
  const shared = session({
    owner_user_id: 77,
    visibility: 'department',
  });

  assert.equal(
    aiAccess.canViewSession({
      user: user({
        sub: 99,
        permissions: ['ai_command.department.view'],
      }),
      session: shared,
    }),
    true
  );

  assert.equal(
    aiAccess.canViewSession({
      user: user({ sub: 99, permissions: [] }),
      session: shared,
    }),
    false
  );
});

const WRITE_ACTIONS = ['send_message', 'attach_context', 'propose_action'];
const divisionMember = (overrides = {}) => user({ sub: 99, permissions: ['ai_command.use', 'ai_command.department.view'], ...overrides });

test('division members can write in a division chat but cannot manage it', () => {
  const shared = session({ owner_user_id: 77, visibility: 'department' });
  for (const action of WRITE_ACTIONS) {
    assert.doesNotThrow(() => aiAccess.assertSessionAccess({ user: divisionMember(), session: shared, action }), action);
  }
  assert.throws(() => aiAccess.assertSessionAccess({ user: divisionMember(), session: shared, action: 'manage' }), (error) => error.status === 403);
  assert.deepEqual(aiAccess.sessionAccessFlags(divisionMember(), shared), { isOwner: false, canView: true, canSend: true, canManage: false });
});

test('division chat writes still need AI use permission and the same division', () => {
  const shared = session({ owner_user_id: 77, visibility: 'department' });
  const noUse = divisionMember({ permissions: ['ai_command.department.view'] });
  const otherDivision = divisionMember({ departmentId: 6 });
  const otherEntity = divisionMember({ entityId: 2 });
  for (const outsider of [noUse, otherDivision, otherEntity]) {
    assert.throws(() => aiAccess.assertSessionAccess({ user: outsider, session: shared, action: 'send_message' }), (error) => error.status === 403);
    assert.equal(aiAccess.sessionAccessFlags(outsider, shared).canSend, false);
  }
});

test('private and entity-wide chats stay writable by their owner only', () => {
  const reader = user({ sub: 99, permissions: ['ai_command.use', 'ai_command.department.view', 'ai_command.entity.view'] });
  for (const visibility of ['private', 'entity']) {
    const other = session({ owner_user_id: 77, visibility });
    assert.throws(() => aiAccess.assertSessionAccess({ user: reader, session: other, action: 'send_message' }), (error) => error.status === 403, visibility);
  }
});

test('archived division chats accept no new messages from anyone', () => {
  const archived = session({ owner_user_id: 77, visibility: 'department', status: 'archived' });
  assert.throws(() => aiAccess.assertSessionAccess({ user: divisionMember(), session: archived, action: 'send_message' }), (error) => error.status === 409);
  assert.equal(aiAccess.sessionAccessFlags(divisionMember(), archived).canSend, false);
});
