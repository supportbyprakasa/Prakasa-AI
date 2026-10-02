// acara_kalender_saya (docs/prakasa-ai-rencana.md §9.14): the signed-in user's
// own agenda, read as that user through the Kalender page's service. Nobody
// else's calendar can be asked for, Google can never make the tool throw or
// wait, and the result carries no link, no guest and no description.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const agentTools = require('../src/services/ai/agent/agentTools');
const registry = require('../src/services/aiToolRegistry.service');
const { coverage, EXEMPT } = require('../src/services/ai/agent/moduleCoverage');
const calendarService = require('../src/services/googleCalendarUser.service');
const calendarTools = require('../src/services/ai/agent/tools/calendar');
const { STANDARD_ROLES } = require('../src/config/standardOrganization');

const tool = agentTools.byName.get('acara_kalender_saya');
const PRIVATE = { visibility: 'private' };
// Friday 2 October 2026, 10:00 WIB.
const NOW = Date.parse('2026-10-02T10:00:00+07:00');
const me = { sub: 15, email: 'uji.saya@example.invalid', entityId: 1, departmentId: 5, permissions: ['meeting.view', 'meeting.create'] };

const SECRET = 'SENTINEL';
const googleEvents = () => [
  {
    id: 'evtpagi1', status: 'confirmed', summary: 'Rapat mingguan', location: 'Ruang Rapat 1',
    description: `Agenda ${SECRET} rahasia`, htmlLink: `https://calendar.google.com/${SECRET}`,
    hangoutLink: `https://meet.google.com/${SECRET}`,
    start: { dateTime: '2026-10-02T02:00:00Z' }, end: { dateTime: '2026-10-02T02:30:00Z' },
    organizer: { email: me.email, self: true },
    attendees: [
      { email: me.email, self: true, organizer: true },
      { email: `tamu.${SECRET}@example.invalid`, displayName: `Tamu ${SECRET}` },
      { email: `lain.${SECRET}@example.invalid` },
      { email: `ruang.${SECRET}@resource.calendar.google.com`, resource: true },
    ],
  },
  {
    id: 'evtlibur', status: 'confirmed', summary: 'Cuti bersama',
    start: { date: '2026-10-05' }, end: { date: '2026-10-07' },
    organizer: { email: `orang.${SECRET}@example.invalid` },
  },
  { id: 'evtbatal', status: 'cancelled', summary: 'Batal', start: { dateTime: '2026-10-03T02:00:00Z' }, end: { dateTime: '2026-10-03T03:00:00Z' } },
];

test('the tool contract: own agenda, private only, the Kalender page permission, no input that names a person or a calendar', () => {
  assert.ok(tool, 'acara_kalender_saya is registered');
  assert.deepEqual([...tool.module], ['calendar']);
  assert.equal(tool.permission, registry.TOOLS_BY_KEY.get('calendar').readPermission);
  assert.equal(tool.permission, 'meeting.view');
  assert.equal(tool.privateOnly, true);
  assert.notEqual(tool.money, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['hanya_hari_ini', 'hari']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.hari.maximum, 31);
  assert.match(tool.description, /Tidak pernah kalender orang lain/);
  // Not in a shared conversation, not with web research, not without the permission.
  const names = (user, session) => agentTools.toolsFor(user, session).map((t) => t.name);
  assert.ok(names(me, PRIVATE).includes('acara_kalender_saya'));
  assert.equal(names(me, { visibility: 'shared' }).includes('acara_kalender_saya'), false);
  assert.equal(names(me, { visibility: 'private', web_research: 1 }).includes('acara_kalender_saya'), false);
  assert.equal(names({ ...me, permissions: [] }, PRIVATE).includes('acara_kalender_saya'), false);
});

test('without meeting.view the tool answers 403 and Google is never asked', async (t) => {
  const listEvents = t.mock.method(calendarService, 'listEvents', async () => ({ items: [] }));
  await assert.rejects(() => tool.run({ ...me, permissions: ['task.view'] }, {}), (error) => error.status === 403);
  assert.equal(listEvents.mock.callCount(), 0);
});

