import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChatText, safeHref, groupMessagesByDay, dayLabel, mergeMessages, filterSpaces,
  splitSpaces, initials, spaceIdFromName, isValidSpaceId, formatLastActive,
  groupSpaces, readCollapsed, writeCollapsed, collapsedKey, avatarKind, spaceTabs, spaceTypeLabel,
  driveLinksInText, driveKind, inAppPath, driveFilesOfMessage, messageFiles, filterFiles, fileTitle,
  buildDriveMessage, accessSummary, messageLink, isValidMessageId,
} from '../src/pages/google/chatModel.js';

const strip = (nodes) => nodes.map((n) => (n.children ? { type: n.type, children: strip(n.children) } : n));

test('plain text stays a single text node', () => {
  assert.deepEqual(parseChatText('Halo semua\nbaris dua'), [{ type: 'text', value: 'Halo semua\nbaris dua' }]);
});

test('bold, italic, strike and inline code are parsed', () => {
  assert.deepEqual(strip(parseChatText('ini *tebal* dan _miring_ ~coret~ `kode *x*`')), [
    { type: 'text', value: 'ini ' },
    { type: 'bold', children: [{ type: 'text', value: 'tebal' }] },
    { type: 'text', value: ' dan ' },
    { type: 'italic', children: [{ type: 'text', value: 'miring' }] },
    { type: 'text', value: ' ' },
    { type: 'strike', children: [{ type: 'text', value: 'coret' }] },
    { type: 'text', value: ' ' },
    { type: 'code', value: 'kode *x*' },
  ]);
});

test('markers inside words, lone markers and multiplication stay literal', () => {
  assert.deepEqual(parseChatText('snake_case_name'), [{ type: 'text', value: 'snake_case_name' }]);
  assert.deepEqual(parseChatText('2 * 3 * 4'), [{ type: 'text', value: '2 * 3 * 4' }]);
  assert.deepEqual(parseChatText('harga *diskon'), [{ type: 'text', value: 'harga *diskon' }]);
});

test('nested styles work', () => {
  assert.deepEqual(strip(parseChatText('*tebal _dan miring_*')), [
    { type: 'bold', children: [{ type: 'text', value: 'tebal ' }, { type: 'italic', children: [{ type: 'text', value: 'dan miring' }] }] },
  ]);
});

test('code blocks keep their content verbatim', () => {
  const nodes = parseChatText('lihat:\n```\nconst a = *b*;\n```\nselesai');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'lihat:\n' },
    { type: 'codeblock', value: 'const a = *b*;' },
    { type: 'text', value: '\nselesai' },
  ]);
});

test('URLs are auto-linked without trailing punctuation, underscores in URLs survive', () => {
  assert.deepEqual(parseChatText('buka https://example.com/a_b_c?x=1, ya.'), [
    { type: 'text', value: 'buka ' },
    { type: 'link', href: 'https://example.com/a_b_c?x=1', value: 'https://example.com/a_b_c?x=1' },
    { type: 'text', value: ', ya.' },
  ]);
  assert.deepEqual(parseChatText('<https://docs.google.com/d/1|Dokumen>'), [
    { type: 'link', href: 'https://docs.google.com/d/1', value: 'Dokumen' },
  ]);
});

test('unsafe schemes are never linked', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,x'), null);
  assert.equal(safeHref('https://ok.example/'), 'https://ok.example/');
  const nodes = parseChatText('<javascript:alert(1)|klik> javascript:alert(1)');
  assert.equal(nodes.some((n) => n.type === 'link'), false);
  // HTML in a message is just text — the page renders nodes as React text.
  assert.deepEqual(parseChatText('<img src=x onerror=alert(1)>'), [{ type: 'text', value: '<img src=x onerror=alert(1)>' }]);
});

