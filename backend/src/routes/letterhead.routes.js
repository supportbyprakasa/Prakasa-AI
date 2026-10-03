const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/letterhead.controller');

const saveBody = z.object({
  departmentId: z.number().int().positive(),
  imageBase64: z.string().min(20),
});

router.use(requireAuth);
router.use(requirePermission('letterhead.view'));
router.get('/divisions', ctrl.listDivisions);
router.get('/', ctrl.get);
router.post('/', requirePermission('letterhead.manage'), validate(saveBody), ctrl.save);

module.exports = router;
