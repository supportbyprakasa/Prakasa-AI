const router = require('express').Router();
const multer = require('multer');
const { uploadLimiter } = require('../middleware/rateLimits');
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/ga.controller');
const opsCtrl = require('../controllers/gaOps.controller');
const { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ITEMS } = require('../services/gaRules');

// Layanan GA (People & Culture wave 2, row 2.2; docs/rancangan-people-culture-g2.md §3.3).
// Every body is strict: an entity, a requester or a status set by hand is
// refused (400). The services enforce who may act on which record.

router.use(requireAuth);

const CREATE = 'ga.request.create';
const PROCESS = 'ga.request.process';
const MANAGE = 'ga.resource.manage';
const OPS_VIEW = 'ga.ops.view';
const OPS_MANAGE = 'ga.ops.manage';

const id = z.number().int().positive();
const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const isoTime = z.string().datetime({ offset: true, message: 'Waktu harus ISO-8601 dengan zona (mis. 2026-10-01T09:00:00+07:00)' });

const itemSchema = z.object({
  itemName: text(120),
  qty: z.number().positive().max(99999999),
  unit: text(20),
}).strict();

const requestBody = z.discriminatedUnion('requestType', [
  z.object({
    requestType: z.literal('atk'),
    locationId: id,
    items: z.array(itemSchema).min(1).max(MAX_ITEMS),
    note: optionalText(2000),
  }).strict(),
  z.object({
    requestType: z.literal('facility_repair'),
    locationId: id,
    area: text(120),
    description: text(2000),
    urgent: z.boolean().optional(),
  }).strict(),
  z.object({
    requestType: z.literal('other'),
    locationId: id,
    title: text(190),
    description: text(2000),
  }).strict(),
]);

const cancelBody = z.object({ reason: text(255), version: z.number().int().positive() }).strict();
const statusBody = z.object({
  status: z.enum(['in_progress', 'done', 'rejected']),
  note: z.string().trim().max(500).nullable().optional(),
  version: z.number().int().positive(),
}).strict();
const assignBody = z.object({ userId: id }).strict();

const resourceCreate = z.object({
  kind: z.enum(['room', 'vehicle']),
  name: text(120),
  locationId: id,
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
  plateNumber: optionalText(20),
  notes: optionalText(255),
}).strict();
const resourceUpdate = z.object({
  name: text(120).optional(),
  locationId: id.optional(),
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
  plateNumber: optionalText(20),
  notes: optionalText(255),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
}).strict();

const bookingBody = z.object({
  resourceId: id,
  startsAt: isoTime,
  endsAt: isoTime,
  purpose: text(255),
  destination: optionalText(190),
  needsDriver: z.boolean().optional(),
  driverPersonId: id.nullable().optional(),
}).strict();
const bookingCancel = z.object({ reason: text(255) }).strict();
const returnBody = z.object({ note: optionalText(255) }).strict();

// Photos or a PDF of a repair, ≤ 10 MB, kept in the Shared Drive.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ATTACHMENT_TYPES.includes(file.mimetype) || !/\.(png|jpe?g|webp|pdf)$/i.test(file.originalname)) {
      const error = new Error('Lampiran hanya foto (PNG, JPG, WebP) atau PDF');
      error.status = 400;
      error.code = 'FILE_TYPE_NOT_ALLOWED';
      return cb(error);
    }
    return cb(null, true);
  },
});

// Requests. `scope=all` needs ga.request.process (checked by the service).
router.get('/processors', requirePermission(PROCESS), ctrl.processors);
router.get('/requests', requirePermission(CREATE), ctrl.listRequests);
router.post('/requests', requirePermission(CREATE), validate(requestBody), ctrl.createRequest);
router.get('/requests/:id', requirePermission([CREATE, PROCESS, 'management_dashboard.view', 'management_dashboard.division', 'approval.decide']), ctrl.getRequest);
router.post('/requests/:id/cancel', requirePermission(CREATE), validate(cancelBody), ctrl.cancelRequest);
router.post('/requests/:id/status', requirePermission(PROCESS), validate(statusBody), ctrl.setRequestStatus);
router.post('/requests/:id/assign', requirePermission(PROCESS), validate(assignBody), ctrl.assignRequest);
router.post('/requests/:id/attachments', requirePermission([CREATE, PROCESS]), uploadLimiter, attachmentUpload.single('file'), ctrl.addAttachment);

// Rooms and vehicles.
router.get('/resources', requirePermission(CREATE), ctrl.listResources);
router.post('/resources', requirePermission(MANAGE), validate(resourceCreate), ctrl.createResource);
router.patch('/resources/:id', requirePermission(MANAGE), validate(resourceUpdate), ctrl.updateResource);

