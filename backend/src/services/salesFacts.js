const pool = require('../db/pool');
const { numbersFromAccurate } = require('./salesSource');
const { ownScope } = require('./salesOwners.service');
const { receivableSql } = require('./invoiceRules');

// Where the Sales numbers come from, in one place (Tahap B, docs/sales-module.md).
//
//   recap    (before Tahap B / app mode) — the app's sales_orders, as before.
//   accurate (after the first approved batch) — approved Accurate invoices:
//            revenue = invoice DPP (owner's decision), receivables and due
//            dates from the invoice, customer order dates from invoices.
//
// Both shapes expose the same columns, so a query is written once:
//   id, entity_id, department_id, tdate, due_date, dpp_amount, total_amount,
//   outstanding_amount, channel, sales_person_name, customer_id, customer_name, doc_number
// Nothing here writes anything: the Accurate side is a set of read views.

const RECAP_FACTS = `(SELECT o.id, o.entity_id, o.department_id, o.transaction_date AS tdate, o.due_date, o.dpp_amount,
        o.total_amount, o.outstanding_amount, o.channel, o.sales_person_name, o.customer_id, o.customer_name,
        o.order_number AS doc_number
   FROM sales_orders o WHERE o.deleted_at IS NULL)`;

// Receivables follow the Finance rule (invoiceRules): a down-payment invoice is
// never money owed, so its outstanding reads 0 here.
const ACCURATE_FACTS = `(SELECT i.id, i.entity_id, i.department_id, i.trans_date AS tdate, i.due_date, i.dpp_amount,
        i.total_amount, IF(${receivableSql('i')}, i.outstanding_amount, 0) AS outstanding_amount, i.channel, i.sales_person_name, i.customer_id, i.customer_name,
        i.invoice_number AS doc_number
   FROM sales_invoices_accurate i)`;

// A member's own Accurate invoices: their salesperson name (as mapped in
// Customers → Pemetaan sales) is on the invoice, or they own the customer.
// Accurate sales orders carry no salesperson in the list, so for them only
// customer ownership applies ({ salesman: false }).
// Revenue (program 2.3, owner decision): invoices net of returns, down-payment
// invoices left out — one row per invoice (+DPP) and per return (−DPP).
// `kind` tells them apart, so an order count counts invoices only.
const ACCURATE_REVENUE_FACTS = `(SELECT r.doc_id AS id, r.entity_id, r.department_id, r.trans_date AS tdate, r.amount AS dpp_amount,
        r.channel, r.sales_person_name, r.customer_id, r.customer_name, r.number AS doc_number, r.kind
   FROM sales_revenue_accurate r)`;

function accurateScope(user, alias, { salesman = true } = {}) {
  if ((user?.permissions || []).includes('sales.data.view_all')) return { sql: '', args: [] };
  const me = Number(user?.sub) || 0;
  const byCustomer = `EXISTS (SELECT 1 FROM sales_owner_links k
                         WHERE k.record_type = 'customer' AND k.record_id = ${alias}.customer_id AND k.user_id = ?)`;
  if (!salesman) return { sql: ` AND ${byCustomer}`, args: [me] };
  return {
    sql: ` AND (EXISTS (SELECT 1 FROM sales_person_accounts pa
                         WHERE pa.entity_id = ${alias}.entity_id AND pa.user_id = ?
                           AND LOWER(TRIM(pa.sales_person_name)) COLLATE utf8mb4_unicode_ci = LOWER(TRIM(${alias}.sales_person_name)))
             OR ${byCustomer})`,
    args: [me, me],
  };
}

async function factsFor(user) {
  const accurate = await numbersFromAccurate(user.entityId);
  return accurate
    ? {
      accurate: true,
      facts: ACCURATE_FACTS,
      revenueFacts: ACCURATE_REVENUE_FACTS,
      orderCount: (alias) => `COALESCE(SUM(${alias}.kind = 'invoice'), 0)`,
      customers: 'sales_customers_accurate',
      scope: (alias) => accurateScope(user, alias),
      unit: 'faktur',
    }
    : {
      accurate: false,
      facts: RECAP_FACTS,
      revenueFacts: RECAP_FACTS,
      orderCount: () => 'COUNT(*)',
      customers: 'sales_customers',
      scope: (alias) => ownScope(user, 'order', `${alias}.id`),
      unit: 'sales order',
    };
}

// For jobs and management views that have no user: same sources, no member scope.
async function factsForEntity(entityId) {
  const accurate = await numbersFromAccurate(entityId);
  return {
    accurate,
    facts: accurate ? ACCURATE_FACTS : RECAP_FACTS,
    revenueFacts: accurate ? ACCURATE_REVENUE_FACTS : RECAP_FACTS,
    orderCount: accurate ? (alias) => `COALESCE(SUM(${alias}.kind = 'invoice'), 0)` : () => 'COUNT(*)',
    customers: accurate ? 'sales_customers_accurate' : 'sales_customers',
    unit: accurate ? 'faktur' : 'sales order',
  };
}

// Revenue (DPP, before PPN) and document count per channel for one period
// (dates inclusive): the same source, member scope and grouping as the
// overview's "channel bulan ini" (salesData.controller overview). Read only.
async function revenueByChannel(user, { from, to }) {
  const src = await factsFor(user);
  const scope = src.scope('t');
  const [rows] = await pool.query(
    `SELECT COALESCE(t.channel, 'Lainnya') AS channel, ${src.orderCount('t')} AS orders, SUM(t.dpp_amount) AS revenue
       FROM ${src.revenueFacts} t
      WHERE t.entity_id = ?${scope.sql} AND t.tdate BETWEEN ? AND ?
      GROUP BY t.channel ORDER BY revenue DESC`,
    [user.entityId, ...scope.args, from, to],
  );
  return {
    accurate: src.accurate,
    unit: src.unit,
    channels: rows.map((r) => ({ channel: r.channel, orders: Number(r.orders || 0), revenue: Math.round(Number(r.revenue || 0) * 100) / 100 })),
  };
}

module.exports = { factsFor, factsForEntity, accurateScope, revenueByChannel, RECAP_FACTS, ACCURATE_FACTS, ACCURATE_REVENUE_FACTS };
