const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/forms.controller');
const subCtrl = require('../controllers/formSubmissions.controller');

const fieldSchema = z.object({
  fieldKey: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(190),
  fieldType: z.enum([
    'text','textarea','email','number','currency','date','datetime',
    'select','multi_select','checkbox','radio',
    'user_selector','entity_selector','department_selector',
    'file','document_link',
  ]),
  placeholder: z.string().max(255).nullable().optional(),
  helpText: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  defaultValue: z.string().max(500).nullable().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable().optional(),
  validation: z.record(z.any()).nullable().optional(),
  sectionName: z.string().max(120).nullable().optional(),
  orderIndex: z.number().int().optional(),
  referenceType: z.string().max(80).nullable().optional(),
  dependsOnFieldKey: z.string().max(80).nullable().optional(),
  dependsOnValue: z.string().max(190).nullable().optional(),
});

const createFormBody = z.object({
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  description: z.string().nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  submitPermissionCode: z.string().max(100).nullable().optional(),
  viewPermissionCode: z.string().max(100).nullable().optional(),
  workflowDefinitionId: z.number().int().positive().nullable().optional(),
  approvalMatrixId: z.number().int().positive().nullable().optional(),
  documentTypeId: z.number().int().positive().nullable().optional(),
  folderMappingRuleId: z.number().int().positive().nullable().optional(),
  fields: z.array(fieldSchema).optional(),
});

router.use(requireAuth);

// User form catalog
router.get('/catalog', requireEntityScope, ctrl.catalog);
router.get('/catalog/:id', requireEntityScope, ctrl.catalogDetail);

// Forms CRUD
router.get('/', requireEntityScope, requirePermission('form.view'), ctrl.list);
router.get('/:id', requireEntityScope, requirePermission('form.view'), ctrl.detail);
router.post('/',
  requireEntityScope,
  requirePermission('form.manage'),
  validate(createFormBody),
  ctrl.create);
router.patch('/:id',
  requireEntityScope,
  requirePermission('form.manage'),
  validate(createFormBody.partial().omit({ slug: true })),
  ctrl.update);
router.delete('/:id',
  requireEntityScope,
  requirePermission('form.manage'),
  ctrl.remove);

// Submissions — placed before /:id catch-all is not strictly needed since paths differ
router.get('/submissions/list',
  requireEntityScope,
  requirePermission('form_submission.view'),
  subCtrl.list);
router.get('/submissions/mine',
  requirePermission('form.submit'),
  subCtrl.mine);
router.get('/submissions/:id',
  subCtrl.detail);
router.post('/submit',
  requireEntityScope,
  validate(z.object({
    formId: z.number().int().positive(),
    values: z.record(z.any()),
    contextType: z.string().max(80).nullable().optional(),
    contextId: z.number().int().positive().nullable().optional(),
    submit: z.boolean().optional(),
  })),
  subCtrl.submit);
router.patch('/submissions/:id/draft',
  validate(z.object({
    values: z.record(z.any()).default({}),
    notes: z.string().nullable().optional(),
  })),
  subCtrl.updateDraft);
router.post('/submissions/:id/finalize',
  subCtrl.finalize);
router.post('/submissions/:id/upload-field',
  upload.single('file'),
  validate(z.object({
    fieldId: z.coerce.number().int().positive().optional(),
    fieldKey: z.string().max(80).optional(),
  })),
  subCtrl.uploadField);
router.patch('/submissions/:id/status',
  requirePermission('form_submission.manage'),
  validate(z.object({
    status: z.enum(['draft','submitted','under_review','approved','rejected',
                    'revision_requested','completed','cancelled']),
    notes: z.string().nullable().optional(),
  })),
  subCtrl.updateStatus);
router.delete('/submissions/:id',
  subCtrl.remove);

module.exports = router;
