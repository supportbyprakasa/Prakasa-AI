const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');

const devicesCtrl = require('../controllers/devices.controller');
const assignCtrl = require('../controllers/deviceAssignments.controller');
const handoverCtrl = require('../controllers/deviceHandoverReturn.controller');
const logsCtrl = require('../controllers/deviceLogs.controller');
const vendorCtrl = require('../controllers/softwareVendors.controller');
const subsCtrl = require('../controllers/softwareSubscriptions.controller');
const licCtrl = require('../controllers/subscriptionLicenses.controller');
const invCtrl = require('../controllers/subscriptionInvoices.controller');
const payCtrl = require('../controllers/subscriptionPayments.controller');
const dashCtrl = require('../controllers/itDashboard.controller');

router.use(requireAuth);

// ---------- Dashboard (taruh paling atas biar tidak ketutup /:id)
router.get('/dashboard/summary', requirePermission('it.dashboard.view'), dashCtrl.summary);
router.post('/dashboard/ai-report', requirePermission('it.dashboard.view'), dashCtrl.aiReport);

// ---------- Devices
const deviceBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  assetCode: z.string().min(1).max(80),
  deviceType: z.enum([
    'laptop','pc','macbook','smartphone','tablet','printer',
    'router','switch','access_point','cctv_nvr','monitor',
    'external_hdd','peripheral','other',
  ]),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(150).nullable().optional(),
  serialNumber: z.string().max(150).nullable().optional(),
  imei: z.string().max(40).nullable().optional(),
  macAddress: z.string().max(40).nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  purchasePrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).optional(),
  supplier: z.string().max(190).nullable().optional(),
  invoiceDocumentId: z.number().int().positive().nullable().optional(),
  warrantyStart: z.string().nullable().optional(),
  warrantyEnd: z.string().nullable().optional(),
  warrantyType: z.enum(['none', 'manufacturer', 'extended', 'accidental']).optional(),
  conditionState: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional(),
  currentLocation: z.string().max(190).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get('/devices', requirePermission('device.view'), devicesCtrl.list);
router.get('/devices/warranty-due', requirePermission('device.view'), devicesCtrl.warrantyDue);
router.get('/devices/:id', requirePermission('device.view'), devicesCtrl.detail);
router.post('/devices', requirePermission('device.manage'), validate(deviceBody), devicesCtrl.create);
router.patch('/devices/:id', requirePermission('device.manage'), validate(deviceBody.partial()), devicesCtrl.update);
router.delete('/devices/:id', requirePermission('device.manage'), devicesCtrl.remove);

// ---------- Assignments
const assignBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  deviceId: z.number().int().positive(),
  assignedTo: z.number().int().positive(),
  expectedReturnDate: z.string().nullable().optional(),
  location: z.string().max(190).nullable().optional(),
  purpose: z.string().max(500).nullable().optional(),
});
router.get('/assignments', requirePermission('device.view'), assignCtrl.list);
router.post('/assignments', requirePermission('device.assign'), validate(assignBody), assignCtrl.create);
router.patch('/assignments/:id/return',
  requirePermission('device.assign'),
  validate(z.object({
    conditionOnReturn: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional(),
    notes: z.string().nullable().optional(),
  })),
  assignCtrl.returnDevice);

// ---------- Handover / return docs
router.post('/assignments/:id/handover',
  requirePermission('device.handover.manage'),
  upload.single('file'),
  validate(z.object({ documentId: z.coerce.number().int().positive().optional() })),
  handoverCtrl.uploadHandover);
router.post('/assignments/:id/return-document',
  requirePermission('device.handover.manage'),
  upload.single('file'),
  validate(z.object({
    documentId: z.coerce.number().int().positive().optional(),
    conditionOnReturn: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional(),
    accessoriesReturned: z.array(z.object({
      name: z.string(),
      returned: z.boolean().optional(),
    })).optional(),
  })),
  handoverCtrl.uploadReturn);

// ---------- Device logs
router.post('/devices/:id/maintenance',
  requirePermission('device.log.manage'),
  validate(z.object({
    maintenanceDate: z.string(),
    maintenanceType: z.string().min(1).max(80),
    description: z.string().nullable().optional(),
    performedBy: z.string().max(190).nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    nextMaintenanceDate: z.string().nullable().optional(),
    documentId: z.number().int().positive().nullable().optional(),
  })),
  logsCtrl.createMaintenance);
router.post('/devices/:id/repairs',
  requirePermission('device.log.manage'),
  validate(z.object({
    reportedDate: z.string(),
    issueDescription: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    vendorName: z.string().max(190).nullable().optional(),
    sentDate: z.string().nullable().optional(),
    documentId: z.number().int().positive().nullable().optional(),
  })),
  logsCtrl.createRepair);
router.patch('/repairs/:id',
  requirePermission('device.log.manage'),
  validate(z.object({
    status: z.enum(['reported', 'in_repair', 'completed', 'unrepairable', 'cancelled']).optional(),
    returnedDate: z.string().nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    resolution: z.string().nullable().optional(),
  })),
  logsCtrl.updateRepair);
