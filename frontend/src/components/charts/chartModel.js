import { formatMoney, formatNumber, formatQty } from '../format.js';
import { numberLocale } from '../../i18n/language.js';

// Pure helpers for the dashboard charts (TrendChart, MotionChart): scales,
// SVG paths, value formatting by unit, and the motion chart's scores.

const INT = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 1 });

/** "Rp 1,2 M" · "Rp 350 jt" · "Rp 12 rb" — rupiah short enough for a chart. */
export function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}Rp ${INT.format(abs / 1e12)} T`;
  if (abs >= 1e9) return `${sign}Rp ${INT.format(abs / 1e9)} M`;
  if (abs >= 1e6) return `${sign}Rp ${INT.format(abs / 1e6)} jt`;
  if (abs >= 1e3) return `${sign}Rp ${INT.format(abs / 1e3)} rb`;
  return formatMoney(n);
}

/** A metric value with its unit: rupiah, %, hari, or a plain count. */
export function formatMetric(value, unit, { compact = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (unit === 'rupiah') return compact ? compactMoney(n) : formatMoney(n);
  if (unit === '%') return `${formatQty(Math.round(n * 10) / 10)}%`;
  if (unit === 'hari') return `${formatQty(Math.round(n * 10) / 10)} hari`;
  if (unit === 'jam') return `${formatQty(Math.round(n * 10) / 10)} jam`;
  return Number.isInteger(n) ? formatNumber(n) : formatQty(Math.round(n * 10) / 10);
}

/** Round axis bounds and ticks covering [min, max] (zero included). */
export function niceScale(values, tickCount = 4) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  let lo = Math.min(0, ...nums);
  let hi = Math.max(0, ...nums);
  if (!nums.length || hi === lo) hi = lo + 1;
  const raw = (hi - lo) / tickCount;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { min: lo, max: hi, ticks };
}

/** Points of a series in a box; a missing value breaks the line. */
export function seriesPoints(values, { width, height, padX = 0, scale }) {
  const n = values.length;
  const span = scale.max - scale.min || 1;
  return values.map((v, i) => {
    const x = padX + (n <= 1 ? (width - 2 * padX) / 2 : (i * (width - 2 * padX)) / (n - 1));
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return { x, y: null, value: null, index: i };
    return { x, y: height - ((Number(v) - scale.min) / span) * height, value: Number(v), index: i };
  });
}

const r = (n) => Math.round(n * 10) / 10;

/** "M x y L x y …"; a null starts a new segment. */
export function linePath(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.y === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${r(p.x)} ${r(p.y)} `;
    pen = true;
  }
  return d.trim();
}

/** The area under each segment down to `baseY`. */
export function areaPath(points, baseY) {
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.y === null) { if (current.length) segments.push(current); current = []; } else current.push(p);
  }
  if (current.length) segments.push(current);
  return segments.filter((s) => s.length > 1)
    .map((s) => `M${r(s[0].x)} ${r(baseY)} ${s.map((p) => `L${r(p.x)} ${r(p.y)}`).join(' ')} L${r(s[s.length - 1].x)} ${r(baseY)} Z`)
    .join(' ');
}

/** Last value, the one before, and whether the change is good for this metric. */
export function delta(values, better = 'higher') {
  const known = values.map((v, i) => ({ v, i })).filter(({ v }) => v !== null && v !== undefined && Number.isFinite(Number(v)));
  if (!known.length) return { last: null, prev: null, change: null, direction: 'flat', good: null };
  const last = Number(known[known.length - 1].v);
  const prev = known.length > 1 ? Number(known[known.length - 2].v) : null;
  if (prev === null) return { last, prev, change: null, direction: 'flat', good: null };
  const change = last - prev;
  const direction = change > 0 ? 'up' : (change < 0 ? 'down' : 'flat');
  const good = direction === 'flat' ? null : (better === 'lower' ? change < 0 : change > 0);
  return { last, prev, change, direction, good };
}

/**
 * Motion chart scores for one month: how each metric did, on one scale.
 * With a target that month: achievement vs the target. Without: compared
 * with the metric's own best month in the window (100 = its best). Lower-is-
 * better metrics (days) are turned around, so a longer bar is always better.
 * Capped at 150 so one outlier cannot flatten the rest.
 */
export function motionScores(series, monthIndex) {
  return series.map((s) => {
    const value = s.values[monthIndex];
    const target = s.targets?.[monthIndex] ?? null;
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return { key: s.key, label: s.label, translate: s.translate, unit: s.unit, value: null, score: null, basis: null };
    }
    const v = Number(value);
    let score;
    let basis;
    if (target !== null && Number(target) > 0) {
      basis = 'target';
      score = s.better === 'lower' ? (v <= 0 ? 150 : (Number(target) / v) * 100) : (v / Number(target)) * 100;
    } else {
      basis = 'best';
      const known = s.values.filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
      if (s.better === 'lower') {
        const positive = known.filter((x) => x > 0);
        const best = positive.length ? Math.min(...positive) : 0;
        score = v <= 0 ? 100 : (best / v) * 100;
      } else {
        const best = Math.max(...known);
        score = best <= 0 ? 0 : (v / best) * 100;
      }
    }
    return { key: s.key, label: s.label, translate: s.translate, unit: s.unit, value: v, score: Math.max(0, Math.min(150, Math.round(score))), basis };
  });
}

/** Scores ranked best first; metrics with no value that month go last. */
export function rankScores(scores) {
  return [...scores].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.label.localeCompare(b.label));
}
