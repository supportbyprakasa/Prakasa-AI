const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/myDrive.controller');

const folderBody = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).max(190).nullable().optional(),
});

const fileBody = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['document', 'spreadsheet', 'presentation']),
  parentId: z.string().min(1).max(190).nullable().optional(),
});

const uploadMeta = z.object({
  parentId: z.string().min(1).max(190).nullable().optional(),
});

router.use(requireAuth);
router.use(requirePermission('mydrive.view'));
router.get('/files', ctrl.listFiles);
router.post('/folders', requirePermission('mydrive.manage'), validate(folderBody), ctrl.createFolder);
router.post('/files', requirePermission('mydrive.manage'), validate(fileBody), ctrl.createFile);
router.post('/upload', requirePermission('mydrive.manage'), upload.single('file'), validate(uploadMeta), ctrl.uploadFile);
router.delete('/files/:fileId', requirePermission('mydrive.manage'), ctrl.removeFile);

module.exports = router;
