const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

/**
 * Cari context_record berdasarkan tipe + id.
 */
async function findContextRecord({ contextType, contextId, entityId }) {
  const [rows] = await pool.query(
    `SELECT * FROM context_records
      WHERE entity_id=? AND context_type=? AND context_id=?
        AND deleted_at IS NULL LIMIT 1`,
    [entityId, contextType, contextId]
  );
  return rows[0] || null;
}

/**
 * GET /workspaces/customer/:customerId
 * Merangkai: customer, pipeline, sample requests, quotations, meetings, tasks, documents,
 * finance requests, approvals, signatures, activity timeline, AI summary.
 */
async function customerWorkspace(req, res, next) {
  try {
    const { customerId } = req.params;
    const [cRows] = await pool.query(
      `SELECT * FROM sales_customers WHERE id=? AND deleted_at IS NULL`, [customerId]
    );
    const customer = cRows[0];
    if (!customer) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);

    const entityId = customer.entity_id;

    // context_record
    const ctxRecord = await findContextRecord({
      contextType: 'customer', contextId: customer.id, entityId,
    });

    const [pipeline] = await pool.query(
      `SELECT p.*, u.name AS ownerName FROM sales_pipeline p
         LEFT JOIN users u ON u.id=p.owner_user_id
        WHERE p.customer_id=? AND p.deleted_at IS NULL
        ORDER BY p.id DESC`, [customerId]
    );
    const [samples] = await pool.query(
      `SELECT s.id, s.product_name AS productName, s.quantity, s.unit, s.status,
              s.priority, s.created_at AS createdAt,
              w.id AS warehouseTaskId, w.status AS warehouseStatus
         FROM sales_sample_requests s
         LEFT JOIN warehouse_sample_tasks w ON w.sample_request_id=s.id
        WHERE s.customer_id=? AND s.deleted_at IS NULL
        ORDER BY s.id DESC LIMIT 50`, [customerId]
    );
    const [quotations] = await pool.query(
      `SELECT id, quotation_number AS quotationNumber, total_amount AS totalAmount,
              currency, status, validity_date AS validityDate, created_at AS createdAt
         FROM sales_quotations WHERE customer_id=? AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 50`, [customerId]
    );
    const [visits] = await pool.query(
      `SELECT id, visit_date AS visitDate, location, summary, created_at AS createdAt
         FROM sales_visit_reports WHERE customer_id=? ORDER BY id DESC LIMIT 20`, [customerId]
    );

    // meeting
    let meetings = [];
    if (ctxRecord) {
      const [m] = await pool.query(
        `SELECT id, title, start_time AS startTime, status, meet_link AS meetLink,
                ai_summary_id AS aiSummaryId
           FROM meetings WHERE context_record_id=? AND deleted_at IS NULL
          ORDER BY start_time DESC LIMIT 20`, [ctxRecord.id]
      );
      meetings = m;
    }
    // fallback: meeting_links ke customer
    if (!meetings.length) {
      const [m] = await pool.query(
        `SELECT m.id, m.title, m.start_time AS startTime, m.status,
                m.meet_link AS meetLink, m.ai_summary_id AS aiSummaryId
           FROM meetings m
           JOIN meeting_links ml ON ml.meeting_id = m.id
          WHERE ml.linked_type='customer' AND ml.linked_id=?
            AND m.deleted_at IS NULL
          ORDER BY m.start_time DESC LIMIT 20`, [customerId]
      );
      meetings = m;
    }

    // finance
    const [finance] = await pool.query(
      `SELECT id, request_number AS requestNumber, workflow_type AS workflowType,
              title, total_amount AS totalAmount, currency, status, created_at AS createdAt
         FROM finance_workflows
        WHERE deleted_at IS NULL AND title LIKE ? OR notes LIKE ?
        ORDER BY id DESC LIMIT 20`,
      [`%${customer.name}%`, `%${customer.name}%`]
    );

    // tasks: cari task yang source-nya terhubung (via meeting) atau via judul
    const [tasks] = await pool.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date AS dueDate,
              u.name AS assigneeName, t.created_at AS createdAt
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.entity_id=? AND t.deleted_at IS NULL
          AND (t.title LIKE ? OR t.description LIKE ?)
        ORDER BY t.id DESC LIMIT 30`,
      [entityId, `%${customer.name}%`, `%${customer.name}%`]
    );

    // activity timeline (dari activity_logs & signature_logs bila ada)
    const [activities] = await pool.query(
      `SELECT id, action, subject_type AS subjectType, subject_id AS subjectId,
              metadata, created_at AS createdAt
         FROM activity_logs
        WHERE entity_id=? AND (
          (subject_type='sales_customer' AND subject_id=?) OR
          (subject_type='sales_pipeline' AND subject_id IN
             (SELECT id FROM sales_pipeline WHERE customer_id=?)) OR
          (subject_type='sales_sample_request' AND subject_id IN
             (SELECT id FROM sales_sample_requests WHERE customer_id=?)) OR
          (subject_type='sales_quotation' AND subject_id IN
             (SELECT id FROM sales_quotations WHERE customer_id=?))
        )
        ORDER BY id DESC LIMIT 50`,
      [entityId, customerId, customerId, customerId, customerId]
    );

    // decision log
    const [decisions] = await pool.query(
      `SELECT id, title, category, status, decided_at AS decidedAt, created_at AS createdAt
         FROM decision_logs
        WHERE entity_id=? AND deleted_at IS NULL
          AND subject_type='customer' AND subject_id=?
        ORDER BY id DESC LIMIT 20`, [entityId, customerId]
    );

    return ok(res, {
      customer,
      contextRecordId: ctxRecord?.id || null,
      pipeline,
      samples,
      quotations,
      visits,
      meetings,
      finance,
      tasks,
      activities,
      decisions,
    });
  } catch (e) { next(e); }
}

/**
 * GET /workspaces/cross-division/:contextType/:contextId
 * Generik untuk context apa pun (project, vendor, employee, dll).
 */
async function crossDivisionWorkspace(req, res, next) {
  try {
    const { contextType, contextId } = req.params;
    const entityId = req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId tidak tersedia', 400);

    const ctx = await findContextRecord({ contextType, contextId, entityId });
    if (!ctx) return fail(res, 'NOT_FOUND', 'Context tidak ditemukan', 404);

    const [related] = await pool.query(
      `SELECT id, related_type AS relatedType, related_id AS relatedId, relation, created_at AS createdAt
         FROM related_records WHERE context_record_id=? ORDER BY id DESC`, [ctx.id]
    );
    const [links] = await pool.query(
      `SELECT id, from_type AS fromType, from_id AS fromId, to_type AS toType,
              to_id AS toId, relation, created_at AS createdAt
         FROM cross_division_links
        WHERE entity_id=? AND
          ((from_type=? AND from_id=?) OR (to_type=? AND to_id=?))
        ORDER BY id DESC LIMIT 100`,
      [entityId, contextType, contextId, contextType, contextId]
    );
    const [activities] = await pool.query(
      `SELECT id, action, subject_type AS subjectType, subject_id AS subjectId,
              metadata, created_at AS createdAt
         FROM activity_logs
        WHERE entity_id=? AND subject_type=? AND subject_id=?
        ORDER BY id DESC LIMIT 50`,
      [entityId, contextType, contextId]
    );

    return ok(res, { context: ctx, related, links, activities });
  } catch (e) { next(e); }
}

module.exports = { customerWorkspace, crossDivisionWorkspace };
