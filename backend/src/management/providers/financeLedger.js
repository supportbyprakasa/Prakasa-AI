const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment, grouping } = require('../helpers');
const { TODAY, DUE_SOON_DAYS, OVER_DAYS } = require('../../services/financeAging');
const { NOT_READY } = require('../../services/financePayables.service');
const { openReceivableSql, receivableSql } = require('../../services/invoiceRules');

// Finance — Piutang & utang (read-only reports over approved Accurate data):
//   piutang: the Sales invoices and receipts (sales_invoices_accurate,
//            sales_receipts_accurate). Scoped by the invoice's selling division
//            (Sales / Retail Commerce), exactly as the Sales provider scopes them.
//   utang:   the Finance pull's purchase invoices and payments
//            (fin_purchase_*_accurate). They belong to the Finance division, so
//            another division's scope reads nothing.
//
// Not duplicated here: "Faktur terlambat > 30 hari" is already escalated by the
// Sales provider (sales_accurate_invoice_overdue), and a waiting Finance batch
// by the Accurate provider (accurate_batch_pending).
//
// Rupiah sits only in KPIs and metrics, each behind finance.receivable.view or
// finance.payable.view: a caller without it never runs them. The escalation
// texts carry vendor, invoice number, due date and days — never an amount.
//
// Every query binds the company first, then the division (one statement per capability).

// A due date is a promise to the vendor: one day past it is already late (as finance_payment_overdue).
const PAYABLE_GRACE_DAYS = 0;
const RECEIVABLE_TEXT = 'Hanya untuk yang berwenang melihat piutang';
const PAYABLE_TEXT = 'Hanya untuk yang berwenang melihat utang';
// An open receivable: not a down payment (as the Sales module), money still owed.
const OPEN_AR = openReceivableSql('i');
// Owed to a vendor in rupiah, not a down payment.
const OPEN_AP = "NOT p.is_dp AND p.outstanding_amount > 0 AND p.currency = 'IDR'";
const rupiahFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const rupiah = (value) => `Rp ${rupiahFormat.format(Math.round(num(value) || 0))}`;
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

// The Finance division as the first table of a payables statement (company
// first, then the caller's division): for another division's Head it is empty,
// so nothing is read. `ready`: a Finance batch has been approved at least once.
const financeScope = (departmentId) => `(SELECT d.id AS department_id, d.entity_id,
           EXISTS (SELECT 1 FROM sales_accurate_batches b WHERE b.entity_id = d.entity_id AND b.department_id = d.id AND b.status = 'applied') AS ready
      FROM departments d
     WHERE d.entity_id = ? AND d.code = 'finance' AND d.deleted_at IS NULL${departmentId != null ? ' AND d.id = ?' : ''} LIMIT 1) f`;
const financeArgs = (entityId, departmentId) => [entityId, ...(departmentId != null ? [Number(departmentId)] : [])];

