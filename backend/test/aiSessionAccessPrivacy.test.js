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
