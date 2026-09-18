const { google } = require('googleapis');

/**
 * Calendar & Meet integration.
 *
 * Pendekatan production:
 *  - Pakai OAuth2 dengan refresh token milik service account yang di-delegasikan
 *    (domain-wide delegation) ke user organizer — supaya event dibuat sebagai user itu.
 *  - Di development / kalau delegation tidak tersedia, fallback ke service account
 *    tanpa user (event akan muncul di kalender service account).
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   GOOGLE_CALENDAR_DELEGATED_USER  (mis. admin@prakasagroup.com) — opsional
 */

function getAuth(subject) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    subject: subject || process.env.GOOGLE_CALENDAR_DELEGATED_USER || undefined,
  });
}

function calendarClient(subject) {
  return google.calendar({ version: 'v3', auth: getAuth(subject) });
}

/**
 * Buat event + auto-generate Google Meet link.
 */
async function createEvent({
  organizerEmail,
  title,
  description,
  agenda,
  location,
  startTime,
  endTime,
  timezone = 'Asia/Jakarta',
  attendees = [],   // [{email, displayName?}]
  withMeet = true,
}) {
  const cal = calendarClient(organizerEmail);
  const requestBody = {
    summary: title,
    description: [description, agenda].filter(Boolean).join('\n\n'),
    location: location || undefined,
    start: { dateTime: new Date(startTime).toISOString(), timeZone: timezone },
    end: { dateTime: new Date(endTime).toISOString(), timeZone: timezone },
    attendees: attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName || undefined,
    })),
    conferenceData: withMeet
      ? {
          createRequest: {
            requestId: `prakasa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        }
      : undefined,
  };

  const res = await cal.events.insert({
    calendarId: 'primary',
    requestBody,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
  });

  return res.data; // { id, hangoutLink, conferenceData, htmlLink, ... }
}

async function updateEvent({
  organizerEmail,
  eventId,
  title,
  description,
  startTime,
  endTime,
  timezone = 'Asia/Jakarta',
  attendees,
  status, // 'cancelled' untuk cancel
}) {
  const cal = calendarClient(organizerEmail);
  const requestBody = {
    summary: title,
    description,
    start: startTime ? { dateTime: new Date(startTime).toISOString(), timeZone: timezone } : undefined,
    end: endTime ? { dateTime: new Date(endTime).toISOString(), timeZone: timezone } : undefined,
    attendees: attendees ? attendees.map((a) => ({ email: a.email, displayName: a.displayName })) : undefined,
    status,
  };
  const res = await cal.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody,
    sendUpdates: 'all',
  });
  return res.data;
}

async function deleteEvent({ organizerEmail, eventId }) {
  const cal = calendarClient(organizerEmail);
  await cal.events.delete({
    calendarId: 'primary',
    eventId,
    sendUpdates: 'all',
  });
}

async function getEvent({ organizerEmail, eventId }) {
  const cal = calendarClient(organizerEmail);
  const res = await cal.events.get({
    calendarId: 'primary',
    eventId,
  });
  return res.data;
}

module.exports = { createEvent, updateEvent, deleteEvent, getEvent };
