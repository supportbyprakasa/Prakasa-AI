// Prakasa AI Wave 1 "dokumen dan file" (owner, 3 Oct 2026): PPTX and native
// Google artifacts, the conversion matrix, converting a document of a
// conversation, reading a document's text for the agent, and the
// baca_dokumen tool. No database and no Google: everything they touch is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

const B = '../src';
const artifact = require(`${B}/services/aiDocumentArtifact.service`);
const storage = require(`${B}/services/aiDocumentStorage.service`);
const fileStore = require(`${B}/services/aiFileStore.service`);
const drive = require(`${B}/services/googleDrive.service`);
const documentRead = require(`${B}/services/documentRead.service`);
const documentContent = require(`${B}/services/documentContent.service`);
const pool = require(`${B}/db/pool`);
const agentTools = require(`${B}/services/ai/agent/agentTools`);
const { assertClean, assertToolOutput } = require(`${B}/services/ai/agent/outputGuard`);
const { capResult } = require(`${B}/services/ai/agent/toolContract`);

const GDOC = 'application/vnd.google-apps.document';
const GSHEET = 'application/vnd.google-apps.spreadsheet';
const GSLIDES = 'application/vnd.google-apps.presentation';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const noGoogle = (t) => {
  for (const method of Object.keys(drive).filter((k) => typeof drive[k] === 'function')) {
    t.mock.method(drive, method, async () => { throw new Error(`Google must not be called (${method})`); });
  }
};

// ------------------------------------------------------------ artifacts

test('a PPTX artifact is a real presentation: one slide per block of lines, a table slide for a Markdown table', async () => {
  const content = [
    '# Ringkasan penjualan', '', 'Poin satu', 'Poin dua', '',
    '| Wilayah | Qty |', '|---|---|', '| Jakarta | 10 |', '| Bandung | 4 |', '',
    ...Array.from({ length: 20 }, (_, i) => `Baris ${i + 1}`),
  ].join('\n');
  const slides = artifact.slidesFromMarkdown('Judul', content);
  assert.ok(slides.length >= 4, `slides: ${slides.length}`);
  assert.ok(slides.some((slide) => slide.table), 'a table slide');
  for (const slide of slides.filter((s) => s.lines)) assert.ok(slide.lines.length <= 9, 'at most nine lines a slide');

  const out = await artifact.generateArtifact({ format: 'pptx', title: 'Ringkasan penjualan', content });
  assert.equal(out.mimeType, PPTX);
  assert.match(out.fileName, /\.pptx$/);
  const zip = await JSZip.loadAsync(out.buffer);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideFiles.length, slides.length + 1, 'cover slide + content slides');
  const cover = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(cover, /Ringkasan penjualan/);
  assert.match(cover, /Prakasa AI/);
});

test('a Google Doc/Sheet/Slides artifact is its Office twin marked for import', async () => {
  const doc = await artifact.generateArtifact({ format: 'gdoc', title: 'Memo', content: 'Isi memo' });
  assert.equal(doc.format, 'gdoc');
  assert.equal(doc.mimeType, DOCX);
  assert.equal(doc.nativeMime, GDOC);
  assert.equal(doc.nativeLabel, 'Google Doc');
  const sheet = await artifact.generateArtifact({ format: 'gsheet', title: 'Tabel', content: '| a | b |\n|---|---|\n| 1 | 2 |' });
  assert.equal(sheet.mimeType, XLSX);
  assert.equal(sheet.nativeMime, GSHEET);
  const slides = await artifact.generateArtifact({ format: 'gslides', title: 'Deck', content: 'Satu\nDua' });
  assert.equal(slides.mimeType, PPTX);
  assert.equal(slides.nativeMime, GSLIDES);
  assert.deepEqual(artifact.ARTIFACT_FORMATS.slice().sort(), ['csv', 'docx', 'gdoc', 'gsheet', 'gslides', 'md', 'pdf', 'pptx', 'txt', 'xlsx']);
});

