const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');
const pool = require('../db/pool');
const logger = require('../utils/logger');
const googleDirectory = require('./googleDirectory.service');
const googleUserClient = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');
const googlePeople = require('./googlePeople.service');

// Google Chat used from inside Prakasa Workspace: every call impersonates the
// signed-in user (subject = req.user.email) through domain-wide delegation, so
// a user only ever sees the spaces, DMs and messages their own Google Chat
// shows them. (googleChat.service.js is the Task Board's own Space plumbing —
// kept separate on purpose.)

const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.memberships',
];
const DIRECTORY_SCOPES = ['https://www.googleapis.com/auth/admin.directory.user.readonly'];
// Optional scopes live in their OWN clients: asking for a scope that isn't
// authorized in Admin Console fails the whole token request (unauthorized_client),
// which must not take the core Chat features down with it.
const READSTATE_SCOPES = ['https://www.googleapis.com/auth/chat.users.readstate'];
const SPACE_SETTINGS_SCOPES = ['https://www.googleapis.com/auth/chat.users.spacesettings'];
const DELETE_SPACE_SCOPES = ['https://www.googleapis.com/auth/chat.delete'];
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// Attach-from-Drive acts on the user's own Drive (same grant My Drive / Docs use).
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

// Chat attachments: a narrower whitelist than document uploads — no HTML, SVG,
// XML, scripts or archives; the MIME type and the extension must both match.
// Used by the upload route and when an uploaded attachment is forwarded.
const CHAT_UPLOAD_TYPES = Object.freeze({
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'image/gif': /\.gif$/i,
  'image/webp': /\.webp$/i,
  'application/pdf': /\.pdf$/i,
  'application/msword': /\.doc$/i,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': /\.docx$/i,
  'application/vnd.ms-excel': /\.xls$/i,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': /\.xlsx$/i,
  'application/vnd.ms-powerpoint': /\.ppt$/i,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': /\.pptx$/i,
  'application/vnd.oasis.opendocument.text': /\.odt$/i,
  'application/vnd.oasis.opendocument.spreadsheet': /\.ods$/i,
  'application/vnd.oasis.opendocument.presentation': /\.odp$/i,
  'text/plain': /\.txt$/i,
  'text/csv': /\.csv$/i,
  'video/mp4': /\.mp4$/i,
  'audio/mpeg': /\.mp3$/i,
});
const CHAT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const MAX_TEXT_LENGTH = 4096;
const SPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SPACE_NAME_RE = /^spaces\/[A-Za-z0-9_-]{1,128}$/;
const THREAD_NAME_RE = /^spaces\/[A-Za-z0-9_-]{1,128}\/threads\/[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_NAME_RE = /^spaces\/[A-Za-z0-9_-]{1,128}\/messages\/[A-Za-z0-9_.-]{1,256}$/;
const MEMBERSHIP_NAME_RE = /^spaces\/[A-Za-z0-9_-]{1,128}\/members\/[A-Za-z0-9_-]{1,128}$/;
const USER_NAME_RE = /^users\/[0-9]{1,40}$/;
const MENTION_USER_RE = /^users\/(?:[0-9]{1,40}|all)$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_DISPLAY_NAME = 128;
const MAX_DESCRIPTION = 150;
const MAX_GUIDELINES = 5000;
const MAX_MEMBERS_PER_REQUEST = 20;
// The reaction picker offers exactly these; nothing else is sent to Google.
const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥', '👏', '✅', '👀', '💯', '😊', '🤔', '🙌', '👌'];
// Google's page tokens are opaque base64-ish strings — whitelist that alphabet.
const PAGE_TOKEN_RE = /^[A-Za-z0-9_\-=.+/]{1,1024}$/;
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

const isSpaceId = (value) => typeof value === 'string' && SPACE_ID_RE.test(value);
const isSpaceName = (value) => typeof value === 'string' && SPACE_NAME_RE.test(value);
const isThreadName = (value) => typeof value === 'string' && THREAD_NAME_RE.test(value);
const isMessageName = (value) => typeof value === 'string' && MESSAGE_NAME_RE.test(value);
const isMembershipName = (value) => typeof value === 'string' && MEMBERSHIP_NAME_RE.test(value);
const isReactionEmoji = (value) => typeof value === 'string' && REACTION_EMOJI.includes(value);
const isTimestamp = (value) => typeof value === 'string' && RFC3339_RE.test(value) && !Number.isNaN(Date.parse(value));

// Only people in the company's own Workspace domain(s) can be added / DM'd.
function isAllowedEmail(value) {
  if (typeof value !== 'string' || !EMAIL_RE.test(value)) return false;
  const domains = String(process.env.GOOGLE_ALLOWED_DOMAIN || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  return !domains.length || domains.includes(value.split('@')[1].toLowerCase());
}

const isScopeError = (error) => /unauthorized_client|not authorized for any of the scopes/i.test(
  String(error?.response?.data?.error_description || error?.response?.data?.error || error?.message || '')
);

// A user-facing refusal decided by us (not by Google): controller → 403/400.
function appError(code, message, status = 403) {
  const error = new Error(message);
  error.appCode = code;
  error.appStatus = status;
  return error;
}

// undefined → no token; null → invalid token (caller answers 400).
function parsePageToken(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && PAGE_TOKEN_RE.test(value) ? value : null;
}

function clampPageSize(value, { fallback, max }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function chatClient(subject, scopes = CHAT_SCOPES) {
  return google.chat({ version: 'v1', auth: googleUserClient.userAuth(subject, scopes) });
}

const wrap = (ctx, operation, requestMeta, fn, responseMeta) => integrationLog.wrap({
  entityId: ctx.entityId || null,
  userId: ctx.userId || null,
  provider: 'google_chat_user',
  operation,
  requestMeta,
  responseMeta: responseMeta || null,
}, fn);

const lower = (value) => String(value || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// People: Chat usually returns displayName + email on members and senders.
// When it doesn't, resolve users/{id} → our users table (google_sub is the same
// Google account id), then the Workspace directory (read-only, admin-delegated).
// Names of domain colleagues aren't private per-user data, so one shared cache.
// ---------------------------------------------------------------------------
const PERSON_TTL_MS = 60 * 60 * 1000;
const myUserNameCache = new Map(); // subject → 'users/123' (the caller's own Chat user)
const personCache = new Map(); // 'users/123' → { value, expires }

function cachedPerson(userName) {
  const hit = personCache.get(userName);
  if (hit && hit.expires > Date.now()) return hit;
  return null;
}

async function lookupDirectoryUser(userName) {
  if (!process.env.GOOGLE_ADMIN_DELEGATED_USER) return null;
  try {
    const admin = google.admin({
      version: 'directory_v1',
      auth: googleUserClient.userAuth(process.env.GOOGLE_ADMIN_DELEGATED_USER, DIRECTORY_SCOPES),
    });
    const { data } = await admin.users.get({
      userKey: userName.slice('users/'.length),
      viewType: 'domain_public',
      fields: 'primaryEmail,name/fullName',
    });
    return data?.primaryEmail ? { displayName: data.name?.fullName || data.primaryEmail, email: data.primaryEmail } : null;
  } catch {
    return null; // external account / deleted user — shown with a generic label
  }
}

async function resolvePeople(userNames, ctx = {}) {
  const wanted = [...new Set(userNames.filter((name) => USER_NAME_RE.test(name || '')))];
  const result = new Map();
  const missing = [];
  for (const name of wanted) {
    const hit = cachedPerson(name);
    if (hit) { if (hit.value) result.set(name, hit.value); } else missing.push(name);
  }
  if (!missing.length) return result;

  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat_user',
    operation: 'resolvePeople',
    requestMeta: { count: missing.length },
    responseMeta: () => ({ resolved: result.size }),
  }, async () => {
    const ids = missing.map((name) => name.slice('users/'.length));
    // Removed Prakasa accounts still carry the person's real name.
    const [rows] = await pool.query(
      'SELECT name, email, google_sub FROM users WHERE google_sub IN (?)',
      [ids]
    );
    const fromTable = new Map((rows || []).map((row) => [`users/${row.google_sub}`, { displayName: row.name, email: row.email }]));
    const archived = await googlePeople.lookup(ids).catch(() => new Map());
    const stillMissing = [];
    for (const name of missing) {
      const id = name.slice('users/'.length);
      const saved = archived.get(id);
      const archivedName = saved?.name || nameFromEmail(saved?.email);
      const value = fromTable.get(name)
        || (archivedName ? { displayName: archivedName, email: saved.email, isDeleted: saved.isDeleted } : null);
      if (value) {
        result.set(name, value);
        personCache.set(name, { value, expires: Date.now() + PERSON_TTL_MS });
      } else stillMissing.push(name);
    }
    await mapLimit(stillMissing.slice(0, 40), 6, async (name) => {
      const value = await lookupDirectoryUser(name);
      personCache.set(name, { value, expires: Date.now() + PERSON_TTL_MS });
      if (value) {
        result.set(name, value);
        googlePeople.upsert([{ googleId: name.slice('users/'.length), email: value.email, name: value.displayName }]).catch(() => {});
      }
    });
    return result;
  });
}

// Google keeps a deleted account's email but not always its name:
// "yuliet.sari@…" → "Yuliet Sari" is still far better than "Pengguna dihapus".
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/[0-9]+$/, '');
  const words = local.split(/[._-]+/).filter(Boolean);
  if (!words.length) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
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

// A person as the UI needs it: never the raw Chat user object.
function personFrom(member, people, subject) {
  const known = people?.get(member?.name) || null;
  const email = member?.email || known?.email || null;
  const displayName = member?.displayName || known?.displayName || null;
  // Match the caller by Google account id first: the same person can have
  // several Prakasa accounts/emails, so an email-only check can mistake the
  // caller for "the other person" and label a DM with their own name.
  const myName = myUserNameCache.get(lower(subject));
  const isMe = Boolean((myName && member?.name === myName) || (email && lower(email) === lower(subject)));
  return {
    name: USER_NAME_RE.test(member?.name || '') ? member.name : null,
    displayName,
    type: member?.type === 'BOT' ? 'BOT' : 'HUMAN',
    isMe,
    accountDeleted: !isMe && Boolean(known?.isDeleted || member?.isAnonymous),
    // Google anonymises deleted accounts; no name could be recovered for it.
    isDeleted: !isMe && !displayName && (Boolean(member?.isAnonymous) || Boolean(known?.isDeleted)),
  };
}

// The caller's own Chat user name ('users/<google id>'), from our users table
// or the directory — cached per subject for the whole process.
async function ensureMe(subject) {
  const key = lower(subject);
  if (myUserNameCache.get(key)) return myUserNameCache.get(key);
  let id = null;
  try {
    const [rows] = await pool.query('SELECT google_sub FROM users WHERE LOWER(email) = ? AND google_sub IS NOT NULL LIMIT 1', [key]);
    id = rows?.[0]?.google_sub || null;
  } catch { /* fall through to the directory */ }
  if (!id && process.env.GOOGLE_ADMIN_DELEGATED_USER) {
    try {
      const admin = google.admin({
        version: 'directory_v1',
        auth: googleUserClient.userAuth(process.env.GOOGLE_ADMIN_DELEGATED_USER, DIRECTORY_SCOPES),
      });
      const { data } = await admin.users.get({ userKey: key, fields: 'id' });
      id = data?.id || null;
    } catch { /* unknown — email matching still applies */ }
  }
  if (id && USER_NAME_RE.test(`users/${id}`)) myUserNameCache.set(key, `users/${id}`);
  return myUserNameCache.get(key) || null;
}

// Private per-user labels for conversations (e.g. a DM whose partner was deleted).
async function aliasesFor(userId, spaceNames) {
  if (!userId || !spaceNames.length) return new Map();
  const [rows] = await pool.query(
    'SELECT space_name, alias FROM chat_space_aliases WHERE user_id = ? AND space_name IN (?)',
    [userId, spaceNames]
  );
  return new Map((rows || []).map((r) => [r.space_name, r.alias]));
}

async function setAlias(userId, spaceName, alias) {
  if (!alias) {
    await pool.query('DELETE FROM chat_space_aliases WHERE user_id = ? AND space_name = ?', [userId, spaceName]);
    return { spaceName, alias: null };
  }
  await pool.query(
    `INSERT INTO chat_space_aliases (user_id, space_name, alias) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE alias = VALUES(alias)`,
    [userId, spaceName, alias]
  );
  return { spaceName, alias };
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------
const MEMBERS_TTL_MS = 30 * 60 * 1000;
const membersCache = new Map(); // `${subject}|${space}` → { members, expires }

const membersInFlight = new Map(); // same key → pending promise (no duplicate calls)

function listMembers(chat, subject, spaceName) {
  const key = `${lower(subject)}|${spaceName}`;
  const hit = membersCache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.members);
  if (membersInFlight.has(key)) return membersInFlight.get(key);
  const request = chat.spaces.members.list({ parent: spaceName, pageSize: 20 }, { timeout: 15000 })
    .then(({ data }) => {
      const members = (data.memberships || []).map((m) => m.member).filter(Boolean);
      membersCache.set(key, { members, expires: Date.now() + MEMBERS_TTL_MS });
      return members;
    })
    .finally(() => membersInFlight.delete(key));
  membersInFlight.set(key, request);
  return request;
}

const needsMemberName = (space) => space.spaceType === 'DIRECT_MESSAGE' || (space.spaceType === 'GROUP_CHAT' && !space.displayName);

function normalizeSpace(space, members, people, subject) {
  let displayName = space.displayName || null;
  let partnerDeleted = false;
  let partnerNameRecovered = false;
  if (!displayName && members) {
    const others = members
      .map((member) => personFrom(member, people, subject))
      .filter((person) => !person.isMe && person.displayName);
    if (space.spaceType === 'DIRECT_MESSAGE') {
      displayName = others[0]?.displayName || null;
      // The name was recovered from our archive but the Google account is gone.
      if (displayName && others[0].accountDeleted) { partnerDeleted = true; partnerNameRecovered = true; }
    }
    else if (others.length) displayName = others.slice(0, 3).map((p) => p.displayName).join(', ') + (others.length > 3 ? ', …' : '');
  }
  if (!displayName) {
    // With user auth Chat doesn't reveal an app's name. A DM whose partner's
    // Google account was deleted lists them anonymised (or not at all) and no
    // name could be recovered — say so instead of a misleading label.
    if (space.singleUserBotDm) displayName = 'Aplikasi Chat';
    else if (space.spaceType === 'DIRECT_MESSAGE' && members) { displayName = 'Pengguna dihapus'; partnerDeleted = true; }
    else displayName = space.spaceType === 'SPACE' ? 'Ruang tanpa nama' : space.spaceType === 'GROUP_CHAT' ? 'Grup chat' : 'Pesan langsung';
  }
  return {
    name: space.name,
    displayName,
    spaceType: ['SPACE', 'GROUP_CHAT', 'DIRECT_MESSAGE'].includes(space.spaceType) ? space.spaceType : 'SPACE',
    lastActiveTime: space.lastActiveTime || null,
    membershipCount: space.membershipCount?.joinedDirectHumanUserCount ?? null,
    isBotDm: Boolean(space.singleUserBotDm),
    partnerDeleted,
    partnerNameRecovered,
    threaded: space.spaceThreadingState === 'THREADED_MESSAGES',
    historyOff: space.spaceHistoryState === 'HISTORY_OFF',
    description: typeof space.spaceDetails?.description === 'string' ? space.spaceDetails.description : '',
    guidelines: typeof space.spaceDetails?.guidelines === 'string' ? space.spaceDetails.guidelines : '',
    permissionSettings: normalizePermissionSettings(space.permissionSettings),
  };
}

// Who may do what in a named space. Only the keys Chat lets a manager change
// (plus postMessages, which the API reports but does not let anyone change).
const PERMISSION_KEYS = ['manageMembersAndGroups', 'modifySpaceDetails', 'toggleHistory', 'useAtMentionAll', 'replyMessages'];
const READONLY_PERMISSION_KEYS = ['postMessages'];

function normalizePermissionSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const out = {};
  for (const key of [...PERMISSION_KEYS, ...READONLY_PERMISSION_KEYS]) {
    const value = settings[key];
    if (value && typeof value === 'object') {
      out[key] = { managersAllowed: Boolean(value.managersAllowed), membersAllowed: Boolean(value.membersAllowed) };
    }
  }
  return Object.keys(out).length ? out : null;
}

