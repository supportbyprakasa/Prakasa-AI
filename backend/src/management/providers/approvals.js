const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment } = require('../helpers');

// Approvals are cross-division: warehouse movements, payment requests, HR and
// document approvals all run through approval_requests, attributed to the
// division on the request.

// An approval still waiting after this long has missed its normal turnaround.
const AGED_DAYS = 3;
const WAITING = "('pending', 'revision_requested')";
// Data Accurate batches are approval requests as well, but they have their own
// escalation (providers/accurate.js, after one day), so they are not listed twice.
// Requests without a request_type (older HRGA/Finance flows) stay in: in SQL,
// NULL NOT IN (...) is never true, hence the explicit IS NULL.
const OWN_ESCALATION = ['sales_accurate_sync'];

module.exports = {
  OWN_ESCALATION,
  key: 'approvals',
  label: 'Approval',
  // The approval inbox itself is retired from the menu; approvals surface
  // inside each module (Warehouse, Finance…) and here in management.
  navPaths: [],

  escalations: [
    {
      key: 'approval_aged',
      label: 'Approval menumpuk',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'a.department_id');
        const [rows] = await pool.query(
          `SELECT a.id, a.title, a.status, a.department_id, d.name AS department_name,
                  u.name AS owner_name, a.created_at,
                  DATEDIFF(UTC_TIMESTAMP() + INTERVAL 7 HOUR, a.created_at + INTERVAL 7 HOUR) AS days_late
             FROM approval_requests a
             LEFT JOIN departments d ON d.id = a.department_id
             LEFT JOIN users u ON u.id = a.requested_by
            WHERE a.entity_id = ?${s.sql}
              AND a.status IN ${WAITING}
              AND (a.request_type IS NULL OR a.request_type NOT IN (?))
              AND a.created_at < DATE_SUB(NOW(), INTERVAL ${AGED_DAYS} DAY)
            ORDER BY days_late DESC, a.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args, OWN_ESCALATION]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.title,
          context: row.status === 'revision_requested' ? 'Menunggu revisi' : 'Menunggu keputusan',
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.created_at,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query('SELECT entity_id, department_id FROM approval_requests WHERE id = ? LIMIT 1', [id]);
        return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
      },
    },
  ],

  metrics: [
    {
      key: 'approval_days',
      label: 'Rata-rata waktu approval',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'a.department_id');
        const [rows] = await pool.query(
          `SELECT a.department_id, AVG(TIMESTAMPDIFF(HOUR, a.created_at, a.decided_at)) / 24 AS avg_days
             FROM approval_requests a
            WHERE a.entity_id = ?${s.sql}
              AND a.department_id IS NOT NULL
              AND a.decided_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
            GROUP BY a.department_id`,
          [entityId, ...s.args, period.start, `${period.end} 23:59:59`]
        );
        return byDepartment(rows, (r) => (num(r.avg_days) == null ? null : round1(num(r.avg_days))));
      },
    },
  ],

  kpis: [
    {
      key: 'pending',
      label: 'Approval menunggu',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'a.department_id');
        const [[row]] = await pool.query(
          `SELECT SUM(a.status IN ${WAITING}) AS pending,
                  SUM(a.status IN ${WAITING} AND a.created_at < DATE_SUB(NOW(), INTERVAL ${AGED_DAYS} DAY)) AS aged
             FROM approval_requests a
            WHERE a.entity_id = ?${s.sql}
              AND (a.request_type IS NULL OR a.request_type NOT IN (?))`,
          [entityId, ...s.args, OWN_ESCALATION]
        );
        const aged = int(row?.aged);
        return { value: int(row?.pending), sub: `${aged} lebih dari ${AGED_DAYS} hari`, alert: aged > 0 };
      },
    },
  ],
};

module.exports.AGED_DAYS = AGED_DAYS;
