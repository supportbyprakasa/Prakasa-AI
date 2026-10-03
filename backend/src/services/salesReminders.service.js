const pool = require('../db/pool');
const { openReceivableSql } = require('./invoiceRules');
const { factsForEntity } = require('./salesFacts');
const notif = require('./notification.service');
const { ACTIVE_DAYS, LOST_DAYS } = require('./salesStatus');

// Reminds the salesperson of a customer that has stopped ordering, before it
// becomes Lost:
//   dormant    — the day it crosses 30 days without an order
//   near_lost  — 10 days before Lost (50 days), the last call
// Each reminder is sent once per last order (sales_reminders); a new order
// resets the clock. Customers whose salesperson has no mapped account are
// gathered into one digest for the division's Sales supervisors and heads.
// In-app notifications only, unless an admin adds a notification rule for the
// event.

const NEAR_LOST_DAYS = LOST_DAYS - 10;
const EVENT = 'sales.customer_dormant';

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function dueReminders(entityId) {
  const src = await factsForEntity(entityId);
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.customer_code AS code, c.department_id AS departmentId, c.last_order_date AS lastOrderDate,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) AS days,
            IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) >= ${NEAR_LOST_DAYS}, 'near_lost', 'dormant') AS kind
       FROM ${src.customers} c
      WHERE c.entity_id = ? AND c.deleted_at IS NULL
        AND DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) BETWEEN ${ACTIVE_DAYS} AND ${LOST_DAYS - 1}
        AND NOT EXISTS (
          SELECT 1 FROM sales_reminders r
           WHERE r.customer_id = c.id AND r.last_order_date = c.last_order_date
             AND r.kind = IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) >= ${NEAR_LOST_DAYS}, 'near_lost', 'dormant'))
      ORDER BY days DESC, c.id`,
    [entityId],
  );
  if (!rows.length) return [];
  const [owners] = await pool.query(
    `SELECT k.record_id AS customerId, k.user_id AS userId
       FROM sales_owner_links k JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE k.record_type = 'customer' AND k.record_id IN (?)`,
    [rows.map((r) => r.id)],
  );
  const byCustomer = new Map();
  for (const o of owners) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) || []), o.userId]);
  return rows.map((r) => ({ ...r, days: Number(r.days), owners: byCustomer.get(r.id) || [] }));
}

// Sales supervisors and heads of a division: whoever keeps its master data.
async function supervisorsOf(entityId, departmentIds) {
  if (!departmentIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id AS userId, u.department_id AS departmentId
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'sales.master.manage'
      WHERE u.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active' AND u.department_id IN (?)`,
    [entityId, departmentIds],
  );
  const map = new Map();
  for (const r of rows) map.set(r.departmentId, [...(map.get(r.departmentId) || []), r.userId]);
  return map;
}

function message(c) {
  const left = LOST_DAYS - c.days;
  return c.kind === 'near_lost'
    ? { title: `${c.name} hampir Lost`, body: `Belum order ${c.days} hari. Jadi Lost dalam ${left} hari — hubungi sekarang.` }
    : { title: `${c.name} mulai dormant`, body: `Belum order ${c.days} hari sejak ${iso(c.lastOrderDate)}. Hubungi sebelum ${LOST_DAYS} hari (Lost).` };
}

