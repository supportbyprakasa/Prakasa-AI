const { google } = require('googleapis');
const { userAuth } = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');

// The native "Calendar" page: every call impersonates the signed-in user
// (subject = their own Workspace email) through domain-wide delegation, so a
// user only ever reads or changes their own calendar. Separate from
// googleCalendar.service.js, which other modules use to create meeting events.
//
// Scopes: calendar.events covers events on every calendar the user can reach.
// Listing the user's calendars needs calendar.readonly — when that scope isn't
// authorized in Admin Console the controller falls back to "primary" only.
const EVENTS_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const LIST_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const MAX_PAGES = 4; // 4 × 250 events per request range — plenty for ≤ 62 days.

function calendarClient(subject, scopes = EVENTS_SCOPES) {
  return google.calendar({ version: 'v3', auth: userAuth(subject, scopes) });
}

const logCtx = (ctx, operation, requestMeta, responseMeta) => ({
  entityId: ctx.entityId || null,
  userId: ctx.userId || null,
  provider: 'google_calendar_user',
  operation,
  requestMeta,
  responseMeta,
});

async function listCalendars(subject, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'listCalendars', { subject }, (items) => ({ count: items?.length || 0 })), async () => {
    const response = await calendarClient(subject, LIST_SCOPES).calendarList.list({
      maxResults: 100,
      minAccessRole: 'reader',
      fields: 'items(id,summary,summaryOverride,primary,backgroundColor,foregroundColor,accessRole,selected,hidden,timeZone)',
    });
    return response.data.items || [];
  });
}

async function listEvents(subject, { calendarId, timeMin, timeMax, timeZone }, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'listEvents', { subject, calendarId, timeMin, timeMax }, (result) => ({ count: result?.items?.length || 0, truncated: Boolean(result?.truncated) })), async () => {
    const cal = calendarClient(subject);
    const items = [];
    let pageToken;
    let pages = 0;
    let calendarTimeZone = null;
    do {
      // eslint-disable-next-line no-await-in-loop
      const response = await cal.events.list({
        calendarId,
        timeMin,
        timeMax,
        timeZone,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        pageToken,
      });
      items.push(...(response.data.items || []));
      calendarTimeZone = calendarTimeZone || response.data.timeZone || null;
      pageToken = response.data.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_PAGES);
    return { items, timeZone: calendarTimeZone, truncated: Boolean(pageToken) };
  });
}

async function getEvent(subject, { calendarId, eventId }, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'getEvent', { subject, calendarId, eventId }, (result) => ({ id: result?.id })), async () => {
    const response = await calendarClient(subject).events.get({ calendarId, eventId });
    return response.data;
  });
}

async function insertEvent(subject, { calendarId, requestBody, sendUpdates, conferenceDataVersion }, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'insertEvent', {
    subject, calendarId, sendUpdates, attendeeCount: requestBody.attendees?.length || 0, withMeet: Boolean(requestBody.conferenceData),
  }, (result) => ({ id: result?.id, hasMeetLink: Boolean(result?.hangoutLink) })), async () => {
    const response = await calendarClient(subject).events.insert({ calendarId, requestBody, sendUpdates, conferenceDataVersion });
    return response.data;
  });
}

async function patchEvent(subject, { calendarId, eventId, requestBody, sendUpdates, conferenceDataVersion }, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'patchEvent', {
    subject, calendarId, eventId, sendUpdates, fields: Object.keys(requestBody || {}),
  }, (result) => ({ id: result?.id })), async () => {
    const response = await calendarClient(subject).events.patch({ calendarId, eventId, requestBody, sendUpdates, conferenceDataVersion });
    return response.data;
  });
}

async function deleteEvent(subject, { calendarId, eventId, sendUpdates }, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'deleteEvent', { subject, calendarId, eventId, sendUpdates }, () => ({ deleted: true })), async () => {
    await calendarClient(subject).events.delete({ calendarId, eventId, sendUpdates });
    return { deleted: true };
  });
}

module.exports = {
  EVENTS_SCOPES, LIST_SCOPES, calendarClient,
  listCalendars, listEvents, getEvent, insertEvent, patchEvent, deleteEvent,
};
