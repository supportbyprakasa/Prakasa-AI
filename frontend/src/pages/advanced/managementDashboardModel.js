// Pure helpers for the Management Dashboard (no React, no DOM) — unit tested in
// test/managementDashboardModel.test.js. API: GET /management-dashboard/summary.
//
// This module knows NO division module, KPI or escalation source. Every module
// reports into management through a provider on the server
// (docs/management-integration.md) and the summary lists whatever those providers
// return, so a module added on the server shows up here without a frontend change.
// The page only groups the KPIs by the module label the API sends and formats each
// value by the unit the API sends.

import { normalizeEscalationItem, normalizeScope, normalizeTotals } from './escalationsModel.js';
import { formatValue, toNumber } from './targetsModel.js';
import { formatRupiahShort } from '../sales/salesModel.js';

export const EMPTY_VALUE = '—';
export const KPI_ERROR_TEXT = 'Gagal dimuat';
export const KPI_EMPTY_TEXT = 'Belum ada data';
export const UNKNOWN_MODULE_LABEL = 'Lainnya';
export const TOP_ESCALATIONS_MAX = 5;

const isRow = (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row);
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

// One KPI card. A row without a key cannot be told apart from its neighbours, so
// it is dropped; everything else gets a safe default. `value` stays null when the
// API did not give a number — it must never read as 0.
function normalizeKpi(row) {
  if (!isRow(row)) return null;
  const key = text(row.key);
  if (!key) return null;
  const provider = text(row.provider);
  return {
    provider,
    providerLabel: text(row.providerLabel) || provider || UNKNOWN_MODULE_LABEL,
    key,
    id: `${provider || '?'}.${key}`,
    label: text(row.label) || key,
    unit: text(row.unit) || null,
    value: toNumber(row.value),
    sub: text(row.sub) || null,
    alert: row.alert === true,
    error: row.error === true,
  };
}

export function normalizeSummary(payload) {
  const data = isRow(payload) ? payload : {};
  const seen = new Set();
  const kpis = (Array.isArray(data.kpis) ? data.kpis : []).map(normalizeKpi).filter((kpi) => {
    if (!kpi || seen.has(kpi.id)) return false;
    seen.add(kpi.id);
    return true;
  });
  return {
    scope: normalizeScope(data.scope),
    kpis,
    // The summary carries no source catalogue, so any well-formed source passes.
    topEscalations: (Array.isArray(data.topEscalations) ? data.topEscalations : [])
      .map((row) => normalizeEscalationItem(row))
      .filter(Boolean)
      .slice(0, TOP_ESCALATIONS_MAX),
    escalationTotals: normalizeTotals(data.escalationTotals),
  };
}

// [{ providerLabel, kpis }] — one group per module label, modules in the order
// the API listed them, KPIs in their own order inside each group.
export function groupKpis(kpis) {
  const groups = [];
  const byLabel = new Map();
  for (const kpi of Array.isArray(kpis) ? kpis : []) {
    if (!kpi) continue;
    const label = kpi.providerLabel || UNKNOWN_MODULE_LABEL;
    let group = byLabel.get(label);
    if (!group) {
      group = { providerLabel: label, kpis: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.kpis.push(kpi);
  }
  return groups;
}

// The big number on a card. Counts print bare ("12"), because the label already
// says what is counted; money, days and percentages carry their unit. Money is
// written short ("Rp 1,27 M"), like the Sales and Alur & Margin cards: a full
// rupiah amount does not fit a 32px stat figure.
export function kpiValueText(kpi) {
  if (!kpi || kpi.error || kpi.value === null || kpi.value === undefined) return EMPTY_VALUE;
  if (kpi.unit === 'rupiah') return formatRupiahShort(kpi.value) || EMPTY_VALUE;
  return formatValue(kpi.value, kpi.unit, { countUnit: false }) ?? EMPTY_VALUE;
}

// The small line under the number: the module's own sub line, which also says why
// a card has no number ("Transaksi Sales dicatat di aplikasi", "Hanya untuk yang
// berwenang melihat harga beli"); a generic hint only when the module gave none.
// A failed KPI and a KPI with no number yet are told apart — "no data" is not a failure.
export function kpiHintText(kpi) {
  if (!kpi || kpi.error) return KPI_ERROR_TEXT;
  if (kpi.value === null || kpi.value === undefined) return kpi.sub || KPI_EMPTY_TEXT;
  return kpi.sub || '';
}

// The StatCard note. StatCard marks an alert only by turning the NOTE red, so a
// flagged card with nothing to say still gets a short cue instead of losing it.
export const KPI_ALERT_TEXT = 'Perlu ditindaklanjuti';
export function kpiNoteText(kpi) {
  const hint = kpiHintText(kpi);
  if (hint) return hint;
  return kpiIsAlert(kpi) ? KPI_ALERT_TEXT : '';
}

// Whether the small line is a "this card is empty" hint (muted) rather than data.
export function kpiIsEmpty(kpi) {
  return !kpi || kpi.error || kpi.value === null || kpi.value === undefined;
}

// Whether the card is flagged. A card without a number can still need attention
// (SO past their promise while none is due yet) — only a failed card never is.
export function kpiIsAlert(kpi) {
  return Boolean(kpi) && kpi.alert === true && !kpi.error;
}

// Second line of an escalation row: context, then the division when known.
export function escalationMeta(item) {
  return [item?.context && item.context !== '-' ? item.context : '', item?.departmentName || '']
    .filter(Boolean)
    .join(' · ');
}

// The same line as parts, for the language switch: the context is a sentence
// the backend composes around record data (`strict`: only a whole sentence of
// the app is translated), the division name is interface text.
export function escalationMetaParts(item) {
  return [
    item?.context && item.context !== '-' ? { text: item.context, strict: true } : null,
    item?.departmentName ? { text: item.departmentName } : null,
  ].filter(Boolean);
}

export function daysLateText(item) {
  const days = Number(item?.daysLate);
  return `${Number.isFinite(days) && days > 0 ? Math.floor(days) : 0} hari`;
}

// The Pusat Eskalasi view of the row's kind, so the click lands on a list that
// contains it.
export function escalationHref(item) {
  const source = text(item?.source);
  return source ? `/escalations?source=${encodeURIComponent(source)}` : '/escalations';
}
