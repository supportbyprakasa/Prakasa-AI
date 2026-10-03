const { google } = require('googleapis');
const { userAuth } = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');

// The signed-in user's OWN Gmail, used inside Prakasa Workspace. Every call
// impersonates req.user.email through domain-wide delegation, so a user only
// ever reaches their own mailbox. (gmail.service.js is something else: the
// system notification sender.)
//
// Each operation asks for the narrowest scope that allows it, so sending keeps
// working even while the read scope has not been granted in Admin Console:
//   read / label / archive / trash → gmail.modify
//   send                           → gmail.send
//   drafts                         → gmail.compose
const SCOPES = {
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  send: 'https://www.googleapis.com/auth/gmail.send',
  compose: 'https://www.googleapis.com/auth/gmail.compose',
};

const PROVIDER = 'google_gmail_user';

function gmailClient(subject, scope) {
  return google.gmail({ version: 'v1', auth: userAuth(subject, [scope]) });
}

// ---------------------------------------------------------------------------
// Input whitelisting (everything from the client goes through these first).

const ID_RE = /^[A-Za-z0-9]{6,40}$/; // Gmail thread / message ids (hex)
const LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/; // INBOX, CATEGORY_SOCIAL, Label_12
const PART_RE = /^[0-9]{1,3}(\.[0-9]{1,3}){0,6}$/; // MIME part id: 0, 1.2, 1.2.1
const PAGE_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;
const MESSAGE_ID_HEADER_RE = /^<[^<>\s]{3,500}>$/; // RFC 2822 Message-ID
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const MAX_QUERY = 200;
const PAGE_SIZE = { min: 1, max: 50, default: 20 };

const isValidId = (value) => typeof value === 'string' && ID_RE.test(value);
const isValidLabelId = (value) => typeof value === 'string' && LABEL_RE.test(value);
const isValidPartId = (value) => typeof value === 'string' && PART_RE.test(value);
const isValidPageToken = (value) => typeof value === 'string' && PAGE_TOKEN_RE.test(value);
const isValidEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
const isValidMessageIdHeader = (value) => typeof value === 'string' && MESSAGE_ID_HEADER_RE.test(value);

// Gmail search syntax is passed through (it only ever searches the caller's
// own mailbox); control characters are stripped and the length is capped.
function sanitizeQuery(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_QUERY);
}

function clampPageSize(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return PAGE_SIZE.default;
  return Math.min(PAGE_SIZE.max, Math.max(PAGE_SIZE.min, n));
}

// ---------------------------------------------------------------------------
// MIME builder (RFC 2822 / 2045 / 2047). Pure and exported for tests.

const stripLineBreaks = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ');

function encodeBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047 "B" encoded-words, each at most 75 characters, split on character
// boundaries so a multi-byte UTF-8 sequence is never cut in half.
function encodeHeaderValue(value) {
  const text = stripLineBreaks(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words = [];
  let chunk = '';
  for (const char of text) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

function wrapBase64(buffer) {
  return buffer.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The plain-text body as simple HTML: escaped, line breaks kept, quoted
// ("> ") lines rendered as a blockquote-like grey block.
function textToHtml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const body = lines.map((line) => {
    if (/^>/.test(line)) return `<span style="color:#5f6368">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  }).join('<br>\r\n');
  return `<div dir="auto" style="font-family:Arial,Helvetica,sans-serif;font-size:14px">${body}</div>`;
}

function addressHeader(name, list) {
  if (!list || !list.length) return null;
  return `${name}: ${list.join(', ')}`;
}

function buildRawMessage({ to = [], cc = [], bcc = [], subject = '', body = '', inReplyTo, references } = {}, { boundary, date } = {}) {
  const mark = boundary || `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const text = String(body || '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const headers = [
    addressHeader('To', to),
    addressHeader('Cc', cc),
    addressHeader('Bcc', bcc),
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${(date || new Date()).toUTCString().replace('GMT', '+0000')}`,
    inReplyTo ? `In-Reply-To: ${stripLineBreaks(inReplyTo)}` : null,
    references ? `References: ${stripLineBreaks(references)}` : null,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${mark}"`,
  ].filter(Boolean);
  const parts = [
    `--${mark}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(text, 'utf8')),
    `--${mark}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(textToHtml(body), 'utf8')),
    `--${mark}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

// ---------------------------------------------------------------------------
// Reading Gmail's message payloads.

function header(headers, name) {
  const lower = name.toLowerCase();
  const found = (headers || []).find((h) => String(h.name).toLowerCase() === lower);
  return found ? String(found.value || '') : '';
}

function decodeBody(data, charset) {
  if (!data) return '';
  const buffer = Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const label = String(charset || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function charsetOf(part) {
  const match = /charset="?([^";\s]+)"?/i.exec(header(part.headers, 'Content-Type'));
  return match ? match[1] : 'utf-8';
}

function walkParts(part, visit) {
  if (!part) return;
  visit(part);
  (part.parts || []).forEach((child) => walkParts(child, visit));
}

const MAX_BODY_CHARS = 1_500_000;

function parseMessage(message) {
  const payload = message.payload || {};
  const headers = payload.headers || [];
  let html = '';
  let text = '';
  const attachments = [];
  const inline = [];

  walkParts(payload, (part) => {
    const disposition = header(part.headers, 'Content-Disposition');
    const contentId = header(part.headers, 'Content-ID').replace(/^<|>$/g, '');
    const isAttachment = Boolean(part.filename) || /attachment/i.test(disposition);
    if (!isAttachment && part.mimeType === 'text/html' && !html) html = decodeBody(part.body?.data, charsetOf(part));
    else if (!isAttachment && part.mimeType === 'text/plain' && !text) text = decodeBody(part.body?.data, charsetOf(part));
    else if (part.body && (part.body.attachmentId || (part.filename && part.body.data))) {
      const item = {
        partId: part.partId,
        filename: part.filename || 'lampiran',
        mimeType: part.mimeType || 'application/octet-stream',
        size: Number(part.body.size) || 0,
      };
      if (contentId && /^image\//i.test(part.mimeType || '') && !/attachment/i.test(disposition)) {
        inline.push({ ...item, contentId, attachmentId: part.body.attachmentId, data: part.body.data });
      } else {
        attachments.push(item);
      }
    }
  });

  const labelIds = message.labelIds || [];
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds,
    unread: labelIds.includes('UNREAD'),
    starred: labelIds.includes('STARRED'),
    snippet: message.snippet || '',
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    cc: header(headers, 'Cc'),
    bcc: header(headers, 'Bcc'),
    replyTo: header(headers, 'Reply-To'),
    subject: header(headers, 'Subject'),
    date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    messageId: header(headers, 'Message-ID') || header(headers, 'Message-Id'),
    references: header(headers, 'References'),
    html: html.slice(0, MAX_BODY_CHARS),
    text: text.slice(0, MAX_BODY_CHARS),
    attachments,
    inline,
  };
}

function summarizeThread(thread) {
  const messages = thread.messages || [];
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  const labelIds = [...new Set(messages.flatMap((m) => m.labelIds || []))];
  const hasAttachment = messages.some((m) => {
    let found = false;
    walkParts(m.payload, (part) => { if (part.filename) found = true; });
    return found || m.payload?.mimeType === 'multipart/mixed';
  });
  return {
    id: thread.id,
    snippet: last.snippet || thread.snippet || '',
    subject: header(first.payload?.headers, 'Subject'),
    from: header(last.payload?.headers, 'From'),
    to: header(last.payload?.headers, 'To'),
    date: last.internalDate ? new Date(Number(last.internalDate)).toISOString() : null,
    messageCount: messages.length,
    unread: messages.some((m) => (m.labelIds || []).includes('UNREAD')),
    starred: labelIds.includes('STARRED'),
    hasAttachment,
    labelIds,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function logCtx(ctx, operation, requestMeta, responseMeta) {
  return {
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: PROVIDER,
    operation,
    requestMeta,
    responseMeta,
  };
}

// ---------------------------------------------------------------------------
// Operations. Every one takes the Workspace subject (req.user.email) first.

const SYSTEM_LABEL_IDS = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH'];
const MAX_USER_LABELS = 100;

async function listLabels(subject, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'listLabels', { subject }, (r) => ({ count: r?.length || 0 })), async () => {
    const gmail = gmailClient(subject, SCOPES.modify);
    const { data } = await gmail.users.labels.list({ userId: 'me' });
    const all = data.labels || [];
    const wanted = [
      ...SYSTEM_LABEL_IDS.map((id) => all.find((l) => l.id === id)).filter(Boolean),
      ...all.filter((l) => l.type === 'user' && l.labelListVisibility !== 'labelHide').slice(0, MAX_USER_LABELS),
    ];
    const detailed = await mapLimit(wanted, 10, async (label) => {
      const { data: full } = await gmail.users.labels.get({ userId: 'me', id: label.id });
      return {
        id: full.id,
        name: full.name,
        type: full.type,
        unread: Number(full.threadsUnread) || 0,
        total: Number(full.threadsTotal) || 0,
      };
    });
    return detailed;
  });
}

async function listThreads(subject, { labelId, q, pageToken, maxResults } = {}, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'listThreads', { subject, labelId: labelId || null, hasQuery: Boolean(q), paged: Boolean(pageToken) },
    (r) => ({ count: r?.threads?.length || 0 })), async () => {
    const gmail = gmailClient(subject, SCOPES.modify);
    const { data } = await gmail.users.threads.list({
      userId: 'me',
      labelIds: labelId ? [labelId] : undefined,
      q: q || undefined,
      pageToken: pageToken || undefined,
      maxResults: clampPageSize(maxResults),
      includeSpamTrash: labelId === 'SPAM' || labelId === 'TRASH',
    });
    const ids = (data.threads || []).map((t) => t.id);
    const threads = await mapLimit(ids, 8, async (id) => {
      const { data: thread } = await gmail.users.threads.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      return summarizeThread(thread);
    });
    return {
      threads,
      nextPageToken: data.nextPageToken || null,
      resultSizeEstimate: Number(data.resultSizeEstimate) || 0,
    };
  });
}

const MAX_INLINE_BYTES = 512 * 1024;
const MAX_INLINE_IMAGES = 12;

// cid: images (signature logos, pasted screenshots) cannot load inside the
// sandboxed viewer, so small ones are embedded as data: URIs.
async function embedInlineImages(gmail, messages) {
  const jobs = [];
  messages.forEach((message) => {
    message.inline.forEach((image) => {
      if (message.html && message.html.includes(`cid:${image.contentId}`) && image.size <= MAX_INLINE_BYTES) {
        jobs.push({ message, image });
      } else {
        message.attachments.push({ partId: image.partId, filename: image.filename, mimeType: image.mimeType, size: image.size });
      }
    });
  });
  await mapLimit(jobs.slice(0, MAX_INLINE_IMAGES), 4, async ({ message, image }) => {
    try {
      let data = image.data;
      if (!data && image.attachmentId) {
        const response = await gmail.users.messages.attachments.get({ userId: 'me', messageId: message.id, id: image.attachmentId });
        data = response.data.data;
      }
      if (!data) return;
      const base64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
      const mime = /^image\/[a-z0-9.+-]+$/i.test(image.mimeType) ? image.mimeType : 'application/octet-stream';
      message.html = message.html.split(`cid:${image.contentId}`).join(`data:${mime};base64,${base64}`);
    } catch {
      // A missing inline image never blocks reading the message.
    }
  });
  messages.forEach((message) => { delete message.inline; });
}

async function getThread(subject, threadId, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'getThread', { subject, threadId }, (r) => ({ messages: r?.messages?.length || 0 })), async () => {
    const gmail = gmailClient(subject, SCOPES.modify);
    const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    const messages = (data.messages || []).map(parseMessage);
    await embedInlineImages(gmail, messages);
    const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];
    return {
      id: data.id,
      subject: messages[0]?.subject || '',
      labelIds,
      unread: messages.some((m) => m.unread),
      starred: labelIds.includes('STARRED'),
      messages,
    };
  });
}

// action → the label change (or trash call) that performs it.
const THREAD_ACTIONS = {
  archive: { removeLabelIds: ['INBOX'] },
  inbox: { addLabelIds: ['INBOX'] },
  read: { removeLabelIds: ['UNREAD'] },
  unread: { addLabelIds: ['UNREAD'] },
  star: { addLabelIds: ['STARRED'] },
  unstar: { removeLabelIds: ['STARRED'] },
  trash: 'trash',
  untrash: 'untrash',
};

async function modifyThread(subject, threadId, action, ctx = {}) {
  const change = THREAD_ACTIONS[action];
  if (!change) throw Object.assign(new Error('Aksi tidak dikenal'), { status: 400, code: 'VALIDATION_ERROR' });
  return integrationLog.wrap(logCtx(ctx, `thread.${action}`, { subject, threadId }, () => ({ ok: true })), async () => {
    const gmail = gmailClient(subject, SCOPES.modify);
    if (change === 'trash') await gmail.users.threads.trash({ userId: 'me', id: threadId });
    else if (change === 'untrash') await gmail.users.threads.untrash({ userId: 'me', id: threadId });
    else await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: change });
    return { id: threadId, action };
  });
}

// Attachment ids are not stable between Gmail reads, so the client names the
// MIME part and the current attachment id is resolved here.
async function getAttachment(subject, messageId, partId, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'getAttachment', { subject, messageId, partId }, (r) => ({ size: r?.data?.length || 0 })), async () => {
    const gmail = gmailClient(subject, SCOPES.modify);
    const { data: message } = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    let part = null;
    walkParts(message.payload, (p) => { if (p.partId === partId) part = p; });
    if (!part || !part.body || (!part.body.attachmentId && !part.body.data)) {
      throw Object.assign(new Error('Lampiran tidak ditemukan'), { status: 404 });
    }
    let data = part.body.data;
    if (!data) {
      const response = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.body.attachmentId });
      data = response.data.data;
    }
    return {
      filename: part.filename || 'lampiran',
      mimeType: part.mimeType || 'application/octet-stream',
      data: Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    };
  });
}

function recipientCount(message) {
  return (message.to?.length || 0) + (message.cc?.length || 0) + (message.bcc?.length || 0);
}

async function sendMessage(subject, message, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'sendMessage', { subject, recipients: recipientCount(message), reply: Boolean(message.threadId) },
    (r) => ({ id: r?.id })), async () => {
    const gmail = gmailClient(subject, SCOPES.send);
    const raw = encodeBase64Url(buildRawMessage(message));
    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(message.threadId ? { threadId: message.threadId } : {}) },
    });
    return { id: data.id, threadId: data.threadId };
  });
}

async function createDraft(subject, message, ctx = {}) {
  return integrationLog.wrap(logCtx(ctx, 'createDraft', { subject, recipients: recipientCount(message), reply: Boolean(message.threadId) },
    (r) => ({ id: r?.id })), async () => {
    const gmail = gmailClient(subject, SCOPES.compose);
    const raw = encodeBase64Url(buildRawMessage(message));
    const { data } = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw, ...(message.threadId ? { threadId: message.threadId } : {}) } },
    });
    return { id: data.id, messageId: data.message?.id, threadId: data.message?.threadId };
  });
}

module.exports = {
  SCOPES,
  THREAD_ACTIONS,
  PAGE_SIZE,
  MAX_QUERY,
  isValidId,
  isValidLabelId,
  isValidPartId,
  isValidPageToken,
  isValidEmail,
  isValidMessageIdHeader,
  sanitizeQuery,
  clampPageSize,
  encodeHeaderValue,
  encodeBase64Url,
  buildRawMessage,
  textToHtml,
  parseMessage,
  summarizeThread,
  listLabels,
  listThreads,
  getThread,
  modifyThread,
  getAttachment,
  sendMessage,
  createDraft,
  gmailClient,
};
