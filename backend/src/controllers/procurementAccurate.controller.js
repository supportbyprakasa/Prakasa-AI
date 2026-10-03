const { ok, fail } = require('../utils/response');
const orders = require('../services/procurementOrders.service');
const vendors = require('../services/procurementVendors.service');
const prices = require('../services/procurementPrices.service');
const reorder = require('../services/procurementReorder.service');
const accurateSync = require('../services/accurate/accurateSync.service');
const logger = require('../utils/logger');
const { paging, positiveId } = require('../services/salesQuery');

// Procurement from Accurate (docs/program-4-divisi.md 2.1): POs, vendors and
// incoming goods from approved data. Quantities and dates for procurement.view;
// purchase prices only with procurement.price.view (owner decision P1). The pull
// only reads Accurate and stages a batch for the Procurement Head.

const handle = (next, res) => (e) => {
  if (e.status && e.code) return fail(res, e.code, e.message, e.status);
  return next(e);
};
const canSeePrices = (req) => (req.user.permissions || []).includes('procurement.price.view');

async function status(req, res, next) {
  try {
    // The last pull's counts come from data nobody approved yet: only for whoever may pull.
    const canPull = (req.user.permissions || []).includes('procurement.accurate.sync');
    const [state, lastRun] = await Promise.all([
      orders.status(req.user.entityId),
      canPull ? accurateSync.latestRun(req.user.entityId, { scope: 'procurement' }) : null,
    ]);
    return ok(res, { ...state, prices: canSeePrices(req), lastRun });
  } catch (e) { return handle(next, res)(e); }
}

async function startSync(req, res, next) {
  try {
    const current = await accurateSync.latestRun(req.user.entityId, { scope: 'procurement' });
    if (current?.running) return fail(res, 'SYNC_RUNNING', 'Tarikan dari Accurate sedang berjalan.', 409);
    if (process.env.ACCURATE_PROCUREMENT !== '1') return fail(res, 'SCOPE_OFF', 'Tarikan Procurement belum dinyalakan.', 409);
    if (await accurateSync.everyDivisionWaiting(req.user.entityId, 'procurement')) {
      return fail(res, 'PENDING_BATCH', 'Batch sebelumnya masih menunggu keputusan Head Procurement. Tarikan berikutnya berjalan otomatis setelah batch itu diputuskan.', 409);
    }
    accurateSync.runSync({ entityId: req.user.entityId, requestedBy: req.user.sub, scope: 'procurement' })
      .catch((e) => logger.error({ err: e.code || e.message }, '[accurateSync] tarikan procurement gagal'));
    return res.status(202).json({ success: true, data: { started: true } });
  } catch (e) { return handle(next, res)(e); }
}

async function syncStatus(req, res, next) {
  try {
    return ok(res, await accurateSync.latestRun(req.user.entityId, { scope: 'procurement' }));
  } catch (e) { return handle(next, res)(e); }
}

async function today(req, res, next) {
  try {
    return ok(res, await orders.today(req.user.entityId));
  } catch (e) { return handle(next, res)(e); }
}

async function listOrders(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await orders.listOrders(req.user.entityId, {
      state: req.query.state, q: req.query.q, vendor: req.query.vendor, from: req.query.from, to: req.query.to, page, limit,
    }, { prices: canSeePrices(req) });
    return ok(res, result.items, { page, limit, total: result.total, counts: result.counts });
  } catch (e) { return handle(next, res)(e); }
}

async function getOrder(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    const order = id ? await orders.getOrder(req.user.entityId, id, { prices: canSeePrices(req) }) : null;
    if (!order) return fail(res, 'NOT_FOUND', 'PO tidak ditemukan', 404);
    return ok(res, order);
  } catch (e) { return handle(next, res)(e); }
}

async function listVendors(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await vendors.listVendors(req.user.entityId, { q: req.query.q, filter: req.query.filter, page, limit }, { prices: canSeePrices(req) });
    return ok(res, result.items, { page, limit, total: result.total });
  } catch (e) { return handle(next, res)(e); }
}

async function getVendor(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    const vendor = id ? await vendors.getVendor(req.user.entityId, id, { prices: canSeePrices(req) }) : null;
    if (!vendor) return fail(res, 'NOT_FOUND', 'Pemasok tidak ditemukan', 404);
    return ok(res, vendor);
  } catch (e) { return handle(next, res)(e); }
}

// Harga beli (program 3.1): only for procurement.price.view (route and service).
async function listPrices(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await prices.priceList(req.user.entityId, {
      q: req.query.q, vendor: req.query.vendor, trend: prices.TRENDS.includes(req.query.trend) ? req.query.trend : null, page, limit,
    }, { prices: canSeePrices(req) });
    return ok(res, result.items, { page, limit, total: result.total, counts: result.counts });
  } catch (e) { return handle(next, res)(e); }
}

async function priceHistory(req, res, next) {
  try {
    return ok(res, await prices.priceHistory(req.user.entityId, { vendor: req.query.vendor, item: req.query.item, unit: req.query.unit }, { prices: canSeePrices(req) }));
  } catch (e) { return handle(next, res)(e); }
}

// Saran pesan ulang: total stock and days of cover for the Procurement
// Supervisor/Head and the Management Office only (D2 extended); last purchase
// prices only with procurement.price.view (P1).
async function listReorder(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await reorder.listReorder(req.user.entityId, {
      urgency: reorder.URGENCIES.includes(req.query.urgency) ? req.query.urgency : null,
      q: req.query.q, vendor: req.query.vendor, noPo: req.query.noPo === '1', page, limit,
    }, { prices: canSeePrices(req) });
    return ok(res, result.items, { page, limit, total: result.total, counts: result.counts, readiness: result.readiness, rules: reorder.rulesMeta() });
  } catch (e) { return handle(next, res)(e); }
}

module.exports = { status, startSync, syncStatus, today, listOrders, getOrder, listVendors, getVendor, listPrices, priceHistory, listReorder };
