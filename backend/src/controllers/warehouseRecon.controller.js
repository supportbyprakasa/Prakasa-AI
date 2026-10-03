const { ok, fail } = require('../utils/response');
const recon = require('../services/warehouseRecon.service');
const { paging } = require('../services/salesQuery');

// Pencocokan Barang Masuk/Keluar ↔ dokumen Accurate (program 3.2). Reading needs
// warehouse.recon.view; pairing and explaining need warehouse.recon.resolve
// (checked on the route) plus segregation of duties (checked in the service).
// The company always comes from the signed-in user, never from the request.

const handle = (next, res) => (e) => {
  if (e.status && e.code) return fail(res, e.code, e.message, e.status);
  return next(e);
};

async function list(req, res, next) {
  try {
    const { page, limit } = paging(req.query, { defaultLimit: 25, maxLimit: 100 });
    const r = await recon.list(req.user.entityId, {
      status: req.query.status, direction: req.query.direction, from: req.query.from, to: req.query.to, q: req.query.q, page, limit,
    });
    return ok(res, r.items, { page, limit, total: r.total, counts: r.counts, readiness: r.readiness });
  } catch (e) { return handle(next, res)(e); }
}

async function detail(req, res, next) {
  try {
    return ok(res, await recon.detail(req.user, req.params.direction, req.params.groupKey));
  } catch (e) { return handle(next, res)(e); }
}

async function forMovement(req, res, next) {
  try {
    return ok(res, await recon.forMovement(req.user.entityId, req.params.type, Number(req.params.id)));
  } catch (e) { return handle(next, res)(e); }
}

async function candidates(req, res, next) {
  try {
    return ok(res, await recon.candidates(req.user, req.params.direction, req.params.groupKey, req.query.q));
  } catch (e) { return handle(next, res)(e); }
}

async function link(req, res, next) {
  try {
    return ok(res, await recon.link(req.user, req.body), null, 201);
  } catch (e) { return handle(next, res)(e); }
}

async function unlink(req, res, next) {
  try {
    return ok(res, await recon.unlink(req.user, Number(req.params.id), req.body.reason));
  } catch (e) { return handle(next, res)(e); }
}

async function explain(req, res, next) {
  try {
    return ok(res, await recon.explain(req.user, req.body), null, 201);
  } catch (e) { return handle(next, res)(e); }
}

async function unexplain(req, res, next) {
  try {
    return ok(res, await recon.unexplain(req.user, Number(req.params.id), req.body.reason));
  } catch (e) { return handle(next, res)(e); }
}

module.exports = {
  list, detail, forMovement, candidates, link, unlink, explain, unexplain,
};
