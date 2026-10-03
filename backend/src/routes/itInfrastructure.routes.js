const router = require('express').Router();
const { z } = require('zod');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { guardSecretBody } = require('../services/secretText');
const ctrl = require('../controllers/itInfrastructure.controller');
const {
  NETWORK_TYPES, NETWORK_STATUSES, ISP_STATUSES, CCTV_RECORDERS, CCTV_STATUSES, BACKUP_FREQUENCIES, BACKUP_STORAGE,
  BACKUP_STATUSES, PHONE_KINDS, PHONE_STATUSES, IMPORT_COLUMNS, IMPORT_MAX_ROWS,
} = require('../config/itInfra');

// /it/infrastructure/* (docs/rancangan-people-culture-g2.md §4.2), mounted by
// it.routes.js after requireAuth. Reads need it.infra.view (People & Culture
// member+), writes it.infra.manage (supervisor+). No DELETE route: a register
// row ends in a status; reviews and backup checks are append-only. Every
// body is strict (an unknown key — e.g. a password — is a 400), every free
// text passes the secret guard, every PATCH carries `version`.

const VIEW = requirePermission('it.infra.view');
const MANAGE = requirePermission('it.infra.manage');

const id = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD');
const text = (max) => z.string().trim().max(max);
const optText = (max) => text(max).nullable().optional();
const notes = z.string().max(500).nullable().optional();
const money = z.number().nonnegative().max(1e13).nullable().optional();
const version = z.number().int().positive();

const networkFields = {
  locationId: id,
  deviceType: z.enum(NETWORK_TYPES),
  brandModel: text(150).min(1),
  serialNumber: optText(150),
  ipAddress: optText(45),
  installedYear: z.number().int().min(1990).max(2100).nullable().optional(),
  ispLinkId: id.nullable().optional(),
  firmwareUpdatedOn: date.nullable().optional(),
  status: z.enum(NETWORK_STATUSES).optional(),
  notes,
};
const ispFields = {
  locationId: id,
  vendorId: id.nullable().optional(),
  providerName: text(120).min(1),
  customerNumber: optText(60),
  bandwidthMbps: z.number().int().min(0).max(1000000).nullable().optional(),
  publicIpDedicated: z.boolean().optional(),
  isBackup: z.boolean().optional(),
  contractStart: date.nullable().optional(),
  contractEnd: date.nullable().optional(),
  monthlyCost: money,
  status: z.enum(ISP_STATUSES).optional(),
  notes,
};
// CCTV status (and offline cameras) change only through POST …/:id/status.
const cctvFields = {
  locationId: id,
  cameraCount: z.number().int().min(0).max(2000),
  cameraModel: optText(150),
  recorderType: z.enum(CCTV_RECORDERS),
  recorderDeviceId: id.nullable().optional(),
  serialNumber: optText(150),
  remoteAccess: z.boolean().optional(),
  sameNetworkAsPc: z.boolean().nullable().optional(),
  notes,
};
const backupFields = {
  locationId: id.nullable().optional(),
  dataScope: text(190).min(1),
  method: text(120).min(1),
  frequency: z.enum(BACKUP_FREQUENCIES),
  storageLocation: z.enum(BACKUP_STORAGE),
  retention: optText(60),
  notes,
};
// A line is created Cadangan; "Ganti pemegang" makes it Aktif.
const phoneFields = {
  locationId: id,
  kind: z.enum(PHONE_KINDS),
  number: optText(30),
  extension: optText(10),
  deviceId: id.nullable().optional(),
  provider: optText(80),
  planName: optText(120),
  startedOn: date.nullable().optional(),
  monthlyCost: money,
  notes,
};

const createBody = (fields) => z.object(fields).strict();
const patchBody = (fields, extra = {}) => z.object({ ...fields, ...extra }).partial().extend({ version }).strict();

