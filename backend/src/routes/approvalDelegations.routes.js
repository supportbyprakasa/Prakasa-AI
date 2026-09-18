const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/approvalDelegations.controller');

const createBody = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  appliesToRequestType: z.string().max(80).nullable().optional(),
  appliesToDocumentTypeId: z.number().int().positive().nullable().optional(),
  startsAt: z.string().min(1).nullable().optional(),
  endsAt: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

const updateBody = z.object({
  appliesToRequestType: z.string().max(80).nullable().optional(),
  appliesToDocumentTypeId: z.number().int().positive().nullable().optional(),
  startsAt: z.string().min(1).nullable().optional(),
  endsAt: z.string().min(1).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Minimal satu field update wajib',
});

router.use(requireAuth);
router.use(requireEntityScope);

router.get('/', requirePermission('approval_delegation.view'), ctrl.list);
router.post('/', requirePermission('approval_delegation.manage'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('approval_delegation.manage'), validate(updateBody), ctrl.update);
router.delete('/:id', requirePermission('approval_delegation.manage'), ctrl.remove);

module.exports = router;
