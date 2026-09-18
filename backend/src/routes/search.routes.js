const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/globalSearch.controller');

router.use(requireAuth);
router.get('/', requirePermission('search.global'), ctrl.search);
module.exports = router;