test('the conversion matrix: native ↔ Office through Google, PDF from anything editable, text only from what was read', () => {
  assert.deepEqual(artifact.fileFamily(GDOC), { family: 'native', kind: 'doc' });
  assert.deepEqual(artifact.fileFamily(XLSX), { family: 'office', kind: 'sheet' });
  assert.equal(artifact.fileFamily('text/csv').kind, 'sheet');
  assert.deepEqual(artifact.fileFamily('text/plain'), { family: 'text', kind: 'doc' });
  assert.equal(artifact.fileFamily('application/pdf').family, 'pdf');
  assert.equal(artifact.fileFamily('image/png').family, 'image');
  assert.equal(artifact.fileFamily('application/zip').family, 'other');

  assert.deepEqual(artifact.conversionTargets(GDOC, { extracted: true }), ['pdf', 'docx', 'txt', 'md']);
  assert.deepEqual(artifact.conversionTargets(GSLIDES), ['pdf', 'pptx']);
  assert.deepEqual(artifact.conversionTargets(DOCX, { extracted: true }), ['gdoc', 'pdf', 'docx', 'txt', 'md']);
  assert.deepEqual(artifact.conversionTargets(XLSX), ['gsheet', 'pdf', 'xlsx']);
  assert.deepEqual(artifact.conversionTargets('text/csv', { extracted: true }), ['gsheet', 'pdf', 'xlsx', 'txt', 'md']);
  assert.deepEqual(artifact.conversionTargets('application/pdf', { extracted: true }), ['txt', 'md']);
  assert.deepEqual(artifact.conversionTargets('application/pdf'), []);
  assert.deepEqual(artifact.conversionTargets('image/png', { extracted: true }), ['txt', 'md']);
  assert.deepEqual(artifact.conversionTargets('application/zip', { extracted: true }), []);
  assert.deepEqual(artifact.conversionTargets(null), []);
});

// ------------------------------------------------------------ conversion of a conversation's document

const session = { id: 9, entity_id: 1, department_id: 3 };
const user = { sub: 5, entityId: 1, permissions: ['ai_command.use', 'document.create', 'document.view'] };
const sourceRow = (extra = {}) => ({
  id: 41, title: 'Kontrak A', driveFileId: 'local:11111111-1111-4111-8111-111111111111', documentType: 'kontrak',
  storedMime: DOCX, originalMimeType: DOCX, originalName: 'kontrak-a.docx', compressionMethod: 'none',
  extractionStatus: 'ready', extractedText: 'Pasal 1. Garansi berlaku 12 bulan.', ...extra,
});

function fakeConnection(calls) {
  let nextId = 100;
  return {
    beginTransaction: async () => {},
    commit: async () => { calls.push('commit'); },
    rollback: async () => { calls.push('rollback'); },
    release: () => {},
    query: async (sql) => {
      calls.push(String(sql).trim().split(/\s+/).slice(0, 3).join(' '));
      return [{ insertId: nextId++ }, []];
    },
  };
}

test('convertSessionDocument: a format the source cannot become is refused, and only TXT/MD work without the Drive store', async (t) => {
  noGoogle(t);
  t.mock.method(pool, 'query', async () => [[sourceRow()]]);
  t.mock.method(fileStore, 'storeForUpload', () => ({ kind: 'local' }));
  await assert.rejects(storage.convertSessionDocument({ session, user, documentId: 41, format: 'gsheet' }), (e) => e.status === 400 && /GSHEET/.test(e.message) && /gdoc, pdf, docx, txt, md/.test(e.message));
  await assert.rejects(storage.convertSessionDocument({ session, user, documentId: 41, format: 'pdf' }), (e) => e.status === 409 && e.code === 'GOOGLE_DRIVE_REQUIRED');
  // Not linked to this conversation → not found.
  t.mock.method(pool, 'query', async () => [[]]);
  await assert.rejects(storage.convertSessionDocument({ session, user, documentId: 41, format: 'txt' }), (e) => e.status === 404);
});

test('convertSessionDocument to TXT writes a new document linked as "converted", from the text already read, with no Google call', async (t) => {
  noGoogle(t);
  const calls = [];
  const uploads = [];
  t.mock.method(pool, 'query', async () => [[sourceRow()]]);
  t.mock.method(pool, 'getConnection', async () => fakeConnection(calls));
  t.mock.method(fileStore, 'storeForUpload', () => ({
    kind: 'local',
    resolveFolder: async () => 'local:ai-dev',
    upload: async (file) => { uploads.push(file); return { id: 'local:22222222-2222-4222-8222-222222222222', name: file.name, mimeType: file.mimeType, size: file.buffer.length, webViewLink: null }; },
  }));
  const out = await storage.convertSessionDocument({ session, user, documentId: 41, format: 'txt' });
  assert.equal(out.format, 'txt');
  assert.equal(out.sourceDocumentId, 41);
  assert.equal(out.title, 'kontrak-a (TXT)');
  assert.equal(out.mimeType, 'text/plain');
  assert.equal(out.extractionStatus, 'ready');
  assert.equal(out.native, false);
  assert.match(out.downloadUrl, /\/ai-command\/sessions\/9\/artifacts\/\d+\/download$/);
  assert.equal(uploads.length, 1);
  assert.ok(calls.includes('commit'));
  assert.ok(calls.some((c) => /INSERT INTO document_ai_content/.test(c)));
  assert.ok(calls.some((c) => /INSERT IGNORE INTO/.test(c)), 'linked to the conversation');
});

