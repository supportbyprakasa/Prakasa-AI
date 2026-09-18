const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/dashboardWidgets.controller');

router.use(requireAuth);

// Any authenticated user can list the widget catalog (needed to render dashboards)
router.get('/', ctrl.list);

router.post('/',
  requirePermission('dashboard_widget.manage'),
  validate(z.object({
    code: z.string().min(1).max(80),
    name: z.string().min(1).max(190),
    description: z.string().max(500).nullable().optional(),
    category: z.string().max(80).nullable().optional(),
    defaultSize: z.enum(['small', 'medium', 'large', 'full']).optional(),
    configSchema: z.record(z.any()).nullable().optional(),
    permissionCode: z.string().max(100).nullable().optional(),
    isActive: z.boolean().optional(),
  })),
  ctrl.upsert);
router.delete('/:id',
  requirePermission('dashboard_widget.manage'),
  ctrl.remove);

module.exports = router;
