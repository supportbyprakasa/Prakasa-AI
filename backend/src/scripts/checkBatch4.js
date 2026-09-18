#!/usr/bin/env node
require('dotenv').config();
const pool = require('../db/pool');

const TABLES = [
  'task_watchers',
  'task_checklist_items',
  'task_dependencies',
  'task_activity',
];

const TASK_COLUMNS = [
  'start_date',
  'progress_percent',
  'completed_by',
];

const PERMISSIONS = [
  'task.watch',
  'task.watch.manage',
  'task.checklist.manage',
  'task.dependency.manage',
  'task.activity.view',
];

const INDEXES = [
  ['tasks', 'idx_tasks_entity_due_status'],
  ['tasks', 'idx_tasks_entity_dept_status'],
  ['notifications', 'uq_notif_dedupe'],
  ['task_watchers', 'PRIMARY'],
  ['task_checklist_items', 'idx_tci_task_pos'],
  ['task_dependencies', 'uq_td_edge'],
  ['task_activity', 'idx_ta_task_id'],
];

let failures = 0;

function pass(label, detail = '') {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  failures += 1;
  console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function exists(sql, args) {
  const [rows] = await pool.query(sql, args);
  return Number(rows[0]?.total || rows[0]?.c || 0) > 0;
}

async function tableExists(name) {
  return exists(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [name]
  );
}

async function columnExists(table, column) {
  return exists(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
}

async function indexExists(table, index) {
  return exists(
    `SELECT COUNT(*) AS total FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [table, index]
  );
}

async function foreignKeyExists(table, constraint) {
  return exists(
    `SELECT COUNT(*) AS total
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE()
        AND TABLE_NAME=?
        AND CONSTRAINT_NAME=?`,
    [table, constraint]
  );
}

(async () => {
  console.log('\nBatch 4 Readiness Check\n');

  let present = 0;
  for (const table of TABLES) {
    if (await tableExists(table)) present += 1;
  }
  if (present === TABLES.length) {
    pass('Batch 4 tables', `${present}/${TABLES.length} present`);
  } else {
    fail('Batch 4 tables', `${present}/${TABLES.length} present`);
  }

  let taskColumns = 0;
  for (const column of TASK_COLUMNS) {
    if (await columnExists('tasks', column)) taskColumns += 1;
  }
  if (taskColumns === TASK_COLUMNS.length) {
    pass('tasks columns', `${taskColumns}/${TASK_COLUMNS.length} present`);
  } else {
    fail('tasks columns', `${taskColumns}/${TASK_COLUMNS.length} present`);
  }

  if (await columnExists('notifications', 'dedupe_key')) {
    pass('notifications.dedupe_key');
  } else {
    fail('notifications.dedupe_key');
  }

  if (await foreignKeyExists('tasks', 'fk_tasks_completed_by')) {
    pass('tasks.completed_by FK');
  } else {
    fail('tasks.completed_by FK');
  }

  for (const [table, index] of INDEXES) {
    if (await indexExists(table, index)) {
      pass(`${table}.${index}`);
    } else {
      fail(`${table}.${index}`);
    }
  }

  const [permRows] = await pool.query(
    `SELECT code FROM permissions WHERE code IN (?)`,
    [PERMISSIONS]
  );
  const foundPermissions = new Set(permRows.map((row) => row.code));
  if (foundPermissions.size === PERMISSIONS.length) {
    pass('Batch 4 permissions', `${foundPermissions.size}/${PERMISSIONS.length} present`);
  } else {
    fail('Batch 4 permissions', `${foundPermissions.size}/${PERMISSIONS.length} present`);
  }

  const [roles] = await pool.query(
    `SELECT id, name
       FROM roles
      WHERE LOWER(name) IN ('super admin','superadmin','administrator')
        AND deleted_at IS NULL`
  );

  if (!roles.length) {
    fail('Super Admin role', 'not found');
  } else {
    for (const role of roles) {
      const [[row]] = await pool.query(
        `SELECT COUNT(DISTINCT p.id) AS granted
           FROM role_permissions rp
           JOIN permissions p ON p.id=rp.permission_id
          WHERE rp.role_id=? AND p.code IN (?)`,
        [role.id, PERMISSIONS]
      );
      const granted = Number(row.granted);
      if (granted === PERMISSIONS.length) {
        pass(`Super Admin Batch 4 permissions: ${role.name}`, `${granted}/${PERMISSIONS.length}`);
      } else {
        fail(`Super Admin Batch 4 permissions: ${role.name}`, `${granted}/${PERMISSIONS.length}`);
      }
    }
  }

  for (const table of ['boards', 'board_columns', 'tasks', 'users', 'entities']) {
    if (await tableExists(table)) pass(`Prerequisite: ${table}`);
    else fail(`Prerequisite: ${table}`);
  }

  const pkg = require('../../package.json');
  for (const script of ['check:batch4', 'task:due-reminders']) {
    if (pkg.scripts?.[script]) pass(`package script: ${script}`);
    else fail(`package script: ${script}`);
  }

  console.log('');
  if (failures) {
    console.log(`RESULT: NOT READY (${failures} failures)`);
    process.exitCode = 1;
  } else {
    console.log('RESULT: READY');
  }

  await pool.end();
})().catch(async (error) => {
  console.error('checkBatch4 crashed:', error.message);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
