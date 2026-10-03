const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment } = require('../helpers');

// Finance: payment requests and reimbursements (finance_workflows).
//
// Division: finance_workflows.department_id is the REQUESTING division — the
// requester sets it on create and submitForApproval copies it onto the
// approval_requests row. There is no separate "processing division" column
// (Finance processes every request), so a division Head sees the payment
// requests their own division raised, exactly as the approvals provider
// attributes the same requests. Every query below filters on it in SQL.
const DEPT = 'f.department_id';

// What "waiting for a decision" looks like is NOT reported here: a submitted
// request creates an approval_requests row, and the approvals provider already
// escalates it (approval_aged), measures it (approval_days) and counts it
// (KPI pending). The escalations below start only once the decision is made.

// The date the payee was promised: the invoice due date, else the payment date
// the requester asked for.
const DEADLINE = 'COALESCE(f.due_date, f.requested_payment_date)';
// Approved or being processed = the money is committed but has not left yet.
const UNPAID = "('approved', 'processing')";
// Amounts are rupiah; a request in another currency is counted but not summed.
const IDR = "COALESCE(f.currency, 'IDR') = 'IDR'";
// Payment amounts are Finance figures: a KPI or metric that shows rupiah is
// computed only for callers holding finance.view (contract.js permission). An
// escalation text cannot be gated, so it never carries the amount.
const MONEY_PERMISSION = 'finance.view';

// A due date is a promise to the payee: one day past it is already late.
const PAYMENT_GRACE_DAYS = 0;
// Approved without any date: one weekly payment run is the longest it should wait.
const UNDATED_PAYMENT_DAYS = 7;
// Applying a decided approval to the request is one click; a day is ample.
const APPLY_DECISION_DAYS = 1;

const STATUS_LABEL = {
  approved: 'Disetujui, belum dibayar',
  processing: 'Sedang diproses, belum dibayar',
  pending_approval: 'Keputusan approval belum diterapkan',
};

const rupiahFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const rupiah = (value) => `Rp ${rupiahFormat.format(num(value) || 0)}`;

const located = (row) => (row
  ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
  : null);

async function locateRequest(id) {
  const [[row]] = await pool.query(
    'SELECT f.entity_id, f.department_id FROM finance_workflows f WHERE f.id = ? AND f.deleted_at IS NULL LIMIT 1',
    [id]
  );
  return located(row);
}