test('convertSessionDocument through Google: a native source is exported; an Office source is imported, exported and the temporary file deleted', async (t) => {
  const calls = [];
  const google = [];
  t.mock.method(pool, 'getConnection', async () => fakeConnection(calls));
  t.mock.method(pool, 'query', async (sql) => {
    if (/folder_mapping_rules/.test(String(sql))) return [[{ driveFolderId: 'folder-1' }]];
    return [[sourceRow({ storedMime: GDOC, originalMimeType: null, originalName: null, driveFileId: 'gd-1' })]];
  });
  t.mock.method(fileStore, 'storeForUpload', () => ({
    kind: 'drive',
    upload: async (file) => { google.push(['upload', file.name, file.mimeType]); return { id: 'new-1', name: file.name, mimeType: file.mimeType, size: file.buffer.length, webViewLink: 'https://drive.google.com/file/d/new-1' }; },
  }));
  t.mock.method(drive, 'exportFile', async (id, mime) => { google.push(['export', id, mime]); return Buffer.from('%PDF-1.4 fake'); });
  t.mock.method(drive, 'importAsNative', async ({ name, sourceMime }) => { google.push(['import', name, sourceMime]); return { id: 'tmp-1' }; });
  t.mock.method(drive, 'deleteFile', async (id) => { google.push(['delete', id]); });
  t.mock.method(drive, 'downloadFileBuffer', async () => ({ buffer: Buffer.from('docx bytes'), mimeType: DOCX }));

  const pdf = await storage.convertSessionDocument({ session, user, documentId: 41, format: 'pdf' });
  assert.equal(pdf.title, 'Kontrak A (PDF)');
  assert.equal(pdf.webViewLink, 'https://drive.google.com/file/d/new-1');
  assert.deepEqual(google, [['export', 'gd-1', 'application/pdf'], ['upload', 'Kontrak A.pdf', 'application/pdf']]);

  // Office → PDF: a temporary Google Doc that is exported and removed again.
  google.length = 0;
  t.mock.method(pool, 'query', async (sql) => {
    if (/folder_mapping_rules/.test(String(sql))) return [[{ driveFolderId: 'folder-1' }]];
    return [[sourceRow({ driveFileId: 'docx-1' })]];
  });
  const office = await storage.convertSessionDocument({ session, user, documentId: 41, format: 'pdf' });
  assert.equal(office.title, 'kontrak-a (PDF)');
  assert.deepEqual(google.map((c) => c[0]), ['import', 'export', 'upload', 'delete']);
  assert.equal(google[0][1], '~konversi kontrak-a');
  assert.equal(google[3][1], 'tmp-1');

  // Office → Google Doc: the result itself is the import.
  google.length = 0;
  t.mock.method(drive, 'importAsNative', async ({ name, targetMime }) => { google.push(['import', name, targetMime]); return { id: 'gdoc-new', name, mimeType: targetMime, webViewLink: 'https://docs.google.com/document/d/gdoc-new/edit' }; });
  const gdoc = await storage.convertSessionDocument({ session, user, documentId: 41, format: 'gdoc' });
  assert.equal(gdoc.title, 'kontrak-a (Google Doc)');
  assert.equal(gdoc.native, true);
  assert.equal(gdoc.nativeMime, GDOC);
  assert.deepEqual(google, [['import', 'kontrak-a', GDOC]]);
});

