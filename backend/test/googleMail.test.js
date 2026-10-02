const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const mail = require('../src/services/googleMail.service');
const ctrl = require('../src/controllers/googleMail.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    ended: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(data) { this.ended = data; return this; },
  };
}

const user = (overrides = {}) => ({ sub: 14, entityId: 1, email: 'me@prakasafoods.com', permissions: ['google.mail.use'], ...overrides });
const failNext = (e) => { throw e; };
const scopeError = () => Object.assign(new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.'), { code: 401, status: 401 });

// Decodes the parts of a raw MIME message for assertions.
function parseRaw(raw) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  const boundary = /boundary="([^"]+)"/.exec(head)[1];
  const parts = body.split(`--${boundary}`).slice(1, -1).map((chunk) => {
    const [partHead, partBody] = chunk.trim().split('\r\n\r\n');
    return { head: partHead, text: Buffer.from(partBody.replace(/\r\n/g, ''), 'base64').toString('utf8') };
  });
  return { head, parts, boundary };
}

function decodeEncodedWords(value) {
  return value.split(/\r\n /).map((word) => {
    const m = /^=\?UTF-8\?B\?([^?]+)\?=$/.exec(word);
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : word;
  }).join('');
}

test.beforeEach((t) => {
  t.mock.method(pool, 'query', async () => [[]]); // activity/integration logs
});

// ---------------------------------------------------------------- MIME builder

test('MIME: headers, recipients and a multipart/alternative text + HTML body', () => {
  const raw = mail.buildRawMessage({
    to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], bcc: ['d@x.com'],
    subject: 'Laporan harian', body: 'Halo tim,\n<b>bukan tag</b>\n> kutipan',
  }, { boundary: 'B1', date: new Date('2026-09-28T03:04:05Z') });
  const { head, parts } = parseRaw(raw);

  assert.match(head, /^To: a@x\.com, b@x\.com$/m);
  assert.match(head, /^Cc: c@x\.com$/m);
  assert.match(head, /^Bcc: d@x\.com$/m);
  assert.match(head, /^Subject: Laporan harian$/m);
  assert.match(head, /^Date: Mon, 28 Sep 2026 03:04:05 \+0000$/m);
  assert.match(head, /^MIME-Version: 1\.0$/m);
  assert.match(head, /^Content-Type: multipart\/alternative; boundary="B1"$/m);
  assert.doesNotMatch(head, /In-Reply-To|References/);

  assert.equal(parts.length, 2);
  assert.match(parts[0].head, /text\/plain; charset="UTF-8"/);
  assert.match(parts[0].head, /Content-Transfer-Encoding: base64/);
  assert.equal(parts[0].text, 'Halo tim,\r\n<b>bukan tag</b>\r\n> kutipan');
  assert.match(parts[1].head, /text\/html; charset="UTF-8"/);
  assert.match(parts[1].text, /&lt;b&gt;bukan tag&lt;\/b&gt;/, 'user text is escaped in the HTML part');
  assert.match(parts[1].text, /<br>/);
});

test('MIME: a UTF-8 subject is RFC 2047 encoded in words of at most 75 characters', () => {
  const subject = 'Rapat ☕ tim — jadwal minggu depan dengan catatan yang cukup panjang sekali ✅';
  const raw = mail.buildRawMessage({ to: ['a@x.com'], subject, body: 'x' }, { boundary: 'B' });
  const line = /^Subject: ([\s\S]*?)\r\n(?! )/m.exec(raw)[1];
  const words = line.split('\r\n ');
  assert.ok(words.length > 1, 'long subject is folded into several encoded-words');
  words.forEach((word) => {
    assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.ok(word.length <= 75);
  });
  assert.equal(decodeEncodedWords(line), subject);
});

test('MIME: header values cannot inject extra headers', () => {
  const raw = mail.buildRawMessage({ to: ['a@x.com'], subject: 'Hi\r\nBcc: evil@x.com', body: '' }, { boundary: 'B' });
  const head = raw.split('\r\n\r\n')[0];
  assert.doesNotMatch(head, /^Bcc:/m);
});

test('MIME: replies carry In-Reply-To and References for threading', () => {
  const raw = mail.buildRawMessage({
    to: ['a@x.com'], subject: 'Re: Tagihan', body: 'Oke',
    inReplyTo: '<m2@mail.x.com>', references: '<m1@mail.x.com> <m2@mail.x.com>',
  }, { boundary: 'B' });
  assert.match(raw, /^In-Reply-To: <m2@mail\.x\.com>$/m);
  assert.match(raw, /^References: <m1@mail\.x\.com> <m2@mail\.x\.com>$/m);
});

