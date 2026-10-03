const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const pool = require('../db/pool');
const drive = require('./googleDrive.service');
const fileStore = require('./aiFileStore.service');
const { log: activityLog } = require('./activityLog.service');
const {
  MAX_EXTRACTED_CHARS,
  extractReadableText,
  generateArtifact,
  prepareUpload,
  sanitizeFileName,
  NATIVE_FORMATS,
  FORMAT_MIME,
  fileFamily,
  conversionTargets,
} = require('./aiDocumentArtifact.service');
const claudeTeam = require('./ai/claudeTeamPersonal');
const { loadUserIdentity, resolveEngineForUser } = require('./ai/aiRouting.service');
const { getAccount: getClaudeTeamAccount } = require('./ai/claudeTeamAccounts.service');

// A PDF whose text layer is shorter than this is treated as a scan.
const MIN_PDF_TEXT_CHARS = 50;

const gunzip = promisify(zlib.gunzip);

async function uploadSessionFile({ session, user, file, title, documentType }) {
  if (!file?.buffer) throw serviceError('File wajib diunggah', 400, 'VALIDATION_ERROR');

  const prepared = await prepareUpload({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
  });
  let extraction = await extractReadableText({
    buffer: prepared.storedBuffer,
    storedMimeType: prepared.storedMimeType,
    originalMimeType: prepared.originalMimeType,
    originalName: prepared.originalName,
    compressionMethod: prepared.compressionMethod,
  });
  let readBy = extraction.status === 'ready' ? 'text' : null;

  if (needsVisualRead(prepared.originalMimeType, extraction)) {
    const visual = await readVisually({ user, buffer: file.buffer, mimeType: prepared.originalMimeType });
    if (visual.text) {
      extraction = { status: 'ready', text: visual.text, error: null };
      readBy = 'vision';
    } else if (visual.reason) {
      extraction = { ...extraction, error: [extraction.error, visual.reason].filter(Boolean).join('. ') };
    }
  }

  const persisted = await persistPreparedDocument({
    session,
    user,
    prepared,
    extraction,
    title: normalizedTitle(title || stripExtension(prepared.originalName)),
    documentType: normalizeDocumentType(documentType || 'ai_upload'),
    messageId: null,
    relation: 'attachment',
    eventType: 'document_uploaded',
    readBy,
  });
  return { ...persisted, readBy };
}

function needsVisualRead(mimeType, extraction) {
  if (!claudeTeam.canReadVisually(mimeType)) return false;
  if (extraction.status !== 'ready') return true;
  return mimeType === 'application/pdf' && String(extraction.text || '').trim().length < MIN_PDF_TEXT_CHARS;
}

// Images and scanned PDFs are transcribed once with Claude vision so every later message
// (and every provider) can use the text. Failure never blocks the upload itself.
async function readVisually({ user, buffer, mimeType }) {
  const identity = await loadUserIdentity(user.sub);
  const resolved = await resolveEngineForUser(identity);
  if (resolved.provider !== 'claude_team' || !resolved.claudeTeamAccountId) {
    return { text: null, reason: 'Pembacaan gambar/scan membutuhkan akses Claude Team' };
  }
  const account = await getClaudeTeamAccount(resolved.claudeTeamAccountId);
  if (!account?.enabled) {
    return { text: null, reason: 'Pembacaan gambar/scan membutuhkan akses Claude Team' };
  }
  if (account.mode === 'gateway') {
    return { text: null, reason: 'Pembacaan visual belum tersedia lewat gateway' };
  }
  try {
    const result = await claudeTeam.transcribeVisual({ buffer, mimeType, model: account.model });
    const text = String(result.content || '').trim();
    if (!text) return { text: null, reason: 'Pembacaan visual tidak menghasilkan teks' };
    return {
      text: `[Dibaca dengan AI vision dari gambar/scan]\n\n${text}`.slice(0, MAX_EXTRACTED_CHARS),
      reason: null,
    };
  } catch (error) {
    return {
      text: null,
      reason: error.code === 'VISION_TOO_LARGE'
        ? 'File terlalu besar untuk pembacaan visual'
        : 'Pembacaan visual gagal',
    };
  }
}

