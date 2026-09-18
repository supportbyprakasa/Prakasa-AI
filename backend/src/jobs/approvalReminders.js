require('dotenv').config();
const runner = require('../services/approvalReminder.service');
const pool = require('../db/pool');
const logger = require('../utils/logger');

(async () => {
  try {
    const result = await runner.runOnce();
    logger.info({ result }, '[approvalReminders] done');
    console.log(
      `[approvalReminders] reminders=${result.remindersSent} ` +
      `escalations=${result.escalations} errors=${result.errors.length}`
    );
  } catch (error) {
    logger.error({ err: error.message }, '[approvalReminders] fatal');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