// Bookings (others' bookings are masked for non-processors).
router.get('/bookings', requirePermission(CREATE), ctrl.listBookings);
router.post('/bookings', requirePermission(CREATE), validate(bookingBody), ctrl.createBooking);
router.get('/bookings/:id', requirePermission([CREATE, PROCESS, 'management_dashboard.view', 'management_dashboard.division', 'approval.decide']), ctrl.getBooking);
router.post('/bookings/:id/cancel', requirePermission([CREATE, PROCESS]), validate(bookingCancel), ctrl.cancelBooking);
router.post('/bookings/:id/checkout', requirePermission(PROCESS), validate(z.object({}).strict()), ctrl.checkout);
router.post('/bookings/:id/return', requirePermission(PROCESS), validate(returnBody), ctrl.returnVehicle);

// Operasional GA (migration 114): upkeep schedules, contracts and utility
// bills. People & Culture sees them; Supervisor/Head change them; GA staff
// (ga.request.process) record upkeep done.
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal berbentuk TTTT-BB-HH');
const optionalDay = isoDay.nullable().optional();
const optionalMoney = z.number().min(0).max(1e13).nullable().optional();
const version = z.number().int().positive();
const maintenanceFields = {
  locationId: id,
  category: z.enum(['ac', 'apar', 'genset', 'lift', 'pest_control', 'water', 'electrical', 'building', 'other']),
  name: text(150),
  vendorName: optionalText(150),
  intervalDays: z.number().int().min(1).max(1830),
  lastDoneOn: optionalDay,
  nextDueOn: optionalDay,
  status: z.enum(['active', 'retired']),
  notes: optionalText(500),
};
const contractFields = {
  locationId: id.nullable(),
  kind: z.enum(['building_lease', 'cleaning', 'security', 'pest_control', 'waste', 'maintenance', 'other']),
  vendorName: text(150),
  description: optionalText(190),
  startOn: optionalDay,
  endOn: optionalDay,
  noticeDays: z.number().int().min(0).max(365),
  monthlyCost: optionalMoney,
  status: z.enum(['active', 'ended']),
  notes: optionalText(500),
};
const billFields = {
  locationId: id,
  utility: z.enum(['electricity', 'water', 'gas', 'other']),
  customerNumber: optionalText(60),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periode berbentuk TTTT-BB'),
  amount: z.number().min(0).max(1e13),
  usageAmount: optionalMoney,
  dueOn: optionalDay,
  paidOn: optionalDay,
  notes: optionalText(500),
};
const createOf = (fields, required) => z.object(Object.fromEntries(Object.entries(fields)
  .map(([k, v]) => [k, required.includes(k) ? v : v.optional()]))).strict();
const updateOf = (fields) => z.object({ version, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) }).strict();
const opsSchemas = {
  maintenance: { create: createOf(maintenanceFields, ['locationId', 'category', 'name', 'intervalDays']), update: updateOf(maintenanceFields) },
  contracts: { create: createOf(contractFields, ['kind', 'vendorName']), update: updateOf(contractFields) },
  bills: { create: createOf(billFields, ['locationId', 'utility', 'period', 'amount']), update: updateOf(billFields) },
};
const maintenanceLogBody = z.object({
  doneOn: isoDay,
  result: z.enum(['ok', 'follow_up']).optional(),
  cost: optionalMoney,
  note: optionalText(500),
}).strict();

router.get('/ops/summary', requirePermission(OPS_VIEW), opsCtrl.summary);
for (const key of Object.keys(opsSchemas)) {
  router.get(`/ops/${key}`, requirePermission(OPS_VIEW), opsCtrl.list(key));
  router.post(`/ops/${key}`, requirePermission(OPS_MANAGE), validate(opsSchemas[key].create), opsCtrl.create(key));
  router.patch(`/ops/${key}/:id`, requirePermission(OPS_MANAGE), validate(opsSchemas[key].update), opsCtrl.update(key));
}
router.get('/ops/maintenance/:id/logs', requirePermission(OPS_VIEW), opsCtrl.maintenanceLogs);
router.post('/ops/maintenance/:id/logs', requirePermission(OPS_VIEW), requirePermission([OPS_MANAGE, PROCESS]), validate(maintenanceLogBody), opsCtrl.addMaintenanceLog);

module.exports = router;
module.exports.schemas = {
  opsSchemas, maintenanceLogBody,
  requestBody, cancelBody, statusBody, assignBody, resourceCreate, resourceUpdate, bookingBody, bookingCancel, returnBody,
};
