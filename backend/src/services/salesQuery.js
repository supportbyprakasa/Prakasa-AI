// Small shared helpers for the Sales list endpoints: server-side paging and a
// LIKE search that treats %, _ and \ in the user's text literally.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function paging(query, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const page = Math.max(1, parseInt(query?.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query?.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function likeTerm(q) {
  const text = String(q ?? '').trim().slice(0, 100);
  return text ? `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
}

// " AND (a LIKE ? OR b LIKE ?)" and its arguments, or nothing when q is empty.
function searchClause(q, columns) {
  const like = likeTerm(q);
  if (!like) return { sql: '', args: [] };
  return { sql: ` AND (${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`, args: columns.map(() => like) };
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const int = (v) => Number(v || 0);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// [{unit, qty}] sold per unit, from a JSON_ARRAYAGG column (mysql2 may hand it back parsed or as text).
// One product can sell in cartons and in packs; without a unit conversion
// they are listed side by side, never added up.
function unitQuantities(value) {
  if (value == null) return [];
  const list = typeof value === 'string' ? JSON.parse(value) : value;
  return list.filter((u) => Number(u.qty)).map((u) => ({ unit: u.unit || '', qty: Number(u.qty) }))
    .sort((a, b) => b.qty - a.qty);
}

// A product's total in its base unit, or null when a unit it sold in has no ratio.
function baseQtyOf(qty, unit) {
  if (qty === null || qty === undefined || !unit) return null;
  return { qty: Math.round(Number(qty) * 10000) / 10000, unit };
}

module.exports = {
  baseQtyOf,
  DEFAULT_LIMIT, MAX_LIMIT, paging, likeTerm, searchClause, isDate, money, int, positiveId, unitQuantities,
};
