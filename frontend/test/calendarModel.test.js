import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, mondayOf, viewRange, rangeQuery, rangeTitle, shiftAnchor, zonedParts, todayKey,
  prepareEvent, daySegments, layoutDay, monthGrid, monthCell, agendaGroups, eventTimeLabel,
  rsvpStatus, rsvpLabel, linkify, isValidEmail, splitEmails, emptyForm, formFromEvent, moveStart,
  validateEventForm, toEventPayload, suggestedStart,
} from '../src/pages/calendar/calendarModel.js';
import { statusTone } from '../src/components/statusTone.js';

const timed = (id, start, end, extra = {}) => prepareEvent({ id, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra });
const allDay = (id, start, end) => prepareEvent({ id, summary: id, allDay: true, start: { date: start }, end: { date: end } });

// ── week / range math ──────────────────────────────────────────────────────
test('weeks start on Monday and span seven days', () => {
  assert.equal(mondayOf('2026-09-28'), '2026-09-28'); // Monday
  assert.equal(mondayOf('2026-10-04'), '2026-09-28'); // Sunday
  assert.equal(mondayOf('2026-10-01'), '2026-09-28');
  const week = viewRange('week', '2026-10-01');
  assert.equal(week.startKey, '2026-09-28');
  assert.equal(week.endKey, '2026-10-05');
  assert.equal(week.days.length, 7);
  assert.deepEqual(rangeQuery(week), { timeMin: '2026-09-28T00:00:00+07:00', timeMax: '2026-10-05T00:00:00+07:00' });
});

test('range titles read like Google Calendar in Indonesian', () => {
  assert.equal(rangeTitle('week', '2026-09-30'), '28 Sep – 4 Okt 2026');
  assert.equal(rangeTitle('week', '2026-10-07'), '5 – 11 Okt 2026');
  assert.equal(rangeTitle('week', '2025-12-31'), '29 Des 2025 – 4 Jan 2026');
  assert.equal(rangeTitle('month', '2026-09-28'), 'September 2026');
  assert.equal(rangeTitle('day', '2026-09-28'), 'Senin, 28 Sep 2026');
});

test('prev/next move by the view\'s own unit, including month ends and leap years', () => {
  assert.equal(shiftAnchor('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(shiftAnchor('week', '2026-09-28', -1), '2026-09-21');
  assert.equal(shiftAnchor('month', '2026-01-31', 1), '2026-02-01');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftAnchor('agenda', '2026-09-28', 1), '2026-10-28');
});

test('every view stays within the 62-day API limit', () => {
  for (const view of ['day', 'week', 'month', 'agenda']) {
    for (const anchor of ['2026-02-01', '2026-03-31', '2026-08-15', '2027-02-01']) {
      assert.ok(viewRange(view, anchor).days.length <= 62, `${view} ${anchor}`);
    }
  }
});

test('Jakarta wall-clock time is independent of the browser zone', () => {
  const ms = Date.parse('2026-09-27T17:30:00Z'); // 00:30 on the 28th in Jakarta
  assert.deepEqual(zonedParts(ms), { key: '2026-09-28', minutes: 30 });
  assert.equal(todayKey(ms), '2026-09-28');
});

// ── month grid ─────────────────────────────────────────────────────────────
test('the month grid covers whole Monday-first weeks around the month', () => {
  const weeks = monthGrid('2026-09-15', '2026-09-28');
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].key, '2026-08-31');
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks[4][6].key, '2026-10-04');
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.flat().filter((c) => c.isToday).map((c) => c.key)[0], '2026-09-28');
  assert.equal(monthGrid('2026-02-10').length, 5, 'Feb 2026 starts on a Sunday → 5 rows');
  assert.equal(monthGrid('2026-03-10').length, 6, 'Mar 2026 (Sunday 1st, Tuesday 31st) → 6 rows');
});