// Members of DMs are fetched in parallel, but Chat's latency per call varies a
// lot (0.5s–10s+). The list answers within NAME_BUDGET_MS; spaces whose names
// are still loading come back with namePending, the calls keep filling the
// cache, and the client simply asks again a moment later.
const NAME_BUDGET_MS = 1500;
const MEMBER_CONCURRENCY = 16;

function limiter(concurrency) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < concurrency && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active -= 1; pump(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

async function withNames(chat, subject, spaces, ctx, { budgetMs = NAME_BUDGET_MS } = {}) {
  await ensureMe(subject);
  googlePeople.ensureFresh();
  const run = limiter(MEMBER_CONCURRENCY);
  const state = spaces.map(() => ({ done: true, members: null }));
  const pending = spaces.map((space, i) => {
    if (!needsMemberName(space)) return null;
    state[i].done = false;
    return run(() => listMembers(chat, subject, space.name))
      .catch(() => null)
      .then((members) => { state[i] = { done: true, members }; });
  }).filter(Boolean);
  if (pending.length) {
    let timer;
    const all = Promise.all(pending);
    await (budgetMs == null ? all : Promise.race([all, new Promise((resolve) => { timer = setTimeout(resolve, budgetMs); })]));
    clearTimeout(timer);
  }
  const allMembers = state.flatMap((s) => s.members || []);
  // Archive every name Chat shows us, so it survives the account's deletion.
  googlePeople.upsert(allMembers
    .filter((m) => m.displayName && USER_NAME_RE.test(m.name || '') && m.type !== 'BOT')
    .map((m) => ({ googleId: m.name.slice('users/'.length), email: m.email || null, name: m.displayName })))
    .catch(() => {});
  const unnamed = allMembers.filter((m) => !m.displayName || !m.email).map((m) => m.name);
  const people = unnamed.length ? await resolvePeople(unnamed, ctx) : new Map();
  const aliases = await aliasesFor(ctx.userId, spaces.map((space) => space.name)).catch(() => new Map());
  return spaces.map((space, i) => {
    const normalized = normalizeSpace(space, state[i].members, people, subject);
    const alias = aliases.get(space.name) || null;
    return {
      ...normalized,
      ...(alias ? { displayName: alias, originalName: normalized.displayName } : {}),
      alias,
      namePending: !state[i].done,
    };
  });
}

async function listSpaces(subject, { pageSize = 100, pageToken } = {}, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat_user',
    operation: 'listSpaces',
    requestMeta: { subject, pageSize, paged: Boolean(pageToken) },
    responseMeta: (result) => ({ count: result?.spaces?.length || 0 }),
  }, async () => {
    const chat = chatClient(subject);
    const { data } = await chat.spaces.list({ pageSize, pageToken });
    const spaces = (data.spaces || []).filter((space) => isSpaceName(space.name));
    return { spaces: await withNames(chat, subject, spaces, ctx), nextPageToken: data.nextPageToken || null };
  });
}

