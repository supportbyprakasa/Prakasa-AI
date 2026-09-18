const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/documents.controller');

const uploadMeta = z.object({
  entityId: z.coerce.number().int().positive(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().min(1).max(255),
  documentType: z.string().min(1).max(80),
  templateId: z.coerce.number().int().positive().optional().nullable(),
});

const linkBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
  documentType: z.string().min(1).max(80),
  driveFileId: z.string().min(5).max(190),
  templateId: z.number().int().positive().nullable().optional(),
});

const updateBody = z.object({
  title: z.string().min(1).max(255),
  documentType: z.string().min(1).max(80),
  status: z.enum(['draft', 'final', 'archived']),
});

router.use(requireAuth);
router.get('/', requirePermission('document.view'), ctrl.list);
router.get('/:id', requirePermission('document.view'), ctrl.detail);
router.get('/:id/versions', requirePermission('document.view'), ctrl.versions);
router.post('/upload', requirePermission('document.create'), upload.single('file'), validate(uploadMeta), ctrl.upload);
router.post('/link', requirePermission('document.create'), validate(linkBody), ctrl.link);
router.patch('/:id', requirePermission('document.update'), validate(updateBody.partial()), ctrl.update);
router.delete('/:id', requirePermission('document.delete'), ctrl.remove);
module.exports = router;
