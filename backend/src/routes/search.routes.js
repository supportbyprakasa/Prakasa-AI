const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/globalSearch.controller');

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
  entityId: z.coerce.number().int().positive().optional(),
  type: z.union([
    z.string().max(500),
    z.array(z.string().max(100)).max(20),
  ]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

router.use(requireAuth);

router.get(
  '/',
  requirePermission('search.global'),
  validate(querySchema, 'query'),
  ctrl.search
);

module.exports = router;
