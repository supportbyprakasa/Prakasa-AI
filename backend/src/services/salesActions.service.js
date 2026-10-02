const pool = require('../db/pool');
const { openReceivableSql } = require('./invoiceRules');
const { ownScope } = require('./salesOwners.service');
const { accurateScope } = require('./salesFacts');
const { numbersFromAccurate } = require('./salesSource');
const { ACTIVE_DAYS, LOST_DAYS, LEAD_FOLLOWUP_DAYS } = require('./salesStatus');
const { searchClause, int, money } = require('./salesQuery');

// "Perlu tindakan hari ini": the Sales to-do list, one kind of work per tab,
// each row with the one action that resolves it. Built from the data, never
// typed; a member sees their own records, a supervisor everyone's.
//
// The menu badge counts only what is urgent — dormant customers, orders to be
// shipped, late invoices. Prospects to revisit are listed but not counted:
// field canvassing leaves many, and a badge that always says 99+ helps nobody.

// An order is expected to leave the warehouse by its ETD; one still without a
// surat jalan within this window is flagged (older ones are history).
const SHIP_WINDOW_DAYS = 30;
const BADGE_OVERDUE_DAYS = 30;

const TYPES = {
  dormant: {
    label: 'Customer dormant',
    hint: `Belum order ${ACTIVE_DAYS}–${LOST_DAYS - 1} hari. Hubungi sebelum jadi Lost di hari ke-${LOST_DAYS}.`,
    badge: true,
    table: 'sales_customers c',
    scope: ['customer', 'c.id'],
    base: `c.deleted_at IS NULL AND DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) BETWEEN ${ACTIVE_DAYS} AND ${LOST_DAYS - 1}`,
    search: ['c.name', 'c.customer_code', 'c.sales_person_name'],
    select: `c.id, c.name AS title, c.customer_code AS reference, c.channel AS context, c.sales_person_name AS salesPersonName,
             c.phone, c.last_order_date AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) AS days`,
    order: 'days DESC, c.id',
  },
  no_do: {
    label: 'Belum ada surat jalan',
    hint: 'Sales order yang harus dikirim tapi surat jalannya belum dibuat.',
    badge: true,
    table: 'sales_orders o',
    scope: ['order', 'o.id'],
    base: `o.deleted_at IS NULL AND (o.do_numbers IS NULL OR o.do_numbers = '')
           AND COALESCE(o.delivery_date, o.order_date) <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) + INTERVAL 1 DAY
           AND o.transaction_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${SHIP_WINDOW_DAYS} DAY`,
    search: ['o.order_number', 'o.customer_name'],
    select: `o.id, o.order_number AS title, o.customer_name AS reference, o.channel AS context, o.sales_person_name AS salesPersonName,
             COALESCE(o.delivery_date, o.order_date) AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), COALESCE(o.delivery_date, o.order_date)) AS days,
             o.total_amount AS amount`,
    order: 'since ASC, o.id',
  },
  overdue: {
    label: 'Tagihan terlambat',
    hint: 'Invoice yang sudah lewat jatuh tempo dan belum lunas.',
    badge: true,
    table: 'sales_orders o',
    scope: ['order', 'o.id'],
    base: 'o.deleted_at IS NULL AND o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND o.outstanding_amount > 0',
    search: ['o.invoice_numbers', 'o.order_number', 'o.customer_name'],
    select: `o.id, o.invoice_numbers AS title, o.customer_name AS reference, o.order_number AS context, o.sales_person_name AS salesPersonName,
             o.due_date AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date) AS days, o.outstanding_amount AS amount`,
    order: 'days DESC, o.id',
  },
  leads: {
    label: 'Lead perlu dikunjungi',
    hint: `Belum jadi customer dan belum dikunjungi lagi ${LEAD_FOLLOWUP_DAYS} hari atau lebih.`,
    badge: false,
    table: 'sales_leads l',
    scope: ['lead', 'l.id'],
    base: `l.deleted_at IS NULL AND l.customer_id IS NULL AND l.status = 'open'
           AND (l.last_visit_date IS NULL OR DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) >= ${LEAD_FOLLOWUP_DAYS})`,
    search: ['l.name', 'l.outlet_code', 'l.area', 'l.sales_person_name'],
    select: `l.id, l.name AS title, l.outlet_code AS reference, l.area AS context, l.sales_person_name AS salesPersonName,
             l.last_visit_date AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) AS days, l.last_note AS note`,
    order: 'l.last_visit_date IS NULL, days DESC, l.id',
  },
};

