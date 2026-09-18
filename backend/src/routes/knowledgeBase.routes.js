const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/knowledgeBase.controller');

router.use(requireAuth);
router.get('/documents', requirePermission('kb.view'), ctrl.listDocs);
router.post('/documents',
  requirePermission('kb.manage'),
  validate(z.object({
    entityId: z.number().int().positive(),
    departmentId: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(255),
    category: z.string().max(80).nullable().optional(),
    sourceDocumentId: z.number().int().positive().nullable().optional(),
    driveFileId: z.string().max(190).nullable().optional(),
    extractedText: z.string().nullable().optional(),
    visibility: z.enum(['entity', 'department', 'role', 'private']).optional(),
    allowedRoleIds: z.array(z.number().int().positive()).nullable().optional(),
  })),
  ctrl.createDoc);
router.delete('/documents/:id', requirePermission('kb.manage'), ctrl.removeDoc);
router.post('/query',
  requirePermission('kb.query'),
  validate(z.object({
    question: z.string().min(3),
    entityId: z.number().int().positive().optional(),
    topK: z.number().int().min(1).max(10).optional(),
  })),
  ctrl.query);

module.exports = router;
