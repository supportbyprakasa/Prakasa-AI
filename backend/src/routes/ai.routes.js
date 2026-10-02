const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/ai.controller');
const { aiMessageLimiter } = require('../middleware/rateLimits');
const providerSettingsCtrl = require('../controllers/aiProviderSettings.controller');
const { MODEL_PATTERN } = require('../services/ai/providerSettings');

const providerConfigBody = z.object({
  enabled: z.boolean().optional(),
  model: z.string().trim().regex(MODEL_PATTERN, 'Model tidak valid').optional(),
  apiKey: z.string().trim().max(300).optional(),
  gatewayUrl: z.string().trim().url().max(500).nullable().optional(),
  gatewaySecret: z.string().trim().max(300).optional(),
});

const claudeTeamAccountBody = z.object({
  label: z.string().trim().min(1).max(120),
  mode: z.enum(['cli', 'gateway']),
  gatewayUrl: z.string().trim().url().max(500).optional(),
  gatewaySecret: z.string().trim().min(16).max(150).optional(),
  model: z.string().trim().regex(MODEL_PATTERN, 'Model tidak valid'),
  webResearch: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const routingBody = z.object({
  defaultProvider: z.enum(['openai', 'gemini', 'claude', 'claude_team', 'n8n']),
  defaultClaudeTeamAccountId: z.number().int().positive().nullable().optional(),
});

const divisionAssignmentBody = z.object({
  provider: z.enum(['openai', 'gemini', 'claude', 'claude_team', 'n8n']),
  claudeTeamAccountId: z.number().int().positive().nullable().optional(),
});

const docAssistantBody = z.object({
  documentId: z.number().int().positive(),
  action: z.enum(['summarize', 'check_completeness', 'check_consistency']),
});

const moduleBody = z.object({
  provider: z.enum(['openai', 'gemini', 'claude', 'claude_team', 'n8n']),
  model: z.string().min(1).max(120),
  systemPrompt: z.string().max(8000).nullable().optional(),
  params: z.record(z.any()).nullable().optional(),
  isActive: z.boolean().optional(),
});

// AI providers, their keys, gateways and routing are Super Admin only
// (security review, Oct 2026): a gateway URL decides where every prompt and
// its company data is sent. Reading the overview stays with the permission.
// Gateway URLs are checked again in the services (utils/safeUrl.js).
const SUPER_ADMIN_ONLY = requireSuperAdmin('Hanya Super Admin yang bisa mengubah pengaturan AI');

router.use(requireAuth);
router.post('/document-assistant', requirePermission('ai.use'), aiMessageLimiter, validate(docAssistantBody), ctrl.documentAssistant);
router.get('/summaries', requirePermission('ai.view'), ctrl.listSummaries);
router.get('/modules', requirePermission('ai.config.manage'), ctrl.getModuleConfig);
router.patch('/modules/:module', requirePermission('ai.config.manage'), SUPER_ADMIN_ONLY, validate(moduleBody.partial()), ctrl.updateModuleConfig);

router.get('/provider-settings', requirePermission('ai.provider.manage'), providerSettingsCtrl.getOverview);
router.patch(
  '/provider-settings/providers/:provider',
  requirePermission('ai.provider.manage'),
  SUPER_ADMIN_ONLY,
  validate(providerConfigBody),
  providerSettingsCtrl.updateProvider
);

router.get('/provider-settings/claude-team/accounts', requirePermission('ai.provider.manage'), providerSettingsCtrl.listAccounts);
router.post(
  '/provider-settings/claude-team/accounts',
  requirePermission('ai.provider.manage'),
  SUPER_ADMIN_ONLY,
  validate(claudeTeamAccountBody),
  providerSettingsCtrl.createAccount
);
router.patch(
  '/provider-settings/claude-team/accounts/:id',
  requirePermission('ai.provider.manage'),
  SUPER_ADMIN_ONLY,
  validate(claudeTeamAccountBody.partial()),
  providerSettingsCtrl.updateAccount
);
router.delete(
  '/provider-settings/claude-team/accounts/:id',
  requirePermission('ai.provider.manage'),
  SUPER_ADMIN_ONLY,
  providerSettingsCtrl.deleteAccount
);

router.put(
  '/provider-settings/routing',
  requirePermission('ai.routing.manage'),
  SUPER_ADMIN_ONLY,
  validate(routingBody),
  providerSettingsCtrl.updateRouting
);
router.put(
  '/provider-settings/routing/divisions/:departmentId',
  requirePermission('ai.routing.manage'),
  SUPER_ADMIN_ONLY,
  validate(divisionAssignmentBody),
  providerSettingsCtrl.setDivisionAssignment
);
router.delete(
  '/provider-settings/routing/divisions/:departmentId',
  requirePermission('ai.routing.manage'),
  SUPER_ADMIN_ONLY,
  providerSettingsCtrl.clearDivisionAssignment
);

module.exports = router;