async function generateFromMessage({ session, user, messageId, format, title, documentType }) {
  const [messages] = await pool.query(
    `SELECT id, role, content
       FROM ai_messages
      WHERE id=? AND session_id=? AND deleted_at IS NULL
      LIMIT 1`,
    [messageId, session.id]
  );
  const message = messages[0];
  if (!message || message.role !== 'assistant') {
    throw serviceError('Pesan assistant tidak ditemukan pada session ini', 404, 'NOT_FOUND');
  }

  const artifact = await generateArtifact({
    format,
    title: title || session.title || `Dokumen AI ${message.id}`,
    content: message.content,
  });
  // A native Google file is imported from its Office twin, uncompressed.
  const prepared = artifact.nativeMime
    ? uncompressedPrepared(artifact)
    : await prepareUpload({ buffer: artifact.buffer, fileName: artifact.fileName, mimeType: artifact.mimeType });

  return persistPreparedDocument({
    session,
    user,
    prepared,
    nativeMime: artifact.nativeMime || null,
    extraction: {
      status: 'ready',
      text: String(message.content || '').slice(0, 100000),
      error: null,
    },
    title: normalizedTitle(title || session.title || `Dokumen AI ${message.id}`),
    documentType: normalizeDocumentType(documentType || `ai_${artifact.format}`),
    messageId: message.id,
    relation: 'generated',
    eventType: 'document_generated',
  });
}

// A prepared record for a buffer stored as it is (Office or PDF): the shape
// prepareUpload returns, without the gzip step.
function uncompressedPrepared({ buffer, fileName, mimeType }) {
  return {
    originalName: sanitizeFileName(fileName),
    originalMimeType: String(mimeType || 'application/octet-stream').toLowerCase(),
    originalSize: buffer.length,
    storedName: sanitizeFileName(fileName),
    storedMimeType: String(mimeType || 'application/octet-stream').toLowerCase(),
    storedSize: buffer.length,
    storedBuffer: buffer,
    compressionMethod: 'native',
  };
}

