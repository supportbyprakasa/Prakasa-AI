require('dotenv').config();
const {
  LEDGER_TABLE,
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
} = require('./migrations');

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

    const { pending, applied, changed, missing } = classify(files, appliedMap);

    console.log(
      `[migrate] Applied: ${applied.length} · Pending: ${pending.length} · Changed: ${changed.length} · Missing: ${missing.length}`
    );

    if (missing.length) {
      console.log('\n[migrate] WARNING — recorded file missing from disk:');
      for (const item of missing) {
        console.log(`  ! ${item.filename} (applied at ${item.appliedAt})`);
      }
    }

    const knownFiles = new Set(files.map((file) => file.filename));
    for (const filename of args.forceFiles) {
      if (!knownFiles.has(filename)) {
        throw new Error(`--force-file tidak ditemukan: ${filename}`);
      }
    }

    const unresolvedChanged = changed.filter(
      (item) => !args.forceFiles.has(item.file.filename)
    );

    if (unresolvedChanged.length) {
      console.error('\n[migrate] ABORT — checksum mismatch on applied migration(s):');
      for (const item of unresolvedChanged) {
        console.error(`  ✗ ${item.file.filename}`);
        console.error(`      recorded: ${item.expected.slice(0, 16)}…`);
        console.error(`      current:  ${item.actual.slice(0, 16)}…`);
      }
      console.error(
        '[migrate] Revert historical edits or create a new migration. ' +
        'Use --force-file only for deliberate recovery.'
      );
      process.exitCode = 1;
      return;
    }

    const forcedChanged = changed
      .filter((item) => args.forceFiles.has(item.file.filename))
      .map((item) => item.file);

    const toRun = [...pending, ...forcedChanged]
      .sort((a, b) => a.filename.localeCompare(b.filename));

    if (!toRun.length) {
      console.log('\n[migrate] Nothing to run. Database is up to date.');
      return;
    }

    if (args.dryRun) {
      console.log('\n[migrate] DRY RUN — would execute:');
      for (const file of toRun) {
        const forced = args.forceFiles.has(file.filename) ? ' (forced)' : '';
        console.log(`  → ${file.filename}${forced}`);
      }
      return;
    }

    console.log('\n[migrate] Executing:');
    const startedAt = Date.now();
    let appliedCount = 0;

    for (const file of toRun) {
      process.stdout.write(`  → ${file.filename} … `);
      try {
        const result = await applyOne(db, file, {
          note: args.forceFiles.has(file.filename) ? 'force-rerun' : null,
        });
        console.log(`ok (${result.executionMs}ms)`);
        appliedCount += 1;
      } catch (error) {
        console.log('FAILED');
        console.error(`\n[migrate] ${error.message}`);
        console.error(
          '[migrate] Aborting. Ledger is written only after a complete file succeeds.'
        );
        console.error(
          '[migrate] Note: MySQL DDL may auto-commit; inspect partial schema changes before retrying.'
        );
        process.exitCode = 1;
        return;
      }
    }

    console.log(
      `\n[migrate] Done. ${appliedCount} applied in ${Date.now() - startedAt}ms.`
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`[migrate] Fatal: ${error.message}`);
  process.exitCode = 1;
});
