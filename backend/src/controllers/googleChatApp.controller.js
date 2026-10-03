const path = require('path');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { handleGoogleError } = require('../services/googleUserClient');
const chatUser = require('../services/googleChatUser.service');

// Google Chat inside Prakasa Workspace. The subject is ALWAYS the signed-in
// user's own email — the client never chooses whose Chat is read or written.
// Every resource name is rebuilt here from strictly validated path segments.
const SERVICE = { service: 'Google Chat' };
const DRIVE_SERVICE = { service: 'Google Drive' };
const ctx = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9_.-]{1,256}$/;

class Invalid extends Error {}
const invalid = (message) => { throw new Invalid(message); };

function handle(error, res, next, service = SERVICE) {
  if (error instanceof Invalid) return fail(res, 'VALIDATION_ERROR', error.message, 400);
  if (error?.appCode) return fail(res, error.appCode, error.message, error.appStatus || 403);
  return handleGoogleError(error, res, next, service);
}

// Wraps a handler so validation errors, our own refusals and Google errors
// all end up as the right JSON answer (never a raw Google 401).
const route = (fn, service = SERVICE) => async (req, res, next) => {
  try { return await fn(req, res); } catch (error) { return handle(error, res, next, service); }
};

function spaceNameOf(req) {
  const { spaceId } = req.params;
  if (!chatUser.isSpaceId(spaceId)) invalid('ID ruang Chat tidak valid');
  return `spaces/${spaceId}`;
}

function messageNameOf(req) {
  const spaceName = spaceNameOf(req);
  if (!MESSAGE_ID_RE.test(req.params.messageId || '')) invalid('ID pesan tidak valid');
  return `${spaceName}/messages/${req.params.messageId}`;
}

function pageTokenOf(req) {
  const pageToken = chatUser.parsePageToken(req.query.pageToken);
  if (pageToken === null) invalid('pageToken tidak valid');
  return pageToken;
}

function textOf(value, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid('Pesan tidak boleh kosong');
    return '';
  }
  if (typeof value !== 'string') invalid('Pesan tidak valid');
  if (required && !value.trim()) invalid('Pesan tidak boleh kosong');
  if (value.length > chatUser.MAX_TEXT_LENGTH) invalid(`Pesan maksimal ${chatUser.MAX_TEXT_LENGTH} karakter`);
  return value;
}

function threadOf(value, spaceName) {
  if (value === undefined || value === null || value === '') return undefined;
  // A reply may only target a thread inside the same space.
  if (!chatUser.isThreadName(value) || !value.startsWith(`${spaceName}/threads/`)) invalid('Utas tidak valid');
  return value;
}

function quotedOf(value, spaceName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'object'
    || !chatUser.isMessageName(value.name) || !value.name.startsWith(`${spaceName}/messages/`)
    || !chatUser.isTimestamp(value.lastUpdateTime)) invalid('Kutipan tidak valid');
  return { name: value.name, lastUpdateTime: value.lastUpdateTime };
}

function emailsOf(value, { min = 1, max = chatUser.MAX_MEMBERS_PER_REQUEST } = {}) {
  if (!Array.isArray(value)) invalid('Daftar orang tidak valid');
  const emails = [...new Set(value.map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : '')))];
  if (emails.length < min) invalid('Pilih minimal satu orang');
  if (emails.length > max) invalid(`Maksimal ${max} orang sekaligus`);
  if (!emails.every(chatUser.isAllowedEmail)) invalid('Hanya akun Google Workspace perusahaan yang dapat ditambahkan');
  return emails;
}

function nameOf(value, { required }) {
  if (value === undefined) { if (required) invalid('Nama ruang wajib diisi'); return undefined; }
  if (typeof value !== 'string' || !value.trim()) invalid('Nama ruang wajib diisi');
  if (value.trim().length > chatUser.MAX_DISPLAY_NAME) invalid(`Nama ruang maksimal ${chatUser.MAX_DISPLAY_NAME} karakter`);
  return value.trim();
}

