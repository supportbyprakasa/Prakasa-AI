const pool = require('../db/pool');
const registry = require('../management/registry');
const { HIGH_SEVERITY_DAYS, iso } = require('../management/helpers');
const { escalationItems } = require('../management/figureCache');
const { mapLimit } = require('../utils/mapLimit');
const { memo } = require('../utils/memo');

// Sources read at a time (the pool has five connections for every user).
const SOURCE_CONCURRENCY = 3;

// Pusat Eskalasi — one queue of everything past its deadline, for management.
//
// The sources are not listed here: every division module contributes its own
// through a management provider (src/management/providers/). Adding a module
// adds its escalations here with no change to this file.
//
// The queue is computed on every read, never stored: the moment an issue is
// finished or an approval is decided it simply stops being returned. Only the
// human follow-up (who is handling it, their note) is persisted, keyed by
// (source, source_id) so it survives recomputation.

const STATUSES = Object.freeze(['open', 'acknowledged', 'resolved']);
const STATUS_FILTERS = Object.freeze([...STATUSES, 'all']);
const MAX_NOTE = 1000;

function invalid(message, code = 'VALIDATION_ERROR', status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** The catalogue the page renders its filters and labels from. */
function sources() {
  return registry.escalationSources().map((s) => ({
    key: s.key, label: s.label, provider: s.provider, providerLabel: s.providerLabel,
  }));
}

async function followupsFor(entityId, items) {
  if (!items.length) return new Map();
  const [rows] = await pool.query(
    `SELECT f.source, f.source_id, f.status, f.owner_user_id, f.note, f.updated_at,
            uo.name AS owner_name, ub.name AS updated_by_name
       FROM escalation_followups f
       LEFT JOIN users uo ON uo.id = f.owner_user_id
       LEFT JOIN users ub ON ub.id = f.updated_by
      WHERE f.entity_id = ?`,
    [entityId]
  );
  return new Map(rows.map((row) => [`${row.source}:${row.source_id}`, {
    status: row.status,
    ownerUserId: row.owner_user_id != null ? Number(row.owner_user_id) : null,
    ownerName: row.owner_name || null,
    note: row.note || null,
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by_name || null,
  }]));
}

async function departmentName(departmentId) {
  if (departmentId == null) return null;
  const [[row]] = await pool.query('SELECT name FROM departments WHERE id = ? LIMIT 1', [Number(departmentId)]);
  return row?.name || null;
}

// --------------------------------------------------------------------------
// Queue
// --------------------------------------------------------------------------

async function list(entityId, { departmentId = null, status = 'open', source = null, limit = null } = {}) {
  if (!STATUS_FILTERS.includes(status)) throw invalid('status tidak dikenal');
  const all = registry.escalationSources();
  if (source != null && !all.some((s) => s.key === source)) throw invalid('source tidak dikenal');

  const wanted = source ? all.filter((s) => s.key === source) : all;
  // Each source's items are shared for a short while by every page that asks
  // (management/figureCache.js); the follow-ups below are always read fresh.
  const collected = await mapLimit(wanted, SOURCE_CONCURRENCY, async (s) => {
    const rows = await escalationItems(s, entityId, { departmentId: departmentId == null ? null : Number(departmentId) });
    return rows.map((row) => ({ ...row, source: s.key }));
  });

  const items = collected.flat();
  const followups = await followupsFor(entityId, items);
  // An untouched breach counts as 'open' — the queue must never hide something
  // simply because nobody has written a note about it yet.
  const withFollowup = items.map((item) => {
    const followup = followups.get(`${item.source}:${item.sourceId}`) || null;
    return { ...item, followup, effectiveStatus: followup?.status || 'open' };
  });

  const totals = {
    all: withFollowup.length,
    open: withFollowup.filter((i) => i.effectiveStatus === 'open').length,
    acknowledged: withFollowup.filter((i) => i.effectiveStatus === 'acknowledged').length,
    resolved: withFollowup.filter((i) => i.effectiveStatus === 'resolved').length,
    bySource: Object.fromEntries(all.map((s) => [s.key, withFollowup.filter((i) => i.source === s.key).length])),
  };

  let filtered = (status === 'all' ? withFollowup : withFollowup.filter((i) => i.effectiveStatus === status))
    .sort((a, b) => b.daysLate - a.daysLate || String(a.title).localeCompare(String(b.title)))
    .map(({ effectiveStatus, ...item }) => item);
  if (limit != null) filtered = filtered.slice(0, Math.max(0, Number(limit)));

  return {
    scope: {
      entityWide: departmentId == null,
      departmentId: departmentId == null ? null : Number(departmentId),
      departmentName: await departmentName(departmentId),
    },
    sources: sources(),
    totals,
    items: filtered,
  };
}

// Writing a follow-up must be gated by the SAME scope as reading the queue.
// Without this a division Head could resolve another division's escalation
// simply by knowing its id — the read filter alone does not protect writes.
// Each source knows how to locate its own record, so this works for every
// module without knowing any of their tables.
async function assertInScope(entityId, departmentId, sourceDef, id) {
  // The company is passed along: ids copied from Accurate repeat across companies.
  const found = await sourceDef.locate(id, { entityId });
  const sameEntity = found && Number(found.entityId) === Number(entityId);
  const sameDepartment = departmentId == null
    || (found && found.departmentId != null && Number(found.departmentId) === Number(departmentId));
  // 404 rather than 403: an out-of-scope record should not be confirmed to exist.
  if (!sameEntity || !sameDepartment) throw invalid('Eskalasi tidak ditemukan', 'NOT_FOUND', 404);
}

async function saveFollowup(user, { source, sourceId, status, ownerUserId, note, departmentId = null }) {
  const sourceDef = registry.escalationSource(String(source || ''));
  if (!sourceDef) throw invalid('source tidak dikenal');
  const id = Number(sourceId);
  if (!Number.isInteger(id) || id <= 0) throw invalid('sourceId tidak valid');
  await assertInScope(user.entityId, departmentId, sourceDef, id);
  if (status !== undefined && !STATUSES.includes(status)) throw invalid('status tidak dikenal');
  if (note != null && String(note).length > MAX_NOTE) throw invalid(`Catatan maksimal ${MAX_NOTE} karakter`);

  let owner = null;
  if (ownerUserId !== undefined && ownerUserId !== null && ownerUserId !== '') {
    owner = Number(ownerUserId);
    if (!Number.isInteger(owner) || owner <= 0) throw invalid('ownerUserId tidak valid');
    // Only someone of this entity may be made responsible for its escalation.
    const [[row]] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
      [owner, user.entityId]
    );
    if (!row) throw invalid('Pengguna tidak ditemukan di entity ini', 'NOT_FOUND', 404);
  }

  const cleanNote = note == null || note === '' ? null : String(note).trim().slice(0, MAX_NOTE);
  await pool.query(
    `INSERT INTO escalation_followups (entity_id, source, source_id, status, owner_user_id, note, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       owner_user_id = VALUES(owner_user_id),
       note = VALUES(note),
       updated_by = VALUES(updated_by)`,
    [user.entityId, sourceDef.key, id, status || 'acknowledged', owner, cleanNote, user.sub]
  );
  // The cached management pages show this follow-up: drop them.
  memo.invalidate('mgmt:');

  const [[row]] = await pool.query(
    `SELECT f.status, f.owner_user_id, f.note, f.updated_at,
            uo.name AS owner_name, ub.name AS updated_by_name
       FROM escalation_followups f
       LEFT JOIN users uo ON uo.id = f.owner_user_id
       LEFT JOIN users ub ON ub.id = f.updated_by
      WHERE f.entity_id = ? AND f.source = ? AND f.source_id = ?
      LIMIT 1`,
    [user.entityId, sourceDef.key, id]
  );
  return {
    status: row.status,
    ownerUserId: row.owner_user_id != null ? Number(row.owner_user_id) : null,
    ownerName: row.owner_name || null,
    note: row.note || null,
    updatedAt: iso(row.updated_at),
    updatedByName: row.updated_by_name || null,
  };
}

module.exports = {
  list,
  saveFollowup,
  sources,
  STATUSES,
  HIGH_SEVERITY_DAYS,
  MAX_NOTE,
};
