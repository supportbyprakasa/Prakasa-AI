// Pencocokan Barang Masuk/Keluar ↔ dokumen Accurate (program 3.2) — pure rules,
// no database. The matching itself happens in SQL (migrations 094 and 104); these
// constants must stay equal to the ones written into those views, and the
// helpers mirror the SQL where the UI or the provider needs the same answer.
//
// Quantities only, in base units; never a price (D1), never an address (D5).

// Movements dated before this are not compared (the Accurate database starts here).
const RECON_FROM = '2026-09-22';
// Priority 2/3 keys (supplier SJ, PO/SO on a line) count only this close to the movements.
const MATCH_WINDOW_DAYS = 14;
// A difference is escalated once it is older than this (movement, approval, first
// mirror day), and only when the Warehouse mirror is complete that far (`judged`,
// migration 104). Same number as 104.
const RECON_GRACE_DAYS = 2;
// Only the last RECON_WINDOW_DAYS are reconciled (monthly cycle; older gaps are
// settled by stock opname). Same number as migration 094.
const RECON_WINDOW_DAYS = 180;
// Escalation id of a movement group = its direction-coded movement id × this +
// the day of its `since`: a new movement or document in the group is a new
// episode, so a follow-up closed on an earlier difference never hides it
// (the pattern of SO_EPISODE_FACTOR and procurementRules.EPISODE_FACTOR).
const EPISODE_FACTOR = 100000;
const QTY_TOLERANCE = 0.001;
const CANDIDATE_LIMIT = 20;
// A reference is a key only with at least this many characters (after normalising) and a digit.
const MIN_KEY_LENGTH = 4;
// GROUP_CONCAT display lists are capped in 094; the counts carry the totals.
const MOVEMENT_IDS_SHOWN = 10;
const DOC_NUMBERS_SHOWN = 5;

const DIRECTIONS = Object.freeze(['inbound', 'outbound']);
const DOC_TYPES = Object.freeze(['receipt', 'delivery', 'transfer', 'adjustment']);
const PROBLEM_STATUSES = Object.freeze(['qty_diff', 'app_only', 'acc_only', 'uncomparable']);
// 'waiting': a difference the mirror cannot judge yet (a Warehouse batch waits, or pulls stopped).
const FILTERS = Object.freeze(['open', ...PROBLEM_STATUSES, 'waiting', 'explained', 'matched', 'all']);
// A group key: a normalised reference (≥ 4 characters with a digit), a movement
// without a usable reference, or an Accurate receipt/delivery nobody took.
const GROUP_KEY_RE = /^(?:(?=[A-Z0-9]*[0-9])[A-Z0-9]{4,80}|m-\d{1,10}|(?:receipt|delivery)-\d{1,19})$/;
const MOVEMENT_LABEL = Object.freeze({ inbound: 'Barang Masuk', outbound: 'Barang Keluar' });

// "DO18/HRC-PFN/IX/2026" → "DO18HRCPFNIX2026"; null when nothing is left.
function normalizeRef(text) {
  const key = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key || null;
}

// The matching key of a reference, or null for a placeholder ('N/A', '0', '001', 'manual').
function refKey(text) {
  const key = normalizeRef(text);
  return key && key.length >= MIN_KEY_LENGTH && key.length <= 80 && /[0-9]/.test(key) ? key : null;
}

function groupKeyForMovement({ id, referenceNo }) {
  return refKey(referenceNo) || `m-${id}`;
}

// 'receipt-106' → { docType: 'receipt', docId: 106 } (a "Belum di aplikasi" group).
function parseDocGroupKey(key) {
  const m = /^(receipt|delivery)-(\d{1,19})$/.exec(String(key || ''));
  return m ? { docType: m[1], docId: Number(m[2]) } : null;
}

