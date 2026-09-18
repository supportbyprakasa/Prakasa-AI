const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id = ?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name, contact_person AS contactPerson,
              email, phone, portal_url AS portalUrl
         FROM software_vendors WHERE ${where.join(' AND ')}
        ORDER BY name ASC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { entityId, name, contactPerson, email, phone, portalUrl, notes } = req.body;
    const [r] = await pool.query(
      `INSERT INTO software_vendors
       (entity_id, name, contact_person, email, phone, portal_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entityId, name, contactPerson || null, email || null,
       phone || null, portalUrl || null, notes || null]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'software_vendor.create', subjectType: 'software_vendor', subjectId: r.insertId,
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, contactPerson, email, phone, portalUrl, notes } = req.body;
    const [r] = await pool.query(
      `UPDATE software_vendors SET
         name=COALESCE(?,name), contact_person=COALESCE(?,contact_person),
         email=COALESCE(?,email), phone=COALESCE(?,phone),
         portal_url=COALESCE(?,portal_url), notes=COALESCE(?,notes)
       WHERE id=? AND deleted_at IS NULL`,
      [name || null, contactPerson || null, email || null, phone || null,
       portalUrl || null, notes || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Vendor tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE software_vendors SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Vendor tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
