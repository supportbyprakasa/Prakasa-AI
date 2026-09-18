const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/chat.controller');

const roomBody = z.object({
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  roomType: z.enum(['division', 'project', 'direct']).optional(),
  memberIds: z.array(z.number().int().positive()).max(100).optional(),
});

const messageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  beforeId: z.coerce.number().int().positive().optional(),
});

const convertBody = z.object({
  boardId: z.number().int().positive().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.string().nullable().optional(),
});

router.use(requireAuth);

router.get(
  '/rooms',
  requirePermission('chat.view'),
  ctrl.listRooms
);

router.post(
  '/rooms',
  requirePermission('chat.send'),
  validate(roomBody),
  ctrl.createRoom
);

router.get(
  '/rooms/:id/messages',
  requirePermission('chat.view'),
  validate(messageQuery, 'query'),
  ctrl.listMessages
);

router.post(
  '/rooms/:id/messages',
  requirePermission('chat.send'),
  validate(z.object({ body: z.string().min(1).max(20000) })),
  ctrl.sendMessage
);

router.post(
  '/messages/:messageId/convert-to-task',
  requirePermission('task.create'),
  validate(convertBody),
  ctrl.convertMessageToTask
);

module.exports = router;
