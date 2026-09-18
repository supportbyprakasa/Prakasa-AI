const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');

/**
 * Upload dokumen handover (serah terima). Boleh link ke document Fase 2 atau file baru.
 */
async function uploadHandover(req, res, next) {
  try {
    const { id } = req.params; // assignment id
    const { documentId } = req.body;

    const [aRows] = await pool.query(
      `SELECT * FROM device_assignments WHERE id=?`, [id]
    );
    if (!aRows[0]) return fail(res, 'NOT_FOUND', 'Assignment tidak ditemukan', 404);

    let fileId = null;
    let webViewLink = null;
    if (req.file) {
      const up = await drive.uploadFile({
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      fileId = up.id; webViewLink = up.webViewLink;
    }

    const [h] = await pool.query(
      `INSERT INTO device_handover_documents
       (assignment_id, document_id, drive_file_id, web_view_link, signed_by_user, signed_by_it, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [id, documentId || null, fileId, webViewLink, aRows[0].assigned_to, req.user.sub]
    );
    await pool.query(
      `UPDATE device_assignments SET handover_document_id=? WHERE id=?`, [h.insertId, id]
    );

    await log({
      entityId: aRows[0].entity_id, userId: req.user.sub,
      action: 'device_handover.upload', subjectType: 'device_assignment',
      subjectId: Number(id), metadata: { driveFileId: fileId },
    });

    return ok(res, { id: h.insertId, webViewLink }, undefined, 201);
  } catch (e) { next(e); }
}

async function uploadReturn(req, res, next) {
  try {
    const { id } = req.params; // assignment id
    const { documentId, conditionOnReturn, accessoriesReturned } = req.body;

    const [aRows] = await pool.query(
      `SELECT * FROM device_assignments WHERE id=?`, [id]
    );
    if (!aRows[0]) return fail(res, 'NOT_FOUND', 'Assignment tidak ditemukan', 404);

    let fileId = null;
    let webViewLink = null;
    if (req.file) {
      const up = await drive.uploadFile({
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      fileId = up.id; webViewLink = up.webViewLink;
    }

    const [h] = await pool.query(
      `INSERT INTO device_return_documents
       (assignment_id, document_id, drive_file_id, web_view_link,
        condition_on_return, accessories_returned, signed_by_user, signed_by_it, signed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, documentId || null, fileId, webViewLink,
       conditionOnReturn || null,
       accessoriesReturned ? JSON.stringify(accessoriesReturned) : null,
       aRows[0].assigned_to, req.user.sub]
    );
    await pool.query(
      `UPDATE device_assignments SET return_document_id=? WHERE id=?`, [h.insertId, id]
    );

    await log({
      entityId: aRows[0].entity_id, userId: req.user.sub,
      action: 'device_return.upload', subjectType: 'device_assignment',
      subjectId: Number(id), metadata: { driveFileId: fileId },
    });

    return ok(res, { id: h.insertId, webViewLink }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { uploadHandover, uploadReturn };
