const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleGroups.controller');

// Read-only company group directory (Directory API via the delegated admin).
router.use(requireAuth);
router.use(requirePermission('google.groups.view'));
router.get('/groups', ctrl.listGroups);
router.get('/groups/:groupKey', ctrl.getGroup);

module.exports = router;