async function getSpace(subject, spaceName, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_chat_user',
    operation: 'getSpace',
    requestMeta: { subject, spaceName },
    responseMeta: (result) => ({ spaceName: result?.name }),
  }, async () => {
    const chat = chatClient(subject);
    const { data } = await chat.spaces.get({ name: spaceName });
    const [space] = await withNames(chat, subject, [data], ctx, { budgetMs: null });
    return space;
  });
}

// ---------------------------------------------------------------------------
// Who am I in this space — Chat accepts the caller's email as a member alias.
// ---------------------------------------------------------------------------

async function myMembership(chat, subject, spaceName) {
  const { data } = await chat.spaces.members.get({ name: `${spaceName}/members/${subject}` });
  if (USER_NAME_RE.test(data?.member?.name || '')) myUserNameCache.set(lower(subject), data.member.name);
  return { membershipName: data?.name || null, userName: data?.member?.name || null, role: data?.role || 'ROLE_MEMBER' };
}

async function myUserName(chat, subject, spaceName) {
  return myUserNameCache.get(lower(subject)) || (await myMembership(chat, subject, spaceName)).userName;
}

async function requireManager(chat, subject, spaceName) {
  const me = await myMembership(chat, subject, spaceName);
  if (me.role !== 'ROLE_MANAGER') throw appError('FORBIDDEN', 'Hanya pengelola ruang yang dapat melakukan ini.');
  return me;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function attachmentUrl(attachment) {
  const driveId = attachment?.driveDataRef?.driveFileId;
  if (driveId && DRIVE_FILE_ID_RE.test(driveId)) return `https://drive.google.com/open?id=${driveId}`;
  if (attachment?.attachmentDataRef?.resourceName) return null; // served through our download proxy
  const uri = attachment?.downloadUri;
  return typeof uri === 'string' && /^https:\/\//i.test(uri) ? uri : null;
}

// Chat reports mentions as annotations over "@Name" in the text. Replace each
// with a <users/{id}> token (the same syntax used to SEND a mention) and return
// the id → name map, so the client highlights exactly the annotated ranges.
function withMentionTokens(text, annotations) {
  const mentions = {};
  const ranges = (annotations || [])
    .filter((a) => a?.type === 'USER_MENTION' && MENTION_USER_RE.test(a.userMention?.user?.name || ''))
    .map((a) => ({ start: Number(a.startIndex || 0), length: Number(a.length || 0), user: a.userMention.user }))
    .filter((r) => Number.isInteger(r.start) && r.start >= 0 && r.length > 1)
    .sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const range of ranges) {
    const end = range.start + range.length;
    if (end > lastStart || end > out.length) continue; // overlapping / out of bounds
    const segment = out.slice(range.start, end);
    if (!segment.startsWith('@')) continue;
    out = `${out.slice(0, range.start)}<${range.user.name}>${out.slice(end)}`;
    mentions[range.user.name] = range.user.name === 'users/all' ? 'all' : (range.user.displayName || segment.slice(1));
    lastStart = range.start;
  }
  return { text: out, mentions };
}

// Drive files linked in the text: Chat annotates them as RICH_LINK / DRIVE_FILE
// (that is what renders as a smart chip in Google Chat).
function driveLinksOf(annotations) {
  const seen = new Set();
  const out = [];
  for (const a of annotations || []) {
    const meta = a?.type === 'RICH_LINK' ? a.richLinkMetadata : null;
    const fileId = meta?.richLinkType === 'DRIVE_FILE' ? meta.driveLinkData?.driveDataRef?.driveFileId : null;
    if (!fileId || !DRIVE_FILE_ID_RE.test(fileId) || seen.has(fileId)) continue;
    seen.add(fileId);
    const mimeType = typeof meta.driveLinkData?.mimeType === 'string' && meta.driveLinkData.mimeType.length < 120 ? meta.driveLinkData.mimeType : null;
    out.push({ fileId, mimeType });
  }
  return out.slice(0, 20);
}

// ---------------------------------------------------------------------------
// App cards (cardsV2) → a small read-only structure: header, text paragraphs,
// labelled values and link buttons. Card text is Chat's limited HTML; it is
// flattened to plain text here, so the browser never renders app HTML.
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function cardText(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="(https:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => `${label.replace(/<[^>]*>/g, '')} (${href})`)
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m, name) => ENTITIES[name])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function cardLink(onClick) {
  const url = onClick?.openLink?.url;
  return typeof url === 'string' && /^https:\/\//i.test(url) && url.length <= 2000 ? url : null;
}

function cardWidget(widget) {
  if (!widget || typeof widget !== 'object') return null;
  if (widget.textParagraph) {
    const text = cardText(widget.textParagraph.text);
    return text ? { type: 'text', text } : null;
  }
  if (widget.decoratedText) {
    const d = widget.decoratedText;
    const text = cardText(d.text, 500);
    if (!text) return null;
    return {
      type: 'decorated',
      topLabel: cardText(d.topLabel, 200) || null,
      text,
      bottomLabel: cardText(d.bottomLabel, 200) || null,
      url: cardLink(d.onClick) || cardLink(d.button?.onClick),
    };
  }
  if (widget.buttonList) {
    // Buttons that run an app action (not a link) only work inside Google
    // Chat — they are kept with url:null and shown disabled.
    const buttons = (widget.buttonList.buttons || [])
      .filter((b) => b && (b.text || cardLink(b.onClick)))
      .map((b) => ({ text: cardText(b.text, 80) || 'Buka', url: cardLink(b.onClick) }))
      .slice(0, 6);
    return buttons.length ? { type: 'buttons', buttons } : null;
  }
  if (widget.image) {
    const alt = cardText(widget.image.altText, 200);
    return { type: 'text', text: alt ? `[Gambar: ${alt}]` : '[Gambar]' };
  }
  if (widget.divider) return { type: 'divider' };
  return null;
}

// Older apps still send v1 `cards` — same idea, older widget names.
function v1Widget(widget) {
  if (!widget || typeof widget !== 'object') return null;
  if (widget.keyValue) {
    const kv = widget.keyValue;
    return { decoratedText: { topLabel: kv.topLabel, text: kv.content, bottomLabel: kv.bottomLabel, onClick: kv.onClick, button: kv.button?.textButton } };
  }
  if (Array.isArray(widget.buttons)) {
    return {
      buttonList: {
        buttons: widget.buttons.map((b) => (b?.textButton ? { text: b.textButton.text, onClick: b.textButton.onClick }
          : b?.imageButton ? { text: b.imageButton.name || 'Buka', onClick: b.imageButton.onClick } : null)).filter(Boolean),
      },
    };
  }
  return widget; // textParagraph / image share the v2 shape
}

function fromV1(cards) {
  return (Array.isArray(cards) ? cards : []).map((card) => ({
    card: {
      header: card?.header,
      sections: (card?.sections || []).map((section) => ({ header: section?.header, widgets: (section?.widgets || []).map(v1Widget) })),
    },
  }));
}