test('base64url raw has no +, / or = padding', () => {
  const encoded = mail.encodeBase64Url('subjek ??? ÿÿÿ >>>');
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.equal(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'), 'subjek ??? ÿÿÿ >>>');
});

// ------------------------------------------------------------- input whitelist

test('ids, labels, part ids and page tokens are strictly validated', () => {
  assert.ok(mail.isValidId('18c2f1a2b3c4d5e6'));
  ['', 'abc', '../etc', "18c2f1'or", 'a'.repeat(41), null].forEach((v) => assert.equal(mail.isValidId(v), false, String(v)));
  assert.ok(mail.isValidLabelId('INBOX'));
  assert.ok(mail.isValidLabelId('Label_12'));
  assert.equal(mail.isValidLabelId('Label 12'), false);
  assert.ok(mail.isValidPartId('1.2'));
  assert.equal(mail.isValidPartId('1..2'), false);
  assert.ok(mail.isValidPageToken('09876543210'));
  assert.equal(mail.isValidPageToken('a b'), false);
  assert.equal(mail.clampPageSize('500'), mail.PAGE_SIZE.max);
  assert.equal(mail.clampPageSize('0'), 1);
  assert.equal(mail.clampPageSize(undefined), mail.PAGE_SIZE.default);
  assert.equal(mail.sanitizeQuery('from:a\n is:unread\u0000'), 'from:a  is:unread');
});

// ----------------------------------------------------------- payload parsing

test('parseMessage extracts headers, both bodies, attachments and flags', () => {
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
  const parsed = mail.parseMessage({
    id: 'aaaaaaaa1', threadId: 'tttttttt1', labelIds: ['INBOX', 'UNREAD'], internalDate: '1790000000000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Budi <budi@x.com>' }, { name: 'To', value: 'me@x.com' },
        { name: 'Subject', value: 'Halo' }, { name: 'Message-ID', value: '<m1@x.com>' },
      ],
      parts: [
        { partId: '0', mimeType: 'multipart/alternative', body: { size: 0 }, parts: [
          { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64('teks ✓') } },
          { partId: '0.1', mimeType: 'text/html', headers: [], body: { data: b64('<p>html</p>') } },
        ] },
        { partId: '1', mimeType: 'application/pdf', filename: 'faktur.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { attachmentId: 'ATT', size: 1234 } },
      ],
    },
  });
  assert.equal(parsed.from, 'Budi <budi@x.com>');
  assert.equal(parsed.messageId, '<m1@x.com>');
  assert.equal(parsed.text, 'teks ✓');
  assert.equal(parsed.html, '<p>html</p>');
  assert.equal(parsed.unread, true);
  assert.deepEqual(parsed.attachments, [{ partId: '1', filename: 'faktur.pdf', mimeType: 'application/pdf', size: 1234 }]);
});

// --------------------------------------------------------- controller mapping

