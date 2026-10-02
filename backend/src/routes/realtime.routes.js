const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/realtime.controller');

// Realtime event stream (SSE). In-process bus — see services/realtime.service.js.
router.use(requireAuth);

router.get('/stream', ctrl.stream);

module.exports = router;
