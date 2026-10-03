const { ok, fail } = require('../utils/response');
const requests = require('../services/gaRequests.service');
const bookings = require('../services/gaBookings.service');
const { GaError } = require('../services/gaShared.service');
const { ApproverError } = require('../services/approverResolver.service');

// Layanan GA (People & Culture wave 2, row 2.2). Thin: the services decide who
// may do what; the entity is always the signed-in account's.

function handle(res, next, error) {
  if (error instanceof GaError || error instanceof ApproverError || (error?.status && error?.code)) {
    return fail(res, error.code, error.message, error.status, error.details);
  }
  return next(error);
}

const route = (fn, status = 200) => async (req, res, next) => {
  try {
    const out = await fn(req);
    if (out && out.rows && out.meta) return ok(res, out.rows, out.meta);
    return ok(res, out, undefined, status);
  } catch (error) { return handle(res, next, error); }
};

module.exports = {
  processors: route((req) => requests.processors(req.user)),
  listRequests: route((req) => requests.list(req.user, req.query || {})),
  createRequest: route((req) => requests.create(req.user, req.body), 201),
  getRequest: route((req) => requests.get(req.user, Number(req.params.id))),
  cancelRequest: route((req) => requests.cancel(req.user, Number(req.params.id), req.body)),
  setRequestStatus: route((req) => requests.setStatus(req.user, Number(req.params.id), req.body)),
  assignRequest: route((req) => requests.assign(req.user, Number(req.params.id), req.body)),
  addAttachment: route((req) => requests.addAttachment(req.user, Number(req.params.id), req.file), 201),

  listResources: route((req) => bookings.listResources(req.user, req.query || {})),
  createResource: route((req) => bookings.createResource(req.user, req.body), 201),
  updateResource: route((req) => bookings.updateResource(req.user, Number(req.params.id), req.body)),

  listBookings: route((req) => bookings.listBookings(req.user, req.query || {})),
  createBooking: route((req) => bookings.createBooking(req.user, req.body), 201),
  getBooking: route((req) => bookings.getBooking(req.user, Number(req.params.id))),
  cancelBooking: route((req) => bookings.cancelBooking(req.user, Number(req.params.id), req.body)),
  checkout: route((req) => bookings.checkout(req.user, Number(req.params.id))),
  returnVehicle: route((req) => bookings.returnVehicle(req.user, Number(req.params.id), req.body)),
};
