// Pure helpers for Target & realisasi (no React, no DOM) — unit tested in
// test/targetsModel.test.js. API: GET/PUT /management-dashboard/targets.
//
// The server stores the targets and computes everything else live — the actual,
// the achievement, the pace and the status. Nothing here recomputes a status: the
// page only formats what the server decided and explains how to read it.

import { formatMoney } from '../../components/format.js';
import { numberLocale } from '../../i18n/language.js';
import { MONTHS_SHORT, MONTHS_LONG } from '../../i18n/names.js';

// billed_monthly: a figure billed once a month (Retail Commerce's marketplace
// recap, dated the month's last day) while its period runs — no pace to judge.
export const STATUSES = ['off_track', 'at_risk', 'on_track', 'achieved', 'billed_monthly', 'no_data', 'no_target'];
export const STATUS_LABELS = {
  on_track: 'Sesuai jalur',
  at_risk: 'Perlu perhatian',
  off_track: 'Tertinggal',
  achieved: 'Tercapai',
  no_target: 'Belum ada target',
  no_data: 'Belum ada data',
  billed_monthly: 'Ditagih bulanan',
};
// The KPI strip: cells that HAVE a target, worst first.
export const SUMMARY_STATUSES = ['off_track', 'at_risk', 'on_track', 'achieved'];

// Every unit a management provider may declare (backend/src/management/contract.js).
// A unit outside this list is not an error: the value still shows, as a plain number.
export const UNITS = ['issue', 'poin', '%', 'hari', 'item', 'rupiah'];
export const UNIT_LABELS = {
  issue: 'issue', poin: 'story point', '%': 'persen', hari: 'hari', item: 'item', rupiah: 'rupiah',
};
// Units that count whole things: a target of 2,5 of them makes no sense.
export const COUNT_UNITS = ['issue', 'poin', 'item'];
const WHOLE_UNITS = ['issue', 'item'];
export function isWholeUnit(unit) { return WHOLE_UNITS.includes(unit); }
export const BETTER = ['higher', 'lower'];
export const PERIOD_TYPES = ['month', 'quarter'];
export const PERIOD_TYPE_OPTIONS = [
  { value: 'month', label: 'Bulan' },
  { value: 'quarter', label: 'Kuartal' },
];

export const NOTE_MAX = 500;
export const TARGET_MAX = 1e9;
export const NO_DATA_TEXT = 'Belum ada data';
// Same fallback as the server (backend/src/management/contract.js).
export const RESTRICTED_TEXT = 'Hanya untuk yang berwenang melihat angka ini';

// ---------------------------------------------------------------------------
// Normalising

const isRow = (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row);
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const idOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
// A finite number, or null. '' / null / undefined are "unknown", never 0.
export function toNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const validYear = (year) => year >= 2000 && year <= 2100;

// 'YYYY-MM' | 'YYYY-Qn' → { type, year, index } or null.
export function parsePeriodKey(value) {
  const key = text(value).toUpperCase();
  const month = MONTH_RE.exec(key);
  if (month && validYear(Number(month[1]))) return { type: 'month', year: Number(month[1]), index: Number(month[2]) };
  const quarter = QUARTER_RE.exec(key);
  if (quarter && validYear(Number(quarter[1]))) return { type: 'quarter', year: Number(quarter[1]), index: Number(quarter[2]) };
  return null;
}
export function isPeriodKey(value) { return parsePeriodKey(value) !== null; }

export const EMPTY_SCOPE = { entityWide: true, departmentId: null, departmentName: null };
export const EMPTY_PERIOD = { type: 'quarter', key: '', start: '', end: '', label: '', elapsedPct: 0, ended: false };

// Same rule as the other management pages: a missing scope is the widest view,
// so the page never claims to be narrowed when the API didn't say so.
function normalizeScope(scope) {
  if (!isRow(scope)) return { ...EMPTY_SCOPE };
  return {
    entityWide: scope.entityWide !== false,
    departmentId: idOrNull(scope.departmentId),
    departmentName: text(scope.departmentName) || null,
  };
}