test("no other user's calendar can be read: the subject is always the signed-in user's own email and the calendar is always primary", async (t) => {
  const listEvents = t.mock.method(calendarService, 'listEvents', async () => ({ items: [], truncated: false }));
  const others = [
    { email: 'orang.lain@example.invalid' }, { subject: 'orang.lain@example.invalid' }, { pengguna: 'orang.lain@example.invalid' },
    { calendarId: 'orang.lain@example.invalid' }, { calendar_id: 'tim@group.calendar.google.com' }, { kalender: 'orang.lain@example.invalid' },
    { user: { email: 'orang.lain@example.invalid' } }, { hari: 7, email: 'orang.lain@example.invalid' },
  ];
  for (const input of others) {
    // Through the sealed run() (what the agent calls) and the tool's own function.
    await tool.run(me, input);
    await tool.impl(me, input, { now: NOW });
  }
  assert.equal(listEvents.mock.callCount(), others.length * 2);
  for (const call of listEvents.mock.calls) {
    const [subject, query, ctx] = call.arguments;
    assert.equal(subject, me.email);
    assert.equal(query.calendarId, 'primary');
    assert.deepEqual(Object.keys(query).sort(), ['calendarId', 'timeMax', 'timeMin', 'timeZone']);
    assert.deepEqual(ctx, { entityId: me.entityId, userId: me.sub });
    assert.doesNotMatch(JSON.stringify(call.arguments), /orang\.lain|group\.calendar/);
  }
  // A second user reads their own, never the first user's.
  const other = { ...me, sub: 16, email: 'uji.kedua@example.invalid' };
  await tool.run(other, {});
  assert.equal(listEvents.mock.calls.at(-1).arguments[0], other.email);
  // No account email: nothing is asked (never a default subject).
  const before = listEvents.mock.callCount();
  assert.equal((await tool.run({ ...me, email: '' }, {})).tersedia, false);
  assert.equal((await tool.run({ ...me, email: undefined }, {})).tersedia, false);
  assert.equal(listEvents.mock.callCount(), before);
  // Statically: the only service calls are listEvents with user.email and 'primary'.
  const code = fs.readFileSync(path.join(agentTools.TOOLS_DIR, 'calendar.js'), 'utf8');
  assert.deepEqual([...code.matchAll(/\bcalendar\.(\w+)\(/g)].map((m) => m[1]), ['listEvents']);
  assert.match(code, /calendarId: 'primary'/);
  assert.doesNotMatch(code, /input\.(email|subject|calendar|kalender|pengguna)/i);
  assert.doesNotMatch(code, /insertEvent|patchEvent|deleteEvent|listCalendars|getEvent|db\/pool|\.query\(/);
});

test('the range: 7 WIB days from today by default, "hanya_hari_ini" one day, never more than 31', async (t) => {
  const listEvents = t.mock.method(calendarService, 'listEvents', async () => ({ items: [], truncated: false }));
  const range = async (input) => {
    const out = await tool.impl(me, input, { now: NOW });
    const query = listEvents.mock.calls.at(-1).arguments[1];
    return [query.timeMin, query.timeMax, out.rentang.dari, out.rentang.sampai];
  };
  assert.deepEqual(await range({}), ['2026-10-01T17:00:00.000Z', '2026-10-08T17:00:00.000Z', '2026-10-02', '2026-10-08']);
  assert.deepEqual(await range({ hanya_hari_ini: true }), ['2026-10-01T17:00:00.000Z', '2026-10-02T17:00:00.000Z', '2026-10-02', '2026-10-02']);
  assert.deepEqual(await range({ hanya_hari_ini: true, hari: 20 }), ['2026-10-01T17:00:00.000Z', '2026-10-02T17:00:00.000Z', '2026-10-02', '2026-10-02']);
  assert.deepEqual(await range({ hari: 31 }), ['2026-10-01T17:00:00.000Z', '2026-11-01T17:00:00.000Z', '2026-10-02', '2026-11-01']);
  assert.deepEqual(await range({ hari: 400 }), await range({ hari: 31 }));
  assert.deepEqual(await range({ hari: 'banyak' }), await range({}));
  assert.equal(listEvents.mock.calls.at(-1).arguments[1].timeZone, 'Asia/Jakarta');
});

test('what an event carries: title, WIB times, place, Meet yes/no, guest COUNT, id and route — never the link, a guest, or the description', async (t) => {
  t.mock.method(calendarService, 'listEvents', async () => ({ items: googleEvents(), truncated: false }));
  const out = await tool.run(me, {});
  // (the sealed run uses the real clock: "sudah_selesai" is not compared here)
  const fixed = await tool.impl(me, {}, { now: NOW });
  assert.equal(fixed.tersedia, true);
  assert.deepEqual([fixed.jumlah, fixed.ditampilkan], [2, 2], 'the cancelled event is left out');
  assert.deepEqual(fixed.acara[0], {
    id: 'evtpagi1',
    judul: 'Rapat mingguan',
    seharian: false,
    mulai: '2026-10-02 09:00 WIB',
    selesai: '2026-10-02 09:30 WIB',
    lokasi: 'Ruang Rapat 1',
    ada_meet: true,
    jumlah_tamu: 2,
    berulang: false,
    sudah_selesai: true,
    boleh_diubah: true,
    rute: '/calendar?ubah=evtpagi1',
  });
  assert.deepEqual(fixed.acara[1], {
    id: 'evtlibur',
    judul: 'Cuti bersama',
    seharian: true,
    mulai: '2026-10-05',
    selesai: '2026-10-06',
    lokasi: null,
    ada_meet: false,
    jumlah_tamu: 0,
    berulang: false,
    sudah_selesai: false,
    boleh_diubah: false,
    rute: null,
  });
  for (const result of [out, fixed]) {
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, new RegExp(SECRET), 'no description, link, or guest leaves the tool');
    assert.doesNotMatch(json, /https?:|meet\.google|@/);
    assert.doesNotMatch(json, /email|tamu\.|deskripsi|description|attendees|hangout/i);
  }
  // Read-only user: the event is listed, but there is no edit route.
  const reader = await tool.impl({ ...me, permissions: ['meeting.view'] }, {}, { now: NOW });
  assert.deepEqual(reader.acara.map((e) => [e.boleh_diubah, e.rute]), [[false, null], [false, null]]);
  // An id too long for a route is not offered as one.
  const long = 'a'.repeat(101);
  calendarService.listEvents.mock.mockImplementation(async () => ({ items: [{ ...googleEvents()[0], id: long }] }));
  assert.deepEqual((await tool.impl(me, {}, { now: NOW })).acara.map((e) => [e.id, e.rute]), [[null, null]]);
});

test('a long agenda is cut to 50 events and says so', async (t) => {
  const many = Array.from({ length: 80 }, (_, i) => ({
    id: `evt${i}`, summary: `Acara ${i}`, start: { dateTime: '2026-10-03T02:00:00Z' }, end: { dateTime: '2026-10-03T03:00:00Z' },
  }));
  t.mock.method(calendarService, 'listEvents', async () => ({ items: many, truncated: false }));
  const out = await tool.run(me, { hari: 31 });
  assert.deepEqual([out.jumlah, out.ditampilkan, out.acara.length], [80, 50, 50]);
  assert.match(out.catatan, /Hanya 50 acara pertama/);
});

test('a Google failure of any kind is "tidak tersedia" with a note: never a throw, never a wait', async (t) => {
  const failures = {
    rejects: async () => { throw Object.assign(new Error('invalid_grant'), { code: 401 }); },
    'has no scope': async () => { throw Object.assign(new Error('unauthorized_client'), { status: 403 }); },
    throws: () => { throw new Error('Google client not configured'); },
    'answers nothing': async () => undefined,
    'answers a wrong shape': async () => ({ items: 'bukan daftar' }),
  };
  const listEvents = t.mock.method(calendarService, 'listEvents', async () => ({ items: [] }));
  for (const [label, impl] of Object.entries(failures)) {
    listEvents.mock.mockImplementation(impl);
    const out = await tool.run(me, {});
    assert.equal(out.tersedia, false, `when Google ${label}`);
    assert.match(out.catatan, /Kalender belum bisa dibaca/);
    assert.deepEqual(Object.keys(out).sort(), ['catatan', 'tersedia'], 'nothing else is returned, nothing guessed');
  }
  // Google that never answers: the wait ends by itself.
  listEvents.mock.mockImplementation(() => new Promise(() => {}));
  const started = Date.now();
  const late = await tool.impl(me, {}, { now: NOW, waitMs: 30 });
  assert.equal(late.tersedia, false);
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(await calendarTools.orUnavailable(() => new Promise(() => {}), 30), { ok: false });
  assert.match(fs.readFileSync(path.join(agentTools.TOOLS_DIR, 'calendar.js'), 'utf8'), /GOOGLE_WAIT_MS = 12000/);
});

test('Kalender is served by the tool (no longer exempt), and every standard role that opens it sees the agenda starters', () => {
  const { covered, problems, missing } = coverage();
  assert.deepEqual(covered.calendar, ['acara_kalender_saya']);
  assert.equal('calendar' in EXEMPT, false);
  assert.deepEqual([problems, missing], [[], []]);
  // Mail, chat and files stay unread.
  for (const key of ['google-mail', 'google-chat', 'google-docs', 'google-sheets', 'google-slides', 'my-drive']) {
    assert.ok(key in EXEMPT && !covered[key], key);
  }
  const entry = registry.TOOLS_BY_KEY.get('calendar');
  assert.equal(entry.publishesState, false, 'the page still sends nothing of its content');
  let opened = 0;
  for (const role of STANDARD_ROLES) {
    const user = { permissions: [...role.permissions] };
    if (!registry.canRead(user, entry)) continue;
    opened += 1;
    const shown = registry.startersFor(entry, role.level, user);
    assert.ok(shown.includes('Apa jadwal saya hari ini?'), role.key);
    assert.ok(shown.includes('Jadwal saya minggu ini apa saja?'), role.key);
  }
  assert.ok(opened > 0);
  // A user without the tool never sees them.
  assert.equal(registry.startersFor(entry, 'member', { permissions: [] }).includes('Apa jadwal saya hari ini?'), false);
});
