// Pure helpers for the Gmail page (pages/google/Mail.jsx). No React here, so
// every rule is covered by frontend/test/mailModel.test.js.
import { formatDateTime, formatTime, toDate } from '../../components/format.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';

export const ALL_MAIL = 'ALL';

// Gmail's system folders in Gmail's own order. `id` is the Gmail label id;
// ALL_MAIL means "no label filter" (Semua email).
export const SYSTEM_LABELS = [
  { id: 'INBOX', name: 'Kotak masuk', icon: 'inbox', count: 'unread' },
  { id: 'STARRED', name: 'Berbintang', icon: 'star', count: null },
  { id: 'SENT', name: 'Terkirim', icon: 'sent', count: null },
  { id: 'DRAFT', name: 'Draf', icon: 'draft', count: 'total' },
  { id: ALL_MAIL, name: 'Semua email', icon: 'all', count: null },
  { id: 'SPAM', name: 'Spam', icon: 'spam', count: 'unread' },
  { id: 'TRASH', name: 'Sampah', icon: 'trash', count: null },
];

const LABEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const THREAD_ID_RE = /^[A-Za-z0-9]{6,40}$/;
export const MAX_QUERY = 200;

export const isValidLabelId = (value) => typeof value === 'string' && LABEL_ID_RE.test(value);
export const isValidThreadId = (value) => typeof value === 'string' && THREAD_ID_RE.test(value);

export function normalizeLabelParam(value) {
  return isValidLabelId(value || '') ? value : 'INBOX';
}

// Merges the fixed system folders with what the API returned (counts, user
// labels). Works with an empty API list so the nav renders while the read
// scope is missing.
export function buildLabelNav(apiLabels = []) {
  const byId = new Map((apiLabels || []).map((label) => [label.id, label]));
  const system = SYSTEM_LABELS.map((label) => {
    const api = byId.get(label.id);
    const count = !api || !label.count ? 0 : label.count === 'total' ? api.total : api.unread;
    return { ...label, count: count || 0 };
  });
  const user = (apiLabels || [])
    .filter((label) => label.type === 'user')
    .map((label) => ({ id: label.id, name: label.name, icon: 'label', count: label.unread || 0, user: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return { system, user };
}

export function labelName(labelId, apiLabels = []) {
  const system = SYSTEM_LABELS.find((label) => label.id === labelId);
  if (system) return system.name;
  return (apiLabels || []).find((label) => label.id === labelId)?.name || 'Label';
}

export function sanitizeQuery(value) {
  // eslint-disable-next-line no-control-regex
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_QUERY);
}

// ------------------------------------------------------------------ addresses

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isValidEmail = (value) => typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);

// Splits on commas/semicolons that are not inside quotes or <…>.
function splitAddresses(value) {
  const parts = [];
  let current = '';
  let quoted = false;
  let angle = false;
  for (const char of String(value || '')) {
    if (char === '"') quoted = !quoted;
    else if (char === '<' && !quoted) angle = true;
    else if (char === '>' && !quoted) angle = false;
    if ((char === ',' || char === ';') && !quoted && !angle) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// One header address → { name, email }. "Budi S <budi@x.com>", "budi@x.com",
// "\"Sari, HR\" <sari@x.com>".
export function parseAddress(value) {
  const text = String(value || '').trim();
  const angle = /^(.*?)<([^<>]+)>\s*$/.exec(text);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    return { name, email: angle[2].trim() };
  }
  return { name: '', email: text.replace(/^"(.*)"$/, '$1') };
}

export function parseAddressHeader(value) {
  return splitAddresses(value).map(parseAddress).filter((a) => a.email);
}

// Compose field text → the list the API expects (plain, de-duplicated emails)
// plus anything that is not a valid address, for the field error.
export function parseAddressList(value) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  splitAddresses(value).forEach((token) => {
    const { email } = parseAddress(token);
    if (!isValidEmail(email)) { invalid.push(token); return; }
    const key = email.toLowerCase();
    if (!seen.has(key)) { seen.add(key); valid.push(email); }
  });
  return { valid, invalid };
}

export const displayName = (address) => (address?.name || address?.email || '').trim();

export function senderLabel(header, myEmail) {
  const first = parseAddressHeader(header)[0];
  if (!first) return '(tanpa pengirim)';
  if (myEmail && first.email.toLowerCase() === String(myEmail).toLowerCase()) return 'saya';
  return displayName(first);
}

// Whether senderLabel() shows the sender's own name or address (record data)
// rather than an interface word ("saya", "(tanpa pengirim)").
export function senderIsRecord(header, myEmail) {
  const first = parseAddressHeader(header)[0];
  if (!first) return false;
  if (myEmail && first.email.toLowerCase() === String(myEmail).toLowerCase()) return false;
  return Boolean(displayName(first));
}

export function initials(nameOrEmail) {
  const text = String(nameOrEmail || '').replace(/@.*/, '').trim();
  if (!text) return '?';
  const words = text.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 1);
  return letters.toUpperCase();
}

