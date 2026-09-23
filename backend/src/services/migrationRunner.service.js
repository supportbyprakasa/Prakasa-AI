const pool = require('../db/pool');
const logger = require('../utils/logger');
const {
  LEDGER_TABLE,
  createMigrationConnection,
  ensureLedger,
  loadMigrationFiles,
  getAppliedMap,
  classify,
  countExistingDomainTables,
  applyOne,
} = require('../db/migrations');

async function ledgerExists(db) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [LEDGER_TABLE]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function inspectMigrationStatus(db = pool) {
  const files = loadMigrationFiles();
  const existingDomainTables = await countExistingDomainTables(db);
  const hasLedger = await ledgerExists(db);

  let appliedMap = new Map();
  if (hasLedger) {
    appliedMap = await getAppliedMap(db);
  }

  const { pending, applied, changed, missing } = classify(files, appliedMap);
  return {
    files,
    pending,
    applied,
    changed,
    missing,
    ledgerExists: hasLedger,
    ledgerRows: appliedMap.size,
    existingDomainTables,
    fresh: existingDomainTables === 0,
  };
}

function setupConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'LEDGER_EMPTY_WITH_EXISTING_SCHEMA';
  return error;
}

async function assertFreshMigratable(db) {
  const status = await inspectMigrationStatus(db);
  if (
    status.existingDomainTables > 0 &&
    (!status.ledgerExists || status.ledgerRows === 0)
  ) {
    throw setupConflict(
      'Database sudah memiliki schema domain tetapi migration ledger belum siap. ' +
      'Baseline/recovery harus dilakukan melalui CLI oleh operator.'
    );
  }
  return status;
}

function summarize(status) {
  return {
    files: status.files.length,
    applied: status.applied.length,
    pending: status.pending.length,
    changed: status.changed.length,
    missing: status.missing.length,
    ledgerExists: status.ledgerExists,
    ledgerRows: status.ledgerRows,
    existingDomainTables: status.existingDomainTables,
  };
}

async function runPendingMigrations(opts = {}) {
  const {
    forceFiles = new Set(),
    dryRun = false,
    allowExistingSchema = false,
    db: suppliedDb = null,
  } = opts;

  const db = suppliedDb || await createMigrationConnection();
  const ownsConnection = !suppliedDb;

  try {
    const before = allowExistingSchema
      ? await inspectMigrationStatus(db)
      : await assertFreshMigratable(db);

    const knownFiles = new Set(before.files.map((file) => file.filename));
    for (const filename of forceFiles) {
      if (!knownFiles.has(filename)) {
        const error = new Error(`--force-file tidak ditemukan: ${filename}`);
        error.code = 'FORCE_FILE_NOT_FOUND';
        error.status = 400;
        throw error;
      }
    }

    if (before.missing.length) {
      return {
        status: 'blocked',
        reason: 'missing_file',
        missing: before.missing.map((item) => ({
          filename: item.filename,
          appliedAt: item.appliedAt,
        })),
        before: summarize(before),
        executed: [],
      };
    }

    const unresolvedChanged = before.changed.filter(
      (item) => !forceFiles.has(item.file.filename)
    );
    if (unresolvedChanged.length) {
      return {
        status: 'blocked',
        reason: 'checksum_mismatch',
        unresolved: unresolvedChanged.map((item) => ({
          filename: item.file.filename,
          expected: item.expected.slice(0, 16),
          actual: item.actual.slice(0, 16),
        })),
        before: summarize(before),
        executed: [],
      };
    }

    const forcedChanged = before.changed
      .filter((item) => forceFiles.has(item.file.filename))
      .map((item) => item.file);

    const toRun = [...before.pending, ...forcedChanged]
      .sort((a, b) => a.filename.localeCompare(b.filename));

    if (dryRun) {
      return {
        status: 'ok',
        dryRun: true,
        before: summarize(before),
        wouldRun: toRun.map((file) => file.filename),
        executed: [],
      };
    }

    if (!before.ledgerExists) {
      await ensureLedger(db);
    }

    const executed = [];
    for (const file of toRun) {
      try {
        const result = await applyOne(db, file, {
          note: forceFiles.has(file.filename) ? 'force-rerun' : null,
        });
        executed.push({
          filename: result.filename,
          executionMs: result.executionMs,
        });
        logger.info(
          { filename: result.filename, executionMs: result.executionMs },
          '[migrationRunner] applied'
        );
      } catch (error) {
        logger.error(
          { filename: file.filename, err: error.message },
          '[migrationRunner] failed'
        );
        return {
          status: 'error',
          reason: 'apply_failed',
          failedFile: file.filename,
          errorMessage: error.message,
          before: summarize(before),
          executed,
        };
      }
    }

    const after = await inspectMigrationStatus(db);
    return {
      status: 'ok',
      dryRun: false,
      before: summarize(before),
      after: summarize(after),
      executed,
    };
  } finally {
    if (ownsConnection) {
      await db.end();
    }
  }
}

module.exports = {
  inspectMigrationStatus,
  assertFreshMigratable,
  runPendingMigrations,
};
