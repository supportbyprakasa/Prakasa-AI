const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const licenses = require('../services/licenseAssignment.service');

async function createLicense(req, res, next) {
  try {
    const { id } = req.params; // subscription id
    // A licence key is never accepted or stored by the API (wave 2, §4.1, S10):
    // the route's strict schema refuses it; keys live in the vendor portal.
    const { seatLabel } = req.body;
    const [s] = await pool.query(
      `SELECT * FROM software_subscriptions WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]
    );
    if (!s[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO subscription_licenses
       (subscription_id, seat_label, status) VALUES (?, ?, 'available')`,
      [id, seatLabel || null]
    );
    // Naikkan total seats jika perlu
    await pool.query(
      `UPDATE software_subscriptions SET total_seats = total_seats + 1 WHERE id=?`, [id]
    );
    await log({
      entityId: s[0].entity_id, userId: req.user.sub,
      action: 'subscription_license.create', subjectType: 'subscription_license',
      subjectId: r.insertId, metadata: { subscriptionId: Number(id) },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

// The seat lifecycle is one state machine for this page and for the People &
// Culture checklist (licenseAssignment.service): available → assigned → idle
// (still held, not in use) → revoked back to available. A seat is given only
// when available — an idle seat keeps its holder until the revoke is recorded —
// and only to an active account of the same company. These endpoints record the
// seat in Workspace; the vendor portal is changed by IT, outside the app.
function licenseFail(res, error, next) {
  if (error instanceof licenses.LicenseError) return fail(res, error.code, error.message, error.status);
  return next(error);
}

async function assignLicense(req, res, next) {
  const conn = await pool.getConnection();
  let result;
  try {
    await conn.beginTransaction();
    result = await licenses.assignLicense(conn, {
      entityId: req.user.entityId, licenseId: Number(req.params.id), userId: Number(req.body.userId), actorId: req.user.sub, via: 'subscription',
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    return licenseFail(res, e, next);
  } finally { conn.release(); }

  await notif.create({
    userId: Number(req.body.userId), entityId: req.user.entityId,
    title: 'License software ditugaskan',
    body: result.productName,
    event: 'license.assigned',
    subjectType: 'subscription_license', subjectId: result.licenseId,
    actionUrl: `/it/subscriptions/${result.subscriptionId}`,
  }).catch(() => {});
  return ok(res, { id: result.licenseId, assignmentId: result.assignmentId });
}

async function revokeLicense(req, res, next) {
  if (req.body.confirmedAtVendor !== true) {
    return fail(res, 'VENDOR_CONFIRM_REQUIRED', 'Cabut akses pengguna di portal vendor dulu, lalu centang konfirmasinya. Aplikasi tidak mengubah akun di vendor.', 409);
  }
  const conn = await pool.getConnection();
  let result;
  try {
    await conn.beginTransaction();
    result = await licenses.revokeLicense(conn, {
      entityId: req.user.entityId, licenseId: Number(req.params.id), actorId: req.user.sub, reason: req.body.reason || null, via: 'subscription', confirmedAtVendor: true,
    });
    if (!result.changed) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Lisensi ini tidak sedang ditetapkan ke pengguna.', 409);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    return licenseFail(res, e, next);
  } finally { conn.release(); }
  return ok(res, { id: result.licenseId, recordedOnly: true });
}

// Active accounts of the signed-in user's company a seat may be given to,
// searched by name or work email; the id stays the internal value.
async function assignableUsers(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const args = [req.user.entityId];
    let filter = '';
    if (q) { filter = ' AND (u.name LIKE ? OR u.email LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email
         FROM users u
        WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL${filter}
        ORDER BY u.name ASC, u.email ASC
        LIMIT 20`,
      args
    );
    return ok(res, rows.map((row) => ({ id: Number(row.id), name: row.name, email: row.email })));
  } catch (e) { next(e); }
}

async function markIdle(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE subscription_licenses l JOIN software_subscriptions s ON s.id = l.subscription_id
          SET l.status='idle'
        WHERE l.id=? AND s.entity_id=? AND l.status='assigned'`, [id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'License tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'subscription_license.mark_idle', subjectType: 'subscription_license',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { createLicense, assignLicense, revokeLicense, markIdle, assignableUsers };
