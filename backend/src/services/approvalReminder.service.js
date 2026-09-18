const pool = require('../db/pool');
const notif = require('./notification.service');
const integrationLog = require('./integrationLog.service');
const logger = require('../utils/logger');

async function roleUsers(entityId, roleId) {
  if (!roleId) return [];
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id
      WHERE ur.role_id=?
        AND u.entity_id=?
        AND r.entity_id=?
        AND u.status='active'
        AND u.deleted_at IS NULL
        AND r.deleted_at IS NULL`,
    [roleId, entityId, entityId]
  );
  return rows.map((row) => row.id);
}

async function insertReminder({
  requestId,
  stepId,
  type,
  targetUserId,
  notificationId,
  notes = null,
}) {
  const [result] = await pool.query(
    `INSERT IGNORE INTO approval_reminders
     (approval_request_id, approval_step_id, reminder_type,
      target_user_id, notification_id, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      stepId,
      type,
      targetUserId,
      notificationId || null,
      notes,
    ]
  );
  return result.affectedRows > 0;
}

async function runOnce() {
  const totals = {
    remindersSent: 0,
    escalations: 0,
    errors: [],
  };
  const perEntity = new Map();

  function entityStats(entityId) {
    if (!perEntity.has(entityId)) {
      perEntity.set(entityId, {
        remindersSent: 0,
        escalations: 0,
        errors: 0,
      });
    }
    return perEntity.get(entityId);
  }

  try {
    const [candidates] = await pool.query(
      `SELECT s.id AS stepId,
              s.approval_request_id AS requestId,
              s.approver_user_id AS approverUserId,
              s.approver_role_id AS approverRoleId,
              s.activated_at AS activatedAt,
              s.escalated_at AS escalatedAt,
              ar.entity_id AS entityId,
              ar.title,
              am.id AS matrixRuleId,
              am.reminder_after_hours AS reminderAfterHours,
              am.escalate_after_hours AS escalateAfterHours,
              am.escalation_user_id AS escalationUserId,
              am.escalation_role_id AS escalationRoleId
         FROM approval_steps s
         JOIN approval_requests ar ON ar.id=s.approval_request_id
         LEFT JOIN approval_matrix am ON am.id=s.matrix_rule_id
        WHERE s.status='pending'
          AND ar.status='pending'
          AND s.activated_at IS NOT NULL
          AND am.id IS NOT NULL
          AND am.is_active=1
          AND am.deleted_at IS NULL
        ORDER BY s.id ASC
        LIMIT 500`
    );

    const now = Date.now();

    for (const candidate of candidates) {
      const stats = entityStats(candidate.entityId);
      try {
        const activatedAt = new Date(candidate.activatedAt).getTime();
        const ageHours = Math.max(0, (now - activatedAt) / 3600000);

        if (
          candidate.reminderAfterHours !== null &&
          ageHours >= Number(candidate.reminderAfterHours)
        ) {
          const targets = new Set();
          if (candidate.approverUserId) targets.add(candidate.approverUserId);
          for (const userId of await roleUsers(
            candidate.entityId,
            candidate.approverRoleId
          )) {
            targets.add(userId);
          }

          for (const targetUserId of targets) {
            const [existing] = await pool.query(
              `SELECT id FROM approval_reminders
                WHERE approval_step_id=?
                  AND reminder_type='reminder'
                  AND target_user_id=?
                LIMIT 1`,
              [candidate.stepId, targetUserId]
            );
            if (existing[0]) continue;

            const notificationId = await notif.create({
              userId: targetUserId,
              entityId: candidate.entityId,
              title: 'Reminder approval',
              body:
                `Approval #${candidate.requestId} menunggu keputusan Anda: ` +
                candidate.title,
              event: 'approval.reminder',
              subjectType: 'approval_request',
              subjectId: candidate.requestId,
              actionUrl: `/approvals/${candidate.requestId}`,
            });

            if (await insertReminder({
              requestId: candidate.requestId,
              stepId: candidate.stepId,
              type: 'reminder',
              targetUserId,
              notificationId,
            })) {
              totals.remindersSent += 1;
              stats.remindersSent += 1;
            }
          }
        }

        if (
          !candidate.escalatedAt &&
          candidate.escalateAfterHours !== null &&
          ageHours >= Number(candidate.escalateAfterHours)
        ) {
          const escalationTargets = new Set();
          if (candidate.escalationUserId) {
            escalationTargets.add(candidate.escalationUserId);
          }
          for (const userId of await roleUsers(
            candidate.entityId,
            candidate.escalationRoleId
          )) {
            escalationTargets.add(userId);
          }

          if (escalationTargets.size) {
            let firstTarget = null;
            for (const targetUserId of escalationTargets) {
              if (!firstTarget) firstTarget = targetUserId;

              const [existing] = await pool.query(
                `SELECT id FROM approval_reminders
                  WHERE approval_step_id=?
                    AND reminder_type='escalation'
                    AND target_user_id=?
                  LIMIT 1`,
                [candidate.stepId, targetUserId]
              );
              if (existing[0]) continue;

              const notificationId = await notif.create({
                userId: targetUserId,
                entityId: candidate.entityId,
                title: 'Eskalasi approval',
                body:
                  `Approval #${candidate.requestId} overdue: ` +
                  candidate.title,
                event: 'approval.escalated',
                subjectType: 'approval_request',
                subjectId: candidate.requestId,
                actionUrl: `/approvals/${candidate.requestId}`,
              });

              if (await insertReminder({
                requestId: candidate.requestId,
                stepId: candidate.stepId,
                type: 'escalation',
                targetUserId,
                notificationId,
              })) {
                totals.escalations += 1;
                stats.escalations += 1;
              }
            }

            await pool.query(
              `UPDATE approval_steps
                  SET escalated_at=NOW(),
                      escalated_to_user_id=?,
                      escalated_to_role_id=?
                WHERE id=? AND escalated_at IS NULL`,
              [
                candidate.escalationUserId || firstTarget,
                candidate.escalationRoleId || null,
                candidate.stepId,
              ]
            );
          }
        }
      } catch (error) {
        totals.errors.push({
          stepId: candidate.stepId,
          error: error.message,
        });
        stats.errors += 1;
        logger.error(
          { err: error.message, stepId: candidate.stepId },
          '[approvalReminder] candidate failed'
        );
      }
    }

    for (const [entityId, stats] of perEntity.entries()) {
      await integrationLog.log({
        entityId,
        provider: 'internal',
        operation: 'approvalReminder.runOnce',
        status: stats.errors ? 'failed' : 'success',
        responseMeta: stats,
      });
    }

    return totals;
  } catch (error) {
    logger.error({ err: error.message }, '[approvalReminder] fatal');
    await integrationLog.log({
      provider: 'internal',
      operation: 'approvalReminder.runOnce',
      status: 'failed',
      errorMessage: error.message,
    });
    throw error;
  }
}

module.exports = { runOnce };
