const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/notifications.controller');

const idParams = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unread: z.enum(['0', '1']).optional(),
  event: z.string().trim().min(1).max(80).optional(),
  subjectType: z.string().trim().min(1).max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

router.use(requireAuth);

// Static routes must stay before dynamic :id routes.
router.get('/', validate(listQuery, 'query'), ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.patch('/read-all', ctrl.markAllRead);
router.delete('/read', ctrl.clearRead);

router.patch(
  '/:id/read',
  validate(idParams, 'params'),
  ctrl.markRead
);
router.patch(
  '/:id/unread',
  validate(idParams, 'params'),
  ctrl.markUnread
);
router.delete(
  '/:id',
  validate(idParams, 'params'),
  ctrl.dismiss
);

module.exports = router;
