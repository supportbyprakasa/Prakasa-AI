import test from 'node:test';
import assert from 'node:assert/strict';
import { composeToFromParam,
  ALL_MAIL,
  SYSTEM_LABELS,
  applyThreadAction,
  buildLabelNav,
  buildMailSrcdoc,
  buildReplyDraft,
  composeFieldError,
  composePayload,
  decodeEntities,
  formatFullDate,
  formatBytes,
  formatListDate,
  hasRemoteImages,
  initials,
  isValidThreadId,
  mailCsp,
  normalizeLabelParam,
  parseAddress,
  parseAddressHeader,
  parseAddressList,
  prefixSubject,
  sanitizeEmailHtml,
  sanitizeQuery,
  senderLabel,
  isScopeMissing,
} from '../src/pages/google/mailModel.js';

test('system folders are the Gmail set, in Gmail order, with Indonesian names', () => {
  assert.deepEqual(SYSTEM_LABELS.map((l) => l.name), ['Kotak masuk', 'Berbintang', 'Terkirim', 'Draf', 'Semua email', 'Spam', 'Sampah']);
  assert.equal(SYSTEM_LABELS.find((l) => l.name === 'Semua email').id, ALL_MAIL);
});

test('label nav merges counts and sorts user labels; works with no API data', () => {
  const empty = buildLabelNav([]);
  assert.equal(empty.system.length, 7);
  assert.ok(empty.system.every((l) => l.count === 0));
  assert.deepEqual(empty.user, []);

  const nav = buildLabelNav([
    { id: 'INBOX', type: 'system', unread: 4, total: 90 },
    { id: 'DRAFT', type: 'system', unread: 0, total: 2 },
    { id: 'STARRED', type: 'system', unread: 3, total: 9 },
    { id: 'Label_2', name: 'Vendor', type: 'user', unread: 1 },
    { id: 'Label_1', name: 'Audit', type: 'user', unread: 0 },
  ]);
  const count = (id) => nav.system.find((l) => l.id === id).count;
  assert.equal(count('INBOX'), 4, 'inbox shows unread');
  assert.equal(count('DRAFT'), 2, 'drafts show the total');
  assert.equal(count('STARRED'), 0, 'starred shows no count, like Gmail');
  assert.deepEqual(nav.user.map((l) => l.name), ['Audit', 'Vendor']);
});

test('URL params are whitelisted', () => {
  assert.equal(normalizeLabelParam('SENT'), 'SENT');
  assert.equal(normalizeLabelParam('../x'), 'INBOX');
  assert.equal(normalizeLabelParam(null), 'INBOX');
  assert.ok(isValidThreadId('18c2f1a2b3c4d5e6'));
  assert.equal(isValidThreadId('18c2f1a2<b>'), false);
  assert.equal(sanitizeQuery(`a\nb${'x'.repeat(300)}`).length, 200);
});

test('address parsing handles names, quotes with commas and bare emails', () => {
  assert.deepEqual(parseAddress('Budi Santoso <budi@x.com>'), { name: 'Budi Santoso', email: 'budi@x.com' });
  assert.deepEqual(parseAddress('budi@x.com'), { name: '', email: 'budi@x.com' });
  assert.deepEqual(parseAddressHeader('"Sari, HR" <sari@x.com>, andi@x.com').map((a) => a.email), ['sari@x.com', 'andi@x.com']);
  assert.equal(parseAddressHeader('"Sari, HR" <sari@x.com>')[0].name, 'Sari, HR');
});

test('compose address lists: split on , or ;, de-duplicate, report invalid tokens', () => {
  const { valid, invalid } = parseAddressList('a@x.com; B <b@x.com>, A@x.com, bukan-email, ');
  assert.deepEqual(valid, ['a@x.com', 'b@x.com']);
  assert.deepEqual(invalid, ['bukan-email']);
});

test('composePayload validates recipients and keeps threading fields', () => {
  assert.equal(composePayload({ to: '', cc: '', bcc: '' }).errors.to, 'Isi minimal satu penerima');
  assert.match(composePayload({ to: 'x@', cc: '', bcc: '' }).errors.to, /tidak valid/);
  assert.ok(composePayload({ to: '', cc: '', bcc: 'z@x.com' }).payload, 'bcc alone is a valid recipient');
  const { payload } = composePayload({
    to: 'a@x.com', cc: '', bcc: '', subject: 'Re: x', body: 'y',
    threadId: 't123456', inReplyTo: '<m@x>', references: '<m@x>',
  });
  assert.deepEqual(payload, { to: ['a@x.com'], cc: [], bcc: [], subject: 'Re: x', body: 'y', threadId: 't123456', inReplyTo: '<m@x>', references: '<m@x>' });
});