test('messages are grouped by local day with Hari ini / Kemarin labels', () => {
  const now = new Date(2026, 8, 28, 15, 0);
  const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).toISOString();
  const alice = { name: 'users/1', displayName: 'A' };
  const bob = { name: 'users/2', displayName: 'B' };
  const groups = groupMessagesByDay([
    { name: 'm1', createTime: at(20, 9), sender: alice },
    { name: 'm2', createTime: at(27, 9), sender: alice },
    { name: 'm3', createTime: at(27, 9, 2), sender: alice },
    { name: 'm4', createTime: at(28, 8), sender: alice },
    { name: 'm5', createTime: at(28, 8, 1), sender: bob },
    { name: 'm6', createTime: at(28, 8, 30), sender: bob },
  ], now);
  assert.equal(groups.length, 3);
  assert.notEqual(groups[0].label, 'Kemarin');
  assert.equal(groups[1].label, 'Kemarin');
  assert.equal(groups[2].label, 'Hari ini');
  assert.deepEqual(groups[1].items.map((i) => i.showHeader), [true, false]);
  // new sender → header; same sender after > 5 min → header again
  assert.deepEqual(groups[2].items.map((i) => i.showHeader), [true, true, true]);
});

test('dayLabel adds the year only for other years', () => {
  const now = new Date(2026, 8, 28);
  assert.equal(dayLabel(new Date(2026, 8, 28, 23, 59), now), 'Hari ini');
  assert.match(dayLabel(new Date(2025, 0, 5), now), /2025/);
  assert.doesNotMatch(dayLabel(new Date(2026, 0, 5), now), /2026/);
  assert.equal(formatLastActive(new Date(2026, 8, 27, 10).toISOString(), now), 'Kemarin');
});

test('mergeMessages de-duplicates by name and sorts oldest first', () => {
  const merged = mergeMessages(
    [{ name: 'b', createTime: '2026-09-28T02:00:00Z', text: 'lama' }, { name: 'a', createTime: '2026-09-28T01:00:00Z' }],
    [{ name: 'b', createTime: '2026-09-28T02:00:00Z', text: 'baru' }, { name: 'c', createTime: '2026-09-28T03:00:00Z' }],
  );
  assert.deepEqual(merged.map((m) => m.name), ['a', 'b', 'c']);
  assert.equal(merged[1].text, 'baru');
});

test('spaces filter, split and sort by last activity', () => {
  const spaces = [
    { name: 'spaces/A', displayName: 'Tim Gudang', spaceType: 'SPACE', lastActiveTime: '2026-09-01T00:00:00Z' },
    { name: 'spaces/B', displayName: 'Budi', spaceType: 'DIRECT_MESSAGE', lastActiveTime: '2026-09-03T00:00:00Z' },
    { name: 'spaces/C', displayName: 'Tim Sales', spaceType: 'SPACE', lastActiveTime: '2026-09-05T00:00:00Z' },
  ];
  assert.deepEqual(filterSpaces(spaces, '  tim ').map((s) => s.name), ['spaces/A', 'spaces/C']);
  const { direct, rooms } = splitSpaces(spaces);
  assert.deepEqual(direct.map((s) => s.name), ['spaces/B']);
  assert.deepEqual(rooms.map((s) => s.name), ['spaces/C', 'spaces/A']);
});

test('ids and initials', () => {
  assert.equal(spaceIdFromName('spaces/AAAA_b-1'), 'AAAA_b-1');
  assert.equal(spaceIdFromName('spaces/../x'), null);
  assert.equal(isValidSpaceId('AA%2F'), false);
  assert.equal(initials('Muhammad Wahyudi Saputra'), 'MS');
  assert.equal(initials('budi'), 'B');
  assert.equal(initials(''), '?');
  assert.equal(initials('[UJI] Warehouse Head'), 'UH');
});

// ================================================================ extended helpers
import {
  encodeMentions, decodeMentions, mentionQuery, mentionCandidates, insertMention, plainText,
  applyFormat, summarizeReactions, applyReactionToggle, threadView, searchMessages, isUnread,
  uploadProblem, REACTION_EMOJI,
} from '../src/pages/google/chatModel.js';

test('mention tokens render as highlighted names only when known', () => {
  const nodes = parseChatText('Halo <users/123>, lihat <users/999> dan <users/all>', { 'users/123': 'Budi' });
  assert.deepEqual(nodes, [
    { type: 'text', value: 'Halo ' },
    { type: 'mention', user: 'users/123', value: '@Budi' },
    { type: 'text', value: ', lihat <users/999> dan ' },
    { type: 'mention', user: 'users/all', value: '@all' },
  ]);
  assert.equal(plainText('Hai <users/123>', { 'users/123': 'Budi' }), 'Hai @Budi');
});

