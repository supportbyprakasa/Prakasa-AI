const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/marketing.controller');
const { cachedResponse } = require('../middleware/cachedResponse');
const { CUSTOMER_CHANNELS } = require('../services/salesNumbers');
const { OBJECTIVES, STATUSES, MAX_ITEMS } = require('../services/marketingCampaigns.service');

// Marketing (migration 119), mounted at /marketing:
//   Produk & channel  aggregates over the approved Accurate mirror + leads
//   Kampanye          the campaign tracker (no delete: 'dibatalkan' ends one)
// Every body is strict: an entity, a division or a version smuggled into a
// create is refused (400). The services enforce the campaign rules.

router.use(requireAuth);

const VIEW = 'marketing.insight.view';
const MANAGE = 'marketing.campaign.manage';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal berbentuk TTTT-BB-HH');
const channels = z.union([
  z.literal('all'),
  z.array(z.enum(CUSTOMER_CHANNELS)).min(1, 'Pilih minimal satu channel').max(CUSTOMER_CHANNELS.length),
]);
const itemNo = z.string().trim().min(1).max(120);
const fields = {
  name: z.string().trim().min(1, 'Isi nama kampanye').max(150),
  channels,
  objective: z.enum(OBJECTIVES),
  startOn: isoDay,
  endOn: isoDay,
  budget: z.number().min(0).max(1e13).nullable(),
  status: z.enum(STATUSES),
  notes: z.string().trim().max(1000).nullable(),
  items: z.array(itemNo).max(MAX_ITEMS, `Paling banyak ${MAX_ITEMS} produk`),
};
const REQUIRED = ['name', 'channels', 'objective', 'startOn', 'endOn'];
const campaignCreate = z.object(Object.fromEntries(Object.entries(fields)
  .map(([k, v]) => [k, REQUIRED.includes(k) ? v : v.optional()])))
  .strict()
  .refine((b) => b.endOn >= b.startOn, { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai', path: ['endOn'] })
  .refine((b) => b.status === undefined || ['draft', 'berjalan'].includes(b.status), { message: 'Kampanye baru berstatus Draf atau Berjalan', path: ['status'] });
const campaignUpdate = z.object({
  version: z.number().int().positive(),
  ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
})
  .strict()
  .refine((b) => !(b.startOn && b.endOn) || b.endOn >= b.startOn, { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai', path: ['endOn'] });

// Produk & channel (aggregates only; Marketing has no sales.order.view).
router.get('/insights', requirePermission(VIEW), cachedResponse('marketing:', 60 * 1000), ctrl.insights);
router.get('/web-sessions', requirePermission(VIEW), ctrl.webSessions);
// The campaign form's product picker: top 20 Accurate items.
router.get('/items', requirePermission([VIEW, MANAGE]), ctrl.items);

// Kampanye.
router.get('/campaigns', requirePermission(VIEW), ctrl.listCampaigns);
// Performance carries rupiah, so the detail needs the insight permission too.
router.get('/campaigns/:id', requirePermission(VIEW), ctrl.getCampaign);
router.post('/campaigns', requirePermission(MANAGE), validate(campaignCreate), ctrl.createCampaign);
router.patch('/campaigns/:id', requirePermission(MANAGE), validate(campaignUpdate), ctrl.updateCampaign);

module.exports = router;
module.exports.schemas = { campaignCreate, campaignUpdate };
