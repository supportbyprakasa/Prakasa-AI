// Shared building blocks for management providers, so every division reports
// in the same shape and with the same scoping rules.

// Past this many days a breach stops being a delay and is a problem of its own.
const HIGH_SEVERITY_DAYS = 14;
const MAX_ITEMS_PER_SOURCE = 100;

// A Chat-space project, as opposed to a plain task board.
const PROJECT_WHERE = `b.deleted_at IS NULL
  AND b.project_key IS NOT NULL AND b.google_chat_space_name IS NOT NULL`;

const int = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};
const num = (value) => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
const iso = (value) => (value ? new Date(value).toISOString() : null);
const severityOf = (days) => (days >= HIGH_SEVERITY_DAYS ? 'high' : 'medium');

/**
 * Division filter for one SQL query. The caller's division — never a value from
 * the request — is passed in; `column` is the department column of that query.
 * Returns the extra WHERE fragment and its argument(s) to append after the
 * entity argument.
 */
function scope(departmentId, column) {
  return departmentId == null
    ? { sql: '', args: [] }
    : { sql: ` AND ${column} = ?`, args: [Number(departmentId)] };
}

/** One row of Pusat Eskalasi, in the shape the page renders. */
function escalationItem({
  sourceId, title, reference = null, context = '-', departmentId = null, departmentName = null,
  ownerName = null, daysLate, since = null, link = null, referenceLabel = false,
}) {
  const late = int(daysLate);
  return {
    // `reference` is normally a document number or a record's name. A provider
    // that puts one of the app's own labels there (a contract kind, a campaign
    // objective) says so, and the English interface translates it.
    ...(referenceLabel && reference ? { referenceLabel: true } : {}),
    sourceId: Number(sourceId),
    title: String(title || '').trim() || '(tanpa judul)',
    reference: reference || null,
    context: context || '-',
    departmentId: departmentId != null ? Number(departmentId) : null,
    departmentName: departmentName || null,
    ownerName: ownerName || null,
    severity: severityOf(late),
    daysLate: late,
    since: iso(since),
    // Only in-app paths: a provider must never hand the browser an outside URL.
    link: typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null,
  };
}

/**
 * For a metric that is a rate or an average: the per-division grouping, or —
 * `whole` — one row over every division together (metric.entityActuals: the
 * exact company-wide value, never a mean of the divisions' rates).
 * `select` replaces "<column> AS department_id", `group` the GROUP BY clause.
 */
function grouping(column, whole) {
  return whole
    ? { select: 'NULL AS department_id', group: '' }
    : { select: `${column} AS department_id`, group: `GROUP BY ${column}` };
}

/** Collapse "department_id → value" rows into the Map metrics must return. */
function byDepartment(rows, pick) {
  const out = new Map();
  for (const row of rows) {
    if (row.department_id == null) continue;
    out.set(Number(row.department_id), pick(row));
  }
  return out;
}

module.exports = {
  HIGH_SEVERITY_DAYS,
  MAX_ITEMS_PER_SOURCE,
  PROJECT_WHERE,
  int,
  num,
  round1,
  iso,
  severityOf,
  scope,
  escalationItem,
  byDepartment,
  grouping,
};
