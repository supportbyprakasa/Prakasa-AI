// Data retention (production hardening, Oct 2026). Removes only operational
// noise that grows without bound:
//   - integration_logs older than 90 days (Google/AI/QR call logs), except the
//     production setup trail (operation setup.* / bootstrapAdmin.*), which is
//     an audit record and is kept;
//   - notifications older than 180 days that the user has READ (unread ones are
//     always kept, however old).
// Never anything else. Audit tables (activity_logs, approval_audit_log, …) and
// the Accurate mirror (accurate_records, sales_accurate_batches, sync runs) are
// insert-only by owner rule — PROTECTED_TABLES makes that explicit and the
// runner refuses a policy that names one of them.
//
// Deletes run in batches (LIMIT, default 5000) with a short pause, so a large
// first run never holds long locks on shared hosting.

const PROTECTED_TABLES = new Set([
  'activity_logs',
  'audit_logs',
  'approval_audit_log',
  'accurate_records',
  'sales_accurate_batches',
  'sales_accurate_batch_items',
  'sales_sync_runs',
  'accurate_connections',
  'accurate_app_credentials',
]);

const MIN_DAYS = 30;

function days(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_DAYS ? n : fallback;
}

function policies(env = process.env) {
  return [
    {
      name: 'integration_logs',
      table: 'integration_logs',
      days: days(env.RETENTION_INTEGRATION_LOG_DAYS, 90),
      where: "created_at < NOW() - INTERVAL ? DAY AND operation NOT LIKE 'setup.%' AND operation NOT LIKE 'bootstrapAdmin.%'",
    },
    {
      name: 'notifications_read',
      table: 'notifications',
      days: days(env.RETENTION_NOTIFICATION_DAYS, 180),
      where: 'is_read = 1 AND created_at < NOW() - INTERVAL ? DAY',
    },
  ];
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function runPolicy(db, policy, { batchSize, pauseMs, maxBatches, dryRun }) {
  if (PROTECTED_TABLES.has(policy.table)) {
    throw Object.assign(new Error(`Tabel ${policy.table} dilindungi; retensi tidak boleh menghapusnya.`), { code: 'RETENTION_PROTECTED' });
  }
  if (dryRun) {
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${policy.table} WHERE ${policy.where}`, [policy.days]);
    return { name: policy.name, days: policy.days, wouldDelete: Number(row?.n || 0) };
  }
  let deleted = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const [result] = await db.query(`DELETE FROM ${policy.table} WHERE ${policy.where} LIMIT ?`, [policy.days, batchSize]);
    const n = Number(result?.affectedRows || 0);
    deleted += n;
    if (n < batchSize) break;
    if (pauseMs) await sleep(pauseMs);
  }
  return { name: policy.name, days: policy.days, deleted };
}

async function run(db, {
  env = process.env,
  dryRun = false,
  batchSize = 5000,
  pauseMs = 200,
  maxBatches = 1000,
} = {}) {
  const results = [];
  for (const policy of policies(env)) {
    results.push(await runPolicy(db, policy, { batchSize, pauseMs, maxBatches, dryRun }));
  }
  return results;
}

module.exports = { run, policies, PROTECTED_TABLES };
