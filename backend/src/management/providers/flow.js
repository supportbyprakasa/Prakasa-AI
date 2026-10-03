const pool = require('../../db/pool');
const salesSource = require('../../services/salesSource');
const rules = require('../../services/flowRules');
const {
  MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment, grouping,
} = require('../helpers');

// Alur lintas divisi (program 3.3, Management): the order-to-cash flow from
// approved Accurate data (mg_sales_flow_accurate, migration 100), reported to
// Pusat Eskalasi, Target & realisasi and the Management Dashboard. The page
// itself (/management/flow) is served by managementFlow.service.
//
// Deliberately NOT here (one escalation per event):
//   - an SO late to ship: warehouse_so_late (providers/warehouse.js, the
//     Warehouse promise of migration 099) — the only late-SO escalation;
//   - an overdue faktur: sales_accurate_invoice_overdue (providers/sales.js);
//   - a late PO: procurement_po_late (providers/procurement.js).
// No margin, purchase price or stock value is reported here: those stay on the
// page, for the Management Office only.
//
// While Sales transactions are recorded in the app (SALES_TRANSACTION_SOURCE =
// app), the Accurate SOs are not the source of truth: nothing is reported. Held
// in JS, without a query; before the first approved Sales batch the mirror is
// empty, so every capability reads nothing.
const held = () => salesSource.transactionSource() !== 'accurate';
const TODAY = rules.TODAY;
// The SO's surat jalan on Data Sales: the list finds a surat jalan by its SO
// number, and "3 bulan terakhir" reaches back past BILL_WINDOW_DAYS (the page
// opens on this month, where a surat jalan of late last month is missing).
const doLink = (soNumber) => `/sales/orders?tab=do&periode=last_3_months&q=${encodeURIComponent(soNumber || '')}`;
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

function located(row) {
  return row
    ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
    : null;
}

