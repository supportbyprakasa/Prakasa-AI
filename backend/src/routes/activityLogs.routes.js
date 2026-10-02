const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/activityLogs.controller');
router.use(requireAuth);
router.get('/', requireEntityScope, requirePermission('activity_log.view'), ctrl.list);
module.exports = router;
