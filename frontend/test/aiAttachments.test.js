// Attachments of one message in the side panel ("dari dokumen ke formulir",
// docs/prakasa-ai-rencana.md §9.15): the composer's model — what may be
// attached, how many, what a paste or a drop carries, and what the message sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AI_FILE_ACCEPT, AI_MAX_IMAGE_BYTES, AI_MAX_MESSAGE_ATTACHMENTS, AI_MAX_UPLOAD_BYTES,
  addAttachments, attachmentIdsOf, attachmentKind, attachmentProblem, dragCarriesFiles, filesFromClipboard, filesFromDrop,
  markFailed, markUploaded, namePastedFile, removeAttachment, sentAttachments,
} from '../src/components/ai/aiFiles.js';

const src = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8');
const file = (name, size = 2048, type = '') => ({ name, size, type });
const MB = 1024 * 1024;

test('limits: three files per message, 25 MB per file, 5 MB per photo — the same file types as the Command Center', () => {
  assert.equal(AI_MAX_MESSAGE_ATTACHMENTS, 3);
  assert.equal(AI_MAX_UPLOAD_BYTES, 25 * MB);
  assert.equal(AI_MAX_IMAGE_BYTES, 5 * MB);
  // The server's own list (middleware/upload.js ALLOWED_EXTENSION) and vision limit.
  const upload = readFileSync(fileURLToPath(new URL('../../backend/src/middleware/upload.js', import.meta.url)), 'utf8');
  const allowed = upload.match(/ALLOWED_EXTENSION = \/\\\.\(([^)]+)\)\$\/i/)[1].replace('jpe?g', 'jpg|jpeg').split('|').sort();
  assert.deepEqual(AI_FILE_ACCEPT.split(',').map((ext) => ext.slice(1)).sort(), allowed);
  const vision = readFileSync(fileURLToPath(new URL('../../backend/src/services/ai/claudeTeamPersonal.js', import.meta.url)), 'utf8');
  assert.match(vision, /MAX_VISION_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  const service = readFileSync(fileURLToPath(new URL('../../backend/src/services/aiMessageAttachments.service.js', import.meta.url)), 'utf8');
  assert.match(service, /MAX_ATTACHMENTS = 3;/);
});

test('what kind of file it is: a photo gets a thumbnail, a PDF and a document an icon', () => {
  assert.equal(attachmentKind(file('struk.JPG')), 'image');
  assert.equal(attachmentKind(file('tempelan', 10, 'image/png')), 'image');
  assert.equal(attachmentKind(file('surat-jalan.pdf')), 'pdf');
  assert.equal(attachmentKind(file('invoice.xlsx')), 'file');
  assert.equal(attachmentKind({ name: 'struk.png', mimeType: 'image/png' }), 'image');
});

test('a file is refused with a clear reason: type, empty, too large, a photo too large to read', () => {
  assert.equal(attachmentProblem(file('struk.jpg')), null);
  assert.equal(attachmentProblem(file('surat-jalan.pdf', 24 * MB)), null);
  assert.equal(attachmentProblem(file('struk.png', AI_MAX_IMAGE_BYTES)), null, 'exactly at the limit');
  assert.deepEqual(attachmentProblem(file('struk.heic')), {
    code: 'type', name: 'struk.heic', text: 'Jenis file ini tidak bisa dilampirkan. Pakai foto (JPG, PNG, WebP), PDF, atau dokumen Office.',
  });
  for (const name of ['virus.exe', 'halaman.html', 'tanpa-ekstensi', 'gambar.gif', 'arsip.zip']) assert.equal(attachmentProblem(file(name)).code, 'type', name);
  assert.deepEqual(attachmentProblem(file('kosong.pdf', 0)), { code: 'empty', name: 'kosong.pdf', text: 'File ini kosong.' });
  assert.deepEqual(attachmentProblem(file('scan.pdf', 25 * MB + 1)), { code: 'size', name: 'scan.pdf', text: 'Ukuran file maksimum 25.0 MB.' });
  assert.deepEqual(attachmentProblem(file('foto.jpg', 5 * MB + 1)), {
    code: 'image_size', name: 'foto.jpg', text: 'Foto lebih dari 5.0 MB tidak bisa dibaca AI. Perkecil fotonya atau potong bagian yang penting.',
  });
});

