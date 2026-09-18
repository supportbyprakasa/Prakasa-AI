const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/folderMappingRules.controller');

const body = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentType: z.string().min(1).max(80),
  driveFolderId: z.string().min(5).max(190),
  priority: z.number().int().min(1).max(9999).optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('folder_rule.manage'), ctrl.list);
router.post('/', requirePermission('folder_rule.manage'), validate(body), ctrl.create);
router.patch('/:id', requirePermission('folder_rule.manage'), validate(body.partial()), ctrl.update);
router.delete('/:id', requirePermission('folder_rule.manage'), ctrl.remove);
module.exports = router;
