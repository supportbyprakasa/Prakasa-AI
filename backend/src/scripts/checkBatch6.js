#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const REQUIRED_PERMISSIONS = ['timeline.view', 'task.view'];
const REQUIRED_TABLES = [
  'tasks',
  'task_dependencies',
  'boards',
  'board_columns',
  'users',
  'departments',
];
const REQUIRED_TASK_COLUMNS = ['start_date', 'due_date', 'progress_percent'];

let failures = 0;
let warnings = 0;

function pass(message) {
  console.log(`  ✓ ${message}`);
}
function warn(message) {
  warnings += 1;
  console.log(`  ! ${message}`);
}
function fail(message) {
  failures += 1;
  console.log(`  ✗ ${message}`);
}

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME=?
        AND COLUMN_NAME=?`,
    [table, column]
  );
  return Number(rows[0]?.c || 0) > 0;
}

(async () => {
  console.log('Batch 6 readiness check\n');

  console.log('[1] Services load');
  try {
    const gantt = require('../services/gantt.service');
    if (typeof gantt.buildGantt === 'function') pass('gantt.service#buildGantt');
    else fail('gantt.service#buildGantt MISSING');
    if (gantt.MAX_TASKS === 500) pass('Gantt task cap = 500');
    else warn(`Gantt task cap differs: ${gantt.MAX_TASKS}`);
    if (gantt.MAX_RANGE_DAYS === 365) pass('Gantt range cap = 365 days');
    else fail(`Gantt range cap must be 365, got ${gantt.MAX_RANGE_DAYS}`);
  } catch (error) {
    fail(`gantt.service failed to load: ${error.message}`);
  }

  try {
    const graph = require('../services/taskDependencyGraph.service');
    if (typeof graph.buildGraph === 'function') pass('taskDependencyGraph.service#buildGraph');
    else fail('taskDependencyGraph.service#buildGraph MISSING');
    if (graph.MAX_DEPTH === 3) pass('Graph depth cap = 3');
    else fail(`Graph depth cap must be 3, got ${graph.MAX_DEPTH}`);
    if (graph.MAX_NODES === 200) pass('Graph node cap = 200');
    else fail(`Graph node cap must be 200, got ${graph.MAX_NODES}`);
  } catch (error) {
    fail(`taskDependencyGraph.service failed to load: ${error.message}`);
  }

  console.log('\n[2] Controller functions');
  try {
    const timelineCtrl = require('../controllers/timeline.controller');
    if (typeof timelineCtrl.gantt === 'function') pass('timeline.controller#gantt');
    else fail('timeline.controller#gantt MISSING');
    if (typeof timelineCtrl.timeline === 'function') pass('timeline.controller#timeline');
    else warn('timeline.controller#timeline missing');
  } catch (error) {
    fail(`timeline.controller failed to load: ${error.message}`);
  }

  try {
    const taskCtrl = require('../controllers/tasks.controller');
    if (typeof taskCtrl.dependencyGraph === 'function') pass('tasks.controller#dependencyGraph');
    else fail('tasks.controller#dependencyGraph MISSING');
  } catch (error) {
    fail(`tasks.controller failed to load: ${error.message}`);
  }

  console.log('\n[3] Permissions');
  for (const code of REQUIRED_PERMISSIONS) {
    const [rows] = await pool.query('SELECT id FROM permissions WHERE code=? LIMIT 1', [code]);
    if (rows[0]) pass(code);
    else fail(`${code} MISSING`);
  }

  console.log('\n[4] Required tables');
  for (const table of REQUIRED_TABLES) {
    if (await tableExists(table)) pass(table);
    else fail(`${table} MISSING`);
  }

  console.log('\n[5] tasks columns');
  for (const column of REQUIRED_TASK_COLUMNS) {
    if (await columnExists('tasks', column)) pass(`tasks.${column}`);
    else fail(`tasks.${column} MISSING`);
  }

  console.log('\n[6] Routes');
  const timelineRoutes = fs.readFileSync(
    path.join(__dirname, '../routes/timeline.routes.js'),
    'utf8'
  );
  if (timelineRoutes.includes("'/gantt'")) pass('GET /timeline/gantt');
  else fail('GET /timeline/gantt MISSING');
  if (timelineRoutes.includes('requireEntityScope')) pass('timeline entity scope middleware');
  else fail('timeline entity scope middleware MISSING');

  const taskRoutes = fs.readFileSync(
    path.join(__dirname, '../routes/tasks.routes.js'),
    'utf8'
  );
  if (taskRoutes.includes("'/:id/dependencies/graph'")) {
    pass('GET /tasks/:id/dependencies/graph');
  } else {
    fail('GET /tasks/:id/dependencies/graph MISSING');
  }

  console.log('\n[7] package.json script');
  try {
    const pkg = require('../../package.json');
    if (pkg.scripts?.['check:batch6']) pass('"check:batch6"');
    else warn('"check:batch6" not in package.json');
  } catch {
    warn('package.json not readable');
  }

  console.log('');
  if (failures > 0) {
    console.log(`RESULT: NOT READY (${failures} failures, ${warnings} warnings)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: READY (${warnings} warnings)`);
  }

  await pool.end();
})().catch(async (error) => {
  console.error('checkBatch6 crashed:', error.message);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
