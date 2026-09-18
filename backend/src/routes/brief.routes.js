const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/brief.controller');

router.use(requireAuth);
router.get('/', requirePermission('brief.view'), ctrl.list);
router.post('/generate',
  requirePermission('brief.view'),
  validate(z.object({
    entityId: z.number().int().positive().optional(),
    briefType: z.enum(['daily', 'weekly']).optional(),
    briefDate: z.string().optional(),
  })),
  ctrl.generate);
module.exports = router;
