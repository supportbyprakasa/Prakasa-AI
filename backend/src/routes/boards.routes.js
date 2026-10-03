const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/boards.controller');
const chatCtrl = require('../controllers/boardChat.controller');

const idParams = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

const listQuery = z.object({
  entityId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  activeOnly: z.enum(['0', '1']).optional(),
}).strict();

const taskListQuery = z.object({
  assigneeId: z.coerce.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  status: z.string().min(1).max(50).optional(),
}).strict();

const boardBody = z.object({
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  description: z.string().max(500).nullable().optional(),
  columns: z.array(
    z.object({
      name: z.string().min(1).max(100),
      position: z.number().int().optional(),
      wipLimit: z.number().int().positive().nullable().optional(),
    }).strict()
  ).max(50).optional(),
}).strict();

const chatMessagesQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  pageToken: z.string().max(500).optional(),
}).strict();

const chatSendBody = z.object({
  text: z.string().min(1).max(4000),
}).strict();

const chatConvertBody = z.object({
  messageName: z.string().min(1).max(300),
  columnId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.string().nullable().optional(),
}).strict();

router.use(requireAuth);

router.get(
  '/',
  requirePermission('board.view'),
  validate(listQuery, 'query'),
  ctrl.list
);
router.get(
  '/:id',
  requirePermission('board.view'),
  validate(idParams, 'params'),
  ctrl.detail
);
router.get(
  '/:id/tasks',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  validate(taskListQuery, 'query'),
  ctrl.listTasksByBoard
);
router.post(
  '/',
  requirePermission('board.manage'),
  validate(boardBody),
  ctrl.create
);
router.delete(
  '/:id',
  requirePermission('board.manage'),
  validate(idParams, 'params'),
  ctrl.remove
);
router.get(
  '/:id/chat/messages',
  requirePermission('board.view'),
  validate(idParams, 'params'),
  validate(chatMessagesQuery, 'query'),
  chatCtrl.listMessages
);
router.post(
  '/:id/chat/messages',
  requirePermission('chat.send'),
  validate(idParams, 'params'),
  validate(chatSendBody),
  chatCtrl.sendMessage
);
router.post(
  '/:id/chat/convert-to-task',
  requirePermission('task.create'),
  validate(idParams, 'params'),
  validate(chatConvertBody),
  chatCtrl.convertMessageToTask
);

module.exports = router;
