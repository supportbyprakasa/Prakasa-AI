const { ok, fail } = require('../utils/response');
const svc = require('../services/financeRequests.service');
const { ApproverError } = require('../services/approverResolver.service');

// Finance — pengajuan pembayaran & reimbursement. Thin: the service decides who
// may do what (services/financeRequests.service.js); the entity and the
// division are always the signed-in account's.

function handle(res, next, error) {
  if (error instanceof svc.FinanceError || error instanceof ApproverError || (error?.status && error?.code)) {
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

const id = (req) => Number(req.params.id);

module.exports = {
  list: route((req) => svc.list(req.user, req.query || {})),
  detail: route((req) => svc.get(req.user, id(req))),
  create: route((req) => svc.create(req.user, req.body), 201),
  update: route((req) => svc.update(req.user, id(req), req.body)),
  remove: route((req) => svc.remove(req.user, id(req))),
  uploadAttachment: route((req) => svc.addAttachment(req.user, id(req), { ...req.body, file: req.file || null }), 201),
  runDocumentCheck: route((req) => svc.runDocumentCheck(req.user, id(req))),
  submitForApproval: route((req) => svc.submit(req.user, id(req))),
  applyApprovalResult: route((req) => svc.applyDecidedApproval(req.user, id(req))),
  updateProcessing: route((req) => (req.body.status === 'cancelled'
    ? svc.cancel(req.user, id(req), { reason: req.body.note })
    : svc.processPayment(req.user, id(req), req.body))),
  cancel: route((req) => svc.cancel(req.user, id(req), req.body)),
};
