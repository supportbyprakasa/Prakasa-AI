const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/managementDashboard.controller');

router.use(requireAuth);
router.get('/summary', requirePermission('management_dashboard.view'), ctrl.summary);
module.exports = router;
