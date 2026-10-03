const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const ctrl = require('../controllers/accurateIntegration.controller');

// Mounted at /api/v1/integrations/accurate. Only Super Admin connects,
// disconnects, refreshes or changes credentials: the connection decides whose
// Accurate data flows into the app (security review, Oct 2026). The status
// stays readable with the permission. The callback is public because it is
// Accurate redirecting the browser, and it trusts nothing but the single-use
// state it was given.
const view = [requireAuth, requirePermission('integration.accurate.manage')];
const manage = [...view, requireSuperAdmin('Hanya Super Admin yang bisa mengelola koneksi Accurate')];

router.get('/callback', ctrl.callback);
router.get('/status', ...view, ctrl.status);
router.put('/credentials', ...manage, ctrl.saveCredentials);
router.post('/connect', ...manage, ctrl.connect);
router.post('/refresh', ...manage, ctrl.refresh);
router.post('/disconnect', ...manage, ctrl.disconnect);

module.exports = router;
