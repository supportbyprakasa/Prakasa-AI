const pool = require('../db/pool');
const logger = require('../utils/logger');
const integrationLog = require('./integrationLog.service');

async function integrationLogsExist() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'integration_logs'`
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function safeAudit({
  entityId = null,
  userId = null,
  operation,
  status,
  errorMessage = null,
  requestMeta = null,
  responseMeta = null,
  durationMs = null,
}) {
  logger.info(
    {
      setupAudit: true,
      operation,
      status,
      entityId,
      userId,
      errorMessage: errorMessage
        ? String(errorMessage).slice(0, 200)
        : null,
      requestMeta,
      responseMeta,
      durationMs,
    },
    '[setup] audit'
  );

  try {
    if (!await integrationLogsExist()) return;
    await integrationLog.log({
      entityId,
      userId,
      provider: 'internal',
      operation,
      status,
      errorMessage,
      requestMeta,
      responseMeta,
      durationMs,
    });
  } catch (error) {
    logger.warn(
      { err: error.message },
      '[setup] integration audit skipped'
    );
  }
}

module.exports = { safeAudit };
