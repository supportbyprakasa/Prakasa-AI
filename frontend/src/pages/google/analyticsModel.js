import { numberLocale } from '../../i18n/language.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';
// Pure helpers for the Google Analytics page (tested in test/googleAnalyticsModel.test.js):
// number/duration/percent formatting, period-over-period deltas, chart scaling
// and the setup checklist. No React here.

export const RANGE_PRESETS = [
  { key: '7d', label: '7 hari' },
  { key: '28d', label: '28 hari' },
  { key: '90d', label: '90 hari' },
  { key: 'custom', label: 'Kustom' },
];

// Server returns these keys (googleAnalytics.service.js shapeKpis).
export const KPI_DEFS = [
  { key: 'activeUsers', label: 'Pengguna aktif', format: 'number' },
  { key: 'sessions', label: 'Sesi', format: 'number' },
  { key: 'screenPageViews', label: 'Tampilan halaman', format: 'number' },
  { key: 'avgEngagementTime', label: 'Rata-rata durasi engagement', format: 'duration' },
  { key: 'engagementRate', label: 'Engagement rate', format: 'percent' },
  { key: 'bounceRate', label: 'Bounce rate', format: 'percent', lowerIsBetter: true },
];

export const SERIES = [
  { key: 'activeUsers', label: 'Pengguna aktif' },
  { key: 'sessions', label: 'Sesi' },
];

// ---- Formatting -----------------------------------------------------------

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function formatNumber(value) {
  return Math.round(toNumber(value)).toLocaleString(numberLocale());
}

// Compact axis labels: 950, 1,2 rb, 3,4 jt.
export function formatCompact(value) {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const trim = (x) => x.toLocaleString(numberLocale(), { maximumFractionDigits: 1 });
  if (abs >= 1e6) return `${trim(n / 1e6)} jt`;
  if (abs >= 1e3) return `${trim(n / 1e3)} rb`;
  return trim(n);
}

