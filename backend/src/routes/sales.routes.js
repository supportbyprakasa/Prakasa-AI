const router = require('express').Router();
const { z } = require('zod');
const multer = require('multer');
const { uploadLimiter } = require('../middleware/rateLimits');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const customersCtrl = require('../controllers/salesCustomers.controller');
const dataCtrl = require('../controllers/salesData.controller');
const ordersCtrl = require('../controllers/salesOrders.controller');
const leadsCtrl = require('../controllers/salesLeads.controller');
const accurateCtrl = require('../controllers/salesAccurate.controller');
const exchangesCtrl = require('../controllers/salesExchanges.controller');
const { guardTransactions } = require('../services/salesSource');
const { cachedResponse } = require('../middleware/cachedResponse');

// Sales: Customers, Leads, Sales Pipeline (automatic) and Data Sales.
// Customers and leads live in the app; transactions follow SALES_TRANSACTION_SOURCE
// (recorded in Accurate and mirrored here, or entered here). Field visits come
// from SimpliDOTS exports and from the in-app visit form.

router.use(requireAuth);

// SimpliDOTS "DailyVisits" export (.xlsx/.xlsm); only cell values are read.
const visitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xlsm)$/i.test(file.originalname)) return cb(null, true);
    const error = new Error('Unggah export SimpliDOTS berformat .xlsx atau .xlsm.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    return cb(error);
  },
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD');
const clock = z.string().regex(/^\d{2}:\d{2}$/, 'Jam harus HH:MM');
const text = (max) => z.string().trim().max(max);
const optionalText = (max) => text(max).nullable().optional();
const id = z.number().int().positive();

// ---------- Overview, pipeline, PIC accounts, salesperson mapping
// Overview, funnel and the action badge are cached 60 s per user (their own
// customers and names; middleware/cachedResponse.js). A Sales write drops them.
const salesCache = cachedResponse('sales:', 60 * 1000, { perUser: true });
router.get('/overview', requirePermission('sales.customer.view'), salesCache, dataCtrl.overview);
router.get('/funnel', requirePermission(['sales.pipeline.view', 'sales.customer.view']), salesCache, dataCtrl.funnel);
router.get('/scope', requirePermission('sales.customer.view'), dataCtrl.scope);
router.get('/actions', requirePermission('sales.customer.view'), dataCtrl.actions);
router.get('/actions/count', requirePermission('sales.customer.view'), salesCache, dataCtrl.actionCount);
router.get('/targets', requirePermission('sales.customer.view'), dataCtrl.targets);
router.put('/targets',
  requirePermission('sales.master.manage'),
  validate(z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Bulan harus YYYY-MM'),
    targets: z.array(z.object({
      userId: id,
      revenueTarget: z.number().nonnegative().max(1e14).nullable(),
      nooTarget: z.number().int().nonnegative().max(100000).nullable(),
    }).strict()).min(1).max(500),
  }).strict()),
  dataCtrl.saveTargets);
router.get('/accounts', requirePermission('sales.customer.view'), dataCtrl.accounts);
router.get('/people', requirePermission('sales.master.manage'), dataCtrl.listPeople);
router.put('/people',
  requirePermission('sales.master.manage'),
  validate(z.object({
    mappings: z.array(z.object({ name: z.string().min(1).max(120), userId: id.nullable() }).strict()).min(1).max(500),
  }).strict()),
  dataCtrl.savePeople);

