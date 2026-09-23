const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDbConnectionConfig,
  normalizeCa,
} = require('../src/db/connectionConfig');

function env(overrides = {}) {
  return {
    DB_HOST: 'db.example.test',
    DB_USER: 'prakasa',
    DB_PASS: 'secret-value',
    DB_NAME: 'prakasa_stage',
    ...overrides,
  };
}

test('defaults to port 3306 and omits ssl', () => {
  const config = buildDbConnectionConfig(env());
  assert.equal(config.port, 3306);
  assert.equal(config.host, 'db.example.test');
  assert.equal(config.user, 'prakasa');
  assert.equal(config.password, 'secret-value');
  assert.equal(config.database, 'prakasa_stage');
  assert.equal('ssl' in config, false);
});

test('accepts explicit non-default port', () => {
  const config = buildDbConnectionConfig(env({ DB_PORT: '4000' }));
  assert.equal(config.port, 4000);
});

test('required mode enables verified TLS without custom CA', () => {
  const config = buildDbConnectionConfig(env({ DB_SSL_MODE: 'required' }));
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('verify-ca requires and normalizes DB_SSL_CA', () => {
  const ca = '-----BEGIN CERTIFICATE-----\\nABC123\\n-----END CERTIFICATE-----\\n';
  const config = buildDbConnectionConfig(env({
    DB_SSL_MODE: 'verify-ca',
    DB_SSL_CA: ca,
  }));
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(
    config.ssl.ca,
    '-----BEGIN CERTIFICATE-----\nABC123\n-----END CERTIFICATE-----\n'
  );
});

test('normalizeCa converts literal newline escapes only', () => {
  assert.equal(normalizeCa('a\\nb\n'), 'a\nb\n');
});

test('rejects invalid ports without exposing credentials', () => {
  for (const port of ['0', '65536', '1.5', 'abc', '-1']) {
    assert.throws(
      () => buildDbConnectionConfig(env({ DB_PORT: port })),
      (error) => {
        assert.equal(error.code, 'DB_CONFIG_INVALID');
        assert.match(error.message, /DB_PORT/);
        assert.doesNotMatch(error.message, /secret-value/);
        return true;
      }
    );
  }
});

test('rejects unknown SSL mode', () => {
  assert.throws(
    () => buildDbConnectionConfig(env({ DB_SSL_MODE: 'prefer' })),
    /DB_SSL_MODE/
  );
});

test('rejects verify-ca without CA', () => {
  assert.throws(
    () => buildDbConnectionConfig(env({ DB_SSL_MODE: 'verify-ca' })),
    /DB_SSL_CA/
  );
});

test('rejects CA when SSL mode does not consume it', () => {
  for (const mode of ['disabled', 'required']) {
    assert.throws(
      () => buildDbConnectionConfig(env({
        DB_SSL_MODE: mode,
        DB_SSL_CA: 'unused-ca',
      })),
      /DB_SSL_CA/
    );
  }
});
