const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedOrigins } = require('../src/utils/corsOrigins');

test('allows production web origin and the current design preview', () => {
  const origins = allowedOrigins('https://prakasa-work-os.com');
  assert.equal(origins.has('https://prakasa-ai-web.vercel.app'), true);
  assert.equal(origins.has('https://prakasa-ai-web-git-feat-full-design-revamp-support-prakasa.vercel.app'), true);
  assert.equal(origins.has('https://prakasa-ai-git-feat-full-design-revamp-support-prakasa.vercel.app'), true);
  assert.equal(origins.has('https://prakasa-work-os.com'), true);
});

test('does not allow arbitrary Vercel origins or lookalike domains', () => {
  const origins = allowedOrigins();
  assert.equal(origins.has('https://another-site.vercel.app'), false);
  assert.equal(origins.has('https://prakasa-ai-web.vercel.app.evil.test'), false);
  assert.equal(origins.has('http://prakasa-ai-web.vercel.app'), false);
});
