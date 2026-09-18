const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const customersCtrl = require('../controllers/salesCustomers.controller');
const pipelineCtrl = require('../controllers/salesPipeline.controller');
const visitCtrl = require('../controllers/salesVisitReports.controller');
const sampleCtrl = require('../controllers/salesSampleRequests.controller');
const quoteCtrl = require('../controllers/salesQuotations.controller');
const botCtrl = require('../controllers/fieldBot.controller');

router.use(requireAuth);

// ---------- Customers
const customerBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  contactPerson: z.string().max(150).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(190).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  segment: z.string().max(80).nullable().optional(),
  notes: z.string().nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
});
router.get('/customers', requirePermission('sales.customer.view'), customersCtrl.list);
router.post('/customers', requirePermission('sales.customer.manage'), validate(customerBody), customersCtrl.create);
router.patch('/customers/:id', requirePermission('sales.customer.manage'), validate(customerBody.partial()), customersCtrl.update);
router.delete('/customers/:id', requirePermission('sales.customer.manage'), customersCtrl.remove);

// ---------- Pipeline
const pipelineBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive(),
  inquiryId: z.number().int().positive().nullable().optional(),
  dealTitle: z.string().min(1).max(190),
  stage: z.enum([
    'new_inquiry','contacted','need_follow_up','sample_requested',
    'quotation_sent','negotiation','won','lost','on_hold',
  ]).optional(),
  estimatedValue: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
});
router.get('/pipeline', requirePermission('sales.pipeline.view'), pipelineCtrl.list);
router.get('/pipeline/:id', requirePermission('sales.pipeline.view'), pipelineCtrl.detail);
router.post('/pipeline', requirePermission('sales.pipeline.manage'), validate(pipelineBody), pipelineCtrl.create);
router.patch('/pipeline/:id', requirePermission('sales.pipeline.manage'), validate(pipelineBody.partial()), pipelineCtrl.update);
router.patch('/pipeline/:id/stage',
  requirePermission('sales.pipeline.manage'),
  validate(z.object({
    stage: z.enum([
      'new_inquiry','contacted','need_follow_up','sample_requested',
      'quotation_sent','negotiation','won','lost','on_hold',
    ]),
    note: z.string().max(500).nullable().optional(),
  })),
  pipelineCtrl.updateStage);
router.delete('/pipeline/:id', requirePermission('sales.pipeline.manage'), pipelineCtrl.remove);

// ---------- Visit reports
router.get('/visit-reports', requirePermission('sales.visit.view'), visitCtrl.list);
router.post('/visit-reports',
  requirePermission('sales.visit.create'),
  validate(z.object({
    entityId: z.number().int().positive(),
    departmentId: z.number().int().positive().nullable().optional(),
    customerId: z.number().int().positive().nullable().optional(),
    pipelineId: z.number().int().positive().nullable().optional(),
    visitDate: z.string(),
    location: z.string().max(255).nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    summary: z.string().nullable().optional(),
    rawInput: z.string().nullable().optional(),
    photos: z.array(z.string()).nullable().optional(),
  })),
  visitCtrl.create);

// ---------- Sample requests
const sampleBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive(),
  pipelineId: z.number().int().positive().nullable().optional(),
  productName: z.string().min(1).max(190),
  productSku: z.string().max(80).nullable().optional(),
  quantity: z.number().int().positive(),
  unit: z.string().max(40).optional(),
  purpose: z.string().max(500).nullable().optional(),
  deliveryAddress: z.string().max(500).nullable().optional(),
  requestedDeliveryDate: z.string().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
router.get('/sample-requests', requirePermission('sales.sample.view'), sampleCtrl.list);
router.post('/sample-requests', requirePermission('sales.sample.request'), validate(sampleBody), sampleCtrl.create);
router.patch('/sample-requests/:id',
  requirePermission('sales.sample.approve'),
  validate(z.object({
    action: z.enum(['approve', 'reject']),
    reason: z.string().max(500).nullable().optional(),
  })),
  sampleCtrl.decide);

// ---------- Quotations
const quoteBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive(),
  pipelineId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive().nullable().optional(),
  quotationNumber: z.string().min(1).max(80),
  totalAmount: z.number().nonnegative().optional(),
  currency: z.string().max(8).optional(),
  validityDate: z.string().nullable().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
  notes: z.string().nullable().optional(),
});
router.get('/quotations', requirePermission('sales.quotation.view'), quoteCtrl.list);
router.post('/quotations', requirePermission('sales.quotation.manage'), validate(quoteBody), quoteCtrl.create);
router.patch('/quotations/:id/status',
  requirePermission('sales.quotation.manage'),
  validate(z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']) })),
  quoteCtrl.updateStatus);

// ---------- Field Sales Bot
router.post('/field-bot/sessions',
  requirePermission('sales.field_bot.use'),
  validate(z.object({
    quickAction: z.string().max(80).nullable().optional(),
    context: z.record(z.any()).nullable().optional(),
  })),
  botCtrl.startSession);
router.get('/field-bot/sessions/:id',
  requirePermission('sales.field_bot.use'),
  botCtrl.getSession);
router.post('/field-bot/sessions/:id/message',
  requirePermission('sales.field_bot.use'),
  validate(z.object({
    text: z.string().min(1),
    mediaDriveFileIds: z.array(z.string()).nullable().optional(),
  })),
  botCtrl.sendMessage);
router.post('/field-bot/sessions/:id/close',
  requirePermission('sales.field_bot.use'),
  botCtrl.closeSession);

module.exports = router;
