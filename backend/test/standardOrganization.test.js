const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DIVISIONS,
  STANDARD_ROLES,
  permissionsForStandardRole,
} = require('../src/config/standardOrganization');

// Eight divisions: Operations is not one (owner, 1 Oct 2026) — GA runs office
// operations inside People & Culture.
test('catalog contains eight divisions and three roles per division', () => {
  assert.equal(DIVISIONS.length, 8);
  assert.equal(DIVISIONS.some((division) => division.code === 'operations'), false);
  assert.equal(STANDARD_ROLES.length, 24);
  assert.equal(new Set(STANDARD_ROLES.map((role) => role.key)).size, 24);

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

test('migration history seeds every catalog role and permission', () => {
  // Migration 032 seeded the original catalog; later migrations (e.g. 037) can
  // legitimately introduce new permission codes as divisions evolve, so a
  // permission only needs to appear SOMEWHERE in migration history, not in 032
  // specifically. Role keys and division codes were fixed at 032, though.
  const migrationsDir = path.join(__dirname, '../migrations');
  const migration032 = fs.readFileSync(path.join(migrationsDir, '032_prakasa_workspace_organization.sql'), 'utf8');
  const allMigrations = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    .join('\n');

  for (const division of DIVISIONS) {
    assert.equal(migration032.includes(`'${division.code}'`), true, division.code);
  }

  for (const role of STANDARD_ROLES) {
    assert.equal(migration032.includes(`'${role.key}'`), true, role.key);
    for (const permission of role.permissions) {
      assert.equal(allMigrations.includes(`'${permission}'`), true, permission);
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
    assert.equal(migration032.includes(`'${permission}'`), true, permission);
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
      divisions: 8,
      standardRoles: 24,
      movementPermissions: 7,
      invalidStandardRoles: 0,
    }),
    { ready: true, failures: [] },
  );

  const incomplete = evaluateWorkspaceOrganization({
    departmentColumns: 1,
    roleColumns: 4,
    divisions: 7,
    standardRoles: 23,
    movementPermissions: 6,
    invalidStandardRoles: 1,
  });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.failures, [
    'standard divisions: 7/8',
    'standard roles: 23/24',
    'Warehouse movement permissions: 6/7',
    'invalid standard role links: 1',
  ]);
});
