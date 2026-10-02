const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedOrigins, corsOriginCheck, VERCEL_WEB_ORIGINS } = require('../src/utils/corsOrigins');

const check = (origins, env, origin) => new Promise((resolve) => {
  corsOriginCheck(origins, env)(origin, (error, allowed) => resolve(error ? error.code : allowed));
});

test('allows exactly the configured origins', () => {
  const origins = allowedOrigins('https://prakasa-work-os.com, https://www.prakasa-work-os.com', {});
  assert.equal(origins.has('https://prakasa-work-os.com'), true);
  assert.equal(origins.has('https://www.prakasa-work-os.com'), true);
  assert.equal(origins.size, 2);
});

test('the Vercel previews are allowed only with CORS_ALLOW_VERCEL=1', () => {
  assert.equal(allowedOrigins('', {}).has(VERCEL_WEB_ORIGINS[0]), false);
  const withVercel = allowedOrigins('', { CORS_ALLOW_VERCEL: '1' });
  for (const origin of VERCEL_WEB_ORIGINS) assert.equal(withVercel.has(origin), true);
});

test('does not allow arbitrary Vercel origins or lookalike domains', () => {
  const origins = allowedOrigins('', { CORS_ALLOW_VERCEL: '1' });
  assert.equal(origins.has('https://another-site.vercel.app'), false);
  assert.equal(origins.has('https://prakasa-ai-web.vercel.app.evil.test'), false);
  assert.equal(origins.has('http://prakasa-ai-web.vercel.app'), false);
});

test('any loopback port is accepted in development when localhost is configured', async () => {
  const origins = allowedOrigins('http://localhost:5173', {});
  assert.equal(await check(origins, { NODE_ENV: 'development' }, 'http://localhost:5175'), true);
  assert.equal(await check(origins, { NODE_ENV: 'development' }, 'http://127.0.0.1:4000'), true);
  assert.equal(await check(origins, { NODE_ENV: 'development' }, 'https://evil.test'), 'CORS_ORIGIN_DENIED');
});

test('production never widens loopback origins beyond the exact list', async () => {
  const origins = allowedOrigins('http://localhost:5173,https://prakasa-work-os.com', {});
  const env = { NODE_ENV: 'production' };
  assert.equal(await check(origins, env, 'http://localhost:5173'), true);
  assert.equal(await check(origins, env, 'http://localhost:5175'), 'CORS_ORIGIN_DENIED');
  assert.equal(await check(origins, env, 'https://prakasa-work-os.com'), true);
  assert.equal(await check(origins, env, undefined), true);
});
