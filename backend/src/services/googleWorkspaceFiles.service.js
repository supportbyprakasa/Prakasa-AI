const { google } = require('googleapis');
const { userAuth } = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');

// Google Docs / Sheets / Slides home inside Prakasa Workspace. Every call
// impersonates the signed-in Workspace user (domain-wide delegation), so Drive
// itself limits results to files that user can already open. Needs the
// https://www.googleapis.com/auth/drive scope on the service account's
// Client ID in Admin Console (the same grant My Drive already uses).
const SCOPES = ['https://www.googleapis.com/auth/drive'];

// kind → the mime types Google opens in that editor. The client only ever
// sends `kind`; raw mime types never come from the browser.
const KIND_MIMES = Object.freeze({
  document: Object.freeze([
    'application/vnd.google-apps.document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ]),
  spreadsheet: Object.freeze([
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]),
  presentation: Object.freeze([
    'application/vnd.google-apps.presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
  ]),
});
const NATIVE_MIME = Object.freeze({
  document: KIND_MIMES.document[0],
  spreadsheet: KIND_MIMES.spreadsheet[0],
  presentation: KIND_MIMES.presentation[0],
});
const OFFICE_LABEL = Object.freeze({
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/vnd.ms-powerpoint': 'PPT',
});
const DEFAULT_NAME = Object.freeze({
  document: 'Dokumen tanpa judul',
  spreadsheet: 'Spreadsheet tanpa judul',
  presentation: 'Presentasi tanpa judul',
});

const SCOPE_FILTERS = Object.freeze({
  recent: { clause: null, orderBy: 'viewedByMeTime desc,modifiedTime desc', allDrives: true },
  mine: { clause: "'me' in owners", orderBy: 'modifiedTime desc', allDrives: false },
  shared: { clause: "sharedWithMe = true and not 'me' in owners", orderBy: 'sharedWithMeTime desc,modifiedTime desc', allDrives: false },
});

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
// Drive page tokens are opaque, URL-safe-ish strings; anything else is rejected.
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_\-.~!=+/:]{1,2048}$/;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 30;
const MAX_SEARCH_LENGTH = 100;
const MAX_NAME_LENGTH = 200;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const FILE_FIELDS = 'id,name,mimeType,iconLink,hasThumbnail,modifiedTime,viewedByMeTime,webViewLink,ownedByMe,driveId,'
  + 'owners(displayName,emailAddress,me),lastModifyingUser(displayName,me),capabilities(canEdit,canRename,canTrash)';

const isKind = (kind) => typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND_MIMES, kind);
const isScope = (scope) => typeof scope === 'string' && Object.prototype.hasOwnProperty.call(SCOPE_FILTERS, scope);
const isValidFileId = (id) => typeof id === 'string' && FILE_ID_PATTERN.test(id);
const isValidPageToken = (token) => typeof token === 'string' && PAGE_TOKEN_PATTERN.test(token);

function kindOfMime(mimeType) {
  return Object.keys(KIND_MIMES).find((kind) => KIND_MIMES[kind].includes(mimeType)) || null;
}

// Drive's q language: string literals are single-quoted; backslash and single
// quote must be backslash-escaped. Control characters are dropped outright.
function escapeDriveQuery(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function normalizeSearch(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_SEARCH_LENGTH);
}

// A file name the user typed: trimmed, no control characters, capped length.
function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function clampPageSize(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

function buildListQuery({ kind, scope = 'recent', search = '' }) {
  if (!isKind(kind)) throw new Error(`Unknown kind: ${kind}`);
  const filter = SCOPE_FILTERS[isScope(scope) ? scope : 'recent'];
  const mimes = KIND_MIMES[kind].map((mime) => `mimeType = '${mime}'`).join(' or ');
  const parts = [`(${mimes})`, 'trashed = false'];
  if (filter.clause) parts.push(filter.clause);
  const text = normalizeSearch(search);
  if (text) parts.push(`name contains '${escapeDriveQuery(text)}'`);
  return parts.join(' and ');
}

// Shape sent to the browser — never the raw thumbnailLink (it needs the
// user's Google credentials; the browser goes through our proxy instead).
function toClientFile(file) {
  const owner = (file.owners || [])[0] || null;
  const capabilities = file.capabilities || {};
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    kind: kindOfMime(file.mimeType),
    officeType: OFFICE_LABEL[file.mimeType] || null,
    iconLink: file.iconLink || null,
    hasThumbnail: Boolean(file.hasThumbnail),
    modifiedTime: file.modifiedTime || null,
    viewedByMeTime: file.viewedByMeTime || null,
    webViewLink: file.webViewLink || null,
    ownedByMe: Boolean(file.ownedByMe),
    inSharedDrive: Boolean(file.driveId),
    ownerName: owner ? (owner.me ? 'saya' : owner.displayName || owner.emailAddress || null) : null,
    canRename: Boolean(capabilities.canRename),
    canTrash: Boolean(capabilities.canTrash),
    canEdit: Boolean(capabilities.canEdit),
  };
}

