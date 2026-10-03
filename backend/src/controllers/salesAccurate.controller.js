const { ok, fail } = require('../utils/response');
const batches = require('../services/salesAccurateBatches.service');
const accurateSync = require('../services/accurate/accurateSync.service');
const quality = require('../services/accurateQuality.service');
const logger = require('../utils/logger');
const { paging, positiveId } = require('../services/salesQuery');

// Data Accurate waiting for (or decided by) the division's approval. Read-only
// here: batches are staged by the Accurate integration and decided in the
// approval engine (POST /approvals/:id/decide).

const handle = (next, res) => (e) => {
  if (e.status && e.code) return fail(res, e.code, e.message, e.status);
  return next(e);
};

async function list(req, res, next) {
  try {
    const result = await batches.listBatches(req.user, { status: req.query.status, division: req.query.division, ...paging(req.query) });
    return ok(res, result.items, { page: result.page, limit: result.limit, total: result.total });
  } catch (e) { return handle(next, res)(e); }
}

async function detail(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 'NOT_FOUND', 'Batch data Accurate tidak ditemukan', 404);
    return ok(res, await batches.getBatch(req.user, id));
  } catch (e) { return handle(next, res)(e); }
}

async function items(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 'NOT_FOUND', 'Batch data Accurate tidak ditemukan', 404);
    const result = await batches.listItems(req.user, id, {
      recordType: req.query.recordType, action: req.query.action, q: String(req.query.q || '').trim().slice(0, 100), ...paging(req.query),
    });
    return ok(res, result.items, { page: result.page, limit: result.limit, total: result.total });
  } catch (e) { return handle(next, res)(e); }
}

// "Perlu dibereskan di Accurate" (program 1.4): the division's own checks, or
// every division's for the Management Office — the same scope as the batches.
async function qualityList(req, res, next) {
  try {
    const departmentId = await batches.divisionFilter(req.user);
    return ok(res, await quality.list(req.user.entityId, { departmentId }));
  } catch (e) { return handle(next, res)(e); }
}

// Starts a pull from Accurate in the background (it can take a few minutes the
// first time); the page follows it through GET /sales/accurate/sync.
async function startSync(req, res, next) {
  try {
    const current = await accurateSync.latestRun(req.user.entityId);
    if (current?.running) return fail(res, 'SYNC_RUNNING', 'Tarikan dari Accurate sedang berjalan.', 409);
    if (await accurateSync.everyDivisionWaiting(req.user.entityId, 'sales')) {
      return fail(res, 'PENDING_BATCH', 'Batch sebelumnya masih menunggu keputusan Supervisor atau Head. Tarikan berikutnya berjalan otomatis setelah batch itu diputuskan.', 409);
    }
    accurateSync.runSync({ entityId: req.user.entityId, requestedBy: req.user.sub })
      .catch((e) => logger.error({ err: e.code || e.message }, '[accurateSync] tarikan gagal'));
    return res.status(202).json({ success: true, data: { started: true } });
  } catch (e) { return handle(next, res)(e); }
}

async function syncStatus(req, res, next) {
  try {
    return ok(res, await accurateSync.latestRun(req.user.entityId));
  } catch (e) { return handle(next, res)(e); }
}

module.exports = { list, detail, items, qualityList, startSync, syncStatus };