function guidelinesOf(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid('Pedoman tidak valid');
  if (value.length > chatUser.MAX_GUIDELINES) invalid(`Pedoman maksimal ${chatUser.MAX_GUIDELINES} karakter`);
  return value.trim();
}

function descriptionOf(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid('Deskripsi tidak valid');
  if (value.length > chatUser.MAX_DESCRIPTION) invalid(`Deskripsi maksimal ${chatUser.MAX_DESCRIPTION} karakter`);
  return value.trim();
}

const activity = (req, action, metadata) => log({
  entityId: req.user.entityId, userId: req.user.sub,
  action: `google_chat.${action}`, subjectType: 'google_chat_space', metadata,
});

// ------------------------------------------------------------------ spaces

const listSpaces = route(async (req, res) => {
  const pageToken = pageTokenOf(req);
  const pageSize = chatUser.clampPageSize(req.query.pageSize, { fallback: 100, max: 200 });
  return ok(res, await chatUser.listSpaces(req.user.email, { pageSize, pageToken }, ctx(req)));
});

const getSpace = route(async (req, res) => ok(res, await chatUser.getSpace(req.user.email, spaceNameOf(req), ctx(req))));

// A private label for a conversation (e.g. a DM whose partner's Google account
// was deleted). Only the caller sees it; they must still be able to open the space.
const setAlias = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const raw = req.body?.alias;
  let alias = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    if (typeof raw !== 'string') invalid('Nama tampilan tidak valid');
    alias = raw.replace(/\s+/g, ' ').trim();
    if (!alias || alias.length > 120) invalid('Nama tampilan 1–120 karakter');
  }
  await chatUser.getSpace(req.user.email, spaceName, ctx(req));
  const result = await chatUser.setAlias(req.user.sub, spaceName, alias);
  return ok(res, result);
});

const getSpaceDetails = route(async (req, res) => ok(res, await chatUser.getSpaceDetails(req.user.email, spaceNameOf(req), ctx(req))));

// type DIRECT_MESSAGE (one person; reuses an existing DM), GROUP_CHAT (2+ people,
// unnamed) or SPACE (named, optional description, 0+ people).
const createSpace = route(async (req, res) => {
  const body = req.body || {};
  const type = body.type;
  if (!['DIRECT_MESSAGE', 'GROUP_CHAT', 'SPACE'].includes(type)) invalid('Jenis percakapan tidak valid');
  if (type === 'DIRECT_MESSAGE') {
    const [email] = emailsOf(body.emails, { min: 1, max: 1 });
    const existing = await chatUser.findDirectMessage(req.user.email, email, ctx(req));
    if (existing) return ok(res, { space: existing, created: false });
    const space = await chatUser.setupSpace(req.user.email, { spaceType: 'DIRECT_MESSAGE', emails: [email] }, ctx(req));
    await activity(req, 'create_dm', { spaceName: space?.name || null });
    return ok(res, { space, created: true }, undefined, 201);
  }
  if (type === 'GROUP_CHAT') {
    const emails = emailsOf(body.emails, { min: 2 });
    const space = await chatUser.setupSpace(req.user.email, { spaceType: 'GROUP_CHAT', emails }, ctx(req));
    await activity(req, 'create_group_chat', { spaceName: space?.name || null, members: emails.length });
    return ok(res, { space, created: true }, undefined, 201);
  }
  const displayName = nameOf(body.displayName, { required: true });
  const description = descriptionOf(body.description);
  const emails = body.emails === undefined ? [] : emailsOf(body.emails, { min: 0 });
  const space = await chatUser.setupSpace(req.user.email, { spaceType: 'SPACE', displayName, description, emails }, ctx(req));
  await activity(req, 'create_space', { spaceName: space?.name || null, members: emails.length });
  return ok(res, { space, created: true }, undefined, 201);
});

