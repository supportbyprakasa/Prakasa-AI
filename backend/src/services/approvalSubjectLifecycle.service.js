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

module.exports = {
  register,
  isManagedSubject,
  assertCanDecide,
  canUserDecide,
  applyDecision,
  afterCommit,
};
