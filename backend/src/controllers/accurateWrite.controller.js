const { ok, fail } = require('../utils/response');
const service = require('../services/accurateWriteRequests.service');

// Pengajuan ke Accurate: proposals of master data (customers, vendors) that
// the division's Supervisor or Head decides; deciding itself stays on
// POST /approvals/:id/decide. Nothing here talks to Accurate.

const handle = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
};

const list = handle(async (req, res) => {
  const { items, ...meta } = await service.listRequests(req.user, req.query);
  return ok(res, items, meta);
});
const detail = handle(async (req, res) => ok(res, await service.getRequest(req.user, req.params.id)));
const create = handle(async (req, res) => {
  const result = await service.createRequest(req.user, req.body);
  return res.status(result.repeated ? 200 : 201).json({ success: true, data: result });
});
const cancel = handle(async (req, res) => ok(res, await service.cancelRequest(req.user, req.params.id, req.body.note)));
const reconciliation = handle(async (req, res) => {
  const { items, ...meta } = await service.reconcileCustomers(req.user, req.query);
  return ok(res, items, meta);
});

module.exports = { list, detail, create, cancel, reconciliation };
