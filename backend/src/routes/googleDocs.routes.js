const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleDocs.controller');

// Google Docs / Sheets / Slides home — acts as the signed-in user only.
// Input validation (kind whitelist, file id, search text, page token) lives
// in the controller so it is unit-tested together with the handlers.
router.use(requireAuth);
router.use(requirePermission('google.docs.use'));

router.get('/files', ctrl.listFiles);
router.post('/files', ctrl.createFile);
router.get('/files/:fileId', ctrl.getFile);
router.patch('/files/:fileId', ctrl.renameFile);
router.delete('/files/:fileId', ctrl.trashFile);
router.get('/files/:fileId/thumbnail', ctrl.thumbnail);

module.exports = router;
