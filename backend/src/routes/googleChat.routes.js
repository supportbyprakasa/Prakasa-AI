const router = require('express').Router();
const multer = require('multer');
const { uploadLimiter } = require('../middleware/rateLimits');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/googleChatApp.controller');

// Chat attachments: a narrow whitelist (see googleChatUser.service.js) — the
// MIME type and the extension must both match.
const chatUser = require('../services/googleChatUser.service');

const CHAT_UPLOAD_TYPES = chatUser.CHAT_UPLOAD_TYPES;
const CHAT_UPLOAD_MAX_BYTES = chatUser.CHAT_UPLOAD_MAX_BYTES;

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_UPLOAD_MAX_BYTES, files: 1, fields: 5, fieldSize: 16 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = CHAT_UPLOAD_TYPES[file.mimetype];
    if (!ext || !ext.test(file.originalname || '')) {
      const error = new Error('Tipe file tidak diizinkan untuk Google Chat');
      error.status = 400;
      error.code = 'FILE_TYPE_NOT_ALLOWED';
      return cb(error);
    }
    return cb(null, true);
  },
});

// Google Chat as the signed-in user (spaces, DMs, messages).
router.use(requireAuth);
router.use(requirePermission('google.chat.use'));

router.get('/people', ctrl.searchPeople);
router.get('/read-states', ctrl.getReadStates);

// Attach from Drive (as the user): browse / search, Shared Drives, chip names.
router.get('/drive/files', ctrl.listDriveFiles);
router.get('/drive/shared-drives', ctrl.listSharedDrives);
router.get('/drive/meta', ctrl.getDriveMeta);

router.get('/spaces', ctrl.listSpaces);
router.post('/spaces', ctrl.createSpace);
router.get('/spaces/:spaceId', ctrl.getSpace);
router.patch('/spaces/:spaceId', ctrl.updateSpace);
router.patch('/spaces/:spaceId/settings', ctrl.updateSettings);
router.delete('/spaces/:spaceId', ctrl.deleteSpace);
router.get('/spaces/:spaceId/details', ctrl.getSpaceDetails);
router.put('/spaces/:spaceId/alias', ctrl.setAlias);
router.post('/spaces/:spaceId/members', ctrl.addMembers);
router.delete('/spaces/:spaceId/members/:memberId', ctrl.removeMember);
router.delete('/spaces/:spaceId/membership', ctrl.leaveSpace);
router.put('/spaces/:spaceId/notification', ctrl.setNotification);
router.put('/spaces/:spaceId/read-state', ctrl.markRead);
router.post('/spaces/:spaceId/meet', ctrl.createMeet);
router.post('/spaces/:spaceId/drive-access', ctrl.checkDriveAccess);
router.post('/spaces/:spaceId/drive-access/grant', ctrl.grantDriveAccess);

router.get('/spaces/:spaceId/messages', ctrl.listMessages);
router.post('/spaces/:spaceId/messages', ctrl.createMessage);
router.patch('/spaces/:spaceId/messages/:messageId', ctrl.updateMessage);
router.delete('/spaces/:spaceId/messages/:messageId', ctrl.deleteMessage);
router.post('/spaces/:spaceId/messages/:messageId/reactions', ctrl.toggleReaction);
router.post('/spaces/:spaceId/messages/:messageId/forward', ctrl.forwardMessage);
router.get('/spaces/:spaceId/messages/:messageId/attachments/:index', ctrl.downloadAttachment);
router.get('/spaces/:spaceId/threads/:threadId/messages', ctrl.listThreadMessages);
router.post('/spaces/:spaceId/attachments', uploadLimiter, chatUpload.single('file'), ctrl.uploadAttachment);

router.CHAT_UPLOAD_TYPES = CHAT_UPLOAD_TYPES;
module.exports = router;
