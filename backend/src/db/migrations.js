const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { buildDbConnectionConfig } = require('./connectionConfig');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const LEDGER_TABLE = 'schema_migrations';

function createMigrationConnection() {
  return mysql.createConnection({
    ...buildDbConnectionConfig(),
    multipleStatements: true,
  });
}

async function ensureLedger(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT UNSIGNED NULL,
      note VARCHAR(500) NULL,
      KEY idx_ledger_applied_at (applied_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations folder not found: ${MIGRATIONS_DIR}`);
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const fullPath = path.join(MIGRATIONS_DIR, filename);
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        filename,
        fullPath,
        content,
        checksum: sha256(content),
      };
    });
}

async function getAppliedMap(db) {
  const [rows] = await db.query(
    `SELECT filename, checksum, applied_at AS appliedAt
       FROM ${LEDGER_TABLE}`
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.filename, {
      checksum: row.checksum,
      appliedAt: row.appliedAt,
    });
  }
  return map;
}

function classify(files, appliedMap) {
  const pending = [];
  const applied = [];
  const changed = [];
  const fileSet = new Set(files.map((file) => file.filename));

  for (const file of files) {
    const entry = appliedMap.get(file.filename);
    if (!entry) pending.push(file);
    else if (entry.checksum === file.checksum) applied.push(file);
    else changed.push({
      file,
      expected: entry.checksum,
      actual: file.checksum,
    });
  }

  const missing = [];
  for (const [filename, entry] of appliedMap.entries()) {
    if (!fileSet.has(filename)) {
      missing.push({ filename, appliedAt: entry.appliedAt });
    }
  }

  return { pending, applied, changed, missing };
}

async function countExistingDomainTables(db) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME <> ?`,
    [LEDGER_TABLE]
  );
  return Number(rows[0]?.c || 0);
}

function migrationNumber(filename) {
  const match = String(filename).match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

function validateBaselineThroughTarget(files, through) {
  if (through == null || through === '') return null;

  const raw = String(through).trim();
  if (/^\d+$/.test(raw)) {
    const targetNumber = Number(raw);
    const exactMatch = files.some(
      (file) => migrationNumber(file.filename) === targetNumber
    );
    if (!exactMatch) {
      throw new Error(
        `--baseline-through="${raw}" tidak cocok dengan file migrasi apapun`
      );
    }
    return raw;
  }

  const exactMatch = files.some((file) => file.filename === raw);
  if (!exactMatch) {
    throw new Error(`Migration baseline-through tidak ditemukan: ${raw}`);
  }
  return raw;
}

function selectBaselineFiles(files, through) {
  if (through == null || through === '') return [...files];

  const raw = validateBaselineThroughTarget(files, through);
  if (/^\d+$/.test(raw)) {
    const maxNumber = Number(raw);
    const selected = files.filter((file) => {
      const n = migrationNumber(file.filename);
      return n != null && n <= maxNumber;
    });
    if (!selected.length) {
      throw new Error(`Tidak ada migration sampai nomor ${raw}`);
    }
    return selected;
  }

  const index = files.findIndex((file) => file.filename === raw);
  if (index < 0) {
    throw new Error(`Migration baseline-through tidak ditemukan: ${raw}`);
  }
  return files.slice(0, index + 1);
}

async function baselineFiles(db, files, { dryRun = false, note = 'baseline' } = {}) {
  const [[{ c }]] = await db.query(
    `SELECT COUNT(*) AS c FROM ${LEDGER_TABLE}`
  );
  if (Number(c) > 0) {
    throw new Error(
      'Baseline ditolak: ledger sudah memiliki entri. ' +
      'Baseline hanya untuk environment existing yang ledger-nya masih kosong.'
    );
  }

  if (dryRun) return { count: files.length, dryRun: true };

  await db.beginTransaction();
  try {
    for (const file of files) {
      await db.query(
        `INSERT INTO ${LEDGER_TABLE}
           (filename, checksum, execution_ms, note)
         VALUES (?, ?, NULL, ?)`,
        [file.filename, file.checksum, note]
      );
    }
    await db.commit();
    return { count: files.length, dryRun: false };
  } catch (error) {
    try { await db.rollback(); } catch { /* noop */ }
    throw error;
  }
}

/**
 * Execute one full migration exactly like the legacy runner:
 * mysql2 multipleStatements=true is intentional because existing migrations
 * contain PREPARE/EXECUTE/DEALLOCATE sequences on the same line.
 *
 * MySQL DDL can auto-commit, so this function does NOT claim transactional
 * rollback of migration SQL. The ledger row is written only after the whole
 * SQL file completes successfully. Existing migrations are expected to be
 * idempotent enough to retry after a partial failure.
 */
async function applyOne(db, file, { note = null } = {}) {
  const startedAt = Date.now();
  try {
    await db.query(file.content);
    const elapsed = Date.now() - startedAt;
    await db.query(
      `INSERT INTO ${LEDGER_TABLE}
         (filename, checksum, execution_ms, note)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         checksum = VALUES(checksum),
         applied_at = NOW(),
         execution_ms = VALUES(execution_ms),
         note = VALUES(note)`,
      [file.filename, file.checksum, elapsed, note]
    );
    return { filename: file.filename, executionMs: elapsed };
  } catch (error) {
    throw new Error(`Migration failed: ${file.filename} — ${error.message}`);
  }
}

module.exports = {
  LEDGER_TABLE,
  MIGRATIONS_DIR,
  createMigrationConnection,
  ensureLedger,
  loadMigrationFiles,
  getAppliedMap,
  classify,
  countExistingDomainTables,
  validateBaselineThroughTarget,
  selectBaselineFiles,
  baselineFiles,
  applyOne,
  sha256,
};
