const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/tracker.controller');

// Project Tracker per Google Chat space. Membership of the space is checked
// per request (as the user, via Chat) inside the service layer.
router.use(requireAuth);
router.use(requirePermission('google.chat.use'));

router.get('/projects', ctrl.listProjects);
router.get('/spaces/:spaceId/project', ctrl.getSpaceProject);
router.post('/spaces/:spaceId/project', ctrl.enableProject);
router.patch('/projects/:projectId', ctrl.updateProject);
router.get('/projects/:projectId/issues', ctrl.listIssues);
router.post('/projects/:projectId/issues', ctrl.createIssue);
router.get('/projects/:projectId/reports', ctrl.getReports);
router.post('/projects/:projectId/sprints', ctrl.createSprint);
router.get('/issues/:issueId', ctrl.getIssue);
router.patch('/issues/:issueId', ctrl.updateIssue);
router.delete('/issues/:issueId', ctrl.deleteIssue);
router.post('/issues/:issueId/comments', ctrl.addComment);
router.patch('/sprints/:sprintId', ctrl.updateSprint);

module.exports = router;
