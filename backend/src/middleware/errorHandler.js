const logger = require('../utils/logger');

module.exports = function errorHandler(err, req, res, _next) {
  logger.error({ err: err.message, stack: err.stack });
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production' && status === 500
          ? 'Terjadi kesalahan server'
          : err.message,
    },
  });
};
