const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/workspaceSync.controller');

const updateSchema = z.object({
  departmentId: z.number().int().positive().nullable().optional(),
  roleId: z.number().int().positive().nullable().optional(),
});

const applySchema = z.object({
  departmentId: z.number().int().positive().optional(),
  roleId: z.number().int().positive().optional(),
});

router.use(requireAuth);
router.use(requirePermission('user.manage'));
router.post('/fetch', ctrl.fetchCandidates);
router.get('/candidates', ctrl.listCandidates);
router.patch('/candidates/:id', validate(updateSchema), ctrl.updateCandidate);
router.post('/candidates/:id/dismiss', ctrl.dismissCandidate);
router.post('/candidates/:id/apply', validate(applySchema), ctrl.applyCandidate);
router.post('/backfill-drive-access', ctrl.backfillDriveAccess);

module.exports = router;