async function daysToPayRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'i.department_id');
  const g = grouping('i.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, COUNT(*) AS n, AVG(GREATEST(DATEDIFF(p.last_paid_on, i.trans_date), 0)) AS days
       FROM sales_invoices_accurate i
       JOIN mg_invoice_payments_accurate p ON p.entity_id = i.entity_id AND p.invoice_number = i.invoice_number
      WHERE i.entity_id = ?${s.sql} AND NOT i.is_dp AND i.outstanding_amount = 0 AND p.last_paid_on BETWEEN ? AND ?
      ${g.group}`,
    [entityId, ...s.args, period.start, period.end],
  );
  return rows;
}

module.exports = {
  key: 'flow',
  label: 'Alur lintas divisi',
  navPaths: ['/management/flow'],

  escalations: [
    {
      // Goods left with a surat jalan, but no faktur BILL_GRACE_DAYS later
      // (Sales Ops) → the SO's own Sales or Retail Commerce division.
      key: 'flow_do_not_invoiced',
      label: 'Surat jalan belum difaktur',
      async list(entityId, { departmentId }) {
        if (held()) return [];
        const s = scope(departmentId, 'f.department_id');
        const [rows] = await pool.query(
          `SELECT f.so_id, f.so_number, f.customer_name, f.delivered_on, f.department_id, d.name AS department_name,
                  f.delivered_on + INTERVAL ${rules.BILL_GRACE_DAYS} DAY AS due_on,
                  DATEDIFF(${TODAY}, f.delivered_on) - ${rules.BILL_GRACE_DAYS} AS days_late
             FROM mg_sales_flow_accurate f
             LEFT JOIN departments d ON d.id = f.department_id
            WHERE f.entity_id = ?${s.sql} AND ${rules.notBilledRecentSql('f')}
            ORDER BY days_late DESC, f.so_id
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args],
        );
        return rows.map((row) => escalationItem({
          sourceId: row.so_id,
          title: `${row.so_number} · ${row.customer_name || '-'}`,
          reference: row.so_number,
          context: `Surat jalan ${dateOnly(row.delivered_on)} sudah dikirim, faktur belum dibuat di Accurate`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.due_on,
          link: doLink(row.so_number),
        }));
      },
      // An Accurate id: unique per Accurate database only, so bound to the company.
      async locate(id, { entityId } = {}) {
        const e = entityId == null ? { sql: '', args: [] } : { sql: ' AND entity_id = ?', args: [Number(entityId)] };
        const [[row]] = await pool.query(
          `SELECT entity_id, department_id FROM sales_so_accurate WHERE id = ?${e.sql} LIMIT 1`,
          [Number(id), ...e.args],
        );
        return located(row);
      },
    },
  ],

  metrics: [
    {
      // Days from faktur to fully paid (the last approved penerimaan), for the
      // fakturs settled in the period. Only paid fakturs count: the unpaid tail
      // is "Tagihan terlambat" and Umur piutang.
      key: 'flow_days_to_pay',
      label: 'Hari faktur sampai lunas',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        if (held()) return new Map();
        const rows = await daysToPayRows(entityId, period, departmentId, false);
        return byDepartment(rows.filter((r) => int(r.n) > 0), (r) => round1(num(r.days) ?? 0));
      },
      // Company-wide: the average over every paid faktur (exact).
      async entityActuals(entityId, period) {
        if (held()) return null;
        const [row] = await daysToPayRows(entityId, period, null, true);
        return row && int(row.n) > 0 ? round1(num(row.days) ?? 0) : null;
      },
    },
  ],

  kpis: [
    {
      // The billing half of "pesanan tertahan"; the shipping half is Warehouse's
      // (warehouse_so_otif_month counts and alerts on SOs past their promise).
      key: 'flow_orders_stuck',
      label: 'Surat jalan belum difaktur',
      unit: 'item',
      async value(entityId, { departmentId }) {
        if (held()) return { value: null, sub: 'Transaksi Sales dicatat di aplikasi', alert: false };
        const s = scope(departmentId, 'f.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total, COALESCE(SUM(${rules.notBilledRecentSql('f')}), 0) AS bill
             FROM mg_sales_flow_accurate f WHERE f.entity_id = ?${s.sql}`,
          [entityId, ...s.args],
        );
        if (!int(row?.total)) {
          return { value: null, sub: departmentId == null ? 'Menunggu data Sales dari Accurate' : 'Tidak ada SO Accurate untuk divisi ini', alert: false };
        }
        const bill = int(row.bill);
        return { value: bill, sub: `lebih dari ${rules.BILL_GRACE_DAYS} hari tanpa faktur · telat kirim: lihat Warehouse`, alert: bill > 0 };
      },
    },
    {
      key: 'flow_order_to_cash',
      label: 'Pesanan sampai lunas (median)',
      unit: 'hari',
      async value(entityId, { departmentId }) {
        if (held()) return { value: null, sub: 'Transaksi Sales dicatat di aplikasi', alert: false };
        const s = scope(departmentId, 'f.department_id');
        const [rows] = await pool.query(
          `SELECT DATEDIFF(f.paid_on, f.ordered_on) AS order_days, DATEDIFF(f.paid_on, f.billed_on) AS pay_days
             FROM mg_sales_flow_accurate f
            WHERE f.entity_id = ?${s.sql} AND f.stage = 'paid' AND f.paid_on >= ${TODAY} - INTERVAL ${rules.PAID_WINDOW_DAYS} DAY`,
          [entityId, ...s.args],
        );
        const order = rules.stepStats(rows.map((r) => r.order_days));
        const pay = rules.stepStats(rows.map((r) => r.pay_days));
        if (!order.count) return { value: null, sub: `Belum ada SO lunas ${rules.PAID_WINDOW_DAYS} hari terakhir`, alert: false };
        return {
          value: order.medianDays,
          sub: `${order.count} SO lunas ${rules.PAID_WINDOW_DAYS} hari terakhir · faktur→lunas rata-rata ${String(pay.avgDays ?? 0).replace('.', ',')} hari`,
          alert: false,
        };
      },
    },
  ],
};
