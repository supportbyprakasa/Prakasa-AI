const { randomUUID } = require('crypto');
const { z } = require('zod');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { handleGoogleError } = require('../services/googleUserClient');
const calendar = require('../services/googleCalendarUser.service');

// Native Google Calendar inside Prakasa Workspace. Every call acts as the
// signed-in user (subject = req.user.email) — the client never chooses whose
// calendar is read. All ids, ranges and bodies are whitelisted here before they
// reach Google.

const SERVICE = { service: 'Google Calendar' };
const DEFAULT_TIME_ZONE = 'Asia/Jakarta';
const MAX_RANGE_DAYS = 62;
const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;
// "primary", a user/group calendar ("x@group.calendar.google.com") or a public
// holiday calendar ("en.indonesian#holiday@group.v.calendar.google.com").
const CALENDAR_ID = /^[A-Za-z0-9._%+#-]{1,200}@[A-Za-z0-9.-]{1,200}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const RSVP = ['accepted', 'tentative', 'declined'];

const isValidEventId = (value) => typeof value === 'string' && EVENT_ID.test(value);
const isValidCalendarId = (value) => value === 'primary' || (typeof value === 'string' && value.length <= 254 && CALENDAR_ID.test(value));

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

const ctxOf = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });
const invalid = (res, message) => fail(res, 'VALIDATION_ERROR', message, 400);

function calendarIdFrom(value) {
  const id = value === undefined || value === null || value === '' ? 'primary' : String(value);
  return isValidCalendarId(id) ? id : null;
}