const updateSpace = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const body = req.body || {};
  const displayName = nameOf(body.displayName, { required: false });
  const description = descriptionOf(body.description);
  const guidelines = guidelinesOf(body.guidelines);
  if (displayName === undefined && description === undefined && guidelines === undefined) invalid('Tidak ada perubahan');
  const space = await chatUser.patchSpace(req.user.email, spaceName, { displayName, description, guidelines }, ctx(req));
  await activity(req, 'update_space', { spaceName });
  return ok(res, space);
});

const deleteSpace = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const result = await chatUser.deleteSpace(req.user.email, spaceName, ctx(req));
  await activity(req, 'delete_space', { spaceName });
  return ok(res, result);
});

const addMembers = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const emails = emailsOf((req.body || {}).emails);
  const result = await chatUser.addMembers(req.user.email, spaceName, emails, ctx(req));
  await activity(req, 'add_members', { spaceName, added: result.added.length, failed: result.failed.length });
  return ok(res, result);
});

const removeMember = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  if (!ID_RE.test(req.params.memberId || '')) invalid('ID anggota tidak valid');
  const membershipName = `${spaceName}/members/${req.params.memberId}`;
  const result = await chatUser.removeMember(req.user.email, spaceName, membershipName, ctx(req));
  await activity(req, 'remove_member', { spaceName, membershipName });
  return ok(res, result);
});

const leaveSpace = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const result = await chatUser.leaveSpace(req.user.email, spaceName, ctx(req));
  await activity(req, 'leave_space', { spaceName });
  return ok(res, result);
});

const setNotification = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const { muted } = req.body || {};
  if (typeof muted !== 'boolean') invalid('Nilai bisukan tidak valid');
  return ok(res, await chatUser.setMuted(req.user.email, spaceName, muted, ctx(req)));
});

const getReadStates = route(async (req, res) => {
  const ids = String(req.query.spaces || '').split(',').filter(Boolean);
  if (ids.length > 200 || !ids.every(chatUser.isSpaceId)) invalid('Daftar ruang tidak valid');
  if (!ids.length) return ok(res, { available: true, states: {} });
  return ok(res, await chatUser.getReadStates(req.user.email, ids.map((id) => `spaces/${id}`), ctx(req)));
});

const markRead = route(async (req, res) => ok(res, await chatUser.markRead(req.user.email, spaceNameOf(req), ctx(req))));

// ------------------------------------------------------------------ messages

const listMessages = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const pageToken = pageTokenOf(req);
  const pageSize = chatUser.clampPageSize(req.query.pageSize, { fallback: 50, max: 100 });
  return ok(res, await chatUser.listMessages(req.user.email, spaceName, { pageSize, pageToken }, ctx(req)));
});

const listThreadMessages = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  if (!ID_RE.test(req.params.threadId || '')) invalid('ID utas tidak valid');
  const pageToken = pageTokenOf(req);
  return ok(res, await chatUser.listThreadMessages(
    req.user.email, spaceName, `${spaceName}/threads/${req.params.threadId}`, { pageToken }, ctx(req)
  ));
});

const createMessage = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const body = req.body || {};
  const text = textOf(body.text);
  const threadName = threadOf(body.threadName, spaceName);
  const quoted = quotedOf(body.quoted, spaceName);
  const message = await chatUser.createMessage(req.user.email, spaceName, { text, threadName, quoted }, ctx(req));
  await activity(req, 'send_message', { spaceName, messageName: message?.name || null, inThread: Boolean(threadName) });
  return ok(res, message, undefined, 201);
});

const updateMessage = route(async (req, res) => {
  const messageName = messageNameOf(req);
  const text = textOf((req.body || {}).text);
  const message = await chatUser.updateMessage(req.user.email, messageName, { text }, ctx(req));
  await activity(req, 'edit_message', { messageName });
  return ok(res, message);
});

const deleteMessage = route(async (req, res) => {
  const messageName = messageNameOf(req);
  const result = await chatUser.deleteMessage(req.user.email, messageName, ctx(req));
  await activity(req, 'delete_message', { messageName });
  return ok(res, result);
});