test('a month cell shows three events and counts the rest', () => {
  const events = [
    timed('a', '2026-09-28T08:00:00+07:00', '2026-09-28T09:00:00+07:00'),
    timed('b', '2026-09-28T10:00:00+07:00', '2026-09-28T11:00:00+07:00'),
    timed('c', '2026-09-28T12:00:00+07:00', '2026-09-28T13:00:00+07:00'),
    timed('d', '2026-09-28T14:00:00+07:00', '2026-09-28T15:00:00+07:00'),
    allDay('holiday', '2026-09-28', '2026-09-29'),
  ];
  const cell = monthCell(events, '2026-09-28');
  assert.deepEqual(cell.visible.map((e) => e.id), ['holiday', 'a', 'b']);
  assert.equal(cell.more, 2);
  assert.equal(monthCell(events, '2026-09-29').visible.length, 0);
});

// ── day layout ─────────────────────────────────────────────────────────────
test('overlapping events split into columns; separate clusters stay full width', () => {
  const events = [
    timed('a', '2026-09-28T09:00:00+07:00', '2026-09-28T10:00:00+07:00'),
    timed('b', '2026-09-28T09:30:00+07:00', '2026-09-28T10:30:00+07:00'),
    timed('c', '2026-09-28T10:00:00+07:00', '2026-09-28T11:00:00+07:00'), // reuses column 0
    timed('d', '2026-09-28T13:00:00+07:00', '2026-09-28T14:00:00+07:00'),
  ];
  const layout = Object.fromEntries(layoutDay(daySegments(events, '2026-09-28')).map((s) => [s.event.id, s]));
  assert.deepEqual([layout.a.col, layout.a.cols], [0, 2]);
  assert.deepEqual([layout.b.col, layout.b.cols], [1, 2]);
  assert.deepEqual([layout.c.col, layout.c.cols], [0, 2]);
  assert.deepEqual([layout.d.col, layout.d.cols], [0, 1]);
  assert.equal(layout.a.startMin, 540);
  assert.equal(layout.a.endMin, 600);
});

test('three mutually overlapping events get three columns', () => {
  const events = ['a', 'b', 'c'].map((id) => timed(id, '2026-09-28T09:00:00+07:00', '2026-09-28T10:00:00+07:00'));
  const layout = layoutDay(daySegments(events, '2026-09-28'));
  assert.deepEqual(layout.map((s) => s.col).sort(), [0, 1, 2]);
  assert.ok(layout.every((s) => s.cols === 3));
});

test('a timed event crossing midnight is clipped per day; ≥24h events go to the all-day row', () => {
  const late = timed('late', '2026-09-28T23:00:00+07:00', '2026-09-29T01:00:00+07:00');
  const [first] = daySegments([late], '2026-09-28');
  const [second] = daySegments([late], '2026-09-29');
  assert.deepEqual([first.startMin, first.endMin], [1380, 1440]);
  assert.deepEqual([second.startMin, second.endMin], [0, 60]);
  const trip = timed('trip', '2026-09-28T08:00:00+07:00', '2026-09-30T08:00:00+07:00');
  assert.equal(trip.spansRow, true);
  assert.equal(daySegments([trip], '2026-09-29').length, 0);
});

test('an event given in another zone lands at the right Jakarta time', () => {
  const utc = timed('utc', '2026-09-28T02:00:00Z', '2026-09-28T03:00:00Z');
  const [segment] = daySegments([utc], '2026-09-28');
  assert.equal(segment.startMin, 9 * 60);
  assert.equal(eventTimeLabel(utc), 'Senin, 28 Sep 2026 · 09.00 – 10.00');
});

test('agenda groups multi-day all-day events under each day they cover', () => {
  const events = [allDay('cuti', '2026-09-28', '2026-09-30'), timed('x', '2026-10-02T09:00:00+07:00', '2026-10-02T10:00:00+07:00')];
  const groups = agendaGroups(events, viewRange('agenda', '2026-09-28'));
  assert.deepEqual(groups.map((g) => g.key), ['2026-09-28', '2026-09-29', '2026-10-02']);
  assert.equal(eventTimeLabel(events[0]), '28 – 29 Sep 2026 · Seharian');
});

