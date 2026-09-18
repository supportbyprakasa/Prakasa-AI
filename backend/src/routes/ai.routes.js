const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/ai.controller');

const docAssistantBody = z.object({
  documentId: z.number().int().positive(),
  action: z.enum(['summarize', 'check_completeness', 'check_consistency']),
});

const moduleBody = z.object({
  provider: z.enum(['openai', 'gemini', 'claude', 'n8n']),
  model: z.string().min(1).max(120),
  systemPrompt: z.string().max(8000).nullable().optional(),
  params: z.record(z.any()).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);
router.post('/document-assistant', requirePermission('ai.use'), validate(docAssistantBody), ctrl.documentAssistant);
router.get('/summaries', requirePermission('ai.view'), ctrl.listSummaries);
router.get('/modules', requirePermission('ai.config.manage'), ctrl.getModuleConfig);
router.patch('/modules/:module', requirePermission('ai.config.manage'), validate(moduleBody.partial()), ctrl.updateModuleConfig);


const meetingSummaryBody = z.object({
  meetingId: z.number().int().positive(),
  transcript: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const confirmActionBody = z.object({
  boardId: z.number().int().positive().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

router.post('/meeting-summary',
  requirePermission('meeting.ai_summary'),
  validate(meetingSummaryBody),
  ctrl.meetingSummary);
router.post('/meeting-actions/:id/confirm',
  requirePermission('meeting.confirm_action'),
  validate(confirmActionBody),
  ctrl.confirmActionItem);
router.post('/meeting-actions/:id/dismiss',
  requirePermission('meeting.confirm_action'),
  ctrl.dismissActionItem);

module.exports = router;
