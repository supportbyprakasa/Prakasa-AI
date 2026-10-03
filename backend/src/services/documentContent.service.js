const zlib = require('zlib');
const { promisify } = require('util');
const pool = require('../db/pool');
const documentRead = require('./documentRead.service');
const fileStore = require('./aiFileStore.service');
const { extractReadableText } = require('./aiDocumentArtifact.service');

// The readable text of one document for Prakasa AI (tools/documents.js
// baca_dokumen, Wave 1 "dokumen dan file", owner 3 Oct 2026).
//
//   - Visibility is the documents rule (documentRead.documentById): a record
//     the user cannot open on the Dokumen page is not readable here either.
//   - The text the app already read out of the file (an upload or an AI
//     artifact: document_ai_content) is served as it is, with no Google call.
//   - A document that only links a Drive file (made on the Dokumen page, or
//     from a template) is fetched once from Drive with the app's own access,
//     read with the same extractor as an upload, and the text is kept in
//     document_ai_content so the next question costs no Google call. A Google
//     Doc/Sheet/Slides arrives as Google's PDF export.
//   - Nothing else is written: the file, the record and its versions stay.

const gunzip = promisify(zlib.gunzip);
const MAX_CACHED_CHARS = 100000;

const serviceError = (message, status, code) => Object.assign(new Error(message), { status, code });

function statusOf(doc) {
  return doc.extractionStatus || (doc.driveFileId ? 'pending' : 'no_file');
}

async function fetchAndCache(user, doc) {
  const ctx = { entityId: user.entityId, userId: user.sub, subjectType: 'ai_document_read', subjectId: doc.id };
  const downloaded = await fileStore.storeForFile(doc.driveFileId).download(doc.driveFileId, ctx);
  let buffer = downloaded.buffer;
  if (doc.compressionMethod === 'gzip') buffer = await gunzip(buffer);
  const native = String(doc.mimeType || '').startsWith('application/vnd.google-apps.');
  const originalName = doc.originalName || doc.fileName || doc.title || `dokumen-${doc.id}`;
  const extraction = await extractReadableText({
    buffer,
    storedMimeType: downloaded.mimeType,
    // A native Google file was exported (PDF): read it as what arrived.
    originalMimeType: native ? downloaded.mimeType : (doc.originalMimeType || doc.mimeType || downloaded.mimeType),
    originalName: native ? `${originalName}.pdf` : originalName,
    compressionMethod: 'none',
  });
  const text = extraction.text ? String(extraction.text).slice(0, MAX_CACHED_CHARS) : null;
  await pool.query(
    `INSERT INTO document_ai_content
       (document_id, original_name, original_mime_type, original_size,
        stored_name, stored_mime_type, stored_size, compression_method,
        extraction_status, extracted_text, extraction_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       extraction_status = VALUES(extraction_status),
       extracted_text = VALUES(extracted_text),
       extraction_error = VALUES(extraction_error)`,
    [
      doc.id,
      String(originalName).slice(0, 255),
      String(doc.mimeType || downloaded.mimeType || 'application/octet-stream').slice(0, 150),
      Number(doc.fileSize) || buffer.length,
      String(doc.fileName || originalName).slice(0, 255),
      String(downloaded.mimeType || doc.mimeType || 'application/octet-stream').slice(0, 150),
      buffer.length,
      extraction.status,
      text,
      extraction.error || null,
    ]
  );
  return { status: extraction.status, text: text || '', error: extraction.error || null, source: 'drive' };
}

/**
 * { document, status, text, error, source } for a document the user may see;
 * null when there is none. source: 'cache' (text the app already held) or
 * 'drive' (fetched now). status follows document_ai_content.extraction_status,
 * plus 'no_file' for a record without a file.
 */
async function readDocumentText(user, documentId) {
  const document = await documentRead.documentById(user, documentId);
  if (!document) return null;
  const status = statusOf(document);
  const cached = status === 'ready' && String(document.extractedText || '').trim().length > 0;
  if (cached) return { document, status, text: String(document.extractedText), error: null, source: 'cache' };
  if (status === 'no_file') return { document, status, text: '', error: 'Catatan dokumen ini tidak punya file.', source: 'cache' };
  // Read before, nothing usable in it: say so instead of fetching again.
  if (['no_text', 'unsupported', 'failed'].includes(status)) {
    return { document, status, text: '', error: document.extractionError || null, source: 'cache' };
  }
  try {
    const fetched = await fetchAndCache(user, document);
    return { document, ...fetched };
  } catch (error) {
    if (error.status === 404) return { document, status: 'failed', text: '', error: 'File tidak ditemukan di Google Drive.', source: 'drive' };
    throw serviceError(`File tidak dapat dibaca dari Google Drive: ${String(error.message || error).slice(0, 200)}`, error.status || 502, error.code || 'DRIVE_READ_FAILED');
  }
}

module.exports = { readDocumentText, MAX_CACHED_CHARS };
