const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/integrationLogs.controller');

router.use(requireAuth);
router.get('/', requireEntityScope, requirePermission('integration_log.view'), ctrl.list);
router.get('/health', requireEntityScope, requirePermission('integration_log.view'), ctrl.health);
router.get('/:id', requireEntityScope, requirePermission('integration_log.view'), ctrl.detail);

module.exports = router;
