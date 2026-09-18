const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const sigSvc = require('../services/signature.service');
const pdfSvc = require('../services/pdf.service');
const drive = require('../services/googleDrive.service');
const { resolveFolder } = require('./folderMappingRules.controller');

/**
 * Simpan / perbarui asset tanda tangan user (terenkripsi).
 * Body: { imageBase64 }  — image/png
 */
async function saveSignatureAsset(req, res, next) {
  try {
    const { imageBase64 } = req.body;
    const buffer = Buffer.from(imageBase64, 'base64');
    if (buffer.length > 500 * 1024) {
      return fail(res, 'VALIDATION_ERROR', 'Ukuran tanda tangan terlalu besar (maks 500KB)', 400);
    }
    const { encrypted, iv, authTag } = sigSvc.encryptBuffer(buffer);

    await pool.query(
      `INSERT INTO signature_assets (user_id, encrypted_blob, iv, auth_tag, mime_type)
       VALUES (?, ?, ?, ?, 'image/png')
       ON DUPLICATE KEY UPDATE
         encrypted_blob=VALUES(encrypted_blob), iv=VALUES(iv), auth_tag=VALUES(auth_tag)`,
      [req.user.sub, encrypted, iv, authTag]
    );

    await log({
      entityId: null, userId: req.user.sub,
      action: 'signature_asset.save', subjectType: 'user', subjectId: req.user.sub,
    });

    return ok(res, { saved: true });
  } catch (e) { next(e); }
}

/**
 * Buat signature request — prasyarat: approval Level 2 sudah 'approved'.
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, documentId, approvalRequestId,
      signatureType = 'level_2', signerUserId,
    } = req.body;

    await conn.beginTransaction();
    // validasi approval
    const [ap] = await conn.query(
      `SELECT * FROM approval_requests WHERE id=? FOR UPDATE`, [approvalRequestId]
    );
    if (!ap[0]) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Approval tidak ditemukan', 404); }
    if (ap[0].status !== 'approved') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Approval belum disetujui, signature tidak boleh dibuat', 409);
    }

    // validasi dokumen
    const [doc] = await conn.query(
      `SELECT * FROM documents WHERE id=? AND deleted_at IS NULL`, [documentId]
    );
    if (!doc[0]) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404); }

    const [sr] = await conn.query(
      `INSERT INTO signature_requests
       (entity_id, department_id, document_id, approval_request_id,
        signature_type, status, requested_by, signed_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [entityId, departmentId || null, documentId, approvalRequestId,
       signatureType, req.user.sub, signerUserId || null]
    );

    await conn.query(
      `INSERT INTO signature_logs
       (signature_request_id, action, actor_user_id, document_id, note)
       VALUES (?, 'requested', ?, ?, ?)`,
      [sr.insertId, req.user.sub, documentId, 'Signature requested']
    );

    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'signature.request', subjectType: 'signature_request', subjectId: sr.insertId,
      metadata: { documentId, approvalRequestId },
    });

    if (signerUserId) {
      await notif.create({
        userId: signerUserId, entityId,
        title: 'Permintaan tanda tangan',
        body: `Dokumen siap ditandatangani`,
        event: 'signature.requested',
        subjectType: 'signature_request', subjectId: sr.insertId,
        actionUrl: `/signatures/${sr.insertId}`,
      });
    }

    return ok(res, { id: sr.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

/**
 * Tanda tangan — generate PDF final berisi berita acara + upload ke Drive.
 * TIDAK expose raw signature ke user manapun.
 */
