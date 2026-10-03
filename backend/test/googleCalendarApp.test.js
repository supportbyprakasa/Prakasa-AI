const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const calendar = require('../src/services/googleCalendarUser.service');
const ctrl = require('../src/controllers/googleCalendarApp.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const user = (overrides = {}) => ({ sub: 14, entityId: 1, email: 'me@prakasafoods.com', permissions: [], ...overrides });
const failNext = (e) => { throw e; };

const googleEvent = (overrides = {}) => ({
  id: 'evt123',
  status: 'confirmed',
  summary: 'Rapat mingguan',
  start: { dateTime: '2026-09-28T09:00:00+07:00', timeZone: 'Asia/Jakarta' },
  end: { dateTime: '2026-09-28T10:00:00+07:00', timeZone: 'Asia/Jakarta' },
  organizer: { email: 'me@prakasafoods.com', self: true },
  attendees: [
    { email: 'me@prakasafoods.com', self: true, organizer: true, responseStatus: 'accepted' },
    { email: 'guest@prakasafoods.com', responseStatus: 'tentative' },
  ],
  ...overrides,
});

const validBody = (overrides = {}) => ({
  summary: 'Rapat',
  allDay: false,
  start: '2026-09-28T09:00',
  end: '2026-09-28T10:00',
  attendees: [],
  addMeet: false,
  notify: true,
  ...overrides,
});

test.beforeEach((t) => {
  t.mock.method(pool, 'query', async () => [[]]); // activity + integration logs
});

// ── time range ─────────────────────────────────────────────────────────────
test('parseRange accepts an RFC3339 range and normalizes it to UTC', () => {
  const range = ctrl.parseRange({ timeMin: '2026-09-28T00:00:00+07:00', timeMax: '2026-10-05T00:00:00+07:00' });
  assert.deepEqual(range, { timeMin: '2026-09-27T17:00:00.000Z', timeMax: '2026-10-04T17:00:00.000Z', clamped: false });
});

test('parseRange clamps anything longer than 62 days', () => {
  const range = ctrl.parseRange({ timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-12-31T00:00:00Z' });
  assert.equal(range.clamped, true);
  assert.equal(Date.parse(range.timeMax) - Date.parse(range.timeMin), ctrl.MAX_RANGE_DAYS * 86400000);
});

test('parseRange rejects malformed, offset-less, reversed or half-given ranges', () => {
  assert.ok(ctrl.parseRange({ timeMin: 'yesterday', timeMax: '2026-10-05T00:00:00Z' }).error);
  assert.ok(ctrl.parseRange({ timeMin: '2026-09-28T00:00:00', timeMax: '2026-10-05T00:00:00' }).error);
  assert.ok(ctrl.parseRange({ timeMin: '2026-10-05T00:00:00Z', timeMax: '2026-09-28T00:00:00Z' }).error);
  assert.ok(ctrl.parseRange({ timeMin: '2026-10-05T00:00:00Z' }).error);
  assert.ok(ctrl.parseRange({ timeMin: ['a'], timeMax: '2026-10-05T00:00:00Z' }).error);
});

test('parseRange defaults to one week from now', () => {
  const now = new Date('2026-09-28T02:00:00Z');
  const range = ctrl.parseRange({}, now);
  assert.equal(range.timeMin, '2026-09-28T02:00:00.000Z');
  assert.equal(range.timeMax, '2026-10-05T02:00:00.000Z');
});

// ── ids ────────────────────────────────────────────────────────────────────
test('event and calendar ids are whitelisted', () => {
  assert.equal(ctrl.isValidEventId('abc123_20260928T020000Z'), true);
  assert.equal(ctrl.isValidEventId('../../users/me'), false);
  assert.equal(ctrl.isValidEventId(''), false);
  assert.equal(ctrl.isValidEventId('a'.repeat(1025)), false);
  assert.equal(ctrl.isValidCalendarId('primary'), true);
  assert.equal(ctrl.isValidCalendarId('team@group.calendar.google.com'), true);
  assert.equal(ctrl.isValidCalendarId('en.indonesian#holiday@group.v.calendar.google.com'), true);
  assert.equal(ctrl.isValidCalendarId('../primary'), false);
  assert.equal(ctrl.isValidCalendarId('a/b@c.com'), false);
});

// ── list ───────────────────────────────────────────────────────────────────
test('listEvents reads the caller\'s own primary calendar with the validated range', async (t) => {
  let seen = null;
  t.mock.method(calendar, 'listEvents', async (subject, args) => {
    seen = { subject, args };
    return { items: [googleEvent(), googleEvent({ id: 'gone', status: 'cancelled' })], timeZone: 'Asia/Jakarta', truncated: false };
  });
  const req = { user: user(), query: { timeMin: '2026-09-28T00:00:00+07:00', timeMax: '2026-10-05T00:00:00+07:00', subject: 'boss@prakasafoods.com' } };
  const res = responseDouble();
  await ctrl.listEvents(req, res, failNext);

  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.equal(seen.args.calendarId, 'primary');
  assert.equal(seen.args.timeMin, '2026-09-27T17:00:00.000Z');
  assert.equal(res.body.data.events.length, 1, 'cancelled instances are dropped');
  const [event] = res.body.data.events;
  assert.equal(event.isOrganizer, true);
  assert.equal(event.canEdit, true);
  assert.equal(event.canRespond, false);
});

test('listEvents refuses a bad range or calendar id without calling Google', async (t) => {
  t.mock.method(calendar, 'listEvents', async () => { throw new Error('must not be called'); });
  for (const query of [
    { timeMin: 'x', timeMax: 'y' },
    { calendarId: '../../evil', timeMin: '2026-09-28T00:00:00Z', timeMax: '2026-09-29T00:00:00Z' },
  ]) {
    const res = responseDouble();
    // eslint-disable-next-line no-await-in-loop
    await ctrl.listEvents({ user: user(), query }, res, failNext);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('listEvents reports a clamped range back to the page', async (t) => {
  let seen = null;
  t.mock.method(calendar, 'listEvents', async (subject, args) => { seen = args; return { items: [], truncated: false }; });
  const res = responseDouble();
  await ctrl.listEvents({ user: user(), query: { timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-06-01T00:00:00Z' } }, res, failNext);
  assert.equal(res.body.data.clamped, true);
  assert.equal(seen.timeMax, '2026-03-04T00:00:00.000Z');
});

test('a raw Google 401 never reaches the browser as this route\'s own 401', async (t) => {
  t.mock.method(calendar, 'listEvents', async () => {
    const error = new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
    error.code = 401;
    throw error;
  });
  const res = responseDouble();
  await ctrl.listEvents({ user: user(), query: {} }, res, failNext);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
});

test('listCalendars falls back to the primary calendar when calendar.readonly is not granted', async (t) => {
  t.mock.method(calendar, 'listCalendars', async () => {
    throw new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
  });
  const res = responseDouble();
  await ctrl.listCalendars({ user: user(), query: {} }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.limited, true);
  assert.deepEqual(res.body.data.calendars.map((c) => c.id), ['primary']);
});

test('listCalendars still reports an unlinked Google account clearly', async (t) => {
  t.mock.method(calendar, 'listCalendars', async () => { throw new Error('invalid_grant: Invalid email or User ID'); });
  const res = responseDouble();
  await ctrl.listCalendars({ user: user(), query: {} }, res, failNext);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'GOOGLE_ACCOUNT_NOT_LINKED');
});

test('listCalendars puts the primary calendar first and drops unsafe colours', async (t) => {
  t.mock.method(calendar, 'listCalendars', async () => [
    { id: 'team@group.calendar.google.com', summary: 'Tim', accessRole: 'reader', backgroundColor: 'red;}' },
    { id: 'me@prakasafoods.com', summary: 'Me', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' },
  ]);
  const res = responseDouble();
  await ctrl.listCalendars({ user: user(), query: {} }, res, failNext);
  const [first, second] = res.body.data.calendars;
  assert.equal(first.primary, true);
  assert.equal(first.canWrite, true);
  assert.equal(second.backgroundColor, null);
  assert.equal(second.canWrite, false);
});

// ── create ─────────────────────────────────────────────────────────────────
test('createEvent sends a Meet createRequest with a random requestId and conferenceDataVersion=1', async (t) => {
  const calls = [];
  t.mock.method(calendar, 'insertEvent', async (subject, args) => { calls.push({ subject, args }); return googleEvent({ id: 'new1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }); });
  for (let i = 0; i < 2; i += 1) {
    const res = responseDouble();
    // eslint-disable-next-line no-await-in-loop
    await ctrl.createEvent({ user: user(), body: validBody({ addMeet: true, attendees: ['Guest@PrakasaFoods.com', 'guest@prakasafoods.com'] }) }, res, failNext);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.meetUrl, 'https://meet.google.com/abc-defg-hij');
  }
  const { subject, args } = calls[0];
  assert.equal(subject, 'me@prakasafoods.com');
  assert.equal(args.calendarId, 'primary');
  assert.equal(args.conferenceDataVersion, 1);
  assert.equal(args.sendUpdates, 'all');
  assert.deepEqual(args.requestBody.conferenceData.createRequest.conferenceSolutionKey, { type: 'hangoutsMeet' });
  assert.match(args.requestBody.conferenceData.createRequest.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(args.requestBody.conferenceData.createRequest.requestId, calls[1].args.requestBody.conferenceData.createRequest.requestId);
  assert.deepEqual(args.requestBody.attendees, [{ email: 'guest@prakasafoods.com' }], 'emails are lower-cased and de-duplicated');
  assert.deepEqual(args.requestBody.start, { dateTime: '2026-09-28T09:00:00', timeZone: 'Asia/Jakarta' });
});

test('createEvent without Meet sends no conferenceData and respects notify=false', async (t) => {
  let seen = null;
  t.mock.method(calendar, 'insertEvent', async (subject, args) => { seen = args; return googleEvent(); });
  const res = responseDouble();
  await ctrl.createEvent({ user: user(), body: validBody({ notify: false }) }, res, failNext);
  assert.equal(res.statusCode, 201);
  assert.equal(seen.requestBody.conferenceData, undefined);
  assert.equal(seen.sendUpdates, 'none');
});

test('createEvent builds an all-day event with Google\'s exclusive end date', async (t) => {
  let seen = null;
  t.mock.method(calendar, 'insertEvent', async (subject, args) => { seen = args; return googleEvent(); });
  const res = responseDouble();
  await ctrl.createEvent({ user: user(), body: validBody({ allDay: true, start: '2026-09-28', end: '2026-09-29' }) }, res, failNext);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(seen.requestBody.start, { date: '2026-09-28' });
  assert.deepEqual(seen.requestBody.end, { date: '2026-09-29' });
});

test('createEvent validates the body before calling Google', async (t) => {
  t.mock.method(calendar, 'insertEvent', async () => { throw new Error('must not be called'); });
  const bad = [
    validBody({ summary: '   ' }),
    validBody({ end: '2026-09-28T08:00' }),
    validBody({ attendees: ['not-an-email'] }),
    validBody({ allDay: true, start: '2026-09-28', end: '2026-09-28' }),
    validBody({ timeZone: 'Mars/Olympus' }),
    validBody({ calendarId: '../x' }),
    validBody({ subject: 'boss@prakasafoods.com' }),
  ];
  for (const body of bad) {
    const res = responseDouble();
    // eslint-disable-next-line no-await-in-loop
    await ctrl.createEvent({ user: user(), body }, res, failNext);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

// ── update ─────────────────────────────────────────────────────────────────
test('updateEvent patches as the organizer, keeps RSVP state and never re-creates an existing Meet', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => googleEvent({ hangoutLink: 'https://meet.google.com/x' }));
  let seen = null;
  t.mock.method(calendar, 'patchEvent', async (subject, args) => { seen = { subject, args }; return googleEvent(); });
  const res = responseDouble();
  await ctrl.updateEvent({
    user: user(), params: { eventId: 'evt123' },
    body: validBody({ allDay: true, start: '2026-09-28', end: '2026-09-29', attendees: ['guest@prakasafoods.com', 'new@prakasafoods.com'], addMeet: true }),
  }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.args.eventId, 'evt123');
  assert.equal(seen.args.conferenceDataVersion, 1);
  const body = seen.args.requestBody;
  assert.equal(body.conferenceData, undefined);
  assert.deepEqual(body.start, { date: '2026-09-28', dateTime: null, timeZone: null });
  assert.deepEqual(body.attendees.map((a) => [a.email, a.responseStatus]), [
    ['me@prakasafoods.com', 'accepted'],
    ['guest@prakasafoods.com', 'tentative'],
    ['new@prakasafoods.com', undefined],
  ]);
});

test('updateEvent is refused for a guest who cannot modify the event', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => googleEvent({ organizer: { email: 'boss@prakasafoods.com' } }));
  t.mock.method(calendar, 'patchEvent', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.updateEvent({ user: user(), params: { eventId: 'evt123' }, body: validBody() }, res, failNext);
  assert.equal(res.statusCode, 403);
});

test('updateEvent rejects a malformed event id', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.updateEvent({ user: user(), params: { eventId: 'a/b' }, body: validBody() }, res, failNext);
  assert.equal(res.statusCode, 400);
});

// ── delete ─────────────────────────────────────────────────────────────────
test('deleteEvent deletes as the organizer and notifies guests by default', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => googleEvent());
  let seen = null;
  t.mock.method(calendar, 'deleteEvent', async (subject, args) => { seen = { subject, args }; return { deleted: true }; });
  const res = responseDouble();
  await ctrl.deleteEvent({ user: user(), params: { eventId: 'evt123' }, query: {} }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'me@prakasafoods.com', args: { eventId: 'evt123', calendarId: 'primary', sendUpdates: 'all' } });
});

test('deleteEvent honours notify=0 and refuses non-organizers', async (t) => {
  let seen = null;
  t.mock.method(calendar, 'deleteEvent', async (subject, args) => { seen = args; return { deleted: true }; });
  t.mock.method(calendar, 'getEvent', async () => googleEvent());
  const res = responseDouble();
  await ctrl.deleteEvent({ user: user(), params: { eventId: 'evt123' }, query: { notify: '0' } }, res, failNext);
  assert.equal(seen.sendUpdates, 'none');

  seen = null;
  calendar.getEvent.mock.mockImplementation(async () => googleEvent({ organizer: { email: 'boss@prakasafoods.com' } }));
  const res2 = responseDouble();
  await ctrl.deleteEvent({ user: user(), params: { eventId: 'evt123' }, query: {} }, res2, failNext);
  assert.equal(res2.statusCode, 403);
  assert.equal(seen, null);
});

test('a 404 from Google maps to NOT_FOUND', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => { const e = new Error('Not Found'); e.code = 404; throw e; });
  const res = responseDouble();
  await ctrl.deleteEvent({ user: user(), params: { eventId: 'evt123' }, query: {} }, res, failNext);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

// ── respond ────────────────────────────────────────────────────────────────
const invitedEvent = () => googleEvent({
  organizer: { email: 'boss@prakasafoods.com' },
  attendees: [
    { email: 'boss@prakasafoods.com', organizer: true, responseStatus: 'accepted' },
    { email: 'me@prakasafoods.com', self: true, responseStatus: 'needsAction' },
  ],
});

test('respondEvent patches only the caller\'s own attendee row', async (t) => {
  t.mock.method(calendar, 'getEvent', async () => invitedEvent());
  let seen = null;
  t.mock.method(calendar, 'patchEvent', async (subject, args) => { seen = { subject, args }; return invitedEvent(); });
  const res = responseDouble();
  await ctrl.respondEvent({ user: user(), params: { eventId: 'evt123' }, body: { response: 'tentative' } }, res, failNext);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.deepEqual(seen.args.requestBody, {
    attendeesOmitted: true,
    attendees: [{ email: 'me@prakasafoods.com', self: true, responseStatus: 'tentative' }],
  });
  assert.equal(seen.args.sendUpdates, 'none');
});

test('respondEvent rejects unknown answers and events the caller is not invited to', async (t) => {
  t.mock.method(calendar, 'patchEvent', async () => { throw new Error('must not be called'); });
  t.mock.method(calendar, 'getEvent', async () => invitedEvent());
  const res = responseDouble();
  await ctrl.respondEvent({ user: user(), params: { eventId: 'evt123' }, body: { response: 'maybe' } }, res, failNext);
  assert.equal(res.statusCode, 400);

  calendar.getEvent.mock.mockImplementation(async () => googleEvent({ organizer: { email: 'boss@prakasafoods.com' }, attendees: [{ email: 'x@prakasafoods.com' }] }));
  const res2 = responseDouble();
  await ctrl.respondEvent({ user: user(), params: { eventId: 'evt123' }, body: { response: 'accepted' } }, res2, failNext);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error.code, 'NOT_INVITED');
});

// ── normalization ──────────────────────────────────────────────────────────
test('normalizeEvent strips description HTML and only trusts https video links', () => {
  const event = ctrl.normalizeEvent(googleEvent({
    description: 'Halo<br>lihat <a href="https://x.test">tautan</a> &amp; <script>alert(1)</script>',
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'javascript:alert(1)' }] },
  }));
  assert.equal(event.description, 'Halo\nlihat tautan & alert(1)');
  assert.equal(event.meetUrl, null);
  assert.equal(event.allDay, false);
});
