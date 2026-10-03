const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/divisionStorage.controller');

const createBody = z.object({
  departmentId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  kind: z.enum(['document', 'spreadsheet', 'presentation']),
});

router.use(requireAuth);
router.use(requirePermission('document.view'));
router.get('/divisions', ctrl.listDivisions);
router.get('/files', ctrl.listFiles);
router.post('/files', requirePermission('document.create'), validate(createBody), ctrl.createFile);
router.delete('/files/:fileId', requirePermission('document.delete'), ctrl.removeFile);

module.exports = router;
