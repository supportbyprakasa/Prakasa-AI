const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    // Always the signed-in user's company; never from the request.
    const where = ['entity_id = ?', 'deleted_at IS NULL'];
    const args = [req.user.entityId];
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name, vendor_kind AS vendorKind, contact_person AS contactPerson,
              email, phone, portal_url AS portalUrl, notes
         FROM software_vendors WHERE ${where.join(' AND ')}
        ORDER BY name ASC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const { name, vendorKind, contactPerson, email, phone, portalUrl, notes } = req.body;
    const [r] = await pool.query(
      `INSERT INTO software_vendors
       (entity_id, name, vendor_kind, contact_person, email, phone, portal_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, name, vendorKind || 'software', contactPerson || null, email || null,
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
    const { name, vendorKind, contactPerson, email, phone, portalUrl, notes } = req.body;
    const [r] = await pool.query(
      `UPDATE software_vendors SET
         name=COALESCE(?,name), vendor_kind=COALESCE(?,vendor_kind), contact_person=COALESCE(?,contact_person),
         email=COALESCE(?,email), phone=COALESCE(?,phone),
         portal_url=COALESCE(?,portal_url), notes=COALESCE(?,notes)
       WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [name || null, vendorKind || null, contactPerson || null, email || null, phone || null,
       portalUrl || null, notes || null, id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Vendor tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE software_vendors SET deleted_at=NOW() WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Vendor tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
