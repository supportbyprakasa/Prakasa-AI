const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/documentTemplates.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  documentType: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  driveTemplateFileId: z.string().min(5).max(190),
  placeholders: z.array(z.object({
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(190),
    fieldType: z.enum(['text', 'number', 'date', 'currency', 'long_text']).optional(),
    defaultValue: z.string().max(500).nullable().optional(),
    required: z.boolean().optional(),
  })).optional(),
});

const updateBody = z.object({
  name: z.string().min(1).max(190),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

const useBody = z.object({
  title: z.string().min(1).max(255).optional(),
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  values: z.record(z.any()).optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('template.view'), ctrl.list);
router.get('/:id', requirePermission('template.view'), ctrl.detail);
router.post('/', requirePermission('template.manage'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('template.manage'), validate(updateBody.partial()), ctrl.update);
router.delete('/:id', requirePermission('template.manage'), ctrl.remove);
router.post('/:id/use', requirePermission('document.create'), validate(useBody), ctrl.useTemplate);
module.exports = router;
