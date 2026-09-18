const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

/**
 * GET /timeline?from=&to=&entityId=
 * Gabungan timeline ringan dari tasks, meetings, approvals, finance, hrga, subscriptions.
 */
async function timeline(req, res, next) {
  try {
    const entityId = req.query.entityId ? Number(req.query.entityId) : req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);
    const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

    const [tasks] = await pool.query(
      `SELECT id, title AS label, 'task' AS type, due_date AS date,
              status, priority, assignee_id AS assigneeId
         FROM tasks WHERE entity_id=? AND deleted_at IS NULL
           AND due_date BETWEEN ? AND ?`, [entityId, from, to]
    );
    const [meetings] = await pool.query(
      `SELECT id, title AS label, 'meeting' AS type, DATE(start_time) AS date,
              status, organizer_user_id AS assigneeId
         FROM meetings WHERE entity_id=? AND deleted_at IS NULL
           AND DATE(start_time) BETWEEN ? AND ?`, [entityId, from, to]
    );
    const [approvals] = await pool.query(
      `SELECT id, title AS label, 'approval' AS type, DATE(created_at) AS date,
              status, requested_by AS assigneeId
         FROM approval_requests WHERE entity_id=?
           AND DATE(created_at) BETWEEN ? AND ?`, [entityId, from, to]
    );
    const [finance] = await pool.query(
      `SELECT id, CONCAT(request_number,' ',title) AS label, 'finance' AS type,
              request_date AS date, status, requested_by AS assigneeId
         FROM finance_workflows WHERE entity_id=? AND deleted_at IS NULL
           AND request_date BETWEEN ? AND ?`, [entityId, from, to]
    );
    const [hrga] = await pool.query(
      `SELECT id, CONCAT(workflow_number,' ',employee_full_name) AS label,
              'hrga' AS type, effective_date AS date, status, requested_by AS assigneeId
         FROM hrga_workflows WHERE entity_id=? AND deleted_at IS NULL
           AND effective_date BETWEEN ? AND ?`, [entityId, from, to]
    );
    const [subs] = await pool.query(
      `SELECT id, product_name AS label, 'subscription_renewal' AS type,
              renewal_date AS date, status, pic_user_id AS assigneeId
         FROM software_subscriptions WHERE entity_id=? AND deleted_at IS NULL
           AND renewal_date BETWEEN ? AND ?`, [entityId, from, to]
    );

    const all = [...tasks, ...meetings, ...approvals, ...finance, ...hrga, ...subs];
    return ok(res, { from, to, items: all });
  } catch (e) { next(e); }
}

module.exports = { timeline };
