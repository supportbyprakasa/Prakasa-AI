export const AI_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.png,.jpg,.jpeg,.webp,.txt,.csv,.md,.markdown,.json,.xml,.rtf';
export const AI_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const AI_MAX_PENDING_FILES = 5;

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Attachments of one message in the side panel ("dari dokumen ke formulir",
// docs/prakasa-ai-rencana.md §9.15). The same file types and size as the
// Command Center; a message carries at most three, and an image larger than
// what Claude vision reads is refused here, with the reason, instead of being
// uploaded and then not read. The server checks all of it again
// (middleware/upload.js, aiMessageAttachments.service.js).

export const AI_MAX_MESSAGE_ATTACHMENTS = 3;
// backend/src/services/ai/claudeTeamPersonal.js MAX_VISION_IMAGE_BYTES.
export const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSIONS = new Set(AI_FILE_ACCEPT.split(',').map((ext) => ext.slice(1)));
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export const extensionOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// 'image' | 'pdf' | 'file' — which icon or thumbnail a chip shows.
export function attachmentKind(file) {
  const ext = extensionOf(file?.name);
  if (IMAGE_EXTENSIONS.has(ext) || /^image\/(png|jpeg|webp)$/.test(file?.type || file?.mimeType || '')) return 'image';
  if (ext === 'pdf' || (file?.type || file?.mimeType) === 'application/pdf') return 'pdf';
  return 'file';
}

// Why a file cannot be attached, or null. { code, name, text } — `text` is the
// sentence shown to the user next to the file name (the name is record data
// and is shown apart, so the sentence can be translated).
export function attachmentProblem(file) {
  const name = String(file?.name || 'file');
  if (!EXTENSIONS.has(extensionOf(name))) {
    return { code: 'type', name, text: 'Jenis file ini tidak bisa dilampirkan. Pakai foto (JPG, PNG, WebP), PDF, atau dokumen Office.' };
  }
  if (!Number(file?.size)) return { code: 'empty', name, text: 'File ini kosong.' };
  if (file.size > AI_MAX_UPLOAD_BYTES) {
    return { code: 'size', name, text: `Ukuran file maksimum ${formatBytes(AI_MAX_UPLOAD_BYTES)}.` };
  }
  if (attachmentKind(file) === 'image' && file.size > AI_MAX_IMAGE_BYTES) {
    return { code: 'image_size', name, text: `Foto lebih dari ${formatBytes(AI_MAX_IMAGE_BYTES)} tidak bisa dibaca AI. Perkecil fotonya atau potong bagian yang penting.` };
  }
  return null;
}

let chipSeq = 0;
const chipOf = (file) => ({
  key: `lampiran-${Date.now()}-${chipSeq += 1}`,
  name: file.name,
  size: file.size,
  mimeType: file.type || '',
  kind: attachmentKind(file),
  status: 'ready', // ready → uploading → uploaded | error
  file,
  documentId: null,
  readable: null,
  error: '',
});

// Adds files to the attachments of the message being written. Returns the new
// list and what was refused — [{ code, name | null, text }]: by type, by size,
// or more than `max` altogether (the same file twice is simply kept once).
// Never throws.
export function addAttachments(current, files, { max = AI_MAX_MESSAGE_ATTACHMENTS } = {}) {
  const next = [...(current || [])];
  const errors = [];
  let overflow = 0;
  for (const file of Array.from(files || [])) {
    const problem = attachmentProblem(file);
    if (problem) { errors.push(problem); continue; }
    if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
    if (next.length >= max) { overflow += 1; continue; }
    next.push(chipOf(file));
  }
  if (overflow) errors.push({ code: 'count', name: null, text: `Paling banyak ${max} lampiran per pesan. ${overflow} file tidak dilampirkan.` });
  return { next, errors };
}

export const removeAttachment = (current, key) => (current || []).filter((item) => item.key !== key);

// One attachment after its upload: the server's answer, or its error.
export function markUploaded(current, key, saved) {
  return (current || []).map((item) => (item.key === key
    ? { ...item, status: 'uploaded', documentId: Number(saved.documentId), readable: saved.extractionStatus === 'ready', error: '' }
    : item));
}

export function markFailed(current, key, message) {
  return (current || []).map((item) => (item.key === key ? { ...item, status: 'error', error: String(message || 'Gagal mengunggah') } : item));
}

// What the message sends, and what the chip under the sent message shows.
export const attachmentIdsOf = (list) => (list || []).filter((item) => Number.isInteger(item.documentId) && item.documentId > 0).map((item) => item.documentId);
export const sentAttachments = (list) => (list || []).filter((item) => item.documentId).map((item) => ({
  documentId: item.documentId, name: item.name, size: item.size, mimeType: item.mimeType, readable: item.readable !== false,
}));

// Screenshots pasted from the clipboard are all called "image.png"; give them a unique name.
export function namePastedFile(file, now = new Date()) {
  if (file.name && file.name !== 'image.png') return file;
  const extension = (String(file.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([file], `tempelan-${stamp}.${extension}`, { type: file.type });
}

// The files of a paste. Text copied from Word or Excel can also carry an image
// rendering: then the text paste is kept and no file is taken.
export function filesFromClipboard(clipboardData) {
  const files = Array.from(clipboardData?.files || []);
  if (!files.length) return [];
  if (clipboardData.getData?.('text/plain')) return [];
  return files.map((file) => namePastedFile(file));
}

// Whether a drag carries files (not text or a link), and the files of a drop.
export const dragCarriesFiles = (dataTransfer) => Array.from(dataTransfer?.types || []).includes('Files');
export const filesFromDrop = (dataTransfer) => (dragCarriesFiles(dataTransfer) ? Array.from(dataTransfer.files || []) : []);

// Opens the browser's file picker (from a click) and resolves with the chosen
// files — an empty list when the picker is closed without one. No element is
// added to the page.
export function pickFiles({ accept = AI_FILE_ACCEPT, multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    let settled = false;
    const done = (files) => { if (!settled) { settled = true; resolve(files); } };
    input.addEventListener('change', () => done(Array.from(input.files || [])));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}
