const pool = require('../db/pool');
const registry = require('../management/registry');
const { permitted, restrictedText } = require('../management/contract');
const { wibClock } = require('../utils/wibTime');
const { billedMonthlyFor } = require('./invoiceRules');
const { metricActuals } = require('../management/figureCache');
const { mapLimit } = require('../utils/mapLimit');
const { memo } = require('../utils/memo');

// Metrics asked at a time (the pool has five connections for every user).
const ACTUALS_CONCURRENCY = 3;

// Target & realisasi per divisi.
//
// A target is stored; the realisation never is — it is computed live by the
// division module that owns the metric (its management provider), so
// management always compares a target with what actually happened. A new
// module's metrics appear here with no change to this file.
//
// A count that grows through the period ("issues completed") is judged against
// the share of the target that should be done BY NOW, otherwise every division
// would look behind on the first day of a quarter. Rates and averages are
// judged as they stand. A figure billed once a month (Retail Commerce's
// marketplace recap) is not judged on pace while its period runs.

const METRIC_FIELDS = ['key', 'label', 'unit', 'better', 'cumulative', 'provider', 'providerLabel'];
/** The metric catalogue as the page sees it — no functions, just the description. */
function metricCatalog(metrics = registry.metrics()) {
  return metrics.map((m) => ({
    ...Object.fromEntries(METRIC_FIELDS.map((f) => [f, m[f]])),
    source: m.providerLabel,
  }));
}

// Below this share of the target (or of the pace) a division is behind; between
// it and 100% it needs attention.
const AT_RISK_FROM = 80;
// Rupiah targets (Sales revenue, Finance payments) run into the miliar; the
// column is DECIMAL(18,2), so cap well inside it.
const MAX_TARGET = 1e15;
const MAX_NOTE = 500;