test('encodeMentions turns picked "@Name" into <users/id>, longest name first, whole words only', () => {
  const picked = [{ user: 'users/1', name: 'Budi' }, { user: 'users/2', name: 'Budi Santoso' }, { user: 'bad', name: 'X' }];
  assert.equal(encodeMentions('@Budi Santoso dan @Budi, email budi@x.com @Budiman @X', picked),
    '<users/2> dan <users/1>, email budi@x.com @Budiman @X');
});

test('decodeMentions round-trips with encodeMentions', () => {
  const mentions = { 'users/1': 'Budi', 'users/2': 'Ani Wijaya' };
  const { text, picked } = decodeMentions('<users/2> cc <users/1> <users/7>', mentions);
  assert.equal(text, '@Ani Wijaya cc @Budi <users/7>');
  assert.equal(encodeMentions(text, picked), '<users/2> cc <users/1> <users/7>');
});

test('mentionQuery finds the "@word" being typed; candidates exclude me and apps', () => {
  assert.deepEqual(mentionQuery('halo @bu', 8), { query: 'bu', start: 5 });
  assert.deepEqual(mentionQuery('@', 1), { query: '', start: 0 });
  assert.equal(mentionQuery('email a@b', 9), null);
  const members = [
    { user: 'users/1', displayName: 'Budi Santoso', isMe: false },
    { user: 'users/2', displayName: 'Ani Budiarti', isMe: false },
    { user: 'users/3', displayName: 'Saya Budi', isMe: true },
    { user: null, displayName: 'Bot Budi', type: 'BOT' },
  ];
  assert.deepEqual(mentionCandidates(members, 'bu').map((m) => m.user), ['users/1', 'users/2']);
  assert.deepEqual(mentionCandidates(members, 'san').map((m) => m.user), ['users/1']);
  assert.deepEqual(mentionCandidates(members, 'budiarti').map((m) => m.user), ['users/2']);
  const inserted = insertMention('halo @bu apa kabar', { query: 'bu', start: 5 }, members[0]);
  assert.equal(inserted.text, 'halo @Budi Santoso apa kabar');
  assert.equal(inserted.caret, 'halo @Budi Santoso '.length);
});

test('formatting toolbar wraps the selection in Chat markdown', () => {
  assert.deepEqual(applyFormat('ini penting', 4, 11, 'bold'), { text: 'ini *penting*', start: 5, end: 12 });
  assert.equal(applyFormat('a', 1, 1, 'italic').text, 'a__');
  assert.equal(applyFormat('x', 0, 1, 'strike').text, '~x~');
  assert.equal(applyFormat('x', 0, 1, 'code').text, '`x`');
  assert.equal(applyFormat('let a', 0, 5, 'codeblock').text, '```\nlet a\n```');
  assert.equal(applyFormat('satu\ndua', 0, 8, 'list').text, '* satu\n* dua');
  // the parser shows list items as bullets and does not read them as bold
  assert.deepEqual(parseChatText('* satu\n* dua'), [{ type: 'text', value: '• satu\n• dua' }]);
});

test('reaction summaries merge server counts with my toggles', () => {
  assert.deepEqual(summarizeReactions([{ emoji: '👍', count: 1 }, { emoji: '🎉', count: 4 }, { emoji: '👍', count: 1 }], { '👍': true, '🔥': true }), [
    { emoji: '🎉', count: 4, mine: false },
    { emoji: '👍', count: 2, mine: true },
    { emoji: '🔥', count: 1, mine: true },
  ]);
  assert.deepEqual(applyReactionToggle([{ emoji: '👍', count: 1 }], '👍', false), []);
  assert.deepEqual(applyReactionToggle([], '🎉', true), [{ emoji: '🎉', count: 1 }]);
  assert.equal(new Set(REACTION_EMOJI.map((r) => r.emoji)).size, REACTION_EMOJI.length);
});

test('threadView moves replies of loaded roots into the thread, keeps orphans', () => {
  const messages = [
    { name: 'a', threadName: 't1', threadReply: false },
    { name: 'b', threadName: 't1', threadReply: true },
    { name: 'c', threadName: 't2', threadReply: true },
    { name: 'd', threadName: 't3', threadReply: false },
  ];
  const { main, replies } = threadView(messages);
  assert.deepEqual(main.map((m) => m.name), ['a', 'c', 'd']);
  assert.deepEqual(replies.get('t1').map((m) => m.name), ['b']);
});

