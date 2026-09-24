const pool = require('../db/pool');
const notif = require('./notification.service');

// Users who should hear about newly active approval steps. When the request belongs to a
// department-scoped subject, role recipients are also limited to that department.
async function targetUsersForSteps(stepIds, entityId, { departmentId = null } = {}) {
  if (!stepIds?.length) return [];

  const [steps] = await pool.query(
    `SELECT approver_user_id AS approverUserId,
            approver_role_id AS approverRoleId,
            escalated_to_user_id AS escalatedToUserId,
            escalated_to_role_id AS escalatedToRoleId
       FROM approval_steps
      WHERE id IN (?)`,
    [stepIds]
  );

  const targets = new Set();
  const roleIds = new Set();

  for (const step of steps) {
    if (step.escalatedToUserId) targets.add(Number(step.escalatedToUserId));
    else if (step.approverUserId) targets.add(Number(step.approverUserId));

    if (step.escalatedToRoleId) roleIds.add(Number(step.escalatedToRoleId));
    else if (step.approverRoleId) roleIds.add(Number(step.approverRoleId));
  }

  if (roleIds.size) {
    const args = [[...roleIds], entityId, entityId];
    let departmentFilter = '';
    if (departmentId) {
      departmentFilter = 'AND u.department_id=?';
      args.push(departmentId);
    }
    const [users] = await pool.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id
        WHERE ur.role_id IN (?)
          AND u.entity_id=?
          AND r.entity_id=?
          AND u.status='active'
          AND u.deleted_at IS NULL
          AND r.deleted_at IS NULL
          ${departmentFilter}`,
      args
    );
    for (const user of users) targets.add(Number(user.id));
  }

  return [...targets];
}

async function notifySteps(stepIds, request, { departmentId = null, excludeUserIds = [] } = {}) {
  const excluded = new Set(excludeUserIds.map(Number));
  const users = await targetUsersForSteps(stepIds, request.entity_id, { departmentId });
  for (const userId of users) {
    if (excluded.has(userId)) continue;
    try {
      await notif.create({
        userId,
        entityId: request.entity_id,
        title: 'Approval menunggu keputusan Anda',
        body: request.title,
        event: 'approval.step_activated',
        subjectType: 'approval_request',
        subjectId: request.id,
        actionUrl: `/approvals/${request.id}`,
      });
    } catch {
      // Notification failure must not revert the committed approval state.
    }
  }
}

module.exports = { targetUsersForSteps, notifySteps };