// Plans (dryRun) or sends the due reminders for one entity.
async function run(entityId, { dryRun = false } = {}) {
  const due = await dueReminders(entityId);
  const orphans = due.filter((c) => !c.owners.length);
  const supervisors = await supervisorsOf(entityId, [...new Set(orphans.map((c) => c.departmentId).filter(Boolean))]);

  const plan = { direct: [], digests: [] };
  for (const c of due.filter((x) => x.owners.length)) {
    for (const userId of c.owners) plan.direct.push({ userId, customerId: c.id, kind: c.kind, ...message(c) });
  }
  const digestFor = new Map();
  for (const c of orphans) {
    for (const userId of supervisors.get(c.departmentId) || []) {
      digestFor.set(userId, [...(digestFor.get(userId) || []), c]);
    }
  }
  for (const [userId, list] of digestFor) {
    const nearLost = list.filter((c) => c.kind === 'near_lost').length;
    plan.digests.push({
      userId,
      title: `${list.length} customer dormant belum punya PIC akun`,
      body: `${list.slice(0, 5).map((c) => c.name).join(', ')}${list.length > 5 ? `, dan ${list.length - 5} lainnya` : ''}`
        + `${nearLost ? ` — ${nearLost} hampir Lost` : ''}. Petakan nama sales-nya di Customers → Pemetaan sales.`,
      customers: list.map((c) => c.id),
    });
  }
  if (dryRun) return { due: due.length, ...plan };

  for (const n of plan.direct) {
    await notif.create({
      userId: n.userId, entityId, title: n.title, body: n.body, event: EVENT,
      subjectType: 'sales_customer', subjectId: n.customerId, actionUrl: `/sales/customers/${n.customerId}`,
    });
  }
  for (const d of plan.digests) {
    await notif.create({
      userId: d.userId, entityId, title: d.title, body: d.body, event: EVENT,
      subjectType: 'sales_customer', subjectId: null, actionUrl: '/sales/pipeline?tahap=dormant',
    });
  }
  // Recorded even when nobody could be told, so a customer is not re-planned daily.
  for (const c of due) {
    const recipients = c.owners.length || [...digestFor.values()].filter((list) => list.includes(c)).length;
    await pool.query(
      `INSERT IGNORE INTO sales_reminders (entity_id, customer_id, last_order_date, kind, recipients) VALUES (?, ?, ?, ?, ?)`,
      [entityId, c.id, iso(c.lastOrderDate), c.kind, recipients],
    );
  }
  return { due: due.length, direct: plan.direct.length, digests: plan.digests.length };
}

// ------------------------------------------------------------------ invoices

// A late invoice is reminded twice: the day after it falls due, and when it is
// 30 days late (that is also when management sees it as an escalation).
const INVOICE_EVENT = 'sales.invoice_overdue';
const INVOICE_LATE_ESCALATION_DAYS = 30;

// Tahap B: late approved Accurate invoices. Owners: the salesperson named on
// the invoice (as mapped) and the customer's PIC accounts.
async function dueAccurateInvoiceReminders(entityId) {
  const [rows] = await pool.query(
    `SELECT i.id, NULL AS orderNumber, i.invoice_number AS invoiceNumber, i.customer_name AS customerName, i.customer_id AS customerId,
            i.department_id AS departmentId, i.outstanding_amount AS outstanding, i.due_date AS dueDate, i.sales_person_name AS salesPersonName,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) AS days,
            IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) >= ${INVOICE_LATE_ESCALATION_DAYS}, 'overdue_30', 'overdue') AS kind
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ? AND ${openReceivableSql('i')} AND i.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
        AND NOT EXISTS (
          SELECT 1 FROM accurate_invoice_reminders r
           WHERE r.entity_id = i.entity_id AND r.accurate_id = i.id
             AND r.kind = IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) >= ${INVOICE_LATE_ESCALATION_DAYS}, 'overdue_30', 'overdue'))
      ORDER BY days DESC, i.id`,
    [entityId],
  );
  if (!rows.length) return [];
  const [mapped] = await pool.query(
    `SELECT LOWER(TRIM(pa.sales_person_name)) AS name, pa.user_id AS userId
       FROM sales_person_accounts pa JOIN users u ON u.id = pa.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE pa.entity_id = ?`,
    [entityId],
  );
  const byName = new Map();
  for (const m of mapped) byName.set(m.name, [...(byName.get(m.name) || []), m.userId]);
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
  const [links] = customerIds.length ? await pool.query(
    `SELECT k.record_id AS customerId, k.user_id AS userId
       FROM sales_owner_links k JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE k.record_type = 'customer' AND k.record_id IN (?)`,
    [customerIds],
  ) : [[]];
  const byCustomer = new Map();
  for (const l of links) byCustomer.set(l.customerId, [...(byCustomer.get(l.customerId) || []), l.userId]);
  return rows.map((r) => ({
    ...r, days: Number(r.days), accurate: true,
    owners: [...new Set([...(byName.get(String(r.salesPersonName || '').trim().toLowerCase()) || []), ...(byCustomer.get(r.customerId) || [])])],
  }));
}

