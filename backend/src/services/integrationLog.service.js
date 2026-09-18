const pool = require('../db/pool');
const logger = require('../utils/logger');

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'jwt',
  'secret',
  'api_key',
  'apikey',
  'authorization',
  'private_key',
  'client_secret',
  'access_token',
  'refresh_token',
  'id_token',
  'signature',
  'passphrase',
];

function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitize(input, depth = 0) {
  if (depth > 8) return '[MAX_DEPTH]';
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return input.length > 500 ? `${input.slice(0, 500)}…` : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((value) => sanitize(value, depth + 1));
  }
  if (typeof input === 'object') {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = isSensitiveKey(key)
        ? '[REDACTED]'
        : sanitize(value, depth + 1);
    }
    return output;
  }
  return String(input);
}

async function log({
  entityId = null,
  userId = null,
  provider,
  operation,
  subjectType = null,
  subjectId = null,
  status,
  errorMessage = null,
  requestMeta = null,
  responseMeta = null,
  durationMs = null,
}) {
  try {
    await pool.query(
      `INSERT INTO integration_logs
       (entity_id, user_id, provider, operation, subject_type, subject_id,
        status, error_message, request_meta, response_meta, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId,
        userId,
        provider,
        operation,
        subjectType,
        subjectId,
        status,
        errorMessage ? String(errorMessage).slice(0, 500) : null,
        requestMeta ? JSON.stringify(sanitize(requestMeta)) : null,
        responseMeta ? JSON.stringify(sanitize(responseMeta)) : null,
        durationMs,
      ]
    );
  } catch (error) {
    logger.error({ err: error.message }, '[integrationLog] write failed');
  }
}

async function wrap(context, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await log({
      ...context,
      status: 'success',
      durationMs: Date.now() - startedAt,
      responseMeta:
        typeof context.responseMeta === 'function'
          ? context.responseMeta(result)
          : context.responseMeta || null,
    });
    return result;
  } catch (error) {
    await log({
      ...context,
      status: 'failed',
      errorMessage: error.message,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

module.exports = { log, wrap, sanitize, isSensitiveKey };
