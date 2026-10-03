const test = require('node:test');
const assert = require('node:assert/strict');
const { handleGoogleError } = require('../src/services/googleUserClient');

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const err = (message, extra = {}) => Object.assign(new Error(message), extra);

test('a Google 401 never reaches the browser as a 401 (it would log the user out)', () => {
  const r = res();
  handleGoogleError(err('Request had invalid authentication credentials', { code: 401, status: 401 }), r, () => { throw new Error('next'); });
  assert.notEqual(r.statusCode, 401);
  assert.equal(r.statusCode, 502);
});

test('missing domain-wide delegation scope is reported as a setup problem', () => {
  const r = res();
  handleGoogleError(err('unauthorized_client: Client is unauthorized'), r, () => {}, { service: 'Gmail' });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
  assert.match(r.body.error.message, /Gmail/);
});

test('a user without a real Google account gets a clear message', () => {
  const r = res();
  handleGoogleError(err('invalid_grant: Invalid email or User ID'), r, () => {});
  assert.equal(r.body.error.code, 'GOOGLE_ACCOUNT_NOT_LINKED');
});

test('a disabled Google Cloud API is reported as such', () => {
  const r = res();
  handleGoogleError(err('Google Analytics Data API has not been used in project 1 before or it is disabled'), r, () => {}, { service: 'Google Analytics' });
  assert.equal(r.body.error.code, 'GOOGLE_API_DISABLED');
});

test('unknown errors go to the normal error handler', () => {
  let passed = null;
  handleGoogleError(err('Something unexpected'), res(), (e) => { passed = e; });
  assert.equal(passed.message, 'Something unexpected');
});

test('network failures reaching Google become a friendly 503, never a raw URL', () => {
  const r = res();
  handleGoogleError(err('request to https://oauth2.googleapis.com/token failed, reason: connect ECONNREFUSED 74.125.24.95:443', { code: 'ECONNREFUSED' }), r, () => { throw new Error('next'); }, { service: 'Google Chat' });
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.error.code, 'GOOGLE_UNREACHABLE');
  assert.doesNotMatch(r.body.error.message, /https?:\/\//);
});
