const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/integrationLogs.controller');

router.use(requireAuth);
router.get('/', requirePermission('integration_log.view'), ctrl.list);
router.get('/health', requirePermission('integration_log.view'), ctrl.health);
router.get('/:id', requirePermission('integration_log.view'), ctrl.detail);

module.exports = router;
