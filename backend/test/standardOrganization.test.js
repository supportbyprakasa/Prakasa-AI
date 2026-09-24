const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DIVISIONS,
  STANDARD_ROLES,
  permissionsForStandardRole,
} = require('../src/config/standardOrganization');

test('catalog contains nine divisions and three roles per division', () => {
  assert.equal(DIVISIONS.length, 9);
  assert.equal(STANDARD_ROLES.length, 27);
  assert.equal(new Set(STANDARD_ROLES.map((role) => role.key)).size, 27);

  for (const division of DIVISIONS) {
    assert.deepEqual(
      STANDARD_ROLES
        .filter((role) => role.departmentCode === division.code)
        .map((role) => role.level),
      ['member', 'supervisor', 'head'],
    );
  }
});

test('supervisor and head defaults are permission supersets', () => {
  for (const division of DIVISIONS) {
    const member = new Set(permissionsForStandardRole(`${division.code}.member`));
    const supervisor = new Set(permissionsForStandardRole(`${division.code}.supervisor`));
    const head = new Set(permissionsForStandardRole(`${division.code}.head`));

    for (const code of member) assert.equal(supervisor.has(code), true, code);
    for (const code of supervisor) assert.equal(head.has(code), true, code);
  }
});

test('migration 032 seeds every catalog role and permission', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../migrations/032_prakasa_workspace_organization.sql'),
    'utf8',
  );

  for (const division of DIVISIONS) {
    assert.equal(migration.includes(`'${division.code}'`), true, division.code);
  }

  for (const role of STANDARD_ROLES) {
    assert.equal(migration.includes(`'${role.key}'`), true, role.key);
    for (const permission of role.permissions) {
      assert.equal(migration.includes(`'${permission}'`), true, permission);
    }
  }

  for (const permission of [
    'warehouse.movement.view',
    'warehouse.movement.create',
    'warehouse.movement.update',
    'warehouse.movement.submit',
    'warehouse.movement.approve',
    'warehouse.movement.cancel',
    'warehouse.movement.audit.view',
  ]) {
    assert.equal(migration.includes(`'${permission}'`), true, permission);
  }
});

test('organization checker reports incomplete seeded structures', () => {
  const {
    evaluateWorkspaceOrganization,
  } = require('../src/scripts/checkWorkspaceOrganization');

  assert.deepEqual(
    evaluateWorkspaceOrganization({
      departmentColumns: 1,
      roleColumns: 4,
      divisions: 9,
      standardRoles: 27,
      movementPermissions: 7,
      invalidStandardRoles: 0,
    }),
    { ready: true, failures: [] },
  );

  const incomplete = evaluateWorkspaceOrganization({
    departmentColumns: 1,
    roleColumns: 4,
    divisions: 8,
    standardRoles: 26,
    movementPermissions: 6,
    invalidStandardRoles: 1,
  });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.failures, [
    'standard divisions: 8/9',
    'standard roles: 26/27',
    'Warehouse movement permissions: 6/7',
    'invalid standard role links: 1',
  ]);
});
