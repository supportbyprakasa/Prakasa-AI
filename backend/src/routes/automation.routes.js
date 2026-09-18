const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/automation.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  name: z.string().min(1).max(190),
  description: z.string().max(500).nullable().optional(),
  triggerType: z.enum(['schedule', 'entity_event']).optional(),
  triggerConfig: z.record(z.any()),
  conditionConfig: z.record(z.any()).nullable().optional(),
  actionType: z.enum([
    'create_task', 'create_notification', 'update_status',
    'send_google_chat', 'link_records', 'create_approval', 'escalate',
  ]),
  actionConfig: z.record(z.any()),
  scheduleCron: z.string().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('automation.view'), ctrl.list);
router.get('/scanners', requirePermission('automation.view'), ctrl.listScanners);
router.get('/actions', requirePermission('automation.view'), ctrl.listActions);
router.get('/logs', requirePermission('automation.view'), ctrl.logs);
router.post('/', requirePermission('automation.manage'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('automation.manage'), validate(createBody.partial()), ctrl.update);
router.delete('/:id', requirePermission('automation.manage'), ctrl.remove);
router.post('/:id/run', requirePermission('automation.manage'), ctrl.runRuleNow);

module.exports = router;
