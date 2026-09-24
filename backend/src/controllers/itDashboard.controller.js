const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { runModule } = require('../services/ai/provider');

async function summary(req, res, next) {
  try {
    const entityId = req.query.entityId ? Number(req.query.entityId) : req.user.entityId;
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);

    const [[devices]] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        SUM(status='available') AS available,
        SUM(status='assigned') AS assigned,
        SUM(status='maintenance') AS maintenance,
        SUM(status='repair') AS repair,
        SUM(status='retired') AS retired
       FROM devices WHERE entity_id=? AND deleted_at IS NULL`, [entityId]
    );

    const [warrantyDue] = await pool.query(
      `SELECT id, asset_code AS assetCode, device_type AS deviceType,
              warranty_end AS warrantyEnd,
              DATEDIFF(warranty_end, CURDATE()) AS daysLeft
         FROM devices
        WHERE entity_id=? AND deleted_at IS NULL
          AND warranty_end IS NOT NULL
          AND warranty_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY)
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
              DATEDIFF(renewal_date, CURDATE()) AS daysLeft, total_seats AS totalSeats
         FROM software_subscriptions
        WHERE entity_id=? AND deleted_at IS NULL
          AND status IN ('active','expiring')
          AND renewal_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
        ORDER BY renewal_date ASC LIMIT 20`, [entityId]
    );

    const [[idleLicenses]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM subscription_licenses l
         JOIN software_subscriptions s ON s.id = l.subscription_id
        WHERE s.entity_id=? AND l.status='idle'`, [entityId]
    );

    const [pendingInvoices] = await pool.query(
      `SELECT i.id, i.invoice_number AS invoiceNumber, s.product_name AS productName,
              i.status, i.invoice_date AS invoiceDate
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE s.entity_id=? AND i.status IN ('pending_upload','uploaded')
        ORDER BY i.invoice_date ASC LIMIT 20`, [entityId]
    );

    return ok(res, {
      devices,
      warrantyDue,
      subscriptions: subs,
      renewalsDue,
      idleLicenses,
      pendingInvoices,
    });
  } catch (e) { next(e); }
}

async function aiReport(req, res, next) {
  try {
    const entityId = req.query.entityId ? Number(req.query.entityId) : req.user.entityId;

    // Ambil data mentah untuk dilaporkan
    const [devices] = await pool.query(
      `SELECT asset_code AS assetCode, device_type AS deviceType, status,
              condition_state AS conditionState, warranty_end AS warrantyEnd
         FROM devices WHERE entity_id=? AND deleted_at IS NULL LIMIT 200`, [entityId]
    );
    const [subs] = await pool.query(
      `SELECT product_name AS productName, total_seats AS totalSeats,
              renewal_date AS renewalDate, status
         FROM software_subscriptions WHERE entity_id=? AND deleted_at IS NULL LIMIT 200`, [entityId]
    );

    const prompt = `Data aset IT Prakasa Group (entity_id=${entityId}):\n\n` +
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
