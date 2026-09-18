const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['s.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('s.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.status) { where.push('s.status = ?'); args.push(req.query.status); }
    if (req.query.vendorId) { where.push('s.vendor_id = ?'); args.push(req.query.vendorId); }

    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId, s.department_id AS departmentId,
              s.vendor_id AS vendorId, v.name AS vendorName,
              s.product_name AS productName, s.plan_name AS planName,
              s.license_type AS licenseType, s.billing_cycle AS billingCycle,
              s.total_seats AS totalSeats, s.unit_price AS unitPrice,
              s.currency, s.start_date AS startDate, s.renewal_date AS renewalDate,
              s.auto_renew AS autoRenew, s.status,
              s.pic_user_id AS picUserId, u.name AS picName,
              s.jurnal_reference_id AS jurnalReferenceId,
              s.created_at AS createdAt,
              (SELECT COUNT(*) FROM subscription_licenses l
                WHERE l.subscription_id=s.id AND l.status='assigned') AS assignedSeats,
              (SELECT COUNT(*) FROM subscription_licenses l
                WHERE l.subscription_id=s.id AND l.status='available') AS availableSeats,
              (SELECT COUNT(*) FROM subscription_licenses l
                WHERE l.subscription_id=s.id AND l.status='idle') AS idleSeats
         FROM software_subscriptions s
         LEFT JOIN software_vendors v ON v.id = s.vendor_id
         LEFT JOIN users u ON u.id = s.pic_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.renewal_date ASC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT s.*, v.name AS vendorName, u.name AS picName
         FROM software_subscriptions s
         LEFT JOIN software_vendors v ON v.id = s.vendor_id
         LEFT JOIN users u ON u.id = s.pic_user_id
        WHERE s.id=? AND s.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    const [licenses] = await pool.query(
      `SELECT l.id, l.license_key AS licenseKey, l.seat_label AS seatLabel,
              l.assigned_to AS assignedTo, u.name AS assignedToName,
              l.status, l.assigned_at AS assignedAt, l.last_used_at AS lastUsedAt
         FROM subscription_licenses l
         LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.subscription_id=? ORDER BY l.id ASC`, [id]
    );
    const [invoices] = await pool.query(
      `SELECT id, invoice_number AS invoiceNumber, invoice_date AS invoiceDate,
              amount, currency, total_amount AS totalAmount, status,
              document_id AS documentId, jurnal_reference_id AS jurnalReferenceId,
              uploaded_at AS uploadedAt, verified_at AS verifiedAt
         FROM subscription_invoices WHERE subscription_id=? ORDER BY id DESC`, [id]
    );
    const [renewals] = await pool.query(
      `SELECT id, request_date AS requestDate, current_renewal_date AS currentRenewalDate,
              proposed_renewal_date AS proposedRenewalDate, proposed_seats AS proposedSeats,
              proposed_amount AS proposedAmount, status, decided_at AS decidedAt
         FROM subscription_renewals WHERE subscription_id=? ORDER BY id DESC`, [id]
    );
    const [payments] = await pool.query(
      `SELECT id, invoice_id AS invoiceId, paid_at AS paidAt, amount, currency,
              payment_method AS paymentMethod, reference_no AS referenceNo, status
         FROM subscription_payments WHERE subscription_id=? ORDER BY id DESC`, [id]
    );

    return ok(res, { ...rows[0], licenses, invoices, renewals, payments });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, vendorId, productName, planName,
      licenseType = 'per_user', billingCycle = 'monthly',
      totalSeats = 1, unitPrice, currency = 'IDR',
      startDate, renewalDate, autoRenew = 0, picUserId,
      jurnalReferenceId, notes,
      // opsional: langsung generate N licenses
      generateLicenses = false,
    } = req.body;

    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO software_subscriptions
       (entity_id, department_id, vendor_id, product_name, plan_name,
        license_type, billing_cycle, total_seats, unit_price, currency,
        start_date, renewal_date, auto_renew, status, pic_user_id,
        jurnal_reference_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [entityId, departmentId || null, vendorId || null, productName,
       planName || null, licenseType, billingCycle, totalSeats,
       unitPrice || null, currency, startDate || null, renewalDate,
       autoRenew ? 1 : 0, picUserId || null,
       jurnalReferenceId || null, notes || null, req.user.sub]
    );

    if (generateLicenses && totalSeats > 0) {
      for (let i = 1; i <= totalSeats; i++) {
        await conn.query(
          `INSERT INTO subscription_licenses
           (subscription_id, seat_label, status) VALUES (?, ?, 'available')`,
          [r.insertId, `Seat #${i}`]
        );
      }
    }

    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'subscription.create', subjectType: 'software_subscription',
      subjectId: r.insertId, metadata: { productName, totalSeats, renewalDate },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      productName, planName, licenseType, billingCycle, totalSeats,
      unitPrice, currency, startDate, renewalDate, autoRenew, status,
      picUserId, jurnalReferenceId, notes,
    } = req.body;

    const [r] = await pool.query(
      `UPDATE software_subscriptions SET
         product_name=COALESCE(?,product_name), plan_name=COALESCE(?,plan_name),
         license_type=COALESCE(?,license_type), billing_cycle=COALESCE(?,billing_cycle),
         total_seats=COALESCE(?,total_seats), unit_price=COALESCE(?,unit_price),
         currency=COALESCE(?,currency), start_date=COALESCE(?,start_date),
         renewal_date=COALESCE(?,renewal_date),
         auto_renew=COALESCE(?,auto_renew), status=COALESCE(?,status),
         pic_user_id=COALESCE(?,pic_user_id),
         jurnal_reference_id=COALESCE(?,jurnal_reference_id),
         notes=COALESCE(?,notes)
       WHERE id=? AND deleted_at IS NULL`,
      [productName || null, planName || null, licenseType || null, billingCycle || null,
       totalSeats ?? null, unitPrice ?? null, currency || null, startDate || null,
       renewalDate || null, autoRenew ?? null, status || null, picUserId ?? null,
       jurnalReferenceId || null, notes || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription.update', subjectType: 'software_subscription', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE software_subscriptions SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'subscription.delete', subjectType: 'software_subscription', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function renewalsDue(req, res, next) {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 30);
    const where = ['s.deleted_at IS NULL', `s.status IN ('active','expiring')`];
    const args = [];
    if (req.query.entityId) { where.push('s.entity_id = ?'); args.push(req.query.entityId); }

    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId, s.product_name AS productName,
              s.plan_name AS planName, s.total_seats AS totalSeats,
              s.renewal_date AS renewalDate,
              DATEDIFF(s.renewal_date, CURDATE()) AS daysLeft,
              s.status, s.auto_renew AS autoRenew,
              s.pic_user_id AS picUserId, u.name AS picName,
              (SELECT COUNT(*) FROM subscription_licenses l
                WHERE l.subscription_id=s.id AND l.status='assigned') AS assignedSeats
         FROM software_subscriptions s
         LEFT JOIN users u ON u.id = s.pic_user_id
        WHERE ${where.join(' AND ')}
          AND s.renewal_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        ORDER BY s.renewal_date ASC`, [...args, days]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove, renewalsDue };
