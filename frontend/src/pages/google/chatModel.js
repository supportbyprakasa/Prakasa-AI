import { dateLocale } from '../../i18n/language.js';
// Pure helpers for the Google Chat page (no React, no DOM) — unit tested in
// chatModel.test.js.

export const MAX_TEXT_LENGTH = 4096;
export const REFRESH_MS = 10000;

const SPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidSpaceId(value) {
  return typeof value === 'string' && SPACE_ID_RE.test(value);
}

export function spaceIdFromName(name) {
  const id = String(name || '').replace(/^spaces\//, '');
  return isValidSpaceId(id) ? id : null;
}

// ------------------------------------------------------------------ people

export function initials(name) {
  // "[UJI] Warehouse Head" → "UH": initials come from letters/digits only.
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join('').toUpperCase();
}

// Deterministic avatar colour slot (0–5) so a person keeps the same tint.
export function avatarSlot(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 6;
}

// ------------------------------------------------------------------ spaces

export function sortSpaces(spaces) {
  return [...(spaces || [])].sort((a, b) => String(b.lastActiveTime || '').localeCompare(String(a.lastActiveTime || '')));
}

export function filterSpaces(spaces, query) {
  const q = String(query || '').trim().toLocaleLowerCase('id-ID');
  if (!q) return spaces || [];
  return (spaces || []).filter((space) => String(space.displayName || '').toLocaleLowerCase('id-ID').includes(q));
}

// Google Chat's own sidebar split: people (DMs + unnamed group chats),
// named spaces, and apps (a DM with a Chat app) — each newest first.
export const SECTIONS = [
  { key: 'direct', label: 'Pesan langsung' },
  { key: 'spaces', label: 'Space' },
  { key: 'apps', label: 'Aplikasi' },
];

export function groupSpaces(spaces) {
  const sorted = sortSpaces(spaces);
  return {
    direct: sorted.filter((space) => !space.isBotDm && space.spaceType !== 'SPACE'),
    spaces: sorted.filter((space) => !space.isBotDm && space.spaceType === 'SPACE'),
    apps: sorted.filter((space) => space.isBotDm),
  };
}

// Kept for older callers: people vs. rooms (apps count as people).
export function splitSpaces(spaces) {
  const sorted = sortSpaces(spaces);
  return {
    direct: sorted.filter((space) => space.spaceType !== 'SPACE'),
    rooms: sorted.filter((space) => space.spaceType === 'SPACE'),
  };
}

// Which sections are collapsed, remembered per Prakasa user. Storage can be
// missing or throw (private mode, blocked site data) — then nothing persists.
export const collapsedKey = (userId) => `pw.gchat.collapsed.${userId || 'anon'}`;

export function readCollapsed(storage, userId) {
  try {
    const parsed = JSON.parse(storage?.getItem(collapsedKey(userId)) || '{}');
    return Object.fromEntries(SECTIONS.map(({ key }) => [key, parsed?.[key] === true]));
  } catch {
    return {};
  }
}

export function writeCollapsed(storage, userId, state) {
  try {
    storage?.setItem(collapsedKey(userId), JSON.stringify(Object.fromEntries(SECTIONS.map(({ key }) => [key, Boolean(state?.[key])]))));
    return true;
  } catch {
    return false;
  }
}

// Space / DM / group avatar: what the tile shows.
export function avatarKind(space, person) {
  if (space?.isBotDm || person?.type === 'BOT') return 'bot';
  if (space?.partnerDeleted && !space?.alias && !space?.partnerNameRecovered) return 'deleted';
  if (space?.spaceType === 'SPACE') return 'space';
  if (space?.spaceType === 'GROUP_CHAT') return 'group';
  return 'person';
}

// Tabs a conversation shows: named spaces get Chat | File | Tugas.
export function spaceTabs(space) {
  return space?.spaceType === 'SPACE' && !space.isBotDm ? ['chat', 'files', 'tasks'] : ['chat'];
}

export function spaceTypeLabel(space) {
  if (!space) return '';
  if (space.isBotDm) return 'Aplikasi';
  if (space.spaceType === 'DIRECT_MESSAGE') {
    if (space.alias && space.partnerDeleted) return 'Akun Google dihapus · nama dari Anda';
    if (space.partnerDeleted) return 'Akun Google dihapus';
    return space.alias ? 'Pesan langsung · nama dari Anda' : 'Pesan langsung';
  }
  if (space.spaceType === 'GROUP_CHAT') return 'Grup chat';
  const count = space.membershipCount;
  return count ? `Space · ${count} anggota` : 'Space';
}

// ------------------------------------------------------------------ dates

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dayLabel(date, now = new Date()) {
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(dateLocale(), opts);
}

export function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

// Short "last active" stamp for the list: time today, "Kemarin", else a date.
export function formatLastActive(iso, now = new Date()) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const label = dayLabel(date, now);
  if (label === 'Hari ini') return formatTime(iso);
  if (label === 'Kemarin') return label;
  const opts = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(dateLocale(), opts);
}