// "Konversi" of a document of this conversation (uploaded or generated) into
// another format, through Google's converter (owner, 3 Oct 2026). The result
// is a new document in the same Shared Drive folder, linked to the
// conversation; the source is never changed. Text targets come from what was
// read out of the file. Anything else needs the Drive store: the local
// development store cannot convert and says so.
async function convertSessionDocument({ session, user, documentId, format }) {
  const target = String(format || '').toLowerCase();
  const [rows] = await pool.query(
    `SELECT d.id, d.title, d.drive_file_id AS driveFileId, d.document_type AS documentType,
            f.mime_type AS storedMime, c.original_mime_type AS originalMimeType, c.original_name AS originalName,
            c.compression_method AS compressionMethod, c.extraction_status AS extractionStatus, c.extracted_text AS extractedText
       FROM documents d
       JOIN ai_context_links l ON l.context_type='document' AND l.context_id=d.id AND l.session_id=?
       LEFT JOIN drive_files_metadata f ON f.drive_file_id=d.drive_file_id
       LEFT JOIN document_ai_content c ON c.document_id=d.id
      WHERE d.id=? AND d.entity_id=? AND d.deleted_at IS NULL
      LIMIT 1`,
    [session.id, documentId, session.entity_id]
  );
  const source = rows[0];
  if (!source?.driveFileId) throw serviceError('Dokumen tidak ditemukan', 404, 'NOT_FOUND');
  // A native Google file keeps its own mime in drive_files_metadata; an upload keeps the original's.
  const sourceMime = String(source.storedMime || '').startsWith('application/vnd.google-apps.') ? source.storedMime : (source.originalMimeType || source.storedMime);
  const extracted = source.extractionStatus === 'ready' && String(source.extractedText || '').trim().length > 0;
  const targets = conversionTargets(sourceMime, { extracted });
  if (!targets.includes(target)) {
    throw serviceError(`Dokumen ini tidak bisa diubah menjadi ${target.toUpperCase()}. Pilihan: ${targets.length ? targets.join(', ') : 'tidak ada'}.`, 400, 'VALIDATION_ERROR');
  }
  const baseTitle = stripExtension(source.originalName || source.title || `dokumen-${source.id}`);
  const ctx = { entityId: session.entity_id, userId: user.sub, subjectType: 'ai_document_convert', subjectId: source.id };
  const persist = (prepared, extra = {}) => persistPreparedDocument({
    session,
    user,
    prepared,
    extraction: { status: extracted ? 'ready' : 'no_text', text: extracted ? String(source.extractedText).slice(0, 100000) : null, error: null },
    title: normalizedTitle(`${baseTitle} (${NATIVE_FORMATS[target]?.label || target.toUpperCase()})`),
    documentType: normalizeDocumentType(source.documentType || `ai_${target}`),
    messageId: null,
    relation: 'converted',
    eventType: 'document_converted',
    ...extra,
  });

  // Text: from what was read, no Google call.
  if (target === 'txt' || target === 'md') {
    const artifact = await generateArtifact({ format: target, title: baseTitle, content: source.extractedText });
    const prepared = await prepareUpload({ buffer: artifact.buffer, fileName: artifact.fileName, mimeType: artifact.mimeType });
    return { ...(await persist(prepared)), sourceDocumentId: source.id, format: target };
  }
  if (fileStore.storeForUpload().kind !== 'drive') {
    throw serviceError('Konversi ke format ini memakai Google Drive. Di penyimpanan lokal (pengembangan) hanya TXT dan Markdown yang tersedia.', 409, 'GOOGLE_DRIVE_REQUIRED');
  }
  const { family } = fileFamily(sourceMime);
  // A native Google file: Google exports it.
  if (family === 'native') {
    const buffer = await drive.exportFile(source.driveFileId, FORMAT_MIME[target], ctx);
    const prepared = uncompressedPrepared({ buffer, fileName: `${baseTitle}.${target}`, mimeType: FORMAT_MIME[target] });
    return { ...(await persist(prepared)), sourceDocumentId: source.id, format: target };
  }
  // An Office or text file: imported as its Google twin (the result itself,
  // or a temporary one that Google then exports and that is deleted again).
  const downloaded = await downloadSessionDocument({ session, documentId: source.id, user });
  if (NATIVE_FORMATS[target]) {
    const prepared = uncompressedPrepared({ buffer: downloaded.buffer, fileName: downloaded.fileName, mimeType: downloaded.mimeType });
    return { ...(await persist(prepared, { nativeMime: NATIVE_FORMATS[target].mimeType })), sourceDocumentId: source.id, format: target };
  }
  const parentId = await resolveArtifactFolder({ entityId: session.entity_id, departmentId: session.department_id, documentType: source.documentType || 'ai_convert', userId: user.sub });
  const temp = await drive.importAsNative({ name: `~konversi ${baseTitle}`, buffer: downloaded.buffer, sourceMime: downloaded.mimeType, parentId }, ctx);
  try {
    const buffer = await drive.exportFile(temp.id, FORMAT_MIME[target], ctx);
    const prepared = uncompressedPrepared({ buffer, fileName: `${baseTitle}.${target}`, mimeType: FORMAT_MIME[target] });
    return { ...(await persist(prepared)), sourceDocumentId: source.id, format: target };
  } finally {
    await drive.deleteFile(temp.id, ctx).catch(() => {});
  }
}

