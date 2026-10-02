// Daily data retention (services/retention.service.js): old integration logs
// and old READ notifications only. Audit logs and the Accurate mirror are never
// touched.
//   node src/jobs/retention.js --dry-run   count what would be deleted, delete nothing
//   node src/jobs/retention.js             delete in batches of 5000
require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const retention = require('../services/retention.service');
const logger = require('../utils/logger');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results = await retention.run(pool, { dryRun });
  for (const r of results) {
    console.log(dryRun
      ? `[retention] ${r.name} (> ${r.days} hari): ${r.wouldDelete} baris akan dihapus (dry run)`
      : `[retention] ${r.name} (> ${r.days} hari): ${r.deleted} baris dihapus`);
  }
  logger.info({ results, dryRun }, '[retention] done');
}

main()
  .catch((e) => { console.error('[retention] gagal:', e.code || '', e.message); process.exitCode = 1; })
  .finally(() => drainAndEnd(pool));
