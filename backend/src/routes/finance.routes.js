const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/finance.controller');

// Finance — pengajuan pembayaran & reimbursement (services/financeRequests.service.js).
// Bodies are strict: the entity, the division, the requester and the status are
// never taken from the client. The route permission is the outer gate; the
// service decides per request (own / division / Finance).

const REQUEST = 'finance.request';
const VIEW = ['finance.view', REQUEST];

const typed = (message) => ({ required_error: message, invalid_type_error: message });
const text = (max, label) => z.string(typed(`${label} harus berupa teks`)).trim().max(max, `${label} paling panjang ${max} karakter`);
const optionalText = (max, label) => text(max, label).nullable().optional();
const money = (label) => z.number(typed(`Isi ${label.toLowerCase()} dengan angka`))
  .nonnegative(`${label} tidak boleh minus`)
  .max(9999999999999, `${label} terlalu besar`);
const day = (label) => z.string(typed(`${label} harus berupa tanggal`))
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} harus berformat YYYY-MM-DD`);
const UNKNOWN = 'Ada isian yang tidak dikenal';

const fields = {
  title: text(255, 'Judul').min(1, 'Isi judul pengajuan'),
  description: optionalText(5000, 'Keterangan'),
  category: optionalText(80, 'Kategori'),
  payeeName: optionalText(190, 'Nama penerima'),
  payeeType: z.enum(['vendor', 'employee', 'other'], typed('Jenis penerima tidak dikenal')).optional(),
  // Vendor bank details only; a reimbursement refuses them (service, 400).
  payeeBank: optionalText(120, 'Nama bank'),
  payeeAccountNumber: optionalText(80, 'Nomor rekening'),
  payeeAccountName: optionalText(190, 'Nama pemilik rekening'),
  amount: money('Subtotal'),
  taxAmount: money('Pajak').optional(),
  totalAmount: money('Total').optional(),
  requestDate: day('Tanggal pengajuan').optional(),
  requestedPaymentDate: day('Tanggal bayar yang diminta').nullable().optional(),
  dueDate: day('Jatuh tempo').nullable().optional(),
  notes: optionalText(5000, 'Catatan'),
};

const createBody = z.object({
  workflowType: z.enum(['payment_request', 'reimbursement'], typed('Pilih jenis pengajuan')),
  ...fields,
}).strict(UNKNOWN);

const updateBody = z.object(fields).partial().strict(UNKNOWN);

const attachBody = z.object({
  attachmentType: z.enum(['invoice', 'receipt', 'quotation', 'po', 'bank_proof', 'tax_doc', 'other'], typed('Jenis lampiran tidak dikenal')).optional(),
  documentId: z.coerce.number().int().positive().optional(),
  name: optionalText(255, 'Nama lampiran'),
}).strict(UNKNOWN);

const applyResultBody = z.object({
  // Kept for older callers; the status always comes from the decided approval.
  status: z.enum(['approved', 'rejected', 'revision_requested']).optional(),
  note: optionalText(500, 'Catatan'),
}).strict(UNKNOWN);

const processingBody = z.object({
  status: z.enum(['processing', 'paid', 'cancelled'], typed('Status tidak dikenal')),
  // "Nomor bukti di Accurate" — text only; the app never writes to Accurate.
  accurateReference: optionalText(190, 'Nomor bukti di Accurate'),
  note: optionalText(500, 'Catatan'),
}).strict(UNKNOWN);

const cancelBody = z.object({
  reason: text(255, 'Alasan').min(1, 'Tulis alasan pembatalan'),
}).strict(UNKNOWN);

router.use(requireAuth);

router.get('/payment-requests', requirePermission(VIEW), ctrl.list);
router.get('/payment-requests/:id', requirePermission(VIEW), ctrl.detail);

router.post('/payment-requests', requirePermission(REQUEST), validate(createBody), ctrl.create);
router.patch('/payment-requests/:id', requirePermission([REQUEST, 'finance.manage']), validate(updateBody), ctrl.update);
router.delete('/payment-requests/:id', requirePermission([REQUEST, 'finance.manage']), ctrl.remove);

router.post('/payment-requests/:id/attachments',
  requirePermission([REQUEST, 'finance.manage', 'finance.process']),
  upload.single('file'),
  validate(attachBody),
  ctrl.uploadAttachment);

// Completeness check (rules + AI advice; the AI never approves).
router.post('/payment-requests/:id/document-check', requirePermission([REQUEST, 'finance.document_check']), ctrl.runDocumentCheck);

router.post('/payment-requests/:id/submit-approval', requirePermission([REQUEST, 'finance.manage']), ctrl.submitForApproval);

// Fallback: copy a decision made before the approval hook existed.
router.post('/payment-requests/:id/apply-approval', requirePermission('finance.approve'), validate(applyResultBody), ctrl.applyApprovalResult);

router.patch('/payment-requests/:id/processing', requirePermission('finance.process'), validate(processingBody), ctrl.updateProcessing);
router.post('/payment-requests/:id/cancel', requirePermission([REQUEST, 'finance.process']), validate(cancelBody), ctrl.cancel);

module.exports = router;
module.exports.schemas = { createBody, updateBody, attachBody, applyResultBody, processingBody, cancelBody };
