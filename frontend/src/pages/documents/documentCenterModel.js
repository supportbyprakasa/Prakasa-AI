// Pure helpers for embedding a Drive file's Google editor/preview in an iframe.

// Google Docs/Sheets/Slides can open and edit both their own native format and
// the equivalent Office format (.docx/.xlsx/.pptx) the same way, with no
// conversion needed — the editor is picked purely from the file's mime type.
function googleEditorBase(mimeType) {
  const type = String(mimeType || '');
  if (type === 'application/vnd.google-apps.document' || /wordprocessingml|msword/.test(type)) return 'document';
  if (type === 'application/vnd.google-apps.spreadsheet' || /spreadsheetml|ms-excel/.test(type)) return 'spreadsheets';
  if (type === 'application/vnd.google-apps.presentation' || /presentationml|ms-powerpoint/.test(type)) return 'presentation';
  return null;
}

// Groups a Drive file by format for a Docs/Sheets/Slides-first browsing view —
// same mime-type families googleEditorBase recognizes, named to match the
// 'kind' values the division-storage "create new file" endpoint accepts.
export function classifyFileKind(mimeType) {
  const base = googleEditorBase(mimeType);
  if (base === 'document') return 'document';
  if (base === 'spreadsheets') return 'spreadsheet';
  if (base === 'presentation') return 'presentation';
  return 'other';
}

export function getGoogleEditUrl(driveFileId, mimeType) {
  const base = googleEditorBase(mimeType);
  if (!base || !driveFileId) return null;
  return `https://docs.google.com/${base}/d/${driveFileId}/edit?usp=drivesdk`;
}

// Read-only fallback for file types Google can't edit inline (PDF, images, etc.).
export function getGooglePreviewUrl(webViewLink) {
  try {
    const url = new URL(webViewLink);
    const isGoogleDocument = ['docs.google.com', 'drive.google.com'].includes(url.hostname);
    if (!isGoogleDocument || !url.pathname.includes('/d/')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    const documentIdIndex = parts.indexOf('d') + 1;
    if (!documentIdIndex || !parts[documentIdIndex]) return null;

    const prefix = parts.slice(0, documentIdIndex + 1).join('/');
    return `${url.origin}/${prefix}/preview`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Drive browser
// Shared by the Drive browser pages (Penyimpanan divisi, My Drive): the file
// kinds that can be created, and a folder's files split into groups.

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const isFolder = (file) => file?.mimeType === FOLDER_MIME;

// `kind` is the value the "create new file" endpoints accept.
export const FILE_KINDS = [
  { kind: 'document', label: 'Dokumen', icon: 'description', creatable: true },
  { kind: 'spreadsheet', label: 'Spreadsheet', icon: 'table_chart', creatable: true },
  { kind: 'presentation', label: 'Slide', icon: 'slideshow', creatable: true },
  { kind: 'other', label: 'Lainnya', icon: 'draft', creatable: false },
];

export function fileKindIcon(file) {
  if (isFolder(file)) return 'folder';
  return FILE_KINDS.find((entry) => entry.kind === classifyFileKind(file?.mimeType))?.icon || 'draft';
}

// Groups in display order, empty ones left out. With `folders`, folders get a
// group of their own at the top (My Drive opens them); otherwise they count
// as "Lainnya" like any other file Google cannot edit inline.
export function groupDriveFiles(files, { folders = false } = {}) {
  const byKind = { folder: [], document: [], spreadsheet: [], presentation: [], other: [] };
  for (const file of files || []) {
    if (folders && isFolder(file)) byKind.folder.push(file);
    else byKind[classifyFileKind(file?.mimeType)].push(file);
  }
  return [{ kind: 'folder', label: 'Folder', icon: 'folder' }, ...FILE_KINDS]
    .map((entry) => ({ ...entry, files: byKind[entry.kind] }))
    .filter((group) => group.files.length > 0);
}
