#!/usr/bin/env node
/**
 * Batch 5 readiness checker.
 * Usage: npm run check:batch5
 */
require('dotenv').config();
const pool = require('../db/pool');

const EXPECTED_NOTIF_COLUMNS = ['deleted_at', 'dedupe_key'];
const EXPECTED_NOTIF_INDEXES = [
  'idx_notif_user_read_created',
  'idx_notif_user_event_created',
  'idx_notif_user_subject',
  'uq_notif_dedupe',
];

const EXPECTED_SEARCH_INDEXES = [
  ['documents', 'idx_docs_entity_title'],
  ['tasks', 'idx_tasks_entity_title'],
];

const EXPECTED_PERMISSIONS = [
  'search.global',
  'document.view',
  'task.view',
  'sales.customer.view',
  'sales.pipeline.view',
  'meeting.view',
  'device.view',
  'subscription.view',
  'finance.view',
  'hrga.view',
  'kb.view',
  'decision_log.view',
  'approval.view',
  'signature.view',
];

const EXPECTED_TABLES = [
  'notifications',
  'documents',
  'tasks',
  'sales_customers',
  'sales_pipeline',
  'meetings',
  'devices',
  'software_subscriptions',
  'finance_workflows',
  'hrga_workflows',
  'kb_documents',
  'decision_logs',
  'approval_requests',
  'signature_requests',
];

let failures = 0;
let warnings = 0;
function pass(m) { console.log(`  ✓ ${m}`); }
function warn(m) { console.log(`  ! ${m}`); warnings++; }
function fail(m) { console.log(`  ✗ ${m}`); failures++; }

async function columnExists(t, c) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [t, c]
  );
  return r[0].c > 0;
}
async function indexExists(t, idx) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [t, idx]
  );
  return r[0].c > 0;
}
async function tableExists(t) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]
  );
  return r[0].c > 0;
}

(async () => {
  console.log('Batch 5 readiness check\n');

  console.log('[1] notifications columns');
  for (const c of EXPECTED_NOTIF_COLUMNS) {
    if (await columnExists('notifications', c)) pass(`notifications.${c}`);
    else fail(`notifications.${c} MISSING`);
  }

  console.log('\n[2] notifications indexes');
  for (const idx of EXPECTED_NOTIF_INDEXES) {
    if (await indexExists('notifications', idx)) pass(idx);
    else warn(`${idx} MISSING (dedupe/query performance affected)`);
  }

  console.log('\n[3] Search indexes');
  for (const [table, index] of EXPECTED_SEARCH_INDEXES) {
    if (await indexExists(table, index)) pass(`${table}.${index}`);
    else fail(`${table}.${index} MISSING`);
  }

  console.log('\n[4] Search-relevant tables');
  for (const t of EXPECTED_TABLES) {
    if (await tableExists(t)) pass(t);
    else fail(`${t} MISSING`);
  }

  console.log('\n[5] Permissions');
  for (const code of EXPECTED_PERMISSIONS) {
    const [r] = await pool.query(`SELECT id FROM permissions WHERE code = ?`, [code]);
    if (r[0]) pass(code);
    else fail(`${code} MISSING`);
  }

  console.log('\n[6] globalSearch service loads');
  try {
    const svc = require('../services/globalSearch.service');
    if (svc && typeof svc.search === 'function') pass('globalSearch.service loaded');
    else fail('globalSearch.service missing search()');
  } catch (e) {
    fail(`globalSearch.service failed to load: ${e.message}`);
  }

  console.log('\n[7] notificationCenter service loads');
  try {
    const svc = require('../services/notificationCenter.service');
    const needed = ['listForUser','getUnreadCount','markRead','markUnread','markAllRead','dismiss','clearRead'];
    const missing = needed.filter((n) => typeof svc[n] !== 'function');
    if (!missing.length) pass('notificationCenter.service loaded');
    else fail(`notificationCenter.service missing: ${missing.join(', ')}`);
  } catch (e) {
    fail(`notificationCenter.service failed to load: ${e.message}`);
  }

  console.log('\n[8] package.json script');
  try {
    const pkg = require('../../package.json');
    if (pkg.scripts && pkg.scripts['check:batch5']) pass('"check:batch5"');
    else fail('"check:batch5" not in package.json');
  } catch {
    fail('package.json not readable');
  }

  console.log('');
  if (failures > 0) {
    console.log(`RESULT: NOT READY (${failures} failures, ${warnings} warnings)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: READY (${warnings} warnings)`);
  }

  await pool.end();
})().catch((e) => {
  console.error('checkBatch5 crashed:', e.message);
  process.exit(1);
});