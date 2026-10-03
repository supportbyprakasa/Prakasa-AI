const pool = require('../../db/pool');
const {
  PROJECT_WHERE, MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment,
} = require('../helpers');

// Project Tracker is cross-division: every division runs its projects here, and
// a project belongs to the division set on its board.

// An issue nobody has touched for this long is stuck, not merely slow.
const STALE_DAYS = 14;

async function issueEscalations(entityId, departmentId, kind) {
  const s = scope(departmentId, 'b.department_id');
  const lateExpr = kind === 'overdue' ? 'DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), t.due_date)' : 'DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATE(t.updated_at + INTERVAL 7 HOUR))';
  const condition = kind === 'overdue'
    ? 't.due_date IS NOT NULL AND t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)'
    : `t.updated_at < DATE_SUB(NOW(), INTERVAL ${STALE_DAYS} DAY)`;
  const since = kind === 'overdue' ? 't.due_date' : 't.updated_at';
  const [rows] = await pool.query(
    `SELECT t.id, t.title, b.project_key, t.issue_number, b.name AS project_name,
            b.department_id, d.name AS department_name,
            COALESCE(ua.name, t.assignee_email) AS owner_name,
            ${lateExpr} AS days_late, ${since} AS since
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       LEFT JOIN departments d ON d.id = b.department_id
       LEFT JOIN board_columns c ON c.id = t.column_id
       LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE b.entity_id = ?${s.sql}
        AND ${PROJECT_WHERE}
        AND t.deleted_at IS NULL
        AND COALESCE(c.category, 'todo') <> 'done'
        AND ${condition}
      ORDER BY days_late DESC, t.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args]
  );
  return rows.map((row) => {
    const reference = row.project_key && row.issue_number ? `${row.project_key}-${row.issue_number}` : null;
    return escalationItem({
      sourceId: row.id,
      title: row.title,
      reference,
      context: row.project_name,
      departmentId: row.department_id,
      departmentName: row.department_name,
      ownerName: row.owner_name,
      daysLate: row.days_late,
      since: row.since,
      link: reference ? `/projects/${row.project_key}` : null,
    });
  });
}

async function locateTask(id) {
  const [[row]] = await pool.query(
    'SELECT b.entity_id, b.department_id FROM tasks t JOIN boards b ON b.id = t.board_id WHERE t.id = ? LIMIT 1',
    [id]
  );
  return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
}

async function completedInPeriod(entityId, period, departmentId) {
  const s = scope(departmentId, 'b.department_id');
  const [rows] = await pool.query(
    `SELECT b.department_id,
            COUNT(*) AS completed,
            COALESCE(SUM(t.story_points), 0) AS points,
            SUM(t.due_date IS NOT NULL) AS with_due,
            SUM(t.due_date IS NOT NULL AND DATE(t.completed_at + INTERVAL 7 HOUR) <= t.due_date) AS on_time
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
      WHERE b.entity_id = ? AND ${PROJECT_WHERE}${s.sql}
        AND t.deleted_at IS NULL
        AND t.completed_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
      GROUP BY b.department_id`,
    [entityId, ...s.args, period.start, `${period.end} 23:59:59`]
  );
  return rows;
}

module.exports = {
  key: 'project_tracker',
  label: 'Project Tracker',
  navPaths: ['/projects'],

  escalations: [
    {
      key: 'issue_overdue',
      label: 'Task lewat tenggat',
      list: (entityId, { departmentId }) => issueEscalations(entityId, departmentId, 'overdue'),
      locate: locateTask,
    },
    {
      key: 'issue_stale',
      label: 'Task mandek',
      list: (entityId, { departmentId }) => issueEscalations(entityId, departmentId, 'stale'),
      locate: locateTask,
    },
    {
      key: 'sprint_overdue',
      label: 'Sprint lewat tenggat',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [rows] = await pool.query(
          `SELECT s.id, s.name, s.end_date, b.name AS project_name, b.project_key,
                  b.department_id, d.name AS department_name,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), s.end_date) AS days_late
             FROM tracker_sprints s
             JOIN boards b ON b.id = s.board_id
             LEFT JOIN departments d ON d.id = b.department_id
            WHERE b.entity_id = ?${s.sql}
              AND ${PROJECT_WHERE}
              AND s.status = 'active'
              AND s.end_date IS NOT NULL AND s.end_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
            ORDER BY days_late DESC, s.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.name,
          reference: row.project_key,
          context: row.project_name,
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.end_date,
          link: row.project_key ? `/projects/${row.project_key}` : null,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT b.entity_id, b.department_id FROM tracker_sprints s JOIN boards b ON b.id = s.board_id WHERE s.id = ? LIMIT 1',
          [id]
        );
        return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
      },
    },
  ],

  metrics: [
    {
      key: 'issues_completed',
      label: 'Issue selesai',
      unit: 'issue',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await completedInPeriod(entityId, period, departmentId), (r) => int(r.completed));
      },
    },
    {
      key: 'points_completed',
      label: 'Story point selesai',
      unit: 'poin',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await completedInPeriod(entityId, period, departmentId), (r) => num(r.points) || 0);
      },
    },
    {
      key: 'on_time_rate',
      label: 'Selesai tepat waktu',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        // A rate over nothing is not 0% — it is unknown.
        return byDepartment(await completedInPeriod(entityId, period, departmentId), (r) => {
          const withDue = int(r.with_due);
          return withDue ? round1((int(r.on_time) / withDue) * 100) : null;
        });
      },
    },
    {
      key: 'overdue_open',
      label: 'Issue terlambat',
      unit: 'issue',
      better: 'lower',
      cumulative: false,
      emptyIsZero: true,
      // A state, read as of the period end — or today while it is still running.
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [rows] = await pool.query(
          `SELECT b.department_id, COUNT(*) AS overdue
             FROM tasks t
             JOIN boards b ON b.id = t.board_id
             LEFT JOIN board_columns c ON c.id = t.column_id
            WHERE b.entity_id = ? AND ${PROJECT_WHERE}${s.sql}
              AND t.deleted_at IS NULL
              AND COALESCE(c.category, 'todo') <> 'done'
              AND t.due_date IS NOT NULL
              AND t.due_date < LEAST(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ?)
            GROUP BY b.department_id`,
          [entityId, ...s.args, period.end]
        );
        return byDepartment(rows, (r) => int(r.overdue));
      },
    },
  ],

  kpis: [
    {
      key: 'open_issues',
      label: 'Issue aktif',
      unit: 'issue',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [[row]] = await pool.query(
          `SELECT SUM(COALESCE(c.category, 'todo') <> 'done') AS active,
                  SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue
             FROM tasks t
             JOIN boards b ON b.id = t.board_id
             LEFT JOIN board_columns c ON c.id = t.column_id
            WHERE b.entity_id = ? AND ${PROJECT_WHERE}${s.sql} AND t.deleted_at IS NULL`,
          [entityId, ...s.args]
        );
        const overdue = int(row?.overdue);
        return { value: int(row?.active), sub: `${overdue} terlambat`, alert: overdue > 0 };
      },
    },
  ],
};

module.exports.STALE_DAYS = STALE_DAYS;