async function persistPreparedDocument({
  session,
  user,
  prepared,
  extraction,
  title,
  documentType,
  messageId,
  relation,
  eventType,
  readBy = null,
  // A native Google file (Doc, Sheet, Slides): the buffer is imported through
  // Google's converter instead of stored as it is. Only the Drive store can;
  // the local development store keeps the Office file.
  nativeMime = null,
}) {
  const store = fileStore.storeForUpload();
  const importNative = Boolean(nativeMime) && store.kind === 'drive';
  const parentId = store.kind === 'local'
    ? await store.resolveFolder()
    : await resolveArtifactFolder({
      entityId: session.entity_id,
      departmentId: session.department_id,
      documentType,
      userId: user.sub,
    });

  let uploaded = null;
  try {
    const uploadCtx = { entityId: session.entity_id, userId: user.sub, subjectType: 'ai_session', subjectId: session.id };
    uploaded = importNative
      ? await drive.importAsNative({
        name: stripExtension(prepared.storedName),
        buffer: prepared.storedBuffer,
        sourceMime: prepared.storedMimeType,
        targetMime: nativeMime,
        parentId,
      }, uploadCtx)
      : await store.upload({
        name: prepared.storedName,
        mimeType: prepared.storedMimeType,
        buffer: prepared.storedBuffer,
        parentId,
      }, uploadCtx);

    const checksum = crypto.createHash('sha256').update(prepared.storedBuffer).digest('hex');
    const conn = await pool.getConnection();
    let documentId;
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO drive_files_metadata
         (entity_id, department_id, drive_file_id, drive_folder_id,
          name, mime_type, size, web_view_link, owner_email, checksum)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          name=VALUES(name), mime_type=VALUES(mime_type), size=VALUES(size),
          web_view_link=VALUES(web_view_link), checksum=VALUES(checksum)`,
        [
          session.entity_id,
          session.department_id || null,
          uploaded.id,
          parentId,
          uploaded.name || prepared.storedName,
          uploaded.mimeType || prepared.storedMimeType,
          Number(uploaded.size || prepared.storedSize),
          uploaded.webViewLink || null,
          uploaded.owners?.[0]?.emailAddress || null,
          checksum,
        ]
      );

      const [documentResult] = await conn.query(
        `INSERT INTO documents
         (entity_id, department_id, title, document_type, status,
          drive_file_id, drive_folder_id, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [
          session.entity_id,
          session.department_id || null,
          title,
          documentType,
          uploaded.id,
          parentId,
          user.sub,
        ]
      );
      documentId = documentResult.insertId;

      const [versionResult] = await conn.query(
        `INSERT INTO document_versions
         (document_id, version_no, drive_file_id, drive_file_mime,
          size, checksum, notes, created_by)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          uploaded.id,
          prepared.storedMimeType,
          prepared.storedSize,
          checksum,
          `Prakasa AI · compression=${prepared.compressionMethod}`,
          user.sub,
        ]
      );
      await conn.query('UPDATE documents SET current_version_id=? WHERE id=?', [versionResult.insertId, documentId]);

      await conn.query(
        `INSERT INTO document_ai_content
         (document_id, source_session_id, source_message_id,
          original_name, original_mime_type, original_size,
          stored_name, stored_mime_type, stored_size, compression_method,
          extraction_status, extracted_text, extraction_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          session.id,
          messageId || null,
          prepared.originalName,
          prepared.originalMimeType,
          prepared.originalSize,
          prepared.storedName,
          prepared.storedMimeType,
          prepared.storedSize,
          prepared.compressionMethod,
          extraction.status,
          extraction.text || null,
          extraction.error || null,
        ]
      );

      await conn.query(
        `INSERT IGNORE INTO ai_context_links
         (session_id, entity_id, context_type, context_id, relation, added_by)
         VALUES (?, ?, 'document', ?, ?, ?)`,
        [session.id, session.entity_id, documentId, relation, user.sub]
      );

      await conn.query(
        `INSERT INTO ai_usage_events
         (session_id, message_id, entity_id, department_id, user_id,
          module, event_type, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'ai_command_center', ?, ?)`,
        [
          session.id,
          messageId || null,
          session.entity_id,
          session.department_id || null,
          user.sub,
          eventType,
          JSON.stringify({
            documentId,
            originalSize: prepared.originalSize,
            storedSize: prepared.storedSize,
            compressionMethod: prepared.compressionMethod,
            extractionStatus: extraction.status,
            readBy,
          }),
        ]
      );

      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch { /* noop */ }
      throw error;
    } finally {
      conn.release();
    }

    try {
      await activityLog({
        entityId: session.entity_id,
        userId: user.sub,
        action: `ai_document.${eventType}`,
        subjectType: 'document',
        subjectId: documentId,
        metadata: {
          sessionId: session.id,
          messageId: messageId || null,
          compressionMethod: prepared.compressionMethod,
        },
      });
    } catch {
      // Artifact is committed; audit side effect is best effort.
    }

    return {
      documentId,
      title,
      originalName: prepared.originalName,
      mimeType: prepared.originalMimeType,
      originalSize: prepared.originalSize,
      storedSize: prepared.storedSize,
      compressionMethod: prepared.compressionMethod,
      extractionStatus: extraction.status,
      webViewLink: uploaded.webViewLink || null,
      downloadUrl: `/ai-command/sessions/${session.id}/artifacts/${documentId}/download`,
      native: importNative,
      nativeMime: importNative ? nativeMime : null,
    };
  } catch (error) {
    if (uploaded?.id) {
      try {
        await fileStore.storeForFile(uploaded.id).remove(uploaded.id, {
          entityId: session.entity_id,
          userId: user.sub,
          subjectType: 'ai_session_rollback',
          subjectId: session.id,
        });
      } catch {
        // Keep original failure; integration logs retain cleanup failure.
      }
    }
    throw error;
  }
}

