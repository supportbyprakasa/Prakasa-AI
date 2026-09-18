const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/workspaces.controller');

router.use(requireAuth);
router.get('/customer/:customerId', requirePermission('workspace.customer.view'), ctrl.customerWorkspace);
router.get('/cross-division/:contextType/:contextId',
  requirePermission('workspace.cross_division.view'),
  ctrl.crossDivisionWorkspace);

module.exports = router;