// Tahap B: the same to-do list, read from approved Accurate data. Rows carry
// source 'accurate' and a customerId, so the page opens the customer (Accurate
// documents have no page of their own in the app).
const ACCURATE_TYPES = {
  ...TYPES,
  dormant: { ...TYPES.dormant, table: 'sales_customers_accurate c' },
  no_do: {
    ...TYPES.no_do,
    label: 'Belum terkirim',
    hint: 'Sales order di Accurate yang belum terkirim penuh (30 hari terakhir).',
    table: 'sales_so_accurate s',
    accurateScope: { salesman: false },
    base: `s.percent_shipped < 100 AND s.trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${SHIP_WINDOW_DAYS} DAY`,
    search: ['s.order_number', 's.customer_name'],
    select: `s.id, s.order_number AS title, s.customer_name AS reference, s.channel AS context, NULL AS salesPersonName,
             s.trans_date AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), s.trans_date) AS days, s.total_amount AS amount,
             s.customer_id AS customerId, CONCAT(FLOOR(s.percent_shipped), '% terkirim') AS note, 'accurate' AS source`,
    order: 'since ASC, s.id',
  },
  overdue: {
    ...TYPES.overdue,
    hint: 'Faktur di Accurate yang sudah lewat jatuh tempo dan belum lunas. Yang terlambat lebih dari 30 hari juga masuk eskalasi manajemen.',
    // The badge is for what a salesperson can still chase: invoices that fell
    // due in the last 30 days. Older ones stay listed (and reach management).
    badgeWhere: `DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) <= ${BADGE_OVERDUE_DAYS}`,
    table: 'sales_invoices_accurate i',
    accurateScope: { salesman: true },
    // Down payments are never overdue receivables (Finance rule, invoiceRules).
    base: `i.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND ${openReceivableSql('i')}`,
    search: ['i.invoice_number', 'i.customer_name'],
    select: `i.id, i.invoice_number AS title, i.customer_name AS reference, i.channel AS context, i.sales_person_name AS salesPersonName,
             i.due_date AS since, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) AS days, i.outstanding_amount AS amount,
             i.customer_id AS customerId, 'accurate' AS source`,
    order: 'days DESC, i.id',
  },
};

const typesFor = (accurate) => (accurate ? ACCURATE_TYPES : TYPES);
const alias = (types, type) => types[type].table.split(' ')[1];

function where(user, type, types) {
  const t = types[type];
  const s = t.accurateScope ? accurateScope(user, alias(types, type), t.accurateScope) : ownScope(user, t.scope[0], t.scope[1]);
  return { sql: `${alias(types, type)}.entity_id = ?${s.sql} AND ${t.base}`, args: [user.entityId, ...s.args] };
}

async function counts(user) {
  const types = typesFor(await numbersFromAccurate(user.entityId));
  const out = {};
  for (const type of Object.keys(types)) {
    const w = where(user, type, types);
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${types[type].table} WHERE ${w.sql}`, w.args);
    out[type] = int(row.n);
  }
  let badge = 0;
  for (const [key, t] of Object.entries(types)) {
    if (!t.badge) continue;
    if (!t.badgeWhere) { badge += out[key]; continue; }
    const w = where(user, key, types);
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${w.sql} AND ${t.badgeWhere}`, w.args);
    badge += int(row.n);
  }
  return { counts: out, badge };
}

async function list(user, type, { page, limit, offset, q }) {
  const types = typesFor(await numbersFromAccurate(user.entityId));
  const t = types[type];
  const w = where(user, type, types);
  const s = searchClause(q, t.search);
  const [rows] = await pool.query(
    `SELECT ${t.select} FROM ${t.table} WHERE ${w.sql}${s.sql} ORDER BY ${t.order} LIMIT ? OFFSET ?`,
    [...w.args, ...s.args, limit, offset],
  );
  const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t.table} WHERE ${w.sql}${s.sql}`, [...w.args, ...s.args]);
  return {
    items: rows.map((r) => ({
      ...r, type, days: r.days === null ? null : int(r.days), amount: r.amount === undefined ? undefined : money(r.amount),
    })),
    total: int(n.n),
    page,
    limit,
  };
}

const catalogue = (accurate = false) => Object.entries(typesFor(accurate)).map(([key, t]) => ({ key, label: t.label, hint: t.hint, badge: t.badge }));

module.exports = { TYPES, ACCURATE_TYPES, SHIP_WINDOW_DAYS, BADGE_OVERDUE_DAYS, counts, list, catalogue };
