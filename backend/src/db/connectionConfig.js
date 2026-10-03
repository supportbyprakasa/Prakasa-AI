const DEFAULT_DB_PORT = 3306;
const SSL_MODES = new Set(['disabled', 'required', 'verify-ca']);

function configError(message) {
  const error = new Error(message);
  error.code = 'DB_CONFIG_INVALID';
  return error;
}

function parsePort(rawPort) {
  if (rawPort == null || String(rawPort).trim() === '') {
    return DEFAULT_DB_PORT;
  }

  const normalized = String(rawPort).trim();
  if (!/^\d+$/.test(normalized)) {
    throw configError('DB_PORT harus berupa integer 1-65535.');
  }

  const port = Number(normalized);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError('DB_PORT harus berada pada rentang 1-65535.');
  }
  return port;
}

function normalizeCa(rawCa) {
  return String(rawCa || '').replace(/\\n/g, '\n');
}

function buildSslConfig(env) {
  const mode = String(env.DB_SSL_MODE || 'disabled').trim().toLowerCase();
  const rawCa = String(env.DB_SSL_CA || '');
  const hasCa = rawCa.trim().length > 0;

  if (!SSL_MODES.has(mode)) {
    throw configError(
      'DB_SSL_MODE tidak valid. Gunakan disabled, required, atau verify-ca.'
    );
  }

  if (mode !== 'verify-ca' && hasCa) {
    throw configError(
      'DB_SSL_CA hanya boleh digunakan saat DB_SSL_MODE=verify-ca.'
    );
  }

  if (mode === 'disabled') return null;

  if (mode === 'required') {
    return { rejectUnauthorized: true };
  }

  if (!hasCa) {
    throw configError(
      'DB_SSL_CA wajib diisi saat DB_SSL_MODE=verify-ca.'
    );
  }

  return {
    rejectUnauthorized: true,
    ca: normalizeCa(rawCa),
  };
}

// Every session runs in UTC, the same as the driver's `timezone: 'Z'`, so a
// time written by NOW() reads back as the right instant whatever the server's
// own zone is (a Mac in WIB, a VPS in UTC). Calendar days are WIB and are
// spelled out in SQL (utils/wibTime.js).
const SESSION_TIME_ZONE_SQL = "SET time_zone = '+00:00'";

function buildDbConnectionConfig(env = process.env) {
  const config = {
    host: env.DB_HOST,
    port: parsePort(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
  };

  const ssl = buildSslConfig(env);
  if (ssl) config.ssl = ssl;

  return config;
}

module.exports = {
  SESSION_TIME_ZONE_SQL,
  DEFAULT_DB_PORT,
  SSL_MODES,
  parsePort,
  normalizeCa,
  buildSslConfig,
  buildDbConnectionConfig,
};
