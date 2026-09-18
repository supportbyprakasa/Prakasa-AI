const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function createLicense(req, res, next) {
  try {
    const { id } = req.params; // subscription id
    const { licenseKey, seatLabel } = req.body;
    const [s] = await pool.query(
      `SELECT * FROM software_subscriptions WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!s[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO subscription_licenses
       (subscription_id, license_key, seat_label, status) VALUES (?, ?, ?, 'available')`,
      [id, licenseKey || null, seatLabel || null]
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

async function assignLicense(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // license id
    const { userId } = req.body;

    await conn.beginTransaction();
    const [l] = await conn.query(
      `SELECT * FROM subscription_licenses WHERE id=? FOR UPDATE`, [id]
    );
    if (!l[0]) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'License tidak ditemukan', 404); }
    if (l[0].status === 'assigned') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'License sudah di-assign', 409);
    }

    await conn.query(
      `UPDATE subscription_licenses
          SET status='assigned', assigned_to=?, assigned_at=NOW()
        WHERE id=?`, [userId, id]
    );
    const [sa] = await conn.query(
      `INSERT INTO software_assignments
       (subscription_id, license_id, user_id, assigned_by, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [l[0].subscription_id, id, userId, req.user.sub]
    );
    await conn.commit();

    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription_license.assign', subjectType: 'subscription_license',
      subjectId: Number(id), metadata: { userId },
    });

    // Notif ke user
    const [sub] = await pool.query(
      `SELECT entity_id AS entityId, product_name AS productName
         FROM software_subscriptions WHERE id=?`, [l[0].subscription_id]
    );
    if (sub[0]) {
      await notif.create({
        userId, entityId: sub[0].entityId,
        title: 'License software ditugaskan',
        body: sub[0].productName,
        event: 'license.assigned',
        subjectType: 'subscription_license', subjectId: Number(id),
        actionUrl: `/it/subscriptions/${l[0].subscription_id}`,
      });
    }

    return ok(res, { id: Number(id), assignmentId: sa.insertId });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function revokeLicense(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await conn.beginTransaction();
    const [l] = await conn.query(
      `SELECT * FROM subscription_licenses WHERE id=? FOR UPDATE`, [id]
    );
    if (!l[0]) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'License tidak ditemukan', 404); }
    if (l[0].status !== 'assigned') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'License tidak dalam status assigned', 409);
    }

    await conn.query(
      `UPDATE subscription_licenses
          SET status='available', assigned_to=NULL, assigned_at=NULL
        WHERE id=?`, [id]
    );
    await conn.query(
      `UPDATE software_assignments
          SET status='revoked', revoked_at=NOW(), notes=?
        WHERE license_id=? AND status='active'`,
      [reason || null, id]
    );
    await conn.commit();

    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription_license.revoke', subjectType: 'subscription_license',
      subjectId: Number(id), metadata: { reason },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function markIdle(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE subscription_licenses SET status='idle'
        WHERE id=? AND status='assigned'`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'License tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription_license.mark_idle', subjectType: 'subscription_license',
      subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { createLicense, assignLicense, revokeLicense, markIdle };
