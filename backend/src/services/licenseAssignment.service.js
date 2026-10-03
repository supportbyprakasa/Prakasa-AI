// Giving and taking back a software licence seat on the caller's connection,
// shared by the Langganan page and the People & Culture checklist (one state
// machine: available → assigned → idle → revoked to available; idle keeps its
// holder until revoked). It records the seat in Workspace only: the vendor
// portal is changed by IT outside the app.
// inside its transaction (People & Culture wave 2, §2.1.3: the onboarding and
// offboarding checklist actions). The same rules as the licence endpoints of
// the Langganan page: the licence must belong to a subscription of the entity,
// a seat goes to an active app account of the same entity, and every change
// writes its software_assignments row and its activity log on that connection.

const { logWith } = require('./activityLog.service');

class LicenseError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The licence row (locked) with its subscription, when it belongs to the entity. */
async function lockLicense(conn, entityId, licenseId) {
  const [[row]] = await conn.query(
    `SELECT l.*, s.product_name, s.entity_id AS sub_entity_id
       FROM subscription_licenses l
       JOIN software_subscriptions s ON s.id = l.subscription_id AND s.deleted_at IS NULL
      WHERE l.id = ? AND s.entity_id = ? FOR UPDATE`,
    [licenseId, entityId],
  );
  return row || null;
}

async function assignLicense(conn, { entityId, licenseId, userId, actorId, subscriptionId = null, via = 'hrga' }) {
  const license = await lockLicense(conn, entityId, licenseId);
  if (!license) throw new LicenseError('NOT_FOUND', 'Lisensi tidak ditemukan', 404);
  if (subscriptionId != null && Number(license.subscription_id) !== Number(subscriptionId)) {
    throw new LicenseError('LICENSE_WRONG_PRODUCT', 'Lisensi ini bukan untuk produk yang diminta di checklist', 409);
  }
  if (license.status === 'idle') {
    throw new LicenseError('LICENSE_IDLE_HELD', 'Lisensi idle masih ditetapkan ke pemegang sebelumnya. Catat pencabutannya dulu, lalu tetapkan ke pengguna baru.', 409);
  }
  if (license.status !== 'available') throw new LicenseError('LICENSE_NOT_AVAILABLE', 'Lisensi ini sedang dipakai atau sudah dicabut. Pilih lisensi lain.', 409);
  const [[holder]] = await conn.query(
    "SELECT id, status, deleted_at FROM users WHERE id = ? AND entity_id = ? LIMIT 1",
    [userId, entityId],
  );
  if (!holder) throw new LicenseError('ACCOUNT_REQUIRED', 'Buat akun Prakasa Workspace dulu', 409);
  if (holder.status !== 'active' || holder.deleted_at) {
    throw new LicenseError('ACCOUNT_INACTIVE', 'Akun pengguna ini tidak aktif. Pilih pengguna dengan akun aktif.', 409);
  }
  // One active holder per seat: any assignment still marked active is closed first.
  await conn.query(
    "UPDATE software_assignments SET status = 'revoked', revoked_at = NOW(), notes = 'closed before a new assignment' WHERE license_id = ? AND status = 'active'",
    [licenseId],
  );
  await conn.query(
    "UPDATE subscription_licenses SET status = 'assigned', assigned_to = ?, assigned_at = NOW() WHERE id = ?",
    [userId, licenseId],
  );
  const [sa] = await conn.query(
    `INSERT INTO software_assignments (subscription_id, license_id, user_id, assigned_by, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [license.subscription_id, licenseId, userId, actorId || null],
  );
  await logWith(conn, {
    entityId, userId: actorId || null, action: 'subscription_license.assign', subjectType: 'subscription_license',
    subjectId: Number(licenseId), metadata: { userId: Number(userId), via },
  });
  return {
    licenseId: Number(licenseId), subscriptionId: Number(license.subscription_id),
    productName: license.product_name, assignmentId: Number(sa.insertId),
  };
}

async function revokeLicense(conn, { entityId, licenseId, actorId, reason = null, via = 'hrga', confirmedAtVendor = false }) {
  const license = await lockLicense(conn, entityId, licenseId);
  if (!license) throw new LicenseError('NOT_FOUND', 'Lisensi tidak ditemukan', 404);
  if (!['assigned', 'idle'].includes(license.status)) {
    return { licenseId: Number(licenseId), changed: false };
  }
  await conn.query(
    "UPDATE subscription_licenses SET status = 'available', assigned_to = NULL, assigned_at = NULL WHERE id = ?",
    [licenseId],
  );
  await conn.query(
    "UPDATE software_assignments SET status = 'revoked', revoked_at = NOW(), notes = ? WHERE license_id = ? AND status = 'active'",
    [reason || null, licenseId],
  );
  await logWith(conn, {
    entityId, userId: actorId || null, action: 'subscription_license.revoke', subjectType: 'subscription_license',
    subjectId: Number(licenseId), metadata: { reason: reason || null, from: license.status, via, confirmedAtVendor: confirmedAtVendor === true },
  });
  return { licenseId: Number(licenseId), changed: true };
}

module.exports = { LicenseError, lockLicense, assignLicense, revokeLicense };
