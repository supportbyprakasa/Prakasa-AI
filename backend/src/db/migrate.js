require('dotenv').config();
const {
  LEDGER_TABLE,
  createMigrationConnection,
  ensureLedger,
  loadMigrationFiles,
  getAppliedMap,
  countExistingDomainTables,
  validateBaselineThroughTarget,
  selectBaselineFiles,
  baselineFiles,
} = require('./migrations');
const {
  runPendingMigrations,
} = require('../services/migrationRunner.service');

function parseArgs(argv) {
  const args = {
    baseline: false,
    baselineThrough: null,
    dryRun: false,
    forceFiles: new Set(),
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--baseline') args.baseline = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--baseline-through=')) {
      args.baselineThrough = arg.slice('--baseline-through='.length).trim();
    } else if (arg.startsWith('--force-file=')) {
      const filename = arg.slice('--force-file='.length).trim();
      if (filename) args.forceFiles.add(filename);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.baseline && args.baselineThrough) {
    throw new Error('Gunakan salah satu: --baseline ATAU --baseline-through, bukan keduanya.');
  }

  return args;
}

function printHelp() {
  console.log(`
Usage: node src/db/migrate.js [options]

Options:
  --dry-run
      Print plan only. Execute nothing.

  --baseline
      Mark ALL migration files as applied WITHOUT executing them.
      Only valid when the ledger is empty. Use only after verifying the
      existing schema already includes every migration file currently on disk.

  --baseline-through=<N|filename>
      Mark migrations up to a number or exact filename as applied, without
      executing them. Example for the current pre-ledger production shape:
        --baseline-through=027
      This leaves migration 028 pending so the next normal migrate executes it.

  --force-file=<filename>
      Re-run one already-recorded migration only when its checksum changed.
      Intended for exceptional recovery; prefer a new migration instead.

  --help, -h
      Show this message.

Safety:
  - Fresh/empty database: plain migrate runs all migrations and records them.
  - Existing database with an empty ledger: plain migrate ABORTS instead of
    re-running historical migrations. Baseline explicitly first.
  - Matching applied migration: skipped.
  - Checksum drift: abort unless the changed file is explicitly forced.
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const db = await createMigrationConnection();

  try {
    console.log(`[migrate] Ledger: ${LEDGER_TABLE}`);
    await ensureLedger(db);

    const files = loadMigrationFiles();

    if (args.baselineThrough) {
      const verifiedTarget = validateBaselineThroughTarget(
        files,
        args.baselineThrough
      );
      console.log(
        `[migrate] --baseline-through target "${verifiedTarget}" verified.`
      );
    }

    const appliedMap = await getAppliedMap(db);
    const existingDomainTables = await countExistingDomainTables(db);

    console.log(`[migrate] Loaded ${files.length} migration file(s)`);
    console.log(
      `[migrate] Existing domain tables: ${existingDomainTables} · Ledger rows: ${appliedMap.size}`
    );

    // ----------------------------------------------------------
    // Explicit baseline path for environments that predate ledger.
    // ----------------------------------------------------------
    if (args.baseline || args.baselineThrough) {
      if (appliedMap.size > 0) {
        throw new Error(
          'Baseline ditolak: ledger sudah memiliki entri. Gunakan normal migrate.'
        );
      }
      if (existingDomainTables === 0) {
        throw new Error(
          'Baseline ditolak pada database kosong. Gunakan normal migrate agar schema benar-benar dibuat.'
        );
      }

      const selected = selectBaselineFiles(
        files,
        args.baselineThrough || null
      );

      if (args.dryRun) {
        console.log('\n[migrate] DRY RUN — baseline only; no SQL migrations will execute.');
        console.log(`[migrate] Would record ${selected.length} file(s):`);
        for (const file of selected) console.log(`  = ${file.filename}`);
        const remaining = files.filter(
          (file) => !selected.some((picked) => picked.filename === file.filename)
        );
        if (remaining.length) {
          console.log('[migrate] Would remain pending after baseline:');
          for (const file of remaining) console.log(`  → ${file.filename}`);
        }
        return;
      }

      const note = args.baselineThrough
        ? `baseline-through:${args.baselineThrough}`
        : 'baseline-all';

      const result = await baselineFiles(db, selected, { note });
      console.log(
        `[migrate] Baseline complete: ${result.count} file(s) recorded without execution.`
      );

      const remaining = files.length - selected.length;
      if (remaining > 0) {
        console.log(
          `[migrate] ${remaining} migration file(s) remain pending. Run "npm run migrate" next.`
        );
      } else {
        console.log('[migrate] All current migration files are now recorded.');
      }
      return;
    }

    // ----------------------------------------------------------
    // Default-safe guard.
    // A pre-ledger existing schema must NEVER silently replay history.
    // ----------------------------------------------------------
    if (appliedMap.size === 0 && existingDomainTables > 0) {
      console.error(
        '\n[migrate] ABORT — existing database detected but migration ledger is empty.'
      );
      console.error(
        '[migrate] Historical migrations will NOT be re-run automatically.'
      );
      console.error(
        '[migrate] For the current environment that already has 001–027, use:'
      );
      console.error(
        '  npm run migrate -- --dry-run --baseline-through=027'
      );
      console.error(
        '  npm run migrate -- --baseline-through=027'
      );
      console.error(
        '  npm run migrate'
      );
      console.error(
        '[migrate] Use --baseline only when you have verified ALL migration files on disk are already applied.'
      );
      process.exitCode = 1;
      return;
    }

    const result = await runPendingMigrations({
      db,
      forceFiles: args.forceFiles,
      dryRun: args.dryRun,
      allowExistingSchema: true,
    });

    const before = result.before;
    console.log(
      `[migrate] Applied: ${before.applied} · Pending: ${before.pending} · Changed: ${before.changed} · Missing: ${before.missing}`
    );

    if (result.status === 'blocked') {
      console.error(
        `\n[migrate] ABORT — migration state blocked: ${result.reason}`
      );
      if (result.unresolved) {
        for (const item of result.unresolved) {
          console.error(`  ✗ ${item.filename}`);
        }
      }
      if (result.missing) {
        for (const item of result.missing) {
          console.error(`  ✗ missing: ${item.filename}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    if (result.status === 'error') {
      console.error(`\n[migrate] Migration failed: ${result.failedFile}`);
      console.error(
        '[migrate] Aborting. Check the error above and inspect partial DDL before retrying.'
      );
      process.exitCode = 1;
      return;
    }

    if (args.dryRun) {
      if (!result.wouldRun.length) {
        console.log('\n[migrate] DRY RUN — nothing to run.');
      } else {
        console.log('\n[migrate] DRY RUN — would execute:');
        for (const filename of result.wouldRun) {
          const forced = args.forceFiles.has(filename) ? ' (forced)' : '';
          console.log(`  → ${filename}${forced}`);
        }
      }
      return;
    }

    if (!result.executed.length) {
      console.log('\n[migrate] Nothing to run. Database is up to date.');
      return;
    }

    console.log('\n[migrate] Executed:');
    for (const item of result.executed) {
      console.log(`  ✓ ${item.filename} (${item.executionMs}ms)`);
    }
    console.log(
      `[migrate] Done. ${result.executed.length} migration file(s) applied.`
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`[migrate] Fatal: ${error.message}`);
  process.exitCode = 1;
});
