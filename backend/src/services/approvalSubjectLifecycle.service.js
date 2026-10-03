// Domain hooks for approval subjects whose state is owned by another module. The approval
// controller calls these inside its decision transaction so the subject and the approval
// can never disagree, and so domain rules (e.g. separation of duties) are enforced at the
// single authoritative decision point.

const handlers = new Map();

function register(subjectTypes, handler) {
  for (const subjectType of subjectTypes) handlers.set(subjectType, handler);
}

const handlerFor = (subjectType) => handlers.get(subjectType) || null;
const isManagedSubject = (subjectType) => handlers.has(subjectType);

async function assertCanDecide({ approval, user, action, note, conn }) {
  const handler = handlerFor(approval.subject_type);
  if (handler) await handler.assertCanDecide({ approval, user, action, note, conn });
}

async function canUserDecide({ approval, user, conn }) {
  const handler = handlerFor(approval.subject_type);
  return handler ? handler.canUserDecide({ approval, user, conn }) : true;
}

async function applyDecision({ approval, result, actorUserId, note, conn }) {
  const handler = handlerFor(approval.subject_type);
  if (!handler) return null;
  const outcome = await handler.applyApprovalDecision({ approval, result, actorUserId, note, conn });
  return outcome ? { ...outcome, subjectType: approval.subject_type } : null;
}

async function afterCommit(outcome, actorUserId) {
  if (!outcome) return;
  const handler = handlerFor(outcome.subjectType);
  if (handler?.afterDecision) {
    try { await handler.afterDecision(outcome, actorUserId); } catch { /* audit failure never undoes a decision */ }
  }
}

// Warehouse movements are the first managed subject. Required lazily to avoid a load cycle.
register(['warehouse_inbound', 'warehouse_outbound'], {
  assertCanDecide: (args) => require('./warehouseMovement.service').assertCanDecide(args),
  canUserDecide: (args) => require('./warehouseMovement.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./warehouseMovement.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./warehouseMovement.service').afterDecision(outcome, actor),
});

// Accurate data for Sales waits in a batch until the division approves it; the
// decision applies it (services/salesAccurateBatches.service.js). The request
// type is registered too, so nobody can open such an approval by hand.
register(['sales_accurate_batch', 'sales_accurate_sync'], {
  assertCanDecide: (args) => require('./salesAccurateBatches.service').assertCanDecide(args),
  canUserDecide: (args) => require('./salesAccurateBatches.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./salesAccurateBatches.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./salesAccurateBatches.service').afterDecision(outcome, actor),
});

// Pengajuan ke Accurate (owner, 3 Oct 2026): a proposed customer or vendor is
// decided by the division's Supervisor or Head; approving queues it for
// Accurate, nothing is sent inside the decision. Request type registered too.
register(['accurate_write_request', 'accurate_write'], {
  assertCanDecide: (args) => require('./accurateWriteRequests.service').assertCanDecide(args),
  canUserDecide: (args) => require('./accurateWriteRequests.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./accurateWriteRequests.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./accurateWriteRequests.service').afterDecision(outcome, actor),
});

// Layanan GA (People & Culture wave 2, row 2.2): "Lainnya" requests and vehicle
// bookings are decided by the resolved approver; the requester never decides.
// Request types registered too, so nobody opens such an approval by hand.
register(['ga_request', 'ga_request_other'], {
  assertCanDecide: (args) => require('./gaRequests.service').assertCanDecide(args),
  canUserDecide: (args) => require('./gaRequests.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./gaRequests.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./gaRequests.service').afterDecision(outcome, actor),
});
// Finance payment requests & reimbursements (revived 1 Oct 2026): decided by the
// resolved approver; a decision moves the request in the same transaction.
register(['finance_workflow', 'finance_payment_request', 'finance_reimbursement'], {
  assertCanDecide: (args) => require('./financeRequests.service').assertCanDecide(args),
  canUserDecide: (args) => require('./financeRequests.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./financeRequests.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./financeRequests.service').afterDecision(outcome, actor),
});
register(['ga_booking', 'ga_vehicle_booking'], {
  assertCanDecide: (args) => require('./gaBookings.service').assertCanDecide(args),
  canUserDecide: (args) => require('./gaBookings.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./gaBookings.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./gaBookings.service').afterDecision(outcome, actor),
});

// Onboarding/offboarding (People & Culture wave 2, §2.1.3): approval creates the
// directory row and the checklist in the decision's transaction; requester,
// subject and excluded accounts never decide. The request types are registered
// too, so nobody can open such an approval by hand through /approvals.
register(['hrga_workflow', 'hrga_onboarding', 'hrga_offboarding'], {
  assertCanDecide: (args) => require('./hrgaWorkflow.service').assertCanDecide(args),
  canUserDecide: (args) => require('./hrgaWorkflow.service').canUserDecide(args),
  applyApprovalDecision: (args) => require('./hrgaWorkflow.service').applyApprovalDecision(args),
  afterDecision: (outcome, actor) => require('./hrgaWorkflow.service').afterDecision(outcome, actor),
});

module.exports = {
  register,
  isManagedSubject,
  assertCanDecide,
  canUserDecide,
  applyDecision,
  afterCommit,
};