function registerRoutes(path, key, fields, { patchExtra = {} } = {}) {
  router.get(`/${path}`, VIEW, ctrl.list(key));
  router.get(`/${path}/:id`, VIEW, ctrl.detail(key));
  router.post(`/${path}`, MANAGE, validate(createBody(fields)), guardSecretBody(), ctrl.create(key));
  router.patch(`/${path}/:id`, MANAGE, validate(patchBody(fields, patchExtra)), guardSecretBody(), ctrl.update(key));
}

router.get('/summary', VIEW, ctrl.summary);
router.get('/vendors', VIEW, ctrl.vendors);

// ---------- Import from the owner's IT report (Network, ISP, CCTV only)
const cell = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]).optional();
const importRow = (kind) => z.object({
  rowNumber: z.number().int().positive(),
  ...Object.fromEntries(IMPORT_COLUMNS[kind].map((col) => [col.field, cell])),
}).strict();
const importBody = z.object({
  network: z.array(importRow('network')).max(IMPORT_MAX_ROWS).optional(),
  isp: z.array(importRow('isp')).max(IMPORT_MAX_ROWS).optional(),
  cctv: z.array(importRow('cctv')).max(IMPORT_MAX_ROWS).optional(),
  locationMap: z.record(z.string().max(200), id.nullable()),
  updates: z.array(z.string().regex(/^(network|isp|cctv):\d+$/)).max(IMPORT_MAX_ROWS * 3).optional(),
}).strict();
router.post('/import/preview', MANAGE, validate(importBody), ctrl.importPreview);
router.post('/import/apply', MANAGE, validate(importBody), ctrl.importApply);

// ---------- Registers
registerRoutes('network-devices', 'network', networkFields);
registerRoutes('isp-links', 'isp', ispFields);
registerRoutes('cctv', 'cctv', cctvFields);
registerRoutes('backups', 'backup', backupFields, { patchExtra: { status: z.enum(BACKUP_STATUSES) } });
registerRoutes('phone-lines', 'phone', phoneFields, { patchExtra: { status: z.enum(PHONE_STATUSES) } });

router.post('/cctv/:id/status',
  MANAGE,
  validate(z.object({
    status: z.enum(CCTV_STATUSES),
    camerasOffline: z.number().int().min(0).max(2000).nullable().optional(),
    note: z.string().max(255).nullable().optional(),
    version: version.optional(),
  }).strict()),
  guardSecretBody(),
  ctrl.cctvStatus);

router.get('/backups/:id/checks', VIEW, ctrl.backupChecks);
router.post('/backups/:id/checks',
  MANAGE,
  validate(z.object({
    checkedOn: date,
    result: z.enum(['ok', 'failed']),
    restoreTested: z.boolean().optional(),
    note: z.string().max(255).nullable().optional(),
  }).strict()),
  guardSecretBody(),
  ctrl.addBackupCheck);

router.get('/gws-reviews', VIEW, ctrl.gwsReviews);
router.post('/gws-reviews',
  MANAGE,
  validate(z.object({
    reviewedOn: date,
    activeUsers: z.number().int().min(0).max(65535),
    superAdmins: z.number().int().min(0).max(65535),
    mfaEnforced: z.boolean(),
    externalSharingRestricted: z.boolean(),
    sharedAccountsUsed: z.boolean(),
    exUsersActive: z.number().int().min(0).max(65535),
    notes,
  }).strict()),
  guardSecretBody(),
  ctrl.addGwsReview);

router.post('/phone-lines/:id/holder',
  MANAGE,
  validate(z.object({
    personId: id.nullable().optional(),
    // A directory entry that is an app account without its own directory row.
    userId: id.nullable().optional(),
    holderLabel: z.string().trim().min(1).max(120).nullable().optional(),
    version: version.optional(),
  }).strict().refine((b) => [b.personId, b.userId, b.holderLabel].filter(Boolean).length <= 1, { message: 'Pilih satu pemegang', path: ['holderLabel'] })),
  guardSecretBody(),
  ctrl.phoneHolder);

module.exports = router;
