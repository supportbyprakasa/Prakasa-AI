const router = require('express').Router();
const { z } = require('zod');
const { httpsUrl } = require('../utils/safeUrl');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/hrga.controller');
const rules = require('../services/hrgaChecklist');

// People & Culture → Onboarding & offboarding (wave 2, row 2.1). Bodies are
// strict: an entity, a personal phone number, a free-text reason or the old
// "auto-create tasks" switch is refused (400), never silently ignored.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const KEY = z.string().regex(/^[pu]\d{1,10}$/, 'Kunci direktori tidak valid');
const ID = z.number().int().positive();
const TEXT = (max) => z.string().max(max);

const needs = z.object({
  google: z.boolean(),
  app: z.boolean(),
  device: z.enum(['laptop', 'pc', 'none']),
  licenses: z.array(ID).max(20),
  phone: z.enum(['mobile', 'ip_phone', 'none']),
  desk: z.boolean(),
  idCard: z.boolean(),
}).strict();

const onboardingFields = {
  employeeFullName: z.string().trim().min(1).max(150),
  employeePosition: TEXT(150).nullable().optional(),
  departmentId: ID,
  managerKey: KEY.nullable().optional(),
  locationId: ID.nullable().optional(),
  plannedWorkEmail: TEXT(190).nullable().optional(),
  personKey: KEY.nullable().optional(),
  joinDate: DATE,
  needs,
  hrgaPicUserId: ID.nullable().optional(),
  notes: TEXT(2000).nullable().optional(),
};
const offboardingFields = {
  personKey: KEY,
  lastWorkingDate: DATE,
  reasonCode: z.enum(['resign', 'contract_end', 'other']),
  hrgaPicUserId: ID.nullable().optional(),
  notes: TEXT(2000).nullable().optional(),
};

const createBody = z.discriminatedUnion('workflowType', [
  z.object({ workflowType: z.literal('onboarding'), ...onboardingFields }).strict(),
  z.object({ workflowType: z.literal('offboarding'), ...offboardingFields }).strict(),
]);

// PATCH: any field of either type (the service applies the ones of the workflow's type).
const updateBody = z.object({
  version: z.number().int().positive(),
  ...Object.fromEntries(Object.entries({ ...onboardingFields, ...offboardingFields }).map(([k, v]) => [k, v.optional()])),
  personKey: KEY.nullable().optional(),
}).strict();

const templateItem = z.object({
  category: z.enum(rules.CATEGORIES),
  title: z.string().trim().min(1).max(255),
  description: TEXT(500).nullable().optional(),
  ownerGroup: z.enum(rules.OWNER_GROUPS),
  offsetDays: z.number().int().min(-30).max(30),
  requires: z.enum(rules.REQUIRES).nullable().optional(),
}).strict();

router.use(requireAuth);

// Checklist templates (before /:id routes).
router.get('/checklist-templates', requirePermission('hrga.view'), ctrl.listChecklistTemplates);
router.post('/checklist-templates', requirePermission('hrga.checklist_template.manage'),
  validate(z.object({
    workflowType: z.enum(['onboarding', 'offboarding']),
    departmentId: ID.nullable().optional(),
    name: z.string().trim().min(1).max(190),
    items: z.array(templateItem).min(1).max(60),
  }).strict()),
  ctrl.createChecklistTemplate);
router.patch('/checklist-templates/:id', requirePermission('hrga.checklist_template.manage'),
  validate(z.object({
    name: z.string().trim().min(1).max(190).optional(),
    items: z.array(templateItem).min(1).max(60).optional(),
    isActive: z.boolean().optional(),
  }).strict()),
  ctrl.updateChecklistTemplate);

router.get('/lookups', requirePermission('hrga.view'), ctrl.lookups);
// What the person picked in "Buat offboarding" still holds (whoever may create one).
router.get('/holdings', requirePermission('hrga.request'), ctrl.holdings);