async function downloadSessionDocument({ session, documentId, user }) {
  const [rows] = await pool.query(
    `SELECT d.id, d.drive_file_id AS driveFileId, d.title,
            f.name AS storedFallbackName, f.mime_type AS storedFallbackMime,
            c.original_name AS originalName,
            c.original_mime_type AS originalMimeType,
            c.compression_method AS compressionMethod
       FROM documents d
       JOIN ai_context_links l
         ON l.context_type='document' AND l.context_id=d.id AND l.session_id=?
       LEFT JOIN drive_files_metadata f ON f.drive_file_id=d.drive_file_id
       LEFT JOIN document_ai_content c ON c.document_id=d.id
      WHERE d.id=? AND d.entity_id=? AND d.deleted_at IS NULL
      LIMIT 1`,
    [session.id, documentId, session.entity_id]
  );
  const document = rows[0];
  if (!document?.driveFileId) throw serviceError('Dokumen tidak ditemukan', 404, 'NOT_FOUND');

  const downloaded = await fileStore.storeForFile(document.driveFileId).download(document.driveFileId, {
    entityId: session.entity_id,
    userId: user.sub,
    subjectType: 'ai_document_download',
    subjectId: document.id,
  });

  let buffer = downloaded.buffer;
  let mimeType = document.originalMimeType || downloaded.mimeType || 'application/octet-stream';
  let fileName = document.originalName || document.storedFallbackName || document.title || `document-${document.id}`;
  if (document.compressionMethod === 'gzip') {
    buffer = await gunzip(buffer);
  } else if (String(downloaded.mimeType).startsWith('application/pdf') && mimeType.startsWith('application/vnd.google-apps.')) {
    mimeType = 'application/pdf';
    if (!/\.pdf$/i.test(fileName)) fileName = `${fileName}.pdf`;
  }

  return { buffer, mimeType, fileName: sanitizeFileName(fileName) };
}

