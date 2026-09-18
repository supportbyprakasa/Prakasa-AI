require('dotenv').config();
const runner = require('../services/automationRunner.service');
const pool = require('../db/pool');
const logger = require('../utils/logger');

/**
 * Dijalankan via cPanel Cron Job (mis. tiap 15 menit):
 *   Every 15 minutes: /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/automationRunner.js
 */
(async () => {
  try {
    const results = await runner.runOnce();
    logger.info({ results }, '[automationRunner] done');
    console.log(`[automationRunner] ${results.length} rule(s) dijalankan`);
  } catch (e) {
    logger.error({ err: e.message }, '[automationRunner] failed');
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