// ── RSVP, links, emails ────────────────────────────────────────────────────
test('RSVP statuses map onto the shared status tones, with calendar labels', () => {
  assert.deepEqual(['accepted', 'declined', 'tentative', 'needsAction', undefined].map(rsvpStatus), ['accepted', 'declined', 'tentative', 'needsaction', 'needsaction']);
  assert.deepEqual(['accepted', 'declined', 'tentative', 'needsAction'].map((s) => statusTone(rsvpStatus(s))), ['success', 'error', 'warning', 'default']);
  assert.equal(rsvpLabel('needsAction'), 'Belum membalas');
});

test('linkify only turns http(s) URLs into links and keeps everything else as text', () => {
  const parts = linkify('Agenda: https://docs.google.com/x?a=1. Lihat <b>javascript:alert(1)</b>');
  assert.deepEqual(parts.filter((p) => p.type === 'link').map((p) => p.href), ['https://docs.google.com/x?a=1']);
  assert.equal(parts.map((p) => p.value).join(''), 'Agenda: https://docs.google.com/x?a=1. Lihat <b>javascript:alert(1)</b>');
  assert.deepEqual(linkify(''), []);
});

test('guest emails are validated and split', () => {
  assert.equal(isValidEmail('a.b@prakasafoods.com'), true);
  assert.equal(isValidEmail('bukan email'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.deepEqual(splitEmails('A@x.com, b@y.co; c@z.id'), ['a@x.com', 'b@y.co', 'c@z.id']);
});

// ── form ───────────────────────────────────────────────────────────────────
test('form ↔ payload: timed and all-day (inclusive end in the form, exclusive for Google)', () => {
  const form = { ...emptyForm('2026-09-28', 540), summary: '  Rapat ', attendees: ['X@prakasafoods.com'], addMeet: true };
  assert.deepEqual(toEventPayload(form), {
    summary: 'Rapat', description: '', location: '', allDay: false,
    start: '2026-09-28T09:00:00', end: '2026-09-28T10:00:00', timeZone: 'Asia/Jakarta',
    attendees: ['x@prakasafoods.com'], addMeet: true, notify: true,
  });
  const day = toEventPayload({ ...form, allDay: true, endDate: '2026-09-29' });
  assert.equal(day.start, '2026-09-28');
  assert.equal(day.end, '2026-09-30');

  const back = formFromEvent(allDay('cuti', '2026-09-28', '2026-09-30'));
  assert.equal(back.endDate, '2026-09-29');
  const edit = formFromEvent(timed('m', '2026-09-28T13:15:00+07:00', '2026-09-28T14:00:00+07:00', {
    hasConference: true,
    attendees: [{ email: 'me@x.com', self: true }, { email: 'Guest@x.com' }],
  }));
  assert.deepEqual([edit.startTime, edit.endTime, edit.meetLocked], ['13:15', '14:00', true]);
  assert.deepEqual(edit.attendees, ['guest@x.com']);
});

test('moving the start keeps the duration, across midnight too', () => {
  const form = emptyForm('2026-09-28', 540);
  assert.deepEqual(
    (({ endDate, endTime }) => [endDate, endTime])(moveStart(form, { startTime: '23:30' })),
    ['2026-09-29', '00:30'],
  );
  const moved = moveStart({ ...form, allDay: true, endDate: '2026-09-29' }, { startDate: '2026-10-01' });
  assert.equal(moved.endDate, '2026-10-02');
});

test('form validation', () => {
  const form = emptyForm('2026-09-28');
  assert.ok(validateEventForm(form).summary);
  assert.ok(validateEventForm({ ...form, summary: 'x', endTime: '08:00' }).endDate);
  assert.ok(validateEventForm({ ...form, summary: 'x', attendees: ['nope'] }).attendees);
  assert.deepEqual(validateEventForm({ ...form, summary: 'x' }), {});
  assert.deepEqual(validateEventForm({ ...form, summary: 'x', allDay: true }), {});
});

test('suggested start is the next half hour today, 09.00 on other days', () => {
  const now = Date.parse('2026-09-28T03:10:00Z'); // 10.10 WIB
  assert.equal(suggestedStart('2026-09-28', now), 10 * 60 + 30);
  assert.equal(suggestedStart('2026-09-29', now), 9 * 60);
});