// Of the invoices falling due in the period (up to yesterday), the share still unpaid.
async function overdueShareRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'i.department_id');
  const g = grouping('i.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, 100 * SUM(i.outstanding_amount) / NULLIF(SUM(i.total_amount), 0) AS pct
       FROM sales_invoices_accurate i
      WHERE i.entity_id = ?${s.sql} AND ${receivableSql('i')} AND i.total_amount > 0
        AND i.due_date BETWEEN ? AND LEAST(?, ${TODAY} - INTERVAL 1 DAY)
      ${g.group}`,
    [entityId, ...s.args, period.start, period.end],
  );
  return rows;
}

module.exports = {
  key: 'finance_ledger',
  label: 'Piutang & utang',
  navPaths: ['/finance/receivables', '/finance/payables'],

  escalations: [
    {
      key: 'finance_payable_overdue',
      label: 'Utang pemasok lewat jatuh tempo',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'p.department_id');
        const [rows] = await pool.query(
          `SELECT p.id, p.invoice_number, p.vendor_no, p.vendor_name, p.due_date, p.term_name, p.currency,
                  p.department_id, d.name AS department_name,
                  DATEDIFF(${TODAY}, p.due_date) AS days_late
             FROM fin_purchase_invoices_accurate p
             LEFT JOIN departments d ON d.id = p.department_id
            WHERE p.entity_id = ?${s.sql}
              AND NOT p.is_dp AND p.outstanding_amount > 0
              AND p.due_date < ${TODAY} - INTERVAL ${PAYABLE_GRACE_DAYS} DAY
            ORDER BY days_late DESC, p.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args],
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.vendor_name || row.vendor_no,
          reference: row.invoice_number,
          context: [`Faktur pembelian belum lunas, jatuh tempo ${dateOnly(row.due_date)}`, row.term_name,
            row.currency && row.currency !== 'IDR' ? `mata uang ${row.currency}` : null].filter(Boolean).join(' · '),
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.due_date,
          link: '/finance/payables?tab=overdue',
        }));
      },
      // An Accurate id: unique per Accurate database only, so bound to the company.
      async locate(id, { entityId } = {}) {
        const [[row]] = await pool.query(
          `SELECT entity_id, department_id FROM fin_purchase_invoices_accurate WHERE id = ?${entityId != null ? ' AND entity_id = ?' : ''} LIMIT 1`,
          entityId != null ? [id, Number(entityId)] : [id],
        );
        return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
      },
    },
  ],

  metrics: [
    {
      // Penerimaan from customers in the period (rupiah as received, incl. PPN).
      key: 'finance_collections',
      label: 'Penerimaan pembayaran pelanggan',
      unit: 'rupiah',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      permission: 'finance.receivable.view',
      restrictedText: RECEIVABLE_TEXT,
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'r.department_id');
        const [rows] = await pool.query(
          `SELECT r.department_id, COALESCE(SUM(r.total_amount), 0) AS amount
             FROM sales_receipts_accurate r
            WHERE r.entity_id = ?${s.sql} AND r.trans_date BETWEEN ? AND ?
            GROUP BY r.department_id`,
          [entityId, ...s.args, period.start, period.end],
        );
        return byDepartment(rows, (r) => num(r.amount) || 0);
      },
    },
    {
      // Paid to vendors in the period. Unknown (not 0) until the first Finance batch is approved.
      key: 'finance_payables_paid',
      label: 'Pembayaran utang ke pemasok',
      unit: 'rupiah',
      better: 'higher',
      cumulative: true,
      permission: 'finance.payable.view',
      restrictedText: PAYABLE_TEXT,
      async actuals(entityId, period, { departmentId }) {
        const [rows] = await pool.query(
          `SELECT f.department_id, COALESCE(SUM(y.total_amount), 0) AS amount
             FROM ${financeScope(departmentId)}
             LEFT JOIN fin_purchase_payments_accurate y
               ON y.entity_id = f.entity_id AND y.department_id = f.department_id AND y.currency = 'IDR'
              AND y.trans_date BETWEEN ? AND ?
            WHERE f.ready
            GROUP BY f.department_id`,
          [...financeArgs(entityId, departmentId), period.start, period.end],
        );
        return byDepartment(rows, (r) => num(r.amount) || 0);
      },
    },
    {
      // Of what customers had to pay in the period (invoices falling due, up to
      // yesterday), the share still unpaid today. Lower is better.
      key: 'finance_receivable_overdue_share',
      label: 'Piutang jatuh tempo belum tertagih',
      unit: '%',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const rows = await overdueShareRows(entityId, period, departmentId, false);
        return byDepartment(rows.filter((r) => r.pct !== null), (r) => round1(num(r.pct)));
      },
      // Company-wide: unpaid over billed of all invoices together (exact).
      async entityActuals(entityId, period) {
        const [row] = await overdueShareRows(entityId, period, null, true);
        return row && row.pct !== null ? round1(num(row.pct)) : null;
      },
    },
  ],

  kpis: [
    {
      key: 'receivable_overdue',
      label: 'Piutang terlambat',
      unit: 'rupiah',
      permission: 'finance.receivable.view',
      restrictedText: RECEIVABLE_TEXT,
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'i.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.outstanding_amount), 0) AS amount,
                  COALESCE(SUM(DATEDIFF(${TODAY}, i.due_date) > ${OVER_DAYS}), 0) AS over90
             FROM sales_invoices_accurate i
            WHERE i.entity_id = ?${s.sql} AND ${OPEN_AR} AND i.due_date < ${TODAY}`,
          [entityId, ...s.args],
        );
        const n = int(row?.invoices);
        const over = int(row?.over90);
        return {
          value: num(row?.amount) ?? 0,
          sub: n ? `${n} faktur lewat jatuh tempo${over ? ` · ${over} lebih dari ${OVER_DAYS} hari` : ''}` : 'Tidak ada faktur lewat jatuh tempo',
          alert: n > 0,
        };
      },
    },
    {
      key: 'payable_due_14',
      label: `Utang jatuh tempo ${DUE_SOON_DAYS} hari`,
      unit: 'rupiah',
      permission: 'finance.payable.view',
      restrictedText: PAYABLE_TEXT,
      async value(entityId, { departmentId }) {
        const [[row]] = await pool.query(
          `SELECT f.ready,
                  COALESCE(SUM(p.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY), 0) AS due_invoices,
                  COALESCE(SUM(CASE WHEN p.due_date BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${DUE_SOON_DAYS} DAY THEN p.outstanding_amount END), 0) AS due_amount,
                  COALESCE(SUM(p.due_date < ${TODAY}), 0) AS overdue_invoices,
                  COALESCE(SUM(CASE WHEN p.due_date < ${TODAY} THEN p.outstanding_amount END), 0) AS overdue_amount
             FROM ${financeScope(departmentId)}
             LEFT JOIN fin_purchase_invoices_accurate p
               ON p.entity_id = f.entity_id AND p.department_id = f.department_id AND ${OPEN_AP}
            GROUP BY f.department_id, f.ready`,
          financeArgs(entityId, departmentId),
        );
        if (!row) return { value: null, sub: 'Utang dicatat di divisi Finance', alert: false };
        if (!Number(row.ready)) return { value: null, sub: NOT_READY, alert: false };
        const due = int(row.due_invoices);
        const late = int(row.overdue_invoices);
        const parts = [due ? `${due} faktur pembelian` : 'Tidak ada yang jatuh tempo', late ? `${late} lewat jatuh tempo (${rupiah(row.overdue_amount)})` : null];
        return { value: num(row.due_amount) ?? 0, sub: parts.filter(Boolean).join(' · '), alert: late > 0 };
      },
    },
  ],
};

module.exports.PAYABLE_GRACE_DAYS = PAYABLE_GRACE_DAYS;
