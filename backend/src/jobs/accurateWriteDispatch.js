require('dotenv').config();
const pool = require('../db/pool');
const service = require('../services/accurateWriteRequests.service');
const { drainAndEnd } = require('../utils/pendingWork');
const logger = require('../utils/logger');

// Pengajuan ke Accurate: tries the queue (approved requests) and confirms sent
// ones against the approved mirror. With the send channel closed
// (ACCURATE_WRITE_ENABLED unset) it only records why each request waits.
(async () => {
  try {
    const [entities] = await pool.query('SELECT DISTINCT entity_id FROM accurate_write_requests WHERE status IN (\'queued\', \'sent\')');
    const totals = { sent: 0, blocked: 0, failed: 0, confirmed: 0 };
    for (const { entity_id: entityId } of entities) {
      const d = await service.dispatchQueued(entityId);
      const c = await service.confirmSent(entityId);
      totals.sent += d.sent; totals.blocked += d.blocked; totals.failed += d.failed; totals.confirmed += c.confirmed;
    }
    logger.info({ totals }, '[accurateWriteDispatch] done');
    console.log(`[accurateWriteDispatch] sent=${totals.sent} blocked=${totals.blocked} failed=${totals.failed} confirmed=${totals.confirmed}`);
  } catch (error) {
    logger.error({ err: error.message }, '[accurateWriteDispatch] fatal');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await drainAndEnd(pool);
  }
})();
