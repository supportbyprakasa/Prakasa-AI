// Dashboard divisi: how the page arranges what the server sends.

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