async function getSessionDocumentMetadata({ session, documentId }) {
  const [rows] = await pool.query(
    `SELECT d.id, d.title, d.document_type AS documentType, d.status,
            f.web_view_link AS webViewLink, f.mime_type AS storedMimeType,
            c.original_name AS originalName,
            c.original_mime_type AS originalMimeType,
            c.original_size AS originalSize,
            c.stored_size AS storedSize,
            c.compression_method AS compressionMethod,
            c.extraction_status AS extractionStatus,
            c.extraction_error AS extractionError,
            (c.extraction_status='ready' AND c.extracted_text IS NOT NULL AND c.extracted_text<>'') AS hasText,
            d.created_at AS createdAt
       FROM documents d
       JOIN ai_context_links l
         ON l.context_type='document' AND l.context_id=d.id AND l.session_id=?
       LEFT JOIN drive_files_metadata f ON f.drive_file_id=d.drive_file_id
       LEFT JOIN document_ai_content c ON c.document_id=d.id
      WHERE d.id=? AND d.entity_id=? AND d.deleted_at IS NULL
      LIMIT 1`,
    [session.id, documentId, session.entity_id]
  );
  if (!rows[0]) throw serviceError('Dokumen tidak ditemukan', 404, 'NOT_FOUND');
  const { hasText, ...row } = rows[0];
  // What this document can be converted into (the "Konversi ke…" menu), by
  // the same rule convertSessionDocument applies.
  const sourceMime = String(row.storedMimeType || '').startsWith('application/vnd.google-apps.') ? row.storedMimeType : (row.originalMimeType || row.storedMimeType);
  const conversions = conversionTargets(sourceMime, { extracted: Boolean(Number(hasText)) })
    .filter((format) => fileStore.storeForUpload().kind === 'drive' || format === 'txt' || format === 'md');
  return { ...row, sourceMimeType: sourceMime || null, conversions };
}

async function resolveArtifactFolder({ entityId, departmentId, documentType, userId }) {
  const [rows] = await pool.query(
    `SELECT drive_folder_id AS driveFolderId
       FROM folder_mapping_rules
      WHERE entity_id=?
        AND deleted_at IS NULL
        AND is_active=1
        AND document_type IN (?, '*')
        AND (department_id=? OR department_id IS NULL)
      ORDER BY (document_type=?) DESC,
               (department_id=?) DESC,
               priority ASC, id ASC
      LIMIT 1`,
    [entityId, documentType, departmentId || null, documentType, departmentId || null]
  );
  if (rows[0]?.driveFolderId) return rows[0].driveFolderId;

  const sharedDriveId = String(process.env.GOOGLE_SHARED_DRIVE_ID || '').trim();
  if (!sharedDriveId) {
    throw serviceError(
      'Google Shared Drive belum dikonfigurasi. Isi GOOGLE_SHARED_DRIVE_ID atau folder mapping.',
      503,
      'GOOGLE_DRIVE_NOT_CONFIGURED'
    );
  }

  const root = await drive.ensureFolder({
    name: 'Prakasa AI',
    parentId: sharedDriveId,
    sharedDriveId,
  }, { entityId, userId, subjectType: 'ai_document_folder' });
  const entityFolder = await drive.ensureFolder({
    name: `Entity-${entityId}`,
    parentId: root.id,
    sharedDriveId,
  }, { entityId, userId, subjectType: 'ai_document_folder' });
  const scopeFolder = await drive.ensureFolder({
    name: departmentId ? `Department-${departmentId}` : 'General',
    parentId: entityFolder.id,
    sharedDriveId,
  }, { entityId, userId, subjectType: 'ai_document_folder' });
  return scopeFolder.id;
}

function normalizeDocumentType(value) {
  const normalized = String(value || 'ai_document').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
  return normalized || 'ai_document';
}

function normalizedTitle(value) {
  return String(value || 'Dokumen AI').replace(/\s+/g, ' ').trim().slice(0, 255) || 'Dokumen AI';
}

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '');
}

function serviceError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = {
  convertSessionDocument,
  downloadSessionDocument,
  generateFromMessage,
  getSessionDocumentMetadata,
  normalizeDocumentType,
  persistPreparedDocument,
  resolveArtifactFolder,
  uploadSessionFile,
};
