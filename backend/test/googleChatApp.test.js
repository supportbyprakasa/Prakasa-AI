const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const chatUser = require('../src/services/googleChatUser.service');
const ctrl = require('../src/controllers/googleChatApp.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const baseUser = (overrides = {}) => ({ sub: 14, entityId: 1, email: 'user@prakasafoods.com', permissions: [], ...overrides });
const rethrow = (error) => { throw error; };

test.beforeEach((t) => {
  // activityLog / integrationLog writes — irrelevant here.
  t.mock.method(pool, 'query', async () => [[]]);
});

// ---------------------------------------------------------------- validation

test('resource names are validated with strict patterns', () => {
  assert.equal(chatUser.isSpaceId('AAAAbc_12-x'), true);
  for (const bad of ['', 'spaces/AAAA', '../etc', 'AA AA', 'AA%2F', 'a'.repeat(129), null, 42]) {
    assert.equal(chatUser.isSpaceId(bad), false, `space id ${bad}`);
  }
  assert.equal(chatUser.isSpaceName('spaces/AAAAbc'), true);
  assert.equal(chatUser.isSpaceName('spaces/AAAA/messages/x'), false);
  assert.equal(chatUser.isSpaceName('users/123'), false);
  assert.equal(chatUser.isThreadName('spaces/AAAA/threads/t_1-x'), true);
  assert.equal(chatUser.isThreadName('spaces/AAAA/threads/'), false);
  assert.equal(chatUser.isThreadName('spaces/AAAA/threads/a/b'), false);
  assert.equal(chatUser.isMessageName('spaces/AAAA/messages/abc.abc'), true);
  assert.equal(chatUser.isMessageName('spaces/AAAA/messages/abc?x=1'), false);
});

test('page tokens are whitelisted and page sizes are capped', () => {
  assert.equal(chatUser.parsePageToken(undefined), undefined);
  assert.equal(chatUser.parsePageToken(''), undefined);
  assert.equal(chatUser.parsePageToken('Ab-_=+/.9'), 'Ab-_=+/.9');
  assert.equal(chatUser.parsePageToken('<script>'), null);
  assert.equal(chatUser.parsePageToken('a'.repeat(1025)), null);
  assert.equal(chatUser.parsePageToken(['a']), null);
  assert.equal(chatUser.clampPageSize(undefined, { fallback: 50, max: 100 }), 50);
  assert.equal(chatUser.clampPageSize('5000', { fallback: 50, max: 100 }), 100);
  assert.equal(chatUser.clampPageSize('-3', { fallback: 50, max: 100 }), 50);
  assert.equal(chatUser.clampPageSize('20', { fallback: 50, max: 100 }), 20);
});

// ---------------------------------------------------------------- normalizers

test('a DM is named after the other member, never the caller', () => {
  const space = { name: 'spaces/DM1', spaceType: 'DIRECT_MESSAGE', lastActiveTime: '2026-09-28T01:00:00Z' };
  const members = [
    { name: 'users/1', displayName: 'Saya', email: 'User@prakasafoods.com', type: 'HUMAN' },
    { name: 'users/2', displayName: 'Rekan Kerja', email: 'rekan@prakasafoods.com', type: 'HUMAN' },
  ];
  const out = chatUser.normalizeSpace(space, members, new Map(), 'user@prakasafoods.com');
  assert.equal(out.displayName, 'Rekan Kerja');
  assert.equal(out.spaceType, 'DIRECT_MESSAGE');
  assert.equal(out.lastActiveTime, '2026-09-28T01:00:00Z');
});

test('a DM member without a name is resolved from the people map, else is shown as a deleted user', () => {
  const space = { name: 'spaces/DM2', spaceType: 'DIRECT_MESSAGE' };
  const members = [
    { name: 'users/1', displayName: 'Saya', email: 'user@prakasafoods.com' },
    { name: 'users/99' },
  ];
  const people = new Map([['users/99', { displayName: 'Dari Direktori', email: 'dir@prakasafoods.com' }]]);
  assert.equal(chatUser.normalizeSpace(space, members, people, 'user@prakasafoods.com').displayName, 'Dari Direktori');
  const unknown = chatUser.normalizeSpace(space, members, new Map(), 'user@prakasafoods.com');
  assert.equal(unknown.displayName, 'Pengguna dihapus');
  assert.equal(unknown.partnerDeleted, true);
  assert.equal(chatUser.normalizeSpace({ ...space, singleUserBotDm: true }, [], new Map(), 'x@y').displayName, 'Aplikasi Chat');
});

test('a DM is never labelled with the caller\'s own name, even when the caller has another email', async (t) => {
  // The caller's Google id is known (users/1); their member entry resolves to a
  // DIFFERENT email (a second Prakasa account). The partner is anonymised.
  t.mock.method(pool, 'query', async (sql) => (String(sql).includes('google_sub FROM users WHERE LOWER(email)') ? [[{ google_sub: '1' }]] : [[]]));
  await chatUser.ensureMe('owner@prakasafoods.com');
  const space = { name: 'spaces/DM3', spaceType: 'DIRECT_MESSAGE' };
  const members = [
    { name: 'users/1', displayName: 'Muhammad Wahyudi', email: 'owner@prakasagroup.com' },
    { name: 'users/77', isAnonymous: true },
  ];
  const out = chatUser.normalizeSpace(space, members, new Map(), 'owner@prakasafoods.com');
  assert.notEqual(out.displayName, 'Muhammad Wahyudi');
  assert.equal(out.displayName, 'Pengguna dihapus');
});

test('a deleted partner keeps their real name when it was archived before deletion', () => {
  const space = { name: 'spaces/DM4', spaceType: 'DIRECT_MESSAGE' };
  const members = [{ name: 'users/1', displayName: 'Saya', email: 'user@prakasafoods.com' }, { name: 'users/55', isAnonymous: true }];
  const people = new Map([['users/55', { displayName: 'Budi Santoso', email: 'budi@prakasafoods.com', isDeleted: true }]]);
  const out = chatUser.normalizeSpace(space, members, people, 'user@prakasafoods.com');
  assert.equal(out.displayName, 'Budi Santoso');
  // Still marked as a deleted Google account, but with the recovered name.
  assert.equal(out.partnerDeleted, true);
  assert.equal(out.partnerNameRecovered, true);
});

test('a deleted account archived with only an email gets a name from that email', () => {
  assert.equal(chatUser.nameFromEmail('yuliet@prakasafoods.com'), 'Yuliet');
  assert.equal(chatUser.nameFromEmail('budi.santoso_2@prakasafoods.com'), 'Budi Santoso');
  assert.equal(chatUser.nameFromEmail(''), null);
  assert.equal(chatUser.nameFromEmail('123@x.com'), null);
});

test('messages expose only safe attachment links and flag the caller\'s own messages', () => {
  const out = chatUser.normalizeMessage({
    name: 'spaces/S/messages/m1',
    text: 'Halo',
    createTime: '2026-09-28T01:00:00Z',
    sender: { name: 'users/1', displayName: 'Saya', email: 'user@prakasafoods.com', type: 'HUMAN' },
    thread: { name: 'spaces/S/threads/t1' },
    threadReply: true,
    attachment: [
      { contentName: 'Laporan', driveDataRef: { driveFileId: 'abcdefghij12345' } },
      { contentName: 'Gambar', downloadUri: 'https://chat.google.com/api/get_attachment_url?x=1' },
      { contentName: 'Jahat', downloadUri: 'javascript:alert(1)' },
    ],
  }, new Map(), 'user@prakasafoods.com');
  assert.equal(out.sender.isMe, true);
  assert.equal(out.sender.displayName, 'Saya');
  assert.equal('email' in out.sender, false);
  assert.equal(out.threadName, 'spaces/S/threads/t1');
  assert.equal(out.threadReply, true);
  assert.equal(out.attachments[0].url, 'https://drive.google.com/open?id=abcdefghij12345');
  assert.match(out.attachments[1].url, /^https:\/\/chat\.google\.com\//);
  assert.equal(out.attachments[1].downloadable, false);
  assert.equal(out.attachments[2].url, null);
});

// ---------------------------------------------------------------- controller

test('listSpaces impersonates the caller with a capped page size', async (t) => {
  let seen = null;
  t.mock.method(chatUser, 'listSpaces', async (subject, opts) => {
    seen = { subject, opts };
    return { spaces: [{ name: 'spaces/A', displayName: 'Tim', spaceType: 'SPACE' }], nextPageToken: null };
  });
  const req = { user: baseUser(), query: { pageSize: '9999', pageToken: 'tok_1' } };
  const res = responseDouble();
  await ctrl.listSpaces(req, res, rethrow);

  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'user@prakasafoods.com');
  assert.equal(seen.opts.pageSize, 200);
  assert.equal(seen.opts.pageToken, 'tok_1');
  assert.equal(res.body.data.spaces.length, 1);
});

test('listSpaces rejects a malformed page token before calling Google', async (t) => {
  const svc = t.mock.method(chatUser, 'listSpaces', async () => ({ spaces: [] }));
  const res = responseDouble();
  await ctrl.listSpaces({ user: baseUser(), query: { pageToken: 'a b<c>' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
  assert.equal(svc.mock.callCount(), 0);
});

test('listMessages reads the requested space as the caller', async (t) => {
  let seen = null;
  t.mock.method(chatUser, 'listMessages', async (subject, spaceName, opts) => {
    seen = { subject, spaceName, opts };
    return { messages: [{ name: 'spaces/AAAA/messages/m1', text: 'x' }], nextPageToken: 'next' };
  });
  const res = responseDouble();
  await ctrl.listMessages({ user: baseUser(), params: { spaceId: 'AAAA' }, query: {} }, res, rethrow);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA', opts: { pageSize: 50, pageToken: undefined } });
  assert.equal(res.body.data.nextPageToken, 'next');
});

test('listMessages rejects an invalid space id', async (t) => {
  const svc = t.mock.method(chatUser, 'listMessages', async () => ({ messages: [] }));
  for (const spaceId of ['..', 'AA/messages', 'AA AA', '']) {
    const res = responseDouble();
    await ctrl.listMessages({ user: baseUser(), params: { spaceId }, query: {} }, res, rethrow);
    assert.equal(res.statusCode, 400, spaceId);
  }
  assert.equal(svc.mock.callCount(), 0);
});

test('createMessage sends as the caller, logs without the text, and answers 201', async (t) => {
  let seen = null;
  t.mock.method(chatUser, 'createMessage', async (subject, spaceName, body) => {
    seen = { subject, spaceName, body };
    return { name: 'spaces/AAAA/messages/new1', text: body.text, sender: { isMe: true } };
  });
  const queries = [];
  pool.query.mock.mockImplementation(async (sql, params) => { queries.push({ sql, params }); return [[]]; });

  const req = {
    user: baseUser(),
    params: { spaceId: 'AAAA' },
    body: { text: 'Rahasia isi pesan', threadName: 'spaces/AAAA/threads/t1' },
  };
  const res = responseDouble();
  await ctrl.createMessage(req, res, rethrow);

  assert.equal(res.statusCode, 201);
  assert.equal(seen.subject, 'user@prakasafoods.com');
  assert.equal(seen.spaceName, 'spaces/AAAA');
  assert.deepEqual(seen.body, { text: 'Rahasia isi pesan', threadName: 'spaces/AAAA/threads/t1', quoted: undefined });
  assert.equal(res.body.data.name, 'spaces/AAAA/messages/new1');
  const activity = queries.find((q) => /activity/i.test(q.sql));
  assert.ok(activity, 'activity is logged');
  assert.equal(JSON.stringify(activity.params).includes('Rahasia'), false);
});

test('createMessage validates text length, emptiness and thread ownership', async (t) => {
  const svc = t.mock.method(chatUser, 'createMessage', async () => ({ name: 'x' }));
  const cases = [
    { text: '' },
    { text: '   \n ' },
    { text: 42 },
    { text: 'a'.repeat(4097) },
    { text: 'ok', threadName: 'spaces/OTHER/threads/t1' }, // thread of another space
    { text: 'ok', threadName: 'spaces/AAAA/threads/../x' },
  ];
  for (const body of cases) {
    const res = responseDouble();
    await ctrl.createMessage({ user: baseUser(), params: { spaceId: 'AAAA' }, body }, res, rethrow);
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(svc.mock.callCount(), 0);

  const res = responseDouble();
  await ctrl.createMessage({ user: baseUser(), params: { spaceId: 'AAAA' }, body: { text: 'a'.repeat(4096) } }, res, rethrow);
  assert.equal(res.statusCode, 201);
});

test('a Google 401 never reaches the browser as this route\'s own 401', async (t) => {
  t.mock.method(chatUser, 'listSpaces', async () => {
    const error = new Error('Request had invalid authentication credentials.');
    error.status = 401;
    throw error;
  });
  const res = responseDouble();
  await ctrl.listSpaces({ user: baseUser(), query: {} }, res, rethrow);
  assert.notEqual(res.statusCode, 401);
  assert.equal(res.body.error.code, 'GOOGLE_ACCESS_DENIED');
});

test('a missing Chat scope becomes a clear admin-actionable error', async (t) => {
  t.mock.method(chatUser, 'listMessages', async () => {
    throw new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
  });
  const res = responseDouble();
  await ctrl.listMessages({ user: baseUser(), params: { spaceId: 'AAAA' }, query: {} }, res, rethrow);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
});

// ================================================================ extended Chat features

const { PassThrough, Readable } = require('stream');

const req = (overrides = {}) => ({ user: baseUser(), params: {}, query: {}, body: {}, ...overrides });
async function call(handler, request) {
  const res = responseDouble();
  await handler(request, res, rethrow);
  return res;
}
const forbidden = () => Object.assign(new Error('Hanya pengelola'), { appCode: 'FORBIDDEN', appStatus: 403 });

test('mentions: annotated "@Name" ranges become <users/id> tokens with a name map', () => {
  const text = 'Halo @Budi Santoso dan @all, cek ya';
  const { text: out, mentions } = chatUser.withMentionTokens(text, [
    { type: 'USER_MENTION', startIndex: 5, length: 13, userMention: { user: { name: 'users/123', displayName: 'Budi Santoso' } } },
    { type: 'USER_MENTION', startIndex: 23, length: 4, userMention: { user: { name: 'users/all' } } },
    { type: 'RICH_LINK', startIndex: 0, length: 4 },
    { type: 'USER_MENTION', startIndex: 0, length: 4, userMention: { user: { name: 'users/9' } } }, // not an "@" range
  ]);
  assert.equal(out, 'Halo <users/123> dan <users/all>, cek ya');
  assert.deepEqual(mentions, { 'users/123': 'Budi Santoso', 'users/all': 'all' });
});

test('messages expose reactions, quotes and downloadable uploads', () => {
  const out = chatUser.normalizeMessage({
    name: 'spaces/S/messages/m2',
    text: 'x',
    sender: { name: 'users/2', displayName: 'Rekan', email: 'rekan@prakasafoods.com' },
    emojiReactionSummaries: [{ emoji: { unicode: '👍' }, reactionCount: 3 }, { emoji: { customEmoji: { uid: 'x' } }, reactionCount: 1 }],
    quotedMessageMetadata: { name: 'spaces/S/messages/m1', lastUpdateTime: '2026-09-28T01:00:00Z', quotedMessageSnapshot: { text: 'asal' } },
    attachment: [{ contentName: 'a.png', contentType: 'image/png', attachmentDataRef: { resourceName: 'abc=' }, downloadUri: 'https://chat.google.com/x' }],
  }, new Map(), 'user@prakasafoods.com');
  assert.deepEqual(out.reactions, [{ emoji: '👍', count: 3 }]);
  assert.deepEqual(out.quoted, { name: 'spaces/S/messages/m1', text: 'asal' });
  assert.equal(out.attachments[0].downloadable, true);
  assert.equal(out.attachments[0].isImage, true);
  assert.equal(out.attachments[0].url, null);
  assert.equal(out.sender.isMe, false);
});

test('validators: membership names, emoji whitelist, timestamps, company-domain emails', (t) => {
  assert.equal(chatUser.isMembershipName('spaces/AAA/members/123'), true);
  assert.equal(chatUser.isMembershipName('spaces/AAA/members/../x'), false);
  assert.equal(chatUser.isReactionEmoji('👍'), true);
  assert.equal(chatUser.isReactionEmoji('" OR 1=1'), false);
  assert.equal(chatUser.isTimestamp('2026-09-28T01:00:00.123Z'), true);
  assert.equal(chatUser.isTimestamp('kemarin'), false);
  const previous = process.env.GOOGLE_ALLOWED_DOMAIN;
  process.env.GOOGLE_ALLOWED_DOMAIN = 'prakasafoods.com';
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN; else process.env.GOOGLE_ALLOWED_DOMAIN = previous; });
  assert.equal(chatUser.isAllowedEmail('budi@prakasafoods.com'), true);
  assert.equal(chatUser.isAllowedEmail('budi@gmail.com'), false);
  assert.equal(chatUser.isAllowedEmail('budi@prakasafoods.com\n'), false);
});

test('sanitizeFilename strips paths, control characters and quotes', () => {
  assert.equal(ctrl.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(ctrl.sanitizeFilename('C:\\Users\\x\\"Laporan"\u0000.pdf'), 'Laporan.pdf');
  assert.equal(ctrl.sanitizeFilename('...'), 'lampiran');
  assert.ok(ctrl.sanitizeFilename(`${'a'.repeat(300)}.xlsx`).endsWith('.xlsx'));
  assert.ok(ctrl.sanitizeFilename(`${'a'.repeat(300)}.xlsx`).length <= 180);
});

// ---------------------------------------------------------------- new conversations

test('createSpace DM reuses an existing direct message', async (t) => {
  t.mock.method(chatUser, 'findDirectMessage', async (subject, email) => ({ name: 'spaces/DM', subject, email }));
  const setup = t.mock.method(chatUser, 'setupSpace', async () => ({ name: 'spaces/NEW' }));
  const res = await call(ctrl.createSpace, req({ body: { type: 'DIRECT_MESSAGE', emails: ['Rekan@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.created, false);
  assert.equal(res.body.data.space.subject, 'user@prakasafoods.com');
  assert.equal(res.body.data.space.email, 'rekan@prakasafoods.com');
  assert.equal(setup.mock.callCount(), 0);
});

test('createSpace DM sets one up when none exists', async (t) => {
  t.mock.method(chatUser, 'findDirectMessage', async () => null);
  let seen;
  t.mock.method(chatUser, 'setupSpace', async (subject, opts) => { seen = { subject, opts }; return { name: 'spaces/NEW' }; });
  const res = await call(ctrl.createSpace, req({ body: { type: 'DIRECT_MESSAGE', emails: ['rekan@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', opts: { spaceType: 'DIRECT_MESSAGE', emails: ['rekan@prakasafoods.com'] } });
});

test('createSpace group chat needs 2+ people; named space needs a name', async (t) => {
  const setup = t.mock.method(chatUser, 'setupSpace', async (subject, opts) => ({ name: 'spaces/G', opts }));
  let res = await call(ctrl.createSpace, req({ body: { type: 'GROUP_CHAT', emails: ['a@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.createSpace, req({ body: { type: 'GROUP_CHAT', emails: ['a@prakasafoods.com', 'b@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.space.opts.spaceType, 'GROUP_CHAT');
  res = await call(ctrl.createSpace, req({ body: { type: 'SPACE', displayName: '  ' } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.createSpace, req({ body: { type: 'SPACE', displayName: 'Tim Gudang', description: 'Koordinasi', emails: ['a@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data.space.opts, { spaceType: 'SPACE', displayName: 'Tim Gudang', description: 'Koordinasi', emails: ['a@prakasafoods.com'] });
  res = await call(ctrl.createSpace, req({ body: { type: 'SPACE', displayName: 'x', description: 'd'.repeat(151) } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.createSpace, req({ body: { type: 'ROOM', emails: [] } }));
  assert.equal(res.statusCode, 400);
  assert.equal(setup.mock.callCount(), 2);
});

test('createSpace rejects malformed or foreign emails', async (t) => {
  const previous = process.env.GOOGLE_ALLOWED_DOMAIN;
  process.env.GOOGLE_ALLOWED_DOMAIN = 'prakasafoods.com';
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN; else process.env.GOOGLE_ALLOWED_DOMAIN = previous; });
  const find = t.mock.method(chatUser, 'findDirectMessage', async () => null);
  for (const emails of [['x@gmail.com'], ['not-an-email'], 'a@prakasafoods.com', [], ['a@prakasafoods.com', 'b@prakasafoods.com']]) {
    const res = await call(ctrl.createSpace, req({ body: { type: 'DIRECT_MESSAGE', emails } }));
    assert.equal(res.statusCode, 400, JSON.stringify(emails));
  }
  assert.equal(find.mock.callCount(), 0);
});

// ---------------------------------------------------------------- details & management

test('getSpaceDetails reads the space as the caller', async (t) => {
  let seen;
  t.mock.method(chatUser, 'getSpaceDetails', async (subject, spaceName) => { seen = { subject, spaceName }; return { members: [] }; });
  const res = await call(ctrl.getSpaceDetails, req({ params: { spaceId: 'AAAA' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA' });
});

test('updateSpace patches only provided fields; a non-manager gets 403', async (t) => {
  let seen;
  t.mock.method(chatUser, 'patchSpace', async (subject, spaceName, fields) => { seen = fields; return { name: spaceName }; });
  let res = await call(ctrl.updateSpace, req({ params: { spaceId: 'AAAA' }, body: { description: 'Baru' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { displayName: undefined, description: 'Baru', guidelines: undefined });
  res = await call(ctrl.updateSpace, req({ params: { spaceId: 'AAAA' }, body: {} }));
  assert.equal(res.statusCode, 400);
  chatUser.patchSpace.mock.mockImplementation(async () => { throw forbidden(); });
  res = await call(ctrl.updateSpace, req({ params: { spaceId: 'AAAA' }, body: { displayName: 'X' } }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('addMembers / removeMember / leaveSpace build names from validated ids', async (t) => {
  let added;
  t.mock.method(chatUser, 'addMembers', async (subject, spaceName, emails) => { added = { spaceName, emails }; return { added: emails, failed: [] }; });
  let res = await call(ctrl.addMembers, req({ params: { spaceId: 'AAAA' }, body: { emails: ['a@prakasafoods.com'] } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(added, { spaceName: 'spaces/AAAA', emails: ['a@prakasafoods.com'] });

  let removed;
  t.mock.method(chatUser, 'removeMember', async (subject, spaceName, membershipName) => { removed = membershipName; return { removed: true }; });
  res = await call(ctrl.removeMember, req({ params: { spaceId: 'AAAA', memberId: '12345' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(removed, 'spaces/AAAA/members/12345');
  res = await call(ctrl.removeMember, req({ params: { spaceId: 'AAAA', memberId: '../x' } }));
  assert.equal(res.statusCode, 400);

  let left;
  t.mock.method(chatUser, 'leaveSpace', async (subject, spaceName) => { left = { subject, spaceName }; return { left: true }; });
  res = await call(ctrl.leaveSpace, req({ params: { spaceId: 'AAAA' } }));
  assert.deepEqual(left, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA' });
});

test('deleteSpace surfaces a missing chat.delete scope as GOOGLE_SCOPE_NOT_GRANTED', async (t) => {
  t.mock.method(chatUser, 'deleteSpace', async () => {
    throw new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
  });
  const res = await call(ctrl.deleteSpace, req({ params: { spaceId: 'AAAA' } }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
});

test('setNotification requires a boolean', async (t) => {
  let seen;
  t.mock.method(chatUser, 'setMuted', async (subject, spaceName, muted) => { seen = muted; return { muted }; });
  let res = await call(ctrl.setNotification, req({ params: { spaceId: 'AAAA' }, body: { muted: 'yes' } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.setNotification, req({ params: { spaceId: 'AAAA' }, body: { muted: true } }));
  assert.equal(res.statusCode, 200);
  assert.equal(seen, true);
});

test('read states: validated id list; a missing scope reads as available:false', async (t) => {
  let seen;
  t.mock.method(chatUser, 'getReadStates', async (subject, names) => { seen = names; return { available: false, states: {} }; });
  let res = await call(ctrl.getReadStates, req({ query: { spaces: 'AAA,BBB' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, ['spaces/AAA', 'spaces/BBB']);
  assert.equal(res.body.data.available, false);
  res = await call(ctrl.getReadStates, req({ query: { spaces: 'AAA,../x' } }));
  assert.equal(res.statusCode, 400);
  t.mock.method(chatUser, 'markRead', async () => ({ available: false }));
  res = await call(ctrl.markRead, req({ params: { spaceId: 'AAA' } }));
  assert.equal(res.statusCode, 200);
});

// ---------------------------------------------------------------- message actions

test('listThreadMessages builds the thread name from validated ids', async (t) => {
  let seen;
  t.mock.method(chatUser, 'listThreadMessages', async (subject, spaceName, threadName) => { seen = threadName; return { messages: [] }; });
  let res = await call(ctrl.listThreadMessages, req({ params: { spaceId: 'AAAA', threadId: 'tH_1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(seen, 'spaces/AAAA/threads/tH_1');
  res = await call(ctrl.listThreadMessages, req({ params: { spaceId: 'AAAA', threadId: 'a b' } }));
  assert.equal(res.statusCode, 400);
});

test('createMessage accepts a quote from the same space only', async (t) => {
  let seen;
  t.mock.method(chatUser, 'createMessage', async (subject, spaceName, body) => { seen = body; return { name: 'spaces/AAAA/messages/n' }; });
  const quoted = { name: 'spaces/AAAA/messages/q.q', lastUpdateTime: '2026-09-28T01:00:00Z' };
  let res = await call(ctrl.createMessage, req({ params: { spaceId: 'AAAA' }, body: { text: 'ok', quoted } }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(seen.quoted, quoted);
  res = await call(ctrl.createMessage, req({ params: { spaceId: 'AAAA' }, body: { text: 'ok', quoted: { ...quoted, name: 'spaces/BBBB/messages/q' } } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.createMessage, req({ params: { spaceId: 'AAAA' }, body: { text: 'ok', quoted: { ...quoted, lastUpdateTime: 'x' } } }));
  assert.equal(res.statusCode, 400);
});

test('updateMessage / deleteMessage act as the caller; someone else\'s message is refused', async (t) => {
  let seen;
  t.mock.method(chatUser, 'updateMessage', async (subject, messageName, body) => { seen = { subject, messageName, body }; return { name: messageName }; });
  let res = await call(ctrl.updateMessage, req({ params: { spaceId: 'AAAA', messageId: 'm.m' }, body: { text: 'baru' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', messageName: 'spaces/AAAA/messages/m.m', body: { text: 'baru' } });
  res = await call(ctrl.updateMessage, req({ params: { spaceId: 'AAAA', messageId: 'm' }, body: { text: 'x'.repeat(4097) } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.updateMessage, req({ params: { spaceId: 'AAAA', messageId: 'm/../x' }, body: { text: 'x' } }));
  assert.equal(res.statusCode, 400);

  t.mock.method(chatUser, 'deleteMessage', async () => { throw forbidden(); });
  res = await call(ctrl.deleteMessage, req({ params: { spaceId: 'AAAA', messageId: 'm' } }));
  assert.equal(res.statusCode, 403);
});

test('toggleReaction only accepts whitelisted emoji', async (t) => {
  let seen;
  t.mock.method(chatUser, 'toggleReaction', async (subject, messageName, emoji) => { seen = { messageName, emoji }; return { emoji, reacted: true }; });
  let res = await call(ctrl.toggleReaction, req({ params: { spaceId: 'AAAA', messageId: 'm' }, body: { emoji: '🎉' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { messageName: 'spaces/AAAA/messages/m', emoji: '🎉' });
  res = await call(ctrl.toggleReaction, req({ params: { spaceId: 'AAAA', messageId: 'm' }, body: { emoji: '"x' } }));
  assert.equal(res.statusCode, 400);
});

// ---------------------------------------------------------------- the service's own checks

test('service refuses to edit a message sent by someone else (checked server-side)', async (t) => {
  const { google } = require('googleapis');
  const patch = t.mock.fn(async () => ({ data: {} }));
  t.mock.method(google, 'chat', () => ({
    spaces: {
      messages: { get: async () => ({ data: { sender: { name: 'users/2', email: 'other@prakasafoods.com' } } }), patch },
      members: { get: async () => ({ data: { name: 'spaces/AAAA/members/1', member: { name: 'users/1' }, role: 'ROLE_MEMBER' } }) },
    },
  }));
  await assert.rejects(
    chatUser.updateMessage('user@prakasafoods.com', 'spaces/AAAA/messages/m', { text: 'x' }),
    (error) => error.appCode === 'FORBIDDEN'
  );
  assert.equal(patch.mock.callCount(), 0);
});

test('service only lets managers remove members', async (t) => {
  const { google } = require('googleapis');
  const del = t.mock.fn(async () => ({}));
  t.mock.method(google, 'chat', () => ({
    spaces: { members: { get: async () => ({ data: { name: 'spaces/AAAA/members/1', member: { name: 'users/1' }, role: 'ROLE_MEMBER' } }), delete: del } },
  }));
  await assert.rejects(
    chatUser.removeMember('user@prakasafoods.com', 'spaces/AAAA', 'spaces/AAAA/members/2'),
    (error) => error.appCode === 'FORBIDDEN'
  );
  assert.equal(del.mock.callCount(), 0);
});

// ---------------------------------------------------------------- attachments

test('uploadAttachment sanitizes the name, uploads, then posts the message', async (t) => {
  let uploaded;
  let posted;
  t.mock.method(chatUser, 'uploadAttachment', async (subject, spaceName, file) => { uploaded = { subject, spaceName, filename: file.filename, mimeType: file.mimeType }; return { resourceName: 'ref' }; });
  t.mock.method(chatUser, 'createMessage', async (subject, spaceName, body) => { posted = body; return { name: 'spaces/AAAA/messages/n' }; });
  const res = await call(ctrl.uploadAttachment, req({
    params: { spaceId: 'AAAA' },
    body: { text: 'lihat' },
    file: { originalname: '../laporan "Q3".pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF'), size: 4 },
  }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(uploaded, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA', filename: 'laporan Q3.pdf', mimeType: 'application/pdf' });
  assert.deepEqual(posted, { text: 'lihat', threadName: undefined, attachmentDataRef: { resourceName: 'ref' } });
});

test('uploadAttachment without a file is a 400', async (t) => {
  const svc = t.mock.method(chatUser, 'uploadAttachment', async () => ({}));
  const res = await call(ctrl.uploadAttachment, req({ params: { spaceId: 'AAAA' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(svc.mock.callCount(), 0);
});

test('the chat upload filter only allows whitelisted type + matching extension', () => {
  const router = require('../src/routes/googleChat.routes');
  const types = router.CHAT_UPLOAD_TYPES;
  assert.ok(types['application/pdf'].test('a.pdf'));
  assert.equal(types['text/html'], undefined);
  assert.equal(types['image/svg+xml'], undefined);
  assert.equal(types['application/octet-stream'], undefined);
  assert.equal(types['image/png'].test('evil.html'), false);
});

function streamResponse() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.headersSent = false;
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('download proxy serves raster images inline and everything else as a neutral download', async (t) => {
  t.mock.method(chatUser, 'downloadAttachment', async (subject, messageName, index) => ({
    stream: Readable.from([Buffer.from('bytes')]), filename: index === 0 ? 'foto.png' : 'x.html', contentType: index === 0 ? 'image/png' : 'text/html',
  }));
  let res = streamResponse();
  await ctrl.downloadAttachment(req({ params: { spaceId: 'AAAA', messageId: 'm', index: '0' } }), res, rethrow);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.match(res.headers['content-disposition'], /^inline;/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');

  res = streamResponse();
  await ctrl.downloadAttachment(req({ params: { spaceId: 'AAAA', messageId: 'm', index: '1' } }), res, rethrow);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.match(res.headers['content-disposition'], /^attachment;/);

  res = streamResponse();
  await ctrl.downloadAttachment(req({ params: { spaceId: 'AAAA', messageId: 'm', index: '99' } }), res, rethrow);
  assert.equal(res.statusCode, 400);
});

// ---------------------------------------------------------------- meet & people

test('createMeet creates the meeting as the caller and logs it', async (t) => {
  let seen;
  t.mock.method(chatUser, 'createMeet', async (subject, spaceName) => { seen = { subject, spaceName }; return { meetUrl: 'https://meet.google.com/abc-defg-hij', message: { name: 'spaces/AAAA/messages/n' } }; });
  const res = await call(ctrl.createMeet, req({ params: { spaceId: 'AAAA' } }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA' });
  assert.equal(res.body.data.meetUrl, 'https://meet.google.com/abc-defg-hij');
});

test('searchPeople caps the query length', async (t) => {
  let seen;
  t.mock.method(chatUser, 'searchPeople', async (subject, q) => { seen = q; return [{ email: 'a@prakasafoods.com', name: 'A' }]; });
  let res = await call(ctrl.searchPeople, req({ query: { q: 'bud' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(seen, 'bud');
  assert.equal(res.body.data.people.length, 1);
  res = await call(ctrl.searchPeople, req({ query: { q: 'x'.repeat(101) } }));
  assert.equal(res.statusCode, 400);
});

// ================================================================ grouping, Drive, forward, settings, cards

test('spaces expose guidelines and permission settings (read-only postMessages included)', () => {
  const out = chatUser.normalizeSpace({
    name: 'spaces/S1', spaceType: 'SPACE', displayName: 'Tim',
    spaceDetails: { description: 'd', guidelines: 'Sopan' },
    permissionSettings: {
      replyMessages: { managersAllowed: true, membersAllowed: true },
      postMessages: { managersAllowed: true, membersAllowed: false },
      somethingNew: { managersAllowed: true },
    },
  }, null, new Map(), 'user@prakasafoods.com');
  assert.equal(out.guidelines, 'Sopan');
  assert.deepEqual(out.permissionSettings, {
    replyMessages: { managersAllowed: true, membersAllowed: true },
    postMessages: { managersAllowed: true, membersAllowed: false },
  });
  assert.equal(chatUser.normalizeSpace({ name: 'spaces/S2', spaceType: 'SPACE' }, null, new Map(), 'x').permissionSettings, null);
});

test('messages expose Drive smart-chip links and Drive attachment ids', () => {
  const out = chatUser.normalizeMessage({
    name: 'spaces/S/messages/d1',
    text: 'lihat https://docs.google.com/document/d/abcdefghij12345/edit',
    annotations: [
      { type: 'RICH_LINK', richLinkMetadata: { richLinkType: 'DRIVE_FILE', uri: 'x', driveLinkData: { driveDataRef: { driveFileId: 'abcdefghij12345' }, mimeType: 'application/vnd.google-apps.document' } } },
      { type: 'RICH_LINK', richLinkMetadata: { richLinkType: 'DRIVE_FILE', driveLinkData: { driveDataRef: { driveFileId: "bad'id" } } } },
      { type: 'RICH_LINK', richLinkMetadata: { richLinkType: 'CHAT_SPACE' } },
    ],
    attachment: [{ contentName: 'Sheet', source: 'DRIVE_FILE', driveDataRef: { driveFileId: 'zyxwvutsrq98765' } }],
  }, new Map(), 'user@prakasafoods.com');
  assert.deepEqual(out.driveLinks, [{ fileId: 'abcdefghij12345', mimeType: 'application/vnd.google-apps.document' }]);
  assert.equal(out.attachments[0].driveFileId, 'zyxwvutsrq98765');
  assert.deepEqual(out.cards, []);
});

test('cardsV2 become plain read-only cards: HTML flattened, only https links kept', () => {
  const cards = chatUser.simplifyCards([{
    cardId: 'c',
    card: {
      header: { title: '<b>Tiket</b> #12', subtitle: 'Helpdesk &amp; IT' },
      sections: [{
        header: 'Detail',
        widgets: [
          { textParagraph: { text: 'Baris <i>satu</i><br>baris <a href="https://x.test/a">dua</a><script>alert(1)</script>' } },
          { decoratedText: { topLabel: 'Status', text: 'Terbuka', onClick: { openLink: { url: 'javascript:alert(1)' } } } },
          { buttonList: { buttons: [
            { text: 'Buka', onClick: { openLink: { url: 'https://helpdesk.test/12' } } },
            { text: 'Aksi', onClick: { action: { function: 'x' } } },
            { text: 'Jahat', onClick: { openLink: { url: 'http://insecure.test' } } },
          ] } },
          { divider: {} },
          { selectionInput: {} },
        ],
      }],
    },
  }]);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].header, { title: 'Tiket #12', subtitle: 'Helpdesk & IT' });
  const [text, decorated, buttons, divider] = cards[0].sections[0].widgets;
  assert.equal(text.text, 'Baris satu\nbaris dua (https://x.test/a)');
  assert.equal(text.text.includes('<'), false);
  assert.equal(decorated.url, null);
  assert.deepEqual(buttons.buttons, [
    { text: 'Buka', url: 'https://helpdesk.test/12' }, { text: 'Aksi', url: null }, { text: 'Jahat', url: null },
  ]);
  assert.deepEqual(divider, { type: 'divider' });
  assert.equal(cards[0].sections[0].widgets.length, 4);
});

// ---------------------------------------------------------------- Drive picker

test('Drive list queries: sources, escaping and id validation', () => {
  assert.match(chatUser.buildDriveList({ source: 'my' }).q, /^'root' in parents and trashed = false$/);
  assert.match(chatUser.buildDriveList({ source: 'my', folderId: 'folder_12345' }).q, /^'folder_12345' in parents/);
  assert.equal(chatUser.buildDriveList({ source: 'shared' }).q, 'sharedWithMe = true and trashed = false');
  const drive = chatUser.buildDriveList({ source: 'drive', driveId: '0AAbcdefghijk' });
  assert.equal(drive.corpora, 'drive');
  assert.equal(drive.driveId, '0AAbcdefghijk');
  assert.equal(drive.supportsAllDrives, true);
  const search = chatUser.buildDriveList({ source: 'my', search: "laporan' or name contains '" });
  assert.equal(search.corpora, 'allDrives');
  assert.equal(search.q, "name contains 'laporan\\' or name contains \\'' and trashed = false");
  assert.throws(() => chatUser.buildDriveList({ source: 'drive' }), (e) => e.appCode === 'VALIDATION_ERROR');
  assert.throws(() => chatUser.buildDriveList({ source: 'my', folderId: "x' in parents or '" }), (e) => e.appCode === 'VALIDATION_ERROR');
  assert.throws(() => chatUser.buildDriveList({ source: 'everything' }), (e) => e.appCode === 'VALIDATION_ERROR');
});

test('Drive picker files resolve shortcuts and never pass through unsafe links', () => {
  const file = chatUser.toPickerFile({
    id: 'shortcut12345', name: 'Pintasan', mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: 'target1234567', targetMimeType: 'application/vnd.google-apps.folder' },
    webViewLink: 'javascript:alert(1)', capabilities: { canShare: true },
  });
  assert.equal(file.id, 'target1234567');
  assert.equal(file.isFolder, true);
  assert.equal(file.webViewLink, 'https://drive.google.com/open?id=target1234567');
  assert.equal(file.canShare, true);
});

test('listDriveFiles validates source, folder, drive and search before calling Drive', async (t) => {
  let seen;
  const svc = t.mock.method(chatUser, 'listDriveFiles', async (subject, opts) => { seen = { subject, opts }; return { files: [], nextPageToken: null }; });
  let res = await call(ctrl.listDriveFiles, req({ query: { source: 'drive', driveId: '0AAbcdefghijk', folderId: 'folder_12345' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'user@prakasafoods.com');
  assert.deepEqual(seen.opts, { source: 'drive', folderId: 'folder_12345', driveId: '0AAbcdefghijk', search: undefined, pageToken: undefined });
  for (const query of [{ source: 'all' }, { folderId: '../x' }, { driveId: "a'b" }, { q: 'x'.repeat(101) }, { pageToken: '<x>' }]) {
    res = await call(ctrl.listDriveFiles, req({ query }));
    assert.equal(res.statusCode, 400, JSON.stringify(query));
  }
  assert.equal(svc.mock.callCount(), 1);
});

test('Drive meta takes at most 50 valid ids; a missing Drive scope is GOOGLE_SCOPE_NOT_GRANTED', async (t) => {
  t.mock.method(chatUser, 'getDriveFilesMeta', async () => { throw new Error('unauthorized_client: not authorized for any of the scopes'); });
  let res = await call(ctrl.getDriveMeta, req({ query: { ids: 'abcdefghij12345' } }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
  assert.match(res.body.error.message, /Drive/);
  res = await call(ctrl.getDriveMeta, req({ query: { ids: Array.from({ length: 51 }, (_, i) => `abcdefghij${i}xxxx`).join(',') } }));
  assert.equal(res.statusCode, 400);
  res = await call(ctrl.getDriveMeta, req({ query: { ids: 'short' } }));
  assert.equal(res.statusCode, 400);
});

// Chat + Drive doubles for the access check / grant (never talks to Google).
function mockWorkspace(t, { permissions, canShare = true, permissionsFail = false } = {}) {
  const { google } = require('googleapis');
  t.mock.method(google, 'chat', () => ({
    spaces: {
      members: {
        list: async () => ({ data: { memberships: [
          { name: 'spaces/ACC/members/1', member: { name: 'users/1', email: 'user@prakasafoods.com', type: 'HUMAN' } },
          { name: 'spaces/ACC/members/2', member: { name: 'users/2', email: 'budi@prakasafoods.com', type: 'HUMAN' } },
          { name: 'spaces/ACC/members/3', member: { name: 'users/3', email: 'sari@prakasafoods.com', type: 'HUMAN' } },
          { name: 'spaces/ACC/members/4', member: { name: 'users/4', email: 'tamu@gmail.com', type: 'HUMAN' } },
          { name: 'spaces/ACC/members/5', member: { name: 'users/5', type: 'BOT' } },
        ] } }),
      },
    },
  }));
  const created = [];
  t.mock.method(google, 'drive', () => ({
    files: {
      get: async ({ fileId }) => ({ data: { id: fileId, name: `File ${fileId}`, mimeType: 'application/pdf', capabilities: { canShare: fileId === 'noshare123456' ? false : canShare } } }),
    },
    permissions: {
      list: async () => {
        if (permissionsFail) throw Object.assign(new Error('insufficientFilePermissions'), { code: 403 });
        return { data: { permissions } };
      },
      create: async (params) => { created.push(params); return { data: { id: 'p' } }; },
    },
  }));
  return created;
}

test('checkDriveAccess lists members (not me, not apps) who cannot open each file', async (t) => {
  mockWorkspace(t, { permissions: [
    { type: 'user', emailAddress: 'User@prakasafoods.com', role: 'owner' },
    { type: 'user', emailAddress: 'BUDI@prakasafoods.com', role: 'reader' },
  ] });
  const out = await chatUser.checkDriveAccess('user@prakasafoods.com', 'spaces/ACC', ['abcdefghij12345']);
  assert.equal(out.members, 3);
  assert.deepEqual(out.files[0].missing, ['sari@prakasafoods.com', 'tamu@gmail.com']);
  assert.equal(out.files[0].canCheck, true);
});

test('checkDriveAccess: a domain-wide permission covers colleagues; hidden sharing settings → canCheck:false', async (t) => {
  mockWorkspace(t, { permissions: [{ type: 'domain', domain: 'prakasafoods.com', role: 'reader' }] });
  let out = await chatUser.checkDriveAccess('user@prakasafoods.com', 'spaces/ACC', ['abcdefghij12345']);
  assert.deepEqual(out.files[0].missing, ['tamu@gmail.com']);
  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  mockWorkspace(t, { permissionsFail: true });
  out = await chatUser.checkDriveAccess('user@prakasafoods.com', 'spaces/ACC', ['abcdefghij12345']);
  assert.equal(out.files[0].canCheck, false);
  assert.deepEqual(out.files[0].missing, []);
});

test('grantDriveAccess shares only shareable files, only with company members who lack access, silently', async (t) => {
  const previous = process.env.GOOGLE_ALLOWED_DOMAIN;
  process.env.GOOGLE_ALLOWED_DOMAIN = 'prakasafoods.com';
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN; else process.env.GOOGLE_ALLOWED_DOMAIN = previous; });
  const created = mockWorkspace(t, { permissions: [{ type: 'user', emailAddress: 'budi@prakasafoods.com', role: 'reader' }] });
  const out = await chatUser.grantDriveAccess('user@prakasafoods.com', 'spaces/ACC', ['abcdefghij12345', 'noshare123456'], 'commenter');
  assert.deepEqual(out, { granted: 1, failed: 0, skippedFiles: ['noshare123456'] });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    fileId: 'abcdefghij12345', supportsAllDrives: true, sendNotificationEmail: false, fields: 'id',
    requestBody: { type: 'user', role: 'commenter', emailAddress: 'sari@prakasafoods.com' },
  });
  await assert.rejects(chatUser.grantDriveAccess('user@prakasafoods.com', 'spaces/ACC', ['abcdefghij12345'], 'owner'), (e) => e.appCode === 'VALIDATION_ERROR');
});

test('drive-access endpoints validate file ids and role; emails never come from the client', async (t) => {
  let seen;
  const grant = t.mock.method(chatUser, 'grantDriveAccess', async (subject, spaceName, ids, role) => { seen = { subject, spaceName, ids, role }; return { granted: 2, failed: 0, skippedFiles: [] }; });
  let res = await call(ctrl.grantDriveAccess, req({ params: { spaceId: 'AAAA' }, body: { fileIds: ['abcdefghij12345'], role: 'reader', emails: ['x@evil.test'] } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', spaceName: 'spaces/AAAA', ids: ['abcdefghij12345'], role: 'reader' });
  for (const body of [{ fileIds: ['abcdefghij12345'], role: 'owner' }, { fileIds: [], role: 'reader' }, { fileIds: ["x' or '1"], role: 'reader' },
    { fileIds: Array.from({ length: 11 }, (_, i) => `abcdefghij${i}xxxx`), role: 'reader' }]) {
    res = await call(ctrl.grantDriveAccess, req({ params: { spaceId: 'AAAA' }, body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(grant.mock.callCount(), 1);
  const check = t.mock.method(chatUser, 'checkDriveAccess', async () => ({ members: 0, files: [] }));
  res = await call(ctrl.checkDriveAccess, req({ params: { spaceId: 'AAAA' }, body: { fileIds: ['abcdefghij12345'] } }));
  assert.equal(res.statusCode, 200);
  assert.equal(check.mock.callCount(), 1);
});

// ---------------------------------------------------------------- forward

test('forward endpoint validates the target and logs without the text', async (t) => {
  let seen;
  t.mock.method(chatUser, 'forwardMessage', async (subject, messageName, target, opts) => { seen = { subject, messageName, target, opts }; return { name: 'spaces/BBBB/messages/n' }; });
  let res = await call(ctrl.forwardMessage, req({ params: { spaceId: 'AAAA', messageId: 'm.1' }, body: { targetSpaceId: 'BBBB', note: ' fyi ' } }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(seen, { subject: 'user@prakasafoods.com', messageName: 'spaces/AAAA/messages/m.1', target: 'spaces/BBBB', opts: { note: 'fyi' } });
  for (const body of [{ targetSpaceId: 'spaces/BBBB' }, { targetSpaceId: '../x' }, {}, { targetSpaceId: 'BBBB', note: 'x'.repeat(1001) }]) {
    res = await call(ctrl.forwardMessage, req({ params: { spaceId: 'AAAA', messageId: 'm' }, body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('forwardMessage re-posts as the caller with a "Diteruskan dari" line, Drive links and one re-uploaded file', async (t) => {
  const { google } = require('googleapis');
  const createdMessages = [];
  const uploads = [];
  t.mock.method(google, 'chat', () => ({
    spaces: {
      get: async ({ name }) => ({ data: { name, spaceType: 'SPACE', displayName: 'Tim Gudang' } }),
      messages: {
        get: async () => ({ data: {
          name: 'spaces/SRC/messages/m', text: 'Stok aman', sender: { name: 'users/2', displayName: 'Budi', email: 'budi@prakasafoods.com' },
          attachment: [
            { contentName: 'foto.png', contentType: 'image/png', attachmentDataRef: { resourceName: 'ref1' } },
            { contentName: 'x.html', contentType: 'text/html', attachmentDataRef: { resourceName: 'ref2' } },
            { contentName: 'Laporan', driveDataRef: { driveFileId: 'abcdefghij12345' } },
          ],
        } }),
        create: async (params) => { createdMessages.push(params); return { data: { name: 'spaces/DST/messages/new', text: params.requestBody.text } }; },
      },
    },
    media: {
      download: async () => ({ data: Readable.from([Buffer.from('png-bytes')]) }),
      upload: async (params) => { uploads.push(params); return { data: { attachmentDataRef: { resourceName: 'up1' } } }; },
    },
  }));
  const out = await chatUser.forwardMessage('user@prakasafoods.com', 'spaces/SRC/messages/m', 'spaces/DST', { note: 'Lihat ini' });
  assert.equal(out.name, 'spaces/DST/messages/new');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].parent, 'spaces/DST');
  const sent = createdMessages[0];
  assert.equal(sent.parent, 'spaces/DST');
  assert.deepEqual(sent.requestBody.attachment, [{ attachmentDataRef: { resourceName: 'up1' } }]);
  assert.equal(sent.requestBody.text, 'Lihat ini\n\n_Diteruskan dari Budi · Tim Gudang_\nStok aman\nhttps://drive.google.com/open?id=abcdefghij12345\n_(1 lampiran tidak ikut diteruskan)_');
});

// ---------------------------------------------------------------- settings

test('settings endpoint whitelists keys and values', async (t) => {
  let seen;
  const svc = t.mock.method(chatUser, 'updateSpaceSettings', async (subject, spaceName, opts) => { seen = opts; return { name: spaceName }; });
  let res = await call(ctrl.updateSettings, req({ params: { spaceId: 'AAAA' }, body: { historyOff: true, permissions: { replyMessages: 'managers' } } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { historyOff: true, permissions: { replyMessages: 'managers' } });
  for (const body of [{}, { historyOff: 'yes' }, { permissions: { postMessages: 'members' } }, { permissions: { replyMessages: 'everyone' } }, { permissions: [] }]) {
    res = await call(ctrl.updateSettings, req({ params: { spaceId: 'AAAA' }, body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(svc.mock.callCount(), 1);
});

function mockSettingsChat(t, { role = 'ROLE_MANAGER', patchError } = {}) {
  const { google } = require('googleapis');
  const patches = [];
  t.mock.method(google, 'chat', () => ({
    spaces: {
      get: async ({ name }) => ({ data: { name, spaceType: 'SPACE', displayName: 'Tim', spaceDetails: { description: 'lama', guidelines: 'pedoman lama' } } }),
      patch: async (params) => { patches.push(params); if (patchError) throw patchError; return { data: { name: params.name, spaceType: 'SPACE', displayName: 'Tim' } }; },
      members: { get: async () => ({ data: { name: 'spaces/SET/members/1', member: { name: 'users/1' }, role } }) },
    },
  }));
  return patches;
}

test('updateSpaceSettings: permissions need a manager and are their own patch; history is another', async (t) => {
  let patches = mockSettingsChat(t);
  await chatUser.updateSpaceSettings('user@prakasafoods.com', 'spaces/SET', { historyOff: false, permissions: { replyMessages: 'members', toggleHistory: 'managers' } });
  assert.equal(patches.length, 2);
  assert.equal(patches[0].updateMask, 'permission_settings.toggleHistory,permission_settings.replyMessages');
  assert.deepEqual(patches[0].requestBody.permissionSettings.replyMessages, { managersAllowed: true, membersAllowed: true });
  assert.deepEqual(patches[0].requestBody.permissionSettings.toggleHistory, { managersAllowed: true, membersAllowed: false });
  assert.deepEqual(patches[1], { name: 'spaces/SET', updateMask: 'space_history_state', requestBody: { spaceHistoryState: 'HISTORY_ON' } });

  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  patches = mockSettingsChat(t, { role: 'ROLE_MEMBER' });
  await assert.rejects(chatUser.updateSpaceSettings('user@prakasafoods.com', 'spaces/SET', { permissions: { replyMessages: 'members' } }), (e) => e.appCode === 'FORBIDDEN');
  assert.equal(patches.length, 0);
});

test('updateSpaceSettings turns a Google 403 into a clear FORBIDDEN (never a raw 401/403)', async (t) => {
  mockSettingsChat(t, { patchError: Object.assign(new Error('PERMISSION_DENIED'), { code: 403 }) });
  await assert.rejects(chatUser.updateSpaceSettings('user@prakasafoods.com', 'spaces/SET', { historyOff: true }), (e) => e.appCode === 'FORBIDDEN' && e.appStatus === 403);
});

test('patchSpace keeps the other spaceDetails field; guidelines are length-checked', async (t) => {
  const patches = mockSettingsChat(t);
  await chatUser.patchSpace('user@prakasafoods.com', 'spaces/SET', { guidelines: 'baru' });
  assert.deepEqual(patches[0].requestBody, { spaceDetails: { description: 'lama', guidelines: 'baru' } });
  assert.equal(patches[0].updateMask, 'spaceDetails');
  const res = await call(ctrl.updateSpace, req({ params: { spaceId: 'AAAA' }, body: { guidelines: 'x'.repeat(5001) } }));
  assert.equal(res.statusCode, 400);
});

test('legacy v1 cards (keyValue, textButton, image) are simplified the same way', () => {
  const cards = chatUser.simplifyCards(undefined, [{
    header: { title: 'Pengingat', subtitle: 'Kalender', imageUrl: 'https://x.test/i.png' },
    sections: [{ widgets: [
      { keyValue: { topLabel: 'Waktu', content: '10.00', onClick: { openLink: { url: 'https://calendar.test/e' } } } },
      { buttons: [{ textButton: { text: 'Buka', onClick: { openLink: { url: 'https://calendar.test/e' } } } }, { imageButton: { icon: 'STAR' } }] },
      { image: { imageUrl: 'https://x.test/i.png' } },
    ] }],
  }]);
  assert.deepEqual(cards, [{
    header: { title: 'Pengingat', subtitle: 'Kalender' },
    sections: [{ header: null, widgets: [
      { type: 'decorated', topLabel: 'Waktu', text: '10.00', bottomLabel: null, url: 'https://calendar.test/e' },
      { type: 'buttons', buttons: [{ text: 'Buka', url: 'https://calendar.test/e' }, { text: 'Buka', url: null }] },
      { type: 'text', text: '[Gambar]' },
    ] }],
  }]);
});
