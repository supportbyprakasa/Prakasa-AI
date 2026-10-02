const test = require('node:test');
const assert = require('node:assert/strict');
const { check, validateEnv } = require('../src/config/validateEnv');

const GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(48),
  SIGNATURE_ENCRYPTION_KEY: 'b'.repeat(48),
  DB_HOST: 'localhost', DB_USER: 'u', DB_PASS: 'p', DB_NAME: 'n',
  PUBLIC_WEB_URL: 'https://example.test',
  APP_PUBLIC_URL: 'https://example.test',
  CORS_ORIGINS: 'https://example.test',
  PRAKASA_AGENT_API_URL: 'https://api.example.test/api/v1',
};

function silentLogger() {
  const lines = { warn: [], error: [] };
  return { lines, warn: (m) => lines.warn.push(m), error: (m) => lines.error.push(m) };
}

test('a complete production configuration passes without warnings', () => {
  const result = check(GOOD);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('production refuses missing, short or placeholder secrets', () => {
  for (const [name, value] of [
    ['JWT_SECRET', ''],
    ['JWT_SECRET', 'short'],
    ['JWT_SECRET', 'change_me_to_random_32_chars_minimum_xxxxxxxx'],
    ['SIGNATURE_ENCRYPTION_KEY', 'random_32_characters_minimum_xxxxxx'],
    ['SIGNATURE_ENCRYPTION_KEY', '<same value as Node.js App>'],
  ]) {
    const result = check({ ...GOOD, [name]: value });
    assert.equal(result.errors.length, 1, `${name}=${value}`);
    assert.match(result.errors[0], new RegExp(name));
  }
});

test('production refuses missing database settings', () => {
  const result = check({ ...GOOD, DB_HOST: '', DB_NAME: undefined });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /DB_HOST, DB_NAME/);
});

test('error messages never contain the secret value', () => {
  const secret = 'tooShortButSecret';
  const result = check({ ...GOOD, JWT_SECRET: secret });
  assert.ok(result.errors.every((m) => !m.includes(secret)));
});

test('production only warns about URLs, localhost CORS and the agent URL', () => {
  const result = check({
    ...GOOD, PUBLIC_WEB_URL: '', APP_PUBLIC_URL: 'http://example.test', CORS_ORIGINS: 'https://example.test,http://localhost:5173', PRAKASA_AGENT_API_URL: '',
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 4);
});

test('development turns every problem into a warning', () => {
  const result = check({ NODE_ENV: 'development', JWT_SECRET: 'short' });
  assert.equal(result.production, false);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((m) => /JWT_SECRET/.test(m)));
  assert.ok(result.warnings.some((m) => /SIGNATURE_ENCRYPTION_KEY/.test(m)));
  assert.ok(result.warnings.some((m) => /DB_HOST/.test(m)));
});

test('validateEnv exits with code 1 in production with errors, and not otherwise', () => {
  const exits = [];
  const logger = silentLogger();
  validateEnv({ env: { ...GOOD, JWT_SECRET: '' }, logger, exit: (code) => exits.push(code) });
  assert.deepEqual(exits, [1]);
  assert.ok(logger.lines.error.some((m) => /menolak|refusing/i.test(m) || /tidak dijalankan/.test(m)));

  validateEnv({ env: GOOD, logger: silentLogger(), exit: (code) => exits.push(code) });
  validateEnv({ env: { NODE_ENV: 'development' }, logger: silentLogger(), exit: (code) => exits.push(code) });
  assert.deepEqual(exits, [1]);
});

test('production warns loudly (without refusing) when Google login has no domain list', () => {
  const open = check({ ...GOOD, GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_ALLOWED_DOMAIN: '' });
  assert.deepEqual(open.errors, []);
  assert.equal(open.warnings.length, 1);
  assert.match(open.warnings[0], /PENTING: GOOGLE_ALLOWED_DOMAIN kosong/);
  assert.deepEqual(check({ ...GOOD, GOOGLE_CLIENT_ID: 'id', GOOGLE_ALLOWED_DOMAIN: 'prakasagroup.com' }).warnings, []);
  // No Google login configured: nothing to restrict.
  assert.deepEqual(check({ ...GOOD, GOOGLE_ALLOWED_DOMAIN: '' }).warnings, []);
});
