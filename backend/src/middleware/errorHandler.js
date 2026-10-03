const logger = require('../utils/logger');

// Google service-account credentials or delegation missing on this server:
// google-auth-library's "No key or keyFile set." and the google*.service
// "GOOGLE_… belum diisi" family. Only when the error carries no 4xx of its own.
const GOOGLE_NOT_CONFIGURED = [
  /^No key or keyFile set\.?$/i,
  /^GOOGLE_[A-Z_]+ belum diisi/,
  /client_email field/i,
];
function isGoogleNotConfigured(err) {
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) return false;
  if (err?.code === 'GOOGLE_ADMIN_NOT_CONFIGURED') return true;
  const message = String(err?.message || '');
  return GOOGLE_NOT_CONFIGURED.some((pattern) => pattern.test(message));
}

// Maps an error to { status, code, message } (exported for tests).
// - Multer: file too large → 413; too many files / unexpected field → 400.
// - Malformed JSON body (body-parser) → 400.
// - Google credentials missing → 503 GOOGLE_NOT_CONFIGURED.
// - Every 5xx in production → INTERNAL_ERROR with a generic message, so no
//   database or driver detail (ER_DUP_ENTRY, table names, ...) reaches the client.
function describeError(err, { production = process.env.NODE_ENV === 'production' } = {}) {
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, code: 'FILE_TOO_LARGE', message: 'Ukuran file melebihi batas upload' };
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return { status: 400, code: 'TOO_MANY_FILES', message: 'Jumlah file melebihi batas' };
    }
    return { status: 400, code: 'UPLOAD_INVALID', message: 'Unggahan file tidak valid' };
  }
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err)) {
    return { status: 400, code: 'INVALID_JSON', message: 'Format JSON tidak valid' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Data yang dikirim terlalu besar' };
  }

  if (isGoogleNotConfigured(err)) {
    return { status: 503, code: 'GOOGLE_NOT_CONFIGURED', message: 'Integrasi Google belum dikonfigurasi. Hubungi Administrator.' };
  }

  const raw = Number(err?.status || err?.statusCode);
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
  if (status >= 500 && production) {
    return { status, code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan server' };
  }
  return { status, code: err?.code || 'INTERNAL_ERROR', message: err?.message || 'Terjadi kesalahan server' };
}

module.exports = function errorHandler(err, req, res, _next) {
  const { status, code, message } = describeError(err);
  if (status >= 500) logger.error({ err: err?.message, code: err?.code, stack: err?.stack });
  else logger.warn({ err: err?.message, code: err?.code, status });
  res.status(status).json({ success: false, error: { code, message } });
};
module.exports.describeError = describeError;
