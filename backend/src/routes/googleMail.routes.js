const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleMail.controller');

// The signed-in user's own Gmail (subject = req.user.email). Inputs are
// whitelisted in the controller before anything reaches Google.
router.use(requireAuth);
router.use(requirePermission('google.mail.use'));

router.get('/labels', ctrl.listLabels);
router.get('/threads', ctrl.listThreads);
router.get('/threads/:threadId', ctrl.getThread);
router.post('/threads/:threadId/actions', ctrl.threadAction);
router.get('/messages/:messageId/attachments/:partId', ctrl.downloadAttachment);
router.post('/send', ctrl.sendMessage);
router.post('/drafts', ctrl.createDraft);

module.exports = router;