// ---------- Customers
const customerBody = z.object({
  name: text(190).min(1),
  legalForm: z.enum(['PR', 'PT', 'CV', 'IN']).nullable().optional(),
  channel: optionalText(40),
  cityCode: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Kode kota 3 huruf').optional(),
  customerCode: z.string().trim().min(3).max(60).optional(),
  contactPerson: optionalText(150),
  phone: optionalText(40),
  businessPhone: optionalText(40),
  email: z.string().trim().email().max(190).nullable().optional().or(z.literal('')),
  address: optionalText(500),
  city: optionalText(100),
  segment: optionalText(80),
  notes: optionalText(2000),
  ownerUserId: id.nullable().optional(),
}).strict();
const customerUpdate = customerBody.omit({ cityCode: true, customerCode: true }).partial().strict();
router.get('/customers', requirePermission('sales.customer.view'), customersCtrl.list);
router.get('/customers/next-code', requirePermission('sales.customer.manage'), customersCtrl.nextCode);
router.get('/customers/:id', requirePermission('sales.customer.view'), customersCtrl.detail);
router.get('/customers/:id/visits', requirePermission('sales.customer.view'), customersCtrl.visits);
router.get('/customers/:id/activity', requirePermission('sales.customer.view'), customersCtrl.activity);
router.post('/customers', requirePermission('sales.customer.manage'), validate(customerBody), customersCtrl.create);
router.patch('/customers/:id', requirePermission('sales.customer.manage'), validate(customerUpdate), customersCtrl.update);
router.delete('/customers/:id', requirePermission('sales.customer.manage'), customersCtrl.remove);

// ---------- Leads and visits
const leadBody = z.object({
  name: text(190).min(1),
  address: optionalText(500),
  area: optionalText(120),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  ownerUserId: id.nullable().optional(),
  notes: optionalText(500),
}).strict();
router.get('/leads', requirePermission('sales.customer.view'), leadsCtrl.listLeads);
router.get('/leads/:id', requirePermission('sales.customer.view'), leadsCtrl.leadDetail);
router.post('/leads', requirePermission('sales.customer.manage'), validate(leadBody), leadsCtrl.createLead);
router.patch('/leads/:id',
  requirePermission('sales.customer.manage'),
  validate(leadBody.omit({ notes: true }).partial().extend({
    status: z.enum(['open', 'dropped']).optional(),
    customerId: id.nullable().optional(),
  }).strict()),
  leadsCtrl.updateLead);
router.post('/leads/:id/visits',
  requirePermission('sales.customer.manage'),
  validate(z.object({
    visitDate: date,
    checkIn: clock.nullable().optional(),
    checkOut: clock.nullable().optional(),
    summary: optionalText(2000),
    isPlanned: z.boolean().optional(),
    totalSales: z.number().nonnegative().max(1e13).optional(),
  }).strict()),
  leadsCtrl.addVisit);
router.post('/visits/import', requirePermission('sales.master.manage'), uploadLimiter, visitUpload.single('file'), leadsCtrl.importVisits);

// ---------- Accurate data waiting for the division's approval (read-only;
// staged by the integration, decided in the approval engine)
router.get('/accurate/sync', requirePermission('sales.master.manage'), accurateCtrl.syncStatus);
router.post('/accurate/sync', requirePermission('sales.master.manage'), accurateCtrl.startSync);
// Batches: Sales supervisors, and Supervisors/Heads of every division that
// receives Accurate data (each sees their own division's batches).
const batchViewers = requirePermission(['sales.master.manage', 'accurate.batch.view']);
router.get('/accurate/batches', batchViewers, accurateCtrl.list);
router.get('/accurate/quality', batchViewers, accurateCtrl.qualityList);
router.get('/accurate/batches/:id', batchViewers, accurateCtrl.detail);
router.get('/accurate/batches/:id/items', batchViewers, accurateCtrl.items);
router.post('/leads/:id/convert',
  requirePermission('sales.customer.manage'),
  validate(customerBody.partial({ name: true }).strict()),
  leadsCtrl.convertLead);