// --------------------------------------------------------------------- dates

const pad = (n) => String(n).padStart(2, '0');

// Gmail-style list date: time today, "12 Sep" this year, dd/mm/yyyy before.
export function formatListDate(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  if (date.toDateString() === now.toDateString()) return formatTime(date);
  if (date.getFullYear() === now.getFullYear()) return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

// "30 Sep 2026, 14.05" — the app's one date-time format (components/format.js).
export function formatFullDate(value) {
  return toDate(value) ? formatDateTime(value) : '';
}

// Gmail snippets arrive HTML-escaped ("Don&#39;t"); shown as plain text.
export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d{1,6});/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// ------------------------------------------------------------- reply/forward

export function prefixSubject(subject, prefix) {
  const text = String(subject || '').trim();
  const pattern = prefix === 'Re' ? /^(re|balas)\s*:/i : /^(fwd?|terusan)\s*:/i;
  return pattern.test(text) ? text : `${prefix}: ${text}`.trim();
}

// Rough text for quoting an HTML-only message (never rendered as HTML).
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const messageText = (message) => (message?.text ? message.text : htmlToText(message?.html));

const MESSAGE_ID_RE = /^<[^<>\s]{3,500}>$/;

function referencesFor(message) {
  const refs = String(message?.references || '').split(/\s+/).filter((ref) => MESSAGE_ID_RE.test(ref));
  if (MESSAGE_ID_RE.test(message?.messageId || '')) refs.push(message.messageId);
  return [...new Set(refs)].slice(-30).join(' ');
}

const joinAddresses = (list) => list.map((a) => a.email).join(', ');

// The compose form prefilled for Balas / Balas semua / Teruskan.
export function buildReplyDraft(message, mode, myEmail = '') {
  const me = String(myEmail).toLowerCase();
  const from = parseAddressHeader(message.replyTo || message.from);
  const fromIsMe = from.length === 1 && from[0].email.toLowerCase() === me;
  const originalTo = parseAddressHeader(message.to);
  const originalCc = parseAddressHeader(message.cc);
  const sender = parseAddressHeader(message.from)[0] || { name: '', email: '' };
  const quotedText = messageText(message);

  if (mode === 'forward') {
    const headerLines = [
      '---------- Pesan terusan ----------',
      `Dari: ${message.from || ''}`,
      `Tanggal: ${formatFullDate(message.date)}`,
      `Subjek: ${message.subject || ''}`,
      `Kepada: ${message.to || ''}`,
      message.cc ? `Cc: ${message.cc}` : null,
    ].filter(Boolean);
    return {
      mode,
      to: '', cc: '', bcc: '',
      subject: prefixSubject(message.subject, 'Fwd'),
      body: `\n\n${headerLines.join('\n')}\n\n${quotedText}`,
      threadId: message.threadId || null,
      inReplyTo: null,
      references: null,
    };
  }

  const to = fromIsMe ? originalTo : from;
  let cc = [];
  if (mode === 'replyAll') {
    const skip = new Set([me, ...to.map((a) => a.email.toLowerCase())]);
    cc = [...originalTo, ...originalCc].filter((a) => {
      const key = a.email.toLowerCase();
      if (skip.has(key)) return false;
      skip.add(key);
      return true;
    });
  }
  const quoted = quotedText.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return {
    mode,
    to: joinAddresses(to),
    cc: joinAddresses(cc),
    bcc: '',
    subject: prefixSubject(message.subject, 'Re'),
    body: `\n\nPada ${formatFullDate(message.date)}, ${displayName(sender)}${sender.name ? ` <${sender.email}>` : ''} menulis:\n${quoted}`,
    threadId: message.threadId || null,
    inReplyTo: MESSAGE_ID_RE.test(message.messageId || '') ? message.messageId : null,
    references: referencesFor(message) || null,
  };
}

// "to:a@x.com,b@y.com" → "a@x.com, b@y.com" (only well-formed addresses survive).
export function composeToFromParam(value) {
  const raw = String(value || '');
  if (!raw.startsWith('to:')) return '';
  return raw.slice(3).split(',').map((part) => part.trim())
    .filter((part) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(part)).slice(0, 20).join(', ');
}

export const EMPTY_DRAFT = { mode: 'new', to: '', cc: '', bcc: '', subject: '', body: '', threadId: null, inReplyTo: null, references: null };

// Form state → { payload } for POST /google-mail/send|drafts, or { errors }.
export function composePayload(draft) {
  const errors = {};
  const lists = {};
  for (const key of ['to', 'cc', 'bcc']) {
    const { valid, invalid } = parseAddressList(draft[key]);
    if (invalid.length) errors[key] = `Alamat tidak valid: ${invalid.slice(0, 3).join(', ')}`;
    lists[key] = valid;
  }
  if (!errors.to && !lists.to.length && !lists.cc.length && !lists.bcc.length) errors.to = 'Isi minimal satu penerima';
  if (Object.keys(errors).length) return { errors };
  return {
    payload: {
      ...lists,
      subject: String(draft.subject || '').slice(0, 500),
      body: String(draft.body || ''),
      ...(draft.threadId ? { threadId: draft.threadId } : {}),
      ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
      ...(draft.references ? { references: draft.references } : {}),
    },
  };
}

