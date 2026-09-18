const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

/**
 * Dashboard manajemen advanced: KPI lintas modul.
 */
async function summary(req, res, next) {
  try {
    const entityId = req.query.entityId ? Number(req.query.entityId) : req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);

    const [[tasks]] = await pool.query(
      `SELECT
        SUM(status NOT IN ('done','closed','cancelled')) AS active,
        SUM(due_date < CURDATE() AND status NOT IN ('done','closed','cancelled')) AS overdue
       FROM tasks WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );
    const [[approvals]] = await pool.query(
      `SELECT SUM(status='pending') AS pending,
              SUM(DATEDIFF(NOW(), created_at) > 3 AND status='pending') AS aged
         FROM approval_requests WHERE entity_id=?`, [entityId]
    );
    const [[sales]] = await pool.query(
      `SELECT
        SUM(stage NOT IN ('won','lost')) AS active,
        SUM(stage='won' AND MONTH(closed_at)=MONTH(CURDATE()) AND YEAR(closed_at)=YEAR(CURDATE())) AS wonThisMonth,
        SUM(estimated_value) AS totalPipelineValue
       FROM sales_pipeline WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );
    const [[finance]] = await pool.query(
      `SELECT
        SUM(status='pending_approval') AS pending,
        SUM(status='approved') AS approved,
        SUM(status='paid' AND MONTH(paid_at)=MONTH(CURDATE())) AS paidThisMonth,
        SUM(total_amount) AS totalPendingAmount
       FROM finance_workflows WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );
    const [[hrga]] = await pool.query(
      `SELECT
        SUM(workflow_type='onboarding' AND status IN ('approved','in_progress')) AS onboardingActive,
        SUM(workflow_type='offboarding' AND status IN ('approved','in_progress')) AS offboardingActive
       FROM hrga_workflows WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );
    const [[it]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM devices WHERE entity_id=? AND deleted_at IS NULL
          AND status IN ('repair','maintenance')) AS devicesInService,
        (SELECT COUNT(*) FROM software_subscriptions WHERE entity_id=? AND deleted_at IS NULL
          AND status='expiring') AS subsExpiring
      `, [entityId, entityId]
    );

    // Top 5 overdue tasks
    const [overdueTasks] = await pool.query(
      `SELECT id, title, due_date AS dueDate, DATEDIFF(CURDATE(), due_date) AS daysOverdue
         FROM tasks WHERE entity_id=? AND deleted_at IS NULL
           AND due_date < CURDATE() AND status NOT IN ('done','closed','cancelled')
        ORDER BY due_date ASC LIMIT 5`, [entityId]
    );

    // Approvals aged
    const [agedApprovals] = await pool.query(
      `SELECT id, title, created_at AS createdAt,
              DATEDIFF(NOW(), created_at) AS daysPending
         FROM approval_requests
        WHERE entity_id=? AND status='pending'
        ORDER BY created_at ASC LIMIT 5`, [entityId]
    );

    return ok(res, {
      tasks, approvals, sales, finance, hrga, it,
      overdueTasks, agedApprovals,
    });
  } catch (e) { next(e); }
}

module.exports = { summary };