// Workflows. Reading one is open to its manager, task owners and management too
// (read rule in the service; others get 404).
router.get('/workflows', requirePermission('hrga.view'), ctrl.list);
router.get('/workflows/:id', ctrl.detail);
router.get('/workflows/:id/checklist-preview', ctrl.checklistPreview);
router.post('/workflows', requirePermission('hrga.request'), validate(createBody), ctrl.create);
router.patch('/workflows/:id', requirePermission('hrga.request'), validate(updateBody), ctrl.update);
router.delete('/workflows/:id', requirePermission('hrga.request'), ctrl.remove);

router.post('/workflows/:id/submit', requirePermission('hrga.request'), ctrl.submitForApproval);
router.post('/workflows/:id/submit-approval', requirePermission('hrga.request'), ctrl.submitForApproval);
router.post('/workflows/:id/withdraw', validate(z.object({ note: z.string().trim().min(1).max(500) }).strict()), ctrl.withdraw);
router.post('/workflows/:id/cancel', requirePermission('hrga.manage'),
  validate(z.object({ reason: z.string().trim().min(1).max(255) }).strict()), ctrl.cancel);
router.post('/workflows/:id/apply-approval', ctrl.applyApprovalResult);
router.post('/workflows/:id/holdings-sync', requirePermission('hrga.manage'), ctrl.holdingsSync);

// Checklist tasks: the responsible user or hrga.manage (rule in the service).
router.patch('/workflows/:id/tasks/:taskId/link', ctrl.linkTask);
router.patch('/workflows/:id/tasks/:taskId/assign', requirePermission('hrga.manage'),
  validate(z.object({ responsibleUserId: ID.nullable() }).strict()), ctrl.assignTask);
router.get('/workflows/:id/tasks/:taskId/options', ctrl.taskOptions);
router.patch('/workflows/:id/tasks/:taskId',
  validate(z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'skipped']).optional(),
    notes: TEXT(500).nullable().optional(),
    skippedReason: TEXT(255).nullable().optional(),
    confirmedInAdminConsole: z.boolean().optional(),
  }).strict()),
  ctrl.updateTask);
router.post('/workflows/:id/tasks/:taskId/device-handover', requirePermission('device.assign'),
  validate(z.object({ deviceId: ID, expectedReturnDate: DATE.nullable().optional() }).strict()), ctrl.deviceHandover);
router.post('/workflows/:id/tasks/:taskId/device-return', requirePermission('device.assign'),
  validate(z.object({
    conditionOnReturn: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional(),
    notes: TEXT(500).nullable().optional(),
  }).strict()), ctrl.deviceReturn);
router.post('/workflows/:id/tasks/:taskId/license-assign', requirePermission('subscription.license.manage'),
  validate(z.object({ licenseId: ID }).strict()), ctrl.licenseAssign);
router.post('/workflows/:id/tasks/:taskId/license-revoke', requirePermission('subscription.license.manage'),
  validate(z.object({}).strict()), ctrl.licenseRevoke);
router.post('/workflows/:id/tasks/:taskId/phone-line', requirePermission('it.infra.manage'),
  validate(z.object({ phoneLineId: ID }).strict()), ctrl.phoneLine);
router.post('/workflows/:id/tasks/:taskId/phone-line-return', requirePermission('it.infra.manage'),
  validate(z.object({}).strict()), ctrl.phoneLineReturn);
router.post('/workflows/:id/tasks/:taskId/it-ticket',
  validate(z.object({
    category: z.enum(['new_device_request', 'access_software']),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(5000),
  }).strict()), ctrl.itTicket);

// Attachments: hand-over notes or other files only; contracts, ID cards, offer
// and resignation letters live in KantorKu (S6).
router.post('/workflows/:id/attachments', requirePermission('hrga.manage'), upload.single('file'),
  validate(z.object({
    attachmentType: z.enum(['handover_note', 'other']).optional(),
    name: TEXT(255).optional(),
  }).strict()),
  ctrl.uploadAttachment);

// KantorKu reference: a link only (no integration).
router.patch('/workflows/:id/kantorku-reference', requirePermission('hrga.manage'),
  validate(z.object({
    kantorkuEmployeeId: TEXT(190).nullable().optional(),
    kantorkuReferenceUrl: httpsUrl({ max: 500 }).nullable().optional(),
  }).strict()),
  ctrl.linkKantorku);

module.exports = router;
module.exports.schemas = { createBody, updateBody, templateItem };
