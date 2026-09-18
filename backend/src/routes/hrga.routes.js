const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/hrga.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  workflowType: z.enum(['onboarding', 'offboarding']),
  employeeUserId: z.number().int().positive().nullable().optional(),
  employeeFullName: z.string().min(1).max(190),
  employeeEmail: z.string().email().max(190).nullable().optional(),
  employeePhone: z.string().max(40).nullable().optional(),
  employeePosition: z.string().max(150).nullable().optional(),
  employeeDivision: z.string().max(150).nullable().optional(),
  employeeManagerUserId: z.number().int().positive().nullable().optional(),
  joinDate: z.string().nullable().optional(),
  lastWorkingDate: z.string().nullable().optional(),
  effectiveDate: z.string(),
  reason: z.string().nullable().optional(),
  hrgaPicUserId: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  checklistTemplateId: z.number().int().positive().optional(),
  autoCreateLinkedTasks: z.boolean().optional(),
});

const attachBody = z.object({
  attachmentType: z.enum(['offer_letter', 'contract', 'id_document', 'resignation_letter', 'handover_note', 'other']).optional(),
  documentId: z.coerce.number().int().positive().optional(),
  name: z.string().max(255).optional(),
});

router.use(requireAuth);

// Checklist templates (taruh paling atas supaya tidak ketutup /:id)
router.get('/checklist-templates', requirePermission('hrga.view'), ctrl.listChecklistTemplates);
router.post('/checklist-templates',
  requirePermission('hrga.checklist_template.manage'),
  validate(z.object({
    entityId: z.number().int().positive(),
    workflowType: z.enum(['onboarding', 'offboarding']),
    name: z.string().min(1).max(190),
    items: z.array(z.object({
      category: z.enum([
        'google_workspace_access','shared_drive_access','device_handover','device_return',
        'email_account','software_license','account_deactivation','document_handover',
        'exit_interview','custom',
      ]),
      title: z.string().min(1).max(255),
      description: z.string().nullable().optional(),
      dueOffsetDays: z.number().int().nullable().optional(),
    })),
  })),
  ctrl.createChecklistTemplate);

// Workflows
router.get('/workflows', requirePermission('hrga.view'), ctrl.list);
router.get('/workflows/:id', requirePermission('hrga.view'), ctrl.detail);
router.post('/workflows', requirePermission('hrga.request'), validate(createBody), ctrl.create);
router.patch('/workflows/:id', requirePermission('hrga.manage'), validate(createBody.partial()), ctrl.update);
router.delete('/workflows/:id', requirePermission('hrga.manage'), ctrl.remove);

// Attachments
router.post('/workflows/:id/attachments',
  requirePermission('hrga.manage'),
  upload.single('file'),
  validate(attachBody),
  ctrl.uploadAttachment);

// Approval
router.post('/workflows/:id/submit-approval',
  requirePermission('hrga.request'),
  ctrl.submitForApproval);
router.post('/workflows/:id/apply-approval',
  requirePermission('hrga.approve'),
  validate(z.object({
    status: z.enum(['approved', 'rejected', 'revision_requested', 'in_progress']),
    note: z.string().max(500).nullable().optional(),
  })),
  ctrl.applyApprovalResult);

// Tasks
router.patch('/workflows/:id/tasks/:taskId',
  requirePermission('hrga.manage'),
  validate(z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']).optional(),
    responsibleUserId: z.number().int().positive().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })),
  ctrl.updateTask);

router.patch('/workflows/:id/tasks/:taskId/link',
  requirePermission('hrga.manage'),
  validate(z.object({
    linkedDeviceAssignmentId: z.number().int().positive().nullable().optional(),
    linkedSubscriptionLicenseId: z.number().int().positive().nullable().optional(),
    linkedTaskId: z.number().int().positive().nullable().optional(),
  })),
  ctrl.linkTask);

// KantorKu reference
router.patch('/workflows/:id/kantorku-reference',
  requirePermission('hrga.manage'),
  validate(z.object({
    kantorkuEmployeeId: z.string().max(190).nullable().optional(),
    kantorkuReferenceUrl: z.string().url().max(500).nullable().optional(),
  })),
  ctrl.linkKantorku);

module.exports = router;
