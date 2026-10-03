const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/workSummary.controller');

router.use(requireAuth);
router.get('/', ctrl.summary);
// "Ringkasan pagi" on the home page (Prakasa AI Wave D1): built from data, no model.
router.get('/briefing', ctrl.briefing);

module.exports = router;