function simplifyCards(cardsV2, cardsV1) {
  const all = [...(Array.isArray(cardsV2) ? cardsV2 : []), ...fromV1(cardsV1)];
  return all.slice(0, 5).map((entry) => {
    const card = entry?.card || {};
    const sections = (card.sections || []).slice(0, 10).map((section) => ({
      header: cardText(section?.header, 200) || null,
      widgets: (section?.widgets || []).slice(0, 20).map(cardWidget).filter(Boolean),
    })).filter((section) => section.header || section.widgets.length);
    const header = card.header ? {
      title: cardText(card.header.title, 200) || null,
      subtitle: cardText(card.header.subtitle, 200) || null,
    } : null;
    return { header: header && (header.title || header.subtitle) ? header : null, sections };
  }).filter((card) => card.header || card.sections.length);
}

function normalizeMessage(message, people, subject) {
  const thread = message.thread?.name;
  const { text, mentions } = withMentionTokens(typeof message.text === 'string' ? message.text : '', message.annotations);
  const quoted = message.quotedMessageMetadata;
  return {
    name: message.name,
    text,
    mentions,
    createTime: message.createTime || null,
    lastUpdateTime: message.lastUpdateTime || null,
    sender: personFrom(message.sender, people, subject),
    threadName: isThreadName(thread) ? thread : null,
    threadReply: Boolean(message.threadReply),
    attachments: (message.attachment || []).map((attachment, index) => ({
      index,
      driveFileId: DRIVE_FILE_ID_RE.test(attachment.driveDataRef?.driveFileId || '') ? attachment.driveDataRef.driveFileId : null,
      title: attachment.contentName || 'Lampiran',
      contentType: attachment.contentType || null,
      url: attachmentUrl(attachment),
      downloadable: Boolean(attachment.attachmentDataRef?.resourceName),
      isImage: IMAGE_TYPES.includes(attachment.contentType),
      source: attachment.source === 'DRIVE_FILE' ? 'DRIVE_FILE' : 'UPLOADED_CONTENT',
    })),
    reactions: (message.emojiReactionSummaries || [])
      .map((summary) => ({ emoji: summary.emoji?.unicode || null, count: Number(summary.reactionCount || 0) }))
      .filter((reaction) => reaction.emoji && reaction.count > 0),
    quoted: quoted && isMessageName(quoted.name) ? {
      name: quoted.name,
      text: String(quoted.quotedMessageSnapshot?.text || '').slice(0, 300),
    } : null,
    driveLinks: driveLinksOf(message.annotations),
    cards: simplifyCards(message.cardsV2, message.cards),
    hasCards: Boolean(message.cardsV2?.length || message.cards?.length),
    deleted: Boolean(message.deletionMetadata),
  };
}

async function normalizeMessages(raw, subject, ctx, { unknownSenderName = null } = {}) {
  await ensureMe(subject);
  const valid = (raw || []).filter((message) => isMessageName(message.name));
  const unnamed = valid.map((m) => m.sender).filter((s) => s && (!s.displayName || !s.email)).map((s) => s.name);
  const people = unnamed.length ? await resolvePeople(unnamed, ctx) : new Map();
  return valid.map((message) => {
    const normalized = normalizeMessage(message, people, subject);
    const s = normalized.sender;
    if (!s.isMe && !s.displayName && s.type !== 'BOT') {
      normalized.sender = { ...s, displayName: unknownSenderName || (s.isDeleted ? 'Pengguna dihapus' : null) };
    }
    return normalized;
  });
}

// A DM's partner is the only possible "other" sender, so its label names them.
async function unknownSenderNameFor(spaceName, ctx) {
  if (!ctx?.userId) return null;
  const aliases = await aliasesFor(ctx.userId, [spaceName]).catch(() => new Map());
  return aliases.get(spaceName) || null;
}

async function listMessages(subject, spaceName, { pageSize = 50, pageToken } = {}, ctx = {}) {
  return wrap(ctx, 'listMessages', { subject, spaceName, pageSize, paged: Boolean(pageToken) }, async () => {
    const chat = chatClient(subject);
    // Newest first so page 1 is what the user sees; the UI shows it oldest-first
    // and "Muat pesan lebih lama" follows nextPageToken further back.
    const { data } = await chat.spaces.messages.list({
      parent: spaceName, pageSize, pageToken, orderBy: 'createTime desc',
    });
    const unknownSenderName = await unknownSenderNameFor(spaceName, ctx);
    const messages = (await normalizeMessages(data.messages, subject, ctx, { unknownSenderName })).reverse();
    return { messages, nextPageToken: data.nextPageToken || null };
  }, (result) => ({ count: result?.messages?.length || 0 }));
}

async function listThreadMessages(subject, spaceName, threadName, { pageToken } = {}, ctx = {}) {
  return wrap(ctx, 'listThreadMessages', { subject, spaceName, threadName }, async () => {
    const chat = chatClient(subject);
    const { data } = await chat.spaces.messages.list({
      parent: spaceName, pageSize: 100, pageToken, orderBy: 'createTime asc', filter: `thread.name = ${threadName}`,
    });
    const unknownSenderName = await unknownSenderNameFor(spaceName, ctx);
    return { messages: await normalizeMessages(data.messages, subject, ctx, { unknownSenderName }), nextPageToken: data.nextPageToken || null };
  }, (result) => ({ count: result?.messages?.length || 0 }));
}

async function createMessage(subject, spaceName, { text, threadName, quoted, attachmentDataRef } = {}, ctx = {}) {
  return wrap(ctx, 'createMessage', {
    subject, spaceName, inThread: Boolean(threadName), quoting: Boolean(quoted), withAttachment: Boolean(attachmentDataRef), length: text?.length || 0,
  }, async () => {
    const chat = chatClient(subject);
    const requestBody = {
      ...(text ? { text } : {}),
      ...(threadName ? { thread: { name: threadName } } : {}),
      ...(quoted ? { quotedMessageMetadata: { name: quoted.name, lastUpdateTime: quoted.lastUpdateTime } } : {}),
      ...(attachmentDataRef ? { attachment: [{ attachmentDataRef }] } : {}),
    };
    const { data } = await chat.spaces.messages.create({
      parent: spaceName,
      ...(threadName ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {}),
      requestBody,
    });
    const message = normalizeMessage(data, new Map(), subject);
    // Sent as this user by definition, even when Chat omits the sender's email.
    return { ...message, sender: { ...message.sender, isMe: true } };
  }, (result) => ({ messageName: result?.name }));
}

// Only the author may edit or delete — checked here, not just hidden in the UI.
async function requireOwnMessage(chat, subject, messageName) {
  const { data } = await chat.spaces.messages.get({ name: messageName });
  const sender = data?.sender || {};
  let own = Boolean(sender.email) && lower(sender.email) === lower(subject);
  if (!own && USER_NAME_RE.test(sender.name || '')) {
    const spaceName = messageName.split('/messages/')[0];
    own = sender.name === await myUserName(chat, subject, spaceName);
  }
  if (!own) throw appError('FORBIDDEN', 'Anda hanya dapat mengubah pesan Anda sendiri.');
  return data;
}

async function updateMessage(subject, messageName, { text }, ctx = {}) {
  return wrap(ctx, 'updateMessage', { subject, messageName, length: text?.length || 0 }, async () => {
    const chat = chatClient(subject);
    await requireOwnMessage(chat, subject, messageName);
    const { data } = await chat.spaces.messages.patch({ name: messageName, updateMask: 'text', requestBody: { text } });
    const message = normalizeMessage(data, new Map(), subject);
    return { ...message, sender: { ...message.sender, isMe: true } };
  }, (result) => ({ messageName: result?.name }));
}

async function deleteMessage(subject, messageName, ctx = {}) {
  return wrap(ctx, 'deleteMessage', { subject, messageName }, async () => {
    const chat = chatClient(subject);
    await requireOwnMessage(chat, subject, messageName);
    await chat.spaces.messages.delete({ name: messageName });
    return { name: messageName, deleted: true };
  });
}