test('message search matches text, decoded mentions, sender and attachment names', () => {
  const messages = [
    { name: '1', text: 'rapat jam 3', sender: { displayName: 'Ani' }, attachments: [] },
    { name: '2', text: 'cc <users/5>', mentions: { 'users/5': 'Budi' }, sender: { displayName: 'Cici' }, attachments: [] },
    { name: '3', text: '', sender: { displayName: 'Dedi' }, attachments: [{ title: 'Invoice.pdf' }] },
  ];
  assert.deepEqual(searchMessages(messages, 'RAPAT').map((m) => m.name), ['1']);
  assert.deepEqual(searchMessages(messages, '@budi').map((m) => m.name), ['2']);
  assert.deepEqual(searchMessages(messages, 'cici').map((m) => m.name), ['2']);
  assert.deepEqual(searchMessages(messages, 'invoice').map((m) => m.name), ['3']);
  assert.equal(searchMessages(messages, '  ').length, 3);
});

test('unread compares last activity with the read state; uploads are checked up front', () => {
  const space = { lastActiveTime: '2026-09-28T10:00:00Z' };
  assert.equal(isUnread(space, '2026-09-28T09:00:00Z'), true);
  assert.equal(isUnread(space, '2026-09-28T10:00:00Z'), false);
  assert.equal(isUnread(space, null), false);
  assert.equal(uploadProblem({ name: 'a.pdf', size: 10 }), null);
  assert.match(uploadProblem({ name: 'a.exe', size: 10 }), /Tipe/);
  assert.match(uploadProblem({ name: 'a.pdf', size: 26 * 1024 * 1024 }), /25 MB/);
});


// ---------------------------------------------------------------- sidebar grouping

test('conversations group into Pesan langsung (DMs + group chats), Space and Aplikasi, newest first', () => {
  const spaces = [
    { name: 'spaces/S1', spaceType: 'SPACE', lastActiveTime: '2026-09-01T00:00:00Z' },
    { name: 'spaces/D1', spaceType: 'DIRECT_MESSAGE', lastActiveTime: '2026-09-02T00:00:00Z' },
    { name: 'spaces/G1', spaceType: 'GROUP_CHAT', lastActiveTime: '2026-09-04T00:00:00Z' },
    { name: 'spaces/B1', spaceType: 'DIRECT_MESSAGE', isBotDm: true, lastActiveTime: '2026-09-05T00:00:00Z' },
    { name: 'spaces/S2', spaceType: 'SPACE', lastActiveTime: '2026-09-03T00:00:00Z' },
  ];
  const { direct, spaces: named, apps } = groupSpaces(spaces);
  assert.deepEqual(direct.map((s) => s.name), ['spaces/G1', 'spaces/D1']);
  assert.deepEqual(named.map((s) => s.name), ['spaces/S2', 'spaces/S1']);
  assert.deepEqual(apps.map((s) => s.name), ['spaces/B1']);
  assert.equal(spaceTypeLabel({ spaceType: 'SPACE', membershipCount: 4 }), 'Space · 4 anggota');
});

test('avatar kinds and tabs: spaces get Chat | File | Tugas, others only Chat', () => {
  assert.equal(avatarKind({ spaceType: 'SPACE' }), 'space');
  assert.equal(avatarKind({ spaceType: 'GROUP_CHAT' }), 'group');
  assert.equal(avatarKind({ spaceType: 'DIRECT_MESSAGE' }), 'person');
  assert.equal(avatarKind({ spaceType: 'DIRECT_MESSAGE', isBotDm: true }), 'bot');
  assert.equal(avatarKind(null, { type: 'BOT' }), 'bot');
  assert.deepEqual(spaceTabs({ spaceType: 'SPACE' }), ['chat', 'files', 'tasks']);
  assert.deepEqual(spaceTabs({ spaceType: 'GROUP_CHAT' }), ['chat']);
  assert.deepEqual(spaceTabs(null), ['chat']);
});