// ------------------------------------------------------------------ messages

const GROUP_GAP_MS = 5 * 60 * 1000;

// Unique by name, oldest first. Incoming wins (edits, server copy of an
// optimistic message).
export function mergeMessages(current, incoming) {
  const byName = new Map();
  for (const message of current || []) byName.set(message.name, message);
  for (const message of incoming || []) byName.set(message.name, message);
  return [...byName.values()].sort((a, b) => String(a.createTime || '').localeCompare(String(b.createTime || '')));
}

// [{ key, label, items: [{ message, showHeader }] }] — a header (avatar, name)
// only when the sender changes or 5 minutes passed, like Google Chat.
export function groupMessagesByDay(messages, now = new Date()) {
  const groups = [];
  let current = null;
  let previous = null;
  for (const message of messages || []) {
    const date = new Date(message.createTime || 0);
    const key = dayKey(date);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(date, now), items: [] };
      groups.push(current);
      previous = null;
    }
    const senderKey = message.sender?.name || message.sender?.displayName || '';
    const showHeader = !previous
      || (previous.sender?.name || previous.sender?.displayName || '') !== senderKey
      || date - new Date(previous.createTime || 0) > GROUP_GAP_MS;
    current.items.push({ message, showHeader });
    previous = message;
  }
  return groups;
}

// ------------------------------------------------------------------ text

// Only http(s)/mailto links are ever rendered as <a>.
export function safeHref(url) {
  const value = String(url || '').trim();
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

// <users/123> mention tokens, <https://x|label>, <https://x> (Chat markup)
// and bare http(s) URLs.
const TOKEN_RE = /<(users\/(?:\d{1,40}|all))>|<((?:https?:\/\/|mailto:)[^|>\s]+)(?:\|([^>\n]+))?>|https?:\/\/[^\s<>]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?'"\])}]+$/;

function linkify(text, mentions) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    if (match[1]) {
      const user = match[1];
      const name = user === 'users/all' ? 'all' : mentions?.[user];
      if (!name) continue; // an unknown token stays literal text
      if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) });
      out.push({ type: 'mention', user, value: `@${name}` });
      last = match.index + match[0].length;
      continue;
    }
    let raw = match[2] || match[0];
    const label = match[3] || null;
    let end = match.index + match[0].length;
    if (!match[2]) {
      const trail = raw.match(TRAILING_PUNCT_RE)?.[0] || '';
      // Keep a closing ")" that belongs to the URL, e.g. wiki links.
      const keep = trail.startsWith(')') && raw.slice(0, -trail.length).includes('(') ? 1 : 0;
      const cut = trail.length - keep;
      if (cut > 0) { raw = raw.slice(0, -cut); end -= cut; }
    }
    const href = safeHref(raw);
    if (!href) continue;
    if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) });
    out.push({ type: 'link', href, value: label || raw });
    last = end;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

const STYLES = { '*': 'bold', _: 'italic', '~': 'strike' };
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch) => ch === undefined || /\s/.test(ch);

function findClose(text, open, marker) {
  for (let j = open + 2; j < text.length; j += 1) {
    const ch = text[j];
    if (ch === '\n') return -1;
    if (ch === marker && !isSpace(text[j - 1]) && !isWordChar(text[j + 1])) return j;
  }
  return -1;
}

