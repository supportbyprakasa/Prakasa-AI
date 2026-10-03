// Pure helpers for the Docs / Sheets / Slides pages (GoogleFiles + GoogleEditor).
import { formatDate } from '../../components/format.js';

export const KINDS = Object.freeze({
  document: Object.freeze({
    title: 'Docs', route: '/docs', editorPath: 'document', createLabel: 'Buat dokumen', noun: 'dokumen', recordLabel: 'Dokumen',
    description: 'Dokumen Google Anda dan yang dibagikan ke Anda.',
    sharedHint: 'Dokumen yang dibagikan orang lain ke Anda akan muncul di sini.',
    listLink: 'Lihat daftar dokumen',
  }),
  spreadsheet: Object.freeze({
    title: 'Sheets', route: '/sheets', editorPath: 'spreadsheets', createLabel: 'Buat spreadsheet', noun: 'spreadsheet', recordLabel: 'Spreadsheet',
    description: 'Spreadsheet Google Anda dan yang dibagikan ke Anda.',
    sharedHint: 'Spreadsheet yang dibagikan orang lain ke Anda akan muncul di sini.',
    listLink: 'Lihat daftar spreadsheet',
  }),
  presentation: Object.freeze({
    title: 'Slides', route: '/slides', editorPath: 'presentation', createLabel: 'Buat presentasi', noun: 'presentasi', recordLabel: 'Presentasi',
    description: 'Presentasi Google Anda dan yang dibagikan ke Anda.',
    sharedHint: 'Presentasi yang dibagikan orang lain ke Anda akan muncul di sini.',
    listLink: 'Lihat daftar presentasi',
  }),
});

export const SCOPES = Object.freeze([
  Object.freeze({ id: 'recent', label: 'Terbaru' }),
  Object.freeze({ id: 'mine', label: 'Milik saya' }),
  Object.freeze({ id: 'shared', label: 'Dibagikan ke saya' }),
]);

// Grid / list layout of the file list (a view switch, remembered per browser).
export const VIEWS = Object.freeze([
  Object.freeze({ value: 'grid', label: 'Kisi', icon: 'grid_view' }),
  Object.freeze({ value: 'list', label: 'Daftar', icon: 'view_list' }),
]);
export const VIEW_STORAGE_KEY = 'prakasa.googleFiles.view';

export function isView(value) {
  return VIEWS.some((view) => view.value === value);
}

export const SEARCH_MAX_LENGTH = 100;
export const LOAD_TIMEOUT_MS = 12000;

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export function kindConfig(kind) {
  return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : KINDS.document;
}

export function isValidFileId(id) {
  return typeof id === 'string' && FILE_ID_PATTERN.test(id);
}

export function isScope(id) {
  return SCOPES.some((scope) => scope.id === id);
}

// In-app editor route for a file (e.g. /sheets/<id>); null for a bad id.
export function editorRoute(kind, fileId) {
  if (!isValidFileId(fileId)) return null;
  return `${kindConfig(kind).route}/${fileId}`;
}

// URL of Google's editor inside the iframe — built only from a strictly
// validated id, never from a URL the server or the user supplied. The full
// editor, with Google's own menus and toolbar (owner, 3 Oct 2026: never the
// minimal mode that hides them).
export function editorFrameUrl(kind, fileId) {
  if (!isValidFileId(fileId) || !Object.prototype.hasOwnProperty.call(KINDS, kind)) return null;
  return `https://docs.google.com/${KINDS[kind].editorPath}/d/${fileId}/edit`;
}

// "Buka di Google" target: the file's own webViewLink when it is a Google
// link, otherwise the full editor URL built from the id.
export function openInGoogleUrl(kind, fileId, webViewLink) {
  try {
    const url = new URL(webViewLink);
    if (url.protocol === 'https:' && ['docs.google.com', 'drive.google.com'].includes(url.hostname)) return url.toString();
  } catch { /* fall through */ }
  if (!isValidFileId(fileId) || !Object.prototype.hasOwnProperty.call(KINDS, kind)) return null;
  return `https://docs.google.com/${KINDS[kind].editorPath}/d/${fileId}/edit`;
}

export function normalizeSearch(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
}

// Append the next page without duplicates (Drive may repeat an item when a
// file changes between two page requests).
export function mergeFiles(current, incoming) {
  const seen = new Set((current || []).map((file) => file.id));
  return [...(current || []), ...(incoming || []).filter((file) => file && !seen.has(file.id) && seen.add(file.id))];
}

export function ownerLabel(file) {
  if (!file) return '';
  if (file.ownedByMe) return 'Saya';
  if (file.inSharedDrive) return 'Drive bersama';
  return file.ownerName || '';
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Indonesian relative time, Google-home style: "Baru saja", "5 menit lalu",
// "3 jam lalu", "Kemarin", "4 hari lalu", then the date ("12 Mei 2026").
export function relativeTime(iso, now = new Date()) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = now.getTime() - date.getTime();
  if (diff < 60 * 1000) return 'Baru saja';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} menit lalu`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return `${Math.floor(diff / 3600000)} jam lalu`;
  if (days === 1) return 'Kemarin';
  if (days < 7) return `${days} hari lalu`;
  return formatDate(date);
}

// Mid-sentence the relative time starts in lower case ("Diubah kemarin"),
// dates keep their month capital ("Diubah 12 Mei 2026").
const inSentence = (text) => (/^[A-Z][a-z]/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text);

// What the list shows as the date: last opened for "Terbaru", else last modified.
export function fileDateLabel(file, scope, now = new Date()) {
  if (scope === 'recent' && file?.viewedByMeTime) return `Dibuka ${inSentence(relativeTime(file.viewedByMeTime, now))}`;
  return `Diubah ${inSentence(relativeTime(file?.modifiedTime, now))}`;
}

// The date column of the list layout: its header, and the cell (the relative
// time; on "Terbaru" a file never opened says it was changed instead).
export function fileDateColumn(scope) {
  return scope === 'recent' ? 'Terakhir dibuka' : 'Terakhir diubah';
}

export function fileDateCell(file, scope, now = new Date()) {
  if (scope === 'recent') return file?.viewedByMeTime ? relativeTime(file.viewedByMeTime, now) : fileDateLabel(file, scope, now);
  return relativeTime(file?.modifiedTime, now);
}

// Iframe heuristic: a cross-origin frame can't be inspected, so the only
// honest signal is whether it ever fired `load`. Show the sign-in hint only
// when it has NOT loaded by the timeout — never after it loaded.
export function frameHint({ loaded, timedOut }) {
  if (loaded) return null;
  return timedOut ? 'not-loaded' : 'loading';
}

export function emptyCopy(kind, scope, search) {
  const noun = kindConfig(kind).noun;
  if (search) return { title: `Tidak ada ${noun} yang cocok`, description: `Tidak ditemukan ${noun} dengan nama "${search}".` };
  if (scope === 'mine') return { title: `Belum ada ${noun} milik Anda`, description: `Buat ${noun} baru untuk memulai.` };
  if (scope === 'shared') return { title: `Belum ada ${noun} yang dibagikan`, description: kindConfig(kind).sharedHint };
  return { title: `Belum ada ${noun}`, description: `Buat ${noun} baru untuk memulai.` };
}

export function apiErrorMessage(error, fallback) {
  return error?.response?.data?.error?.message || fallback;
}