test('collapsed sections persist per user and survive broken storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(writeCollapsed(storage, 14, { spaces: true, junk: true }), true);
  assert.deepEqual(readCollapsed(storage, 14), { direct: false, spaces: true, apps: false });
  assert.deepEqual(readCollapsed(storage, 15), { direct: false, spaces: false, apps: false });
  assert.equal(collapsedKey(14), 'pw.gchat.collapsed.14');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readCollapsed(broken, 14), {});
  assert.equal(writeCollapsed(broken, 14, {}), false);
  store.set(collapsedKey(16), '{not json');
  assert.deepEqual(readCollapsed(storage, 16), {});
});

// ---------------------------------------------------------------- Drive files

test('Drive links in text are found once each with a mime guess', () => {
  const links = driveLinksInText('a https://docs.google.com/document/d/abcdefghij12345/edit b https://docs.google.com/spreadsheets/u/1/d/sheet123456789/edit#gid=0 '
    + 'c https://drive.google.com/file/d/pdf1234567890/view d https://drive.google.com/open?id=abcdefghij12345 e https://drive.google.com/drive/folders/folder1234567');
  assert.deepEqual(links, [
    { fileId: 'abcdefghij12345', mimeType: 'application/vnd.google-apps.document' },
    { fileId: 'sheet123456789', mimeType: 'application/vnd.google-apps.spreadsheet' },
    { fileId: 'pdf1234567890', mimeType: null },
    { fileId: 'folder1234567', mimeType: 'application/vnd.google-apps.folder' },
  ]);
  assert.deepEqual(driveLinksInText('https://evil.test/document/d/abcdefghij12345'), []);
});

test('mime kinds and in-app routes: only native Docs/Sheets/Slides open inside Prakasa', () => {
  assert.equal(driveKind('application/vnd.google-apps.presentation'), 'presentation');
  assert.equal(driveKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'spreadsheet');
  assert.equal(driveKind('application/pdf'), 'pdf');
  assert.equal(driveKind('image/png'), 'image');
  assert.equal(driveKind(null), 'file');
  assert.equal(inAppPath('abcdefghij12345', 'application/vnd.google-apps.document'), '/docs/abcdefghij12345');
  assert.equal(inAppPath('abcdefghij12345', 'application/vnd.google-apps.spreadsheet'), '/sheets/abcdefghij12345');
  assert.equal(inAppPath('abcdefghij12345', 'application/vnd.google-apps.presentation'), '/slides/abcdefghij12345');
  assert.equal(inAppPath('abcdefghij12345', 'application/pdf'), null);
  assert.equal(inAppPath('../x', 'application/vnd.google-apps.document'), null);
});

const fileMessages = [
  {
    name: 'spaces/S/messages/1', createTime: '2026-09-01T00:00:00Z', sender: { displayName: 'Budi' },
    text: 'cek https://docs.google.com/document/d/abcdefghij12345/edit',
    driveLinks: [{ fileId: 'abcdefghij12345', mimeType: 'application/vnd.google-apps.document' }],
    attachments: [{ index: 0, title: 'foto.png', contentType: 'image/png', downloadable: true }],
  },
  {
    name: 'spaces/S/messages/2', createTime: '2026-09-02T00:00:00Z', sender: { displayName: 'Sari' }, text: '',
    attachments: [{ index: 0, title: 'Anggaran', contentType: 'application/vnd.google-apps.spreadsheet', driveFileId: 'sheet123456789' }],
  },
  { name: 'spaces/S/messages/3', createTime: '2026-09-03T00:00:00Z', deleted: true, attachments: [{ index: 0, title: 'x.pdf' }] },
];

test('a message\'s Drive files merge attachments, smart chips and text links', () => {
  assert.deepEqual(driveFilesOfMessage(fileMessages[0]), [{ fileId: 'abcdefghij12345', mimeType: 'application/vnd.google-apps.document', title: null }]);
  assert.deepEqual(driveFilesOfMessage(fileMessages[1]), [{ fileId: 'sheet123456789', mimeType: 'application/vnd.google-apps.spreadsheet', title: 'Anggaran' }]);
});

