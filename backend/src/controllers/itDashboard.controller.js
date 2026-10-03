const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { runModule } = require('../services/ai/provider');
const directory = require('../services/peopleDirectory.service');
const { infrastructureBlock } = require('../services/itRegisters.service');
const { HOLDER_JOINS, HOLDER_RESIGNED } = require('../services/deviceHolderSql');
const {
  DEVICE_STATUSES, DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS, PROBLEMATIC_STATUSES,
} = require('../config/itAssets');

// The IT dashboard of the signed-in user's company ONLY (rule 21): the entity
// is req.user.entityId — a company id in the query or body is never read.
// Numbers are labelled so they reconcile with the owner's device report (rule 22).

const n = (v) => Number(v || 0);
const WARRANTY_DAYS = 60;
const IN = (list) => list.map((s) => `'${s}'`).join(', ');

async function deviceNumbers(entityId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total,
            ${DEVICE_STATUSES.map((s) => `SUM(d.status = '${s}') AS ${s}`).join(',\n            ')},
            SUM(d.status IN (${IN(PROBLEMATIC_STATUSES)})) AS problematic,
            SUM(d.asset_code IS NULL OR TRIM(d.asset_code) = '') AS without_asset_code,
            SUM(d.warranty_end BETWEEN DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
                AND DATE_ADD(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${WARRANTY_DAYS} DAY)) AS warranty_ending,
            SUM(${HOLDER_RESIGNED}) AS resigned_holder
       FROM devices d
       ${HOLDER_JOINS}
      WHERE d.entity_id = ? AND d.deleted_at IS NULL`,
    [entityId],
  );
  const byStatus = Object.fromEntries(DEVICE_STATUSES.map((s) => [s, n(row?.[s])]));
  return {
    total: n(row?.total),
    // Kept for the existing page: the lifecycle counts by their old names.
    available: byStatus.available,
    assigned: byStatus.assigned,
    maintenance: byStatus.maintenance,
    repair: byStatus.repair,
    retired: byStatus.retired,
    byStatus,
    statusLabels: DEVICE_STATUS_LABELS,
    active: byStatus.assigned,
    problematic: n(row?.problematic),
    withoutAssetCode: n(row?.without_asset_code),
    warrantyEnding: n(row?.warranty_ending),
    warrantyWindowDays: WARRANTY_DAYS,
    resignedHolder: n(row?.resigned_holder),
  };
}

async function summary(req, res, next) {
  try {
    const entityId = req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'Akun tidak terhubung ke perusahaan', 400);

    const devices = await deviceNumbers(entityId);
    const people = await directory.summary(entityId);

    const [typeRows] = await pool.query(
      `SELECT d.device_type, COUNT(*) AS total
         FROM devices d WHERE d.entity_id = ? AND d.deleted_at IS NULL
        GROUP BY d.device_type ORDER BY total DESC`, [entityId]
    );
    const [locationRows] = await pool.query(
      `SELECT d.location_id, l.name, COUNT(*) AS total,
              SUM(d.status IN (${IN(PROBLEMATIC_STATUSES)})) AS problematic
         FROM devices d LEFT JOIN org_locations l ON l.id = d.location_id AND l.entity_id = d.entity_id
        WHERE d.entity_id = ? AND d.deleted_at IS NULL
        GROUP BY d.location_id, l.name ORDER BY total DESC`, [entityId]
    );
    const byType = typeRows.map((r) => ({ deviceType: r.device_type, label: DEVICE_TYPE_LABELS[r.device_type] || r.device_type, total: n(r.total) }));
    const byLocation = locationRows.map((r) => ({
      locationId: r.location_id != null ? Number(r.location_id) : null,
      name: r.name || 'Tanpa lokasi',
      total: n(r.total),
      problematic: n(r.problematic),
    }));

    const [warrantyDue] = await pool.query(
      `SELECT id, asset_code AS assetCode, device_type AS deviceType,
              warranty_end AS warrantyEnd,
              DATEDIFF(warranty_end, DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS daysLeft
         FROM devices
        WHERE entity_id=? AND deleted_at IS NULL
          AND warranty_end IS NOT NULL
          AND warranty_end BETWEEN DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) AND DATE_ADD(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL 60 DAY)
        ORDER BY warranty_end ASC LIMIT 20`, [entityId]
    );

    const [[subs]] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        SUM(status='active') AS active,
        SUM(status='expiring') AS expiring,
        SUM(status='expired') AS expired,
        SUM(total_seats) AS totalSeats
       FROM software_subscriptions WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );

    const [renewalsDue] = await pool.query(
      `SELECT id, product_name AS productName, renewal_date AS renewalDate,
              DATEDIFF(renewal_date, DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)) AS daysLeft, total_seats AS totalSeats
         FROM software_subscriptions
        WHERE entity_id=? AND deleted_at IS NULL
          AND status IN ('active','expiring')
          AND renewal_date <= DATE_ADD(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL 30 DAY)
        ORDER BY renewal_date ASC LIMIT 20`, [entityId]
    );

    const [[idleLicenses]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM subscription_licenses l
         JOIN software_subscriptions s ON s.id = l.subscription_id
        WHERE s.entity_id=? AND l.status='idle'`, [entityId]
    );

    const [pendingInvoices] = await pool.query(
      `SELECT i.id, i.subscription_id AS subscriptionId, i.invoice_number AS invoiceNumber, s.product_name AS productName,
              i.status, i.invoice_date AS invoiceDate
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE s.entity_id=? AND i.status IN ('pending_upload','uploaded')
        ORDER BY i.invoice_date ASC LIMIT 20`, [entityId]
    );

    return ok(res, {
      people: {
        // "Karyawan (direktori)": active employees incl. accounts not reviewed yet.
        headcount: people.headcount,
        unreviewedAccounts: people.unreviewedAccounts,
        groupStaff: people.groupStaff,
        withoutAccount: people.withoutAccount,
      },
      devices,
      byType,
      byLocation,
      warrantyDue: warrantyDue.map((w) => ({ ...w, daysLeft: w.daysLeft != null ? Number(w.daysLeft) : null })),
      subscriptions: {
        total: n(subs?.total), active: n(subs?.active), expiring: n(subs?.expiring),
        expired: n(subs?.expired), totalSeats: n(subs?.totalSeats),
      },
      renewalsDue: renewalsDue.map((r) => ({ ...r, daysLeft: r.daysLeft != null ? Number(r.daysLeft) : null, totalSeats: n(r.totalSeats) })),
      idleLicenses: { total: n(idleLicenses?.total) },
      pendingInvoices,
      // "Infrastruktur" (wave 2, row 2.3): counts only — never an IP address,
      // a cost or a serial number.
      infrastructure: await infrastructureBlock(pool, entityId),
    });
  } catch (e) { next(e); }
}

