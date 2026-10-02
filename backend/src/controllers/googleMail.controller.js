const { ok, fail } = require('../utils/response');
const { handleGoogleError } = require('../services/googleUserClient');
const { log } = require('../services/activityLog.service');
const mail = require('../services/googleMail.service');

// Gmail for the signed-in user only: the Google subject is always
// req.user.email — the client never chooses whose mailbox is used.
const ctxOf = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });
const onError = (res, next) => (error) => handleGoogleError(error, res, next, { service: 'Gmail' });
const invalid = (res, message) => fail(res, 'VALIDATION_ERROR', message, 400);

async function listLabels(req, res, next) {
  try {
    const labels = await mail.listLabels(req.user.email, ctxOf(req));
    return ok(res, { labels });
  } catch (error) { return onError(res, next)(error); }
}

async function listThreads(req, res, next) {
  try {
    const { labelId, pageToken } = req.query;
    if (labelId !== undefined && labelId !== '' && !mail.isValidLabelId(labelId)) return invalid(res, 'Label tidak valid');
    if (pageToken !== undefined && pageToken !== '' && !mail.isValidPageToken(pageToken)) return invalid(res, 'Halaman tidak valid');
    if (typeof req.query.q === 'string' && req.query.q.length > mail.MAX_QUERY) return invalid(res, `Pencarian maksimal ${mail.MAX_QUERY} karakter`);
    const result = await mail.listThreads(req.user.email, {
      labelId: labelId || null,
      q: mail.sanitizeQuery(req.query.q),
      pageToken: pageToken || null,
      maxResults: mail.clampPageSize(req.query.maxResults),
    }, ctxOf(req));
    return ok(res, result);
  } catch (error) { return onError(res, next)(error); }
}

async function getThread(req, res, next) {
  try {
    const { threadId } = req.params;
    if (!mail.isValidId(threadId)) return invalid(res, 'ID percakapan tidak valid');
    const thread = await mail.getThread(req.user.email, threadId, ctxOf(req));
    return ok(res, thread);
  } catch (error) { return onError(res, next)(error); }
}

async function threadAction(req, res, next) {
  try {
    const { threadId } = req.params;
    const action = req.body?.action;
    if (!mail.isValidId(threadId)) return invalid(res, 'ID percakapan tidak valid');
    if (!Object.prototype.hasOwnProperty.call(mail.THREAD_ACTIONS, action)) return invalid(res, 'Aksi tidak dikenal');
    const result = await mail.modifyThread(req.user.email, threadId, action, ctxOf(req));
    return ok(res, result);
  } catch (error) { return onError(res, next)(error); }
}

// Keeps the name readable but safe for a header: no path parts, quotes,
// control characters, or anything that could break Content-Disposition.
function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?;]+/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'lampiran';
}

function contentDisposition(filename) {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/%/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const safeMimeType = (value) => (/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(String(value || '')) ? value : 'application/octet-stream');

async function downloadAttachment(req, res, next) {
  try {
    const { messageId, partId } = req.params;
    if (!mail.isValidId(messageId)) return invalid(res, 'ID email tidak valid');
    if (!mail.isValidPartId(partId)) return invalid(res, 'ID lampiran tidak valid');
    const file = await mail.getAttachment(req.user.email, messageId, partId, ctxOf(req));
    res.status(200);
    res.setHeader('Content-Type', safeMimeType(file.mimeType));
    res.setHeader('Content-Length', String(file.data.length));
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.end(file.data);
  } catch (error) { return onError(res, next)(error); }
}

// Validates the compose payload into a clean message, or returns an error text.
function readComposeBody(body = {}) {
  const lists = {};
  for (const key of ['to', 'cc', 'bcc']) {
    const value = body[key] ?? [];
    if (!Array.isArray(value) || value.length > 50) return { error: `Daftar penerima (${key}) tidak valid` };
    const clean = value.map((item) => String(item).trim()).filter(Boolean);
    const bad = clean.find((item) => !mail.isValidEmail(item));
    if (bad) return { error: `Alamat email tidak valid: ${bad.slice(0, 80)}` };
    lists[key] = [...new Set(clean.map((item) => item.toLowerCase()))];
  }
  if (!lists.to.length && !lists.cc.length && !lists.bcc.length) return { error: 'Isi minimal satu penerima' };

  const subject = typeof body.subject === 'string' ? body.subject : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (subject.length > 500) return { error: 'Subjek terlalu panjang' };
  if (text.length > 200_000) return { error: 'Isi email terlalu panjang' };

  const threadId = body.threadId || null;
  if (threadId && !mail.isValidId(threadId)) return { error: 'ID percakapan tidak valid' };
  const inReplyTo = body.inReplyTo || null;
  if (inReplyTo && !mail.isValidMessageIdHeader(inReplyTo)) return { error: 'Header balasan tidak valid' };
  const refs = typeof body.references === 'string' ? body.references.trim().split(/\s+/).filter(Boolean) : [];
  if (refs.some((ref) => !mail.isValidMessageIdHeader(ref))) return { error: 'Header referensi tidak valid' };

  return {
    message: {
      ...lists,
      subject,
      body: text,
      threadId,
      inReplyTo,
      references: refs.slice(-30).join(' ') || null,
    },
  };
}

function composeHandler(kind) {
  return async function handler(req, res, next) {
    try {
      const { message, error } = readComposeBody(req.body);
      if (error) return invalid(res, error);
      const result = kind === 'draft'
        ? await mail.createDraft(req.user.email, message, ctxOf(req))
        : await mail.sendMessage(req.user.email, message, ctxOf(req));
      // The mail is already sent — a failed audit write must not turn that into an error.
      await log({
        entityId: req.user.entityId,
        userId: req.user.sub,
        action: kind === 'draft' ? 'gmail.save_draft' : 'gmail.send',
        subjectType: 'gmail_message',
        metadata: { recipients: message.to.length + message.cc.length + message.bcc.length, reply: Boolean(message.threadId) },
      }).catch(() => {});
      return ok(res, result, undefined, 201);
    } catch (err) { return onError(res, next)(err); }
  };
}

module.exports = {
  listLabels,
  listThreads,
  getThread,
  threadAction,
  downloadAttachment,
  sendMessage: composeHandler('send'),
  createDraft: composeHandler('draft'),
  sanitizeFilename,
  contentDisposition,
  readComposeBody,
};
