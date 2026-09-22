const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/globalSearch.controller');

const querySchema = z.object({
  q: z.string().min(2).max(200),
  entityId: z.union([z.string(), z.number()]).optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  page: z.union([z.string(), z.number()]).optional(),
  limit: z.union([z.string(), z.number()]).optional(),
});

// Validate query string via a tiny wrapper (validate expects body by default).
function validateQuery(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.query);
    if (!r.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query tidak valid',
          details: r.error.flatten(),
        },
      });
    }
    req.query = r.data;
    next();
  };
}

router.use(requireAuth);
router.get('/',
  requirePermission('search.global'),
  validateQuery(querySchema),
  ctrl.search);

module.exports = router;