test('adding files: at most three per message, the refused ones are named, the same file is kept once', () => {
  let state = addAttachments([], [file('struk.jpg'), file('virus.exe'), file('surat-jalan.pdf')]);
  assert.deepEqual(state.next.map((item) => [item.name, item.kind, item.status, item.documentId]), [['struk.jpg', 'image', 'ready', null], ['surat-jalan.pdf', 'pdf', 'ready', null]]);
  assert.deepEqual(state.errors.map((error) => [error.code, error.name]), [['type', 'virus.exe']]);
  assert.equal(new Set(state.next.map((item) => item.key)).size, 2, 'each chip has its own key');

  // The same file again changes nothing; two more: one fits, one does not.
  state = addAttachments(state.next, [file('struk.jpg'), file('kartu-nama.png'), file('invoice.pdf')]);
  assert.deepEqual(state.next.map((item) => item.name), ['struk.jpg', 'surat-jalan.pdf', 'kartu-nama.png']);
  assert.deepEqual(state.errors, [{ code: 'count', name: null, text: 'Paling banyak 3 lampiran per pesan. 1 file tidak dilampirkan.' }]);

  // Full: every further file is counted and none is added.
  state = addAttachments(state.next, [file('a.pdf'), file('b.pdf')]);
  assert.equal(state.next.length, 3);
  assert.equal(state.errors[0].text, 'Paling banyak 3 lampiran per pesan. 2 file tidak dilampirkan.');

  // Removing one makes room again; the input list is never changed in place.
  const before = state.next;
  const fewer = removeAttachment(before, before[0].key);
  assert.equal(before.length, 3);
  assert.deepEqual(fewer.map((item) => item.name), ['surat-jalan.pdf', 'kartu-nama.png']);
  assert.equal(addAttachments(fewer, [file('a.pdf')]).next.length, 3);
  assert.deepEqual(addAttachments(null, null), { next: [], errors: [] });
});

test('after the upload: the message names the stored files; a failed one keeps its reason and is not sent', () => {
  const { next } = addAttachments([], [file('struk.jpg', 4096, 'image/jpeg'), file('buram.png', 1024, 'image/png'), file('invoice.pdf', 9000, 'application/pdf')]);
  let list = markUploaded(next, next[0].key, { documentId: 71, extractionStatus: 'ready', readBy: 'vision' });
  list = markUploaded(list, next[1].key, { documentId: '72', extractionStatus: 'failed' });
  list = markFailed(list, next[2].key, 'Google Shared Drive belum dikonfigurasi. Isi GOOGLE_SHARED_DRIVE_ID atau folder mapping.');
  assert.deepEqual(list.map((item) => [item.status, item.documentId, item.readable]), [['uploaded', 71, true], ['uploaded', 72, false], ['error', null, null]]);
  assert.equal(list[2].error, 'Google Shared Drive belum dikonfigurasi. Isi GOOGLE_SHARED_DRIVE_ID atau folder mapping.', 'the server\'s own message is shown');
  assert.deepEqual(attachmentIdsOf(list), [71, 72]);
  assert.deepEqual(sentAttachments(list), [
    { documentId: 71, name: 'struk.jpg', size: 4096, mimeType: 'image/jpeg', readable: true },
    { documentId: 72, name: 'buram.png', size: 1024, mimeType: 'image/png', readable: false },
  ]);
  assert.deepEqual(attachmentIdsOf([]), []);
  assert.deepEqual(attachmentIdsOf(undefined), []);
});