test('artifact metadata names the source mime and the conversions the "Konversi ke…" menu may offer', async (t) => {
  t.mock.method(fileStore, 'storeForUpload', () => ({ kind: 'drive' }));
  t.mock.method(pool, 'query', async () => [[{ id: 41, title: 'Kontrak A', storedMimeType: DOCX, originalMimeType: DOCX, extractionStatus: 'ready', hasText: 1 }]]);
  const meta = await storage.getSessionDocumentMetadata({ session, documentId: 41 });
  assert.equal(meta.sourceMimeType, DOCX);
  assert.deepEqual(meta.conversions, ['gdoc', 'pdf', 'docx', 'txt', 'md']);
  assert.equal('hasText' in meta, false);
  // A native file keeps its own mime even when the record carries an original (an import).
  t.mock.method(pool, 'query', async () => [[{ id: 42, storedMimeType: GSHEET, originalMimeType: XLSX, extractionStatus: 'ready', hasText: 0 }]]);
  assert.deepEqual((await storage.getSessionDocumentMetadata({ session, documentId: 42 })).conversions, ['pdf', 'xlsx']);
  // Local development store: only the text targets.
  t.mock.method(fileStore, 'storeForUpload', () => ({ kind: 'local' }));
  t.mock.method(pool, 'query', async () => [[{ id: 41, storedMimeType: DOCX, originalMimeType: DOCX, extractionStatus: 'ready', hasText: 1 }]]);
  assert.deepEqual((await storage.getSessionDocumentMetadata({ session, documentId: 41 })).conversions, ['txt', 'md']);
});

// ------------------------------------------------------------ reading a document's text for the agent

const reader = { sub: 7, entityId: 1, departmentId: 3, permissions: ['document.view'] };
const visibleDoc = (extra = {}) => ({
  id: 12, title: 'SOP Gudang', documentType: 'sop', status: 'final', departmentName: 'Warehouse', createdByName: 'Head Gudang',
  driveFileId: 'gd-12', webViewLink: 'https://docs.google.com/document/d/gd-12/edit', mimeType: GDOC, fileName: 'SOP Gudang', fileSize: 1200,
  extractionStatus: null, extractedText: null, extractionError: null, originalName: null, originalMimeType: null, compressionMethod: null, ...extra,
});

test('readDocumentText serves the text the app already holds without touching Drive, and says so for files read before that held none', async (t) => {
  noGoogle(t);
  t.mock.method(pool, 'query', async () => { throw new Error('nothing to write'); });
  t.mock.method(documentRead, 'documentById', async () => visibleDoc({ extractionStatus: 'ready', extractedText: 'Langkah 1. Periksa stok.' }));
  const cached = await documentContent.readDocumentText(reader, 12);
  assert.equal(cached.source, 'cache');
  assert.equal(cached.text, 'Langkah 1. Periksa stok.');
  t.mock.method(documentRead, 'documentById', async () => visibleDoc({ extractionStatus: 'no_text', extractionError: 'OCR gambar belum diaktifkan' }));
  const none = await documentContent.readDocumentText(reader, 12);
  assert.equal(none.status, 'no_text');
  assert.equal(none.text, '');
  assert.match(none.error, /OCR/);
  t.mock.method(documentRead, 'documentById', async () => visibleDoc({ driveFileId: null }));
  assert.equal((await documentContent.readDocumentText(reader, 12)).status, 'no_file');
  t.mock.method(documentRead, 'documentById', async () => null);
  assert.equal(await documentContent.readDocumentText(reader, 12), null);
});

test('readDocumentText fetches a linked Drive file once, reads it like an upload and keeps the text', async (t) => {
  const writes = [];
  const downloads = [];
  t.mock.method(pool, 'query', async (sql, args) => { writes.push({ sql: String(sql), args }); return [{ affectedRows: 1 }]; });
  t.mock.method(documentRead, 'documentById', async () => visibleDoc());
  t.mock.method(fileStore, 'storeForFile', () => ({
    download: async (id, ctx) => { downloads.push({ id, ctx }); return { buffer: Buffer.from('Isi SOP: timbang dulu, catat kemudian.'), mimeType: 'text/plain' }; },
  }));
  const read = await documentContent.readDocumentText(reader, 12);
  assert.equal(read.source, 'drive');
  assert.equal(read.status, 'ready');
  assert.match(read.text, /timbang dulu/);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].id, 'gd-12');
  assert.equal(downloads[0].ctx.subjectType, 'ai_document_read');
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO document_ai_content/);
  assert.match(writes[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(writes[0].args[0], 12);
  assert.equal(writes[0].args[7], 'ready');
  // A file that is gone is a readable answer, not a crash.
  t.mock.method(fileStore, 'storeForFile', () => ({ download: async () => { throw Object.assign(new Error('nope'), { status: 404 }); } }));
  const gone = await documentContent.readDocumentText(reader, 12);
  assert.equal(gone.status, 'failed');
  assert.match(gone.error, /tidak ditemukan/);
});

