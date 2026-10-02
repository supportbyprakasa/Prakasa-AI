// Startup configuration check (production hardening, Oct 2026). Called first
// in app.js. In production a missing or placeholder secret, or a missing
// database setting, stops the server before it serves a single request;
// everything else is a warning. In development everything is a warning.
// Never prints a secret value — only the variable name and what is wrong.

const MIN_SECRET_LENGTH = 32;

// The example values shipped in .env.example / cron.env.example.
const PLACEHOLDER_SECRETS = new Set([
  'change_me_to_random_32_chars_minimum_xxxxxxxx',
  'random_32_characters_minimum_xxxxxx',
  '<same value as Node.js App>',
]);

const REQUIRED_DB = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function isLocalOrigin(value) {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch { return false; }
}

function checkSecret(env, name) {
  const value = String(env[name] || '');
  if (!value.trim()) return `${name} belum diisi (${name} is missing)`;
  if (PLACEHOLDER_SECRETS.has(value.trim())) return `${name} masih nilai contoh dari .env.example (${name} is still the example placeholder)`;
  if (value.length < MIN_SECRET_LENGTH) return `${name} minimal ${MIN_SECRET_LENGTH} karakter (${name} must be at least ${MIN_SECRET_LENGTH} characters)`;
  return null;
}

/** Returns { production, errors, warnings } — pure, for tests. */
function check(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const problem = (message) => (production ? errors : warnings).push(message);

  for (const name of ['JWT_SECRET', 'SIGNATURE_ENCRYPTION_KEY']) {
    const issue = checkSecret(env, name);
    if (issue) problem(issue);
  }

  const missingDb = REQUIRED_DB.filter((name) => !String(env[name] || '').trim());
  if (missingDb.length) problem(`Pengaturan database belum lengkap: ${missingDb.join(', ')} (database settings missing)`);

  for (const name of ['PUBLIC_WEB_URL', 'APP_PUBLIC_URL']) {
    const value = String(env[name] || '').trim();
    if (!value) warnings.push(`${name} belum diisi; tautan di email/QR tidak lengkap (${name} is missing)`);
    else if (production && !isHttpsUrl(value)) warnings.push(`${name} sebaiknya https:// di production (${name} is not https)`);
  }

  if (production) {
    const origins = String(env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (!origins.length) warnings.push('CORS_ORIGINS kosong; frontend tidak bisa memanggil API (CORS_ORIGINS is empty)');
    if (origins.some(isLocalOrigin)) warnings.push('CORS_ORIGINS berisi localhost di production (CORS_ORIGINS contains localhost)');
    if (!String(env.PRAKASA_AGENT_API_URL || '').trim()) {
      warnings.push('PRAKASA_AGENT_API_URL belum diisi; Prakasa AI menjawab tanpa akses data (agent tools disabled)');
    }
    // Google sign-in without a domain list accepts ANY verified Google account
    // whose email matches a provisioned user, including a personal Gmail.
    if (String(env.GOOGLE_CLIENT_ID || '').trim() && !String(env.GOOGLE_ALLOWED_DOMAIN || '').trim()) {
      warnings.push('PENTING: GOOGLE_ALLOWED_DOMAIN kosong padahal login Google aktif; akun Google dari domain mana pun bisa dipakai masuk. Isi dengan domain Workspace perusahaan (GOOGLE_ALLOWED_DOMAIN is empty while Google login is configured)');
    }
    // Testing-phase email allowlist left on at go-live: nobody else gets mail.
    if (String(env.EMAIL_TEST_REDIRECT || '').trim()) {
      warnings.push('EMAIL_TEST_REDIRECT masih terisi; SEMUA email dialihkan ke alamat uji. Kosongkan saat go-live (EMAIL_TEST_REDIRECT is set in production)');
    }
    if (String(env.EMAIL_TEST_ALLOWLIST || '').trim()) {
      warnings.push('EMAIL_TEST_ALLOWLIST masih terisi; email hanya terkirim ke alamat uji. Kosongkan saat go-live (EMAIL_TEST_ALLOWLIST is set in production)');
    }
  }

  return { production, errors, warnings };
}

/** Logs the result; in production with errors, exits the process with code 1. */
function validateEnv({ env = process.env, logger = console, exit = (code) => process.exit(code) } = {}) {
  const result = check(env);
  for (const message of result.warnings) logger.warn(`[config] PERINGATAN: ${message}`);
  if (result.errors.length) {
    for (const message of result.errors) logger.error(`[config] ${message}`);
    logger.error('[config] Server tidak dijalankan: perbaiki backend/.env lalu restart (refusing to start in production).');
    exit(1);
  }
  return result;
}

module.exports = { validateEnv, check, PLACEHOLDER_SECRETS, MIN_SECRET_LENGTH };
