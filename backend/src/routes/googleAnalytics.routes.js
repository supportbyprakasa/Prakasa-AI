const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleAnalytics.controller');

// Read-only GA4 reports through the service account (see googleAnalytics.service.js).
router.use(requireAuth);
router.use(requirePermission('analytics.view'));
router.get('/status', ctrl.status);
router.get('/report', ctrl.report);

module.exports = router;