function parseInline(text, depth, mentions) {
  const out = [];
  let buffer = '';
  const flush = () => { if (buffer) { out.push(...linkify(buffer, mentions)); buffer = ''; } };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1 && !text.slice(i + 1, end).includes('\n')) {
        flush();
        out.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Inside a URL a marker is just a character — let linkify keep the URL whole.
    const inUrl = /(?:https?:\/\/|mailto:)\S*$/i.test(buffer);
    if (STYLES[ch] && depth < 3 && !inUrl && !isWordChar(text[i - 1]) && !isSpace(text[i + 1]) && text[i + 1] !== ch) {
      const end = findClose(text, i, ch);
      if (end > -1) {
        flush();
        out.push({ type: STYLES[ch], children: parseInline(text.slice(i + 1, end), depth + 1, mentions) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

// "* item" / "- item" at the start of a line is a Chat bulleted list item.
const bullets = (text) => text.replace(/(^|\n)[*-] (?=\S)/g, '$1• ');

// Google Chat formatting → a small node tree the page renders as React
// elements (never as HTML): text, link, mention, bold, italic, strike, code,
// codeblock. `mentions` maps users/{id} → display name.
export function parseChatText(text, mentions = {}) {
  const source = String(text || '');
  const out = [];
  let last = 0;
  for (const match of source.matchAll(/```\n?([\s\S]*?)```/g)) {
    if (match.index > last) out.push(...parseInline(bullets(source.slice(last, match.index)), 0, mentions));
    out.push({ type: 'codeblock', value: match[1].replace(/\n$/, '') });
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push(...parseInline(bullets(source.slice(last)), 0, mentions));
  return out;
}

// Plain text for search / previews: tokens → "@Name", markup kept as typed.
export function plainText(text, mentions = {}) {
  return String(text || '').replace(/<(users\/(?:\d{1,40}|all))>/g, (token, user) => {
    const name = user === 'users/all' ? 'all' : mentions[user];
    return name ? `@${name}` : token;
  });
}

// ------------------------------------------------------------------ mentions (composer)

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The composer shows "@Budi Santoso"; Chat needs "<users/123>". `picked` is the
// list of people chosen from the autocomplete: [{ user, name }].
export function encodeMentions(text, picked = []) {
  let out = String(text || '');
  const unique = [...new Map(picked.filter((p) => /^users\/\d{1,40}$/.test(p.user || '') && p.name).map((p) => [p.name, p])).values()]
    .sort((a, b) => b.name.length - a.name.length);
  for (const person of unique) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRe(person.name)}(?![\\p{L}\\p{N}_])`, 'gu');
    out = out.replace(re, (m, before) => `${before}<${person.user}>`);
  }
  return out;
}

// For editing a sent message: tokens back to "@Name" + the picked list.
export function decodeMentions(text, mentions = {}) {
  const picked = [];
  const out = String(text || '').replace(/<(users\/\d{1,40})>/g, (token, user) => {
    const name = mentions[user];
    if (!name) return token;
    picked.push({ user, name });
    return `@${name}`;
  });
  return { text: out, picked };
}

// The "@que" being typed right before the caret, if any.
export function mentionQuery(text, caret) {
  const before = String(text || '').slice(0, caret);
  const match = before.match(/(^|\s)@([\p{L}\p{N}._-]{0,30})$/u);
  if (!match) return null;
  return { query: match[2], start: before.length - match[2].length - 1 };
}

export function mentionCandidates(members, query, limit = 6) {
  const q = String(query || '').toLocaleLowerCase('id-ID');
  return (members || [])
    .filter((m) => !m.isMe && m.type !== 'BOT' && /^users\/\d{1,40}$/.test(m.user || ''))
    .filter((m) => !q || String(m.displayName || '').toLocaleLowerCase('id-ID').split(/\s+/).some((w) => w.startsWith(q))
      || String(m.email || '').toLowerCase().startsWith(q))
    .slice(0, limit);
}

export function insertMention(text, query, member) {
  const before = text.slice(0, query.start);
  const after = text.slice(query.start + 1 + query.query.length);
  const inserted = `@${member.displayName} `;
  return { text: `${before}${inserted}${after.replace(/^ /, '')}`, caret: before.length + inserted.length };
}

// ------------------------------------------------------------------ formatting toolbar

const WRAPS = { bold: '*', italic: '_', strike: '~', code: '`' };

// Wraps the selection (or inserts an empty pair) with Chat markdown and
// returns the new text + selection.
export function applyFormat(text, start, end, kind) {
  const value = String(text || '');
  const selected = value.slice(start, end);
  if (WRAPS[kind]) {
    const mark = WRAPS[kind];
    const next = `${value.slice(0, start)}${mark}${selected}${mark}${value.slice(end)}`;
    return { text: next, start: start + 1, end: end + 1 };
  }
  if (kind === 'codeblock') {
    const open = '```\n';
    const next = `${value.slice(0, start)}${open}${selected}\n\`\`\`${value.slice(end)}`;
    return { text: next, start: start + open.length, end: end + open.length };
  }
  if (kind === 'list') {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end);
    const listed = block.split('\n').map((line) => (/^[*-] /.test(line) ? line : `* ${line}`)).join('\n');
    const next = `${value.slice(0, lineStart)}${listed}${value.slice(end)}`;
    return { text: next, start: lineStart + listed.length, end: lineStart + listed.length };
  }
  return { text: value, start, end };
}

// ------------------------------------------------------------------ reactions

export const REACTION_EMOJI = [
  { emoji: '👍', label: 'Jempol' }, { emoji: '❤️', label: 'Hati' }, { emoji: '😂', label: 'Tertawa' },
  { emoji: '😮', label: 'Kaget' }, { emoji: '😢', label: 'Sedih' }, { emoji: '🙏', label: 'Terima kasih' },
  { emoji: '🎉', label: 'Perayaan' }, { emoji: '🔥', label: 'Api' }, { emoji: '👏', label: 'Tepuk tangan' },
  { emoji: '✅', label: 'Selesai' }, { emoji: '👀', label: 'Melihat' }, { emoji: '💯', label: 'Seratus' },
  { emoji: '😊', label: 'Senyum' }, { emoji: '🤔', label: 'Berpikir' }, { emoji: '🙌', label: 'Hore' },
  { emoji: '👌', label: 'Oke' },
];

// Server counts + what this user toggled in this session → chips.
// `mine` maps emoji → true/false (known state) for this message.
export function summarizeReactions(reactions, mine = {}) {
  const byEmoji = new Map();
  for (const r of reactions || []) {
    if (!r?.emoji) continue;
    byEmoji.set(r.emoji, (byEmoji.get(r.emoji) || 0) + Math.max(0, Number(r.count) || 0));
  }
  for (const [emoji, state] of Object.entries(mine)) {
    if (state === true && !byEmoji.has(emoji)) byEmoji.set(emoji, 1);
  }
  return [...byEmoji.entries()]
    .map(([emoji, count]) => ({ emoji, count, mine: mine[emoji] === true }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

// Local count update after a toggle succeeded.
export function applyReactionToggle(reactions, emoji, reacted) {
  const list = (reactions || []).map((r) => ({ ...r }));
  const found = list.find((r) => r.emoji === emoji);
  if (found) found.count = Math.max(0, found.count + (reacted ? 1 : -1));
  else if (reacted) list.push({ emoji, count: 1 });
  return list.filter((r) => r.count > 0);
}

// ------------------------------------------------------------------ threads, search, unread

// Google Chat shows a thread's first message in the timeline with a
// "N balasan" link; replies live in the thread panel. A reply whose root is
// not loaded (older page) stays visible in the timeline.
export function threadView(messages) {
  const roots = new Set();
  for (const m of messages || []) if (m.threadName && !m.threadReply) roots.add(m.threadName);
  const replies = new Map();
  const main = [];
  for (const m of messages || []) {
    if (m.threadReply && m.threadName && roots.has(m.threadName)) {
      replies.set(m.threadName, [...(replies.get(m.threadName) || []), m]);
    } else main.push(m);
  }
  return { main, replies };
}

export function searchMessages(messages, query) {
  const q = String(query || '').trim().toLocaleLowerCase('id-ID');
  if (!q) return messages || [];
  return (messages || []).filter((m) => plainText(m.text, m.mentions).toLocaleLowerCase('id-ID').includes(q)
    || String(m.sender?.displayName || '').toLocaleLowerCase('id-ID').includes(q)
    || (m.attachments || []).some((a) => String(a.title || '').toLocaleLowerCase('id-ID').includes(q)));
}

export function isUnread(space, lastReadTime) {
  if (!space?.lastActiveTime || !lastReadTime) return false;
  return Date.parse(space.lastActiveTime) > Date.parse(lastReadTime) + 1000;
}

// ------------------------------------------------------------------ uploads

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const UPLOAD_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.mp4,.mp3';

export function uploadProblem(file) {
  if (!file) return 'Pilih file terlebih dahulu';
  if (file.size > MAX_UPLOAD_BYTES) return 'Ukuran file maksimal 25 MB';
  const ext = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
  if (!UPLOAD_ACCEPT.split(',').includes(ext)) return 'Tipe file ini tidak dapat dikirim lewat Chat';
  return null;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}


// ------------------------------------------------------------------ Drive files

const DRIVE_ID = '([A-Za-z0-9_-]{10,200})';
const DRIVE_URL_RE = new RegExp(
  'https://(?:docs\\.google\\.com/(document|spreadsheets|presentation|forms|drawings)/(?:u/\\d+/)?d/' + DRIVE_ID
  + '|drive\\.google\\.com/(?:file/(?:u/\\d+/)?d/' + DRIVE_ID + '|open\\?id=' + DRIVE_ID
  + '|drive/(?:u/\\d+/)?folders/' + DRIVE_ID + '))',
  'g',
);
const PATH_MIME = {
  document: 'application/vnd.google-apps.document',
  spreadsheets: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  forms: 'application/vnd.google-apps.form',
  drawings: 'application/vnd.google-apps.drawing',
};
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
export const isDriveFileId = (value) => typeof value === 'string' && DRIVE_FILE_ID_RE.test(value);

// Docs / Sheets / Slides / Drive links typed or pasted in a message.
export function driveLinksInText(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(DRIVE_URL_RE)) {
    const fileId = match[2] || match[3] || match[4] || match[5];
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    out.push({ fileId, mimeType: match[1] ? PATH_MIME[match[1]] : (match[5] ? FOLDER_MIME : null) });
  }
  return out;
}

const OFFICE_KIND = {
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
  'application/vnd.oasis.opendocument.presentation': 'presentation',
};

// document | spreadsheet | presentation | form | pdf | image | video | audio | folder | file
export function driveKind(mimeType) {
  const mime = String(mimeType || '');
  if (mime === 'application/vnd.google-apps.document') return 'document';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet';
  if (mime === 'application/vnd.google-apps.presentation') return 'presentation';
  if (mime === 'application/vnd.google-apps.form') return 'form';
  if (mime === FOLDER_MIME) return 'folder';
  if (mime === 'application/pdf') return 'pdf';
  if (OFFICE_KIND[mime]) return OFFICE_KIND[mime];
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// Native Google files open in Prakasa's own Docs / Sheets / Slides pages.
const IN_APP = {
  'application/vnd.google-apps.document': 'docs',
  'application/vnd.google-apps.spreadsheet': 'sheets',
  'application/vnd.google-apps.presentation': 'slides',
};
export function inAppPath(fileId, mimeType) {
  const base = IN_APP[mimeType];
  return base && isDriveFileId(fileId) ? `/${base}/${fileId}` : null;
}

export const driveOpenUrl = (fileId) => (isDriveFileId(fileId) ? `https://drive.google.com/open?id=${fileId}` : null);

// Every Drive file a message refers to: Drive attachments, Chat's smart-chip
// annotations and links in the text — once each.
export function driveFilesOfMessage(message) {
  const byId = new Map();
  const add = (fileId, mimeType, title) => {
    if (!isDriveFileId(fileId)) return;
    const known = byId.get(fileId);
    if (known) {
      if (!known.mimeType && mimeType) known.mimeType = mimeType;
      if (!known.title && title) known.title = title;
      return;
    }
    byId.set(fileId, { fileId, mimeType: mimeType || null, title: title || null });
  };
  for (const a of message?.attachments || []) if (a.driveFileId) add(a.driveFileId, a.contentType, a.title);
  for (const link of message?.driveLinks || []) add(link.fileId, link.mimeType, null);
  for (const link of driveLinksInText(message?.text)) add(link.fileId, link.mimeType, null);
  return [...byId.values()];
}

// Files tab: every upload and Drive file in the loaded messages, newest first.
export function messageFiles(messages) {
  const items = [];
  for (const message of messages || []) {
    if (message.deleted || message.pending) continue;
    for (const a of message.attachments || []) {
      if (a.driveFileId) continue;
      items.push({
        key: `${message.name}#${a.index}`, type: 'upload', title: a.title || 'Lampiran', mimeType: a.contentType || null,
        index: a.index, downloadable: Boolean(a.downloadable), url: a.url || null, message,
      });
    }
    for (const file of driveFilesOfMessage(message)) {
      items.push({ key: `${message.name}@${file.fileId}`, type: 'drive', fileId: file.fileId, title: file.title, mimeType: file.mimeType, message });
    }
  }
  return items.sort((a, b) => String(b.message.createTime || '').localeCompare(String(a.message.createTime || '')));
}

export const FILE_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'document', label: 'Dokumen' },
  { key: 'spreadsheet', label: 'Spreadsheet' },
  { key: 'presentation', label: 'Presentasi' },
  { key: 'pdf', label: 'PDF' },
  { key: 'image', label: 'Gambar' },
  { key: 'other', label: 'Lainnya' },
];
const FILTERED_KINDS = new Set(['document', 'spreadsheet', 'presentation', 'pdf', 'image']);

// meta: fileId → { name, mimeType } learned from Drive (names of linked files).
export function fileTitle(item, meta = {}) {
  return item.title || meta[item.fileId]?.name || (item.type === 'drive' ? 'File Google Drive' : 'Lampiran');
}

export function filterFiles(items, { query = '', kind = 'all' } = {}, meta = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('id-ID');
  return (items || []).filter((item) => {
    const k = driveKind(item.mimeType || meta[item.fileId]?.mimeType);
    if (kind !== 'all' && (kind === 'other' ? FILTERED_KINDS.has(k) : k !== kind)) return false;
    if (!q) return true;
    return fileTitle(item, meta).toLocaleLowerCase('id-ID').includes(q)
      || String(item.message?.sender?.displayName || '').toLocaleLowerCase('id-ID').includes(q);
  });
}

// Chosen Drive files → the message text: whatever was typed, then one link
// per line (Chat turns each into a Drive smart chip).
export function buildDriveMessage(text, files) {
  const links = (files || []).map((f) => f.webViewLink || driveOpenUrl(f.id)).filter(Boolean);
  const typed = String(text || '').replace(/\s+$/, '');
  return [typed, ...links].filter(Boolean).join('\n');
}

// Decision needed before sending: who can't open what, and what we may share.
export function accessSummary(check) {
  const files = check?.files || [];
  const lacking = files.filter((f) => f.missing?.length);
  const shareable = lacking.filter((f) => f.canShare);
  const people = new Set(lacking.flatMap((f) => f.missing));
  return {
    needsDecision: lacking.length > 0,
    shareable,
    blocked: lacking.filter((f) => !f.canShare),
    people: people.size,
    unchecked: files.filter((f) => f.accessible && !f.canCheck).length,
  };
}

// ------------------------------------------------------------------ message links

const MESSAGE_ID_RE = /^[A-Za-z0-9_.-]{1,256}$/;
export const isValidMessageId = (value) => typeof value === 'string' && MESSAGE_ID_RE.test(value);
export const messageIdOf = (name) => String(name || '').split('/messages/')[1] || null;

export function messageLink(origin, spaceId, messageName) {
  const id = messageIdOf(messageName);
  if (!isValidSpaceId(spaceId) || !isValidMessageId(id)) return null;
  return `${String(origin || '').replace(/\/$/, '')}/chat?space=${spaceId}&message=${encodeURIComponent(id)}`;
}