// Inbound and outbound ids overlap, and so do receipt and delivery ids: an
// escalation source id carries the direction in its lowest bit.
const movementSourceId = (id, direction) => Number(id) * 2 + (direction === 'outbound' ? 1 : 0);
function decodeMovementSourceId(n) {
  const v = Math.trunc(Number(n));
  return { direction: v % 2 ? 'outbound' : 'inbound', movementId: Math.floor(v / 2) };
}
const docSourceId = (docId, direction) => Number(docId) * 2 + (direction === 'outbound' ? 1 : 0);
function decodeDocSourceId(n) {
  const v = Math.trunc(Number(n));
  return { docType: v % 2 ? 'delivery' : 'receipt', docId: Math.floor(v / 2) };
}
// A movement group's escalation id: `epDay` = DATEDIFF(since, '2000-01-01').
const episodeSourceId = (movementId, direction, epDay) => movementSourceId(movementId, direction) * EPISODE_FACTOR + int(epDay);
const decodeEpisodeSourceId = (n) => decodeMovementSourceId(Math.floor(Number(n) / EPISODE_FACTOR));

// The WIB (UTC+7) calendar day of `now`.
const wibDay = (now = new Date()) => new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
// The oldest movement date still reconciled: RECON_WINDOW_DAYS before today
// (WIB), never before RECON_FROM — the bound of `in_scope` in 094.
function windowFrom(now = new Date()) {
  const edge = new Date(`${wibDay(now)}T00:00:00Z`);
  edge.setUTCDate(edge.getUTCDate() - RECON_WINDOW_DAYS);
  const day = edge.toISOString().slice(0, 10);
  return day > RECON_FROM ? day : RECON_FROM;
}

const reconLink = (direction, key) => `/warehouse/stock?tab=recon&direction=${direction}&group=${encodeURIComponent(key)}`;

// WHERE fragment of a list filter (alias g = wh_recon_groups). A difference the
// mirror cannot judge yet is 'waiting', not one of the problem statuses.
function statusFilter(filter) {
  if (filter === 'all') return { sql: '', args: [] };
  if (filter === 'explained') return { sql: ' AND g.explained = 1', args: [] };
  if (filter === 'matched') return { sql: " AND g.status = 'matched'", args: [] };
  if (filter === 'waiting') return { sql: " AND g.status <> 'matched' AND g.explained = 0 AND g.judged = 0", args: [] };
  if (PROBLEM_STATUSES.includes(filter)) return { sql: ' AND g.status = ? AND g.explained = 0 AND g.judged = 1', args: [filter] };
  return { sql: " AND g.status <> 'matched' AND g.explained = 0", args: [] };
}

// Segregation of duties: whoever recorded or submitted a movement of the group
// neither pairs nor explains it.
function selfResolveReason(userId, movements) {
  const me = Number(userId);
  const own = (movements || []).some((m) => Number(m.created_by) === me || Number(m.submitted_by) === me);
  return own ? 'Anda mencatat atau mengajukan pergerakan di kelompok ini. Pencocokannya diputuskan Supervisor atau Head Warehouse lain.' : null;
}

const toTime = (d) => Date.parse(`${day(d)}T00:00:00Z`);
// Candidates for a manual pairing: most shared items first, then closest in date.
function rankCandidates(appItemKeys, docs, { from, to } = {}) {
  const mine = new Set((appItemKeys || []).filter(Boolean).map((k) => String(k).toUpperCase()));
  const lo = from ? toTime(from) : null;
  const hi = to ? toTime(to) : lo;
  return (docs || []).map((d) => {
    const shared = new Set((d.itemKeys || []).filter(Boolean).map((k) => String(k).toUpperCase()).filter((k) => mine.has(k)));
    const t = d.date ? toTime(d.date) : null;
    let dayGap = null;
    if (t !== null && lo !== null) dayGap = t < lo ? Math.round((lo - t) / 86400000) : t > hi ? Math.round((t - hi) / 86400000) : 0;
    return { ...d, sharedItems: shared.size, dayGap };
  }).sort((a, b) => (b.sharedItems - a.sharedItems)
    || ((a.dayGap ?? Infinity) - (b.dayGap ?? Infinity))
    || String(a.number || '').localeCompare(String(b.number || '')))
    .slice(0, CANDIDATE_LIMIT);
}

