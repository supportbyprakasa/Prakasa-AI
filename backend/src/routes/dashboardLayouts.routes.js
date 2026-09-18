const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/dashboardLayouts.controller');

router.use(requireAuth);

router.get('/',
  requireEntityScope,
  requirePermission('dashboard_layout.manage'),
  ctrl.list);
router.get('/role/:roleId',
  requireEntityScope,
  ctrl.getForRole);                     // read allowed to see own layout
router.post('/',
  requireEntityScope,
  requirePermission('dashboard_layout.manage'),
  validate(z.object({
    roleId: z.number().int().positive(),
    name: z.string().max(120).nullable().optional(),
    layout: z.array(z.object({
      widgetCode: z.string().min(1),
      size: z.enum(['small', 'medium', 'large', 'full']).optional(),
      order: z.number().int().optional(),
      config: z.record(z.any()).optional(),
    })),
    isDefault: z.boolean().optional(),
  })),
  ctrl.upsert);
router.delete('/:id',
  requireEntityScope,
  requirePermission('dashboard_layout.manage'),
  ctrl.remove);

module.exports = router;
