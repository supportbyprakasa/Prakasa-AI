const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/peopleDirectory.controller');
const { importMatrix } = require('./importSchemas');

// People & Culture → Direktori (wave 1, row 1.1). The entity is always the
// signed-in user's; nothing here accepts an entity from the request.

router.use(requireAuth);

const PHONE_RE = /^[+0-9(][0-9()\-\s./]*(\s*(ext\.?|x)\s*\d{1,6})?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[pu]\d{1,10}$/;

const personFields = {
  position: z.string().trim().max(150).nullable().optional(),
  managerKey: z.string().regex(KEY_RE, 'Kunci atasan tidak valid').nullable().optional(),
  workPhone: z.string().trim().max(40).regex(PHONE_RE, 'Nomor telepon kerja tidak valid').nullable().optional().or(z.literal('')),
  locationId: z.number().int().positive().nullable().optional(),
  kind: z.enum(['employee', 'group_staff', 'excluded']).optional(),
  excludedReason: z.string().trim().max(160).nullable().optional(),
  status: z.enum(['active', 'resigned']).optional(),
  resignedOn: z.string().regex(DATE_RE, 'Format tanggal YYYY-MM-DD').optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};

// Name, work email and division only for a person without an app account.
const createSchema = z.object({
  name: z.string().trim().min(1).max(150),
  workEmail: z.string().trim().max(190).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  confirmDuplicateName: z.boolean().optional(),
  ...personFields,
}).strict();

const updateSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  workEmail: z.string().trim().max(190).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  ...personFields,
}).strict();

const importSchema = z.object({
  people: importMatrix,
  personChoices: z.record(z.string().regex(/^p:\d+$/), z.enum(['link', 'new'])).optional(),
  companyCode: z.string().trim().max(20).optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  updates: z.array(z.string().regex(/^p:\d+$/)).max(5000).optional(),
}).strict();

// Penanggung jawab IT/GA for onboarding/offboarding checklists (wave 2, decision 12).
const hrga = require('../controllers/hrga.controller');
router.get('/settings/pic', requirePermission('hrga.checklist_template.manage'), hrga.getPic);
router.put('/settings/pic', requirePermission('hrga.checklist_template.manage'),
  validate(z.object({
    itUserId: z.number().int().positive().nullable(),
    gaUserId: z.number().int().positive().nullable(),
  }).strict()),
  hrga.putPic);

router.get('/directory', requirePermission('people.directory.view'), ctrl.list);
router.get('/directory/summary', requirePermission('people.directory.view'), ctrl.summary);
router.get('/directory/org', requirePermission('people.directory.view'), ctrl.org);
router.post('/directory/import/preview', requirePermission('people.directory.manage'), validate(importSchema), ctrl.importPreview);
router.post('/directory/import/apply', requirePermission('people.directory.manage'), validate(importSchema), ctrl.importApply);
router.get('/directory/:key', requirePermission('people.directory.view'), ctrl.detail);
router.post('/directory', requirePermission('people.directory.manage'), validate(createSchema), ctrl.create);
router.patch('/directory/:key', requirePermission('people.directory.manage'), validate(updateSchema), ctrl.update);

module.exports = router;
module.exports.schemas = { createSchema, updateSchema, importSchema };
