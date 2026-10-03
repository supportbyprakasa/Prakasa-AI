const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleCalendarApp.controller');

// Native Google Calendar (the user's own calendar, via domain-wide delegation).
// Reading needs meeting.view; creating, editing, deleting and RSVP-ing events
// needs meeting.create (every member has both). Input is validated in the
// controller (ids, time ranges, event body).
router.use(requireAuth);
router.use(requirePermission('meeting.view'));

router.get('/calendars', ctrl.listCalendars);
router.get('/events', ctrl.listEvents);
router.get('/events/:eventId', ctrl.getEvent);
router.post('/events', requirePermission('meeting.create'), ctrl.createEvent);
router.patch('/events/:eventId', requirePermission('meeting.create'), ctrl.updateEvent);
router.delete('/events/:eventId', requirePermission('meeting.create'), ctrl.deleteEvent);
router.post('/events/:eventId/respond', requirePermission('meeting.create'), ctrl.respondEvent);

module.exports = router;