router.post('/devices/:id/warranties',
  requirePermission('device.log.manage'),
  validate(z.object({
    warrantyType: z.enum(['manufacturer', 'extended', 'accidental']),
    startDate: z.string(),
    endDate: z.string(),
    provider: z.string().max(190).nullable().optional(),
    claimNumber: z.string().max(80).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })),
  logsCtrl.createWarranty);

// ---------- Software vendors
router.get('/vendors', requirePermission('subscription.view'), vendorCtrl.list);
router.post('/vendors',
  requirePermission('software_vendor.manage'),
  validate(z.object({
    entityId: z.number().int().positive(),
    name: z.string().min(1).max(190),
    contactPerson: z.string().max(150).nullable().optional(),
    email: z.string().email().max(190).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    portalUrl: z.string().url().max(500).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  vendorCtrl.create);
router.patch('/vendors/:id',
  requirePermission('software_vendor.manage'),
  validate(z.object({
    name: z.string().min(1).max(190).optional(),
    contactPerson: z.string().max(150).nullable().optional(),
    email: z.string().email().max(190).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    portalUrl: z.string().url().max(500).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  vendorCtrl.update);
router.delete('/vendors/:id', requirePermission('software_vendor.manage'), vendorCtrl.remove);

// ---------- Subscriptions
const subsBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  vendorId: z.number().int().positive().nullable().optional(),
  productName: z.string().min(1).max(190),
  planName: z.string().max(150).nullable().optional(),
  licenseType: z.enum(['per_user', 'per_device', 'per_company', 'usage_based']).optional(),
  billingCycle: z.enum(['monthly', 'quarterly', 'yearly', 'multi_year', 'one_time']).optional(),
  totalSeats: z.number().int().nonnegative().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).optional(),
  startDate: z.string().nullable().optional(),
  renewalDate: z.string(),
  autoRenew: z.boolean().optional(),
  picUserId: z.number().int().positive().nullable().optional(),
  jurnalReferenceId: z.string().max(190).nullable().optional(),
  notes: z.string().nullable().optional(),
  generateLicenses: z.boolean().optional(),
});

router.get('/subscriptions', requirePermission('subscription.view'), subsCtrl.list);
router.get('/subscriptions/renewals-due', requirePermission('subscription.view'), subsCtrl.renewalsDue);
router.get('/subscriptions/:id', requirePermission('subscription.view'), subsCtrl.detail);
router.post('/subscriptions', requirePermission('subscription.manage'), validate(subsBody), subsCtrl.create);
router.patch('/subscriptions/:id',
  requirePermission('subscription.manage'),
  validate(subsBody.partial()),
  subsCtrl.update);
router.delete('/subscriptions/:id', requirePermission('subscription.manage'), subsCtrl.remove);

// ---------- Licenses
router.post('/subscriptions/:id/licenses',
  requirePermission('subscription.license.manage'),
  validate(z.object({
    licenseKey: z.string().max(255).nullable().optional(),
    seatLabel: z.string().max(150).nullable().optional(),
  })),
  licCtrl.createLicense);
router.post('/licenses/:id/assign',
  requirePermission('subscription.license.manage'),
  validate(z.object({ userId: z.number().int().positive() })),
  licCtrl.assignLicense);
router.post('/licenses/:id/revoke',
  requirePermission('subscription.license.manage'),
  validate(z.object({ reason: z.string().max(500).nullable().optional() })),
  licCtrl.revokeLicense);
router.post('/licenses/:id/idle',
  requirePermission('subscription.license.manage'),
  licCtrl.markIdle);

// ---------- Invoices
router.get('/invoices', requirePermission('subscription.invoice.manage'), invCtrl.list);
router.get('/invoices/pending-upload', requirePermission('subscription.invoice.manage'), invCtrl.pendingUpload);
router.post('/subscriptions/:id/invoices',
  requirePermission('subscription.invoice.manage'),
  upload.single('file'),
  validate(z.object({
    invoiceNumber: z.string().min(1).max(120),
    invoiceDate: z.string(),
    amount: z.coerce.number().nonnegative(),
    taxAmount: z.coerce.number().nonnegative().optional(),
    totalAmount: z.coerce.number().nonnegative(),
    currency: z.string().max(8).optional(),
    jurnalReferenceId: z.string().max(190).nullable().optional(),
  })),
  invCtrl.upload);
router.patch('/invoices/:id/verify',
  requirePermission('subscription.invoice.manage'),
  validate(z.object({ status: z.enum(['verified', 'void']) })),
  invCtrl.verify);

// ---------- Payments
router.post('/subscriptions/:id/payments',
  requirePermission('subscription.payment.manage'),
  validate(z.object({
    invoiceId: z.number().int().positive().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    amount: z.number().nonnegative(),
    currency: z.string().max(8).optional(),
    paymentMethod: z.string().max(80).nullable().optional(),
    referenceNo: z.string().max(120).nullable().optional(),
    jurnalReferenceId: z.string().max(190).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  payCtrl.create);

module.exports = router;
