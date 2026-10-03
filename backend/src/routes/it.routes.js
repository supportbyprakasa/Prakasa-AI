const router = require('express').Router();
const { z } = require('zod');
const { httpsUrl } = require('../utils/safeUrl');
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
const locationsCtrl = require('../controllers/orgLocations.controller');
const importCtrl = require('../controllers/deviceImport.controller');
const infraCtrl = require('../controllers/itInfrastructure.controller');
const { importMatrix } = require('./importSchemas');
const { guardSecretBody } = require('../services/secretText');
const { VENDOR_KINDS } = require('../config/itInfra');
const { DEVICE_TYPES, DEVICE_STATUSES, LOCATION_KINDS } = require('../config/itAssets');

router.use(requireAuth);

// ---------- Tickets (open to every role, not just IT — mounted first, own permissions)
router.use('/tickets', require('./itTickets.routes'));

// ---------- Infrastructure registers (People & Culture wave 2, row 2.3; own permissions)
router.use('/infrastructure', require('./itInfrastructure.routes'));
// A person's active company lines (number/extension only) for the directory profile — every directory viewer.
router.get('/phone-lines/person/:personId', requirePermission('people.directory.view'), infraCtrl.personLines);

// ---------- Dashboard (taruh paling atas biar tidak ketutup /:id)
router.get('/dashboard/summary', requirePermission('it.dashboard.view'), dashCtrl.summary);
router.post('/dashboard/ai-report', requirePermission('it.dashboard.view'), dashCtrl.aiReport);

// ---------- Devices
const deviceBody = z.object({
  entityId: z.number().int().positive().optional(), // ignored: the company is the signed-in user's
  departmentId: z.number().int().positive().nullable().optional(),
  // Optional and not unique: the real PFN report reuses asset numbers (rule 16).
  assetCode: z.string().trim().max(80).nullable().optional(),
  deviceType: z.enum(DEVICE_TYPES),
  brand: z.string().max(100).nullable().optional(),
  // "Merek / model" is one field in the form, stored in model (rule 20).
  model: z.string().max(150).nullable().optional(),
  serialNumber: z.string().trim().max(150).nullable().optional(),
  ramGb: z.number().int().min(1).max(4096).nullable().optional(),
  storageGb: z.number().int().min(1).max(1048576).nullable().optional(),
  osVersion: z.string().trim().max(80).nullable().optional(),
  purchaseYear: z.number().int().min(1990).max(2100).nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
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

// Import of the owner's device report ("Device Inventory" + optional "User List").
const deviceImportBody = z.object({
  devices: importMatrix,
  people: importMatrix.nullable().optional(),
  createLocations: z.boolean().optional(),
  personChoices: z.record(z.string().regex(/^p:\d+$/), z.enum(['link', 'new'])).optional(),
  companyCode: z.string().trim().max(20).optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  updates: z.array(z.string().regex(/^[dp]:\d+$/)).max(10000).optional(),
}).strict();

// The holder of an Aktif device: exactly one of an account, a directory person or a team label.
const holderFields = {
  assignedTo: z.number().int().positive().optional(),
  personId: z.number().int().positive().optional(),
  holderLabel: z.string().trim().min(1).max(120).optional(),
};

router.get('/devices', requirePermission('device.view'), devicesCtrl.list);
router.get('/devices/export', requirePermission('device.view'), devicesCtrl.exportRows);
router.get('/devices/warranty-due', requirePermission('device.view'), devicesCtrl.warrantyDue);
router.post('/devices/import/preview', requirePermission('device.manage'), validate(deviceImportBody), importCtrl.preview);
router.post('/devices/import/apply', requirePermission('device.manage'), validate(deviceImportBody), importCtrl.apply);
router.get('/devices/:id', requirePermission('device.view'), devicesCtrl.detail);
router.post('/devices', requirePermission('device.manage'), validate(deviceBody), devicesCtrl.create);
router.patch('/devices/:id', requirePermission('device.manage'), validate(deviceBody.partial()), devicesCtrl.update);
router.patch('/devices/:id/status',
  requirePermission('device.manage'),
  validate(z.object({
    status: z.enum(DEVICE_STATUSES),
    note: z.string().trim().max(500).nullable().optional(),
    ...holderFields,
  }).strict().superRefine((body, ctx) => {
    // IT Lead: a device leaving service always carries its reason in the audit log.
    if (['damaged', 'retired', 'lost', 'disposed'].includes(body.status) && !String(body.note || '').trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Tulis alasan perubahan status ini.' });
    }
  })),
  devicesCtrl.setStatus);
router.delete('/devices/:id', requirePermission('device.manage'), devicesCtrl.remove);

// ---------- Locations (shared by devices and the directory)
const locationBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(LOCATION_KINDS).optional(),
  notes: z.string().trim().max(255).nullable().optional(),
}).strict();
// BAST (berita acara serah terima) made as a Google Doc from the built-in
// templates, with the division kop — IT and GA together (migration 115).
const docTemplatesCtrl = require('../controllers/docTemplates.controller');
const bastBody = z.object({
  kind: z.enum(['handover', 'return']),
  team: z.enum(['it', 'ga']),
  acknowledgerUserId: z.number().int().positive().nullable().optional(),
  accessories: z.string().trim().max(500).nullable().optional(),
  condition: z.string().trim().max(300).nullable().optional(),
  conditionCode: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  location: z.string().trim().max(150).nullable().optional(),
  holderName: z.string().trim().max(150).nullable().optional(),
  holderPosition: z.string().trim().max(150).nullable().optional(),
  holderDivision: z.string().trim().max(150).nullable().optional(),
}).strict();
router.get('/bast/options', requirePermission(['device.handover.manage', 'it.infra.manage', 'ga.ops.manage']), docTemplatesCtrl.bastOptions);
router.post('/assignments/:id/bast', requirePermission(['device.handover.manage', 'ga.ops.manage']), validate(bastBody), docTemplatesCtrl.deviceBast);
router.post('/infrastructure/phone-lines/:id/bast', requirePermission(['it.infra.manage', 'ga.ops.manage']), validate(bastBody), docTemplatesCtrl.phoneBast);

