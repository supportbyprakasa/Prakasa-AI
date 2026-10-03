import { safeInAppPath } from '../../components/safeHref.js';
import { formatDate } from '../../components/format.js';

// Pure helpers for Pusat Eskalasi (no React, no DOM) — unit tested in
// test/escalationsModel.test.js. API: GET/PATCH /management-dashboard/escalations.
//
// This module knows NO escalation source. Every division module registers its own
// through a management provider on the server (docs/management-integration.md),
// and the response carries the catalogue as `sources`. Filter chips, labels and
// the per-module breakdown are all built from that catalogue, so a module added
// on the server shows up here without a frontend change.
//
// The normaliser is deliberately strict: a row the UI cannot address (a source
// missing from the catalogue, no id) is dropped rather than rendered half-blank,
// and every remaining field gets a safe default.

export const UNKNOWN_SOURCE_LABEL = 'Lainnya';

// A source key as the server writes it (snake_case). Anything else in the URL is
// not worth a round trip.
const SOURCE_KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
export function isSourceKey(value) { return typeof value === 'string' && SOURCE_KEY_RE.test(value); }

// Follow-up lifecycle. The API only ever stores these three.
export const STATUSES = ['open', 'acknowledged', 'resolved'];
export const STATUS_LABELS = {
  open: 'Belum ditangani',
  acknowledged: 'Sedang ditangani',
  resolved: 'Selesai',
};
export const STATUS_OPTIONS = STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

// Follow-up status → a key components/statusTone.js already knows, so the Badge
// tone is never decided here (docs/ui-guideline.md §3.4).
const STATUS_KEYS = { open: 'open', acknowledged: 'in_progress', resolved: 'resolved' };
export function statusKey(status) { return STATUS_KEYS[status] || 'open'; }

export const SEVERITIES = ['high', 'medium'];

// Severity is not a lifecycle status — it only says how loudly the lateness should
// read — so it has no entry in statusTone.js. 'high' borrows the error colour,
// anything else stays a warning.
export function severityTone(severity) { return severity === 'high' ? 'error' : 'warning'; }

export const NOTE_MAX = 1000;

// ---------------------------------------------------------------------------
// Normalising

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const idOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const isRow = (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row);

export const EMPTY_SCOPE = { entityWide: true, departmentId: null, departmentName: null };
export const EMPTY_TOTALS = { all: 0, open: 0, acknowledged: 0, resolved: 0, bySource: {} };

// The catalogue: [{ key, label, provider, providerLabel }] in the server's order,
// one entry per key. An entry without a usable key is dropped; a missing label
// falls back to the key, a missing module label to the provider key.
export function normalizeSources(list) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    if (!isRow(row)) continue;
    const key = text(row.key);
    if (!isSourceKey(key) || seen.has(key)) continue;
    seen.add(key);
    const provider = text(row.provider) || null;
    out.push({
      key,
      label: text(row.label) || key,
      provider,
      providerLabel: text(row.providerLabel) || provider || UNKNOWN_SOURCE_LABEL,
    });
  }
  return out;
}

export function findSource(sources, key) {
  return (Array.isArray(sources) ? sources : []).find((s) => s.key === key) || null;
}
export function sourceLabel(sources, key) { return findSource(sources, key)?.label || UNKNOWN_SOURCE_LABEL; }
export function sourceProviderLabel(sources, key) { return findSource(sources, key)?.providerLabel || ''; }

// A view without a division filter is the widest one, so an absent scope must read
// as entity-wide: never tell the user their view is narrowed when the API didn't say so.
export function normalizeScope(scope) {
  if (!isRow(scope)) return { ...EMPTY_SCOPE };
  return {
    entityWide: scope.entityWide !== false,
    departmentId: idOrNull(scope.departmentId),
    departmentName: text(scope.departmentName) || null,
  };
}

// sourceKeys: the catalogue's keys — every one gets a count (0 when absent) and
// nothing else is kept. Without a catalogue (the dashboard summary carries none)
// every well-formed key the API sent is kept as is.
export function normalizeTotals(totals, sourceKeys = null) {
  const source = isRow(totals) ? totals : {};
  const bySource = isRow(source.bySource) ? source.bySource : {};
  const keys = Array.isArray(sourceKeys) ? sourceKeys : Object.keys(bySource).filter(isSourceKey);
  return {
    all: count(source.all),
    open: count(source.open),
    acknowledged: count(source.acknowledged),
    resolved: count(source.resolved),
    bySource: Object.fromEntries(keys.map((key) => [key, count(bySource[key])])),
  };
}

