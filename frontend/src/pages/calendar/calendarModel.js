import { MONTHS_SHORT, MONTHS_LONG, WEEKDAYS_SHORT, WEEKDAYS_LONG } from '../../i18n/names.js';
// Pure date/layout logic for the native Google Calendar page. Everything is in
// Asia/Jakarta wall-clock time (UTC+7, no daylight saving), independent of the
// browser's own time zone. Days are "YYYY-MM-DD" keys; weeks start on Monday.

export const TIME_ZONE = 'Asia/Jakarta';
const OFFSET = '+07:00';
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DAY_MINUTES = 24 * 60;
export const AGENDA_DAYS = 30;
export const MONTH_CHIP_LIMIT = 3;

export { WEEKDAYS_SHORT };

export const VIEWS = [
  { id: 'day', label: 'Hari' },
  { id: 'week', label: 'Minggu' },
  { id: 'month', label: 'Bulan' },
  { id: 'agenda', label: 'Agenda' },
];
export const isView = (value) => VIEWS.some((v) => v.id === value);

// ── day keys ───────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const utcDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const keyOfUtc = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
export const isDayKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && keyOfUtc(utcDate(value)) === value;

export function addDays(key, days) {
  const date = utcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyOfUtc(date);
}
export function addMonths(key, months) {
  const date = utcDate(key);
  return keyOfUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}
export const weekday = (key) => utcDate(key).getUTCDay(); // 0 = Sunday
export const mondayOf = (key) => addDays(key, -((weekday(key) + 6) % 7));
export const daysBetween = (a, b) => Math.round((utcDate(b) - utcDate(a)) / DAY_MS);
const monthStart = (key) => `${key.slice(0, 7)}-01`;

