const { google } = require('googleapis');
const integrationLog = require('./integrationLog.service');

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

async function createEvent({
  organizerEmail,
  title,
  description,
  agenda,
  location,
  startTime,
  endTime,
  timezone = 'Asia/Jakarta',
  attendees = [],
  withMeet = true,
}, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_calendar',
    operation: 'createEvent',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: {
      organizerEmail,
      title,
      startTime,
      endTime,
      timezone,
      attendeeCount: attendees.length,
      withMeet,
    },
    responseMeta: (result) => ({
      eventId: result?.id,
      hasMeetLink: Boolean(result?.hangoutLink || result?.conferenceData),
    }),
  }, async () => {
    const cal = calendarClient(organizerEmail);
    const requestBody = {
      summary: title,
      description: [description, agenda].filter(Boolean).join('\n\n'),
      location: location || undefined,
      start: { dateTime: new Date(startTime).toISOString(), timeZone: timezone },
      end: { dateTime: new Date(endTime).toISOString(), timeZone: timezone },
      attendees: attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName || undefined,
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

    const response = await cal.events.insert({
      calendarId: 'primary',
      requestBody,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
    });

    return response.data;
  });
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
  status,
}, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_calendar',
    operation: 'updateEvent',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: {
      eventId,
      title,
      startTime,
      endTime,
      timezone,
      attendeeCount: attendees?.length || 0,
      status,
    },
    responseMeta: (result) => ({ eventId: result?.id, status: result?.status }),
  }, async () => {
    const cal = calendarClient(organizerEmail);
    const requestBody = {
      summary: title,
      description,
      start: startTime
        ? { dateTime: new Date(startTime).toISOString(), timeZone: timezone }
        : undefined,
      end: endTime
        ? { dateTime: new Date(endTime).toISOString(), timeZone: timezone }
        : undefined,
      attendees: attendees
        ? attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
          }))
        : undefined,
      status,
    };

    const response = await cal.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody,
      sendUpdates: 'all',
    });

    return response.data;
  });
}

async function deleteEvent({ organizerEmail, eventId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_calendar',
    operation: 'deleteEvent',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { eventId },
  }, async () => {
    const cal = calendarClient(organizerEmail);
    await cal.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });
    return { deleted: true, eventId };
  });
}

async function getEvent({ organizerEmail, eventId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_calendar',
    operation: 'getEvent',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { eventId },
    responseMeta: (result) => ({ eventId: result?.id, status: result?.status }),
  }, async () => {
    const cal = calendarClient(organizerEmail);
    const response = await cal.events.get({
      calendarId: 'primary',
      eventId,
    });
    return response.data;
  });
}

module.exports = { createEvent, updateEvent, deleteEvent, getEvent };
