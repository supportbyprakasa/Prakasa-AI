const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/timeline.controller');

router.use(requireAuth);
router.get('/', requirePermission('timeline.view'), ctrl.timeline);
module.exports = router;
