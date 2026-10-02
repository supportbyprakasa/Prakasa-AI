const pool = require('../../db/pool');
const exchanges = require('../../services/salesExchanges.service');
const {
  MAX_ITEMS_PER_SOURCE, int, num, scope, escalationItem, byDepartment,
} = require('../helpers');
const {
  ACTIVE_DAYS, LOST_DAYS, LEAD_FOLLOWUP_DAYS, statusSql,
} = require('../../services/salesStatus');

const { transactionsReliable } = require('../../services/salesSource');
const { factsForEntity } = require('../../services/salesFacts');
const { openReceivableSql, BILLED_MONTHLY_DIVISIONS } = require('../../services/invoiceRules');

// Until Accurate is connected, transactions are the old, incomplete sheet
// recap (owner's decision 2026-09-29: mark, and hold the alarms). Escalations
// built on them are held; KPIs still show, marked so nobody reads them as fact.
const NOT_CONNECTED = 'Belum tersambung Accurate — data lama, belum lengkap';
const marked = async (entityId, result) => ((await transactionsReliable(entityId))
  ? result
  : { ...result, sub: result.sub ? `${result.sub} · ${NOT_CONNECTED}` : NOT_CONNECTED, alert: false });

// An invoice this late is no longer the salesperson's routine follow-up: it
// reaches management (the salesperson was already reminded when it fell due).
const INVOICE_LATE_DAYS = 30;

// Sales & Customer. The numbers come from the Sales team's own data, mirrored
// read-only from the Sales Data Tracker (customers, sales orders) and the
// field-app visit exports (leads) — not from hand-typed deals. Customer status
// follows the sheet's rule (see services/salesStatus.js).
//
// Every sales table carries its own department_id (the Sales division for
// synced data), so each query is scoped on the table it reads. Rows without a
// division are, by design, only visible company-wide.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : 'Bulan lalu';
};

// Whether this division is billed once a month (invoiceRules.BILLED_MONTHLY_DIVISIONS).
async function billedMonthlyDivision(departmentId) {
  const [[row]] = await pool.query('SELECT code FROM departments WHERE id = ? LIMIT 1', [Number(departmentId)]);
  return Boolean(row && BILLED_MONTHLY_DIVISIONS.includes(row.code));
}

const located = (row) => (row
  ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
  : null);

// Tahap B: revenue = approved Accurate invoice DPP net of returns, without
// down-payment invoices (sales_revenue_accurate); order count = Accurate SOs.
async function accurateInPeriod(entityId, period, departmentId) {
  const si = scope(departmentId, 'i.department_id');
  const [revenue] = await pool.query(
    `SELECT i.department_id, COALESCE(SUM(i.amount), 0) AS revenue
       FROM sales_revenue_accurate i
      WHERE i.entity_id = ?${si.sql} AND i.trans_date BETWEEN ? AND ?
      GROUP BY i.department_id`,
    [entityId, ...si.args, period.start, period.end]
  );
  const ss = scope(departmentId, 's.department_id');
  const [orders] = await pool.query(
    `SELECT s.department_id, COUNT(*) AS orders
       FROM sales_so_accurate s
      WHERE s.entity_id = ?${ss.sql} AND s.trans_date BETWEEN ? AND ?
      GROUP BY s.department_id`,
    [entityId, ...ss.args, period.start, period.end]
  );
  const byDept = new Map();
  for (const r of revenue) byDept.set(r.department_id, { department_id: r.department_id, revenue: r.revenue, orders: 0 });
  for (const o of orders) byDept.set(o.department_id, { ...(byDept.get(o.department_id) || { department_id: o.department_id, revenue: 0 }), orders: o.orders });
  return [...byDept.values()];
}

