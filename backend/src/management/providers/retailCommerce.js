const pool = require('../../db/pool');
const { int, num, round1, scope, byDepartment } = require('../helpers');
const { numbersFromAccurate } = require('../../services/salesSource');
const rules = require('../../services/warehouseRules');
const { openReceivableSql } = require('../../services/invoiceRules');

// Retail Commerce (marketplaces) reports into management (migration 120).
//
// Every query reads the approved Accurate mirror and is bound to the entity,
// then to the Retail Commerce department in SQL: the department join keeps the
// figures to marketplace rows even company-wide, and scope() narrows to the
// caller's division (a Head of another division gets nothing). Until a Sales or
// RC batch is approved (salesSource) there are no Accurate numbers: metrics
// stay empty and KPIs say why — the same hold as Sales.
//
// The keys are RC's own. Revenue on DPP and order counts per division already
// exist in the Sales provider (sales_revenue, sales_orders, revenue_this_month);
// these measure the marketplace side: marketplace revenue, return rate,
// unpaid marketplace invoices, and SOs not shipped in time.
//
// No escalation: an SO past its shipping promise is already escalated, for
// every SO including the marketplace ones, by the Warehouse provider
// (warehouse_so_late, owner: late delivery → Warehouse). RC sees the same SOs
// here as a KPI and on its page, without a second follow-up of the same event.

const RC = "'retail_commerce'";
const rcJoin = (column) => `JOIN departments rcd ON rcd.id = ${column} AND rcd.code = ${RC} AND rcd.deleted_at IS NULL`;
const MONEY_PERMISSION = ['retail.insight.view', 'sales.order.view'];
const MONEY_RESTRICTED = 'Hanya untuk yang berwenang melihat angka penjualan marketplace';
const NOT_CONNECTED = 'Menunggu batch Accurate Sales/Retail Commerce disetujui';
const MONTH_START = `DATE_FORMAT(${rules.TODAY}, '%Y-%m-01')`;

async function returnRows(entityId, departmentId, startSql, endSql, args = []) {
  const s = scope(departmentId, 'r.department_id');
  const [rows] = await pool.query(
    `SELECT r.department_id,
            COALESCE(SUM(CASE WHEN r.kind = 'invoice' THEN r.amount ELSE 0 END), 0) AS gross,
            COALESCE(SUM(CASE WHEN r.kind = 'return' THEN -r.amount ELSE 0 END), 0) AS returns,
            COALESCE(SUM(r.kind = 'invoice'), 0) AS invoices
       FROM sales_revenue_accurate r
       ${rcJoin('r.department_id')}
      WHERE r.entity_id = ?${s.sql} AND r.trans_date BETWEEN ${startSql} AND ${endSql}
      GROUP BY r.department_id`,
    [entityId, ...s.args, ...args],
  );
  return rows;
}
const rateOf = (r) => (num(r.gross) > 0 ? round1((num(r.returns) / num(r.gross)) * 100) : null);