test('list dates: time today, day + month this year, full date before', () => {
  const now = new Date(2026, 8, 28, 16, 0);
  assert.equal(formatListDate(new Date(2026, 8, 28, 9, 5).toISOString(), now), '09.05');
  assert.equal(formatListDate(new Date(2026, 1, 3, 9, 5).toISOString(), now), '3 Feb');
  assert.equal(formatListDate(new Date(2025, 11, 31, 9, 5).toISOString(), now), '31/12/2025');
  assert.equal(formatListDate(null, now), '');
  assert.equal(formatListDate('not a date', now), '');
});

test('small display helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1572864), '1,5 MB');
  assert.equal(initials('Budi Santoso'), 'BS');
  assert.equal(initials('sari@x.com'), 'S');
  assert.equal(decodeEntities('Don&#39;t &amp; &lt;b&gt;'), "Don't & <b>");
  assert.equal(senderLabel('Me <me@x.com>', 'ME@x.com'), 'saya');
  assert.equal(senderLabel('Budi <budi@x.com>', 'me@x.com'), 'Budi');
});

const original = {
  id: 'm2', threadId: 't123456',
  from: 'Budi <budi@x.com>', to: 'me@x.com, Sari <sari@x.com>', cc: 'andi@x.com, me@x.com',
  subject: 'Tagihan September', date: new Date(2026, 8, 27, 10, 30).toISOString(),
  messageId: '<m2@mail.x.com>', references: '<m1@mail.x.com>',
  text: 'Mohon dicek.\nTerima kasih',
};

test('reply goes to the sender only, quotes the text and threads correctly', () => {
  const draft = buildReplyDraft(original, 'reply', 'me@x.com');
  assert.equal(draft.to, 'budi@x.com');
  assert.equal(draft.cc, '');
  assert.equal(draft.subject, 'Re: Tagihan September');
  assert.equal(draft.threadId, 't123456');
  assert.equal(draft.inReplyTo, '<m2@mail.x.com>');
  assert.equal(draft.references, '<m1@mail.x.com> <m2@mail.x.com>');
  assert.match(draft.body, /Budi <budi@x\.com> menulis:\n> Mohon dicek\.\n> Terima kasih$/);
});

test('reply all copies everyone except me and the main recipient', () => {
  const draft = buildReplyDraft(original, 'replyAll', 'me@x.com');
  assert.equal(draft.to, 'budi@x.com');
  assert.equal(draft.cc, 'sari@x.com, andi@x.com');
});

test('replying to my own sent message goes to its original recipients; Reply-To wins', () => {
  const mine = { ...original, from: 'Me <me@x.com>', to: 'budi@x.com', cc: '' };
  assert.equal(buildReplyDraft(mine, 'reply', 'me@x.com').to, 'budi@x.com');
  const withReplyTo = { ...original, replyTo: 'billing@x.com' };
  assert.equal(buildReplyDraft(withReplyTo, 'reply', 'me@x.com').to, 'billing@x.com');
});

test('subjects are not prefixed twice', () => {
  assert.equal(prefixSubject('Re: Halo', 'Re'), 'Re: Halo');
  assert.equal(prefixSubject('RE:Halo', 'Re'), 'RE:Halo');
  assert.equal(prefixSubject('Fwd: Halo', 'Fwd'), 'Fwd: Halo');
  assert.equal(prefixSubject('', 'Re'), 'Re:');
});

test('forward starts empty with the original headers and body below', () => {
  const draft = buildReplyDraft({ ...original, text: '', html: '<p>Isi <b>HTML</b></p><script>x</script>' }, 'forward', 'me@x.com');
  assert.equal(draft.to, '');
  assert.equal(draft.subject, 'Fwd: Tagihan September');
  assert.equal(draft.inReplyTo, null);
  assert.match(draft.body, /---------- Pesan terusan ----------\nDari: Budi <budi@x\.com>/);
  assert.match(draft.body, /Isi HTML$/);
});

test('email HTML: dangerous tags, handlers and javascript: URLs are removed', () => {
  const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://e"></iframe>'
    + '<meta http-equiv="refresh" content="0;url=https://e"><base href="https://e/"><form action="https://e"><input name=a></form>'
    + '<a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>';
  const clean = sanitizeEmailHtml(dirty);
  assert.doesNotMatch(clean, /<script|<iframe|<meta|<base|<form|<input|onclick|onerror|javascript:/i);
  assert.match(clean, /<a rel="noopener noreferrer" target="_blank"/);
});

