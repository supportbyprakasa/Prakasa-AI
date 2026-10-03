const pool = require('../db/pool');
const tracker = require('./tracker.service');
const trackerChat = require('./trackerChat.service');
const M = require('./trackerModel');
const { wibClock } = require('../utils/wibTime');

// Reports for one project (members only) and the entity-wide read-only view
// for the management dashboard (aggregates + titles, never issue bodies).

const MAX_BURNDOWN_DAYS = 92;
const VELOCITY_SPRINTS = 5;
const round1 = (n) => Math.round(Number(n || 0) * 10) / 10;

function daysBetween(start, end) {
  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && days.length < MAX_BURNDOWN_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// Pure: issues = [{ points, doneDay|null }]. Remaining counts an issue until the
// end of the day it was completed; days after `today` have no actual values.
function computeBurndown({ start, end, today, issues }) {
  const days = daysBetween(start, end);
  const totalPoints = issues.reduce((sum, i) => sum + Number(i.points || 0), 0);
  const steps = Math.max(days.length - 1, 1);
  return days.map((date, index) => {
    const future = date > today;
    const open = future ? null : issues.filter((i) => !i.doneDay || i.doneDay > date);
    return {
      date,
      remainingPoints: future ? null : round1(open.reduce((sum, i) => sum + Number(i.points || 0), 0)),
      remainingIssues: future ? null : open.length,
      idealPoints: round1(days.length === 1 ? 0 : totalPoints * (1 - index / steps)),
    };
  });
}

async function burndownFor(board, sprintParam) {
  let sprint;
  if (sprintParam !== undefined && sprintParam !== '' && sprintParam !== 'active') {
    const id = M.positiveInt(sprintParam, 'sprintId');
    const [rows] = await pool.query(
      `SELECT id, start_date, end_date, status FROM tracker_sprints WHERE id = ? AND board_id = ? LIMIT 1`, [id, board.id]
    );
    sprint = rows[0];
    if (!sprint) throw M.invalid('sprintId tidak valid untuk project ini');
  } else {
    const [rows] = await pool.query(
      `SELECT id, start_date, end_date, status FROM tracker_sprints
        WHERE board_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
      [board.id]
    );
    sprint = rows[0];
  }
  const start = sprint && M.dateString(sprint.start_date);
  const end = sprint && M.dateString(sprint.end_date);
  if (!sprint || !start || !end) return null;

  const [[today]] = await pool.query("SELECT DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-%d') AS d");
  const [rows] = await pool.query(
    `SELECT t.story_points, c.category,
            DATE_FORMAT(t.completed_at + INTERVAL 7 HOUR, '%Y-%m-%d') AS done_day
       FROM tasks t
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE t.sprint_id = ? AND t.deleted_at IS NULL`,
    [sprint.id]
  );
  const issues = rows.map((row) => ({
    points: Number(row.story_points || 0),
    doneDay: row.category === 'done' ? (row.done_day || start) : null,
  }));
  return { sprintId: Number(sprint.id), days: computeBurndown({ start, end, today: today.d, issues }) };
}

async function getReports(user, projectId, query = {}) {
  const board = await tracker.accessProject(user, projectId);
  const names = new Map((trackerChat.cachedMembers(board.google_chat_space_name) || []).map((m) => [m.email, m.name]));

  const [statusRows] = await pool.query(
    `SELECT COALESCE(c.category, 'todo') AS category, COUNT(*) AS count, COALESCE(SUM(t.story_points), 0) AS points
       FROM tasks t LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE t.board_id = ? AND t.deleted_at IS NULL
      GROUP BY COALESCE(c.category, 'todo')`,
    [board.id]
  );
  const byStatusMap = new Map(statusRows.map((r) => [r.category, r]));
  const byStatus = M.CATEGORIES.map((category) => ({
    category,
    count: Number(byStatusMap.get(category)?.count || 0),
    points: round1(byStatusMap.get(category)?.points),
  }));

  const [assigneeRows] = await pool.query(
    `SELECT LOWER(COALESCE(t.assignee_email, ua.email)) AS email, MAX(ua.name) AS name,
            SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
            SUM(c.category = 'done') AS done_count,
            COALESCE(SUM(t.story_points), 0) AS points
       FROM tasks t
       LEFT JOIN board_columns c ON c.id = t.column_id
       LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE t.board_id = ? AND t.deleted_at IS NULL
      GROUP BY LOWER(COALESCE(t.assignee_email, ua.email))
      ORDER BY open_count DESC`,
    [board.id]
  );
  const byAssignee = assigneeRows.map((row) => ({
    email: row.email || null,
    name: row.email ? (row.name || names.get(row.email) || row.email) : 'Belum ditugaskan',
    open: Number(row.open_count || 0),
    done: Number(row.done_count || 0),
    points: round1(row.points),
  }));

  const [typeRows] = await pool.query(
    `SELECT issue_type AS type, COUNT(*) AS count FROM tasks
      WHERE board_id = ? AND deleted_at IS NULL GROUP BY issue_type ORDER BY count DESC`,
    [board.id]
  );
  const byType = typeRows.map((row) => ({ type: row.type, count: Number(row.count) }));

  const burndown = await burndownFor(board, Array.isArray(query.sprintId) ? query.sprintId[0] : query.sprintId);

  const [velocityRows] = await pool.query(
    `SELECT s.id, s.name,
            COALESCE(SUM(CASE WHEN c.category = 'done' THEN t.story_points END), 0) AS completed_points
       FROM tracker_sprints s
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.deleted_at IS NULL
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE s.board_id = ? AND s.status = 'completed'
      GROUP BY s.id
      ORDER BY s.completed_at DESC, s.id DESC
      LIMIT ${VELOCITY_SPRINTS}`,
    [board.id]
  );
  const velocity = velocityRows.reverse().map((row) => ({
    sprintId: Number(row.id), name: row.name, completedPoints: round1(row.completed_points),
  }));

  return { byStatus, byAssignee, byType, burndown, velocity };
}

// ---------------------------------------------------------------------------
// Management dashboard: every project of the entity, read-only aggregates.
// ---------------------------------------------------------------------------
const PROJECT_WHERE = `b.entity_id = ? AND b.deleted_at IS NULL
  AND b.project_key IS NOT NULL AND b.google_chat_space_name IS NOT NULL`;

// A Head only oversees their own division, so every query of this report is
// scoped the same way — never filter in JS after fetching the whole entity.
function scopeOf(entityId, departmentId) {
  const id = departmentId == null ? null : Number(departmentId);
  return id
    ? { where: `${PROJECT_WHERE} AND b.department_id = ?`, args: [entityId, id] }
    : { where: PROJECT_WHERE, args: [entityId] };
}

const WEEKS = 8;
const weekStartSql = (column) => `DATE_SUB(DATE(${column}), INTERVAL WEEKDAY(${column}) DAY)`;

// Exactly WEEKS buckets ending with the current week, oldest first, so a quiet
// week still shows as a gap instead of silently collapsing the chart.
function weekBuckets(createdRows, completedRows, today = wibClock()) {
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const key = (d) => d.toISOString().slice(0, 10);
  const countsOf = (rows, field) => new Map(
    (rows || []).map((r) => [M.dateString(r.week_start), Number(r[field] || 0)])
  );
  const created = countsOf(createdRows, 'created_count');
  const completed = countsOf(completedRows, 'completed_count');
  const out = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() - i * 7);
    const weekStart = key(day);
    out.push({ weekStart, created: created.get(weekStart) || 0, completed: completed.get(weekStart) || 0 });
  }
  return out;
}

async function managementProjects(entityId, { departmentId = null } = {}) {
  const { where: PROJECT_WHERE_SCOPED, args: scopeArgs } = scopeOf(entityId, departmentId);
  const [boards] = await pool.query(
    `SELECT b.id, b.name, b.project_key, b.google_chat_space_name,
            b.department_id, d.name AS department_name,
            GREATEST(UNIX_TIMESTAMP(b.updated_at),
                     COALESCE((SELECT UNIX_TIMESTAMP(MAX(t.updated_at)) FROM tasks t
                                WHERE t.board_id = b.id AND t.deleted_at IS NULL), 0)) AS updated_ts
       FROM boards b
       LEFT JOIN departments d ON d.id = b.department_id
      WHERE ${PROJECT_WHERE_SCOPED}
      ORDER BY b.name ASC, b.id ASC`,
    scopeArgs
  );
  const ids = boards.map((b) => Number(b.id));

  const [[totalsRow]] = await pool.query(
    `SELECT SUM(COALESCE(c.category, 'todo') <> 'done') AS open_issues,
            SUM(c.category = 'in_progress') AS in_progress,
            SUM(c.category = 'done' AND t.completed_at >= DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL WEEKDAY(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) DAY) - INTERVAL 7 HOUR) AS done_this_week,
            SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL`,
    scopeArgs
  );

  const counts = new Map();
  const active = new Map();
  if (ids.length) {
    const [countRows] = await pool.query(
      `SELECT t.board_id,
              SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
              SUM(c.category = 'in_progress') AS in_progress_count,
              SUM(c.category = 'done') AS done_count,
              SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue_count
         FROM tasks t LEFT JOIN board_columns c ON c.id = t.column_id
        WHERE t.board_id IN (?) AND t.deleted_at IS NULL
        GROUP BY t.board_id`,
      [ids]
    );
    for (const row of countRows) counts.set(Number(row.board_id), M.mapCounts(row));

    const [sprintRows] = await pool.query(
      `SELECT s.id, s.board_id, s.name, s.end_date,
              COUNT(t.id) AS issue_count,
              SUM(c.category = 'done') AS done_count,
              COALESCE(SUM(t.story_points), 0) AS points,
              COALESCE(SUM(CASE WHEN c.category = 'done' THEN t.story_points END), 0) AS done_points
         FROM tracker_sprints s
         LEFT JOIN tasks t ON t.sprint_id = s.id AND t.deleted_at IS NULL
         LEFT JOIN board_columns c ON c.id = t.column_id
        WHERE s.board_id IN (?) AND s.status = 'active'
        GROUP BY s.id`,
      [ids]
    );
    for (const row of sprintRows) {
      const points = Number(row.points || 0);
      const issues = Number(row.issue_count || 0);
      const pct = points > 0 ? (Number(row.done_points) / points) * 100
        : issues > 0 ? (Number(row.done_count || 0) / issues) * 100 : 0;
      active.set(Number(row.board_id), { name: row.name, endDate: M.dateString(row.end_date), progressPct: Math.round(pct) });
    }
  }

  const [workloadRows] = await pool.query(
    `SELECT LOWER(COALESCE(t.assignee_email, ua.email)) AS email, MAX(ua.name) AS name,
            COUNT(*) AS open_count,
            SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS overdue_count
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       LEFT JOIN board_columns c ON c.id = t.column_id
       LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL
        AND COALESCE(c.category, 'todo') <> 'done'
        AND COALESCE(t.assignee_email, ua.email) IS NOT NULL
      GROUP BY LOWER(COALESCE(t.assignee_email, ua.email))
      ORDER BY open_count DESC, overdue_count DESC
      LIMIT 20`,
    scopeArgs
  );

  const [recentRows] = await pool.query(
    `SELECT b.project_key, t.issue_number, t.title, b.name AS project_name,
            c.name AS status_name, COALESCE(c.category, 'todo') AS category,
            ua.name AS assignee_name, t.assignee_email,
            UNIX_TIMESTAMP(t.updated_at) AS updated_ts
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       LEFT JOIN board_columns c ON c.id = t.column_id
       LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT 15`,
    scopeArgs
  );

  const [divisionRows] = await pool.query(
    `SELECT b.department_id, d.name AS department_name,
            COUNT(DISTINCT b.id) AS project_count,
            SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
            SUM(c.category = 'in_progress') AS in_progress_count,
            SUM(c.category = 'done') AS done_count,
            SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue_count
       FROM boards b
       LEFT JOIN departments d ON d.id = b.department_id
       LEFT JOIN tasks t ON t.board_id = b.id AND t.deleted_at IS NULL
       LEFT JOIN board_columns c ON c.id = t.column_id
      WHERE ${PROJECT_WHERE_SCOPED}
      GROUP BY b.department_id, d.name
      ORDER BY open_count DESC, project_count DESC`,
    scopeArgs
  );

  const since = `DATE_SUB(${weekStartSql('DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)')}, INTERVAL ${WEEKS - 1} WEEK)`;
  const [createdRows] = await pool.query(
    `SELECT ${weekStartSql('t.created_at + INTERVAL 7 HOUR')} AS week_start, COUNT(*) AS created_count
       FROM tasks t JOIN boards b ON b.id = t.board_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL AND t.created_at >= ${since} - INTERVAL 7 HOUR
      GROUP BY week_start`,
    scopeArgs
  );
  const [completedRows] = await pool.query(
    `SELECT ${weekStartSql('t.completed_at + INTERVAL 7 HOUR')} AS week_start, COUNT(*) AS completed_count
       FROM tasks t JOIN boards b ON b.id = t.board_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL
        AND t.completed_at IS NOT NULL AND t.completed_at >= ${since} - INTERVAL 7 HOUR
      GROUP BY week_start`,
    scopeArgs
  );

  // Open issues nobody has touched for the longest — the queue management
  // actually has to act on, so 'done' is excluded.
  const [agingRows] = await pool.query(
    `SELECT t.id, b.project_key, t.issue_number, t.title, b.name AS project_name,
            c.name AS status_name, COALESCE(c.category, 'todo') AS category,
            ua.name AS assignee_name, t.assignee_email,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATE(t.updated_at + INTERVAL 7 HOUR)) AS days_since_update
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       LEFT JOIN board_columns c ON c.id = t.column_id
       LEFT JOIN users ua ON ua.id = t.assignee_id
      WHERE ${PROJECT_WHERE_SCOPED} AND t.deleted_at IS NULL
        AND COALESCE(c.category, 'todo') <> 'done'
      ORDER BY t.updated_at ASC, t.id ASC
      LIMIT 10`,
    scopeArgs
  );

  // Read the name from departments, not from the boards list: a division with
  // no project yet must still be able to say whose view this is.
  let scopedDepartment = null;
  if (departmentId != null) {
    const [[row]] = await pool.query('SELECT name FROM departments WHERE id = ? LIMIT 1', [Number(departmentId)]);
    scopedDepartment = row?.name || null;
  }

  return {
    scope: {
      entityWide: departmentId == null,
      departmentId: departmentId == null ? null : Number(departmentId),
      departmentName: scopedDepartment,
    },
    totals: {
      projects: boards.length,
      openIssues: Number(totalsRow?.open_issues || 0),
      inProgress: Number(totalsRow?.in_progress || 0),
      doneThisWeek: Number(totalsRow?.done_this_week || 0),
      overdue: Number(totalsRow?.overdue || 0),
    },
    projects: boards.map((board) => {
      const c = counts.get(Number(board.id)) || M.mapCounts();
      return {
        projectId: Number(board.id),
        name: board.name,
        key: board.project_key,
        spaceName: board.google_chat_space_name,
        departmentId: board.department_id != null ? Number(board.department_id) : null,
        departmentName: board.department_name || null,
        open: c.open,
        inProgress: c.inProgress,
        done: c.done,
        overdue: c.overdue,
        activeSprint: active.get(Number(board.id)) || null,
        updatedAt: M.iso(board.updated_ts),
      };
    }),
    workload: workloadRows.map((row) => ({
      email: row.email,
      name: row.name || row.email,
      open: Number(row.open_count || 0),
      overdue: Number(row.overdue_count || 0),
    })),
    recent: recentRows.map((row) => ({
      issueKey: M.issueKey(row.project_key, row.issue_number),
      title: row.title,
      projectName: row.project_name,
      statusName: row.status_name || null,
      category: row.category,
      assigneeName: row.assignee_name || row.assignee_email || null,
      updatedAt: M.iso(row.updated_ts),
    })),
    byDivision: divisionRows.map((row) => ({
      departmentId: row.department_id != null ? Number(row.department_id) : null,
      departmentName: row.department_name || null,
      projects: Number(row.project_count || 0),
      open: Number(row.open_count || 0),
      inProgress: Number(row.in_progress_count || 0),
      done: Number(row.done_count || 0),
      overdue: Number(row.overdue_count || 0),
    })),
    trend: weekBuckets(createdRows, completedRows),
    aging: agingRows.map((row) => ({
      issueId: Number(row.id),
      issueKey: M.issueKey(row.project_key, row.issue_number),
      title: row.title,
      projectName: row.project_name,
      statusName: row.status_name || null,
      category: row.category,
      assigneeName: row.assignee_name || row.assignee_email || null,
      daysSinceUpdate: Number(row.days_since_update || 0),
    })),
  };
}

module.exports = { getReports, managementProjects, computeBurndown, daysBetween, weekBuckets, scopeOf };
