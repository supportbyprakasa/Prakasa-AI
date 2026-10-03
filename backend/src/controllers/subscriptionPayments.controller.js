const { ok, fail } = require('../utils/response');
const billing = require('../services/subscriptionBilling.service');

// "Catat pembayaran": a register entry of a payment made outside the app
// (subscriptionBilling.service). It never sends money or touches Accurate.
async function create(req, res, next) {
  try {
    const result = await billing.recordPayment({
      entityId: req.user.entityId,
      subscriptionId: Number(req.params.id),
      actorId: req.user.sub,
      body: req.body,
    });
    return ok(res, result, undefined, result.duplicate ? 200 : 201);
  } catch (e) {
    if (e.status) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

module.exports = { create };
