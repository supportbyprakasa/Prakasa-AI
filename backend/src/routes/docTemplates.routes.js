const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/docTemplates.controller');

// Template dokumen, kop & footer per divisi, dokumen dari template (migration 115).
// The service checks which division a user may manage (own division, or the
// whole company for Management Office Head / Super Admin).

router.use(requireAuth);

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const prefix = z.string().trim().regex(/^[A-Za-z0-9]{2,12}$/, 'Awalan nomor 2–12 huruf/angka, misalnya BAST atau SK');

const createBody = z.object({
  name: text(150),
  departmentId: z.number().int().positive().nullable().optional(),
  source: z.enum(['blank', 'copy']),
  sourceUrl: optionalText(500),
  prefix: prefix.optional(),
  documentType: z.string().trim().regex(/^[a-z0-9_]{2,40}$/).optional(),
  description: optionalText(255),
}).strict();
const updateBody = z.object({
  name: text(150).optional(),
  prefix: prefix.optional(),
  description: optionalText(255),
  isActive: z.boolean().optional(),
}).strict();
const generateBody = z.object({
  departmentId: z.number().int().positive().nullable().optional(),
  title: optionalText(150),
  values: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), z.string().max(2000)).default({}),
}).strict();
const kopBody = z.object({
  layout: z.enum(['logo_left', 'centered', 'letterhead_image']),
  companyName: text(150),
  headerLines: optionalText(600),
  footerText: optionalText(600),
  showPageNumber: z.boolean(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  logoBase64: z.string().max(1500000).nullable().optional(),
  version: z.number().int().positive().optional(),
}).strict();

router.get('/', requirePermission('template.view'), ctrl.list);
router.post('/prepare-builtins', requirePermission('template.manage'), validate(z.object({}).strict()), ctrl.prepareBuiltins);
router.post('/', requirePermission('template.manage'), validate(createBody), ctrl.create);
router.get('/kops', requirePermission('template.view'), ctrl.kops);
router.put('/kops/:scope', requirePermission('template.manage'), validate(kopBody), ctrl.saveKop);
router.get('/kops/:scope/logo', requirePermission('template.view'), ctrl.kopLogo);
router.get('/generated', requirePermission('document.view'), ctrl.generated);
router.patch('/:id', requirePermission('template.manage'), validate(updateBody), ctrl.update);
router.post('/:id/check', requirePermission('template.view'), validate(z.object({}).strict()), ctrl.check);
router.post('/:id/generate', requirePermission('template.view'), requirePermission('document.create'), validate(generateBody), ctrl.generate);

module.exports = router;
module.exports.schemas = { createBody, updateBody, generateBody, kopBody };
