const pool = require('../db/pool');
const { factsFor } = require('../services/salesFacts');
const { ok, fail } = require('../utils/response');
const records = require('../services/salesRecords.service');
const { statusSql, STATUSES } = require('../services/salesStatus');
const { ownScope } = require('../services/salesOwners.service');
const { CUSTOMER_CHANNELS, LEGAL_FORMS } = require('../services/salesNumbers');
const {
  paging, searchClause, int, money, positiveId, unitQuantities, baseQtyOf,
} = require('../services/salesQuery');

// Customers: managed in the app (the imported list is the starting data).
// Lists page on the server; every query is bound to the caller's entity and,
// without sales.data.view_all, to the customers they own.

function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e.status && e.code) return fail(res, e.code, e.message, e.status);
      return next(e);
    }
  };
}

const list = handle(async (req, res) => {
  const { page, limit, offset } = paging(req.query);
  const src = await factsFor(req.user);
  const cs = ownScope(req.user, 'customer', 'c.id');
  const where = ['c.deleted_at IS NULL', `c.entity_id = ?${cs.sql}`];
  const args = [req.user.entityId, ...cs.args];
  if (req.query.departmentId) { where.push('c.department_id = ?'); args.push(req.query.departmentId); }
  if (req.query.ownerUserId) { where.push('c.owner_user_id = ?'); args.push(req.query.ownerUserId); }
  if (req.query.channel) { where.push('c.channel = ?'); args.push(String(req.query.channel).slice(0, 40)); }
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return fail(res, 'VALIDATION_ERROR', 'status tidak dikenal', 400);
    where.push(`${statusSql('c')} = ?`); args.push(req.query.status);
  }
  const s = searchClause(req.query.q, ['c.name', 'c.contact_person', 'c.customer_code', 'c.phone', 'c.sales_person_name']);
  const whereSql = where.join(' AND ') + s.sql;
  const allArgs = [...args, ...s.args];

  const [rows] = await pool.query(
    `SELECT c.id, c.entity_id AS entityId, c.department_id AS departmentId,
            c.customer_code AS code, c.name, c.channel, c.legal_form AS legalForm, c.contact_person AS contactPerson,
            c.phone, c.business_phone AS businessPhone, c.email, c.address,
            c.city, c.segment, c.owner_user_id AS ownerUserId, u.name AS ownerName,
            c.sales_person_name AS salesPersonName, c.noo_date AS nooDate,
            c.last_order_date AS lastOrderDate, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) AS daysSinceOrder,
            ${statusSql('c')} AS status, c.source, c.created_at AS createdAt
       FROM ${src.customers} c
       LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE ${whereSql}
      ORDER BY c.last_order_date IS NULL, c.last_order_date DESC, c.id DESC LIMIT ? OFFSET ?`,
    [...allArgs, limit, offset]
  );
  // The count needs the Accurate order dates only to filter on status: the
  // view joins every customer to its invoices (window functions over the whole
  // mirror), but it has exactly one row per customer, so without a status
  // filter the plain table counts the same rows (load test, 1 Oct 2026).
  const countFrom = req.query.status ? src.customers : 'sales_customers';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${countFrom} c WHERE ${whereSql}`, allArgs);
  const [channels] = await pool.query(
    `SELECT DISTINCT channel FROM sales_customers
      WHERE entity_id = ? AND deleted_at IS NULL AND channel IS NOT NULL ORDER BY channel`,
    [req.user.entityId]
  );
  return ok(res, rows.map((r) => ({ ...r, daysSinceOrder: r.daysSinceOrder === null ? null : Number(r.daysSinceOrder) })), {
    page, limit, total: int(total),
    channels: [...new Set([...CUSTOMER_CHANNELS, ...channels.map((c) => c.channel)])],
    legalForms: LEGAL_FORMS,
  });
});

async function ownCustomer(req, id) {
  const cs = ownScope(req.user, 'customer', 'c.id');
  const src = await factsFor(req.user);
  const [[customer]] = await pool.query(
    `SELECT c.*, u.name AS ownerName, ${statusSql('c')} AS status,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) AS daysSinceOrder
       FROM ${src.customers} c
       LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.id = ? AND c.entity_id = ?${cs.sql} AND c.deleted_at IS NULL
      LIMIT 1`,
    [id, req.user.entityId, ...cs.args]
  );
  return customer || null;
}

/**
 * GET /sales/customers/:id — the customer with a summary of its orders and
 * visits. The lists themselves are paged by their own endpoints: orders via
 * /sales/orders?customerId=, visits and activity below.
 */
// A customer at a glance (program 2.3), from approved Accurate data: revenue
// net of returns over 12 months, what is owed and how late, the last invoice
// and payment, and the best sellers in base units when Accurate's units are in.
const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
async function customerProfile(entityId, customerId) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS net, COALESCE(SUM(CASE WHEN kind = 'return' THEN -amount END), 0) AS returns,
            COALESCE(SUM(kind = 'invoice'), 0) AS invoices
       FROM sales_revenue_accurate
      WHERE entity_id = ? AND customer_id = ? AND trans_date >= ${TODAY} - INTERVAL 12 MONTH`,
    [entityId, customerId],
  );
  const [[ar]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN NOT is_dp THEN outstanding_amount END), 0) AS owed,
            COALESCE(SUM(CASE WHEN NOT is_dp AND due_date < ${TODAY} THEN outstanding_amount END), 0) AS overdue,
            MAX(trans_date) AS last_invoice, ROUND(AVG(GREATEST(DATEDIFF(due_date, trans_date), 0))) AS term_days
       FROM sales_invoices_accurate WHERE entity_id = ? AND customer_id = ?`,
    [entityId, customerId],
  );
  const [[pay]] = await pool.query(
    'SELECT MAX(trans_date) AS last_receipt FROM sales_receipts_accurate WHERE entity_id = ? AND customer_id = ?',
    [entityId, customerId],
  );
  const [top] = await pool.query(
    `SELECT u.code, MIN(u.name) AS name, SUM(u.revenue) AS revenue,
            JSON_ARRAYAGG(JSON_OBJECT('unit', u.unit, 'qty', u.qty)) AS units,
            CASE WHEN SUM(iu.ratio IS NULL) = 0 THEN SUM(u.qty * iu.ratio) END AS base_qty, MIN(iu.base_unit) AS base_unit
       FROM (SELECT l.item_code AS code, MIN(l.item_name) AS name, l.unit, SUM(l.qty) AS qty, SUM(l.revenue) AS revenue
               FROM sales_invoice_lines_accurate l
              WHERE l.entity_id = ? AND l.customer_id = ? AND NOT l.is_dp AND l.trans_date >= ${TODAY} - INTERVAL 12 MONTH
              GROUP BY l.item_code, l.unit) u
       LEFT JOIN item_units_accurate iu ON iu.entity_id = ? AND iu.item_no = u.code COLLATE utf8mb4_unicode_ci
             AND iu.unit_name = u.unit COLLATE utf8mb4_unicode_ci
      GROUP BY u.code ORDER BY revenue DESC LIMIT 5`,
    [entityId, customerId, entityId],
  );
  return {
    revenue12m: money(r.net), returns12m: money(r.returns), invoices12m: int(r.invoices),
    owed: money(ar.owed), overdue: money(ar.overdue), lastInvoiceDate: ar.last_invoice || null,
    termDays: ar.term_days === null ? null : int(ar.term_days), lastReceiptDate: pay?.last_receipt || null,
    topProducts: top.map((t) => ({ code: t.code, name: t.name, revenue: money(t.revenue), qtyByUnit: unitQuantities(t.units), baseQty: baseQtyOf(t.base_qty, t.base_unit) })),
  };
}

const detail = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  const customer = await ownCustomer(req, id);
  if (!customer) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);
  const entityId = req.user.entityId;
  const [[visits]] = await pool.query(
    'SELECT COUNT(*) AS n FROM sales_visit_reports WHERE customer_id = ? AND entity_id = ?', [id, entityId]
  );
  // Order figures only for those allowed to see sales figures.
  let orders = null;
  if ((req.user.permissions || []).includes('sales.order.view') && (await factsFor(req.user)).accurate) {
    // Tahap B: the customer's approved Accurate invoices.
    const [[o]] = await pool.query(
      `SELECT COUNT(*) AS n, SUM(total_amount) AS total, SUM(outstanding_amount) AS outstanding
         FROM sales_invoices_accurate WHERE customer_id = ? AND entity_id = ?`,
      [id, entityId]
    );
    orders = { count: int(o.n), total: money(o.total), outstanding: money(o.outstanding), lastOrderId: null, unit: 'faktur' };
    orders.profile = await customerProfile(entityId, id);
  } else if ((req.user.permissions || []).includes('sales.order.view')) {
    const [[o]] = await pool.query(
      `SELECT COUNT(*) AS n, SUM(total_amount) AS total, SUM(outstanding_amount) AS outstanding,
              (SELECT x.id FROM sales_orders x WHERE x.customer_id = ? AND x.deleted_at IS NULL
                ORDER BY x.transaction_date DESC, x.id DESC LIMIT 1) AS lastOrderId
         FROM sales_orders WHERE customer_id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, id, entityId]
    );
    orders = { count: int(o.n), total: money(o.total), outstanding: money(o.outstanding), lastOrderId: o.lastOrderId || null };
  }
  return ok(res, { customer, summary: { visits: int(visits.n), orders } });
});

