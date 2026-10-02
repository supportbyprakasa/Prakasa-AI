const { memo } = require('../utils/memo');

// Shared figures of the management views (load test, 1 Oct 2026). A KPI, a
// metric's actuals or an escalation source's items depend only on the company
// and the division asked for — never on who asks: the permission check of a
// restricted figure happens before it is asked. So the Management Dashboard,
// the division dashboards, Target & realisasi and Pusat Eskalasi share one
// computation per (company, division, figure) for FIGURE_TTL_MS, instead of
// each page asking MySQL the same questions. Single-flight comes with the memo.
// Dropped by any module write and by an approved Accurate batch (utils/memo.js).
const FIGURE_TTL_MS = 120 * 1000;
const dept = (departmentId) => (departmentId == null ? 'all' : Number(departmentId));

function kpiValue(kpi, entityId, { departmentId = null } = {}) {
  const key = `mgmtkpi:k:${entityId}:${dept(departmentId)}:${kpi.provider}.${kpi.key}`;
  return memo.get(key, FIGURE_TTL_MS, () => kpi.value(entityId, { departmentId }));
}

const periodKey = (period) => `${period.type || 'month'}:${period.start}:${period.end}`;

function metricActuals(metric, entityId, period, { departmentId = null } = {}) {
  const key = `mgmtkpi:m:${entityId}:${dept(departmentId)}:${metric.provider}.${metric.key}:${periodKey(period)}`;
  return memo.get(key, FIGURE_TTL_MS, () => metric.actuals(entityId, period, { departmentId }));
}

function metricEntityActuals(metric, entityId, period) {
  const key = `mgmtkpi:e:${entityId}:${metric.provider}.${metric.key}:${periodKey(period)}`;
  return memo.get(key, FIGURE_TTL_MS, () => metric.entityActuals(entityId, period));
}

function escalationItems(source, entityId, { departmentId = null } = {}) {
  const key = `esc:${entityId}:${dept(departmentId)}:${source.key}`;
  return memo.get(key, FIGURE_TTL_MS, () => source.list(entityId, { departmentId }));
}

module.exports = {
  kpiValue, metricActuals, metricEntityActuals, escalationItems, FIGURE_TTL_MS,
};