async function dueInvoiceReminders(entityId) {
  if ((await factsForEntity(entityId)).accurate) return dueAccurateInvoiceReminders(entityId);
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number AS orderNumber, o.invoice_numbers AS invoiceNumber, o.customer_name AS customerName,
            o.department_id AS departmentId, o.outstanding_amount AS outstanding, o.due_date AS dueDate,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date) AS days,
            IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date) >= ${INVOICE_LATE_ESCALATION_DAYS}, 'overdue_30', 'overdue') AS kind
       FROM sales_orders o
      WHERE o.entity_id = ? AND o.deleted_at IS NULL AND o.outstanding_amount > 0 AND o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
        AND NOT EXISTS (
          SELECT 1 FROM sales_invoice_reminders r
           WHERE r.order_id = o.id
             AND r.kind = IF(DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date) >= ${INVOICE_LATE_ESCALATION_DAYS}, 'overdue_30', 'overdue'))
      ORDER BY days DESC, o.id`,
    [entityId],
  );
  if (!rows.length) return [];
  const [owners] = await pool.query(
    `SELECT k.record_id AS orderId, k.user_id AS userId
       FROM sales_owner_links k JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND u.status = 'active'
      WHERE k.record_type = 'order' AND k.record_id IN (?)`,
    [rows.map((r) => r.id)],
  );
  const byOrder = new Map();
  for (const o of owners) byOrder.set(o.orderId, [...(byOrder.get(o.orderId) || []), o.userId]);
  return rows.map((r) => ({ ...r, days: Number(r.days), owners: byOrder.get(r.id) || [] }));
}

const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

async function runInvoices(entityId, { dryRun = false } = {}) {
  const due = await dueInvoiceReminders(entityId);
  const orphans = due.filter((o) => !o.owners.length);
  const supervisors = await supervisorsOf(entityId, [...new Set(orphans.map((o) => o.departmentId).filter(Boolean))]);
  const notes = [];
  for (const o of due) {
    const to = o.owners.length ? o.owners : (supervisors.get(o.departmentId) || []);
    for (const userId of to) {
      notes.push({
        userId, orderId: o.id, kind: o.kind,
        title: o.kind === 'overdue_30' ? `Tagihan ${o.customerName} terlambat ${o.days} hari` : `Tagihan ${o.customerName} lewat jatuh tempo`,
        body: `${o.invoiceNumber || o.orderNumber} · sisa ${rupiah(o.outstanding)}. Segera tagih customer ini.`,
      });
    }
  }
  if (dryRun) return { due: due.length, notes };
  const byId = new Map(due.map((o) => [o.id, o]));
  for (const n of notes) {
    const o = byId.get(n.orderId);
    await notif.create({
      userId: n.userId, entityId, title: n.title, body: n.body, event: INVOICE_EVENT,
      ...(o?.accurate
        ? { subjectType: 'sales_customer', subjectId: o.customerId || null, actionUrl: o.customerId ? `/sales/customers/${o.customerId}` : '/sales/orders?tab=invoice&status=overdue&periode=all' }
        : { subjectType: 'sales_order', subjectId: n.orderId, actionUrl: `/sales/orders/${n.orderId}` }),
    });
  }
  for (const o of due) {
    await pool.query(
      o.accurate
        ? 'INSERT IGNORE INTO accurate_invoice_reminders (entity_id, accurate_id, kind, recipients) VALUES (?, ?, ?, ?)'
        : 'INSERT IGNORE INTO sales_invoice_reminders (entity_id, order_id, kind, recipients) VALUES (?, ?, ?, ?)',
      [entityId, o.id, o.kind, notes.filter((n) => n.orderId === o.id).length],
    );
  }
  return { due: due.length, sent: notes.length };
}

module.exports = {
  run, runInvoices, dueReminders, dueInvoiceReminders, NEAR_LOST_DAYS, EVENT, INVOICE_EVENT, INVOICE_LATE_ESCALATION_DAYS,
};
