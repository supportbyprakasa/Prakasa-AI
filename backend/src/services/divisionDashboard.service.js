const pool = require('../db/pool');
const registry = require('../management/registry');
const escalation = require('./escalation.service');
const { permitted, restrictedText } = require('../management/contract');
const { wibClock } = require('../utils/wibTime');
const { billedMonthlyFor } = require('./invoiceRules');
const { kpiValue, metricActuals, metricEntityActuals } = require('../management/figureCache');
const { mapLimit } = require('../utils/mapLimit');
const { memo } = require('../utils/memo');
const logger = require('../utils/logger');

// Dashboard divisi (owner, 1 Oct 2026; migration 116). One page per division
// built only from the management providers, so a new module that reports into
// management shows up here too:
//   - headline figures (KPIs) of the providers that belong to the division;
//   - 12 months of every metric, with the division's monthly targets — the
//     source of the trend charts and the motion chart;
//   - the division's open escalations.
//
// Which providers a division shows, and how they are scoped:
//   'division' — the division's own records (department_id = the division);
//   'entity'   — the whole company, for the services a division RUNS for
//                everyone (People & Culture runs IT, GA and onboarding; the
//                Management Office oversees everything). A per-division
//                metric then sums across divisions (counts). A rate or
//                average is exact when its provider gives the company-wide
//                value (metric.entityActuals); otherwise it is the plain mean
//                of the divisions, marked so ("rata-rata antar divisi").
//
// A KPI another provider already shows for a division is hidden there
// (HIDE_KPIS), so one figure is not on the page twice under two names.
const COMMON = { approvals: 'division', project_tracker: 'division' };
const DIVISION_PROVIDERS = Object.freeze({
  sales: { sales: 'division', accurate: 'division', ...COMMON },
  retail_commerce: { retail_commerce: 'division', sales: 'division', accurate: 'division', ...COMMON },
  marketing: { marketing: 'division', sales: 'entity', ...COMMON },
  warehouse: { warehouse: 'division', accurate: 'division', ...COMMON },
  procurement: { procurement: 'division', accurate: 'division', ...COMMON },
  finance: { finance_ledger: 'entity', finance: 'entity', accurate: 'division', ...COMMON },
  people_culture: { hrga: 'entity', it: 'entity', ga: 'entity', ...COMMON },
});
// division code → figures (provider.key) hidden on that division's dashboard:
// on Retail Commerce the Sales revenue and order series repeat
// rc_marketplace_revenue / rc_orders over the same rows.
const HIDE = Object.freeze({
  retail_commerce: Object.freeze({ kpis: [], metrics: ['sales.sales_revenue', 'sales.sales_orders'] }),
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SERIES_MONTHS = 12;
const SERIES_TTL_MS = 10 * 60 * 1000;
// Figures asked at a time: the pool has five connections for every user.
const CONCURRENCY = 3;

function fail(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

/** The last `count` months up to the current WIB month, oldest first. */
function lastMonths(count = SERIES_MONTHS, today = wibClock()) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const key = start.toISOString().slice(0, 7);
    out.push({ type: 'month', key, start: key + '-01', end: end.toISOString().slice(0, 10), label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}` });
  }
  return out;
}

const has = (user, code) => (user?.permissions || []).includes(code);

/**
 * Which division the caller looks at. Management (management_dashboard.view)
 * may pick any division or the whole company ('all'); everyone else sees only
 * their own division and needs division_dashboard.view.
 */
async function resolveDivision(user, requested) {
  const anyDivision = has(user, 'management_dashboard.view');
  if (!anyDivision && !has(user, 'division_dashboard.view')) throw fail('Tidak punya izin melihat dashboard divisi', 'FORBIDDEN', 403);
  const wanted = requested == null || requested === '' ? null : String(requested);
  if (wanted === 'all') {
    if (!anyDivision) throw fail('Dashboard seluruh perusahaan hanya untuk manajemen', 'FORBIDDEN', 403);
    return { id: null, name: 'Seluruh perusahaan', code: 'all' };
  }
  let id = wanted == null ? Number(user.departmentId) || null : Number(wanted);
  if (!id) {
    if (anyDivision) return { id: null, name: 'Seluruh perusahaan', code: 'all' };
    throw fail('Akun Anda belum terhubung ke divisi mana pun.', 'NO_DEPARTMENT', 403);
  }
  if (!anyDivision && id !== Number(user.departmentId)) throw fail('Anda hanya bisa melihat dashboard divisi Anda sendiri', 'FORBIDDEN', 403);
  const [[row]] = await pool.query('SELECT id, name, code FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1', [id, user.entityId]);
  if (!row) throw fail('Divisi tidak ditemukan', 'NOT_FOUND', 404);
  id = Number(row.id);
  return { id, name: row.name, code: row.code };
}

/**
 * The divisions the caller may look at: every division of the company for
 * management (management_dashboard.view), only their own otherwise. Used to
 * turn a division NAME into its id (Prakasa AI's management tools).
 */
async function listDivisions(user) {
  const every = has(user, 'management_dashboard.view');
  const own = Number(user?.departmentId) || null;
  if (!every && !own) return [];
  const [rows] = await pool.query(
    `SELECT id, name, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL${every ? '' : ' AND id = ?'} ORDER BY name`,
    every ? [user.entityId] : [user.entityId, own],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, code: r.code || null }));
}

/** provider key → 'division' | 'entity' for this division. */
function providerScopes(division) {
  if (division.code === 'all' || division.code === 'management_office') {
    return Object.fromEntries(registry.providers().map((p) => [p.key, 'entity']));
  }
  return DIVISION_PROVIDERS[division.code] || COMMON;
}

// ------------------------------------------------------------ series (cached)
// A series is 12 months of one metric for one division, cached SERIES_TTL_MS
// under 'series:' (utils/memo.js) with single-flight: dashboards opened at the
// same moment compute it once. Dropped when an Accurate batch is approved.

function combine(metric, values) {
  const nums = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  if (metric.cumulative) return Math.round(total * 100) / 100;
  return Math.round((total / nums.length) * 10) / 10;
}

async function monthValue(entityId, metric, period, division, scope) {
  const departmentId = scope === 'division' ? division.id : null;
  const values = await metricActuals(metric, entityId, period, { departmentId });
  if (scope === 'division') {
    const v = values.get(division.id);
    if (v != null) return Number(v);
    return metric.emptyIsZero ? 0 : null;
  }
  const combined = combine(metric, [...values.values()]);
  return combined == null && metric.emptyIsZero ? 0 : combined;
}

// Company-wide value of a month. A rate/average with entityActuals is computed
// over all the rows at once (exact), never as a mean of the divisions' rates.
async function entityMonthValue(entityId, metric, period, division, scope) {
  if (scope === 'entity' && typeof metric.entityActuals === 'function') {
    const v = await metricEntityActuals(metric, entityId, period);
    if (v != null && Number.isFinite(Number(v))) return Number(v);
    return metric.emptyIsZero ? 0 : null;
  }
  return monthValue(entityId, metric, period, division, scope);
}

/** Whether a company-wide series of this metric is a mean of the divisions. */
const isAveraged = (metric, scope) => scope === 'entity' && !metric.cumulative && typeof metric.entityActuals !== 'function';

const hidden = (division, kind, item) => (HIDE[division.code]?.[kind] || []).includes(`${item.provider}.${item.key}`);

function seriesOf(entityId, metric, months, division, scope) {
  const key = `series:${entityId}:${division.id ?? 'all'}:${scope}:${metric.provider}.${metric.key}:${months[0].key}:${months[months.length - 1].key}`;
  return memo.get(key, SERIES_TTL_MS, async () => {
    const values = [];
    // Month by month (not all at once): a metric is a handful of light queries.
    for (const period of months) {
      try { values.push(await entityMonthValue(entityId, metric, period, division, scope)); } catch { values.push(null); }
    }
    return values;
  });
}

async function monthlyTargets(entityId, divisionId, months) {
  if (divisionId == null) return new Map();
  const [rows] = await pool.query(
    `SELECT metric_key, DATE_FORMAT(period_start, '%Y-%m') AS month, target_value
       FROM division_targets
      WHERE entity_id = ? AND department_id = ? AND period_type = 'month' AND period_start BETWEEN ? AND ?`,
    [entityId, divisionId, months[0].start, months[months.length - 1].start],
  );
  const out = new Map();
  for (const r of rows) out.set(`${r.metric_key}:${r.month}`, Number(r.target_value));
  return out;
}

// ------------------------------------------------------------ the page
async function build(user, { division: requested = null } = {}) {
  const entityId = user.entityId;
  const division = await resolveDivision(user, requested);
  const scopes = providerScopes(division);
  const permissions = user.permissions || [];
  const months = lastMonths();
  const inDivision = (item) => Object.prototype.hasOwnProperty.call(scopes, item.provider);

  const kpis = await mapLimit(registry.kpis().filter(inDivision).filter((k) => !hidden(division, 'kpis', k)), CONCURRENCY, async (kpi) => {
    const meta = { provider: kpi.provider, providerLabel: kpi.providerLabel, key: kpi.key, label: kpi.label, unit: kpi.unit || null };
    if (!permitted(kpi, permissions)) return { ...meta, value: null, sub: restrictedText(kpi), alert: false, restricted: true, error: false };
    try {
      const departmentId = scopes[kpi.provider] === 'division' ? division.id : null;
      const r = await kpiValue(kpi, entityId, { departmentId });
      return { ...meta, value: r?.value == null ? null : Number(r.value), sub: r?.sub || null, alert: Boolean(r?.alert), restricted: false, error: false };
    } catch {
      return { ...meta, value: null, sub: null, alert: false, restricted: false, error: true };
    }
  });

  const targets = await monthlyTargets(entityId, division.id, months);
  const metrics = (await mapLimit(registry.metrics().filter(inDivision).filter((m) => !hidden(division, 'metrics', m))
    .filter((m) => permitted(m, permissions)), CONCURRENCY, async (m) => {
    const scope = scopes[m.provider];
    const series = await seriesOf(entityId, m, months, division, scope);
    // Billed once a month (Retail Commerce's recap, dated the month's last day):
    // the running month has nothing billed yet — unknown, not a drop to 0.
    const billedMonthly = billedMonthlyFor(m, division.code);
    const values = billedMonthly ? [...series.slice(0, -1), null] : series;
    return {
      provider: m.provider,
      providerLabel: m.providerLabel,
      key: m.key,
      label: m.label,
      unit: m.unit,
      better: m.better,
      cumulative: Boolean(m.cumulative),
      averaged: isAveraged(m, scope),
      billedMonthly,
      values,
      targets: months.map((p) => targets.get(`${m.key}:${p.key}`) ?? null),
    };
  })).filter((m) => m.values.some((v) => v != null));

  // Escalations of this division's modules: the division's own records, or
  // every division's for the services it runs for the whole company.
  const sources = registry.escalationSources().filter(inDivision);
  const byScope = { division: [], entity: [] };
  for (const s of sources) byScope[scopes[s.provider]].push(s.key);
  // One scope after the other: each list already reads its sources in parallel.
  const lists = [];
  for (const [scope, keys] of Object.entries(byScope).filter(([, k]) => k.length)) {
    const r = await escalation.list(entityId, { departmentId: scope === 'division' ? division.id : null, status: 'open' });
    lists.push(r.items.filter((i) => keys.includes(i.source)));
  }
  const items = lists.flat().sort((a, b) => b.daysLate - a.daysLate);
  const labels = Object.fromEntries(sources.map((s) => [s.key, s.label]));
  const counts = {};
  for (const i of items) counts[i.source] = (counts[i.source] || 0) + 1;

  let divisions = [];
  if (has(user, 'management_dashboard.view')) {
    const [rows] = await pool.query('SELECT id, name, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name', [entityId]);
    divisions = [{ id: 'all', name: 'Seluruh perusahaan' }, ...rows.map((r) => ({ id: Number(r.id), name: r.name }))];
  }

  return {
    division,
    divisions,
    // The last month is the running one: its figures are partial ("berjalan").
    months: months.map((p, i) => ({ key: p.key, label: p.label, partial: i === months.length - 1 })),
    kpis,
    metrics,
    escalations: {
      total: items.length,
      bySource: Object.entries(counts).map(([key, count]) => ({ key, label: labels[key] || key, count })).sort((a, b) => b.count - a.count),
      top: items.slice(0, 6).map((i) => ({
        source: i.source, sourceLabel: labels[i.source] || i.source, title: i.title, reference: i.reference, context: i.context,
        daysLate: i.daysLate, severity: i.severity, link: i.link,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------ warm-up
// Fills the series of every division's dashboard (and the company-wide one)
// in the background, one series at a time so it never takes the pool from the
// users: after the process starts and after an Accurate batch is approved, the
// first person to open a dashboard does not wait for 12 months × every metric.
// Every metric is warmed, restricted ones too: a series is only cached, never
// shown — build() still checks the permission of whoever opens the page.
const WARM_CONCURRENCY = 1;
const warming = new Map(); // entityId → { promise, again }
function warmDivisionDashboards(entityId) {
  if (!memo.enabled || !entityId) return Promise.resolve({ series: 0 });
  const running = warming.get(entityId);
  // Asked again while warming (a batch approved meanwhile): run once more after.
  if (running) { running.again = true; return running.promise; }
  const state = { again: false };
  state.promise = (async () => {
    const started = Date.now();
    const months = lastMonths();
    const [rows] = await pool.query('SELECT id, name, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL ORDER BY id', [entityId]);
    const divisions = [{ id: null, name: 'Seluruh perusahaan', code: 'all' }, ...rows.map((r) => ({ id: Number(r.id), name: r.name, code: r.code }))];
    const jobs = [];
    for (const division of divisions) {
      const scopes = providerScopes(division);
      for (const m of registry.metrics()) {
        if (!Object.prototype.hasOwnProperty.call(scopes, m.provider) || hidden(division, 'metrics', m)) continue;
        jobs.push({ division, metric: m, scope: scopes[m.provider] });
      }
    }
    await mapLimit(jobs, WARM_CONCURRENCY, (j) => seriesOf(entityId, j.metric, months, j.division, j.scope).catch(() => null));
    logger.info({ entityId, series: jobs.length, ms: Date.now() - started }, '[dashboard] seri dashboard divisi dihangatkan');
    return { series: jobs.length };
  })().finally(() => {
    warming.delete(entityId);
    if (state.again) warmDivisionDashboards(entityId).catch(() => {});
  });
  warming.set(entityId, state);
  return state.promise;
}

/** Warms every company's dashboards after `delayMs`, without holding anything up. */
function scheduleWarmUp(delayMs = 15000) {
  const timer = setTimeout(async () => {
    try {
      const [entities] = await pool.query('SELECT id FROM entities ORDER BY id');
      for (const e of entities) await warmDivisionDashboards(Number(e.id));
    } catch (error) {
      logger.warn({ err: error.message }, '[dashboard] pemanasan dashboard divisi gagal');
    }
  }, delayMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  build, lastMonths, resolveDivision, listDivisions, providerScopes, combine, isAveraged, entityMonthValue, warmDivisionDashboards, scheduleWarmUp,
  DIVISION_PROVIDERS, HIDE,
};