// ---------- Sales orders, surat jalan, invoice, payments
const lineBody = z.object({
  skuCode: optionalText(60),
  productName: text(255).min(1),
  qty: z.number().positive().max(1e9),
  unitPrice: z.number().nonnegative().max(1e12),
  taxable: z.boolean().optional(),
}).strict();
const orderBody = z.object({
  customerId: id,
  orderNumber: z.string().trim().min(1).max(80).optional(),
  orderDate: date,
  deliveryDate: date.nullable().optional(),
  channel: optionalText(40),
  ownerUserId: id.nullable().optional(),
  deliveryFee: z.number().nonnegative().max(1e12).optional(),
  notes: optionalText(2000),
  lines: z.array(lineBody).min(1).max(200),
}).strict();
const documentBody = z.object({ number: z.string().trim().min(1).max(80).optional(), date, dueDate: date.nullable().optional() }).strict();
router.get('/orders', requirePermission('sales.order.view'), ordersCtrl.listOrders);
router.get('/receivables/aging', requirePermission('sales.order.view'), ordersCtrl.receivablesAging);
// Tukar faktur (program 2.3): see with the invoices, record with order rights.
const exchangeBody = z.object({
  invoiceNumber: z.string().min(1).max(80).optional(),
  exchangedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  receiptNo: z.string().max(80).nullable().optional(),
  promisedPayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  note: z.string().max(255).nullable().optional(),
});
router.get('/invoice-exchanges', requirePermission('sales.order.view'), exchangesCtrl.list);
router.post('/invoice-exchanges', requirePermission('sales.order.manage'), validate(exchangeBody), exchangesCtrl.record);
router.patch('/invoice-exchanges/:id', requirePermission('sales.order.manage'), validate(exchangeBody), exchangesCtrl.update);
router.post('/invoice-exchanges/:id/cancel', requirePermission('sales.order.manage'), exchangesCtrl.cancel);
router.get('/orders/next-number', requirePermission('sales.order.manage'), ordersCtrl.nextNumber);
router.get('/orders/:id', requirePermission('sales.order.view'), ordersCtrl.orderDetail);
router.get('/orders/:id/print', requirePermission('sales.order.view'), ordersCtrl.printData);
router.get('/document-settings', requirePermission('sales.order.view'), ordersCtrl.getDocumentSettings);
router.put('/document-settings',
  requirePermission('sales.master.manage'),
  validate(z.object({
    companyName: optionalText(190),
    address: optionalText(500),
    phone: optionalText(60),
    email: optionalText(190),
    npwp: optionalText(40),
    bankAccounts: optionalText(2000),
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    invoiceNote: optionalText(2000),
    deliveryNote: optionalText(2000),
  }).strict()),
  ordersCtrl.saveDocumentSettings);
router.post('/orders', requirePermission('sales.order.manage'), guardTransactions, validate(orderBody), ordersCtrl.createOrder);
router.patch('/orders/:id',
  requirePermission('sales.order.manage'),
  guardTransactions,
  validate(orderBody.omit({ customerId: true, orderNumber: true }).partial().strict()),
  ordersCtrl.updateOrder);
router.delete('/orders/:id', requirePermission('sales.order.manage'), guardTransactions, ordersCtrl.cancelOrder);
router.post('/orders/:id/delivery', requirePermission('sales.order.manage'), guardTransactions, validate(documentBody), ordersCtrl.setDelivery);
router.post('/orders/:id/invoice', requirePermission('sales.order.manage'), guardTransactions, validate(documentBody), ordersCtrl.setInvoice);
router.post('/orders/:id/payments',
  requirePermission('sales.order.manage'),
  guardTransactions,
  validate(z.object({
    amount: z.number().positive().max(1e13),
    paidAt: date,
    method: optionalText(40),
    note: optionalText(500),
  }).strict()),
  ordersCtrl.addPayment);
router.get('/documents', requirePermission('sales.order.view'), ordersCtrl.listDocuments);

// ---------- Products (SKU)
const productBody = z.object({
  skuCode: z.string().trim().min(2).max(60),
  name: text(255).min(1),
  category: optionalText(20),
  unit: optionalText(20),
  price: z.number().nonnegative().max(1e12).nullable().optional(),
  costPrice: z.number().nonnegative().max(1e12).nullable().optional(),
}).strict();
router.get('/products', requirePermission(['sales.order.view', 'sales.master.manage']), ordersCtrl.listProducts);
router.post('/products', requirePermission('sales.master.manage'), guardTransactions, validate(productBody), ordersCtrl.createProduct);
router.patch('/products/:id',
  requirePermission('sales.master.manage'),
  guardTransactions,
  validate(productBody.omit({ skuCode: true }).partial().extend({ isActive: z.boolean().optional() }).strict()),
  ordersCtrl.updateProduct);

module.exports = router;