async function ordersInPeriod(entityId, period, departmentId) {
  if ((await factsForEntity(entityId)).accurate) return accurateInPeriod(entityId, period, departmentId);
  const s = scope(departmentId, 'o.department_id');
  const [rows] = await pool.query(
    `SELECT o.department_id, COUNT(*) AS orders, COALESCE(SUM(o.dpp_amount), 0) AS revenue
       FROM sales_orders o
      WHERE o.entity_id = ?${s.sql}
        AND o.deleted_at IS NULL
        AND o.transaction_date BETWEEN ? AND ?
      GROUP BY o.department_id`,
    [entityId, ...s.args, period.start, period.end]
  );
  return rows;
}

module.exports = {
  key: 'sales',
  label: 'Sales & Pelanggan',
  navPaths: ['/sales/pipeline', '/sales/customers', '/sales/leads', '/sales/orders'],

  escalations: [
    {
      key: 'sales_customer_dormant',
      label: 'Pelanggan dormant',
      async list(entityId, { departmentId }) {
        if (!(await transactionsReliable(entityId))) return [];
        // Late = days past the "aktif" line. At 14+ days late the customer is
        // close to becoming Lost, which the shared severity rule marks high.
        const s = scope(departmentId, 'c.department_id');
        const { customers } = await factsForEntity(entityId);
        const [rows] = await pool.query(
          `SELECT c.id, c.name, c.customer_code, c.channel, c.sales_person_name,
                  c.department_id, d.name AS department_name,
                  DATE_ADD(c.last_order_date, INTERVAL ${ACTIVE_DAYS} DAY) AS dormant_since,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) - ${ACTIVE_DAYS} AS days_late
             FROM ${customers} c
             LEFT JOIN departments d ON d.id = c.department_id
            WHERE c.entity_id = ?${s.sql}
              AND c.deleted_at IS NULL
              AND DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) BETWEEN ${ACTIVE_DAYS} AND ${LOST_DAYS - 1}
            ORDER BY days_late DESC, c.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.name,
          reference: row.customer_code,
          context: `Belum order ${int(row.days_late) + ACTIVE_DAYS} hari${row.channel ? ` — ${row.channel}` : ''}. Lost di ${LOST_DAYS} hari.`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.sales_person_name,
          daysLate: row.days_late,
          since: row.dormant_since,
          link: `/sales/customers/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM sales_customers WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [id]
        );
        return located(row);
      },
    },
    {
      key: 'sales_invoice_overdue',
      label: 'Tagihan terlambat > 30 hari',
      async list(entityId, { departmentId }) {
        if (!(await transactionsReliable(entityId))) return [];
        if ((await factsForEntity(entityId)).accurate) return []; // see sales_accurate_invoice_overdue
        // Late = days past the due date; only invoices 30+ days late reach
        // management — earlier ones are the salesperson's own follow-up.
        const s = scope(departmentId, 'o.department_id');
        const [rows] = await pool.query(
          `SELECT o.id, o.invoice_numbers, o.order_number, o.customer_name, o.sales_person_name, o.outstanding_amount,
                  o.department_id, d.name AS department_name, o.due_date,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), o.due_date) AS days_late
             FROM sales_orders o
             LEFT JOIN departments d ON d.id = o.department_id
            WHERE o.entity_id = ?${s.sql}
              AND o.deleted_at IS NULL
              AND o.outstanding_amount > 0
              AND o.due_date <= DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${INVOICE_LATE_DAYS} DAY)
            ORDER BY days_late DESC, o.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.customer_name,
          reference: row.invoice_numbers || row.order_number,
          context: `Sisa tagihan Rp ${Math.round(num(row.outstanding_amount) || 0).toLocaleString('id-ID')}`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.sales_person_name,
          daysLate: row.days_late,
          since: row.due_date,
          link: `/sales/orders/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM sales_orders WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [id]
        );
        return located(row);
      },
    },
    {
      // Tahap B: the same rule on approved Accurate invoices. A separate key, so
      // an Accurate invoice id is never looked up as one of the app's orders.
      key: 'sales_accurate_invoice_overdue',
      label: 'Faktur terlambat > 30 hari',
      async list(entityId, { departmentId }) {
        if (!(await transactionsReliable(entityId))) return [];
        if (!(await factsForEntity(entityId)).accurate) return [];
        const s = scope(departmentId, 'i.department_id');
        const [rows] = await pool.query(
          `SELECT i.id, i.invoice_number, i.customer_id, i.customer_name, i.sales_person_name, i.outstanding_amount,
                  i.department_id, d.name AS department_name, i.due_date,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.due_date) AS days_late
             FROM sales_invoices_accurate i
             LEFT JOIN departments d ON d.id = i.department_id
            WHERE i.entity_id = ?${s.sql}
              AND ${openReceivableSql('i')}
              AND i.due_date <= DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${INVOICE_LATE_DAYS} DAY)
            ORDER BY days_late DESC, i.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.customer_name,
          reference: row.invoice_number,
          context: `Sisa tagihan Rp ${Math.round(num(row.outstanding_amount) || 0).toLocaleString('id-ID')}`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.sales_person_name,
          daysLate: row.days_late,
          since: row.due_date,
          link: row.customer_id ? `/sales/customers/${row.customer_id}` : '/sales/orders?tab=invoice&status=overdue&periode=all',
        }));
      },
      // An Accurate id: unique per Accurate database only, so bound to the company.
      async locate(id, { entityId } = {}) {
        const e = entityId == null ? { sql: '', args: [] } : { sql: ' AND entity_id = ?', args: [Number(entityId)] };
        const [[row]] = await pool.query(`SELECT entity_id, department_id FROM sales_invoices_accurate WHERE id = ?${e.sql} LIMIT 1`, [id, ...e.args]);
        return located(row);
      },
    },
    {
      // Program 2.3: a credit invoice still owed and not handed over (tukar
      // faktur) a week after its date. Recent invoices only; the older backlog
      // is followed in "Umur piutang".
      key: 'sales_invoice_not_exchanged',
      label: 'Faktur belum tukar faktur',
      async list(entityId, { departmentId }) {
        if (!(await transactionsReliable(entityId))) return [];
        if (!(await factsForEntity(entityId)).accurate) return [];
        const s = scope(departmentId, 'i.department_id');
        const [rows] = await pool.query(
          `SELECT i.id, i.invoice_number, i.customer_id, i.customer_name, i.sales_person_name,
                  i.department_id, d.name AS department_name, i.trans_date,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), i.trans_date) - ${exchanges.EXCHANGE_AFTER_DAYS} AS days_late
             FROM sales_invoices_accurate i
             LEFT JOIN departments d ON d.id = i.department_id
             LEFT JOIN sales_invoice_exchanges x ON x.entity_id = i.entity_id AND x.live_invoice = i.invoice_number COLLATE utf8mb4_unicode_ci
            WHERE i.entity_id = ?${s.sql}
              AND ${exchanges.CREDIT} AND i.outstanding_amount > 0 AND x.id IS NULL
              AND i.trans_date <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${exchanges.EXCHANGE_AFTER_DAYS} DAY
              AND i.trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL ${exchanges.EXCHANGE_WINDOW_DAYS} DAY
            ORDER BY days_late DESC, i.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.customer_name,
          reference: row.invoice_number,
          context: 'Faktur kredit belum ditukar ke customer',
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.sales_person_name,
          daysLate: row.days_late,
          since: row.trans_date,
          link: `/sales/orders?tab=exchange&q=${encodeURIComponent(row.invoice_number)}`,
        }));
      },
      async locate(id, { entityId } = {}) {
        const e = entityId == null ? { sql: '', args: [] } : { sql: ' AND entity_id = ?', args: [Number(entityId)] };
        const [[row]] = await pool.query(`SELECT entity_id, department_id FROM sales_invoices_accurate WHERE id = ?${e.sql} LIMIT 1`, [id, ...e.args]);
        return located(row);
      },
    },
  ],

  metrics: [
    {
      key: 'sales_revenue',
      label: 'Omzet (sebelum PPN)',
      unit: 'rupiah',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // Retail Commerce's share is billed once a month (marketplace recap).
      billedMonthly: BILLED_MONTHLY_DIVISIONS,
      async actuals(entityId, period, { departmentId }) {
        const rows = await ordersInPeriod(entityId, period, departmentId);
        return byDepartment(rows, (r) => num(r.revenue) ?? 0);
      },
    },
    {
      key: 'sales_orders',
      label: 'Jumlah sales order',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // Retail Commerce's share is billed once a month (marketplace recap).
      billedMonthly: BILLED_MONTHLY_DIVISIONS,
      async actuals(entityId, period, { departmentId }) {
        const rows = await ordersInPeriod(entityId, period, departmentId);
        return byDepartment(rows, (r) => int(r.orders));
      },
    },
    {
      key: 'sales_new_customers',
      label: 'Pelanggan baru (NOO)',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // With Accurate: per Accurate customer (customer number) from the invoices,
      // in the division of its first order (sales_customer_orders_accurate,
      // migration 125) — the same count as the Sales overview and Marketing.
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'c.department_id');
        const { accurate, customers } = await factsForEntity(entityId);
        const [rows] = await pool.query(
          `SELECT c.department_id, COUNT(*) AS n
             FROM ${accurate ? 'sales_customer_orders_accurate' : customers} c
            WHERE c.entity_id = ?${s.sql}${accurate ? '' : `
              AND c.deleted_at IS NULL`}
              AND c.noo_date BETWEEN ? AND ?
            GROUP BY c.department_id`,
          [entityId, ...s.args, period.start, period.end]
        );
        return byDepartment(rows, (r) => int(r.n));
      },
    },
  ],

  kpis: [
    {
      key: 'active_customers',
      label: 'Pelanggan aktif',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'c.department_id');
        const { customers } = await factsForEntity(entityId);
        const [[row]] = await pool.query(
          `SELECT SUM(x.s = 'aktif') AS aktif, SUM(x.s = 'dormant') AS dormant, SUM(x.s = 'lost') AS lost
             FROM (SELECT ${statusSql('c')} AS s FROM ${customers} c
                    WHERE c.entity_id = ?${s.sql} AND c.deleted_at IS NULL) x`,
          [entityId, ...s.args]
        );
        const dormant = int(row?.dormant);
        return marked(entityId, {
          value: int(row?.aktif),
          sub: `${dormant} dormant, ${int(row?.lost)} lost`,
          alert: dormant > 0,
        });
      },
    },
    {
      key: 'revenue_this_month',
      label: 'Omzet bulan ini (sebelum PPN)',
      unit: 'rupiah',
      async value(entityId, { departmentId }) {
        if ((await factsForEntity(entityId)).accurate) {
          const si = scope(departmentId, 'i.department_id');
          const sd = scope(departmentId, 'd.department_id');
          // A division billed once a month (Retail Commerce: one marketplace recap
          // dated the month's last day) has nothing billed yet in a running
          // month: show the last complete month instead, and say so.
          const monthly = departmentId != null && await billedMonthlyDivision(departmentId);
          const from = monthly
            ? "DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01') - INTERVAL 1 MONTH"
            : "DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01')";
          const to = monthly
            ? "DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01') - INTERVAL 1 DAY"
            : 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
          const [[inv]] = await pool.query(
            `SELECT (SELECT COUNT(*) FROM sales_invoices_accurate d
                      WHERE d.entity_id = ?${sd.sql} AND d.is_dp
                        AND d.trans_date >= ${from} AND d.trans_date <= ${to}) AS dp,
                    COALESCE(SUM(i.kind = 'invoice'), 0) AS invoices, COALESCE(SUM(i.amount), 0) AS revenue,
                    DATE_FORMAT(${from}, '%Y-%m') AS month
               FROM sales_revenue_accurate i
              WHERE i.entity_id = ?${si.sql}
                AND i.trans_date >= ${from} AND i.trans_date <= ${to}`,
            [entityId, ...sd.args, entityId, ...si.args]
          );
          // Down-payment invoices are left out of revenue (Finance decision); say how many.
          const dp = int(inv?.dp);
          const sub = `${monthly ? `${monthLabel(inv?.month)} (ditagih bulanan, bulan berjalan belum ditagih) · ` : ''}`
            + `${int(inv?.invoices)} faktur · sebelum PPN, bersih retur${dp ? ` · ${dp} faktur uang muka tidak dihitung` : ''}`;
          return marked(entityId, { value: num(inv?.revenue) ?? 0, sub, alert: false, ...(monthly ? { billedMonthly: true } : {}) });
        }
        const s = scope(departmentId, 'o.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS orders, COALESCE(SUM(o.dpp_amount), 0) AS revenue
             FROM sales_orders o
            WHERE o.entity_id = ?${s.sql}
              AND o.deleted_at IS NULL
              AND o.transaction_date >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01')
              AND o.transaction_date <= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)`,
          [entityId, ...s.args]
        );
        return marked(entityId, { value: num(row?.revenue) ?? 0, sub: `${int(row?.orders)} sales order · sebelum PPN`, alert: false });
      },
    },
    {
      key: 'overdue_invoices',
      label: 'Tagihan terlambat',
      unit: 'rupiah',
      async value(entityId, { departmentId }) {
        if ((await factsForEntity(entityId)).accurate) {
          const si = scope(departmentId, 'i.department_id');
          const [[inv]] = await pool.query(
            `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.outstanding_amount), 0) AS amount
               FROM sales_invoices_accurate i
              WHERE i.entity_id = ?${si.sql} AND ${openReceivableSql('i')} AND i.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)`,
            [entityId, ...si.args]
          );
          const n = int(inv?.invoices);
          return marked(entityId, { value: num(inv?.amount) ?? 0, sub: `${n} faktur lewat jatuh tempo`, alert: n > 0 });
        }
        const s = scope(departmentId, 'o.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS invoices, COALESCE(SUM(o.outstanding_amount), 0) AS amount
             FROM sales_orders o
            WHERE o.entity_id = ?${s.sql} AND o.deleted_at IS NULL
              AND o.outstanding_amount > 0 AND o.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)`,
          [entityId, ...s.args]
        );
        const invoices = int(row?.invoices);
        return marked(entityId, { value: num(row?.amount) ?? 0, sub: `${invoices} invoice lewat jatuh tempo`, alert: invoices > 0 });
      },
    },
    // Prospects going cold are a KPI, not an escalation: canvassing visits many
    // outlets once, so a list of every unvisited prospect would bury the other
    // divisions' escalations. The Leads page lists them for the Sales team.
    {
      key: 'open_leads',
      label: 'Prospek belum order',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'l.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS open_count,
                  SUM(l.last_visit_date <= DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${LEAD_FOLLOWUP_DAYS} DAY)) AS cold
             FROM sales_leads l
            WHERE l.entity_id = ?${s.sql}
              AND l.deleted_at IS NULL AND l.customer_id IS NULL AND l.status = 'open'`,
          [entityId, ...s.args]
        );
        const cold = int(row?.cold);
        return { value: int(row?.open_count), sub: `${cold} belum dikunjungi ulang ${LEAD_FOLLOWUP_DAYS}+ hari`, alert: cold > 0 };
      },
    },
  ],
};

module.exports.LEAD_FOLLOWUP_DAYS = LEAD_FOLLOWUP_DAYS;
module.exports.INVOICE_LATE_DAYS = INVOICE_LATE_DAYS;
