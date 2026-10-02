const router = require('express').Router();
const ctrl = require('../controllers/aiAgent.controller');

// Called only by the Prakasa AI agent's tool server, with an agent token
// (never a login token). See services/ai/agent/.
router.use(ctrl.requireAgent);
router.get('/tools', ctrl.listTools);
router.post('/tools/:name', ctrl.callTool);

module.exports = router;
