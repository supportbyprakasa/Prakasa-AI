const pool = require('../db/pool');
const { todayWib } = require('../utils/wibTime');

// Peta Program — every Project Tracker project of the entity on one timeline,
// grouped by division, with its sprints as child bars.
//
// Projects carry no dates of their own (`boards` has none), so a project's bar
// is DERIVED: from its sprints when it has any, otherwise from its issues'
// planned dates, otherwise from when work actually happened. Whichever fallback
// was used is reported per bar, because a bar management reads as a commitment
// must not silently be a guess.

const PROJECT_WHERE = `b.entity_id = ? AND b.deleted_at IS NULL
  AND b.project_key IS NOT NULL AND b.google_chat_space_name IS NOT NULL`;

// A roadmap opened on a quiet day still needs a window to draw in.
const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayMs = 86400000;
const toDate = (value) => (value ? new Date(value) : null);
const dateString = (value) => {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
};
const shiftDays = (iso, days) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * dayMs).toISOString().slice(0, 10);
const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function scopeOf(entityId, departmentId) {
  const id = departmentId == null ? null : Number(departmentId);
  return id
    ? { where: `${PROJECT_WHERE} AND b.department_id = ?`, args: [entityId, id] }
    : { where: PROJECT_WHERE, args: [entityId] };
}

// Earliest/latest of a set of dates, ignoring the ones that are missing.
const minDate = (...values) => values.filter(Boolean).sort()[0] || null;
const maxDate = (...values) => values.filter(Boolean).sort().at(-1) || null;

function statusOf({ open, inProgress, done }) {
  if (!open && done) return 'done';
  if (inProgress) return 'in_progress';
  return 'open';
}