const visits = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  if (!(await ownCustomer(req, id))) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT id, visit_date AS visitDate, location, summary, sales_person_name AS salesPersonName,
            DATE_FORMAT(check_in_at, '%H:%i') AS checkInTime, duration_minutes AS durationMinutes, source
       FROM sales_visit_reports
      WHERE customer_id = ? AND entity_id = ?
      ORDER BY visit_date DESC, id DESC LIMIT ? OFFSET ?`,
    [id, req.user.entityId, limit, offset]
  );
  const [[n]] = await pool.query(
    'SELECT COUNT(*) AS n FROM sales_visit_reports WHERE customer_id = ? AND entity_id = ?', [id, req.user.entityId]
  );
  return ok(res, rows, { page, limit, total: int(n.n) });
});

// The customer's own activity and that of its orders.
const ACTIVITY_WHERE = `a.entity_id = ? AND (
    (a.subject_type = 'sales_customer' AND a.subject_id = ?)
    OR (a.subject_type = 'sales_order' AND a.subject_id IN (SELECT id FROM sales_orders WHERE customer_id = ?)))`;

const activity = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  if (!(await ownCustomer(req, id))) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT a.id, a.action, a.subject_type AS subjectType, a.subject_id AS subjectId, a.metadata,
            a.created_at AS createdAt, u.name AS userName
       FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${ACTIVITY_WHERE}
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [req.user.entityId, id, id, limit, offset]
  );
  const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM activity_logs a WHERE ${ACTIVITY_WHERE}`, [req.user.entityId, id, id]);
  return ok(res, rows, { page, limit, total: int(n.n) });
});

const nextCode = handle(async (req, res) => ok(res, {
  code: await records.nextCustomerCode(req.user, {
    legalForm: req.query.legalForm, channel: req.query.channel, cityCode: req.query.cityCode,
  }),
}));

const create = handle(async (req, res) => ok(res, await records.createCustomer(req.user, req.body), undefined, 201));

const update = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.updateCustomer(req.user, id, req.body));
});

const remove = handle(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.deleteCustomer(req.user, id));
});

module.exports = {
  list, detail, visits, activity, nextCode, create, update, remove,
};
