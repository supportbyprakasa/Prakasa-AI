const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { logWith } = require('../services/activityLog.service');
const { LOCATION_KIND_LABELS } = require('../config/itAssets');

// Work locations of the signed-in user's entity (PFN Office, Alsut Office …),
// shared by the directory and devices. Never deleted: a location that is no
// longer used is set inactive. Writes and their log share one transaction.

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function shape(r) {
  return {
    id: Number(r.id),
    name: r.name,
    kind: r.kind,
    kindLabel: LOCATION_KIND_LABELS[r.kind] || r.kind,
    isActive: Number(r.is_active) === 1,
    notes: r.notes || null,
    deviceCount: Number(r.device_count || 0),
    peopleCount: Number(r.people_count || 0),
  };
}

async function list(req, res, next) {
  try {
    const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
    const [rows] = await pool.query(
      `SELECT l.id, l.name, l.kind, l.is_active, l.notes,
              (SELECT COUNT(*) FROM devices d WHERE d.entity_id = l.entity_id AND d.location_id = l.id AND d.deleted_at IS NULL) AS device_count,
              (SELECT COUNT(*) FROM people_directory p WHERE p.entity_id = l.entity_id AND p.location_id = l.id AND p.status = 'active' AND p.kind <> 'excluded') AS people_count
         FROM org_locations l
        WHERE l.entity_id = ?${includeInactive ? '' : ' AND l.is_active = 1'}
        ORDER BY l.is_active DESC, l.name ASC`,
      [req.user.entityId],
    );
    return ok(res, rows.map(shape));
  } catch (e) { next(e); }
}

async function write(req, res, next, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    if (out && out.error) { await conn.rollback(); return fail(res, out.error.code, out.error.message, out.error.status); }
    await conn.commit();
    return ok(res, out.data, undefined, out.status || 200);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'LOCATION_EXISTS', 'Nama lokasi sudah ada', 409);
    next(e);
  } finally { conn.release(); }
}

async function create(req, res, next) {
  const entityId = req.user.entityId;
  return write(req, res, next, async (conn) => {
    const name = clean(req.body.name);
    const [ins] = await conn.query(
      `INSERT INTO org_locations (entity_id, name, kind, is_active, notes, created_by, updated_by)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
      [entityId, name, req.body.kind || 'office', clean(req.body.notes) || null, req.user.sub, req.user.sub],
    );
    await logWith(conn, {
      entityId, userId: req.user.sub, action: 'org_location.create', subjectType: 'org_location',
      subjectId: Number(ins.insertId), metadata: { name, kind: req.body.kind || 'office' },
    });
    return { data: { id: Number(ins.insertId) }, status: 201 };
  });
}

async function update(req, res, next) {
  const entityId = req.user.entityId;
  return write(req, res, next, async (conn) => {
    const [[cur]] = await conn.query(
      'SELECT id, name, kind, is_active, notes FROM org_locations WHERE id = ? AND entity_id = ? FOR UPDATE',
      [req.params.id, entityId],
    );
    if (!cur) return { error: { code: 'NOT_FOUND', message: 'Lokasi tidak ditemukan', status: 404 } };
    const next = {};
    if (req.body.name !== undefined) next.name = clean(req.body.name);
    if (req.body.kind !== undefined) next.kind = req.body.kind;
    if (req.body.isActive !== undefined) next.is_active = req.body.isActive ? 1 : 0;
    if (req.body.notes !== undefined) next.notes = clean(req.body.notes) || null;
    const before = {};
    const after = {};
    for (const [k, v] of Object.entries(next)) {
      const old = k === 'is_active' ? Number(cur[k]) : cur[k];
      if ((old ?? null) !== (v ?? null)) { before[k] = old ?? null; after[k] = v; }
    }
    if (!Object.keys(after).length) return { data: { id: Number(cur.id), changed: [] } };
    await conn.query(
      `UPDATE org_locations SET ${Object.keys(after).map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE id = ? AND entity_id = ?`,
      [...Object.values(after), req.user.sub, cur.id, entityId],
    );
    await logWith(conn, {
      entityId, userId: req.user.sub, action: 'org_location.update', subjectType: 'org_location',
      subjectId: Number(cur.id), metadata: { before, after },
    });
    return { data: { id: Number(cur.id), changed: Object.keys(after) } };
  });
}

module.exports = { list, create, update };
