const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const gmail = require('../src/services/gmail.service');
const itSupport = require('../src/services/itSupport.service');
const itTicket = require('../src/services/itTicket.service');

// "Butuh bantuan IT": every new ticket also reaches the IT support mailbox,
// whose address IT can change; a mail problem never loses the ticket.

function fakeDb(t, { setting = null, insertId = 77 } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    calls.push({ sql: text, args });
    if (/FROM settings/.test(text)) return [[setting ? { value: JSON.stringify(setting) } : undefined].filter(Boolean)];
    if (/INSERT INTO it_tickets/.test(text)) return [{ insertId }];
    if (/FROM users u LEFT JOIN departments/.test(text)) return [[{ name: 'Budi', email: 'budi@prakasafoods.com', departmentName: 'Warehouse' }]];
    if (/^\s*INSERT/i.test(text)) return [{ insertId: 1 }];
    return [[]];
  });
  return calls;
}

test('the support mailbox defaults to support@prakasagroup.com and IT can change it', async (t) => {
  const before = process.env.IT_SUPPORT_EMAIL;
  delete process.env.IT_SUPPORT_EMAIL;
  try {
    fakeDb(t);
    assert.equal((await itSupport.getSettings(1)).email, 'support@prakasagroup.com');
    pool.query.mock.restore();
    fakeDb(t, { setting: { email: 'helpdesk@prakasagroup.com', sendEmail: true } });
    assert.equal((await itSupport.getSettings(1)).email, 'helpdesk@prakasagroup.com');
    pool.query.mock.restore();
    const calls = fakeDb(t);
    await assert.rejects(itSupport.saveSettings(1, { email: 'bukan email', sendEmail: true }, 5), (e) => e.status === 400);
    await itSupport.saveSettings(1, { email: ' IT@PrakasaGroup.com ', sendEmail: false }, 5);
    const write = calls.find((c) => /INSERT INTO settings/.test(c.sql));
    assert.deepEqual(JSON.parse(write.args[2]), { email: 'it@prakasagroup.com', sendEmail: false, trackerProjectId: null, trackerPostAsUserId: null });
    assert.ok(calls.some((c) => /activity_logs/.test(c.sql) || c.args.includes('it_support.settings_update')), 'the change is logged');
  } finally {
    if (before === undefined) delete process.env.IT_SUPPORT_EMAIL; else process.env.IT_SUPPORT_EMAIL = before;
  }
});

test('a new ticket is emailed to the support mailbox with the requester as Reply-To', async (t) => {
  const before = process.env.GOOGLE_GMAIL_SENDER;
  process.env.GOOGLE_GMAIL_SENDER = 'noreply@prakasagroup.com';
  try {
    fakeDb(t, { setting: { email: 'support@prakasagroup.com', sendEmail: true } });
    const sent = [];
    t.mock.method(gmail, 'sendMail', async (message) => { sent.push(message); return { id: 'm1' }; });
    const result = await itTicket.createTicket({
      entityId: 1, departmentId: 3, requesterId: 9, category: 'network', priority: 'high',
      title: 'Internet putus', description: 'Wifi gudang mati sejak pagi', sourcePage: '/warehouse',
    });
    assert.equal(result.id, 77);
    assert.equal(result.emailed, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'support@prakasagroup.com');
    assert.equal(sent[0].replyTo, 'budi@prakasafoods.com');
    assert.match(sent[0].subject, /^\[Tiket IT #77\] Internet putus$/);
    assert.match(sent[0].text, /Jaringan dan konektivitas/);
    assert.match(sent[0].text, /Halaman  : \/warehouse/);
    assert.match(sent[0].text, /\/it\/tickets\/77/);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_GMAIL_SENDER; else process.env.GOOGLE_GMAIL_SENDER = before;
  }
});

test('mail switched off, not configured, or failing never blocks the ticket', async (t) => {
  const before = process.env.GOOGLE_GMAIL_SENDER;
  try {
    const sent = [];
    t.mock.method(gmail, 'sendMail', async () => { sent.push(1); throw new Error('Gmail down'); });
    process.env.GOOGLE_GMAIL_SENDER = 'noreply@prakasagroup.com';
    fakeDb(t, { setting: { email: 'support@prakasagroup.com', sendEmail: false } });
    let r = await itTicket.createTicket({ entityId: 1, requesterId: 9, category: 'network', title: 'A', description: 'B' });
    assert.equal(r.emailed, false);
    assert.equal(sent.length, 0, 'switched off: nothing sent');
    pool.query.mock.restore();
    fakeDb(t, { setting: { email: 'support@prakasagroup.com', sendEmail: true } });
    r = await itTicket.createTicket({ entityId: 1, requesterId: 9, category: 'network', title: 'A', description: 'B' });
    assert.equal(r.id, 77);
    assert.equal(r.emailed, false, 'a Gmail failure is reported, the ticket stays');
    pool.query.mock.restore();
    delete process.env.GOOGLE_GMAIL_SENDER;
    fakeDb(t, { setting: { email: 'support@prakasagroup.com', sendEmail: true } });
    r = await itTicket.createTicket({ entityId: 1, requesterId: 9, category: 'network', title: 'A', description: 'B' });
    assert.equal(r.emailed, false);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_GMAIL_SENDER; else process.env.GOOGLE_GMAIL_SENDER = before;
  }
});

test('mail headers never carry a line break (no header injection)', () => {
  const raw = gmail.buildRawMessage({ to: 'a@b.com\r\nBcc: x@y.com', subject: 'Hai\r\nBcc: z@y.com', text: 'isi', replyTo: 'c@d.com\nX: 1' });
  const headers = raw.split('\r\n\r\n')[0].split('\r\n');
  assert.equal(headers.some((h) => /^Bcc:/i.test(h) || /^X:/.test(h)), false);
});

test('every role can ask IT for help (it_ticket.create)', () => {
  const { STANDARD_ROLES } = require('../src/config/standardOrganization');
  assert.deepEqual(STANDARD_ROLES.filter((r) => !r.permissions.includes('it_ticket.create')).map((r) => r.key), []);
});