function normalizePeriod(period) {
  if (!isRow(period)) return { ...EMPTY_PERIOD };
  const parsed = parsePeriodKey(period.key);
  const key = parsed ? text(period.key).toUpperCase() : '';
  const elapsed = toNumber(period.elapsedPct);
  return {
    type: parsed ? parsed.type : (PERIOD_TYPES.includes(period.type) ? period.type : 'quarter'),
    key,
    start: text(period.start),
    end: text(period.end),
    label: text(period.label) || (key ? periodLabel(key) : ''),
    elapsedPct: elapsed === null ? 0 : Math.max(0, Math.min(100, Math.round(elapsed))),
    ended: period.ended === true,
  };
}

function normalizeMetric(row) {
  if (!isRow(row)) return null;
  const key = text(row.key);
  if (!key) return null;
  return {
    key,
    label: text(row.label) || key,
    unit: UNITS.includes(row.unit) ? row.unit : null,
    better: BETTER.includes(row.better) ? row.better : 'higher',
    cumulative: row.cumulative === true,
    provider: text(row.provider) || null,
    providerLabel: text(row.providerLabel) || null,
    // Which division module the number comes from, straight from the API.
    source: text(row.providerLabel) || text(row.source) || null,
  };
}

// A metric this account may not see (e.g. purchase prices): the API sends only its
// name and why, never a number, a target or a cell.
function normalizeRestricted(row) {
  if (!isRow(row)) return null;
  const key = text(row.key);
  if (!key) return null;
  return {
    key,
    label: text(row.label) || key,
    provider: text(row.provider) || null,
    providerLabel: text(row.providerLabel) || null,
    reason: text(row.reason) || RESTRICTED_TEXT,
  };
}

function normalizeDivision(row) {
  if (!isRow(row)) return null;
  const id = idOrNull(row.id);
  if (id === null) return null;
  return { id, name: text(row.name) || `Divisi #${id}` };
}