// ------------------------------------------------------- safe HTML rendering
//
// Untrusted email HTML is only ever shown inside a sandboxed iframe (no
// allow-scripts) through srcdoc. The CSP below blocks everything except
// inline styles and data:/cid: images; remote images need the user's click.
// Tags that could navigate, embed or override our <meta>/<base> are removed
// first as defence in depth.

const STRIP_BLOCKS = /<(script|iframe|frame|frameset|object|embed|applet|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const STRIP_TAGS = /<\/?(script|iframe|frame|frameset|object|embed|applet|meta|base|link|form|input|button|select|textarea|noscript|template|portal)\b[^>]*>/gi;

export function sanitizeEmailHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(STRIP_BLOCKS, '')
    .replace(STRIP_TAGS, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript):/gi, '$1=$2about:blank#')
    .replace(/<a\b/gi, '<a rel="noopener noreferrer" target="_blank"');
}

export function hasRemoteImages(html) {
  const text = String(html || '');
  return /<img\b[^>]*\ssrc\s*=\s*["']?\s*(https?:)?\/\//i.test(text)
    || /url\(\s*["']?\s*(https?:)?\/\//i.test(text)
    || /\sbackground\s*=\s*["']?\s*(https?:)?\/\//i.test(text);
}

export function mailCsp(showRemoteImages) {
  const img = showRemoteImages ? "data: cid: https:" : 'data: cid:';
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; font-src data:; form-action 'none'; base-uri 'none'`;
}

const FRAME_STYLE = [
  'html{color-scheme:light}',
  'body{margin:0;padding:0;background:white;color:black;font:14px/1.5 Roboto,Arial,Helvetica,sans-serif;overflow-wrap:anywhere}',
  'img{max-width:100%;height:auto}',
  'table{max-width:100%}',
  'pre{white-space:pre-wrap}',
  'blockquote{margin:0 0 0 8px;padding-left:12px;border-left:2px solid silver;color:dimgray}',
].join('');

export function buildMailSrcdoc(html, { showRemoteImages = false } = {}) {
  const csp = mailCsp(showRemoteImages).replace(/"/g, '&quot;');
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<meta name="referrer" content="no-referrer">'
    + '<base target="_blank">'
    + `<style>${FRAME_STYLE}</style></head><body>${sanitizeEmailHtml(html)}</body></html>`;
}

// ---------------------------------------------------------------- API errors

export function mailError(error, fallback = 'Gagal memuat Gmail') {
  const data = error?.response?.data?.error;
  return { code: data?.code || 'UNKNOWN', message: data?.message || fallback };
}

export const isScopeMissing = (error) => mailError(error).code === 'GOOGLE_SCOPE_NOT_GRANTED';

// A compose request the server rejected as invalid (VALIDATION_ERROR) belongs
// on the field it is about: subject, message, or the recipient list that
// holds the bad address (Kepada, Cc or Bcc — `payload` tells which). Reply
// headers, the thread id and any message this does not recognise return null,
// so the caller shows them in a snackbar instead of hiding them on a field.
export function composeFieldError(error, payload = null) {
  const { code, message } = mailError(error, '');
  if (code !== 'VALIDATION_ERROR' || !message) return null;
  if (/subjek/i.test(message)) return { field: 'subject', message };
  if (/isi email/i.test(message)) return { field: 'body', message };
  const list = message.match(/daftar penerima \((to|cc|bcc)\)/i);
  if (list) return { field: list[1].toLowerCase(), message };
  if (/minimal satu penerima/i.test(message)) return { field: 'to', message };
  const bad = message.match(/alamat email tidak valid:\s*(.+)$/i);
  if (bad) {
    const address = bad[1].trim().toLowerCase();
    const holds = (key) => (payload?.[key] || []).some((item) => String(item).trim().toLowerCase().startsWith(address));
    const field = ['cc', 'bcc'].find(holds) || 'to';
    return { field, message };
  }
  return null;
}

// Optimistic list update after a thread action (archive/trash leave the view).
export function applyThreadAction(threads, threadId, action, labelId) {
  const leaves = (action === 'archive' && labelId === 'INBOX')
    || (action === 'trash' && labelId !== 'TRASH')
    || (action === 'untrash' && labelId === 'TRASH')
    || (action === 'unstar' && labelId === 'STARRED');
  if (leaves) return threads.filter((thread) => thread.id !== threadId);
  return threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    if (action === 'read') return { ...thread, unread: false };
    if (action === 'unread') return { ...thread, unread: true };
    if (action === 'star') return { ...thread, starred: true };
    if (action === 'unstar') return { ...thread, starred: false };
    return thread;
  });
}