test('listThreads passes whitelisted params for the caller\'s own mailbox', async (t) => {
  let seen = null;
  t.mock.method(mail, 'listThreads', async (subject, opts) => { seen = { subject, opts }; return { threads: [{ id: 't1' }], nextPageToken: 'n2' }; });
  const res = responseDouble();
  await ctrl.listThreads({ user: user(), query: { labelId: 'INBOX', q: 'is:unread\n', pageToken: '123', maxResults: '999' } }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.deepEqual(seen.opts, { labelId: 'INBOX', q: 'is:unread', pageToken: '123', maxResults: 50 });
  assert.equal(res.body.data.nextPageToken, 'n2');
});

test('listThreads rejects a bad label, page token or over-long query before calling Google', async (t) => {
  t.mock.method(mail, 'listThreads', async () => { throw new Error('must not be called'); });
  for (const query of [{ labelId: 'IN BOX' }, { pageToken: '<script>' }, { q: 'x'.repeat(201) }]) {
    const res = responseDouble();
    await ctrl.listThreads({ user: user(), query }, res, failNext);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('getThread validates the id and returns the parsed thread', async (t) => {
  t.mock.method(mail, 'getThread', async (subject, id) => ({ id, messages: [] }));
  const bad = responseDouble();
  await ctrl.getThread({ user: user(), params: { threadId: '../../x' } }, bad, failNext);
  assert.equal(bad.statusCode, 400);

  const res = responseDouble();
  await ctrl.getThread({ user: user(), params: { threadId: '18c2f1a2b3c4d5e6' } }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.id, '18c2f1a2b3c4d5e6');
});

test('threadAction only accepts known actions and maps them to label changes', async (t) => {
  const calls = [];
  t.mock.method(mail, 'modifyThread', async (subject, id, action) => { calls.push({ subject, id, action }); return { id, action }; });
  const res = responseDouble();
  await ctrl.threadAction({ user: user(), params: { threadId: '18c2f1a2b3c4d5e6' }, body: { action: 'archive' } }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0], { subject: 'me@prakasafoods.com', id: '18c2f1a2b3c4d5e6', action: 'archive' });
  assert.deepEqual(mail.THREAD_ACTIONS.archive, { removeLabelIds: ['INBOX'] });
  assert.deepEqual(mail.THREAD_ACTIONS.read, { removeLabelIds: ['UNREAD'] });
  assert.deepEqual(mail.THREAD_ACTIONS.star, { addLabelIds: ['STARRED'] });

  for (const action of ['delete', '__proto__', 'constructor']) {
    const r = responseDouble();
    await ctrl.threadAction({ user: user(), params: { threadId: '18c2f1a2b3c4d5e6' }, body: { action } }, r, failNext);
    assert.equal(r.statusCode, 400, action);
  }
  assert.equal(calls.length, 1);
});

test('send validates recipients, never trusts a client-chosen sender, and returns 201', async (t) => {
  let seen = null;
  t.mock.method(mail, 'sendMessage', async (subject, message) => { seen = { subject, message }; return { id: 'm9', threadId: 't9' }; });
  const res = responseDouble();
  await ctrl.sendMessage({
    user: user(),
    body: {
      from: 'ceo@prakasafoods.com', to: ['A@x.com', 'a@x.com'], cc: [], bcc: ['b@x.com'], subject: 'Re: Halo', body: 'Oke',
      threadId: '18c2f1a2b3c4d5e6', inReplyTo: '<m2@x.com>', references: '<m1@x.com> <m2@x.com>',
    },
  }, res, failNext);
  assert.equal(res.statusCode, 201);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.deepEqual(seen.message.to, ['a@x.com']);
  assert.equal(seen.message.from, undefined);
  assert.equal(seen.message.references, '<m1@x.com> <m2@x.com>');
});

test('send rejects bad addresses, no recipients and forged threading headers', async (t) => {
  t.mock.method(mail, 'sendMessage', async () => { throw new Error('must not be called'); });
  const bodies = [
    { to: ['not-an-email'] },
    { to: [] },
    { to: 'a@x.com' },
    { to: ['a@x.com'], inReplyTo: 'm1@x.com\r\nBcc: e@x.com' },
    { to: ['a@x.com'], references: '<ok@x.com> bad' },
    { to: ['a@x.com'], threadId: 'nope nope' },
  ];
  for (const body of bodies) {
    const res = responseDouble();
    await ctrl.sendMessage({ user: user(), body }, res, failNext);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('drafts go through createDraft (gmail.compose), not send', async (t) => {
  let drafted = false;
  t.mock.method(mail, 'createDraft', async () => { drafted = true; return { id: 'r1' }; });
  t.mock.method(mail, 'sendMessage', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.createDraft({ user: user(), body: { to: ['a@x.com'], subject: 'x', body: 'y' } }, res, failNext);
  assert.equal(res.statusCode, 201);
  assert.ok(drafted);
});

test('a missing gmail.modify grant becomes GOOGLE_SCOPE_NOT_GRANTED (503), never a 401', async (t) => {
  t.mock.method(mail, 'listLabels', async () => { throw scopeError(); });
  t.mock.method(mail, 'listThreads', async () => { throw scopeError(); });
  for (const [handler, req] of [[ctrl.listLabels, { user: user() }], [ctrl.listThreads, { user: user(), query: {} }]]) {
    const res = responseDouble();
    await handler(req, res, failNext);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
    assert.match(res.body.error.message, /Gmail/);
  }
});

test('attachment download streams bytes with a safe type and sanitized filename', async (t) => {
  t.mock.method(mail, 'getAttachment', async () => ({ filename: '../../"evil"\r\nname ✓.pdf', mimeType: 'application/pdf', data: Buffer.from('PDF') }));
  const res = responseDouble();
  await ctrl.downloadAttachment({ user: user(), params: { messageId: '18c2f1a2b3c4d5e6', partId: '1' } }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const disposition = res.headers['content-disposition'];
  assert.match(disposition, /^attachment; filename="[^"\r\n/\\]+"; filename\*=UTF-8''/);
  assert.doesNotMatch(disposition, /[\r\n]|\.\.\//);
  assert.equal(res.ended.toString(), 'PDF');

  t.mock.method(mail, 'getAttachment', async () => ({ filename: 'x.html', mimeType: 'text/html; charset=x"', data: Buffer.from('') }));
  const res2 = responseDouble();
  await ctrl.downloadAttachment({ user: user(), params: { messageId: '18c2f1a2b3c4d5e6', partId: '2' } }, res2, failNext);
  assert.equal(res2.headers['content-type'], 'application/octet-stream');

  const bad = responseDouble();
  await ctrl.downloadAttachment({ user: user(), params: { messageId: '18c2f1a2b3c4d5e6', partId: '1/../2' } }, bad, failNext);
  assert.equal(bad.statusCode, 400);
});

// ------------------------------------------------ service → Gmail API (mocked)

function fakeGmail(t) {
  const { google } = require('googleapis');
  const calls = [];
  const rec = (name, result = {}) => async (args) => { calls.push({ name, args }); return { data: result }; };
  const client = {
    users: {
      messages: { send: rec('messages.send', { id: 'm1', threadId: 't1' }) },
      drafts: { create: rec('drafts.create', { id: 'r1', message: { id: 'm2', threadId: 't1' } }) },
      threads: {
        modify: rec('threads.modify'), trash: rec('threads.trash'), untrash: rec('threads.untrash'),
        list: rec('threads.list', { threads: [], nextPageToken: null }),
      },
    },
  };
  t.mock.method(google, 'gmail', (opts) => { calls.push({ name: 'client', scopes: opts.auth.scopes, subject: opts.auth.subject }); return client; });
  return calls;
}

test('service: send uses only the gmail.send scope as the caller and keeps the thread', async (t) => {
  const calls = fakeGmail(t);
  await mail.sendMessage('me@prakasafoods.com', { to: ['a@x.com'], cc: [], bcc: [], subject: 'Re: x', body: 'y', threadId: '18c2f1a2b3c4d5e6' });
  assert.deepEqual(calls[0].scopes, [mail.SCOPES.send]);
  assert.equal(calls[0].subject, 'me@prakasafoods.com');
  assert.equal(calls[1].args.requestBody.threadId, '18c2f1a2b3c4d5e6');
  assert.match(calls[1].args.requestBody.raw, /^[A-Za-z0-9_-]+$/);
});

test('service: drafts use gmail.compose; label actions and trash use gmail.modify', async (t) => {
  const calls = fakeGmail(t);
  await mail.createDraft('me@prakasafoods.com', { to: ['a@x.com'], cc: [], bcc: [], subject: 'x', body: 'y' });
  assert.deepEqual(calls[0].scopes, [mail.SCOPES.compose]);
  assert.equal(calls[1].name, 'drafts.create');

  await mail.modifyThread('me@prakasafoods.com', '18c2f1a2b3c4d5e6', 'archive');
  await mail.modifyThread('me@prakasafoods.com', '18c2f1a2b3c4d5e6', 'trash');
  const modify = calls.find((c) => c.name === 'threads.modify');
  assert.deepEqual(modify.args.requestBody, { removeLabelIds: ['INBOX'] });
  assert.ok(calls.some((c) => c.name === 'threads.trash'));
  assert.ok(calls.filter((c) => c.name === 'client').slice(1).every((c) => c.scopes[0] === mail.SCOPES.modify));
  await assert.rejects(mail.modifyThread('me@prakasafoods.com', '18c2f1a2b3c4d5e6', 'delete'));
});

test('service: listing Spam or Trash includes spam/trash results; page size is capped', async (t) => {
  const calls = fakeGmail(t);
  await mail.listThreads('me@prakasafoods.com', { labelId: 'TRASH', maxResults: 999 });
  const list = calls.find((c) => c.name === 'threads.list').args;
  assert.equal(list.includeSpamTrash, true);
  assert.deepEqual(list.labelIds, ['TRASH']);
  assert.equal(list.maxResults, mail.PAGE_SIZE.max);
});
