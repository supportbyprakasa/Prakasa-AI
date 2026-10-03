const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/notifications.controller');

router.use(requireAuth);

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/* ------------------------------------------------------------
   STATIC routes MUST come before dynamic :id routes.
   ------------------------------------------------------------ */

// List
// Notifikasi & email (config/notificationPolicy.js): the policy per event and
// the administrator's email switch (notification_rules, channel 'email').
const requirePermissionPolicy = require('../middleware/requirePermission');
const notificationPolicy = require('../services/notificationPolicy.service');
router.get('/policy', requirePermissionPolicy('notification.manage_rule'), notificationPolicy.listHandler);
router.put('/policy/:event', requirePermissionPolicy('notification.manage_rule'), notificationPolicy.saveHandler);

router.get('/', ctrl.list);

// Unread count (sidebar badge)
router.get('/unread-count', ctrl.unreadCount);

// Mark all read
router.patch('/read-all', ctrl.markAllRead);

// Clear all already-read
router.delete('/read', ctrl.clearRead);

/* ------------------------------------------------------------
   DYNAMIC routes
   ------------------------------------------------------------ */

router.patch('/:id/read',
  validate(idParamSchema, 'params'),
  ctrl.markRead);

router.patch('/:id/unread',
  validate(idParamSchema, 'params'),
  ctrl.markUnread);

router.delete('/:id', validate(idParamSchema, 'params'), ctrl.dismiss);

module.exports = router;