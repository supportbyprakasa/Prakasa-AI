#!/usr/bin/env node

const {
  DIVISIONS,
  STANDARD_ROLES,
} = require('../config/standardOrganization');

const MOVEMENT_PERMISSIONS = Object.freeze([
  'warehouse.movement.view',
  'warehouse.movement.create',
  'warehouse.movement.update',
  'warehouse.movement.submit',
  'warehouse.movement.approve',
  'warehouse.movement.cancel',
  'warehouse.movement.audit.view',
]);

function evaluateWorkspaceOrganization(counts) {
  const failures = [];
  const checks = [
    ['departments.code columns', counts.departmentColumns, 1],
    ['role metadata columns', counts.roleColumns, 4],
    ['standard divisions', counts.divisions, DIVISIONS.length],
    ['standard roles', counts.standardRoles, STANDARD_ROLES.length],
    ['Warehouse movement permissions', counts.movementPermissions, MOVEMENT_PERMISSIONS.length],
  ];

  for (const [label, actual, expected] of checks) {
    if (Number(actual) !== expected) {
      failures.push(`${label}: ${Number(actual)}/${expected}`);
    }
  }

  if (Number(counts.invalidStandardRoles) !== 0) {
    failures.push(`invalid standard role links: ${Number(counts.invalidStandardRoles)}`);
  }

  return { ready: failures.length === 0, failures };
}

async function scalar(pool, sql, params = []) {
  const [[row]] = await pool.query(sql, params);
  return Number(row.total || 0);
}

async function inspectWorkspaceOrganization(pool) {
  const divisionCodes = DIVISIONS.map((division) => division.code);
  const roleKeys = STANDARD_ROLES.map((role) => role.key);

  const [
    departmentColumns,
    roleColumns,
    divisions,
    standardRoles,
    movementPermissions,
    invalidStandardRoles,
  ] = await Promise.all([
    scalar(pool,
      `SELECT COUNT(*) AS total
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='departments'
          AND COLUMN_NAME='code'`),
    scalar(pool,
      `SELECT COUNT(*) AS total
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='roles'
          AND COLUMN_NAME IN ('role_key','department_id','role_level','is_system_template')`),
    scalar(pool,
      `SELECT COUNT(*) AS total
         FROM departments
        WHERE entity_id=1 AND deleted_at IS NULL AND code IN (?)`,
      [divisionCodes]),
    scalar(pool,
      `SELECT COUNT(*) AS total
         FROM roles
        WHERE entity_id=1 AND deleted_at IS NULL
          AND is_system_template=1 AND role_key IN (?)`,
      [roleKeys]),
    scalar(pool,
      'SELECT COUNT(*) AS total FROM permissions WHERE code IN (?)',
      [MOVEMENT_PERMISSIONS]),
    scalar(pool,
      `SELECT COUNT(*) AS total
         FROM roles r
         LEFT JOIN departments d ON d.id=r.department_id
        WHERE r.entity_id=1
          AND r.deleted_at IS NULL
          AND r.role_key IN (?)
          AND (
            d.id IS NULL OR d.deleted_at IS NOT NULL OR d.entity_id<>r.entity_id
            OR r.role_key<>CONCAT(d.code, '.', r.role_level)
          )`,
      [roleKeys]),
  ]);

  return {
    departmentColumns,
    roleColumns,
    divisions,
    standardRoles,
    movementPermissions,
    invalidStandardRoles,
  };
}

async function run(pool) {
  const counts = await inspectWorkspaceOrganization(pool);
  const result = evaluateWorkspaceOrganization(counts);

  console.log('\nPrakasa Workspace organization readiness\n');
  for (const [label, value] of Object.entries(counts)) {
    console.log(`${label}: ${value}`);
  }
  console.log('');

  if (!result.ready) {
    for (const failure of result.failures) console.log(`[FAIL] ${failure}`);
    process.exitCode = 1;
    return result;
  }

  console.log('[PASS] organization schema and standard seeds are ready');
  return result;
}

module.exports = {
  MOVEMENT_PERMISSIONS,
  evaluateWorkspaceOrganization,
  inspectWorkspaceOrganization,
  run,
};

if (require.main === module) {
  require('dotenv').config();
  const pool = require('../db/pool');
  run(pool)
    .catch((error) => {
      console.error('checkWorkspaceOrganization crashed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