router.get('/locations', requirePermission(['device.view', 'people.directory.view', 'it.infra.view', 'ga.ops.view']), locationsCtrl.list);
router.post('/locations', requirePermission('device.manage'), validate(locationBody), locationsCtrl.create);
router.patch('/locations/:id',
  requirePermission('device.manage'),
  validate(locationBody.partial().extend({ isActive: z.boolean().optional() }).strict()),
  locationsCtrl.update);

// ---------- Assignments
const assignBody = z.object({
  entityId: z.number().int().positive().optional(), // ignored: the company is the signed-in user's
  departmentId: z.number().int().positive().nullable().optional(),
  deviceId: z.number().int().positive(),
  ...holderFields,
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
// IT vendors (ISP, CCTV, network …) extend the software vendors (wave 2, §4.1):
// the IT registers' managers may add and edit them too; delete is unchanged.
router.get('/vendors', requirePermission(['subscription.view', 'it.infra.view']), vendorCtrl.list);
router.post('/vendors',
  requirePermission(['software_vendor.manage', 'it.infra.manage']),
  validate(z.object({
    entityId: z.number().int().positive().optional(), // ignored: the company is the signed-in user's
    name: z.string().min(1).max(190),
    vendorKind: z.enum(VENDOR_KINDS).optional(),
    contactPerson: z.string().max(150).nullable().optional(),
    email: z.string().email().max(190).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    portalUrl: httpsUrl({ max: 500 }).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  guardSecretBody(),
  vendorCtrl.create);
router.patch('/vendors/:id',
  requirePermission(['software_vendor.manage', 'it.infra.manage']),
  validate(z.object({
    name: z.string().min(1).max(190).optional(),
    vendorKind: z.enum(VENDOR_KINDS).optional(),
    contactPerson: z.string().max(150).nullable().optional(),
    email: z.string().email().max(190).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    portalUrl: httpsUrl({ max: 500 }).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  guardSecretBody(),
  vendorCtrl.update);
router.delete('/vendors/:id', requirePermission('software_vendor.manage'), vendorCtrl.remove);

// ---------- Subscriptions
const subsBody = z.object({
  entityId: z.number().int().positive().optional(), // ignored: the company is the signed-in user's
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
  // No licenseKey: the API neither accepts nor returns licence keys (wave 2, §4.1).
  validate(z.object({
    seatLabel: z.string().max(150).nullable().optional(),
  }).strict()),
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
