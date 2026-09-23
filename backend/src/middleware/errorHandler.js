const logger = require('../utils/logger');

module.exports = function errorHandler(err, req, res, _next) {
  logger.error({ err: err.message, stack: err.stack });
  const isUploadLimit = err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE';
  const status = isUploadLimit ? 413 : (err.status || 500);
  res.status(status).json({
    success: false,
    error: {
      code: isUploadLimit ? 'FILE_TOO_LARGE' : (err.code || 'INTERNAL_ERROR'),
      message: isUploadLimit
        ? 'Ukuran file melebihi batas upload'
        : process.env.NODE_ENV === 'production' && status === 500
          ? 'Terjadi kesalahan server'
          : err.message,
    },
  });
};
