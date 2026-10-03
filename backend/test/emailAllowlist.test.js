const test = require('node:test');
const assert = require('node:assert/strict');
const gmail = require('../src/services/gmail.service');

// Testing phase: every app email is redirected to EMAIL_TEST_REDIRECT (or
// limited to EMAIL_TEST_ALLOWLIST); outside production with neither set,
// nothing is sent; reserved test domains never get mail.

function withEnv(t, values) {
  const keys = ['EMAIL_TEST_ALLOWLIST', 'EMAIL_TEST_REDIRECT', 'NODE_ENV'];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (values[k] === undefined) delete process.env[k]; else process.env[k] = values[k]; }
  t.after(() => { for (const k of keys) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } });
}

test('with a redirect every email goes to that one address and names the real recipient', (t) => {
  withEnv(t, { EMAIL_TEST_REDIRECT: 'support@prakasagroup.com', NODE_ENV: 'test' });
  assert.deepEqual(gmail.route({ to: 'head.sales@prakasafoods.com', subject: 'Approval' }), {
    to: 'support@prakasagroup.com', subject: '[UJI untuk head.sales@prakasafoods.com] Approval',
  });
  assert.equal(gmail.route({ to: '', subject: 'x' }), null);
});

test('the redirect wins over the allowlist', (t) => {
  withEnv(t, { EMAIL_TEST_REDIRECT: 'support@prakasagroup.com', EMAIL_TEST_ALLOWLIST: 'mwahyudi@prakasafoods.com', NODE_ENV: 'test' });
  assert.equal(gmail.route({ to: 'mwahyudi@prakasafoods.com', subject: 'x' }).to, 'support@prakasagroup.com');
});

test('with only an allowlist, only the listed address receives mail', async (t) => {
  withEnv(t, { EMAIL_TEST_ALLOWLIST: 'mwahyudi@prakasafoods.com', NODE_ENV: 'test' });
  assert.deepEqual(gmail.allowedRecipients('MWahyudi@prakasafoods.com'), ['MWahyudi@prakasafoods.com']);
  assert.deepEqual(gmail.allowedRecipients('staf@prakasafoods.com'), []);
  assert.deepEqual(await gmail.sendMail({ to: 'staf@prakasafoods.com', subject: 'x', text: 'y' }), { skipped: true, reason: 'recipient_not_allowed' });
});

test('outside production with nothing configured, no email is sent at all', async (t) => {
  withEnv(t, { NODE_ENV: 'development' });
  assert.equal(gmail.route({ to: 'head.sales@prakasafoods.com', subject: 'x' }), null);
  assert.deepEqual(await gmail.sendMail({ to: 'head.sales@prakasafoods.com', subject: 'x', text: 'y' }), { skipped: true, reason: 'recipient_not_allowed' });
});

test('in production without test settings everyone but reserved test domains receives mail', (t) => {
  withEnv(t, { NODE_ENV: 'production' });
  assert.deepEqual(gmail.allowedRecipients('staf@prakasafoods.com'), ['staf@prakasafoods.com']);
  assert.deepEqual(gmail.allowedRecipients('uji@example.invalid'), []);
});
