// Dashboard divisi: how the page arranges what the server sends, in the six
// sections every dashboard keeps (components/DashboardSection.jsx).
import { formatMetric } from '../../components/charts/chartModel.js';

const PROVIDER_ORDER = ['retail_commerce', 'marketing', 'finance_ledger', 'finance', 'sales', 'warehouse', 'procurement', 'hrga', 'it', 'ga', 'accurate', 'flow', 'approvals', 'project_tracker'];
const orderOf = (key) => { const i = PROVIDER_ORDER.indexOf(key); return i < 0 ? PROVIDER_ORDER.length : i; };

/** Headline figures grouped by module, the division's own modules first. */
export function kpiGroups(kpis = []) {
  const groups = new Map();
  for (const k of kpis) {
    if (!groups.has(k.provider)) groups.set(k.provider, { provider: k.provider, label: k.providerLabel, kpis: [] });
    groups.get(k.provider).kpis.push(k);
  }
  return [...groups.values()].sort((a, b) => orderOf(a.provider) - orderOf(b.provider));
}

const known = (values) => values.filter((v) => v !== null && v !== undefined).length;

/** Trend cards: measures with at least two months of data and something in them (not all zero), own modules first. */
export function trendCards(metrics = []) {
  return metrics
    .filter((m) => known(m.values) >= 2 && m.values.some((v) => v !== null && v !== undefined && Number(v) !== 0))
    .sort((a, b) => orderOf(a.provider) - orderOf(b.provider) || a.label.localeCompare(b.label));
}

/**
 * The motion chart's runners: measures with data in at least three months
 * and some movement (a flat line has nothing to race), at most eight.
 */
export function motionSeries(metrics = [], max = 8) {
  return trendCards(metrics)
    .filter((m) => known(m.values) >= 3 && new Set(m.values.filter((v) => v !== null)).size > 1)
    .slice(0, max)
    .map((m) => ({ key: `${m.provider}.${m.key}`, label: m.label, unit: m.unit, better: m.better, values: m.values, targets: m.targets }));
}

/**
 * Section 2, "Perlu perhatian": how many open escalations each source holds,
 * as bars (the longest bar is the busiest source). Red: every one is late.
 */
export function attentionItems(escalations) {
  return (escalations?.bySource || [])
    .filter((s) => Number(s.count) > 0)
    .map((s) => ({ key: s.key, label: s.label, value: Number(s.count), display: String(Number(s.count)), tone: 'error' }));
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

/**
 * Section 5, "Capaian terhadap target": for every measure that has a monthly
 * target, how far the last complete month got — the month a trend card leads
 * with — as a share of its target. A "lower is better" measure is met when it
 * stays under the target; above it the share is target/actual. Only measures
 * with a target that month are listed; none means no targets were set.
 */
export function targetProgress(metrics = [], months = []) {
  const n = months.length;
  const i = n - 2;
  if (i < 0) return { month: null, items: [] };
  const items = [];
  for (const m of metrics) {
    const target = m.targets?.[i];
    const actual = m.values?.[i];
    if (target === null || target === undefined || Number(target) <= 0) continue;
    if (actual === null || actual === undefined) continue;
    const a = Number(actual); const t = Number(target);
    const lower = m.better === 'lower';
    const met = lower ? a <= t : a >= t;
    const share = met ? 100 : (lower ? pct(t, a) : pct(a, t)) ?? 0;
    items.push({
      key: `${m.provider}.${m.key}`,
      label: m.label,
      value: Math.max(0, Math.min(100, share)),
      display: `${Math.max(0, Math.min(999, share))}%`,
      note: `${formatMetric(a, m.unit, { compact: true })} dari target ${formatMetric(t, m.unit, { compact: true })}`,
      tone: met ? 'success' : (share >= 80 ? 'warning' : 'error'),
      met,
    });
  }
  items.sort((a, b) => a.value - b.value || a.label.localeCompare(b.label));
  return { month: months[i]?.label || null, items };
}

/** Section 6, "Pekerjaan lewat tenggat": the rows of the work table. */
export function overdueRows(escalations) {
  return (escalations?.top || []).map((i, n) => ({ ...i, id: `${i.source}-${n}` }));
}

/**
 * The figure a trend card leads with: the last COMPLETE month (the current
 * month is still running) compared with the month before it, plus the
 * running month so far.
 */
export function headline(metric, months) {
  const n = metric.values.length;
  const complete = metric.values.slice(0, Math.max(0, n - 1));
  let i = complete.length - 1;
  while (i >= 0 && (complete[i] === null || complete[i] === undefined)) i -= 1;
  let j = i - 1;
  while (j >= 0 && (complete[j] === null || complete[j] === undefined)) j -= 1;
  const value = i >= 0 ? Number(complete[i]) : null;
  const prev = j >= 0 ? Number(complete[j]) : null;
  const change = value !== null && prev !== null ? value - prev : null;
  const direction = change === null || change === 0 ? 'flat' : (change > 0 ? 'up' : 'down');
  const good = direction === 'flat' ? null : (metric.better === 'lower' ? change < 0 : change > 0);
  return {
    value,
    month: i >= 0 ? months[i]?.label : null,
    prevMonth: j >= 0 ? months[j]?.label : null,
    change,
    direction,
    good,
    running: metric.values[n - 1] ?? null,
    runningMonth: months[n - 1]?.label || null,
  };
}