// One source of Pusat Eskalasi. `condition` decides what is late, `lateExpr`
// how many days, `since` from when; all three are fixed SQL, never user input.
async function lateRequests(entityId, departmentId, { condition, lateExpr, since }) {
  const s = scope(departmentId, DEPT);
  const [rows] = await pool.query(
    `SELECT f.id, f.title, f.request_number, f.status, f.total_amount, f.currency, f.payee_name,
            f.department_id, d.name AS department_name, pic.name AS owner_name,
            ${lateExpr} AS days_late, ${since} AS since
       FROM finance_workflows f
       LEFT JOIN approval_requests a ON a.id = f.approval_request_id
       LEFT JOIN departments d ON d.id = f.department_id
       LEFT JOIN users pic ON pic.id = f.finance_pic_user_id
      WHERE f.entity_id = ?${s.sql}
        AND f.deleted_at IS NULL
        AND ${condition}
      ORDER BY days_late DESC, f.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args]
  );
  return rows.map((row) => {
    return escalationItem({
      sourceId: row.id,
      title: row.title,
      reference: row.request_number,
      context: [STATUS_LABEL[row.status] || row.status, row.payee_name].filter(Boolean).join(' · '),
      departmentId: row.department_id,
      departmentName: row.department_name,
      ownerName: row.owner_name,
      daysLate: row.days_late,
      since: row.since,
      link: `/finance/payment-requests/${row.id}`,
    });
  });
}

// Payments made in a period, per requesting division.
async function paidInPeriod(entityId, period, departmentId) {
  const s = scope(departmentId, DEPT);
  const [rows] = await pool.query(
    `SELECT f.department_id,
            COALESCE(SUM(CASE WHEN ${IDR} THEN f.total_amount ELSE 0 END), 0) AS paid_amount,
            SUM(${DEADLINE} IS NOT NULL) AS with_deadline,
            SUM(${DEADLINE} IS NOT NULL AND DATE(f.paid_at + INTERVAL 7 HOUR) <= ${DEADLINE}) AS on_time
       FROM finance_workflows f
      WHERE f.entity_id = ?${s.sql}
        AND f.deleted_at IS NULL
        AND f.status = 'paid'
        AND f.paid_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
      GROUP BY f.department_id`,
    [entityId, ...s.args, period.start, `${period.end} 23:59:59`]
  );
  return rows;
}

// The Finance numbers the old Management Dashboard showed, with two fixes:
//  - paid_this_month also checks the YEAR (it used to count the same month of every year);
//  - pending_amount sums only requests waiting for approval (it used to sum
//    total_amount of every row — drafts, rejected and paid included).
async function financeSummary(entityId, departmentId) {
  const s = scope(departmentId, DEPT);
  const [[row]] = await pool.query(
    `SELECT SUM(f.status = 'pending_approval') AS pending,
            COALESCE(SUM(CASE WHEN f.status = 'pending_approval' AND ${IDR} THEN f.total_amount ELSE 0 END), 0) AS pending_amount,
            SUM(f.status = 'approved') AS approved,
            COALESCE(SUM(CASE WHEN f.status = 'approved' AND ${IDR} THEN f.total_amount ELSE 0 END), 0) AS approved_amount,
            SUM(f.status = 'approved' AND ${DEADLINE} < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS approved_overdue,
            SUM(f.status = 'paid' AND DATE_FORMAT(f.paid_at + INTERVAL 7 HOUR, '%Y-%m') = DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m')) AS paid_this_month,
            COALESCE(SUM(CASE WHEN f.status = 'paid' AND DATE_FORMAT(f.paid_at + INTERVAL 7 HOUR, '%Y-%m') = DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m') AND ${IDR}
                              THEN f.total_amount ELSE 0 END), 0) AS paid_this_month_amount
       FROM finance_workflows f
      WHERE f.entity_id = ?${s.sql}
        AND f.deleted_at IS NULL`,
    [entityId, ...s.args]
  );
  return row || {};
}

module.exports = {
  key: 'finance',
  label: 'Finance',
  navPaths: ['/finance/payment-requests'],

  escalations: [
    {
      key: 'finance_payment_overdue',
      label: 'Pembayaran lewat jatuh tempo',
      list: (entityId, { departmentId }) => lateRequests(entityId, departmentId, {
        condition: `f.status IN ${UNPAID} AND ${DEADLINE} IS NOT NULL
                    AND ${DEADLINE} < DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${PAYMENT_GRACE_DAYS} DAY)`,
        lateExpr: `DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${DEADLINE})`,
        since: DEADLINE,
      }),
      locate: locateRequest,
    },
    {
      // No due date to be late against, so the clock is the approval decision
      // (or the last change to the request, when the decision time is unknown).
      key: 'finance_payment_undated',
      label: 'Disetujui tanpa tanggal, belum dibayar',
      list: (entityId, { departmentId }) => lateRequests(entityId, departmentId, {
        condition: `f.status IN ${UNPAID} AND ${DEADLINE} IS NULL
                    AND COALESCE(a.decided_at, f.updated_at) < DATE_SUB(NOW(), INTERVAL ${UNDATED_PAYMENT_DAYS} DAY)`,
        lateExpr: 'DATEDIFF(UTC_TIMESTAMP() + INTERVAL 7 HOUR, COALESCE(a.decided_at, f.updated_at) + INTERVAL 7 HOUR)',
        since: 'COALESCE(a.decided_at, f.updated_at)',
      }),
      locate: locateRequest,
    },
    {
      // The approver has decided, but Finance never applied it: the approvals
      // provider no longer reports it (it is decided), yet the request still
      // reads "menunggu approval". Only approved/rejected — a revision request
      // is still waiting and stays with the approvals provider.
      key: 'finance_decision_unapplied',
      label: 'Keputusan approval belum diterapkan',
      list: (entityId, { departmentId }) => lateRequests(entityId, departmentId, {
        condition: `f.status = 'pending_approval' AND a.status IN ('approved', 'rejected')
                    AND a.decided_at < DATE_SUB(NOW(), INTERVAL ${APPLY_DECISION_DAYS} DAY)`,
        lateExpr: 'DATEDIFF(UTC_TIMESTAMP() + INTERVAL 7 HOUR, a.decided_at + INTERVAL 7 HOUR)',
        since: 'a.decided_at',
      }),
      locate: locateRequest,
    },
  ],

  metrics: [
    {
      key: 'finance_paid_amount',
      label: 'Nominal dibayar',
      unit: 'rupiah',
      permission: MONEY_PERMISSION,
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await paidInPeriod(entityId, period, departmentId), (r) => num(r.paid_amount) || 0);
      },
    },
    {
      key: 'finance_paid_on_time_rate',
      label: 'Pembayaran tepat waktu',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        // Only payments that had a date to meet; a rate over nothing is unknown, not 0%.
        return byDepartment(await paidInPeriod(entityId, period, departmentId), (r) => {
          const withDeadline = int(r.with_deadline);
          return withDeadline ? round1((int(r.on_time) / withDeadline) * 100) : null;
        });
      },
    },
  ],

  kpis: [
    {
      // Finance's own view of its queue. Not double counted: it is a dashboard
      // number, not an escalation — the aged ones are escalated once, by the
      // approvals provider (approval_aged), so no alert here.
      key: 'finance_pending',
      label: 'Pembayaran menunggu approval',
      unit: 'item',
      permission: MONEY_PERMISSION,
      async value(entityId, { departmentId }) {
        const row = await financeSummary(entityId, departmentId);
        return { value: int(row.pending), sub: `${rupiah(row.pending_amount)} menunggu`, alert: false };
      },
    },
    {
      key: 'finance_approved_unpaid',
      label: 'Disetujui belum dibayar',
      unit: 'item',
      permission: MONEY_PERMISSION,
      async value(entityId, { departmentId }) {
        const row = await financeSummary(entityId, departmentId);
        const approved = int(row.approved);
        const overdue = int(row.approved_overdue);
        const sub = `${rupiah(row.approved_amount)} belum dibayar${overdue ? ` · ${overdue} lewat jatuh tempo` : ''}`;
        return { value: approved, sub, alert: approved > 0 };
      },
    },
    {
      key: 'finance_paid_this_month',
      label: 'Dibayar bulan ini',
      unit: 'item',
      permission: MONEY_PERMISSION,
      async value(entityId, { departmentId }) {
        const row = await financeSummary(entityId, departmentId);
        return { value: int(row.paid_this_month), sub: `${rupiah(row.paid_this_month_amount)} dibayar`, alert: false };
      },
    },
  ],
};

module.exports.PAYMENT_GRACE_DAYS = PAYMENT_GRACE_DAYS;
module.exports.UNDATED_PAYMENT_DAYS = UNDATED_PAYMENT_DAYS;
module.exports.APPLY_DECISION_DAYS = APPLY_DECISION_DAYS;
