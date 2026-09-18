const crypto = require('crypto');
const pool = require('../db/pool');
const drive = require('./googleDrive.service');
const integrationLog = require('./integrationLog.service');

async function resolveDestinationFolder(submission, conn) {
  const [rows] = await conn.query(
    `SELECT f.folder_mapping_rule_id AS folderRuleId,
            rule.drive_folder_id AS mappedDriveFolderId
       FROM forms f
       LEFT JOIN folder_mapping_rules rule
         ON rule.id = f.folder_mapping_rule_id
        AND rule.is_active = 1
        AND rule.deleted_at IS NULL
      WHERE f.id = ? AND f.deleted_at IS NULL
      LIMIT 1`,
    [submission.form_id]
  );

  return rows[0]?.mappedDriveFolderId
    || process.env.GOOGLE_SHARED_DRIVE_ID
    || null;
}

async function uploadFieldFile({ submission, field, file, user }) {
  if (!file) throw new Error('File wajib');

  if (field.field_type !== 'file') {
    throw new Error('Field ini bukan field file');
  }

  const parentId = await resolveDestinationFolder(submission, pool);
  if (!parentId) {
    throw new Error(
      'Folder tujuan Shared Drive belum dikonfigurasi untuk form ini'
    );
  }

  const checksum = crypto
    .createHash('sha256')
    .update(file.buffer)
    .digest('hex');

  const uploaded = await integrationLog.wrap(
    {
      entityId: submission.entity_id,
      userId: user?.sub || null,
      provider: 'google_drive',
      operation: 'form_submission.upload_field',
      subjectType: 'form_submission',
      subjectId: submission.id,
      requestMeta: {
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        driveFolderId: parentId,
      },
      responseMeta: (result) => ({
        driveFileId: result.id,
        name: result.name,
        mimeType: result.mimeType,
        size: result.size,
      }),
    },
    () => drive.uploadFile({
      name: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
      parentId,
    })
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO drive_files_metadata
       (entity_id, department_id, drive_file_id, drive_folder_id,
        name, mime_type, size, web_view_link, checksum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         drive_folder_id=VALUES(drive_folder_id),
         name=VALUES(name),
         mime_type=VALUES(mime_type),
         size=VALUES(size),
         web_view_link=VALUES(web_view_link),
         checksum=VALUES(checksum)`,
      [
        submission.entity_id,
        submission.department_id || null,
        uploaded.id,
        parentId,
        uploaded.name || file.originalname,
        uploaded.mimeType || file.mimetype,
        Number(uploaded.size || file.size),
        uploaded.webViewLink || null,
        checksum,
      ]
    );

    const [documentResult] = await conn.query(
      `INSERT INTO documents
       (entity_id, department_id, title, document_type, status,
        drive_file_id, drive_folder_id, created_by)
       VALUES (?, ?, ?, 'form_attachment', 'draft', ?, ?, ?)`,
      [
        submission.entity_id,
        submission.department_id || null,
        uploaded.name || file.originalname,
        uploaded.id,
        parentId,
        user?.sub || null,
      ]
    );

    const [versionResult] = await conn.query(
      `INSERT INTO document_versions
       (document_id, version_no, drive_file_id, drive_file_mime,
        size, checksum, notes, created_by)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      [
        documentResult.insertId,
        uploaded.id,
        uploaded.mimeType || file.mimetype,
        Number(uploaded.size || file.size),
        checksum,
        'Form submission attachment',
        user?.sub || null,
      ]
    );

    await conn.query(
      'UPDATE documents SET current_version_id=? WHERE id=?',
      [versionResult.insertId, documentResult.insertId]
    );

    const [attachmentResult] = await conn.query(
      `INSERT INTO form_submission_attachments
       (submission_id, field_id, field_key, document_id,
        drive_file_id, drive_folder_id, web_view_link, name,
        mime_type, size, checksum, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        submission.id,
        field.id,
        field.field_key,
        documentResult.insertId,
        uploaded.id,
        parentId,
        uploaded.webViewLink || null,
        uploaded.name || file.originalname,
        uploaded.mimeType || file.mimetype,
        Number(uploaded.size || file.size),
        checksum,
        user?.sub || null,
      ]
    );

    await conn.query(
      `INSERT INTO form_submission_values
       (submission_id, field_id, field_key, value_document_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value_text=NULL,
         value_number=NULL,
         value_date=NULL,
         value_json=NULL,
         value_user_id=NULL,
         value_document_id=VALUES(value_document_id)`,
      [
        submission.id,
        field.id,
        field.field_key,
        documentResult.insertId,
      ]
    );

    await conn.commit();

    return {
      attachmentId: attachmentResult.insertId,
      documentId: documentResult.insertId,
      driveFileId: uploaded.id,
      driveFolderId: parentId,
      webViewLink: uploaded.webViewLink || null,
      name: uploaded.name || file.originalname,
      mimeType: uploaded.mimeType || file.mimetype,
      size: Number(uploaded.size || file.size),
      checksum,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }

    await integrationLog.log({
      entityId: submission.entity_id,
      userId: user?.sub || null,
      provider: 'internal',
      operation: 'form_submission.persist_uploaded_file',
      subjectType: 'form_submission',
      subjectId: submission.id,
      status: 'failed',
      errorMessage: error.message,
      responseMeta: {
        driveFileId: uploaded.id,
        orphanedDriveFile: true,
      },
    });

    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { uploadFieldFile };
