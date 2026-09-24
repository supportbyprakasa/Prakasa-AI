import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/proxy.js';

test('same-origin login proxy preserves credentials and omits browser origin', async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, init) => {
    upstream = { url: String(url), init };
    return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_CREDENTIALS' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  };

  const headers = {};
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
  const req = {
    method: 'POST',
    url: '/api/proxy?path=v1/auth/login',
    query: { path: 'v1/auth/login' },
    headers: {
      origin: 'https://prakasa-ai-git-feat-full-design-revamp-support-prakasa.vercel.app',
      host: 'prakasa-ai-git-feat-full-design-revamp-support-prakasa.vercel.app',
      cookie: 'vercel-auth=private',
      'content-type': 'application/json',
    },
    body: { email: 'diagnostic@example.com', password: 'test-only' },
  };

  try {
    await handler(req, res);
    assert.equal(upstream.url, 'https://prakasa-ai-api.vercel.app/api/v1/auth/login');
    assert.equal(upstream.init.headers.origin, undefined);
    assert.equal(upstream.init.headers.cookie, undefined);
    assert.equal(upstream.init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(upstream.init.body.toString()), req.body);
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body.toString()).error.code, 'INVALID_CREDENTIALS');
    assert.equal(headers['content-type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
