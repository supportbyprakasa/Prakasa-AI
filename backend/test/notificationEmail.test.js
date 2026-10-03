const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const gmail = require('../src/services/gmail.service');
const notif = require('../src/services/notification.service');
const { EVENTS, policyFor } = require('../src/config/notificationPolicy');

// Notification policy (owner, 1 Oct 2026): in the app for your own work,
// email only when someone must decide/act; an admin rule per event wins.

function baseArgs(overrides = {}) {
  return {
    userId: 10, entityId: 1, title: 'Approval menunggu Anda', body: 'Pengajuan pembayaran PR-202610-0001',
    event: 'approval.step_activated', subjectType: 'approval_request', subjectId: 5, actionUrl: '/data-accurate/5',
    ...overrides,
  };
}

// rule: undefined = no admin rule, 1 = rule on, 0 = rule off.
function mockQueries(t, { rule } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    calls.push(s);
    if (s.includes('FROM entities')) return [[{ id: 1 }]];
    if (s.includes('FROM users') && s.includes('entity_id=?')) return [[{ id: 10 }]];
    if (s.startsWith('INSERT INTO notifications')) return [{ insertId: 77, affectedRows: 1 }];
    if (s.includes("channel='google_chat'")) return [[]];
    if (s.includes("channel = 'email'")) return [rule === undefined ? [] : [{ is_active: rule }]];
    if (s.includes('SELECT email FROM users')) return [[{ email: 'atasan@prakasagroup.com' }]];
    throw new Error(`Unexpected query: ${s}`);
  });
  return calls;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test.beforeEach(() => { process.env.GOOGLE_GMAIL_SENDER = 'workspace@prakasagroup.com'; process.env.APP_PUBLIC_URL = 'https://workspace.prakasagroup.com'; });

test('a decision event emails by default, with a link into the app', async (t) => {
  mockQueries(t);
  const sent = [];
  t.mock.method(gmail, 'sendMail', async (m) => { sent.push(m); return { id: 'msg1' }; });
  assert.equal(await notif.create(baseArgs()), 77);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'atasan@prakasagroup.com');
  assert.match(sent[0].subject, /^\[Prakasa Workspace\] Approval menunggu Anda/);
  assert.match(sent[0].text, /https:\/\/workspace\.prakasagroup\.com\/data-accurate\/5/);
});

test('an informational event stays in the app; an admin rule can switch email on or off', async (t) => {
  let sent = 0;
  t.mock.method(gmail, 'sendMail', async () => { sent += 1; return {}; });
  mockQueries(t);
  await notif.create(baseArgs({ event: 'it_ticket.status_changed' }));
  await settle();
  assert.equal(sent, 0, 'status updates are in-app only');
  pool.query.mock.restore();
  mockQueries(t, { rule: 1 });
  await notif.create(baseArgs({ event: 'it_ticket.status_changed' }));
  await settle();
  assert.equal(sent, 1, 'admin switched it on');
  pool.query.mock.restore();
  mockQueries(t, { rule: 0 });
  await notif.create(baseArgs());
  await settle();
  assert.equal(sent, 1, 'admin switched an approval email off');
});

test('small board edits do not notify at all', async (t) => {
  const calls = mockQueries(t);
  assert.equal(await notif.create(baseArgs({ event: 'task.moved' })), null);
  assert.equal(calls.some((c) => c.startsWith('INSERT INTO notifications')), false);
});

test('a Gmail failure or a missing sender never blocks the in-app notification', async (t) => {
  mockQueries(t);
  t.mock.method(gmail, 'sendMail', async () => { throw new Error('gmail.send unavailable'); });
  assert.equal(await notif.create(baseArgs()), 77);
  await settle();
  delete process.env.GOOGLE_GMAIL_SENDER;
  assert.equal(await notif.sendEmail({ entityId: 1, userId: 10, event: 'approval.step_activated', title: 'x', defaultOn: true }), false);
});

test('the policy: every decision/approval event emails; nothing emails without notifying in the app', () => {
  for (const [event, p] of Object.entries(EVENTS)) {
    assert.ok(!(p.email && !p.inApp), event);
    assert.ok(p.why && p.why.length > 3, event);
  }
  for (const e of ['approval.step_activated', 'approval.reminder', 'signature.requested', 'accurate.batch_reminder', 'hrga.last_day_open', 'it.device_return_late']) assert.equal(policyFor(e).email, true, e);
  for (const e of ['task.updated', 'tracker.issue_reordered']) assert.equal(policyFor(e).inApp, false, e);
  assert.deepEqual([policyFor('something.new').inApp, policyFor('something.new').email], [true, false]);
});

test('reserved test domains never receive a real email', () => {
  const { deliverableEmail } = require('../src/services/notification.service');
  for (const e of ['uji.uat@example.invalid', 'a@example.com', 'b@x.test', 'c@sub.example.org']) assert.equal(deliverableEmail(e), false, e);
  for (const e of ['staf@prakasafoods.com', 'b@examples.com']) assert.equal(deliverableEmail(e), true, e);
});