// The API promises a safe relative route, but a link is the one field that could
// navigate the user off the app, so anything that isn't a plain in-app path
// (including the protocol-relative "//host" form) is dropped.
function normalizeLink(value) {
  return safeInAppPath(text(value));
}

export function normalizeFollowup(followup) {
  if (!isRow(followup)) return null;
  return {
    status: STATUSES.includes(followup.status) ? followup.status : 'open',
    ownerUserId: idOrNull(followup.ownerUserId),
    ownerName: text(followup.ownerName) || null,
    note: text(followup.note) || null,
    updatedAt: text(followup.updatedAt),
    updatedByName: text(followup.updatedByName) || null,
  };
}

// sourceKeys: when given, a row whose source is not in it is dropped (the page
// could neither label nor follow it up). Without it any well-formed key passes.
// The module providers write plain ISO dates into their context lines
// ("janji kirim 2026-09-22"): shown as "22 Sep 2026". A date inside a document
// number (DO-2026-09-1102) is left alone.
const ISO_DAY_RE = /(?<![\w-])(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?(?![\w-])/g;
export function readableDates(value) {
  if (typeof value !== 'string' || !value) return value;
  return value.replace(ISO_DAY_RE, (match, day) => {
    const shown = formatDate(day);
    return shown === '—' ? match : shown;
  });
}

export function normalizeEscalationItem(row, sourceKeys = null) {
  if (!isRow(row)) return null;
  const sourceId = idOrNull(row.sourceId);
  if (!isSourceKey(row.source) || sourceId === null) return null;
  if (sourceKeys && !sourceKeys.includes(row.source)) return null;
  return {
    source: row.source,
    sourceId,
    title: text(row.title) || 'Tanpa judul',
    reference: text(row.reference) || null,
    // The reference is one of the app's own labels (not a document number).
    referenceLabel: row.referenceLabel === true,
    context: readableDates(text(row.context)) || '-',
    departmentId: idOrNull(row.departmentId),
    departmentName: text(row.departmentName) || null,
    ownerName: text(row.ownerName) || null,
    severity: SEVERITIES.includes(row.severity) ? row.severity : 'medium',
    daysLate: count(row.daysLate),
    since: text(row.since),
    link: normalizeLink(row.link),
    followup: normalizeFollowup(row.followup),
  };
}

export function normalizeEscalations(payload) {
  const data = isRow(payload) ? payload : {};
  const sources = normalizeSources(data.sources);
  const keys = sources.map((s) => s.key);
  return {
    scope: normalizeScope(data.scope),
    sources,
    totals: normalizeTotals(data.totals, keys),
    items: (Array.isArray(data.items) ? data.items : [])
      .map((row) => normalizeEscalationItem(row, keys))
      .filter(Boolean),
  };
}

// The per-source counts, grouped by the division module that owns them, in the
// catalogue's order: [{ providerLabel, total, sources: [{ key, label, count }] }].
export function groupSourceCounts(sources, bySource) {
  const counts = isRow(bySource) ? bySource : {};
  const groups = [];
  const byLabel = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    const label = source.providerLabel || UNKNOWN_SOURCE_LABEL;
    let group = byLabel.get(label);
    if (!group) {
      group = { providerLabel: label, total: 0, sources: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    const n = count(counts[source.key]);
    group.sources.push({ key: source.key, label: source.label, count: n });
    group.total += n;
  }
  return groups;
}

// (source, sourceId) is the only identity an item has — items come from many
// modules' tables, so sourceId alone repeats across sources.
export function escalationKey(item) { return `${item?.source || '?'}:${item?.sourceId ?? '?'}`; }

// The same row as one URL-safe word: /escalations?ubah=<source>-<sourceId> opens
// its follow-up dialog, and Prakasa AI's audit names the record with it.
export function escalationRecordId(item) {
  if (!item?.source || item.sourceId === undefined || item.sourceId === null || item.sourceId === '') return '';
  return `${item.source}-${item.sourceId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}
export function findEscalation(items, recordId) {
  const wanted = String(recordId || '');
  return (wanted && (Array.isArray(items) ? items : []).find((item) => escalationRecordId(item) === wanted)) || null;
}

// No follow-up row yet means nobody has touched it: that is "open", not "unknown".
export function itemStatus(item) { return item?.followup?.status || 'open'; }

// ---------------------------------------------------------------------------
// Filters ⇄ URL. Keeping both filters in the query string is what makes a view
// shareable ("here is the list I mean"), so they are read from the URL, never
// from component state.

export const STATUS_FILTERS = [...STATUSES, 'all'];
export const DEFAULT_STATUS = 'open';
const PARAM_NAMES = ['status', 'source'];

// The source is only checked for shape here: which keys exist is known once the
// catalogue has loaded, so an unfamiliar key is kept until then (resolveSource).
export function readEscalationParams(searchParams) {
  const get = (name) => searchParams?.get?.(name) || '';
  const status = STATUS_FILTERS.includes(get('status')) ? get('status') : DEFAULT_STATUS;
  const source = isSourceKey(get('source')) ? get('source') : '';
  return { status, source };
}

// The source filter actually in force. Before the first answer nothing is known,
// so the URL's key is trusted (a shared link keeps its filter); once the
// catalogue has loaded, a key it does not list falls back to "Semua jenis".
export function resolveSource(source, sources, loaded) {
  if (!isSourceKey(source)) return '';
  if (!loaded) return source;
  return findSource(sources, source) ? source : '';
}

// Returns a NEW URLSearchParams with only this page's own keys changed, so a param
// another feature put on the URL survives a filter click.
export function writeEscalationParams(searchParams, patch) {
  const next = new URLSearchParams(searchParams);
  for (const [name, value] of Object.entries(patch || {})) {
    if (!PARAM_NAMES.includes(name)) continue;
    const empty = value === null || value === undefined || value === ''
      || (name === 'status' && value === DEFAULT_STATUS);
    if (empty) next.delete(name);
    else next.set(name, String(value));
  }
  return next;
}

export function escalationQuery({ status, source } = {}) {
  const params = { status: STATUS_FILTERS.includes(status) ? status : DEFAULT_STATUS };
  if (isSourceKey(source)) params.source = source;
  return params;
}

// ---------------------------------------------------------------------------
// Follow-up form

export const EMPTY_FOLLOWUP_FORM = { status: 'open', ownerUserId: '', note: '' };

export function followupForm(item) {
  const followup = item?.followup;
  return {
    status: itemStatus(item),
    ownerUserId: followup?.ownerUserId ? String(followup.ownerUserId) : '',
    note: followup?.note || '',
  };
}

export function validateFollowupForm(form) {
  const errors = {};
  if (!STATUSES.includes(form?.status)) errors.status = 'Pilih status tindak lanjut.';
  if (String(form?.note || '').length > NOTE_MAX) errors.note = `Maksimal ${NOTE_MAX} karakter.`;
  return errors;
}

// ownerUserId and note are always sent, including as null: clearing the owner or
// the note has to reach the API as an explicit "empty", not as "unchanged".
export function followupPayload(form) {
  const note = String(form?.note || '').trim();
  return {
    status: form?.status,
    ownerUserId: form?.ownerUserId ? Number(form.ownerUserId) : null,
    note: note || null,
  };
}

// Replaces one row's follow-up after a successful PATCH, so the grid updates
// without refetching the whole queue.
export function applyFollowup(items, source, sourceId, followup) {
  return (Array.isArray(items) ? items : []).map((item) => (
    item.source === source && item.sourceId === sourceId
      ? { ...item, followup: normalizeFollowup(followup) }
      : item
  ));
}

// The KPI strip must not disagree with the row the user just changed. Recounting
// from the visible items would be wrong while a filter narrows the list, so only
// the one row that moved is shifted between buckets.
export function shiftTotals(totals, from, to) {
  const base = normalizeTotals(totals);
  if (from === to || !STATUSES.includes(from) || !STATUSES.includes(to)) return base;
  return { ...base, [from]: Math.max(0, base[from] - 1), [to]: base[to] + 1 };
}