// Instant → Jakarta day key + minutes since Jakarta midnight.
export function zonedParts(ms) {
  const shifted = new Date(ms + OFFSET_MS);
  return { key: keyOfUtc(shifted), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
export const todayKey = (now = Date.now()) => zonedParts(now).key;
export const dayStartMs = (key) => utcDate(key).getTime() - OFFSET_MS;

// ── ranges ─────────────────────────────────────────────────────────────────
export function viewRange(view, anchor) {
  let startKey;
  let count;
  if (view === 'day') { startKey = anchor; count = 1; }
  else if (view === 'week') { startKey = mondayOf(anchor); count = 7; }
  else if (view === 'month') {
    const first = monthStart(anchor);
    startKey = mondayOf(first);
    const last = addDays(addMonths(first, 1), -1);
    count = daysBetween(startKey, addDays(mondayOf(last), 7));
  } else { startKey = anchor; count = AGENDA_DAYS; }
  const days = Array.from({ length: count }, (_, i) => addDays(startKey, i));
  return { view, startKey, endKey: addDays(startKey, count), days };
}

export const rangeQuery = (range) => ({
  timeMin: `${range.startKey}T00:00:00${OFFSET}`,
  timeMax: `${range.endKey}T00:00:00${OFFSET}`,
});

export function shiftAnchor(view, anchor, direction) {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  if (view === 'month') return addMonths(anchor, direction);
  return addDays(anchor, AGENDA_DAYS * direction);
}

const dayNum = (key) => Number(key.slice(8, 10));
const monthIdx = (key) => Number(key.slice(5, 7)) - 1;
const yearOf = (key) => key.slice(0, 4);
export const monthShort = (key) => MONTHS_SHORT[monthIdx(key)];

export function formatDay(key, { weekdayStyle = 'long', year = true } = {}) {
  const wd = weekdayStyle ? `${(weekdayStyle === 'short' ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[weekday(key)]}, ` : '';
  return `${wd}${dayNum(key)} ${MONTHS_SHORT[monthIdx(key)]}${year ? ` ${yearOf(key)}` : ''}`;
}

// "28 Sep – 4 Okt 2026", "5 – 11 Okt 2026", "29 Des 2025 – 4 Jan 2026".
export function formatSpan(firstKey, lastKey) {
  if (firstKey === lastKey) return formatDay(firstKey, { weekdayStyle: null });
  if (yearOf(firstKey) !== yearOf(lastKey)) return `${formatDay(firstKey, { weekdayStyle: null })} – ${formatDay(lastKey, { weekdayStyle: null })}`;
  if (monthIdx(firstKey) !== monthIdx(lastKey)) return `${dayNum(firstKey)} ${MONTHS_SHORT[monthIdx(firstKey)]} – ${formatDay(lastKey, { weekdayStyle: null })}`;
  return `${dayNum(firstKey)} – ${formatDay(lastKey, { weekdayStyle: null })}`;
}

export function rangeTitle(view, anchor) {
  if (view === 'day') return formatDay(anchor);
  if (view === 'month') return `${MONTHS_LONG[monthIdx(anchor)]} ${yearOf(anchor)}`;
  const range = viewRange(view, anchor);
  return formatSpan(range.startKey, addDays(range.endKey, -1));
}

// ── events ─────────────────────────────────────────────────────────────────
// Adds startMs/endMs (all-day: Jakarta midnights of its dates) and a flag for
// events shown in the all-day row (all-day, or timed and ≥ 24 hours long).
export function prepareEvent(event) {
  const allDay = Boolean(event.allDay || event.start?.date);
  const startMs = allDay ? dayStartMs(event.start.date) : Date.parse(event.start?.dateTime);
  let endMs = allDay ? dayStartMs(event.end?.date || addDays(event.start.date, 1)) : Date.parse(event.end?.dateTime);
  if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + (allDay ? DAY_MS : 30 * 60 * 1000);
  return { ...event, allDay, startMs, endMs, spansRow: allDay || endMs - startMs >= DAY_MS };
}

export const sortEvents = (list) => [...list].sort((a, b) => (
  Number(b.spansRow) - Number(a.spansRow) || a.startMs - b.startMs || (b.endMs - b.startMs) - (a.endMs - a.startMs)
  || String(a.summary).localeCompare(String(b.summary))
));

export const overlapsDay = (event, key) => event.startMs < dayStartMs(addDays(key, 1)) && event.endMs > dayStartMs(key);
export const eventsOnDay = (events, key) => sortEvents(events.filter((e) => overlapsDay(e, key)));

// Timed pieces of each event inside one day, clipped to that day, in minutes.
export function daySegments(events, key) {
  const start = dayStartMs(key);
  return events
    .filter((e) => !e.spansRow && overlapsDay(e, key))
    .map((event) => ({
      event,
      startMin: Math.max(0, Math.round((event.startMs - start) / 60000)),
      endMin: Math.min(DAY_MINUTES, Math.round((event.endMs - start) / 60000)),
    }));
}

// Google-style overlap layout: events that overlap (directly or through a
// chain) form a cluster; each takes the first free column and the cluster's
// width is split by its column count. `minMinutes` keeps tiny events tappable.
export function layoutDay(segments, minMinutes = 20) {
  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed = [];
  let cluster = [];
  let columns = [];
  let clusterEnd = -1;
  const flush = () => {
    cluster.forEach((item) => { item.cols = columns.length; });
    placed.push(...cluster);
    cluster = [];
    columns = [];
  };
  for (const segment of sorted) {
    const visualEnd = Math.max(segment.endMin, segment.startMin + minMinutes);
    if (cluster.length && segment.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
    let col = columns.findIndex((end) => end <= segment.startMin);
    if (col === -1) { col = columns.length; columns.push(visualEnd); } else columns[col] = visualEnd;
    cluster.push({ ...segment, visualEnd, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  if (cluster.length) flush();
  return placed;
}

export function monthGrid(anchor, today = todayKey()) {
  const range = viewRange('month', anchor);
  const month = anchor.slice(0, 7);
  const cells = range.days.map((key) => ({ key, day: dayNum(key), inMonth: key.startsWith(month), isToday: key === today }));
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

export function monthCell(events, key, limit = MONTH_CHIP_LIMIT) {
  const all = eventsOnDay(events, key);
  return { visible: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export function agendaGroups(events, range) {
  return range.days
    .map((key) => ({ key, events: eventsOnDay(events, key) }))
    .filter((group) => group.events.length > 0);
}

export function formatClock(ms) {
  const { minutes } = zonedParts(ms);
  return `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}`;
}

export function eventTimeLabel(event) {
  const e = event.startMs === undefined ? prepareEvent(event) : event;
  if (e.allDay) {
    const lastKey = addDays(e.end?.date || e.start.date, -1);
    return lastKey <= e.start.date ? `${formatDay(e.start.date)} · Seharian` : `${formatSpan(e.start.date, lastKey)} · Seharian`;
  }
  const s = zonedParts(e.startMs);
  const f = zonedParts(e.endMs);
  if (s.key === f.key || (f.minutes === 0 && addDays(s.key, 1) === f.key)) {
    return `${formatDay(s.key)} · ${formatClock(e.startMs)} – ${formatClock(e.endMs)}`;
  }
  return `${formatDay(s.key, { weekdayStyle: 'short' })} ${formatClock(e.startMs)} – ${formatDay(f.key, { weekdayStyle: 'short' })} ${formatClock(e.endMs)}`;
}

// Time shown on a chip in the month/agenda views.
export function chipTime(event, key) {
  if (event.spansRow) return 'Seharian';
  const s = zonedParts(event.startMs);
  return s.key === key ? formatClock(event.startMs) : '00.00';
}

export const nowMinutes = (now = Date.now()) => zonedParts(now).minutes;

// ── RSVP ───────────────────────────────────────────────────────────────────
// The attendee's response as a StatusBadge key: statusTone.js lists the
// Google values lower-cased (accepted / tentative / declined / needsaction).
export function rsvpStatus(status) {
  return String(status || 'needsAction').toLowerCase();
}
export function rsvpLabel(status) {
  switch (status) {
    case 'accepted': return 'Ya';
    case 'declined': return 'Tidak';
    case 'tentative': return 'Mungkin';
    default: return 'Belum membalas';
  }
}
export const RSVP_CHOICES = [
  { value: 'accepted', label: 'Ya' },
  { value: 'tentative', label: 'Mungkin' },
  { value: 'declined', label: 'Tidak' },
];

// ── description → safe segments (rendered as React text + <a>, never HTML) ─
export function linkify(text) {
  const segments = [];
  const source = String(text || '');
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    let url = match[0];
    const trailing = url.match(/[.,;:!?)\]]+$/);
    if (trailing) url = url.slice(0, -trailing[0].length);
    if (match.index > last) segments.push({ type: 'text', value: source.slice(last, match.index) });
    segments.push({ type: 'link', value: url, href: url });
    last = match.index + url.length;
  }
  if (last < source.length) segments.push({ type: 'text', value: source.slice(last) });
  return segments;
}

// ── create / edit form ─────────────────────────────────────────────────────
const EMAIL = /^[^\s@<>(),;:"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const isValidEmail = (value) => EMAIL.test(String(value || '').trim());
export const splitEmails = (text) => String(text || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

const hhmm = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const toMinutes = (value) => { const [h, m] = String(value).split(':').map(Number); return h * 60 + m; };

export function emptyForm(dayKey, startMinutes = 9 * 60) {
  const start = Math.min(Math.max(0, startMinutes), DAY_MINUTES - 60);
  return {
    summary: '', allDay: false,
    startDate: dayKey, startTime: hhmm(start),
    endDate: dayKey, endTime: hhmm(start + 60),
    location: '', description: '', attendees: [],
    addMeet: false, meetLocked: false, notify: true,
  };
}

// Suggested start for "Buat event" on a given day: the next half hour when it
// is today, 09.00 otherwise.
export function suggestedStart(dayKey, now = Date.now()) {
  const parts = zonedParts(now);
  if (parts.key !== dayKey) return 9 * 60;
  return Math.min(DAY_MINUTES - 60, Math.ceil((parts.minutes + 1) / 30) * 30);
}

export function formFromEvent(event) {
  const e = event.startMs === undefined ? prepareEvent(event) : event;
  const base = {
    summary: e.summary || '', location: e.location || '', description: e.description || '',
    attendees: (e.attendees || []).filter((a) => !a.self && !a.organizer && !a.resource).map((a) => a.email.toLowerCase()),
    addMeet: Boolean(e.hasConference || e.meetUrl), meetLocked: Boolean(e.hasConference || e.meetUrl), notify: true,
  };
  if (e.allDay) {
    return { ...base, allDay: true, startDate: e.start.date, endDate: addDays(e.end?.date || addDays(e.start.date, 1), -1), startTime: '09:00', endTime: '10:00' };
  }
  const s = zonedParts(e.startMs);
  const f = zonedParts(e.endMs);
  return { ...base, allDay: false, startDate: s.key, startTime: hhmm(s.minutes), endDate: f.key, endTime: hhmm(f.minutes) };
}

const formStart = (form) => (form.allDay ? `${form.startDate}` : `${form.startDate}T${form.startTime}`);
const formEnd = (form) => (form.allDay ? `${form.endDate}` : `${form.endDate}T${form.endTime}`);

// When the start moves, the end moves with it (same duration), like Google.
export function moveStart(form, patch) {
  const next = { ...form, ...patch };
  if (!isDayKey(form.startDate) || !isDayKey(next.startDate) || !isDayKey(form.endDate)) return next;
  if (next.allDay) {
    next.endDate = addDays(form.endDate, daysBetween(form.startDate, next.startDate));
    return next;
  }
  const valid = (time) => /^\d{2}:\d{2}$/.test(time || '');
  if (!valid(form.startTime) || !valid(next.startTime) || !valid(form.endTime)) return next;
  const at = (date, time) => daysBetween(form.startDate, date) * DAY_MINUTES + toMinutes(time);
  const duration = at(form.endDate, form.endTime) - at(form.startDate, form.startTime);
  const end = at(next.startDate, next.startTime) + (duration > 0 ? duration : 60);
  next.endDate = addDays(form.startDate, Math.floor(end / DAY_MINUTES));
  next.endTime = hhmm(((end % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES);
  return next;
}

export function validateEventForm(form) {
  const errors = {};
  if (!String(form.summary || '').trim()) errors.summary = 'Judul wajib diisi';
  if (!isDayKey(form.startDate)) errors.startDate = 'Tanggal mulai tidak valid';
  if (!isDayKey(form.endDate)) errors.endDate = 'Tanggal selesai tidak valid';
  if (!form.allDay) {
    if (!/^\d{2}:\d{2}$/.test(form.startTime || '')) errors.startTime = 'Jam mulai tidak valid';
    if (!/^\d{2}:\d{2}$/.test(form.endTime || '')) errors.endTime = 'Jam selesai tidak valid';
  }
  if (!errors.startDate && !errors.endDate && !errors.startTime && !errors.endTime) {
    const bad = form.allDay ? formEnd(form) < formStart(form) : formEnd(form) <= formStart(form);
    if (bad) errors.endDate = form.allDay ? 'Tanggal selesai tidak boleh sebelum tanggal mulai' : 'Waktu selesai harus setelah waktu mulai';
  }
  const wrong = (form.attendees || []).filter((email) => !isValidEmail(email));
  if (wrong.length) errors.attendees = `Email tidak valid: ${wrong.join(', ')}`;
  if ((form.attendees || []).length > 100) errors.attendees = 'Maksimal 100 tamu';
  return errors;
}

// API body. All-day end is inclusive in the form, exclusive for Google.
export function toEventPayload(form) {
  return {
    summary: String(form.summary || '').trim(),
    description: form.description || '',
    location: String(form.location || '').trim(),
    allDay: Boolean(form.allDay),
    start: form.allDay ? form.startDate : `${form.startDate}T${form.startTime}:00`,
    end: form.allDay ? addDays(form.endDate, 1) : `${form.endDate}T${form.endTime}:00`,
    timeZone: TIME_ZONE,
    attendees: [...new Set((form.attendees || []).map((e) => e.toLowerCase()))],
    addMeet: Boolean(form.addMeet),
    notify: Boolean(form.notify),
  };
}