const toggleReaction = route(async (req, res) => {
  const messageName = messageNameOf(req);
  const { emoji } = req.body || {};
  if (!chatUser.isReactionEmoji(emoji)) invalid('Emoji tidak didukung');
  return ok(res, await chatUser.toggleReaction(req.user.email, messageName, emoji, ctx(req)));
});

// ------------------------------------------------------------------ attachments

// "../../x.pdf", control characters, quotes → a plain, short file name.
function sanitizeFilename(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const clean = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  if (!clean) return 'lampiran';
  if (clean.length <= 180) return clean;
  const ext = path.extname(clean).slice(0, 12);
  return clean.slice(0, 180 - ext.length) + ext;
}

const uploadAttachment = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  if (!req.file) invalid('File wajib dipilih');
  const body = req.body || {};
  const text = textOf(body.text, { required: false });
  const threadName = threadOf(body.threadName, spaceName);
  const filename = sanitizeFilename(req.file.originalname);
  const attachmentDataRef = await chatUser.uploadAttachment(
    req.user.email, spaceName, { filename, mimeType: req.file.mimetype, buffer: req.file.buffer }, ctx(req)
  );
  const message = await chatUser.createMessage(req.user.email, spaceName, { text, threadName, attachmentDataRef }, ctx(req));
  await activity(req, 'send_attachment', { spaceName, messageName: message?.name || null, size: req.file.size || req.file.buffer?.length || 0 });
  return ok(res, message, undefined, 201);
});

// Proxy for uploaded attachments (Chat's own download links need a Google
// browser session). Only the four raster image types are ever served inline;
// everything else is a download with a neutral type, so nothing can run here.
const downloadAttachment = route(async (req, res) => {
  const messageName = messageNameOf(req);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index > 19) invalid('Lampiran tidak valid');
  const { stream, filename, contentType } = await chatUser.downloadAttachment(req.user.email, messageName, index, ctx(req));
  const safeName = sanitizeFilename(filename);
  const inline = chatUser.IMAGE_TYPES.includes(contentType);
  res.status(200);
  res.setHeader('Content-Type', inline ? contentType : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=300');
  stream.on('error', () => { if (!res.headersSent) res.status(502); res.end(); });
  stream.pipe(res);
  return undefined;
});

// History on/off and (managers) who may do what. Only whitelisted keys and
// the two values 'managers' | 'members' ever reach Google.
const updateSettings = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const body = req.body || {};
  let historyOff;
  if (body.historyOff !== undefined) {
    if (typeof body.historyOff !== 'boolean') invalid('Pengaturan riwayat tidak valid');
    historyOff = body.historyOff;
  }
  let permissions;
  if (body.permissions !== undefined) {
    if (!body.permissions || typeof body.permissions !== 'object' || Array.isArray(body.permissions)) invalid('Pengaturan izin tidak valid');
    permissions = {};
    for (const [key, value] of Object.entries(body.permissions)) {
      if (!chatUser.PERMISSION_KEYS.includes(key) || !['managers', 'members'].includes(value)) invalid('Pengaturan izin tidak valid');
      permissions[key] = value;
    }
    if (!Object.keys(permissions).length) permissions = undefined;
  }
  if (historyOff === undefined && !permissions) invalid('Tidak ada perubahan');
  const space = await chatUser.updateSpaceSettings(req.user.email, spaceName, { historyOff, permissions }, ctx(req));
  await activity(req, 'update_space_settings', { spaceName, history: historyOff !== undefined, permissions: permissions ? Object.keys(permissions) : [] });
  return ok(res, space);
});

const forwardMessage = route(async (req, res) => {
  const messageName = messageNameOf(req);
  const body = req.body || {};
  if (!chatUser.isSpaceId(body.targetSpaceId)) invalid('Tujuan tidak valid');
  const targetSpaceName = `spaces/${body.targetSpaceId}`;
  const note = textOf(body.note, { required: false }).trim();
  if (note.length > 1000) invalid('Catatan maksimal 1000 karakter');
  const message = await chatUser.forwardMessage(req.user.email, messageName, targetSpaceName, { note: note || undefined }, ctx(req));
  await activity(req, 'forward_message', { from: messageName, spaceName: targetSpaceName, messageName: message?.name || null });
  return ok(res, message, undefined, 201);
});