module.exports = {
  key: 'retail_commerce',
  label: 'Retail Commerce',
  navPaths: ['/retail-commerce'],

  metrics: [
    {
      key: 'rc_marketplace_revenue',
      label: 'Omzet marketplace (sebelum PPN)',
      unit: 'rupiah',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // One recap invoice per marketplace per month, dated its last day.
      billedMonthly: true,
      permission: MONEY_PERMISSION,
      restrictedText: MONEY_RESTRICTED,
      async actuals(entityId, period, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return new Map();
        const s = scope(departmentId, 'r.department_id');
        const [rows] = await pool.query(
          `SELECT r.department_id, COALESCE(SUM(r.amount), 0) AS revenue
             FROM sales_revenue_accurate r
             ${rcJoin('r.department_id')}
            WHERE r.entity_id = ?${s.sql} AND r.trans_date BETWEEN ? AND ?
            GROUP BY r.department_id`,
          [entityId, ...s.args, period.start, period.end],
        );
        return byDepartment(rows, (r) => num(r.revenue) ?? 0);
      },
    },
    {
      key: 'rc_orders',
      label: 'Pesanan marketplace (SO)',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      // Marketplace orders reach Accurate as one recap SO per platform per month.
      billedMonthly: true,
      async actuals(entityId, period, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return new Map();
        const s = scope(departmentId, 'o.department_id');
        const [rows] = await pool.query(
          `SELECT o.department_id, COUNT(*) AS orders
             FROM sales_so_accurate o
             ${rcJoin('o.department_id')}
            WHERE o.entity_id = ?${s.sql} AND o.trans_date BETWEEN ? AND ?
            GROUP BY o.department_id`,
          [entityId, ...s.args, period.start, period.end],
        );
        return byDepartment(rows, (r) => int(r.orders));
      },
    },
    {
      // Returns (DPP) over invoiced DPP in the period. No invoice → unknown, not 0%.
      key: 'rc_return_rate',
      label: 'Rasio retur marketplace',
      unit: '%',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return new Map();
        const rows = await returnRows(entityId, departmentId, '?', '?', [period.start, period.end]);
        return byDepartment(rows, rateOf);
      },
      // Company-wide: returns over invoices of every marketplace row together.
      async entityActuals(entityId, period) {
        if (!(await numbersFromAccurate(entityId))) return null;
        const rows = await returnRows(entityId, null, '?', '?', [period.start, period.end]);
        return rateOf(rows.reduce((a, r) => ({ gross: a.gross + (num(r.gross) || 0), returns: a.returns + (num(r.returns) || 0) }), { gross: 0, returns: 0 }));
      },
    },
  ],

  kpis: [
    {
      key: 'rc_unshipped_orders',
      label: 'SO marketplace lewat janji kirim',
      unit: 'item',
      async value(entityId, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return { value: null, sub: NOT_CONNECTED, alert: false };
        // The selling division owns the SO (sales_department_id); the row's
        // department_id is the Warehouse that ships it.
        const s = scope(departmentId, 'x.sales_department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS open_orders,
                  COALESCE(SUM(${rules.lateSoSql('x')}), 0) AS late_orders
             FROM wh_so_fulfilment_accurate x
             ${rcJoin('x.sales_department_id')}
            WHERE x.entity_id = ?${s.sql} AND x.so_state IN ('open', 'partial')`,
          [entityId, ...s.args],
        );
        const late = int(row?.late_orders);
        return {
          value: late,
          sub: `${int(row?.open_orders)} SO belum terkirim penuh · janji ${rules.SHIP_SLA_DAYS}×24 jam dari tanggal SO · SO rekap bulanan marketplace tidak dihitung`,
          alert: late > 0,
        };
      },
    },
    {
      key: 'rc_return_rate',
      label: 'Rasio retur marketplace bulan ini',
      unit: '%',
      async value(entityId, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return { value: null, sub: NOT_CONNECTED, alert: false };
        const rows = await returnRows(entityId, departmentId, MONTH_START, rules.TODAY);
        const total = rows.reduce((a, r) => ({
          gross: a.gross + (num(r.gross) || 0), returns: a.returns + (num(r.returns) || 0), invoices: a.invoices + int(r.invoices),
        }), { gross: 0, returns: 0, invoices: 0 });
        const rate = rateOf(total);
        if (rate === null) return { value: null, sub: 'Belum ada faktur marketplace bulan ini', alert: false };
        return { value: rate, sub: `${total.invoices} faktur · dihitung dari nilai sebelum PPN`, alert: false };
      },
    },
    {
      key: 'rc_marketplace_unpaid',
      label: 'Piutang marketplace belum cair',
      unit: 'rupiah',
      permission: MONEY_PERMISSION,
      restrictedText: MONEY_RESTRICTED,
      async value(entityId, { departmentId }) {
        if (!(await numbersFromAccurate(entityId))) return { value: null, sub: NOT_CONNECTED, alert: false };
        const s = scope(departmentId, 'i.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.outstanding_amount), 0) AS amount,
                  COALESCE(SUM(i.due_date < ${rules.TODAY}), 0) AS overdue
             FROM sales_invoices_accurate i
             ${rcJoin('i.department_id')}
            WHERE i.entity_id = ?${s.sql} AND ${openReceivableSql('i')}`,
          [entityId, ...s.args],
        );
        const overdue = int(row?.overdue);
        return {
          value: num(row?.amount) ?? 0,
          sub: `${int(row?.invoices)} faktur · ${overdue} lewat jatuh tempo`,
          alert: overdue > 0,
        };
      },
    },
  ],
};
