const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

/**
 * Global search lintas entitas utama.
 * Untuk MVP: pakai LIKE query. (Catatan: kalau data besar, tambah FULLTEXT index.)
 */
async function search(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return fail(res, 'VALIDATION_ERROR', 'Kata kunci minimal 2 karakter', 400);
    const entityId = req.query.entityId ? Number(req.query.entityId) : req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);
    const like = `%${q}%`;
    const limit = Math.min(20, parseInt(req.query.limit) || 10);

    const results = [];

    // Documents
    const [docs] = await pool.query(
      `SELECT id, title, document_type AS documentType, status, created_at AS createdAt
         FROM documents
        WHERE entity_id=? AND deleted_at IS NULL AND title LIKE ?
        ORDER BY id DESC LIMIT ?`, [entityId, like, limit]
    );
    results.push(...docs.map((d) => ({ type: 'document', ...d })));

    // Tasks
    const [tasks] = await pool.query(
      `SELECT id, title, status, priority, due_date AS dueDate, created_at AS createdAt
         FROM tasks
        WHERE entity_id=? AND deleted_at IS NULL
          AND (title LIKE ? OR description LIKE ?)
        ORDER BY id DESC LIMIT ?`, [entityId, like, like, limit]
    );
    results.push(...tasks.map((t) => ({ type: 'task', ...t })));

    // Sales customers
    const [customers] = await pool.query(
      `SELECT id, name, contact_person AS contactPerson, phone, city
         FROM sales_customers
        WHERE entity_id=? AND deleted_at IS NULL AND (name LIKE ? OR contact_person LIKE ?)
        ORDER BY id DESC LIMIT ?`, [entityId, like, like, limit]
    );
    results.push(...customers.map((c) => ({ type: 'customer', ...c })));

    // Sales pipeline
    const [pipelines] = await pool.query(
      `SELECT id, deal_title AS dealTitle, stage, created_at AS createdAt
         FROM sales_pipeline
        WHERE entity_id=? AND deleted_at IS NULL AND deal_title LIKE ?
        ORDER BY id DESC LIMIT ?`, [entityId, like, limit]
    );
    results.push(...pipelines.map((p) => ({ type: 'sales_pipeline', ...p })));

    // Meetings
    const [meetings] = await pool.query(
      `SELECT id, title, start_time AS startTime, status
         FROM meetings
        WHERE entity_id=? AND deleted_at IS NULL AND title LIKE ?
        ORDER BY start_time DESC LIMIT ?`, [entityId, like, limit]
    );
    results.push(...meetings.map((m) => ({ type: 'meeting', ...m })));

    // Devices
    const [devices] = await pool.query(
      `SELECT id, asset_code AS assetCode, device_type AS deviceType, brand, model, status
         FROM devices
        WHERE entity_id=? AND deleted_at IS NULL
          AND (asset_code LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?)
        ORDER BY id DESC LIMIT ?`, [entityId, like, like, like, like, limit]
    );
    results.push(...devices.map((d) => ({ type: 'device', ...d })));

    // Subscriptions
    const [subs] = await pool.query(
      `SELECT id, product_name AS productName, plan_name AS planName, status,
              renewal_date AS renewalDate
         FROM software_subscriptions
        WHERE entity_id=? AND deleted_at IS NULL AND product_name LIKE ?
        ORDER BY id DESC LIMIT ?`, [entityId, like, limit]
    );
    results.push(...subs.map((s) => ({ type: 'subscription', ...s })));

    // Finance workflows
    const [fin] = await pool.query(
      `SELECT id, request_number AS requestNumber, title, status,
              total_amount AS totalAmount, currency
         FROM finance_workflows
        WHERE entity_id=? AND deleted_at IS NULL
          AND (title LIKE ? OR request_number LIKE ? OR payee_name LIKE ?)
        ORDER BY id DESC LIMIT ?`, [entityId, like, like, like, limit]
    );
    results.push(...fin.map((f) => ({ type: 'finance_workflow', ...f })));

    // HRGA workflows
    const [hrga] = await pool.query(
      `SELECT id, workflow_number AS workflowNumber, workflow_type AS workflowType,
              employee_full_name AS employeeFullName, status
         FROM hrga_workflows
        WHERE entity_id=? AND deleted_at IS NULL
          AND (employee_full_name LIKE ? OR workflow_number LIKE ? OR employee_email LIKE ?)
        ORDER BY id DESC LIMIT ?`, [entityId, like, like, like, limit]
    );
    results.push(...hrga.map((h) => ({ type: 'hrga_workflow', ...h })));

    // KB documents (visibility check sederhana: hanya entity/department user)
    const [kb] = await pool.query(
      `SELECT id, title, category
         FROM kb_documents
        WHERE entity_id=? AND is_active=1 AND deleted_at IS NULL AND title LIKE ?
          AND (visibility='entity' OR (visibility='department' AND department_id<=>?))
        ORDER BY id DESC LIMIT ?`,
      [entityId, like, req.user.departmentId || null, limit]
    );
    results.push(...kb.map((k) => ({ type: 'kb_document', ...k })));

    // Decision logs
    const [decisions] = await pool.query(
      `SELECT id, title, category, status, created_at AS createdAt
         FROM decision_logs
        WHERE entity_id=? AND deleted_at IS NULL AND title LIKE ?
        ORDER BY id DESC LIMIT ?`, [entityId, like, limit]
    );
    results.push(...decisions.map((d) => ({ type: 'decision_log', ...d })));

    return ok(res, results);
  } catch (e) { next(e); }
}

module.exports = { search };
