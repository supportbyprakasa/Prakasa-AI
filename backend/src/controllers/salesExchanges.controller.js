const { ok, fail } = require('../utils/response');
const exchanges = require('../services/salesExchanges.service');
const { numbersFromAccurate } = require('../services/salesSource');
const { paging, positiveId } = require('../services/salesQuery');

// Tukar faktur (program 2.3): Sales records the hand-over of Accurate invoices.
const handle = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
};

const list = handle(async (req, res) => {
  if (!(await numbersFromAccurate(req.user.entityId))) return ok(res, [], { page: 1, limit: 25, total: 0, counts: { pending: 0, done: 0 }, source: 'recap' });
  const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
  const status = exchanges.STATUSES.includes(req.query.status) ? req.query.status : 'pending';
  const result = await exchanges.list(req.user, { status, q: String(req.query.q || '').trim().slice(0, 100), page, limit });
  return ok(res, result.items, { page, limit, total: result.total, counts: result.counts });
});

const record = handle(async (req, res) => res.status(201).json({ success: true, data: await exchanges.record(req.user, req.body) }));

const update = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'NOT_FOUND', 'Catatan tukar faktur tidak ditemukan', 404);
  return ok(res, await exchanges.update(req.user, id, req.body));
});

const cancel = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'NOT_FOUND', 'Catatan tukar faktur tidak ditemukan', 404);
  return ok(res, await exchanges.cancel(req.user, id));
});

module.exports = { list, record, update, cancel };
