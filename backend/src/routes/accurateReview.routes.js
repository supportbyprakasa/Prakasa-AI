const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { batchReviewLimiter } = require('../middleware/rateLimits');
const ctrl = require('../controllers/accurateReview.controller');

// "Periksa dengan AI" on a Data Accurate batch (Prakasa AI Wave D2). Mounted at
// /api/v1/accurate. The same people who may open the batch (the batch view
// permission; the service then checks the batch itself is theirs to see).
// A review only reads and writes its own notes: deciding a batch stays on
// POST /approvals/:id/decide, pressed by a human.
router.use(requireAuth);
const batchViewers = requirePermission(['sales.master.manage', 'accurate.batch.view']);

// The last review of the batch (who ran it and when), or null.
router.get('/batches/:id/review', batchViewers, ctrl.latest);
// Runs the automatic checks; with { ai: true } Prakasa AI then writes a note.
router.post('/batches/:id/review', batchViewers, batchReviewLimiter, validate(z.object({ ai: z.boolean().optional() }).strict()), ctrl.review);

module.exports = router;