// Ratio 0–1 → "45,2%".
export function formatPercent(ratio) {
  return `${(toNumber(ratio) * 100).toLocaleString(numberLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Seconds → "45 dtk", "2 mnt 05 dtk", "1 jam 02 mnt".
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(toNumber(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h) return `${h} jam ${pad(m)} mnt`;
  if (m) return `${m} mnt ${pad(s)} dtk`;
  return `${s} dtk`;
}

export function formatKpi(format, value) {
  if (format === 'duration') return formatDuration(value);
  if (format === 'percent') return formatPercent(value);
  return formatNumber(value);
}


// "2026-09-21" → "21 Sep" (withYear: "21 Sep 2026").
export function formatDay(isoDate, withYear = false) {
  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

// ---- Period-over-period ---------------------------------------------------

// Percent change vs the previous period; null when there is no base to compare.
export function deltaPercent(value, previous) {
  const now = toNumber(value);
  const before = toNumber(previous);
  if (before === 0) return now === 0 ? 0 : null;
  return ((now - before) / before) * 100;
}

// Rate metrics (engagement/bounce) compare in percentage points would also be
// valid, but a relative % keeps every tile consistent.
export function deltaTrend(delta, lowerIsBetter = false) {
  if (delta === null || delta === undefined) return 'none';
  if (Math.abs(delta) < 0.05) return 'flat';
  const up = delta > 0;
  return up !== Boolean(lowerIsBetter) ? 'good' : 'bad';
}

export function formatDelta(delta) {
  if (delta === null || delta === undefined) return 'Baru';
  if (Math.abs(delta) < 0.05) return '0%';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toLocaleString(numberLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function kpiTiles(kpis = []) {
  const byKey = new Map(kpis.map((item) => [item.key, item]));
  return KPI_DEFS.map((def) => {
    const item = byKey.get(def.key) || { value: 0, previous: 0 };
    const delta = deltaPercent(item.value, item.previous);
    return {
      ...def,
      value: formatKpi(def.format, item.value),
      previous: formatKpi(def.format, item.previous),
      delta,
      deltaLabel: formatDelta(delta),
      trend: deltaTrend(delta, def.lowerIsBetter),
    };
  });
}

// ---- Chart scaling --------------------------------------------------------

// Smallest "nice" number (1, 2, 2.5, 5 × 10^n) ≥ value.
export function niceCeil(value) {
  const n = toNumber(value);
  if (n <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(n));
  const f = n / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

// Evenly spaced ticks from 0 with a nice whole-number step (counts are
// integers); the last tick ≥ max.
export function niceTicks(max, count = 4) {
  const step = Math.max(1, niceCeil(toNumber(max) / count));
  const ticks = [];
  for (let v = 0; v < max + step && ticks.length <= count + 1; v += step) ticks.push(v);
  if (ticks.length < 2) ticks.push(step);
  return ticks.map((v) => Math.round(v * 1000) / 1000);
}

// Which x indices get a date label, evenly spread, always including the last.
export function labelIndices(length, maxLabels) {
  if (length <= 0) return [];
  if (length <= maxLabels) return Array.from({ length }, (_, i) => i);
  const step = Math.ceil((length - 1) / (maxLabels - 1));
  const out = [];
  for (let i = 0; i < length; i += step) out.push(i);
  if (out[out.length - 1] !== length - 1) {
    if (length - 1 - out[out.length - 1] < step / 2) out.pop();
    out.push(length - 1);
  }
  return out;
}

// Geometry for the daily line chart. Returns plain numbers/strings so the
// component only draws. `points`: [{ date, activeUsers, sessions }].
export function buildLineChart(points = [], { width, height, pad = { top: 16, right: 16, bottom: 28, left: 44 }, maxLabels = 7 } = {}) {
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const max = Math.max(0, ...points.flatMap((p) => SERIES.map((s) => toNumber(p[s.key]))));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i) => pad.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (toNumber(v) / top) * innerH;
  const round = (n) => Math.round(n * 10) / 10;
  const lines = SERIES.map((series) => ({
    ...series,
    path: points.map((p, i) => `${i ? 'L' : 'M'}${round(x(i))},${round(y(p[series.key]))}`).join(' '),
    end: points.length ? { x: round(x(points.length - 1)), y: round(y(points[points.length - 1][series.key])) } : null,
  }));
  return {
    width,
    height,
    pad,
    lines,
    yTicks: ticks.map((value) => ({ value, y: round(y(value)), label: formatCompact(value) })),
    xLabels: labelIndices(points.length, maxLabels).map((i) => ({ i, x: round(x(i)), label: formatDay(points[i].date) })),
    x: (i) => round(x(i)),
    y: (v) => round(y(v)),
    // Nearest data index for a pointer x position (hover/crosshair).
    indexAt(px) {
      if (points.length <= 1) return 0;
      const i = Math.round(((px - pad.left) / innerW) * (points.length - 1));
      return Math.min(points.length - 1, Math.max(0, i));
    },
  };
}

// ---- Breakdown lists ------------------------------------------------------

const CHANNEL_LABELS = {
  Direct: 'Langsung',
  'Organic Search': 'Penelusuran organik',
  'Paid Search': 'Penelusuran berbayar',
  'Organic Social': 'Sosial organik',
  'Paid Social': 'Sosial berbayar',
  Referral: 'Rujukan',
  Email: 'Email',
  'Organic Video': 'Video organik',
  Display: 'Display',
  Unassigned: 'Tidak ditetapkan',
  '(not set)': 'Tidak diketahui',
};
const DEVICE_LABELS = { desktop: 'Desktop', mobile: 'Seluler', tablet: 'Tablet', smart_tv: 'Smart TV', '(not set)': 'Tidak diketahui' };

export const channelLabel = (label) => CHANNEL_LABELS[label] || label;
export const deviceLabel = (label) => DEVICE_LABELS[label] || label;
export const countryLabel = (label) => (label === '(not set)' ? 'Tidak diketahui' : label);

// Adds share-of-total (0–100) for the bar lists; bars are scaled to the largest row.
export function withShares(rows = [], labelFn = (label) => label) {
  const total = rows.reduce((sum, row) => sum + toNumber(row.value), 0);
  const max = Math.max(0, ...rows.map((row) => toNumber(row.value)));
  return rows.map((row) => ({
    key: row.label,
    label: labelFn(row.label),
    value: toNumber(row.value),
    share: total ? (toNumber(row.value) / total) * 100 : 0,
    bar: max ? (toNumber(row.value) / max) * 100 : 0,
  }));
}

// ---- Setup checklist ------------------------------------------------------

// reason from GET /google-analytics/status → which step is the blocker.
export function setupSteps(reason) {
  const blocker = { NOT_CONFIGURED: 0, API_DISABLED: 1, NO_ACCESS: 2, NO_PROPERTIES: 2 }[reason] ?? 1;
  return ['serviceAccount', 'enableApis', 'grantAccess'].map((key, index) => ({
    key,
    state: index < blocker ? 'done' : index === blocker ? 'todo' : 'waiting',
  }));
}

export function isValidCustomRange(start, end, today) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return re.test(start || '') && re.test(end || '') && start <= end && end <= today;
}

export const SETUP_REASON_TEXT = {
  NOT_CONFIGURED: 'Service account Google belum diisi di konfigurasi server.',
  API_DISABLED: 'API Google Analytics belum diaktifkan di Google Cloud project milik service account.',
  NO_ACCESS: 'Service account belum punya akses ke Google Analytics.',
  NO_PROPERTIES: 'Service account belum ditambahkan ke properti Google Analytics mana pun.',
};

export const setupReasonText = (reason) => SETUP_REASON_TEXT[reason] || 'Google Analytics belum siap dipakai.';

// Local calendar date as YYYY-MM-DD (the date inputs work in local time).
export function localIsoDate(date = new Date(), offsetDays = 0) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Share of a bar list row: "12,5%" (one decimal at most).
export function formatShare(value) {
  return `${toNumber(value).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })}%`;
}