async function aiReport(req, res, next) {
  try {
    // Only the signed-in user's company (rule 21).
    const entityId = req.user.entityId;

    // Ambil data mentah untuk dilaporkan
    const [devices] = await pool.query(
      `SELECT d.asset_code AS assetCode, d.device_type AS deviceType, d.status,
              d.condition_state AS conditionState, d.warranty_end AS warrantyEnd,
              d.purchase_year AS purchaseYear, l.name AS location,
              ${HOLDER_RESIGNED} AS heldByResigned
         FROM devices d
         LEFT JOIN org_locations l ON l.id = d.location_id AND l.entity_id = d.entity_id
         ${HOLDER_JOINS}
        WHERE d.entity_id=? AND d.deleted_at IS NULL LIMIT 200`, [entityId]
    );
    const [subs] = await pool.query(
      `SELECT product_name AS productName, total_seats AS totalSeats,
              renewal_date AS renewalDate, status
         FROM software_subscriptions WHERE entity_id=? AND deleted_at IS NULL LIMIT 200`, [entityId]
    );

    const [[entity]] = await pool.query('SELECT name FROM entities WHERE id = ? LIMIT 1', [entityId]);
    const prompt = `Data aset IT ${entity?.name || 'perusahaan'} (entity_id=${entityId}). ` +
      `Status: assigned=Aktif, available=Cadangan, damaged=Rusak, retired=Tidak aktif, ` +
      `maintenance=Perawatan, repair=Perbaikan (di vendor), lost=Hilang, disposed=Dibuang; ` +
      `heldByResigned=1 berarti pemegangnya sudah resign.\n\n` +
      `DEVICES:\n${JSON.stringify(devices, null, 2)}\n\n` +
      `SUBSCRIPTIONS:\n${JSON.stringify(subs, null, 2)}\n\n` +
      `Berikan ringkasan: (1) status keseluruhan, (2) aset bermasalah, ` +
      `(3) warranty/renewal yang akan jatuh tempo dalam 30 hari, ` +
      `(4) rekomendasi tindakan prioritas.`;

    const result = await runModule('it_asset_report', prompt, {
      entityId,
      userId: req.user.sub,
      subjectType: 'entity',
      subjectId: entityId,
    });

    const [ins] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, department_id, module, subject_type, subject_id,
        provider, model, content, tokens_in, tokens_out, created_by)
       VALUES (?, NULL, 'it_asset_report', 'entity', ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, entityId, result.provider, result.model, result.content,
       result.tokensIn || null, result.tokensOut || null, req.user.sub]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'ai.it_asset_report', subjectType: 'entity', subjectId: entityId,
      metadata: { summaryId: ins.insertId, provider: result.provider },
    });

    return ok(res, {
      summaryId: ins.insertId,
      provider: result.provider,
      model: result.model,
      content: result.content,
    }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { summary, aiReport };