function invalid(message, code = 'VALIDATION_ERROR', status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// 'YYYY-MM' or 'YYYY-Qn' → { type, key, start, end, label }. Defaults to the
// current quarter, the period management usually sets targets for.
function parsePeriod(raw, today = wibClock()) {
  const value = raw == null || raw === '' ? null : String(raw).trim().toUpperCase();
  let year;
  let type;
  let index;
  if (value === null) {
    year = today.getUTCFullYear();
    type = 'quarter';
    index = Math.floor(today.getUTCMonth() / 3) + 1;
  } else {
    const month = /^(\d{4})-(\d{2})$/.exec(value);
    const quarter = /^(\d{4})-Q([1-4])$/.exec(value);
    if (month) { year = Number(month[1]); type = 'month'; index = Number(month[2]); }
    else if (quarter) { year = Number(quarter[1]); type = 'quarter'; index = Number(quarter[2]); }
    else throw invalid('period harus berformat YYYY-MM atau YYYY-Qn');
    if (type === 'month' && (index < 1 || index > 12)) throw invalid('Bulan tidak valid');
  }
  if (year < 2000 || year > 2100) throw invalid('Tahun tidak valid');

  const firstMonth = type === 'month' ? index - 1 : (index - 1) * 3;
  const span = type === 'month' ? 1 : 3;
  const start = utc(year, firstMonth, 1);
  const end = utc(year, firstMonth + span, 0);
  const key = type === 'month' ? `${year}-${String(index).padStart(2, '0')}` : `${year}-Q${index}`;
  const label = type === 'month'
    ? `${MONTHS[firstMonth]} ${year}`
    : `Kuartal ${index} ${year} (${MONTHS[firstMonth]}–${MONTHS[firstMonth + 2]})`;
  return { type, key, start: iso(start), end: iso(end), label };
}

// Share of the period that has passed, 0..1. A period in the future is 0, a
// finished one is 1.
function elapsedShare(period, today = wibClock()) {
  const day = 86400000;
  const start = Date.parse(`${period.start}T00:00:00Z`);
  const end = Date.parse(`${period.end}T00:00:00Z`);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const total = (end - start) / day + 1;
  const passed = (Math.min(now, end) - start) / day + 1;
  return Math.max(0, Math.min(1, passed / total));
}

const round1 = (n) => Math.round(n * 10) / 10;

// How far the actual is from the target, as a percentage where 100 = met.
function achievement(metric, target, actual) {
  if (actual == null || target == null) return null;
  if (metric.better === 'higher') {
    if (target <= 0) return 100;
    return round1((actual / target) * 100);
  }
  // Lower is better: at or under the target is fully met.
  if (actual <= target) return 100;
  if (actual <= 0) return 100;
  return round1((target / actual) * 100);
}

// How far the actual is from what the target allows BY NOW (100 = on pace).
// Higher is better: done ÷ expected. Lower is better (a budget, a count to keep
// down): at or under the expected share is on pace, over it falls behind —
// spending 80 of 100 at half-time is behind, not ahead.
function pace(metric, expected, actual) {
  if (metric.better === 'lower') {
    if (actual <= expected) return 100;
    return round1((expected / actual) * 100);
  }
  return expected > 0 ? round1((actual / expected) * 100) : 100;
}

// `billedMonthly`: the metric is billed once a month for this division
// (invoiceRules.billedMonthlyFor) — in a running period it has no pace yet.
function evaluate(metric, target, actual, share, { billedMonthly = false } = {}) {
  if (target == null) return { achievementPct: null, pacePct: null, status: 'no_target' };
  const ended = share >= 1;
  if (billedMonthly && !ended) return { achievementPct: null, pacePct: null, status: 'billed_monthly' };
  if (actual == null) return { achievementPct: null, pacePct: null, status: 'no_data' };
  const achievementPct = achievement(metric, target, actual);
  let pacePct = null;
  if (metric.cumulative && !ended) pacePct = pace(metric, target * share, actual);
  const score = pacePct ?? achievementPct;
  let status;
  if (score >= 100) status = ended ? 'achieved' : 'on_track';
  else if (score >= AT_RISK_FROM) status = 'at_risk';
  else status = 'off_track';
  return { achievementPct, pacePct, status };
}

// --------------------------------------------------------------------------
// Actuals — asked of every metric's own provider
// --------------------------------------------------------------------------

function departmentFilter(departmentId, column) {
  return departmentId == null ? { sql: '', args: [] } : { sql: ` AND ${column} = ?`, args: [Number(departmentId)] };
}

// Only the metrics the caller may see are asked: a restricted one never runs.
async function actualsFor(entityId, period, departmentId, metrics) {
  const out = new Map(); // `${departmentId}:${metricKey}` → number|null
  const scoped = departmentId == null ? null : Number(departmentId);
  await mapLimit(metrics, ACTUALS_CONCURRENCY, async (metric) => {
    const values = await metricActuals(metric, entityId, period, { departmentId: scoped });
    for (const [dept, value] of values) {
      // A provider must honour the scope; drop anything outside it regardless.
      if (scoped != null && Number(dept) !== scoped) continue;
      out.set(`${Number(dept)}:${metric.key}`, value == null ? null : Number(value));
    }
  });
  return out;
}

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

async function list(entityId, {
  departmentId = null, period: rawPeriod = null, canEdit = false, permissions = [], today = wibClock(),
} = {}) {
  const period = parsePeriod(rawPeriod, today);
  const share = elapsedShare(period, today);

  // A metric behind its own permission (purchase prices, P1) is left out for a
  // caller without it — no actual, no cells, no target — and only named, so the
  // page can say why it is missing. No permissions given means none held.
  const metrics = registry.metrics().filter((m) => permitted(m, permissions));
  const restricted = registry.metrics().filter((m) => !permitted(m, permissions)).map((m) => ({
    key: m.key, label: m.label, provider: m.provider, providerLabel: m.providerLabel, reason: restrictedText(m),
  }));

  const dept = departmentFilter(departmentId, 'd.id');
  const [divisions] = await pool.query(
    `SELECT d.id, d.name, d.code FROM departments d
      WHERE d.entity_id = ? AND d.deleted_at IS NULL${dept.sql}
      ORDER BY d.name ASC`,
    [entityId, ...dept.args]
  );

  const targetDept = departmentFilter(departmentId, 't.department_id');
  const [targets] = await pool.query(
    `SELECT t.id, t.department_id, t.metric_key, t.target_value, t.note, t.updated_at, u.name AS updated_by_name
       FROM division_targets t
       LEFT JOIN users u ON u.id = t.updated_by
      WHERE t.entity_id = ? AND t.period_type = ? AND t.period_start = ?${targetDept.sql}`,
    [entityId, period.type, period.start, ...targetDept.args]
  );
  const targetByCell = new Map(targets.map((t) => [`${Number(t.department_id)}:${t.metric_key}`, t]));
  const actuals = await actualsFor(entityId, period, departmentId, metrics);

  const cells = [];
  for (const division of divisions) {
    for (const metric of metrics) {
      const cellKey = `${Number(division.id)}:${metric.key}`;
      const stored = targetByCell.get(cellKey) || null;
      const target = stored ? Number(stored.target_value) : null;
      // Counts with no matching rows are a real zero; rates/averages are unknown.
      const actual = actuals.has(cellKey) ? actuals.get(cellKey) : (metric.emptyIsZero ? 0 : null);
      cells.push({
        departmentId: Number(division.id),
        metricKey: metric.key,
        target,
        actual,
        note: stored?.note || null,
        updatedAt: stored?.updated_at ? new Date(stored.updated_at).toISOString() : null,
        updatedByName: stored?.updated_by_name || null,
        ...evaluate(metric, target, actual, share, { billedMonthly: billedMonthlyFor(metric, division.code) }),
      });
    }
  }

  let departmentName = null;
  if (departmentId != null) departmentName = divisions[0]?.name || null;

  return {
    scope: {
      entityWide: departmentId == null,
      departmentId: departmentId == null ? null : Number(departmentId),
      departmentName,
    },
    period: { ...period, elapsedPct: Math.round(share * 100), ended: share >= 1 },
    metrics: metricCatalog(metrics),
    restricted,
    divisions: divisions.map((d) => ({ id: Number(d.id), name: d.name })),
    cells,
    canEdit: Boolean(canEdit),
  };
}

// --------------------------------------------------------------------------
// Write — setting a target is an entity-wide management decision
// --------------------------------------------------------------------------

async function save(user, { departmentId, metricKey, period: rawPeriod, targetValue, note }) {
  const metric = registry.metric(String(metricKey || ''));
  if (!metric) throw invalid('metricKey tidak dikenal');
  // Same rule as reading: a metric the user may not see cannot be given a target.
  if (!permitted(metric, user?.permissions)) throw invalid('Tidak punya izin untuk metrik ini', 'FORBIDDEN', 403);
  const deptId = Number(departmentId);
  if (!Number.isInteger(deptId) || deptId <= 0) throw invalid('departmentId tidak valid');
  const period = parsePeriod(rawPeriod);

  const [[dept]] = await pool.query(
    'SELECT id FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
    [deptId, user.entityId]
  );
  if (!dept) throw invalid('Divisi tidak ditemukan', 'NOT_FOUND', 404);

  // Clearing a target is saving "no target".
  if (targetValue === null || targetValue === '') {
    await pool.query(
      `DELETE FROM division_targets
        WHERE entity_id = ? AND department_id = ? AND metric_key = ? AND period_type = ? AND period_start = ?`,
      [user.entityId, deptId, metric.key, period.type, period.start]
    );
    memo.invalidate('mgmt:');
    return { departmentId: deptId, metricKey: metric.key, period: period.key, target: null, note: null };
  }

  const value = Number(targetValue);
  if (!Number.isFinite(value) || value < 0) throw invalid('Target harus angka 0 atau lebih');
  if (value > MAX_TARGET) throw invalid('Target terlalu besar');
  if (metric.unit === '%' && value > 100) throw invalid('Target persentase maksimal 100');
  if (note != null && String(note).length > MAX_NOTE) throw invalid(`Catatan maksimal ${MAX_NOTE} karakter`);
  const cleanNote = note == null || String(note).trim() === '' ? null : String(note).trim();

  await pool.query(
    `INSERT INTO division_targets
       (entity_id, department_id, metric_key, period_type, period_start, target_value, note, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       target_value = VALUES(target_value),
       note = VALUES(note),
       updated_by = VALUES(updated_by)`,
    [user.entityId, deptId, metric.key, period.type, period.start, value, cleanNote, user.sub, user.sub]
  );
  // Target pages and division dashboards show it: drop the cached answers.
  memo.invalidate('mgmt:');
  return { departmentId: deptId, metricKey: metric.key, period: period.key, target: value, note: cleanNote };
}

module.exports = {
  list,
  save,
  metricCatalog,
  parsePeriod,
  elapsedShare,
  achievement,
  evaluate,
  pace,
  AT_RISK_FROM,
};