async function sign(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    await conn.beginTransaction();
    const [sr] = await conn.query(
      `SELECT * FROM signature_requests WHERE id=? FOR UPDATE`, [id]
    );
    const s = sr[0];
    if (!s) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Signature request tidak ditemukan', 404); }
    if (s.status !== 'pending') { await conn.rollback(); return fail(res, 'CONFLICT', 'Sudah tidak pending', 409); }

    // user harus approver/signer yang ditunjuk ATAU punya permission sign
    if (s.signed_by && s.signed_by !== req.user.sub && !req.user.permissions?.includes('signature.sign')) {
      await conn.rollback();
      return fail(res, 'FORBIDDEN', 'Anda tidak berhak menandatangani', 403);
    }

    // Ambil dokumen & metadata
    const [docRows] = await conn.query(
      `SELECT d.*, f.mime_type AS mimeType FROM documents d
         LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
        WHERE d.id=?`, [s.document_id]
    );
    const doc = docRows[0];

    // Hash dokumen
    const [user] = await conn.query(
      `SELECT id, name, email FROM users WHERE id=?`, [req.user.sub]
    );
    const verificationCode = crypto.randomBytes(16).toString('hex').toUpperCase();
    const documentHash = crypto
      .createHash('sha256')
      .update(`${doc.id}|${doc.drive_file_id || ''}|${Date.now()}`)
      .digest('hex');

    // Generate PDF
    const pdfBuffer = await pdfSvc.generateSignedPdf({
      title: doc.title,
      signerName: user[0].name,
      signerEmail: user[0].email,
      documentHash,
      verificationCode,
      signedAt: new Date(),
    });

    // Upload PDF ke Drive (folder sesuai rule document_type dokumen)
    const folderId = await resolveFolder({
      entityId: s.entity_id,
      departmentId: s.department_id,
      documentType: doc.document_type,
    });
    const uploaded = await drive.uploadFile({
      name: `${doc.title} - SIGNED.pdf`,
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
      parentId: folderId || undefined,
    });

    // Simpan metadata
    const [sd] = await conn.query(
      `INSERT INTO signed_documents
       (signature_request_id, document_id, drive_file_id, drive_folder_id,
        web_view_link, document_hash, signed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, s.document_id, uploaded.id, folderId || null,
       uploaded.webViewLink || null, documentHash, req.user.sub]
    );

    await conn.query(
      `INSERT INTO document_verifications
       (document_id, verification_code, document_hash, signed_document_id)
       VALUES (?, ?, ?, ?)`,
      [s.document_id, verificationCode, documentHash, sd.insertId]
    );

    await conn.query(
      `UPDATE signature_requests
          SET status='signed', signed_by=?, signed_at=NOW() WHERE id=?`,
      [req.user.sub, id]
    );

    await conn.query(
      `INSERT INTO signature_logs
       (signature_request_id, action, actor_user_id, document_id, document_hash, note)
       VALUES (?, 'signed', ?, ?, ?, ?)`,
      [id, req.user.sub, s.document_id, documentHash, 'Document signed']
    );

    await conn.commit();
    await log({
      entityId: s.entity_id, userId: req.user.sub,
      action: 'signature.signed', subjectType: 'signature_request', subjectId: Number(id),
      metadata: { documentId: s.document_id, documentHash, verificationCode },
    });

    await notif.create({
      userId: s.requested_by, entityId: s.entity_id,
      title: 'Dokumen telah ditandatangani',
      body: doc.title,
      event: 'signature.signed',
      subjectType: 'signature_request', subjectId: Number(id),
      actionUrl: `/signatures/${id}`,
    });

    return ok(res, {
      signatureRequestId: Number(id),
      signedDocumentId: sd.insertId,
      webViewLink: uploaded.webViewLink,
      documentHash,
      verificationCode,
    });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.status) { where.push('s.status = ?'); args.push(req.query.status); }
    if (req.query.entityId) { where.push('s.entity_id = ?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT s.id, s.entity_id AS entityId, s.document_id AS documentId,
              d.title AS documentTitle, s.signature_type AS signatureType,
              s.status, s.requested_by AS requestedBy, s.signed_by AS signedBy,
              s.signed_at AS signedAt, s.created_at AS createdAt
         FROM signature_requests s
         JOIN documents d ON d.id=s.document_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.id DESC LIMIT 100`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function verify(req, res, next) {
  try {
    const { code } = req.params;
    const [rows] = await pool.query(
      `SELECT v.id, v.document_id AS documentId, v.verification_code AS verificationCode,
              v.document_hash AS documentHash, v.created_at AS createdAt,
              d.title AS documentTitle, sd.web_view_link AS webViewLink,
              u.name AS signedByName, sd.signed_at AS signedAt
         FROM document_verifications v
         JOIN documents d ON d.id=v.document_id
         LEFT JOIN signed_documents sd ON sd.id=v.signed_document_id
         LEFT JOIN users u ON u.id=sd.signed_by
        WHERE v.verification_code=?`, [code]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Kode verifikasi tidak ditemukan', 404);
    return ok(res, rows[0]);
  } catch (e) { next(e); }
}

module.exports = { saveSignatureAsset, create, sign, list, verify };
