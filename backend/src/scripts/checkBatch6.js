#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const TABLES = ['tasks', 'task_dependencies', 'users', 'departments'];
const TASK_COLUMNS = [
  'entity_id',
  'department_id',
  'start_date',
  'due_date',
  'progress_percent',
  'deleted_at',
];
const PERMISSIONS = ['timeline.view', 'task.view'];

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
  return Number(rows[0]?.total || 0) > 0;
}

async function tableExists(name) {
  return exists(
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [name]
  );
}

async function columnExists(table, column) {
  return exists(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME=?
        AND COLUMN_NAME=?`,
    [table, column]
  );
}

(async () => {
  console.log('\nBatch 6 Part 1 Readiness Check — Gantt + Timeline Backend\n');

  for (const table of TABLES) {
    if (await tableExists(table)) pass(`table: ${table}`);
    else fail(`table: ${table}`, 'missing');
  }

  for (const column of TASK_COLUMNS) {
    if (await columnExists('tasks', column)) pass(`tasks.${column}`);
    else fail(`tasks.${column}`, 'missing');
  }

  const [permRows] = await pool.query(
    'SELECT code FROM permissions WHERE code IN (?)',
    [PERMISSIONS]
  );
  const foundPermissions = new Set(permRows.map((row) => row.code));
  for (const permission of PERMISSIONS) {
    if (foundPermissions.has(permission)) pass(`permission: ${permission}`);
    else fail(`permission: ${permission}`, 'missing');
  }

  try {
    const gantt = require('../services/gantt.service');
    if (typeof gantt.getGantt === 'function') pass('gantt.service.getGantt');
    else fail('gantt.service.getGantt', 'missing');
  } catch (error) {
    fail('gantt.service loads', error.message);
  }

  try {
    const dependency = require('../services/taskDependency.service');
    if (typeof dependency.graph === 'function') pass('taskDependency.service.graph');
    else fail('taskDependency.service.graph', 'missing');
  } catch (error) {
    fail('taskDependency.service loads', error.message);
  }

  const timelineRoutes = fs.readFileSync(
    path.join(__dirname, '../routes/timeline.routes.js'),
    'utf8'
  );
  if (timelineRoutes.includes("'/gantt'")) pass('route: GET /timeline/gantt');
  else fail('route: GET /timeline/gantt', 'missing');

  const taskRoutes = fs.readFileSync(
    path.join(__dirname, '../routes/tasks.routes.js'),
    'utf8'
  );
  if (taskRoutes.includes("'/:id/dependencies/graph'")) {
    pass('route: GET /tasks/:id/dependencies/graph');
  } else {
    fail('route: GET /tasks/:id/dependencies/graph', 'missing');
  }

  const pkg = require('../../package.json');
  if (pkg.scripts?.['check:batch6']) pass('package script: check:batch6');
  else fail('package script: check:batch6', 'missing');

  console.log('');
  if (failures) {
    console.log(`RESULT: NOT READY (${failures} failures)`);
    process.exitCode = 1;
  } else {
    console.log('RESULT: READY');
  }

  await pool.end();
})().catch(async (error) => {
  console.error('checkBatch6 crashed:', error.message);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