test('File tab lists uploads and Drive files newest first, filterable by kind and text', () => {
  const items = messageFiles(fileMessages);
  assert.deepEqual(items.map((i) => i.key), ['spaces/S/messages/2@sheet123456789', 'spaces/S/messages/1#0', 'spaces/S/messages/1@abcdefghij12345']);
  assert.deepEqual(filterFiles(items, { kind: 'image' }).map((i) => i.key), ['spaces/S/messages/1#0']);
  assert.deepEqual(filterFiles(items, { kind: 'spreadsheet' }).map((i) => i.key), ['spaces/S/messages/2@sheet123456789']);
  assert.deepEqual(filterFiles(items, { kind: 'other' }), []);
  const meta = { abcdefghij12345: { name: 'Notulen Rapat' } };
  assert.deepEqual(filterFiles(items, { query: 'notulen' }, meta).map((i) => i.key), ['spaces/S/messages/1@abcdefghij12345']);
  assert.deepEqual(filterFiles(items, { query: 'sari' }).map((i) => i.key), ['spaces/S/messages/2@sheet123456789']);
  assert.equal(fileTitle(items[2]), 'File Google Drive');
  assert.equal(fileTitle(items[2], meta), 'Notulen Rapat');
});

test('Drive files become one link per line after the typed text', () => {
  assert.equal(buildDriveMessage('Tolong cek  \n', [{ id: 'abcdefghij12345', webViewLink: 'https://docs.google.com/document/d/abcdefghij12345/edit' }, { id: 'pdf1234567890' }]),
    'Tolong cek\nhttps://docs.google.com/document/d/abcdefghij12345/edit\nhttps://drive.google.com/open?id=pdf1234567890');
  assert.equal(buildDriveMessage('', [{ id: 'pdf1234567890' }]), 'https://drive.google.com/open?id=pdf1234567890');
});

test('access summary: who lacks access, what can be shared, what cannot', () => {
  const summary = accessSummary({ files: [
    { id: 'a', accessible: true, canCheck: true, canShare: true, missing: ['x@p.com', 'y@p.com'] },
    { id: 'b', accessible: true, canCheck: true, canShare: false, missing: ['x@p.com'] },
    { id: 'c', accessible: true, canCheck: false, canShare: true, missing: [] },
    { id: 'd', accessible: true, canCheck: true, canShare: true, missing: [] },
  ] });
  assert.equal(summary.needsDecision, true);
  assert.deepEqual(summary.shareable.map((f) => f.id), ['a']);
  assert.deepEqual(summary.blocked.map((f) => f.id), ['b']);
  assert.equal(summary.people, 2);
  assert.equal(summary.unchecked, 1);
  assert.equal(accessSummary({ files: [{ id: 'd', missing: [] }] }).needsDecision, false);
  assert.equal(accessSummary(null).needsDecision, false);
});

test('message links point back into Prakasa and only carry valid ids', () => {
  assert.equal(messageLink('https://work.prakasa.test/', 'AAAA', 'spaces/AAAA/messages/m.1_x'), 'https://work.prakasa.test/chat?space=AAAA&message=m.1_x');
  assert.equal(messageLink('https://x', 'AA/..', 'spaces/AAAA/messages/m'), null);
  assert.equal(isValidMessageId('m.1_x-2'), true);
  assert.equal(isValidMessageId('m/../x'), false);
});

test('a DM whose partner was deleted is labelled as such, and a user label is marked as the user\'s own', async () => {
  const { spaceTypeLabel, avatarKind } = await import('../src/pages/google/chatModel.js');
  const dm = { spaceType: 'DIRECT_MESSAGE' };
  assert.equal(spaceTypeLabel({ ...dm, partnerDeleted: true }), 'Akun Google dihapus');
  assert.equal(spaceTypeLabel({ ...dm, partnerDeleted: true, alias: 'Budi' }), 'Akun Google dihapus · nama dari Anda');
  assert.equal(spaceTypeLabel({ ...dm, alias: 'Budi' }), 'Pesan langsung · nama dari Anda');
  assert.equal(avatarKind({ ...dm, partnerDeleted: true }), 'deleted');
  assert.equal(avatarKind({ ...dm, partnerDeleted: true, alias: 'Budi' }), 'person');
  // Name recovered from the archive: a normal initial avatar, still marked as deleted.
  assert.equal(avatarKind({ ...dm, partnerDeleted: true, partnerNameRecovered: true }), 'person');
  assert.equal(spaceTypeLabel({ ...dm, partnerDeleted: true, partnerNameRecovered: true }), 'Akun Google dihapus');
});