// ------------------------------------------------------------------ attach from Drive

function fileIdsOf(value, max = chatUser.MAX_DRIVE_FILES_PER_MESSAGE) {
  if (!Array.isArray(value) || !value.length) invalid('Pilih minimal satu file');
  const ids = [...new Set(value)];
  if (ids.length > max) invalid(`Maksimal ${max} file sekaligus`);
  if (!ids.every(chatUser.isDriveId)) invalid('ID file tidak valid');
  return ids;
}

const optionalDriveId = (value, message) => {
  if (value === undefined || value === '') return undefined;
  if (!chatUser.isDriveId(value)) invalid(message);
  return value;
};

const listDriveFiles = route(async (req, res) => {
  const { source = 'my', q } = req.query;
  if (!chatUser.DRIVE_SOURCES.includes(source)) invalid('Sumber Drive tidak valid');
  if (q !== undefined && (typeof q !== 'string' || q.length > 100)) invalid('Kata kunci tidak valid');
  const folderId = optionalDriveId(req.query.folderId, 'Folder tidak valid');
  const driveId = optionalDriveId(req.query.driveId, 'Shared Drive tidak valid');
  const pageToken = pageTokenOf(req);
  return ok(res, await chatUser.listDriveFiles(req.user.email, { source, folderId, driveId, search: q, pageToken }, ctx(req)));
}, DRIVE_SERVICE);

const listSharedDrives = route(async (req, res) => ok(res, await chatUser.listSharedDrives(req.user.email, { pageToken: pageTokenOf(req) }, ctx(req))), DRIVE_SERVICE);

const getDriveMeta = route(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  return ok(res, await chatUser.getDriveFilesMeta(req.user.email, fileIdsOf(ids, 50), ctx(req)));
}, DRIVE_SERVICE);

const checkDriveAccess = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const fileIds = fileIdsOf((req.body || {}).fileIds);
  return ok(res, await chatUser.checkDriveAccess(req.user.email, spaceName, fileIds, ctx(req)));
}, DRIVE_SERVICE);

const grantDriveAccess = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const body = req.body || {};
  const fileIds = fileIdsOf(body.fileIds);
  if (!chatUser.isDriveRole(body.role)) invalid('Peran akses tidak valid');
  const result = await chatUser.grantDriveAccess(req.user.email, spaceName, fileIds, body.role, ctx(req));
  await activity(req, 'share_drive_files', { spaceName, files: fileIds.length, role: body.role, granted: result.granted, failed: result.failed });
  return ok(res, result);
}, DRIVE_SERVICE);

// ------------------------------------------------------------------ meet + people

const createMeet = route(async (req, res) => {
  const spaceName = spaceNameOf(req);
  const result = await chatUser.createMeet(req.user.email, spaceName, ctx(req));
  await activity(req, 'start_meet', { spaceName, messageName: result?.message?.name || null });
  return ok(res, result, undefined, 201);
});

const searchPeople = route(async (req, res) => {
  const q = req.query.q === undefined ? '' : req.query.q;
  if (typeof q !== 'string' || q.length > 100) invalid('Kata kunci tidak valid');
  return ok(res, { people: await chatUser.searchPeople(req.user.email, q, ctx(req)) });
});

module.exports = {
  listSpaces,
  getSpace,
  setAlias,
  getSpaceDetails,
  createSpace,
  updateSpace,
  deleteSpace,
  addMembers,
  removeMember,
  leaveSpace,
  setNotification,
  getReadStates,
  markRead,
  listMessages,
  listThreadMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  toggleReaction,
  uploadAttachment,
  downloadAttachment,
  createMeet,
  searchPeople,
  updateSettings,
  forwardMessage,
  listDriveFiles,
  listSharedDrives,
  getDriveMeta,
  checkDriveAccess,
  grantDriveAccess,
  sanitizeFilename,
};
