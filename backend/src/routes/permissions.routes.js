const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/permissions.controller');

const createBody = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[a-z0-9_.]+$/, 'Kode izin hanya huruf kecil, angka, titik dan garis bawah'),
  description: z.string().max(255).optional().nullable(),
}).strict();

// The code of an existing permission never changes (code checks it against the
// stored one); only the description is editable.
const updateBody = z.object({
  code: z.string().trim().min(2).max(100).optional(),
  description: z.string().max(255).optional().nullable(),
}).strict();

// The permission catalog is defined in code (config/standardOrganization.js and
// the migrations). Renaming or adding a code could hand a role a power it was
// never meant to have, so every change is Super Admin only; the list stays
// readable for whoever manages roles.
const SUPER_ADMIN_ONLY = requireSuperAdmin('Hanya Super Admin yang bisa mengubah katalog izin');

router.use(requireAuth);
router.get('/', requirePermission('permission.manage'), ctrl.list);
router.post('/', requirePermission('permission.manage'), SUPER_ADMIN_ONLY, validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('permission.manage'), SUPER_ADMIN_ONLY, validate(updateBody), ctrl.update);
router.delete('/:id', requirePermission('permission.manage'), SUPER_ADMIN_ONLY, ctrl.remove);
module.exports = router;
module.exports.schemas = { createBody, updateBody };
