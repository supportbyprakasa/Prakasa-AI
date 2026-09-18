const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/finance.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  workflowType: z.enum(['payment_request', 'reimbursement']),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  payeeName: z.string().max(190).nullable().optional(),
  payeeType: z.enum(['vendor', 'employee', 'other']).optional(),
  payeeBank: z.string().max(120).nullable().optional(),
  payeeAccountNumber: z.string().max(80).nullable().optional(),
  payeeAccountName: z.string().max(190).nullable().optional(),
  amount: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().nonnegative(),
  currency: z.string().max(8).optional(),
  requestDate: z.string(),
  requestedPaymentDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  financePicUserId: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const attachBody = z.object({
  attachmentType: z.enum(['invoice', 'receipt', 'quotation', 'po', 'bank_proof', 'tax_doc', 'other']).optional(),
  documentId: z.coerce.number().int().positive().optional(),
  name: z.string().max(255).optional(),
});

const applyResultBody = z.object({
  status: z.enum(['approved', 'rejected', 'revision_requested']),
  note: z.string().max(500).nullable().optional(),
});

const processingBody = z.object({
  status: z.enum(['processing', 'paid', 'cancelled']),
  jurnalReferenceId: z.string().max(190).nullable().optional(),
  jurnalReferenceUrl: z.string().url().max(500).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const linkJurnalBody = z.object({
  jurnalReferenceId: z.string().max(190).nullable().optional(),
  jurnalReferenceUrl: z.string().url().max(500).nullable().optional(),
});

router.use(requireAuth);

// list & detail
router.get('/payment-requests', requirePermission('finance.view'), ctrl.list);
router.get('/payment-requests/:id', requirePermission('finance.view'), ctrl.detail);

// create & update (draft)
router.post('/payment-requests', requirePermission('finance.request'), validate(createBody), ctrl.create);
router.patch('/payment-requests/:id', requirePermission('finance.manage'), validate(createBody.partial()), ctrl.update);
router.delete('/payment-requests/:id', requirePermission('finance.manage'), ctrl.remove);

// attachments
router.post('/payment-requests/:id/attachments',
  requirePermission('finance.manage'),
  upload.single('file'),
  validate(attachBody),
  ctrl.uploadAttachment);

// document check (AI)
router.post('/payment-requests/:id/document-check',
  requirePermission('finance.document_check'),
  ctrl.runDocumentCheck);

// submit ke approval
router.post('/payment-requests/:id/submit-approval',
  requirePermission('finance.request'),
  ctrl.submitForApproval);

// terapkan hasil approval (manual oleh Finance)
router.post('/payment-requests/:id/apply-approval',
  requirePermission('finance.approve'),
  validate(applyResultBody),
  ctrl.applyApprovalResult);

// processing / paid / cancelled + link Jurnal.id
router.patch('/payment-requests/:id/processing',
  requirePermission('finance.process'),
  validate(processingBody),
  ctrl.updateProcessing);

router.patch('/payment-requests/:id/jurnal-reference',
  requirePermission('finance.process'),
  validate(linkJurnalBody),
  ctrl.linkJurnal);

module.exports = router;