test('srcdoc carries a CSP that blocks remote content until images are allowed', () => {
  const doc = buildMailSrcdoc('<img src="https://tracker.example/p.gif">');
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:;/);
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<body>'), 'CSP comes before any email content');
  assert.doesNotMatch(mailCsp(false), /https:/);
  assert.match(mailCsp(true), /img-src data: cid: https:/);
  assert.doesNotMatch(mailCsp(true), /script-src|connect-src|frame-src/);
});

test('remote image detection', () => {
  assert.equal(hasRemoteImages('<img src="https://a/b.png">'), true);
  assert.equal(hasRemoteImages('<div style="background:url(\'http://a/b.png\')">'), true);
  assert.equal(hasRemoteImages('<img src="data:image/png;base64,AAA">'), false);
  assert.equal(hasRemoteImages('<p>no images</p>'), false);
});

test('thread actions update the list optimistically', () => {
  const threads = [{ id: 'a', unread: true, starred: false }, { id: 'b', unread: false, starred: true }];
  assert.deepEqual(applyThreadAction(threads, 'a', 'archive', 'INBOX').map((t) => t.id), ['b']);
  assert.equal(applyThreadAction(threads, 'a', 'archive', ALL_MAIL).length, 2, 'archive keeps it in Semua email');
  assert.deepEqual(applyThreadAction(threads, 'a', 'trash', 'INBOX').map((t) => t.id), ['b']);
  assert.equal(applyThreadAction(threads, 'a', 'read', 'INBOX')[0].unread, false);
  assert.equal(applyThreadAction(threads, 'a', 'star', 'INBOX')[0].starred, true);
  assert.deepEqual(applyThreadAction(threads, 'b', 'unstar', 'STARRED').map((t) => t.id), ['a']);
});

test('the missing read scope is recognised from the API error', () => {
  assert.equal(isScopeMissing({ response: { data: { error: { code: 'GOOGLE_SCOPE_NOT_GRANTED' } } } }), true);
  assert.equal(isScopeMissing({ response: { data: { error: { code: 'NOT_FOUND' } } } }), false);
  assert.equal(isScopeMissing(new Error('network')), false);
});

test('compose deep link keeps only well-formed recipient addresses', () => {
  assert.equal(composeToFromParam('to:finance@prakasafoods.com'), 'finance@prakasafoods.com');
  assert.equal(composeToFromParam('to:a@x.com, bad, <b@y.com>'), 'a@x.com');
  assert.equal(composeToFromParam('subject:hi'), '');
});

test('full dates use the app date-time format', () => {
  assert.equal(formatFullDate(new Date(2026, 8, 30, 14, 5).toISOString()), '30 Sep 2026, 14.05');
  assert.equal(formatFullDate(''), '');
  assert.equal(formatFullDate('not a date'), '');
});

test('a rejected compose lands on the field it is about', () => {
  const invalid = (message) => ({ response: { data: { error: { code: 'VALIDATION_ERROR', message } } } });
  assert.deepEqual(composeFieldError(invalid('Subjek terlalu panjang')), { field: 'subject', message: 'Subjek terlalu panjang' });
  assert.deepEqual(composeFieldError(invalid('Isi email terlalu panjang')), { field: 'body', message: 'Isi email terlalu panjang' });
  assert.deepEqual(composeFieldError(invalid('Alamat email tidak valid: x')), { field: 'to', message: 'Alamat email tidak valid: x' });
  assert.equal(composeFieldError({ response: { data: { error: { code: 'GOOGLE_API_ERROR', message: 'Gagal' } } } }), null);
  assert.equal(composeFieldError(new Error('network')), null);
  const payload = { to: ['a@x.com'], cc: ['c@x.com'], bcc: ['b@x.com'] };
  assert.deepEqual(composeFieldError(invalid('Alamat email tidak valid: c@x.com'), payload), { field: 'cc', message: 'Alamat email tidak valid: c@x.com' });
  assert.deepEqual(composeFieldError(invalid('Alamat email tidak valid: b@x.com'), payload), { field: 'bcc', message: 'Alamat email tidak valid: b@x.com' });
  assert.deepEqual(composeFieldError(invalid('Daftar penerima (bcc) tidak valid')), { field: 'bcc', message: 'Daftar penerima (bcc) tidak valid' });
  assert.deepEqual(composeFieldError(invalid('Isi minimal satu penerima')), { field: 'to', message: 'Isi minimal satu penerima' });
  // Reply headers and unknown rejections go to a snackbar, never onto a field.
  assert.equal(composeFieldError(invalid('Header balasan tidak valid')), null);
  assert.equal(composeFieldError(invalid('ID percakapan tidak valid')), null);
  assert.equal(composeFieldError(invalid('Sesuatu yang lain')), null);
});
