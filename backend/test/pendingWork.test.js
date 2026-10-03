const test = require('node:test');
const assert = require('node:assert/strict');
const pendingWork = require('../src/utils/pendingWork');

const later = (ms, value, fail = false) => new Promise((resolve, reject) => {
  setTimeout(() => (fail ? reject(new Error(value)) : resolve(value)), ms);
});

test('track returns the same promise and flush waits for it', async () => {
  let done = false;
  const p = later(30, 'x').then((v) => { done = true; return v; });
  assert.equal(pendingWork.track(p), p);
  assert.equal(pendingWork.size(), 1);
  assert.equal(await pendingWork.flush(1000), true);
  assert.equal(done, true);
  assert.equal(pendingWork.size(), 0);
});

test('a rejected background task never makes flush reject', async () => {
  const p = pendingWork.track(later(10, 'boom', true));
  p.catch(() => {});
  assert.equal(await pendingWork.flush(1000), true);
});

test('work started while flushing is waited for too', async () => {
  let second = false;
  pendingWork.track(later(10).then(() => {
    pendingWork.track(later(20).then(() => { second = true; }));
  }));
  await pendingWork.flush(1000);
  assert.equal(second, true);
});

test('flush gives up after the timeout', async () => {
  const slow = later(300);
  pendingWork.track(slow);
  const started = Date.now();
  assert.equal(await pendingWork.flush(30), false);
  assert.ok(Date.now() - started < 250);
  await slow;
});

test('drainAndEnd flushes before closing the pool', async () => {
  const order = [];
  pendingWork.track(later(20).then(() => order.push('email')));
  await pendingWork.drainAndEnd({ end: async () => { order.push('pool.end'); } }, 1000);
  assert.deepEqual(order, ['email', 'pool.end']);
});

test('non-promises pass through untouched', () => {
  assert.equal(pendingWork.track(undefined), undefined);
  assert.equal(pendingWork.track(5), 5);
  assert.equal(pendingWork.size(), 0);
});

test('notification.sendEmail is tracked so a job can wait for it', async (t) => {
  const pool = require('../src/db/pool');
  const gmail = require('../src/services/gmail.service');
  const notif = require('../src/services/notification.service');
  const previous = process.env.GOOGLE_GMAIL_SENDER;
  process.env.GOOGLE_GMAIL_SENDER = 'noreply@example.test';
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_GMAIL_SENDER; else process.env.GOOGLE_GMAIL_SENDER = previous; });
  t.mock.method(pool, 'query', async (sql) => (String(sql).includes('notification_rules') ? [[]] : [[{ email: 'staf@prakasafoods.com' }]]));
  let sent = false;
  t.mock.method(gmail, 'sendMail', async () => { await later(20); sent = true; });
  notif.sendEmail({ entityId: 1, userId: 2, event: 'x', title: 'T', body: 'B', defaultOn: true });
  assert.equal(pendingWork.size(), 1);
  await pendingWork.flush(1000);
  assert.equal(sent, true);
});
