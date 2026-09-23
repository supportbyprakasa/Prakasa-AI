const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/aiCommand.controller');

const idParams = z.object({
  id: z.coerce.number().int().positive(),
});

const sessionContextParams = z.object({
  id: z.coerce.number().int().positive(),
  contextId: z.coerce.number().int().positive(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'archived']).optional(),
  visibility: z.enum(['private', 'department', 'entity']).optional(),
});

const createSessionBody = z.object({
  title: z.string().min(1).max(255).optional(),
  sessionType: z.string().min(1).max(60).optional(),
  visibility: z.enum(['private', 'department', 'entity']).optional(),
  systemContext: z.string().max(8000).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  provider: z.enum(['openai', 'gemini', 'claude', 'claude_team', 'n8n']).nullable().optional(),
});

const updateSessionBody = z.object({
  title: z.string().min(1).max(255).optional(),
  visibility: z.enum(['private', 'department', 'entity']).optional(),
  systemContext: z.string().max(8000).nullable().optional(),
  provider: z.enum(['openai', 'gemini', 'claude', 'claude_team', 'n8n']).nullable().optional(),
});

const messageListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageBody = z.object({
  message: z.string().min(1).max(20000),
});

const attachContextBody = z.object({
  contextType: z.enum([
    'document',
    'task',
    'meeting',
    'approval_request',
    'form_submission',
    'decision_log',
    'kb_document',
  ]),
  contextId: z.number().int().positive(),
  relation: z.string().min(1).max(50).regex(/^[a-zA-Z0-9:_-]+$/).optional(),
});

const actionsQuery = z.object({
  status: z.enum([
    'proposed',
    'confirmed',
    'rejected',
    'executed',
    'failed',
    'expired',
  ]).optional(),
});

const actionBody = z.object({
  actionType: z.enum([
    'create_task',
    'create_approval',
    'create_document',
    'create_calendar_event',
    'update_task',
    'send_notification',
  ]),
  payload: z.record(z.any()),
  messageId: z.number().int().positive().nullable().optional(),
});

const rejectBody = z.object({
  reason: z.string().max(500).nullable().optional(),
});

const usageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entityId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  module: z.string().max(80).optional(),
  provider: z.string().max(40).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
});

router.use(requireAuth);

router.get(
  '/providers',
  requirePermission('ai_command.use'),
  ctrl.providers
);

router.get(
  '/sessions',
  requirePermission('ai_command.session.view'),
  validate(listQuery, 'query'),
  ctrl.listSessions
);
router.post(
  '/sessions',
  requirePermission('ai_command.use'),
  validate(createSessionBody),
  ctrl.createSession
);

router.get(
  '/sessions/:id',
  requirePermission('ai_command.session.view'),
  validate(idParams, 'params'),
  ctrl.getSession
);
router.patch(
  '/sessions/:id',
  requirePermission('ai_command.session.manage'),
  validate(idParams, 'params'),
  validate(updateSessionBody),
  ctrl.updateSession
);
router.delete(
  '/sessions/:id',
  requirePermission('ai_command.session.manage'),
  validate(idParams, 'params'),
  ctrl.deleteSession
);
router.post(
  '/sessions/:id/archive',
  requirePermission('ai_command.session.manage'),
  validate(idParams, 'params'),
  ctrl.archiveSession
);

router.get(
  '/sessions/:id/messages',
  requirePermission('ai_command.session.view'),
  validate(idParams, 'params'),
  validate(messageListQuery, 'query'),
  ctrl.listMessages
);
router.post(
  '/sessions/:id/messages',
  requirePermission('ai_command.use'),
  validate(idParams, 'params'),
  validate(sendMessageBody),
  ctrl.sendMessage
);

router.get(
  '/sessions/:id/contexts',
  requirePermission('ai_command.session.view'),
  validate(idParams, 'params'),
  ctrl.listContexts
);
router.post(
  '/sessions/:id/contexts',
  requirePermission('ai_command.context.attach'),
  validate(idParams, 'params'),
  validate(attachContextBody),
  ctrl.attachContext
);
router.delete(
  '/sessions/:id/contexts/:contextId',
  requirePermission('ai_command.context.attach'),
  validate(sessionContextParams, 'params'),
  ctrl.removeContext
);

router.get(
  '/sessions/:id/actions',
  requirePermission('ai_command.session.view'),
  validate(idParams, 'params'),
  validate(actionsQuery, 'query'),
  ctrl.listActions
);
router.post(
  '/sessions/:id/actions',
  requirePermission('ai_command.action.propose'),
  validate(idParams, 'params'),
  validate(actionBody),
  ctrl.createAction
);

router.post(
  '/actions/:id/confirm',
  requirePermission('ai_command.action.confirm'),
  validate(idParams, 'params'),
  ctrl.confirmAction
);
router.post(
  '/actions/:id/reject',
  requirePermission('ai_command.action.confirm'),
  validate(idParams, 'params'),
  validate(rejectBody),
  ctrl.rejectAction
);

router.get(
  '/usage',
  requirePermission('ai_command.usage.view'),
  validate(usageQuery, 'query'),
  ctrl.usage
);

module.exports = router;