function day(v) {
  if (v === null || v === undefined || v === '') return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
// '2026-09-22' → '22 Sep 2026', as the pages write a date.
const dayText = (v) => new Date(`${day(v)}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};
const qty = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10000) / 10000);
const split = (v, sep) => (v ? String(v).split(sep).map((s) => s.trim()).filter(Boolean) : []);

function groupDto(row) {
  return {
    id: `${row.direction}:${row.group_key}`,
    direction: row.direction,
    groupKey: row.group_key,
    status: row.status,
    explained: Boolean(int(row.explained)),
    referenceNo: row.reference_no || null,
    party: row.party || null,
    movementCount: int(row.movement_count),
    movementIds: split(row.movement_ids, ',').map(Number),
    firstMovementId: row.first_movement_id == null ? null : Number(row.first_movement_id),
    dateFrom: day(row.first_date),
    dateTo: day(row.last_date),
    docCount: int(row.doc_count),
    docNumbers: split(row.doc_numbers, ', '),
    matchKinds: split(row.match_kinds, ','),
    firstDocId: row.first_doc_id == null ? null : Number(row.first_doc_id),
    itemCount: int(row.item_count),
    diffItems: int(row.diff_items),
    unknownLines: int(row.unknown_lines),
    missingItemLines: int(row.missing_item_lines),
    pendingMovements: int(row.pending_movements),
    since: day(row.since),
    daysOpen: row.days_open == null ? null : int(row.days_open),
    // false while the Warehouse mirror is not complete through since + grace (104).
    judged: row.judged == null ? true : Boolean(int(row.judged)),
    dataThrough: day(row.data_through),
    signature: row.signature || null,
    note: row.note_id ? { id: Number(row.note_id), reason: row.note_reason || '', byName: row.note_by_name || null, at: row.note_at || null } : null,
  };
}

// One item of a group, in base units. `baseUnits` maps an upper-cased item key to its base unit.
function itemDto(row, baseUnits = new Map()) {
  const itemKey = row.item_key || null;
  const appQty = qty(row.app_qty_base) ?? 0;
  const accQty = qty(row.acc_qty_base) ?? 0;
  const unknownLines = int(row.unknown_lines);
  let state = 'matched';
  if (!itemKey || unknownLines > 0) state = 'uncomparable';
  else if (Math.abs(appQty - accQty) >= QTY_TOLERANCE) state = 'qty_diff';
  return {
    itemKey,
    itemName: row.item_name || null,
    baseUnit: itemKey ? baseUnits.get(itemKey.toUpperCase()) || null : null,
    appQty,
    accQty,
    diff: Math.round((accQty - appQty) * 10000) / 10000,
    appLines: int(row.app_lines),
    accLines: int(row.acc_lines),
    unknownLines,
    state,
  };
}

module.exports = {
  RECON_FROM, RECON_WINDOW_DAYS, MATCH_WINDOW_DAYS, RECON_GRACE_DAYS, EPISODE_FACTOR, QTY_TOLERANCE, CANDIDATE_LIMIT, MIN_KEY_LENGTH,
  MOVEMENT_IDS_SHOWN, DOC_NUMBERS_SHOWN,
  DIRECTIONS, DOC_TYPES, PROBLEM_STATUSES, FILTERS, GROUP_KEY_RE, MOVEMENT_LABEL,
  normalizeRef, refKey, groupKeyForMovement, parseDocGroupKey,
  movementSourceId, decodeMovementSourceId, docSourceId, decodeDocSourceId, episodeSourceId, decodeEpisodeSourceId,
  wibDay, windowFrom, reconLink,
  statusFilter, selfResolveReason, rankCandidates, day, dayText, int, groupDto, itemDto,
};