// ── time range ─────────────────────────────────────────────────────────────
// Both bounds are RFC3339 with an offset (what Google requires). A range longer
// than 62 days is clamped, never forwarded as-is.
function parseRange({ timeMin, timeMax } = {}, now = new Date()) {
  if (timeMin === undefined && timeMax === undefined) {
    const start = new Date(now.getTime());
    return { timeMin: start.toISOString(), timeMax: new Date(start.getTime() + 7 * DAY_MS).toISOString(), clamped: false };
  }
  if (typeof timeMin !== 'string' || typeof timeMax !== 'string' || !RFC3339.test(timeMin) || !RFC3339.test(timeMax)) {
    return { error: 'timeMin dan timeMax wajib berformat RFC3339 (mis. 2026-09-28T00:00:00+07:00).' };
  }
  const min = Date.parse(timeMin);
  const max = Date.parse(timeMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { error: 'Rentang waktu tidak valid.' };
  if (max <= min) return { error: 'timeMax harus setelah timeMin.' };
  const limit = min + MAX_RANGE_DAYS * DAY_MS;
  return {
    timeMin: new Date(min).toISOString(),
    timeMax: new Date(Math.min(max, limit)).toISOString(),
    clamped: max > limit,
  };
}

// ── event shape sent to the browser ────────────────────────────────────────
// Google stores descriptions as light HTML. The page shows plain text only, so
// tags are stripped here and the browser linkifies http(s) URLs itself.
function htmlToText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function meetUrlOf(event) {
  const candidates = [
    event.hangoutLink,
    ...((event.conferenceData?.entryPoints || []).filter((p) => p.entryPointType === 'video').map((p) => p.uri)),
  ];
  return candidates.find((uri) => typeof uri === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(uri)) || null;
}

const hasConference = (event) => Boolean(event?.hangoutLink || event?.conferenceData?.conferenceId || event?.conferenceData?.entryPoints?.length);

function normalizeEvent(event, calendarId = 'primary') {
  const organizer = event.organizer || {};
  const isOrganizer = organizer.self === true || (!event.organizer && event.creator?.self === true);
  const attendees = (event.attendees || []).slice(0, 200).map((a) => ({
    email: a.email || '',
    displayName: a.displayName || '',
    responseStatus: a.responseStatus || 'needsAction',
    self: a.self === true,
    organizer: a.organizer === true,
    optional: a.optional === true,
    resource: a.resource === true,
  }));
  const self = attendees.find((a) => a.self);
  return {
    id: event.id,
    calendarId,
    status: event.status || 'confirmed',
    summary: event.summary || '',
    description: htmlToText(event.description),
    location: event.location || '',
    htmlLink: event.htmlLink || null,
    start: { date: event.start?.date || null, dateTime: event.start?.dateTime || null, timeZone: event.start?.timeZone || null },
    end: { date: event.end?.date || null, dateTime: event.end?.dateTime || null, timeZone: event.end?.timeZone || null },
    allDay: Boolean(event.start?.date),
    meetUrl: meetUrlOf(event),
    hasConference: hasConference(event),
    organizer: { email: organizer.email || '', displayName: organizer.displayName || '', self: organizer.self === true },
    attendees,
    attendeesOmitted: event.attendeesOmitted === true,
    selfResponse: self ? self.responseStatus : null,
    isOrganizer,
    canEdit: isOrganizer || event.guestsCanModify === true,
    canDelete: isOrganizer,
    canRespond: Boolean(self) && !isOrganizer,
    recurring: Boolean(event.recurringEventId),
    eventType: event.eventType || 'default',
    transparency: event.transparency || 'opaque',
    visibility: event.visibility || 'default',
    colorId: event.colorId || null,
  };
}

function normalizeCalendar(item) {
  return {
    id: item.id,
    summary: item.summaryOverride || item.summary || item.id,
    primary: item.primary === true,
    backgroundColor: /^#[0-9a-f]{6}$/i.test(item.backgroundColor || '') ? item.backgroundColor : null,
    accessRole: item.accessRole || 'reader',
    selected: item.selected !== false,
    canWrite: ['owner', 'writer'].includes(item.accessRole),
  };
}

// ── create / edit body ─────────────────────────────────────────────────────
const eventBodySchema = z.object({
  calendarId: z.string().max(254).optional(),
  summary: z.string().trim().min(1, 'Judul wajib diisi').max(300),
  description: z.string().max(8000).optional().default(''),
  location: z.string().trim().max(500).optional().default(''),
  allDay: z.boolean().optional().default(false),
  start: z.string().max(40),
  end: z.string().max(40),
  timeZone: z.string().max(64).optional().default(DEFAULT_TIME_ZONE),
  attendees: z.array(z.string().trim().toLowerCase().email().max(254)).max(100).optional().default([]),
  addMeet: z.boolean().optional().default(false),
  notify: z.boolean().optional().default(true),
}).strict();

function comparableMs(value) {
  return Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.length === 16 ? `${value}:00` : value}Z`);
}

// Returns { data } or { error }.
function parseEventBody(body) {
  const parsed = eventBodySchema.safeParse(body || {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Input tidak valid' };
  }
  const data = parsed.data;
  if (!isValidTimeZone(data.timeZone)) return { error: 'Zona waktu tidak dikenal.' };
  if (data.calendarId !== undefined && !isValidCalendarId(data.calendarId)) return { error: 'calendarId tidak valid.' };
  if (data.allDay) {
    if (!DATE_ONLY.test(data.start) || !DATE_ONLY.test(data.end)) return { error: 'Event seharian memakai tanggal YYYY-MM-DD.' };
    if (data.end <= data.start) return { error: 'Tanggal selesai harus setelah tanggal mulai.' };
    if (!Number.isFinite(Date.parse(data.start)) || !Number.isFinite(Date.parse(data.end))) return { error: 'Tanggal tidak valid.' };
  } else {
    if (!LOCAL_DATE_TIME.test(data.start) || !LOCAL_DATE_TIME.test(data.end)) return { error: 'Waktu mulai/selesai tidak valid.' };
    const start = comparableMs(data.start);
    const end = comparableMs(data.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'Waktu mulai/selesai tidak valid.' };
    if (end <= start) return { error: 'Waktu selesai harus setelah waktu mulai.' };
    // Google wants full RFC3339 seconds; "2026-09-28T09:00" → "2026-09-28T09:00:00".
    const withSeconds = (value) => value.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?!:)/, '$1:00');
    data.start = withSeconds(data.start);
    data.end = withSeconds(data.end);
  }
  data.attendees = [...new Set(data.attendees)];
  return { data };
}

function meetCreateRequest() {
  return { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
}

// Builds the Google request body. `existing` (the event as Google returned it)
// is given on edit: attendees keep their RSVP state, the organizer/self rows
// are kept, and an existing Meet is never removed.
function buildEventBody(data, existing = null) {
  const patch = Boolean(existing);
  const time = (value) => (data.allDay
    ? { date: value, ...(patch ? { dateTime: null, timeZone: null } : {}) }
    : { dateTime: value, timeZone: data.timeZone, ...(patch ? { date: null } : {}) });

  const body = {
    summary: data.summary,
    description: data.description || '',
    location: data.location || '',
    start: time(data.start),
    end: time(data.end),
  };

  if (!existing?.attendeesOmitted) {
    const previous = existing?.attendees || [];
    const byEmail = new Map(previous.map((a) => [String(a.email || '').toLowerCase(), a]));
    const kept = previous.filter((a) => a.self || a.organizer || a.resource);
    const chosen = data.attendees.map((email) => byEmail.get(email) || { email });
    const seen = new Set();
    body.attendees = [...kept, ...chosen].filter((a) => {
      const key = String(a.email || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // A new event with no guests doesn't need the organizer row either.
    if (!patch && data.attendees.length === 0) body.attendees = [];
  }

  if (data.addMeet && !hasConference(existing)) body.conferenceData = meetCreateRequest();
  return body;
}

const sendUpdatesOf = (notify) => (notify ? 'all' : 'none');
const activity = (req, action, metadata) => log({
  entityId: req.user.entityId, userId: req.user.sub, action, subjectType: 'calendar_event', metadata,
}).catch(() => {});

function isScopeMissing(error) {
  const message = String(error?.response?.data?.error?.message || error?.response?.data?.error_description || error?.message || '');
  if (/invalid_grant|invalid email or user id/i.test(message)) return false;
  return /unauthorized_client|not authorized for any of the scopes|insufficient authentication scopes|insufficientPermissions/i.test(message)
    || Number(error?.status || error?.code) === 403;
}

// ── handlers ───────────────────────────────────────────────────────────────
async function listCalendars(req, res, next) {
  try {
    const items = await calendar.listCalendars(req.user.email, ctxOf(req));
    const calendars = items.map(normalizeCalendar).sort((a, b) => Number(b.primary) - Number(a.primary));
    return ok(res, { calendars, limited: false });
  } catch (error) {
    // calendar.readonly may not be authorized for this app: the page still
    // works on the user's primary calendar (calendar.events covers that).
    if (isScopeMissing(error)) {
      return ok(res, {
        calendars: [{ id: 'primary', summary: req.user.email, primary: true, backgroundColor: null, accessRole: 'owner', selected: true, canWrite: true }],
        limited: true,
      });
    }
    return handleGoogleError(error, res, next, SERVICE);
  }
}

async function listEvents(req, res, next) {
  try {
    const calendarId = calendarIdFrom(req.query.calendarId);
    if (!calendarId) return invalid(res, 'calendarId tidak valid.');
    const range = parseRange(req.query);
    if (range.error) return invalid(res, range.error);
    const result = await calendar.listEvents(req.user.email, {
      calendarId, timeMin: range.timeMin, timeMax: range.timeMax, timeZone: DEFAULT_TIME_ZONE,
    }, ctxOf(req));
    const events = result.items.filter((e) => e.status !== 'cancelled').map((e) => normalizeEvent(e, calendarId));
    return ok(res, {
      calendarId,
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      clamped: range.clamped,
      truncated: result.truncated,
      timeZone: result.timeZone || DEFAULT_TIME_ZONE,
      events,
    });
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

function eventTarget(req, res, source = req.query) {
  const { eventId } = req.params;
  if (!isValidEventId(eventId)) { invalid(res, 'eventId tidak valid.'); return null; }
  const calendarId = calendarIdFrom(source?.calendarId);
  if (!calendarId) { invalid(res, 'calendarId tidak valid.'); return null; }
  return { eventId, calendarId };
}

async function getEvent(req, res, next) {
  try {
    const target = eventTarget(req, res);
    if (!target) return undefined;
    const event = await calendar.getEvent(req.user.email, target, ctxOf(req));
    return ok(res, normalizeEvent(event, target.calendarId));
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function createEvent(req, res, next) {
  try {
    const { data, error } = parseEventBody(req.body);
    if (error) return invalid(res, error);
    const calendarId = data.calendarId || 'primary';
    const created = await calendar.insertEvent(req.user.email, {
      calendarId,
      requestBody: buildEventBody(data),
      sendUpdates: sendUpdatesOf(data.notify),
      conferenceDataVersion: 1,
    }, ctxOf(req));
    await activity(req, 'google_calendar.create_event', { eventId: created.id, calendarId, attendeeCount: data.attendees.length, withMeet: data.addMeet });
    return ok(res, normalizeEvent(created, calendarId), undefined, 201);
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function updateEvent(req, res, next) {
  try {
    const target = eventTarget(req, res, req.body);
    if (!target) return undefined;
    const { data, error } = parseEventBody(req.body);
    if (error) return invalid(res, error);
    const existing = await calendar.getEvent(req.user.email, target, ctxOf(req));
    if (!normalizeEvent(existing).canEdit) {
      return fail(res, 'FORBIDDEN', 'Hanya penyelenggara yang dapat mengubah event ini.', 403);
    }
    const updated = await calendar.patchEvent(req.user.email, {
      ...target,
      requestBody: buildEventBody(data, existing),
      sendUpdates: sendUpdatesOf(data.notify),
      conferenceDataVersion: 1,
    }, ctxOf(req));
    await activity(req, 'google_calendar.update_event', { eventId: target.eventId, calendarId: target.calendarId });
    return ok(res, normalizeEvent(updated, target.calendarId));
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function deleteEvent(req, res, next) {
  try {
    const target = eventTarget(req, res);
    if (!target) return undefined;
    const existing = await calendar.getEvent(req.user.email, target, ctxOf(req));
    if (!normalizeEvent(existing).canDelete) {
      return fail(res, 'FORBIDDEN', 'Hanya penyelenggara yang dapat menghapus event ini.', 403);
    }
    const notify = req.query.notify === undefined ? true : ['1', 'true'].includes(String(req.query.notify));
    await calendar.deleteEvent(req.user.email, { ...target, sendUpdates: sendUpdatesOf(notify) }, ctxOf(req));
    await activity(req, 'google_calendar.delete_event', { eventId: target.eventId, calendarId: target.calendarId });
    return ok(res, { id: target.eventId, deleted: true });
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

// RSVP: only the caller's own attendee row changes. `attendeesOmitted: true`
// tells Google this body carries just that one row, so the other guests are
// never touched (and large guest lists are never truncated).
async function respondEvent(req, res, next) {
  try {
    const target = eventTarget(req, res, req.body);
    if (!target) return undefined;
    const response = req.body?.response;
    if (!RSVP.includes(response)) return invalid(res, 'response harus accepted, tentative atau declined.');
    const existing = await calendar.getEvent(req.user.email, target, ctxOf(req));
    const self = (existing.attendees || []).find((a) => a.self === true);
    if (!self) return fail(res, 'NOT_INVITED', 'Anda bukan tamu di event ini.', 400);
    if (normalizeEvent(existing).isOrganizer) return fail(res, 'NOT_INVITED', 'Penyelenggara tidak perlu membalas undangan sendiri.', 400);
    const updated = await calendar.patchEvent(req.user.email, {
      ...target,
      requestBody: { attendeesOmitted: true, attendees: [{ ...self, responseStatus: response }] },
      sendUpdates: sendUpdatesOf(req.body?.notify === true),
    }, ctxOf(req));
    await activity(req, 'google_calendar.respond_event', { eventId: target.eventId, calendarId: target.calendarId, response });
    return ok(res, normalizeEvent(updated, target.calendarId));
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

module.exports = {
  listCalendars, listEvents, getEvent, createEvent, updateEvent, deleteEvent, respondEvent,
  // exported for tests
  parseRange, parseEventBody, buildEventBody, normalizeEvent, htmlToText, isValidEventId, isValidCalendarId,
  MAX_RANGE_DAYS,
};
