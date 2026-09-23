#!/usr/bin/env node
require('dotenv').config();
const pool = require('../db/pool');
const {
  LEDGER_TABLE,
  loadMigrationFiles,
  getAppliedMap,
  classify,
} = require('../db/migrations');

let failures = 0;
let warnings = 0;
function pass(m) { console.log(`  ✓ ${m}`); }
function warn(m) { warnings += 1; console.log(`  ! ${m}`); }
function fail(m) { failures += 1; console.log(`  ✗ ${m}`); }

function printResult() {
  console.log('');
  if (failures > 0) {
    console.log(`RESULT: NOT HEALTHY (${failures} failures, ${warnings} warnings)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: HEALTHY (${warnings} warnings)`);
  }
}

(async () => {
  console.log('Migration ledger health check\n');

  console.log(`[1] Table ${LEDGER_TABLE}`);
  const [tables] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [LEDGER_TABLE]
  );

  if (Number(tables[0]?.c || 0) > 0) pass(`${LEDGER_TABLE} exists`);
  else {
    fail(
      `${LEDGER_TABLE} MISSING — fresh DB: run npm run migrate; existing DB: baseline first`
    );
    printResult();
    await pool.end();
    return;
  }

  const files = loadMigrationFiles();
  const appliedMap = await getAppliedMap(pool);
  const { pending, applied, changed, missing } = classify(files, appliedMap);

  console.log('\n[2] Summary');
  console.log(`  files on disk:      ${files.length}`);
  console.log(`  rows in ledger:     ${appliedMap.size}`);
  console.log(`  applied (matching): ${applied.length}`);
  console.log(`  pending:            ${pending.length}`);
  console.log(`  changed:            ${changed.length}`);
  console.log(`  missing:            ${missing.length}`);

  console.log('\n[3] Pending migrations');
  if (!pending.length) pass('none — database is up to date');
  else {
    for (const file of pending) {
      fail(`${file.filename} — not yet applied (run "npm run migrate")`);
    }
  }

  console.log('\n[4] Changed checksums');
  if (!changed.length) pass('none');
  else {
    for (const item of changed) {
      fail(`${item.file.filename} — checksum differs from recorded value`);
    }
    console.log('  Investigate before running migrate.');
  }

  console.log('\n[5] Missing files');
  if (!missing.length) pass('none');
  else {
    for (const item of missing) {
      fail(
        `${item.filename} — recorded in ledger but not on disk (applied at ${item.appliedAt})`
      );
    }
    console.log(
      '  Files were likely renamed or deleted. Do NOT run migrate until resolved.'
    );
  }

  printResult();
  await pool.end();
})().catch(async (error) => {
  console.error('checkLedger crashed:', error.message);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
