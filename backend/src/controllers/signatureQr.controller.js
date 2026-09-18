const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const qrSvc = require('../services/qrCode.service');

function isValidCode(code) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(code || ''));
}

async function generate(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const { documentId, signatureRequestId = null } = req.body;

    await conn.beginTransaction();

    const [documents] = await conn.query(
      `SELECT id, entity_id, title
         FROM documents
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [documentId, entityId]
    );
    if (!documents[0]) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    }

    const signedWhere = ['sd.document_id=?'];
    const signedArgs = [documentId];
    if (signatureRequestId) {
      signedWhere.push('sd.signature_request_id=?');
      signedArgs.push(signatureRequestId);
    }

    const [signedRows] = await conn.query(
      `SELECT sd.id, sd.signature_request_id AS signatureRequestId,
              sd.document_hash AS documentHash, sd.signed_at AS signedAt,
              COALESCE(rule.checksum_algorithm, 'sha256') AS hashAlgorithm
         FROM signed_documents sd
         JOIN signature_requests sr ON sr.id=sd.signature_request_id
         LEFT JOIN signature_rules rule ON rule.id=sr.signature_rule_id
        WHERE ${signedWhere.join(' AND ')}
          AND sr.entity_id=?
        ORDER BY sd.id DESC
        LIMIT 1 FOR UPDATE`,
      [...signedArgs, entityId]
    );
    const signed = signedRows[0];
    if (!signed) {
      await conn.rollback();
      return fail(
        res,
        'CONFLICT',
        'QR verifikasi hanya dapat dibuat untuk dokumen yang sudah signed',
        409
      );
    }

    const [existingRows] = await conn.query(
      `SELECT * FROM document_verifications
        WHERE signed_document_id=?
        ORDER BY id DESC
        LIMIT 1 FOR UPDATE`,
      [signed.id]
    );
    let verification = existingRows[0];

    if (!verification) {
      const verificationCode = crypto.randomBytes(16).toString('hex').toUpperCase();
      const [inserted] = await conn.query(
        `INSERT INTO document_verifications
         (document_id, verification_code, document_hash,
          signed_document_id, hash_algorithm)
         VALUES (?, ?, ?, ?, ?)`,
        [
          documentId,
          verificationCode,
          signed.documentHash,
          signed.id,
          signed.hashAlgorithm || 'sha256',
        ]
      );

      const [createdRows] = await conn.query(
        'SELECT * FROM document_verifications WHERE id=? LIMIT 1',
        [inserted.insertId]
      );
      verification = createdRows[0];
    }

    const qr = await qrSvc.generateVerificationQr({
      verificationCode: verification.verification_code,
      entityId,
      userId: req.user.sub,
      subjectId: verification.id,
    });

    await conn.query(
      `UPDATE document_verifications
          SET verification_url=?, qr_generated_at=NOW()
        WHERE id=?`,
      [qr.payload, verification.id]
    );

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'signature_qr.generate',
      subjectType: 'document_verification',
      subjectId: verification.id,
      metadata: {
        documentId,
        signedDocumentId: signed.id,
      },
    });

    return ok(res, {
      verificationId: verification.id,
      verificationCode: verification.verification_code,
      verificationUrl: qr.payload,
      qrDataUrl: qr.dataUrl,
    }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally {
    conn.release();
  }
}

async function getForDocument(req, res, next) {
  try {
    const [documents] = await pool.query(
      `SELECT id FROM documents
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.documentId, req.entityScope.entityId]
    );
    if (!documents[0]) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);

    const [rows] = await pool.query(
      `SELECT v.id, v.verification_code AS verificationCode,
              v.verification_url AS verificationUrl,
              v.document_hash AS documentHash,
              v.hash_algorithm AS hashAlgorithm,
              v.valid_until AS validUntil,
              v.qr_generated_at AS qrGeneratedAt,
              v.created_at AS createdAt,
              sd.signed_at AS signedAt
         FROM document_verifications v
         LEFT JOIN signed_documents sd ON sd.id=v.signed_document_id
        WHERE v.document_id=?
        ORDER BY v.id DESC
        LIMIT 1`,
      [req.params.documentId]
    );

    return ok(res, rows[0] || null);
  } catch (error) { next(error); }
}

async function publicVerify(req, res, next) {
  try {
    const code = String(req.params.code || '').trim();
    if (!isValidCode(code)) {
      return fail(res, 'VALIDATION_ERROR', 'Kode verifikasi tidak valid', 400);
    }

    const [rows] = await pool.query(
      `SELECT v.verification_code AS verificationCode,
              v.document_hash AS documentHash,
              v.hash_algorithm AS hashAlgorithm,
              v.valid_until AS validUntil,
              v.created_at AS registeredAt,
              d.title AS documentTitle,
              d.document_type AS documentType,
              sd.signed_at AS signedAt,
              u.name AS signedByName
         FROM document_verifications v
         JOIN documents d ON d.id=v.document_id
         LEFT JOIN signed_documents sd ON sd.id=v.signed_document_id
         LEFT JOIN users u ON u.id=sd.signed_by
        WHERE v.verification_code=?
        LIMIT 1`,
      [code]
    );
    if (!rows[0]) {
      return fail(res, 'NOT_FOUND', 'Kode verifikasi tidak ditemukan', 404);
    }

    const row = rows[0];
    const expired = row.validUntil
      ? new Date(row.validUntil).getTime() < Date.now()
      : false;

    return ok(res, {
      verificationCode: row.verificationCode,
      verified: true,
      valid: !expired,
      documentTitle: row.documentTitle,
      documentType: row.documentType,
      documentHash: row.documentHash,
      hashAlgorithm: row.hashAlgorithm,
      signedAt: row.signedAt,
      signedByName: row.signedByName || null,
      validUntil: row.validUntil,
      registeredAt: row.registeredAt,
    });
  } catch (error) { next(error); }
}

module.exports = { generate, getForDocument, publicVerify };
