const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/activityLogs.controller');
router.use(requireAuth);
router.get('/', requirePermission('activity_log.view'), ctrl.list);
module.exports = router;