// Toggle: remove the caller's reaction with this emoji if present, else add it.
async function toggleReaction(subject, messageName, emoji, ctx = {}) {
  return wrap(ctx, 'toggleReaction', { subject, messageName, emoji }, async () => {
    const chat = chatClient(subject);
    const spaceName = messageName.split('/messages/')[0];
    const me = await myUserName(chat, subject, spaceName);
    if (!USER_NAME_RE.test(me || '')) throw appError('FORBIDDEN', 'Anda bukan anggota ruang ini.');
    const { data } = await chat.spaces.messages.reactions.list({
      parent: messageName, filter: `emoji.unicode = "${emoji}" AND user.name = "${me}"`,
    });
    const mine = (data.reactions || []).filter((reaction) => typeof reaction.name === 'string' && reaction.name.startsWith(`${messageName}/reactions/`));
    if (mine.length) {
      for (const reaction of mine) await chat.spaces.messages.reactions.delete({ name: reaction.name });
      return { emoji, reacted: false };
    }
    await chat.spaces.messages.reactions.create({ parent: messageName, requestBody: { emoji: { unicode: emoji } } });
    return { emoji, reacted: true };
  }, (result) => ({ reacted: result?.reacted }));
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
async function uploadAttachment(subject, spaceName, { filename, mimeType, buffer }, ctx = {}) {
  return wrap(ctx, 'uploadAttachment', { subject, spaceName, mimeType, size: buffer?.length || 0 }, async () => {
    const chat = chatClient(subject);
    const { data } = await chat.media.upload({
      parent: spaceName,
      requestBody: { filename },
      media: { mimeType, body: Readable.from(buffer) },
    });
    if (!data?.attachmentDataRef?.resourceName) throw new Error('Upload lampiran Chat tidak mengembalikan referensi');
    return data.attachmentDataRef;
  }, () => ({ uploaded: true }));
}

// Streams one attachment of one message the caller can read. Returns the
// stream + the attachment's declared name/type (the controller decides the
// safe Content-Type / disposition).
async function downloadAttachment(subject, messageName, index, ctx = {}) {
  return wrap(ctx, 'downloadAttachment', { subject, messageName, index }, async () => {
    const chat = chatClient(subject);
    const { data } = await chat.spaces.messages.get({ name: messageName });
    const attachment = (data?.attachment || [])[index];
    const resourceName = attachment?.attachmentDataRef?.resourceName;
    if (!resourceName) throw appError('NOT_FOUND', 'Lampiran tidak ditemukan atau hanya tersedia di Drive.', 404);
    const response = await chat.media.download({ resourceName, alt: 'media' }, { responseType: 'stream' });
    return { stream: response.data, filename: attachment.contentName || 'lampiran', contentType: attachment.contentType || null };
  }, () => ({ streamed: true }));
}

// ---------------------------------------------------------------------------
// Spaces: create, details, edit, members, leave, delete
// ---------------------------------------------------------------------------
function membershipFor(email) {
  return { member: { name: `users/${email}`, type: 'HUMAN' } };
}

async function findDirectMessage(subject, email, ctx = {}) {
  return wrap(ctx, 'findDirectMessage', { subject, email }, async () => {
    const chat = chatClient(subject);
    try {
      const { data } = await chat.spaces.findDirectMessage({ name: `users/${email}` });
      const [space] = await withNames(chat, subject, [data], ctx, { budgetMs: null });
      return space;
    } catch (error) {
      if (Number(error?.code || error?.status || error?.response?.status) === 404) return null;
      throw error;
    }
  }, (result) => ({ found: Boolean(result) }));
}

async function setupSpace(subject, { spaceType, displayName, description, emails }, ctx = {}) {
  return wrap(ctx, 'setupSpace', { subject, spaceType, members: emails.length }, async () => {
    const chat = chatClient(subject);
    const space = { spaceType };
    if (spaceType === 'SPACE') {
      space.displayName = displayName;
      if (description) space.spaceDetails = { description };
    }
    const { data } = await chat.spaces.setup({
      requestBody: { space, memberships: emails.map(membershipFor) },
    });
    const [normalized] = await withNames(chat, subject, [data], ctx, { budgetMs: null });
    return normalized;
  }, (result) => ({ spaceName: result?.name }));
}

async function listAllMembers(chat, spaceName) {
  const members = [];
  let pageToken;
  for (let page = 0; page < 5; page += 1) {
    const { data } = await chat.spaces.members.list({ parent: spaceName, pageSize: 200, pageToken });
    members.push(...(data.memberships || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return members;
}

async function getNotificationSetting(subject, spaceName) {
  try {
    const client = chatClient(subject, SPACE_SETTINGS_SCOPES);
    const { data } = await client.users.spaces.spaceNotificationSetting.get({
      name: `users/me/${spaceName}/spaceNotificationSetting`,
    });
    return { available: true, muted: data?.muteSetting === 'MUTED' };
  } catch (error) {
    if (!isScopeError(error)) logger.debug({ err: error.message }, '[googleChatUser] notification setting unavailable');
    return { available: false, muted: false, reason: isScopeError(error) ? 'SCOPE_NOT_GRANTED' : 'UNAVAILABLE' };
  }
}

async function getSpaceDetails(subject, spaceName, ctx = {}) {
  return wrap(ctx, 'getSpaceDetails', { subject, spaceName }, async () => {
    const chat = chatClient(subject);
    const [{ data: raw }, memberships, notifications] = await Promise.all([
      chat.spaces.get({ name: spaceName }),
      listAllMembers(chat, spaceName),
      getNotificationSetting(subject, spaceName),
    ]);
    const unnamed = memberships.map((m) => m.member).filter((m) => m && (!m.displayName || !m.email)).map((m) => m.name);
    const people = unnamed.length ? await resolvePeople(unnamed, ctx) : new Map();
    const members = memberships
      .filter((m) => isMembershipName(m.name) && m.member)
      .map((m) => {
        const person = personFrom(m.member, people, subject);
        return {
          name: m.name,
          user: person.name,
          displayName: person.displayName || (person.type === 'BOT' ? 'Aplikasi Chat' : 'Pengguna'),
          email: m.member.email || people.get(m.member.name)?.email || null,
          type: person.type,
          isMe: person.isMe,
          role: m.role === 'ROLE_MANAGER' ? 'ROLE_MANAGER' : 'ROLE_MEMBER',
          state: m.state || null,
        };
      })
      .sort((a, b) => (a.role === b.role ? String(a.displayName).localeCompare(String(b.displayName)) : a.role === 'ROLE_MANAGER' ? -1 : 1));
    const [space] = await withNames(chat, subject, [raw], ctx, { budgetMs: null });
    const me = members.find((m) => m.isMe) || null;
    const canManage = space.spaceType === 'SPACE' && me?.role === 'ROLE_MANAGER';
    return {
      space,
      members,
      me: me ? { membershipName: me.name, role: me.role } : null,
      canManage,
      canAddMembers: space.spaceType !== 'DIRECT_MESSAGE',
      canLeave: space.spaceType !== 'DIRECT_MESSAGE' && Boolean(me),
      canToggleHistory: space.spaceType !== 'SPACE' || canManage || Boolean(space.permissionSettings?.toggleHistory?.membersAllowed),
      notifications,
    };
  }, (result) => ({ members: result?.members?.length || 0 }));
}

// spaceDetails is patched as a whole, so the field that isn't being edited
// (description or guidelines) is carried over from the current space.
async function patchSpace(subject, spaceName, { displayName, description, guidelines }, ctx = {}) {
  return wrap(ctx, 'patchSpace', { subject, spaceName }, async () => {
    const chat = chatClient(subject);
    await requireManager(chat, subject, spaceName);
    const mask = [];
    const requestBody = {};
    if (displayName !== undefined) { mask.push('displayName'); requestBody.displayName = displayName; }
    if (description !== undefined || guidelines !== undefined) {
      const { data: current } = await chat.spaces.get({ name: spaceName });
      mask.push('spaceDetails');
      requestBody.spaceDetails = {
        description: description !== undefined ? description : (current?.spaceDetails?.description || ''),
        guidelines: guidelines !== undefined ? guidelines : (current?.spaceDetails?.guidelines || ''),
      };
    }
    const { data } = await chat.spaces.patch({ name: spaceName, updateMask: mask.join(','), requestBody });
    const [space] = await withNames(chat, subject, [data], ctx, { budgetMs: null });
    return space;
  }, (result) => ({ spaceName: result?.name }));
}

// Chat refuses these with 400/403 when the caller's role or the domain's
// policy doesn't allow them — that is a clear "not allowed", not a broken setup.
function settingsRefusal(error) {
  if (isScopeError(error)) return error;
  const status = Number(error?.code || error?.status || error?.response?.status);
  if (status === 403 || status === 400) {
    return appError('FORBIDDEN', 'Google Chat menolak perubahan ini. Anda mungkin tidak memiliki izin untuk pengaturan ini, atau kebijakan admin tidak mengizinkannya.');
  }
  return error;
}

// History on/off (any member of a DM / group chat; in a space whoever the
// space's toggleHistory setting allows) and a manager's permission settings.
// Chat requires each of these to be its own patch (exclusive update masks).
async function updateSpaceSettings(subject, spaceName, { historyOff, permissions } = {}, ctx = {}) {
  return wrap(ctx, 'updateSpaceSettings', {
    subject, spaceName, history: historyOff !== undefined, permissions: permissions ? Object.keys(permissions).length : 0,
  }, async () => {
    const chat = chatClient(subject);
    let latest = null;
    if (permissions && Object.keys(permissions).length) {
      const { data: raw } = await chat.spaces.get({ name: spaceName });
      if (raw?.spaceType !== 'SPACE') throw appError('VALIDATION_ERROR', 'Izin hanya dapat diatur untuk space bernama.', 400);
      await requireManager(chat, subject, spaceName);
      const permissionSettings = {};
      const mask = [];
      for (const key of PERMISSION_KEYS) {
        if (permissions[key] === undefined) continue;
        permissionSettings[key] = { managersAllowed: true, membersAllowed: permissions[key] === 'members' };
        mask.push(`permission_settings.${key}`);
      }
      try {
        ({ data: latest } = await chat.spaces.patch({ name: spaceName, updateMask: mask.join(','), requestBody: { permissionSettings } }));
      } catch (error) { throw settingsRefusal(error); }
    }
    if (historyOff !== undefined) {
      try {
        ({ data: latest } = await chat.spaces.patch({
          name: spaceName,
          updateMask: 'space_history_state',
          requestBody: { spaceHistoryState: historyOff ? 'HISTORY_OFF' : 'HISTORY_ON' },
        }));
      } catch (error) { throw settingsRefusal(error); }
    }
    if (!latest) ({ data: latest } = await chat.spaces.get({ name: spaceName }));
    const [space] = await withNames(chat, subject, [latest], ctx, { budgetMs: null });
    return space;
  }, (result) => ({ spaceName: result?.name }));
}

async function addMembers(subject, spaceName, emails, ctx = {}) {
  return wrap(ctx, 'addMembers', { subject, spaceName, count: emails.length }, async () => {
    const chat = chatClient(subject);
    const added = [];
    const failed = [];
    for (const email of emails) {
      try {
        await chat.spaces.members.create({ parent: spaceName, requestBody: membershipFor(email) });
        added.push(email);
      } catch (error) {
        const status = Number(error?.code || error?.status || error?.response?.status);
        if (status === 409) added.push(email); // already a member
        else if (isScopeError(error) || status === 401) throw error;
        else failed.push(email);
      }
    }
    for (const key of membersCache.keys()) if (key.endsWith(`|${spaceName}`)) membersCache.delete(key);
    return { added, failed };
  }, (result) => ({ added: result?.added?.length || 0, failed: result?.failed?.length || 0 }));
}

async function removeMember(subject, spaceName, membershipName, ctx = {}) {
  return wrap(ctx, 'removeMember', { subject, spaceName, membershipName }, async () => {
    const chat = chatClient(subject);
    const me = await requireManager(chat, subject, spaceName);
    if (me.membershipName === membershipName) throw appError('VALIDATION_ERROR', 'Gunakan "Keluar dari ruang" untuk keanggotaan Anda sendiri.', 400);
    await chat.spaces.members.delete({ name: membershipName });
    return { name: membershipName, removed: true };
  });
}

async function leaveSpace(subject, spaceName, ctx = {}) {
  return wrap(ctx, 'leaveSpace', { subject, spaceName }, async () => {
    const chat = chatClient(subject);
    const me = await myMembership(chat, subject, spaceName);
    if (!isMembershipName(me.membershipName)) throw appError('NOT_FOUND', 'Anda bukan anggota ruang ini.', 404);
    await chat.spaces.members.delete({ name: me.membershipName });
    return { left: true };
  });
}

async function deleteSpace(subject, spaceName, ctx = {}) {
  return wrap(ctx, 'deleteSpace', { subject, spaceName }, async () => {
    const chat = chatClient(subject);
    await requireManager(chat, subject, spaceName);
    await chatClient(subject, DELETE_SPACE_SCOPES).spaces.delete({ name: spaceName });
    return { name: spaceName, deleted: true };
  });
}

async function setMuted(subject, spaceName, muted, ctx = {}) {
  return wrap(ctx, 'setMuted', { subject, spaceName, muted }, async () => {
    const client = chatClient(subject, SPACE_SETTINGS_SCOPES);
    const { data } = await client.users.spaces.spaceNotificationSetting.patch({
      name: `users/me/${spaceName}/spaceNotificationSetting`,
      updateMask: 'muteSetting',
      requestBody: { muteSetting: muted ? 'MUTED' : 'UNMUTED' },
    });
    return { muted: data?.muteSetting === 'MUTED' };
  });
}

// ---------------------------------------------------------------------------
// Unread state (optional scope). A missing scope is remembered for a while and
// reported as { available: false } — the UI simply hides unread dots.
// ---------------------------------------------------------------------------
const SCOPE_RETRY_MS = 10 * 60 * 1000;
let readStateUnavailableUntil = 0;

function readStateUnavailable(error) {
  if (!isScopeError(error)) return false;
  if (readStateUnavailableUntil < Date.now()) logger.debug('[googleChatUser] chat.users.readstate not granted — unread UI hidden');
  readStateUnavailableUntil = Date.now() + SCOPE_RETRY_MS;
  return true;
}

async function getReadStates(subject, spaceNames, ctx = {}) {
  if (readStateUnavailableUntil > Date.now()) return { available: false, states: {} };
  try {
    return await wrap(ctx, 'getReadStates', { subject, count: spaceNames.length }, async () => {
      const client = chatClient(subject, READSTATE_SCOPES);
      const states = {};
      await mapLimit(spaceNames, 8, async (spaceName) => {
        try {
          const { data } = await client.users.spaces.getSpaceReadState({ name: `users/me/${spaceName}/spaceReadState` });
          states[spaceName] = data?.lastReadTime || null;
        } catch (error) {
          if (isScopeError(error)) throw error;
        }
      });
      return { available: true, states };
    });
  } catch (error) {
    if (readStateUnavailable(error)) return { available: false, states: {} };
    throw error;
  }
}

async function markRead(subject, spaceName, ctx = {}) {
  if (readStateUnavailableUntil > Date.now()) return { available: false };
  try {
    return await wrap(ctx, 'markRead', { subject, spaceName }, async () => {
      const client = chatClient(subject, READSTATE_SCOPES);
      const { data } = await client.users.spaces.updateSpaceReadState({
        name: `users/me/${spaceName}/spaceReadState`,
        updateMask: 'lastReadTime',
        requestBody: { lastReadTime: new Date().toISOString() },
      });
      return { available: true, lastReadTime: data?.lastReadTime || null };
    });
  } catch (error) {
    if (readStateUnavailable(error)) return { available: false };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Google Meet: an instant meeting on the caller's own calendar, then its link
// is posted into the space as the caller.
// ---------------------------------------------------------------------------
async function createMeet(subject, spaceName, ctx = {}) {
  return wrap(ctx, 'createMeet', { subject, spaceName }, async () => {
    const space = await getSpace(subject, spaceName, ctx);
    const calendar = google.calendar({ version: 'v3', auth: googleUserClient.userAuth(subject, CALENDAR_SCOPES) });
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const { data: event } = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Google Meet — ${space?.displayName || 'Google Chat'}`.slice(0, 200),
        description: 'Dibuat dari Google Chat di Prakasa Workspace.',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: {
          createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      },
    });
    const meetUrl = [event?.hangoutLink, ...(event?.conferenceData?.entryPoints || []).filter((e) => e.entryPointType === 'video').map((e) => e.uri)]
      .find((uri) => typeof uri === 'string' && /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(uri));
    if (!meetUrl) throw new Error('Google Calendar tidak mengembalikan tautan Meet');
    const message = await createMessage(subject, spaceName, { text: `Bergabung ke Google Meet: ${meetUrl}` }, ctx);
    return {
      meetUrl,
      eventUrl: typeof event.htmlLink === 'string' && /^https:\/\/(www\.)?google\.com\/calendar\//.test(event.htmlLink) ? event.htmlLink : null,
      message,
    };
  }, (result) => ({ hasMeetLink: Boolean(result?.meetUrl) }));
}

// ---------------------------------------------------------------------------
// Forward: re-post a message the caller can read into another conversation
// the caller belongs to, as the caller, with a "Diteruskan dari …" line. One
// uploaded attachment travels along (downloaded, re-uploaded); Drive files go
// as links. Cards aren't forwarded.
// ---------------------------------------------------------------------------
async function readCapped(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) { stream.destroy?.(); return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function forwardText({ senderName, sourceTitle, text, note, driveUrls, skipped }) {
  const lines = [];
  if (note) lines.push(note, '');
  lines.push(`_Diteruskan dari ${senderName} · ${sourceTitle}_`);
  if (text) lines.push(text);
  for (const url of driveUrls) lines.push(url);
  if (skipped) lines.push(`_(${skipped} lampiran tidak ikut diteruskan)_`);
  const out = lines.join('\n');
  return out.length > MAX_TEXT_LENGTH ? `${out.slice(0, MAX_TEXT_LENGTH - 1)}…` : out;
}

async function forwardMessage(subject, messageName, targetSpaceName, { note } = {}, ctx = {}) {
  return wrap(ctx, 'forwardMessage', { subject, messageName, targetSpaceName, withNote: Boolean(note) }, async () => {
    const chat = chatClient(subject);
    const sourceSpaceName = messageName.split('/messages/')[0];
    const [{ data: message }, source] = await Promise.all([
      chat.spaces.messages.get({ name: messageName }),
      getSpace(subject, sourceSpaceName, ctx),
    ]);
    if (message?.deletionMetadata) throw appError('VALIDATION_ERROR', 'Pesan yang dihapus tidak dapat diteruskan.', 400);
    const people = message?.sender && (!message.sender.displayName || !message.sender.email)
      ? await resolvePeople([message.sender.name], ctx) : new Map();
    const sender = personFrom(message?.sender, people, subject);
    const senderName = sender.isMe ? 'Anda' : (sender.displayName || 'Pengguna');
    const attachments = message?.attachment || [];
    const driveUrls = attachments
      .map((a) => a?.driveDataRef?.driveFileId)
      .filter((id) => id && DRIVE_FILE_ID_RE.test(id))
      .map((id) => `https://drive.google.com/open?id=${id}`);
    const uploads = attachments.filter((a) => a?.attachmentDataRef?.resourceName);
    let attachmentDataRef;
    const first = uploads[0];
    const pattern = first && CHAT_UPLOAD_TYPES[first.contentType];
    if (first && pattern && pattern.test(first.contentName || '')) {
      const response = await chat.media.download({ resourceName: first.attachmentDataRef.resourceName, alt: 'media' }, { responseType: 'stream' });
      const buffer = await readCapped(response.data, CHAT_UPLOAD_MAX_BYTES);
      if (buffer) {
        attachmentDataRef = await uploadAttachment(subject, targetSpaceName, {
          filename: first.contentName, mimeType: first.contentType, buffer,
        }, ctx);
      }
    }
    const text = forwardText({
      senderName,
      sourceTitle: source?.displayName || 'Google Chat',
      text: typeof message?.text === 'string' ? message.text : '',
      note,
      driveUrls,
      skipped: uploads.length - (attachmentDataRef ? 1 : 0),
    });
    return createMessage(subject, targetSpaceName, { text, attachmentDataRef }, ctx);
  }, (result) => ({ messageName: result?.name }));
}

// ---------------------------------------------------------------------------
// Attach from Drive: browse the caller's My Drive, "Shared with me" and the
// Shared Drives they belong to, as the caller (Drive only returns files that
// user can open). Every id is validated before it is placed in a q string.
// ---------------------------------------------------------------------------
const DRIVE_SOURCES = ['my', 'shared', 'drive', 'search'];
const DRIVE_ROLES = ['reader', 'commenter', 'writer'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const DRIVE_PICKER_FIELDS = 'nextPageToken,incompleteSearch,files(id,name,mimeType,iconLink,modifiedTime,size,webViewLink,driveId,'
  + 'shortcutDetails(targetId,targetMimeType),owners(displayName,me),capabilities(canShare))';
const DRIVE_META_FIELDS = 'id,name,mimeType,iconLink,webViewLink,driveId,capabilities(canShare)';
const MAX_DRIVE_SEARCH = 100;
const MAX_DRIVE_FILES_PER_MESSAGE = 10;

const isDriveId = (value) => typeof value === 'string' && DRIVE_FILE_ID_RE.test(value);
const isDriveRole = (value) => typeof value === 'string' && DRIVE_ROLES.includes(value);

function driveClient(subject) {
  return google.drive({ version: 'v3', auth: googleUserClient.userAuth(subject, DRIVE_SCOPES) });
}

const driveWrap = (ctx, operation, requestMeta, fn, responseMeta) => integrationLog.wrap({
  entityId: ctx.entityId || null,
  userId: ctx.userId || null,
  provider: 'google_chat_drive',
  operation,
  requestMeta,
  responseMeta: responseMeta || null,
}, fn);

function escapeDriveQuery(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function normalizeDriveSearch(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_DRIVE_SEARCH);
}

// → the files.list parameters for one picker view (throws on bad input).
function buildDriveList({ source, folderId, driveId, search }) {
  if (!DRIVE_SOURCES.includes(source)) throw appError('VALIDATION_ERROR', 'Sumber Drive tidak valid', 400);
  if (folderId !== undefined && !isDriveId(folderId)) throw appError('VALIDATION_ERROR', 'Folder tidak valid', 400);
  if (driveId !== undefined && !isDriveId(driveId)) throw appError('VALIDATION_ERROR', 'Shared Drive tidak valid', 400);
  const text = normalizeDriveSearch(search);
  const base = { supportsAllDrives: true, includeItemsFromAllDrives: true, fields: DRIVE_PICKER_FIELDS };
  if (source === 'search' || text) {
    if (!text) throw appError('VALIDATION_ERROR', 'Kata kunci wajib diisi', 400);
    const scope = driveId ? { corpora: 'drive', driveId } : { corpora: 'allDrives' };
    return { ...base, ...scope, q: `name contains '${escapeDriveQuery(text)}' and trashed = false`, orderBy: 'folder,modifiedTime desc' };
  }
  if (source === 'my') {
    return { ...base, corpora: 'user', q: `'${folderId || 'root'}' in parents and trashed = false`, orderBy: 'folder,name' };
  }
  if (source === 'shared') {
    if (folderId) return { ...base, corpora: 'allDrives', q: `'${folderId}' in parents and trashed = false`, orderBy: 'folder,name' };
    return { ...base, corpora: 'user', q: 'sharedWithMe = true and trashed = false', orderBy: 'folder,sharedWithMeTime desc' };
  }
  if (!driveId) throw appError('VALIDATION_ERROR', 'Pilih Shared Drive terlebih dahulu', 400);
  return { ...base, corpora: 'drive', driveId, q: `'${folderId || driveId}' in parents and trashed = false`, orderBy: 'folder,name' };
}

const safeDriveLink = (link) => (typeof link === 'string' && /^https:\/\/(docs|drive)\.google\.com\//i.test(link) ? link : null);

function toPickerFile(file) {
  const shortcut = file.mimeType === SHORTCUT_MIME && isDriveId(file.shortcutDetails?.targetId);
  const id = shortcut ? file.shortcutDetails.targetId : file.id;
  const mimeType = shortcut ? (file.shortcutDetails.targetMimeType || null) : (file.mimeType || null);
  const owner = (file.owners || [])[0] || null;
  return {
    id,
    name: String(file.name || 'Tanpa judul'),
    mimeType,
    isFolder: mimeType === FOLDER_MIME,
    modifiedTime: file.modifiedTime || null,
    size: file.size ? Number(file.size) : null,
    webViewLink: safeDriveLink(file.webViewLink) || `https://drive.google.com/open?id=${id}`,
    inSharedDrive: Boolean(file.driveId),
    ownerName: owner ? (owner.me ? 'saya' : owner.displayName || null) : null,
    canShare: Boolean(file.capabilities?.canShare),
  };
}

async function listDriveFiles(subject, { source, folderId, driveId, search, pageToken } = {}, ctx = {}) {
  const params = buildDriveList({ source, folderId, driveId, search });
  return driveWrap(ctx, 'listDriveFiles', { subject, source, folder: Boolean(folderId), sharedDrive: Boolean(driveId), hasSearch: Boolean(search), paged: Boolean(pageToken) }, async () => {
    const { data } = await driveClient(subject).files.list({ ...params, pageSize: 50, pageToken: pageToken || undefined });
    return {
      files: (data.files || []).filter((f) => isDriveId(f.id)).map(toPickerFile).filter((f) => isDriveId(f.id)),
      nextPageToken: data.nextPageToken || null,
      incompleteSearch: Boolean(data.incompleteSearch),
    };
  }, (result) => ({ count: result?.files?.length || 0 }));
}

async function listSharedDrives(subject, { pageToken } = {}, ctx = {}) {
  return driveWrap(ctx, 'listSharedDrives', { subject, paged: Boolean(pageToken) }, async () => {
    const { data } = await driveClient(subject).drives.list({ pageSize: 100, pageToken: pageToken || undefined, fields: 'nextPageToken,drives(id,name)' });
    return {
      drives: (data.drives || []).filter((d) => isDriveId(d.id)).map((d) => ({ id: d.id, name: String(d.name || 'Shared Drive') })),
      nextPageToken: data.nextPageToken || null,
    };
  }, (result) => ({ count: result?.drives?.length || 0 }));
}

const statusOf = (error) => Number(error?.code || error?.status || error?.response?.status);

// Names / types for Drive chips. A file the caller can't open is reported as
// { accessible:false } instead of failing the whole batch.
async function getDriveFilesMeta(subject, ids, ctx = {}) {
  return driveWrap(ctx, 'getDriveFilesMeta', { subject, count: ids.length }, async () => {
    const drive = driveClient(subject);
    const files = await mapLimit(ids, 6, async (fileId) => {
      try {
        const { data } = await drive.files.get({ fileId, fields: DRIVE_META_FIELDS, supportsAllDrives: true });
        return { ...toPickerFile(data), accessible: true };
      } catch (error) {
        if (isScopeError(error) || statusOf(error) === 401) throw error;
        return { id: fileId, accessible: false };
      }
    });
    return { files };
  }, (result) => ({ count: result?.files?.length || 0 }));
}

// Everyone in the space except the caller and apps, with their email when
// Chat / our users table / the directory knows it.
async function spaceMemberEmails(subject, spaceName, ctx) {
  const chat = chatClient(subject);
  const memberships = await listAllMembers(chat, spaceName);
  const humans = memberships.map((m) => m.member).filter((m) => m && m.type !== 'BOT' && USER_NAME_RE.test(m.name || ''));
  const unnamed = humans.filter((m) => !m.email).map((m) => m.name);
  const people = unnamed.length ? await resolvePeople(unnamed, ctx) : new Map();
  const emails = new Set();
  let unknown = 0;
  for (const member of humans) {
    const email = lower(member.email || people.get(member.name)?.email);
    if (!email) { unknown += 1; continue; }
    if (email !== lower(subject)) emails.add(email);
  }
  return { emails: [...emails], unknown };
}

function coveredBy(permissions, email) {
  const domain = email.split('@')[1];
  return permissions.some((p) => p?.type === 'anyone'
    || (p?.type === 'domain' && lower(p.domain) === domain)
    || (p?.type === 'user' && lower(p.emailAddress) === email));
}

async function listPermissions(drive, fileId) {
  const all = [];
  let pageToken;
  for (let page = 0; page < 5; page += 1) {
    const { data } = await drive.permissions.list({
      fileId, supportsAllDrives: true, pageSize: 100, pageToken, fields: 'nextPageToken,permissions(type,role,emailAddress,domain)',
    });
    all.push(...(data.permissions || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return all;
}

// Which space members can't open each file yet. permissions.list only works
// when the caller may see the sharing settings; otherwise canCheck:false and
// the file is sent as-is (like Google Chat, which then just shows the link).
async function checkDriveAccess(subject, spaceName, fileIds, ctx = {}) {
  return driveWrap(ctx, 'checkDriveAccess', { subject, spaceName, files: fileIds.length }, async () => {
    const [{ emails, unknown }, drive] = [await spaceMemberEmails(subject, spaceName, ctx), driveClient(subject)];
    const files = await mapLimit(fileIds, 4, async (fileId) => {
      let meta;
      try {
        ({ data: meta } = await drive.files.get({ fileId, fields: DRIVE_META_FIELDS, supportsAllDrives: true }));
      } catch (error) {
        if (isScopeError(error) || statusOf(error) === 401) throw error;
        return { id: fileId, accessible: false, canShare: false, canCheck: false, missing: [], viaGroup: false };
      }
      const file = toPickerFile(meta);
      let permissions = null;
      try { permissions = await listPermissions(drive, fileId); } catch (error) {
        if (isScopeError(error) || statusOf(error) === 401) throw error;
      }
      if (!permissions) return { ...file, accessible: true, canCheck: false, missing: [], viaGroup: false };
      return {
        ...file,
        accessible: true,
        canCheck: true,
        missing: emails.filter((email) => !coveredBy(permissions, email)),
        viaGroup: permissions.some((p) => p?.type === 'group'),
      };
    });
    return { members: emails.length, unknownMembers: unknown, files };
  }, (result) => ({ files: result?.files?.length || 0, missing: (result?.files || []).reduce((n, f) => n + f.missing.length, 0) }));
}

// Shares each file the caller is allowed to share with the members who lack
// access. The list of people is recomputed here from the space itself — the
// client never supplies the emails — and only company-domain accounts get it.
async function grantDriveAccess(subject, spaceName, fileIds, role, ctx = {}) {
  if (!isDriveRole(role)) throw appError('VALIDATION_ERROR', 'Peran akses tidak valid', 400);
  const check = await checkDriveAccess(subject, spaceName, fileIds, ctx);
  return driveWrap(ctx, 'grantDriveAccess', { subject, spaceName, files: fileIds.length, role }, async () => {
    const drive = driveClient(subject);
    const jobs = [];
    const skipped = [];
    for (const file of check.files) {
      const people = file.missing.filter(isAllowedEmail).slice(0, 100);
      if (!people.length) continue;
      if (!file.canShare) { skipped.push(file.id); continue; }
      for (const email of people) jobs.push({ fileId: file.id, email });
    }
    let granted = 0;
    let failed = 0;
    await mapLimit(jobs.slice(0, 500), 4, async ({ fileId, email }) => {
      try {
        await drive.permissions.create({
          fileId,
          supportsAllDrives: true,
          sendNotificationEmail: false,
          fields: 'id',
          requestBody: { type: 'user', role, emailAddress: email },
        });
        granted += 1;
      } catch (error) {
        if (isScopeError(error) || statusOf(error) === 401) throw error;
        failed += 1;
      }
    });
    return { granted, failed, skippedFiles: skipped };
  }, (result) => ({ granted: result?.granted || 0, failed: result?.failed || 0 }));
}

// ---------------------------------------------------------------------------
// People picker: active Prakasa users + the Workspace directory (read-only).
// ---------------------------------------------------------------------------
const DIRECTORY_TTL_MS = 10 * 60 * 1000;
let directoryCache = { users: null, expires: 0, pending: null };

async function directoryUsers(ctx) {
  if (directoryCache.users && directoryCache.expires > Date.now()) return directoryCache.users;
  if (!directoryCache.pending) {
    directoryCache.pending = googleDirectory.listDomainUsers(ctx)
      .then((users) => { directoryCache = { users, expires: Date.now() + DIRECTORY_TTL_MS, pending: null }; return users; })
      .catch((error) => {
        logger.debug({ err: error.message }, '[googleChatUser] directory unavailable for people search');
        directoryCache = { users: [], expires: Date.now() + 60 * 1000, pending: null };
        return [];
      });
  }
  return directoryCache.pending;
}

async function searchPeople(subject, query, ctx = {}) {
  const q = String(query || '').trim().toLowerCase();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [[rows], directory] = await Promise.all([
    pool.query(
      `SELECT name, email FROM users
        WHERE status = 'active' AND deleted_at IS NULL AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)
        ORDER BY name LIMIT 30`,
      [like, like]
    ),
    directoryUsers(ctx),
  ]);
  const byEmail = new Map();
  for (const person of [...(rows || []), ...(directory || [])]) {
    const email = lower(person.email);
    if (!email || email === lower(subject) || !isAllowedEmail(email) || byEmail.has(email)) continue;
    const name = String(person.name || person.email);
    if (q && !name.toLowerCase().includes(q) && !email.includes(q)) continue;
    byEmail.set(email, { email, name });
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
}

module.exports = {
  nameFromEmail,
  setAlias,
  ensureMe,
  CHAT_UPLOAD_TYPES,
  CHAT_UPLOAD_MAX_BYTES,
  MAX_GUIDELINES,
  PERMISSION_KEYS,
  DRIVE_SOURCES,
  DRIVE_ROLES,
  MAX_DRIVE_FILES_PER_MESSAGE,
  MAX_TEXT_LENGTH,
  MAX_DISPLAY_NAME,
  MAX_DESCRIPTION,
  MAX_MEMBERS_PER_REQUEST,
  REACTION_EMOJI,
  IMAGE_TYPES,
  isSpaceId,
  isSpaceName,
  isThreadName,
  isMessageName,
  isMembershipName,
  isReactionEmoji,
  isTimestamp,
  isAllowedEmail,
  isScopeError,
  parsePageToken,
  clampPageSize,
  normalizeSpace,
  normalizeMessage,
  withMentionTokens,
  simplifyCards,
  cardText,
  driveLinksOf,
  isDriveId,
  isDriveRole,
  buildDriveList,
  toPickerFile,
  coveredBy,
  forwardText,
  listDriveFiles,
  listSharedDrives,
  getDriveFilesMeta,
  checkDriveAccess,
  grantDriveAccess,
  forwardMessage,
  updateSpaceSettings,
  listSpaces,
  getSpace,
  listMessages,
  listThreadMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  toggleReaction,
  uploadAttachment,
  downloadAttachment,
  findDirectMessage,
  setupSpace,
  getSpaceDetails,
  patchSpace,
  addMembers,
  removeMember,
  leaveSpace,
  deleteSpace,
  setMuted,
  getReadStates,
  markRead,
  createMeet,
  searchPeople,
  resolvePeople,
};
