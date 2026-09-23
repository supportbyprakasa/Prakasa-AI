const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const pool = require('../db/pool');

const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Terlalu banyak percobaan setup.',
    },
  },
});

function isSetupEnabled() {
  return String(process.env.SETUP_ENABLED || '').toLowerCase() === 'yes';
}

function getSetupToken() {
  const token = String(process.env.SETUP_TOKEN || '').trim();
  return /^[a-f0-9]{64}$/i.test(token) ? token : null;
}

function shouldMountSetupRoutes() {
  return isSetupEnabled() && Boolean(getSetupToken());
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function setupGuard(req, res, next) {
  try {
    const [tableRows] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'`
    );

    if (Number(tableRows[0]?.c || 0) > 0) {
      const [[userCountRow]] = await pool.query('SELECT COUNT(*) AS c FROM users');
      if (Number(userCountRow?.c || 0) > 0) {
        logger.warn(
          {
            setupAudit: true,
            operation: 'setup.guard',
            status: 'locked',
            ip: req.ip,
          },
          '[setup] permanently locked after first user provisioning'
        );
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Not Found',
          },
        });
      }
    }
  } catch (error) {
    logger.error({ err: error.message }, '[setup] provisioning lock check failed');
    return next(error);
  }

  const expected = getSetupToken();
  const provided = req.headers['x-setup-token'];

  if (
    !isSetupEnabled() ||
    !expected ||
    !constantTimeEquals(provided, expected)
  ) {
    logger.warn(
      {
        setupAudit: true,
        operation: 'setup.guard',
        status: 'denied',
        ip: req.ip,
      },
      '[setup] denied'
    );
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Setup access denied.',
      },
    });
  }

  return next();
}

module.exports = {
  setupGuard,
  setupLimiter,
  isSetupEnabled,
  getSetupToken,
  shouldMountSetupRoutes,
  constantTimeEquals,
};
