const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.status) { where.push('w.status = ?'); args.push(req.query.status); }
    if (req.query.entityId) { where.push('w.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.assignedTo) { where.push('w.assigned_to = ?'); args.push(req.query.assignedTo); }

    const [rows] = await pool.query(
      `SELECT w.id, w.entity_id AS entityId, w.department_id AS departmentId,
              w.sample_request_id AS sampleRequestId, s.product_name AS productName,
              s.quantity, s.unit, s.priority, s.delivery_address AS deliveryAddress,
              s.customer_id AS customerId, c.name AS customerName,
              s.requested_by AS requestedBy,
              w.assigned_to AS assignedTo, w.status,
              w.prepared_at AS preparedAt, w.ready_at AS readyAt, w.delivered_at AS deliveredAt,
              w.created_at AS createdAt
         FROM warehouse_sample_tasks w
         JOIN sales_sample_requests s ON s.id = w.sample_request_id
         LEFT JOIN sales_customers c ON c.id = s.customer_id
        WHERE ${where.join(' AND ')}
        ORDER BY w.status, w.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function assign(req, res, next) {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;
    const [r] = await pool.query(
      `UPDATE warehouse_sample_tasks SET assigned_to=? WHERE id=?`,
      [assignedTo || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'warehouse_sample.assign', subjectType: 'warehouse_sample_task',
      subjectId: Number(id), metadata: { assignedTo },
    });
    if (assignedTo) {
      const [wt] = await pool.query(
        `SELECT entity_id AS entityId FROM warehouse_sample_tasks WHERE id=?`, [id]
      );
      await notif.create({
        userId: assignedTo, entityId: wt[0].entityId,
        title: 'Sample task baru',
        body: `Task #${id} ditugaskan ke Anda`,
        event: 'warehouse_task.assigned',
        subjectType: 'warehouse_sample_task', subjectId: Number(id),
        actionUrl: `/warehouse/sample-tasks`,
      });
    }
    return ok(res, { id: Number(id), assignedTo });
  } catch (e) { next(e); }
}

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['queued', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', 'Status tidak valid', 400);

    const updates = ['status=?'];
    const args = [status];
    if (notes !== undefined) { updates.push('notes=?'); args.push(notes || null); }
    if (status === 'preparing') { updates.push('prepared_at=NOW()'); }
    if (status === 'ready') { updates.push('ready_at=NOW()'); }
    if (status === 'delivered') { updates.push('delivered_at=NOW()'); }
    args.push(id);

    const [r] = await pool.query(
      `UPDATE warehouse_sample_tasks SET ${updates.join(', ')} WHERE id=?`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);

    // sinkron ke sales_sample_requests status
    const statusMap = {
      preparing: 'preparing',
      ready: 'ready',
      delivered: 'delivered',
      cancelled: 'cancelled',
    };
    if (statusMap[status]) {
      await pool.query(
        `UPDATE sales_sample_requests s
           JOIN warehouse_sample_tasks w ON w.sample_request_id = s.id
          SET s.status=?
          WHERE w.id=?`, [statusMap[status], id]
      );
    }

    await log({
      entityId: null, userId: req.user.sub,
      action: 'warehouse_sample.status', subjectType: 'warehouse_sample_task',
      subjectId: Number(id), metadata: { status, notes },
    });

    // Notifikasi ke sales PIC (requester)
    const [info] = await pool.query(
      `SELECT s.requested_by AS requestedBy, s.entity_id AS entityId,
              s.product_name AS productName
         FROM warehouse_sample_tasks w
         JOIN sales_sample_requests s ON s.id = w.sample_request_id
        WHERE w.id=?`, [id]
    );
    if (info[0]) {
      await notif.create({
        userId: info[0].requestedBy, entityId: info[0].entityId,
        title: `Sample ${status}`,
        body: info[0].productName,
        event: `warehouse_sample.${status}`,
        subjectType: 'warehouse_sample_task', subjectId: Number(id),
        actionUrl: `/sales/sample-requests`,
      });
    }

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

module.exports = { list, assign, updateStatus };