test('paste: an image from the clipboard becomes a named file; a paste that carries text stays a text paste', () => {
  const shot = new File(['x'], 'image.png', { type: 'image/png' });
  const named = namePastedFile(shot, new Date('2026-10-02T03:04:05.678Z'));
  assert.equal(named.name, 'tempelan-2026-10-02T03-04-05.png');
  assert.equal(named.type, 'image/png');
  const photo = new File(['x'], 'struk.jpg', { type: 'image/jpeg' });
  assert.equal(namePastedFile(photo), photo, 'a file with a real name keeps it');
  assert.equal(namePastedFile(new File(['x'], 'image.png', { type: 'image/jpeg' }), new Date('2026-10-02T00:00:00Z')).name, 'tempelan-2026-10-02T00-00-00.jpg');

  const clipboard = (files, text = '') => ({ files, getData: (kind) => (kind === 'text/plain' ? text : '') });
  assert.deepEqual(filesFromClipboard(clipboard([])), []);
  assert.deepEqual(filesFromClipboard(null), []);
  assert.deepEqual(filesFromClipboard(clipboard([shot], 'teks dari Excel')), [], 'copied cells also carry a picture: the text wins');
  const pasted = filesFromClipboard(clipboard([shot, photo]));
  assert.equal(pasted.length, 2);
  assert.match(pasted[0].name, /^tempelan-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
  assert.equal(pasted[1], photo);
});

test('drag and drop: only a drag that carries files counts', () => {
  const photo = file('struk.jpg');
  assert.equal(dragCarriesFiles({ types: ['Files'] }), true);
  assert.equal(dragCarriesFiles({ types: ['text/plain', 'text/uri-list'] }), false);
  assert.equal(dragCarriesFiles(null), false);
  assert.deepEqual(filesFromDrop({ types: ['Files'], files: [photo] }), [photo]);
  assert.deepEqual(filesFromDrop({ types: ['text/plain'], files: [photo] }), []);
  assert.deepEqual(filesFromDrop({ types: ['Files'] }), []);
});

test('the panel wires the model: attach, drop and paste add chips; the message is sent with the stored ids', () => {
  const conversation = src('components/ai/AIConversation.jsx');
  // In the side panel a file never goes to the Command Center's document panel.
  assert.match(conversation, /useFileDrop\(\(files\) => \(panel \? addPanelFiles\(files\) : uploadFiles\(files\)\), canDropFiles\)/);
  assert.match(conversation, /onFiles=\{canCreateDocument && !archived \? \(panel \? addPanelFiles : uploadFiles\) : undefined\}/);
  assert.match(conversation, /if \(panel\) addPanelFiles\(event\.target\.files\);/);
  assert.match(conversation, /onSubmit=\{\(\) => \(panel && pendingFiles\.length \? submitWithFiles\(\) : send\(\)\)\}/);
  // The same upload endpoint as the Command Center; then the ids ride on the message.
  assert.match(conversation, /api\.post\(`\/ai-command\/sessions\/\$\{targetSessionId\}\/files`, form\)/);
  assert.match(conversation, /send\(undefined, \{ attachments: list \}\)/);
  assert.match(conversation, /attachmentIds,\n\s+\}\);/);
  // A private conversation only — said before anything is uploaded.
  assert.match(conversation, /session\.visibility !== 'private' \|\| session\.webResearch/);
  const stream = src('api/aiStream.js');
  assert.match(stream, /\.\.\.\(attachmentIds\?\.length \? \{ attachmentIds \} : \{\}\)/);
  // Paste and drop go through the pure helpers.
  assert.match(src('components/ai/AIComposer.jsx'), /const files = filesFromClipboard\(event\.clipboardData\);/);
  assert.match(src('components/ai/useFileDrop.js'), /const files = filesFromDrop\(event\.dataTransfer\);/);
  // A file name is record data: never translated.
  assert.match(src('components/ai/AIAttachmentChips.jsx'), /<span data-no-translate="" className="ai-attachment-text">\{item\.name\}<\/span>/);
});

test('a starter that works from a file asks for the file first, and sends nothing by itself', () => {
  const panel = src('components/ai/PrakasaAIToolPanel.jsx');
  assert.match(panel, /attachStarters\.has\(text\) \? pickFileForStarter\(text\) : startWithStarter\(text\)/);
  assert.match(panel, /handleSessionCreated\(response\.data\.data\.id, files\.length \? tr\(text\) : `\$\{tr\(text\)\}: `, \{ autoSend: false, files \}\)/);
  assert.match(panel, /const files = canAttach \? await pickFiles\(\) : \[\];/);
  assert.match(src('components/ai/aiFiles.js'), /input\.addEventListener\('cancel', \(\) => done\(\[\]\)\)/);
  assert.match(panel, /visibility: 'private'/);
});
