const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const billing = require('../services/subscriptionBilling.service');

const LIST_LIMIT = 200;
// The renewal notice window of the itReminders job: inside it a subscription is 'expiring'.
const RENEWAL_NOTICE_DAYS = 30;

async function list(req, res, next) {
  try {
    // Always the signed-in user's company; never from the request.
    const where = ['s.entity_id = ?', 's.deleted_at IS NULL'];
    const args = [req.user.entityId];
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
        ORDER BY s.renewal_date ASC LIMIT ${LIST_LIMIT}`, args
    );
    // The list holds at most LIST_LIMIT rows: the total says when more exist.
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM software_subscriptions s WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { total: Number(total), limit: LIST_LIMIT, hasMore: Number(total) > rows.length });
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
        WHERE s.id=? AND s.entity_id=? AND s.deleted_at IS NULL`, [id, req.user.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);

    const [licenses] = await pool.query(
      `SELECT l.id, (l.license_key IS NOT NULL AND TRIM(l.license_key) <> '') AS hasLicenseKey, l.seat_label AS seatLabel,
              l.assigned_to AS assignedTo, u.name AS assignedToName,
              l.status, l.assigned_at AS assignedAt, l.last_used_at AS lastUsedAt
         FROM subscription_licenses l
         LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.subscription_id=? ORDER BY l.id ASC`, [id]
    );
    const [invoiceRows] = await pool.query(
      `SELECT i.id, i.invoice_number AS invoiceNumber, i.invoice_date AS invoiceDate,
              i.amount, i.tax_amount AS taxAmount, i.currency, i.total_amount AS totalAmount, i.status,
              i.document_id AS documentId, d.drive_file_id AS driveFileId,
              i.jurnal_reference_id AS jurnalReferenceId,
              i.uploaded_at AS uploadedAt, i.verified_at AS verifiedAt,
              (SELECT COALESCE(SUM(p.amount), 0) FROM subscription_payments p
                WHERE p.invoice_id = i.id AND p.status = 'processed') AS paidAmount
         FROM subscription_invoices i
         LEFT JOIN documents d ON d.id = i.document_id
        WHERE i.subscription_id=? ORDER BY i.id DESC`, [id]
    );
    // The PDF link is shown to who manages invoices; everyone sees whether one exists.
    const canSeeFile = (req.user.permissions || []).includes('subscription.invoice.manage');
    const invoices = invoiceRows.map(({ driveFileId, paidAmount, ...inv }) => ({
      ...inv,
      hasFile: Boolean(inv.documentId),
      fileUrl: canSeeFile && driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view` : null,
      ...billing.paymentState({ status: inv.status, total_amount: inv.totalAmount }, Math.round(Number(paidAmount || 0) * 100)),
    }));
    const [renewals] = await pool.query(
      `SELECT id, request_date AS requestDate, current_renewal_date AS currentRenewalDate,
              proposed_renewal_date AS proposedRenewalDate, proposed_seats AS proposedSeats,
              proposed_amount AS proposedAmount, status, decided_at AS decidedAt
         FROM subscription_renewals WHERE subscription_id=? ORDER BY id DESC`, [id]
    );
    const [payments] = await pool.query(
      `SELECT p.id, p.invoice_id AS invoiceId, i.invoice_number AS invoiceNumber, p.paid_at AS paidAt, p.amount, p.currency,
              p.payment_method AS paymentMethod, p.reference_no AS referenceNo,
              p.jurnal_reference_id AS jurnalReferenceId, p.status
         FROM subscription_payments p
         LEFT JOIN subscription_invoices i ON i.id = p.invoice_id
        WHERE p.subscription_id=? ORDER BY p.id DESC`, [id]
    );

    // The licence key itself never leaves the API — only whether one was stored (S10).
    const licenseRows = licenses.map((l) => ({ ...l, hasLicenseKey: Number(l.hasLicenseKey) === 1 }));
    return ok(res, { ...rows[0], licenses: licenseRows, invoices, renewals, payments });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.user.entityId;
    const {
      departmentId, vendorId, productName, planName,
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

    const [[current]] = await pool.query(
      'SELECT status, renewal_date FROM software_subscriptions WHERE id=? AND entity_id=? AND deleted_at IS NULL',
      [id, req.user.entityId]
    );
    if (!current) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);
    // After the vendor renewed, IT moves the renewal date of the same row. A
    // subscription the reminder job had flagged 'expiring' (or one past its
    // date) returns to 'active' once the new date is outside the notice window,
    // unless a status was chosen explicitly. No renewal approval is implied.
    let nextStatus = status || null;
    if (!nextStatus && renewalDate && ['expiring', 'expired'].includes(current.status)) {
      const days = Math.round((Date.parse(`${renewalDate}T00:00:00Z`) - Date.parse(`${billing.todayWib()}T00:00:00Z`)) / 86400000);
      if (Number.isFinite(days) && days > RENEWAL_NOTICE_DAYS) nextStatus = 'active';
      else if (Number.isFinite(days) && days >= 0) nextStatus = 'expiring';
    }
    if (renewalDate) billing.validDate(renewalDate, 'Tanggal perpanjangan');
    if (startDate) billing.validDate(startDate, 'Tanggal mulai');
    if (startDate && renewalDate && startDate > renewalDate) return fail(res, 'VALIDATION_ERROR', 'Tanggal mulai harus sebelum tanggal perpanjangan', 400);

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
       WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [productName || null, planName || null, licenseType || null, billingCycle || null,
       totalSeats ?? null, unitPrice ?? null, currency || null, startDate || null,
       renewalDate || null, autoRenew ?? null, nextStatus, picUserId ?? null,
       jurnalReferenceId || null, notes || null, id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'subscription.update', subjectType: 'software_subscription', subjectId: Number(id),
      metadata: {
        fields: Object.keys(req.body),
        ...(renewalDate ? { renewalDate: { from: current.renewal_date, to: renewalDate } } : {}),
        ...(nextStatus && nextStatus !== current.status ? { status: { from: current.status, to: nextStatus } } : {}),
      },
    });
    return ok(res, { id: Number(id), status: nextStatus || current.status });
  } catch (e) {
    if (e.status) return fail(res, e.code, e.message, e.status);
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE software_subscriptions SET deleted_at=NOW() WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Subscription tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'subscription.delete', subjectType: 'software_subscription', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function renewalsDue(req, res, next) {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 30);
    const where = ['s.entity_id = ?', 's.deleted_at IS NULL', `s.status IN ('active','expiring')`];
    const args = [req.user.entityId];

    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId, s.product_name AS productName,
              s.plan_name AS planName, s.total_seats AS totalSeats,
              s.renewal_date AS renewalDate,
              DATEDIFF(s.renewal_date, DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS daysLeft,
              s.status, s.auto_renew AS autoRenew,
              s.pic_user_id AS picUserId, u.name AS picName,
              (SELECT COUNT(*) FROM subscription_licenses l
                WHERE l.subscription_id=s.id AND l.status='assigned') AS assignedSeats
         FROM software_subscriptions s
         LEFT JOIN users u ON u.id = s.pic_user_id
        WHERE ${where.join(' AND ')}
          AND s.renewal_date <= DATE_ADD(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ? DAY)
        ORDER BY s.renewal_date ASC`, [...args, days]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove, renewalsDue };
