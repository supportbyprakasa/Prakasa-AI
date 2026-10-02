const { ok, fail } = require('../utils/response');
const stock = require('../services/warehouseStock.service');
const documents = require('../services/warehouseDocuments.service');
const shipping = require('../services/warehouseShipping.service');
const accurateSync = require('../services/accurate/accurateSync.service');
const logger = require('../utils/logger');
const { paging, positiveId } = require('../services/salesQuery');

// Stock from Accurate for the Warehouse team (quantities only). Everything here
// reads approved Accurate data; the pull only reads Accurate and stages a batch
// that the Warehouse Supervisor or Head decides.

const handle = (next, res) => (e) => {
  if (e.status && e.code) return fail(res, e.code, e.message, e.status);
  return next(e);
};

async function status(req, res, next) {
  try {
    // The last pull's counts come from data nobody approved yet: only for whoever
    // may start a pull (Supervisor/Head), never for every stock viewer.
    const canPull = (req.user.permissions || []).includes('warehouse.accurate.sync');
    const [state, warehouses, lastRun] = await Promise.all([
      stock.status(req.user.entityId),
      stock.warehouses(req.user.entityId),
      canPull ? accurateSync.latestRun(req.user.entityId, { scope: 'warehouse' }) : null,
    ]);
    return ok(res, { ...state, warehouses, lastRun });
  } catch (e) { return handle(next, res)(e); }
}

async function listStock(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const warehouseId = req.query.warehouseId ? positiveId(req.query.warehouseId) : null;
    const result = await stock.listStock(req.user.entityId, {
      q: req.query.q, status: req.query.status, warehouseId, page, limit,
    });
    return ok(res, result.items, { page, limit, total: result.total, counts: result.counts });
  } catch (e) { return handle(next, res)(e); }
}

async function stockItem(req, res, next) {
  try {
    const itemId = positiveId(req.params.itemId);
    const item = itemId ? await stock.stockItem(req.user.entityId, itemId) : null;
    if (!item) return fail(res, 'NOT_FOUND', 'Barang tidak ditemukan', 404);
    return ok(res, item);
  } catch (e) { return handle(next, res)(e); }
}

// Starts a Warehouse pull in the background; the page follows it via GET.
async function startSync(req, res, next) {
  try {
    const current = await accurateSync.latestRun(req.user.entityId, { scope: 'warehouse' });
    if (current?.running) return fail(res, 'SYNC_RUNNING', 'Tarikan dari Accurate sedang berjalan.', 409);
    if (await accurateSync.everyDivisionWaiting(req.user.entityId, 'warehouse')) {
      return fail(res, 'PENDING_BATCH', 'Batch sebelumnya masih menunggu keputusan Supervisor atau Head. Tarikan berikutnya berjalan otomatis setelah batch itu diputuskan.', 409);
    }
    accurateSync.runSync({ entityId: req.user.entityId, requestedBy: req.user.sub, scope: 'warehouse' })
      .catch((e) => logger.error({ err: e.code || e.message }, '[accurateSync] tarikan gudang gagal'));
    return res.status(202).json({ success: true, data: { started: true } });
  } catch (e) { return handle(next, res)(e); }
}

async function syncStatus(req, res, next) {
  try {
    return ok(res, await accurateSync.latestRun(req.user.entityId, { scope: 'warehouse' }));
  } catch (e) { return handle(next, res)(e); }
}

async function today(req, res, next) {
  try {
    return ok(res, await documents.today(req.user.entityId));
  } catch (e) { return handle(next, res)(e); }
}

async function listDocuments(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await documents.listDocuments(req.user.entityId, {
      type: req.query.type, q: req.query.q, from: req.query.from, to: req.query.to, warehouse: req.query.warehouse, status: req.query.status, page, limit,
    });
    return ok(res, result.items, { page, limit, total: result.total, counts: result.counts });
  } catch (e) { return handle(next, res)(e); }
}

async function getDocument(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    const doc = id ? await documents.getDocument(req.user.entityId, req.params.type, id) : null;
    if (!doc) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    return ok(res, doc);
  } catch (e) { return handle(next, res)(e); }
}

// "Jadwal kirim" (program 2.2): open SOs with the stock allocated by ship date.
async function listShipping(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const result = await shipping.schedule(req.user.entityId, { q: req.query.q, status: req.query.status, from: req.query.from, to: req.query.to });
    const items = result.items.slice((page - 1) * limit, page * limit);
    return ok(res, items, { page, limit, total: result.items.length, counts: result.counts, otifFrom: result.otifFrom });
  } catch (e) { return handle(next, res)(e); }
}

async function getShipping(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    const so = id ? await shipping.order(req.user.entityId, id) : null;
    if (!so) return fail(res, 'NOT_FOUND', 'SO tidak ditemukan', 404);
    return ok(res, so);
  } catch (e) { return handle(next, res)(e); }
}

module.exports = { status, listStock, stockItem, startSync, syncStatus, today, listDocuments, getDocument, listShipping, getShipping };