function progressOf({ open, inProgress, done }) {
  const total = open + done;
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

async function get(entityId, { departmentId = null, from = null, to = null } = {}) {
  if (from != null && !DATE_RE.test(from)) throw invalid('from harus berformat YYYY-MM-DD');
  if (to != null && !DATE_RE.test(to)) throw invalid('to harus berformat YYYY-MM-DD');
  if (from && to && to < from) throw invalid('to harus setelah from');

  const scope = scopeOf(entityId, departmentId);
  const [boards] = await pool.query(
    `SELECT b.id, b.name, b.project_key, b.google_chat_space_name,
            b.department_id, d.name AS department_name
       FROM boards b
       LEFT JOIN departments d ON d.id = b.department_id
      WHERE ${scope.where}
      ORDER BY COALESCE(d.name, 'zzz') ASC, b.name ASC, b.id ASC`,
    scope.args
  );
  const ids = boards.map((b) => Number(b.id));

  const bounds = new Map();
  const counts = new Map();
  const sprintsByBoard = new Map();
  if (ids.length) {
    const [issueRows] = await pool.query(
      `SELECT t.board_id,
              MIN(t.start_date) AS planned_start,
              MAX(t.due_date) AS planned_due,
              MIN(DATE(t.created_at + INTERVAL 7 HOUR)) AS first_activity,
              MAX(DATE(COALESCE(t.completed_at, t.updated_at) + INTERVAL 7 HOUR)) AS last_activity,
              SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
              SUM(c.category = 'in_progress') AS in_progress_count,
              SUM(c.category = 'done') AS done_count,
              SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue_count
         FROM tasks t
         LEFT JOIN board_columns c ON c.id = t.column_id
        WHERE t.board_id IN (?) AND t.deleted_at IS NULL
        GROUP BY t.board_id`,
      [ids]
    );
    for (const row of issueRows) {
      bounds.set(Number(row.board_id), {
        plannedStart: dateString(row.planned_start),
        plannedDue: dateString(row.planned_due),
        firstActivity: dateString(row.first_activity),
        lastActivity: dateString(row.last_activity),
      });
      counts.set(Number(row.board_id), {
        open: count(row.open_count),
        inProgress: count(row.in_progress_count),
        done: count(row.done_count),
        overdue: count(row.overdue_count),
      });
    }

    const [sprintRows] = await pool.query(
      `SELECT s.id, s.board_id, s.name, s.start_date, s.end_date, s.status,
              COUNT(t.id) AS issue_count,
              SUM(c.category = 'done') AS done_count,
              SUM(COALESCE(c.category, 'todo') <> 'done') AS open_count,
              SUM(c.category = 'in_progress') AS in_progress_count,
              SUM(t.due_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND COALESCE(c.category, 'todo') <> 'done') AS overdue_count
         FROM tracker_sprints s
         LEFT JOIN tasks t ON t.sprint_id = s.id AND t.deleted_at IS NULL
         LEFT JOIN board_columns c ON c.id = t.column_id
        WHERE s.board_id IN (?) AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
        GROUP BY s.id
        ORDER BY s.start_date ASC, s.id ASC`,
      [ids]
    );
    for (const row of sprintRows) {
      const list = sprintsByBoard.get(Number(row.board_id)) || [];
      list.push(row);
      sprintsByBoard.set(Number(row.board_id), list);
    }
  }

  const items = [];
  for (const board of boards) {
    const id = Number(board.id);
    const b = bounds.get(id) || {};
    const c = counts.get(id) || { open: 0, inProgress: 0, done: 0, overdue: 0 };
    const sprints = sprintsByBoard.get(id) || [];
    const sprintStart = minDate(...sprints.map((s) => dateString(s.start_date)));
    const sprintEnd = maxDate(...sprints.map((s) => dateString(s.end_date)));

    // Planned dates win; activity dates are only a last resort, and say so.
    const start = sprintStart || b.plannedStart || b.firstActivity;
    const due = sprintEnd || b.plannedDue || b.lastActivity;
    if (!start && !due) continue; // nothing to place on a timeline at all

    const startDate = start || due;
    const dueDate = maxDate(due || startDate, startDate);
    const projectId = `project:${id}`;
    items.push({
      id: projectId,
      kind: 'project',
      parentId: null,
      title: board.name,
      startDate,
      dueDate,
      status: statusOf(c),
      progressPercent: progressOf(c),
      departmentId: board.department_id != null ? Number(board.department_id) : null,
      departmentName: board.department_name || null,
      projectKey: board.project_key || null,
      spaceId: board.google_chat_space_name ? board.google_chat_space_name.replace(/^spaces\//, '') : null,
      open: c.open,
      inProgress: c.inProgress,
      done: c.done,
      overdue: c.overdue,
      isFallbackStart: !sprintStart && !b.plannedStart,
      isFallbackDue: !sprintEnd && !b.plannedDue,
    });

    for (const sprint of sprints) {
      const sc = {
        open: count(sprint.open_count),
        inProgress: count(sprint.in_progress_count),
        done: count(sprint.done_count),
        overdue: count(sprint.overdue_count),
      };
      items.push({
        id: `sprint:${Number(sprint.id)}`,
        kind: 'sprint',
        parentId: projectId,
        title: sprint.name,
        startDate: dateString(sprint.start_date),
        dueDate: dateString(sprint.end_date),
        status: sprint.status === 'completed' ? 'done' : statusOf(sc),
        progressPercent: progressOf(sc),
        departmentId: board.department_id != null ? Number(board.department_id) : null,
        departmentName: board.department_name || null,
        projectKey: board.project_key || null,
        spaceId: board.google_chat_space_name ? board.google_chat_space_name.replace(/^spaces\//, '') : null,
        open: sc.open,
        inProgress: sc.inProgress,
        done: sc.done,
        overdue: sc.overdue,
        // A sprint always carries its own planned dates — it is never inferred.
        isFallbackStart: false,
        isFallbackDue: false,
      });
    }
  }

  const today = todayWib();
  const earliest = minDate(...items.map((i) => i.startDate));
  const latest = maxDate(...items.map((i) => i.dueDate));
  const range = {
    from: from || minDate(earliest, shiftDays(today, -DEFAULT_PAST_DAYS)),
    to: to || maxDate(latest, shiftDays(today, DEFAULT_FUTURE_DAYS)),
  };

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
    range,
    items,
    links: [],
  };
}

module.exports = { get, statusOf, progressOf, minDate, maxDate };