function driveClient(subject) {
  return google.drive({ version: 'v3', auth: userAuth(subject, SCOPES) });
}

const logCtx = (ctx) => ({ entityId: ctx.entityId || null, userId: ctx.userId || null, provider: 'google_docs' });

async function listFiles(subject, { kind, scope = 'recent', search = '', pageToken = null, pageSize } = {}, ctx = {}) {
  const q = buildListQuery({ kind, scope, search });
  const filter = SCOPE_FILTERS[isScope(scope) ? scope : 'recent'];
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'listFiles',
    requestMeta: { subject, kind, scope, hasSearch: Boolean(search), paged: Boolean(pageToken) },
    responseMeta: (result) => ({ count: result?.files?.length || 0, more: Boolean(result?.nextPageToken) }),
  }, async () => {
    const response = await driveClient(subject).files.list({
      q,
      orderBy: filter.orderBy,
      pageSize: clampPageSize(pageSize),
      pageToken: pageToken || undefined,
      fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
      ...(filter.allDrives ? { corpora: 'allDrives', includeItemsFromAllDrives: true } : {}),
      supportsAllDrives: true,
    });
    return {
      files: (response.data.files || []).map(toClientFile),
      nextPageToken: response.data.nextPageToken || null,
      incompleteSearch: Boolean(response.data.incompleteSearch),
    };
  });
}

async function getFile(subject, fileId, ctx = {}) {
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'getFile',
    requestMeta: { subject, fileId },
    responseMeta: (result) => ({ id: result?.id, kind: result?.kind }),
  }, async () => {
    const response = await driveClient(subject).files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
    return toClientFile(response.data);
  });
}

async function createFile(subject, { kind, name }, ctx = {}) {
  if (!isKind(kind)) throw new Error(`Unknown kind: ${kind}`);
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'createFile',
    requestMeta: { subject, kind },
    responseMeta: (result) => ({ id: result?.id }),
  }, async () => {
    const response = await driveClient(subject).files.create({
      requestBody: { name, mimeType: NATIVE_MIME[kind], parents: ['root'] },
      fields: FILE_FIELDS,
    });
    return toClientFile(response.data);
  });
}

async function renameFile(subject, fileId, name, ctx = {}) {
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'renameFile',
    requestMeta: { subject, fileId },
    responseMeta: (result) => ({ id: result?.id }),
  }, async () => {
    const response = await driveClient(subject).files.update({
      fileId, requestBody: { name }, fields: FILE_FIELDS, supportsAllDrives: true,
    });
    return toClientFile(response.data);
  });
}

async function trashFile(subject, fileId, ctx = {}) {
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'trashFile',
    requestMeta: { subject, fileId },
    responseMeta: () => ({ trashed: true }),
  }, async () => {
    // Trash, not delete: the user can restore it from their Drive trash.
    await driveClient(subject).files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    return { id: fileId, trashed: true };
  });
}

// thumbnailLink is short-lived and only served to someone signed in as a user
// who can see the file — so it is fetched here with the user's own token.
const THUMBNAIL_HOST = /(^|\.)googleusercontent\.com$|(^|\.)google\.com$/i;

function isAllowedThumbnailUrl(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && THUMBNAIL_HOST.test(url.hostname);
  } catch { return false; }
}

async function fetchThumbnail(subject, fileId, ctx = {}) {
  return integrationLog.wrap({
    ...logCtx(ctx),
    operation: 'fetchThumbnail',
    requestMeta: { subject, fileId },
    responseMeta: (result) => ({ found: Boolean(result), bytes: result?.buffer?.length || 0 }),
  }, async () => {
    const auth = userAuth(subject, SCOPES);
    const drive = google.drive({ version: 'v3', auth });
    const meta = await drive.files.get({ fileId, fields: 'id,mimeType,thumbnailLink', supportsAllDrives: true });
    if (!kindOfMime(meta.data.mimeType)) return null;
    const link = meta.data.thumbnailLink;
    if (!link || !isAllowedThumbnailUrl(link)) return null;
    const sized = link.replace(/=s\d+$/, '=s400');
    const { token } = await auth.getAccessToken();
    const response = await fetch(sized, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !/^image\/(png|jpeg|gif|webp)\b/i.test(contentType)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_THUMBNAIL_BYTES) return null;
    return { contentType: contentType.split(';')[0], buffer };
  });
}

module.exports = {
  KIND_MIMES,
  NATIVE_MIME,
  DEFAULT_NAME,
  MAX_PAGE_SIZE,
  MAX_NAME_LENGTH,
  isKind,
  isScope,
  isValidFileId,
  isValidPageToken,
  kindOfMime,
  escapeDriveQuery,
  normalizeSearch,
  normalizeName,
  clampPageSize,
  buildListQuery,
  toClientFile,
  isAllowedThumbnailUrl,
  listFiles,
  getFile,
  createFile,
  renameFile,
  trashFile,
  fetchThumbnail,
};