// ------------------------------------------------------------ the tool

const baca = agentTools.byName.get('baca_dokumen');
const runTool = (input) => baca.run(reader, input);
const guard = (out) => { assertClean(out); assertToolOutput(out); return capResult(out); };

test('baca_dokumen: parts of 3.500 characters, a next-part pointer, excerpts around a word, and no forbidden key', async (t) => {
  assert.equal(baca.permission, 'document.view');
  assert.equal(baca.privateOnly, true);
  assert.deepEqual(baca.module, ['documents', 'division-storage']);
  const long = Array.from({ length: 400 }, (_, i) => `Baris ${i + 1} dari dokumen, dengan kata garansi di baris ${i % 50 === 0 ? 'ini' : 'lain'}.`).join('\n');
  t.mock.method(documentContent, 'readDocumentText', async (_user, id) => (id === 12
    ? { document: visibleDoc(), status: 'ready', text: long, error: null, source: 'cache' }
    : null));

  const first = guard(await runTool({ dokumen_id: 12 }));
  assert.equal(first.ditemukan, true);
  assert.equal(first.judul, 'SOP Gudang');
  assert.equal(first.divisi, 'Warehouse');
  assert.equal(first.bagian, 1);
  assert.equal(first.teks.length, 3500);
  assert.equal(first.teks, long.slice(0, 3500), 'not cut by capResult');
  assert.equal(first.jumlah_bagian, Math.ceil(long.length / 3500));
  assert.equal(first.bagian_berikutnya, 2);
  assert.equal(first.status_teks, 'teks terbaca');
  assert.match(first.catatan, /bagian 1/);
  assert.equal(first.terpotong, undefined);

  const last = guard(await runTool({ dokumen_id: 12, bagian: 99 }));
  assert.equal(last.bagian, first.jumlah_bagian, 'beyond the end → the last part');
  assert.equal(last.bagian_berikutnya, null);
  assert.equal(last.teks, long.slice(3500 * (first.jumlah_bagian - 1)));

  const found = guard(await runTool({ dokumen_id: 12, cari: 'baris INI' }));
  assert.equal(found.dicari, 'baris INI');
  assert.ok(found.jumlah_cuplikan > 0 && found.jumlah_cuplikan <= 8);
  for (const hit of found.cuplikan) {
    assert.match(hit.teks, /baris ini/);
    assert.ok(hit.bagian >= 1 && hit.bagian <= first.jumlah_bagian);
  }
  assert.equal(found.teks, undefined);
  const missing = guard(await runTool({ dokumen_id: 12, cari: 'xyzzy' }));
  assert.equal(missing.jumlah_cuplikan, 0);
  assert.match(missing.catatan, /tidak ditemukan/);

  const unseen = guard(await runTool({ dokumen_id: 13 }));
  assert.equal(unseen.ditemukan, false);
  assert.match(unseen.catatan, /boleh Anda buka/);
  assert.equal((await runTool({})).ditemukan, false);
});

test('baca_dokumen on a file without readable text answers with its state and the link, and short text is one part', async (t) => {
  t.mock.method(documentContent, 'readDocumentText', async () => ({ document: visibleDoc(), status: 'no_text', text: '', error: 'OCR gambar belum diaktifkan', source: 'drive' }));
  const out = guard(await runTool({ dokumen_id: 12 }));
  assert.equal(out.ditemukan, true);
  assert.equal(out.teks, '');
  assert.match(out.status_teks, /OCR/);
  assert.match(out.sumber_teks, /Google Drive/);
  assert.match(out.catatan, /tautan/);
  assert.match(out.tautan, /^https:\/\/docs\.google\.com\//);
  t.mock.method(documentContent, 'readDocumentText', async () => ({ document: visibleDoc(), status: 'ready', text: 'Pendek.', error: null, source: 'cache' }));
  const short = guard(await runTool({ dokumen_id: 12, bagian: 3 }));
  assert.equal(short.jumlah_bagian, 1);
  assert.equal(short.bagian, 1);
  assert.equal(short.teks, 'Pendek.');
  assert.equal(short.catatan, undefined);
  // Without the permission: refused.
  await assert.rejects(baca.run({ sub: 1, entityId: 1, permissions: [] }, { dokumen_id: 12 }), (e) => e.status === 403);
});