function uniqueBy(list, keyOf) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item) return false;
    const k = keyOf(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const cellKey = (departmentId, metricKey) => `${departmentId}:${metricKey}`;

// A cell the page cannot place (unknown division/metric) or whose status is not
// one the UI knows is dropped: showing a guessed status would be worse than none.
function normalizeCell(row, divisionIds, metricKeys) {
  if (!isRow(row)) return null;
  const departmentId = idOrNull(row.departmentId);
  const metricKey = text(row.metricKey);
  if (departmentId === null || !divisionIds.has(departmentId) || !metricKeys.has(metricKey)) return null;
  if (!STATUSES.includes(row.status)) return null;
  const target = toNumber(row.target);
  return {
    departmentId,
    metricKey,
    // "no_data" means the realisation is unknown — it must never render as 0.
    actual: row.status === 'no_data' ? null : toNumber(row.actual),
    target: row.status === 'no_target' ? null : target,
    note: text(row.note) || null,
    updatedAt: text(row.updatedAt) || null,
    updatedByName: text(row.updatedByName) || null,
    achievementPct: toNumber(row.achievementPct),
    pacePct: toNumber(row.pacePct),
    status: row.status,
  };
}

export function normalizeTargets(payload) {
  const data = isRow(payload) ? payload : {};
  const metrics = uniqueBy((Array.isArray(data.metrics) ? data.metrics : []).map(normalizeMetric), (m) => m.key);
  const divisions = uniqueBy((Array.isArray(data.divisions) ? data.divisions : []).map(normalizeDivision), (d) => d.id);
  const divisionIds = new Set(divisions.map((d) => d.id));
  const metricKeys = new Set(metrics.map((m) => m.key));
  const cells = uniqueBy(
    (Array.isArray(data.cells) ? data.cells : []).map((row) => normalizeCell(row, divisionIds, metricKeys)),
    (c) => cellKey(c.departmentId, c.metricKey),
  );
  return {
    scope: normalizeScope(data.scope),
    period: normalizePeriod(data.period),
    metrics,
    // A key that is also a visible metric is not restricted: the metric wins.
    restricted: uniqueBy((Array.isArray(data.restricted) ? data.restricted : []).map(normalizeRestricted), (m) => m.key)
      .filter((m) => !metricKeys.has(m.key)),
    divisions,
    cells,
    canEdit: data.canEdit === true,
  };
}

// ---------------------------------------------------------------------------
// Matrix + summary

// A division × metric pair the API did not return reads as "no target, no data".
export function emptyCell(departmentId, metricKey) {
  return {
    departmentId, metricKey, actual: null, target: null, note: null, updatedAt: null, updatedByName: null,
    achievementPct: null, pacePct: null, status: 'no_target',
  };
}

export function emptySummary() {
  return { off_track: 0, at_risk: 0, on_track: 0, achieved: 0, billed_monthly: 0, no_data: 0, withTarget: 0, total: 0 };
}

// rows: one per division, in the server's order, with every metric's cell.
// summary: counts of cells WITH a target, by status (no_data counted apart).
export function buildMatrix(data, module = null) {
  const allMetrics = Array.isArray(data?.metrics) ? data.metrics : [];
  const metrics = module ? allMetrics.filter((m) => m.provider === module) : allMetrics;
  const divisions = Array.isArray(data?.divisions) ? data.divisions : [];
  const byKey = new Map((Array.isArray(data?.cells) ? data.cells : []).map((c) => [cellKey(c.departmentId, c.metricKey), c]));
  const summary = emptySummary();
  for (const division of divisions) {
    for (const metric of allMetrics) {
      const cell = byKey.get(cellKey(division.id, metric.key)) || emptyCell(division.id, metric.key);
      summary.total += 1;
      if (cell.status === 'no_target') continue;
      summary.withTarget += 1;
      summary[cell.status] += 1;
    }
  }
  const rows = divisions.map((division) => {
    const cells = {};
    for (const metric of metrics) {
      cells[metric.key] = byKey.get(cellKey(division.id, metric.key)) || emptyCell(division.id, metric.key);
    }
    return { id: division.id, name: division.name, cells };
  });
  return { metrics, rows, summary };
}

// The modules that report target-able metrics, in API order, each with how
// many of its targets are set and how many are behind. Crossing every division
// with every metric of every module made one 19-column table; one module at a
// time keeps the grid readable and only asks sensible questions.
export function moduleOptions(data) {
  const metrics = Array.isArray(data?.metrics) ? data.metrics : [];
  const cells = Array.isArray(data?.cells) ? data.cells : [];
  const providerOf = new Map(metrics.map((m) => [m.key, m.provider]));
  const out = [];
  const seen = new Map();
  for (const metric of metrics) {
    if (!metric.provider || seen.has(metric.provider)) continue;
    const option = { value: metric.provider, label: metric.providerLabel || metric.source || metric.provider, withTarget: 0, offTrack: 0 };
    seen.set(metric.provider, option);
    out.push(option);
  }
  for (const cell of cells) {
    const option = seen.get(providerOf.get(cell.metricKey));
    if (!option || cell.status === 'no_target') continue;
    option.withTarget += 1;
    if (cell.status === 'off_track') option.offTrack += 1;
  }
  return out;
}

// One cell as one URL-safe word: /targets?ubah=<departmentId>-<metricKey> opens
// its edit dialog, and Prakasa AI's audit names the record with it.
export function targetRecordId(departmentId, metricKey) {
  if (!departmentId || !metricKey) return '';
  return `${departmentId}-${metricKey}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}
// { division, metric, cell } of that word — whatever module chip is selected.
export function findTargetCell(data, recordId) {
  const wanted = String(recordId || '');
  if (!wanted) return null;
  const { metrics, rows } = buildMatrix(data);
  for (const division of rows) {
    const metric = metrics.find((item) => targetRecordId(division.id, item.key) === wanted);
    if (metric) return { division, metric, cell: division.cells[metric.key] };
  }
  return null;
}

// The module shown: the one asked for when it exists, else the first module
// that already has targets (so a returning manager lands on their work), else
// the first module.
export function pickModule(options, requested) {
  if (requested && options.some((o) => o.value === requested)) return requested;
  return (options.find((o) => o.withTarget > 0) || options[0])?.value || null;
}

// One line per reason naming the metrics this account does not see, for the module
// shown — plus those of a module with nothing visible, which has no chip and would
// otherwise never be explained. No module (nothing visible at all): every line.
//   "Nilai PO (sebelum PPN) tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat harga beli."
export function restrictedNotes(data, module = null) {
  const restricted = Array.isArray(data?.restricted) ? data.restricted : [];
  const withChip = new Set((Array.isArray(data?.metrics) ? data.metrics : []).map((m) => m.provider));
  const byReason = new Map();
  for (const metric of restricted) {
    if (module && metric.provider !== module && withChip.has(metric.provider)) continue;
    const labels = byReason.get(metric.reason) || [];
    labels.push(metric.label);
    byReason.set(metric.reason, labels);
  }
  return [...byReason].map(([reason, labels]) => `${labels.join(', ')} tidak ditampilkan untuk akun Anda. ${reason.replace(/\.+$/, '')}.`);
}

// Worst first, for sorting a metric column by how it is doing.
export function statusRank(status) {
  const index = STATUSES.indexOf(status);
  return index === -1 ? STATUSES.length : index;
}

// ---------------------------------------------------------------------------
// Wording

// One decimal at most, Indonesian grouping ("1.234,5"); money goes through
// components/format.js like every other page.
const ONE_DECIMAL = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 1 });
function formatNumber(value) {
  return ONE_DECIMAL.format(value);
}

// The one number formatter of the management pages (Target & realisasi and the
// Management Dashboard share it), driven only by the unit the API sends:
//   75 + '%' → "75%", 1.5 + 'hari' → "1,5 hari", 1234000 + 'rupiah' → "Rp 1.234.000",
//   6 + 'issue' → "6 issue" — or "6" with { countUnit: false }, where the label
//   already says what is being counted. An unknown unit falls back to the number.
// Returns null for an unknown value, so the caller decides how "unknown" reads.
export function formatValue(value, unit, { countUnit = true } = {}) {
  const n = toNumber(value);
  if (n === null) return null;
  if (unit === 'rupiah') return formatMoney(n);
  const number = formatNumber(n);
  if (unit === '%') return `${number}%`;
  if (unit === 'hari') return `${number} hari`;
  if (COUNT_UNITS.includes(unit)) return countUnit ? `${number} ${unit}` : number;
  return number;
}

export function actualText(cell, metric) {
  if (!cell || cell.status === 'no_data') return NO_DATA_TEXT;
  return formatValue(cell.actual, metric?.unit) ?? NO_DATA_TEXT;
}

// "6 issue" for higher-is-better; "maks. 1 hari" when lower is better — the
// target is then a ceiling, not something to reach.
export function targetText(cell, metric) {
  const value = formatValue(cell?.target, metric?.unit);
  if (value === null) return '—';
  return metric?.better === 'lower' ? `maks. ${value}` : value;
}

export function directionText(metric) {
  return metric?.better === 'lower' ? 'Lebih rendah lebih baik' : 'Lebih tinggi lebih baik';
}

export function unitLabel(unit) { return UNIT_LABELS[unit] || 'angka'; }

const pct = (value) => `${formatNumber(value)}%`;

// One short line under a cell's figures: "Laju 34%" while a cumulative period
// runs, otherwise "Capaian 100%". Empty when there is nothing to measure.
export function shortPaceText(cell, metric) {
  if (!cell || cell.status === 'no_target' || cell.status === 'no_data') return '';
  if (cell.status === 'billed_monthly') return 'Ditagih bulanan';
  if (metric?.cumulative && cell.pacePct !== null) return `Laju ${pct(cell.pacePct)}`;
  if (cell.achievementPct !== null) return `Capaian ${pct(cell.achievementPct)}`;
  return '';
}

// The full, honest explanation of how a cell is judged.
export function paceText(cell, metric, period) {
  if (!cell || cell.status === 'no_target') return 'Belum ada target untuk periode ini.';
  if (cell.status === 'no_data') {
    return 'Target sudah ada, tetapi belum ada data realisasi pada periode ini — ini bukan berarti nol.';
  }
  if (cell.status === 'billed_monthly') {
    return 'Ditagih bulanan: omzet marketplace masuk sebagai satu faktur rekap per akhir bulan, jadi selama periode berjalan belum ada laju yang bisa dinilai. Dinilai setelah periode selesai.';
  }
  if (metric?.cumulative) {
    if (cell.pacePct !== null) {
      const elapsed = period?.elapsedPct ?? 0;
      return `Laju: ${pct(cell.pacePct)} dari yang seharusnya tercapai saat ini (periode berjalan ${elapsed}%, jadi sekitar ${elapsed}% target seharusnya sudah tercapai).`;
    }
    if (cell.achievementPct !== null) {
      return period?.ended
        ? `Capaian akhir: ${pct(cell.achievementPct)} dari target.`
        : `Capaian: ${pct(cell.achievementPct)} dari target.`;
    }
    return '';
  }
  if (metric?.better === 'lower') {
    if (cell.achievementPct === null) return 'Lebih rendah lebih baik: target adalah batas atas.';
    return cell.achievementPct >= 100
      ? 'Lebih rendah lebih baik: realisasi sudah di bawah atau sama dengan batas target.'
      : `Lebih rendah lebih baik: realisasi melewati batas target (capaian ${pct(cell.achievementPct)}).`;
  }
  return cell.achievementPct === null ? '' : `Capaian: ${pct(cell.achievementPct)} dari target.`;
}

// How a metric is judged, for the legend under the matrix.
export function metricRule(metric) {
  // Four whole sentences: each has its own translation.
  const lower = metric?.better === 'lower';
  if (metric?.cumulative) {
    return lower
      ? 'Lebih rendah lebih baik; dihitung kumulatif dan dinilai dari laju selama periode berjalan.'
      : 'Lebih tinggi lebih baik; dihitung kumulatif dan dinilai dari laju selama periode berjalan.';
  }
  return lower ? 'Lebih rendah lebih baik; dinilai dari angka saat ini.' : 'Lebih tinggi lebih baik; dinilai dari angka saat ini.';
}

export function periodProgressText(period, today = new Date()) {
  if (!period?.key) return '';
  if (period.ended) return 'Periode selesai';
  if (period.start && period.start > isoDate(today)) return 'Periode belum dimulai';
  return `Periode berjalan ${period.elapsedPct}%`;
}

// ---------------------------------------------------------------------------
// Periods


function isoDate(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const safeDate = (today) => (today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date());

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
export const quarterKey = (year, quarter) => `${year}-Q${quarter}`;

// Same wording as the server's period.label.
export function periodLabel(key) {
  const parsed = parsePeriodKey(key);
  if (!parsed) return '';
  if (parsed.type === 'month') return `${MONTHS_LONG[parsed.index - 1]} ${parsed.year}`;
  const first = (parsed.index - 1) * 3;
  return `Kuartal ${parsed.index} ${parsed.year} (${MONTHS_SHORT[first]}–${MONTHS_SHORT[first + 2]})`;
}

// The server's default when no period is asked for: the current quarter.
export function currentPeriodKey(type = 'quarter', today = new Date()) {
  const d = safeDate(today);
  return type === 'month'
    ? monthKey(d.getFullYear(), d.getMonth() + 1)
    : quarterKey(d.getFullYear(), Math.floor(d.getMonth() / 3) + 1);
}

export function periodType(key) { return parsePeriodKey(key)?.type || 'quarter'; }

// Switching Bulan ⇄ Kuartal keeps the same stretch of time: a month becomes its
// quarter; a quarter becomes today's month when today falls in it, else its first month.
export function convertPeriod(key, type, today = new Date()) {
  const parsed = parsePeriodKey(key);
  if (!parsed) return currentPeriodKey(type, today);
  if (parsed.type === type) return quarterOrMonthKey(parsed);
  if (type === 'quarter') return quarterKey(parsed.year, Math.floor((parsed.index - 1) / 3) + 1);
  const d = safeDate(today);
  const month = d.getMonth() + 1;
  const inQuarter = d.getFullYear() === parsed.year && Math.floor((month - 1) / 3) + 1 === parsed.index;
  return monthKey(parsed.year, inQuarter ? month : (parsed.index - 1) * 3 + 1);
}
function quarterOrMonthKey(parsed) {
  return parsed.type === 'month' ? monthKey(parsed.year, parsed.index) : quarterKey(parsed.year, parsed.index);
}

export const MONTHS_BACK = 12;
export const MONTHS_AHEAD = 3;
export const QUARTERS_BACK = 4;
export const QUARTERS_AHEAD = 2;

// Months and quarters around today, oldest first, as Select options. A `current`
// key outside that window (e.g. from a shared link) is added so it stays selectable.
export function periodOptions(today = new Date(), current = '') {
  const d = safeDate(today);
  const month = [];
  for (let offset = -MONTHS_BACK; offset <= MONTHS_AHEAD; offset += 1) {
    const at = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    const key = monthKey(at.getFullYear(), at.getMonth() + 1);
    month.push({ value: key, label: periodLabel(key) });
  }
  const quarter = [];
  const baseIndex = d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
  for (let offset = -QUARTERS_BACK; offset <= QUARTERS_AHEAD; offset += 1) {
    const index = baseIndex + offset;
    const key = quarterKey(Math.floor(index / 4), (index % 4) + 1);
    quarter.push({ value: key, label: periodLabel(key) });
  }
  const parsed = parsePeriodKey(current);
  if (parsed) {
    const key = quarterOrMonthKey(parsed);
    const list = parsed.type === 'month' ? month : quarter;
    if (!list.some((option) => option.value === key)) {
      list.push({ value: key, label: periodLabel(key) });
      list.sort((a, b) => sortablePeriod(a.value) - sortablePeriod(b.value));
    }
  }
  return { month, quarter };
}
function sortablePeriod(key) {
  const p = parsePeriodKey(key);
  if (!p) return 0;
  return p.type === 'month' ? p.year * 12 + p.index : p.year * 12 + (p.index - 1) * 3 + 1;
}

// ---------------------------------------------------------------------------
// Period ⇄ URL (a shared link opens the same period)

export function readTargetParams(searchParams) {
  const raw = searchParams?.get?.('period') || '';
  const parsed = parsePeriodKey(raw);
  const module = searchParams?.get?.('modul') || '';
  return { period: parsed ? quarterOrMonthKey(parsed) : '', module: /^[a-z][a-z0-9_]{1,39}$/.test(module) ? module : '' };
}

// A NEW URLSearchParams with only `period` changed, so other params survive.
export function writeTargetParams(searchParams, patch) {
  const next = new URLSearchParams(searchParams);
  if (patch && 'period' in patch) {
    const parsed = parsePeriodKey(patch.period);
    if (parsed) next.set('period', quarterOrMonthKey(parsed));
    else next.delete('period');
  }
  if (patch && 'module' in patch) {
    if (patch.module) next.set('modul', patch.module);
    else next.delete('modul');
  }
  return next;
}

export function targetQuery(period) {
  const parsed = parsePeriodKey(period);
  return parsed ? { period: quarterOrMonthKey(parsed) } : undefined;
}

// ---------------------------------------------------------------------------
// Edit form

export function targetForm(cell) {
  return {
    value: cell?.target === null || cell?.target === undefined ? '' : String(cell.target),
    note: cell?.note || '',
  };
}

// { value: number|null, error: string }. Mirrors the server's rules so the user
// hears about a bad number before the round trip; the server still decides.
export function validateTargetInput(value, metric) {
  const raw = typeof value === 'number' ? String(value) : text(value);
  if (raw === '') return { value: null, error: 'Isi target. Untuk mengosongkannya, pakai "Hapus target".' };
  const n = toNumber(raw);
  if (n === null) return { value: null, error: 'Target harus berupa angka.' };
  if (n < 0) return { value: null, error: 'Target tidak boleh negatif.' };
  if (metric?.unit === '%' && n > 100) return { value: null, error: 'Target persentase maksimal 100.' };
  if (n > TARGET_MAX) return { value: null, error: 'Target terlalu besar.' };
  if (isWholeUnit(metric?.unit) && !Number.isInteger(n)) return { value: null, error: `Jumlah ${metric.unit} harus bilangan bulat.` };
  return { value: n, error: '' };
}

// Helper text under the target field.
export function targetHint(metric) {
  if (metric?.cumulative) return 'Target untuk seluruh periode. Selama periode berjalan, penilaiannya memakai laju.';
  if (metric?.better === 'lower') return 'Isi batas maksimal yang masih dianggap tercapai.';
  if (metric?.unit === '%') return 'Antara 0 dan 100.';
  return 'Angka 0 atau lebih.';
}

export function validateNote(note) {
  return String(note || '').length > NOTE_MAX ? `Maksimal ${NOTE_MAX} karakter.` : '';
}

// targetValue null clears the target. The note is always sent (null clears it).
export function targetPayload({ departmentId, metricKey, period, value, note }) {
  const cleanNote = String(note || '').trim();
  return {
    departmentId,
    metricKey,
    period,
    targetValue: value === null || value === undefined ? null : value,
    note: value === null || value === undefined ? null : (cleanNote || null),
  };
}
