const { google } = require('googleapis');
const logger = require('../utils/logger');
const googleUserClient = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');
const chatUser = require('./googleChatUser.service');

// Google Chat side of the Project Tracker. Every call acts AS the signed-in
// user (subject = req.user.email): Chat itself decides who is a member.

const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.memberships',
];
const MEMBERSHIP_TTL_MS = 2 * 60 * 1000;
const NON_MEMBER_TTL_MS = 30 * 1000;
const MEMBERS_TTL_MS = 2 * 60 * 1000;
const MAX_MEMBER_PAGES = 5;

const membershipCache = new Map(); // `${userId}|${spaceName}` → { value, expires }
const membersCache = new Map(); // spaceName → { members, expires }
const membersInFlight = new Map();

const lower = (value) => String(value || '').trim().toLowerCase();

function forbidden(message = 'Anda bukan anggota space ini') {
  const error = new Error(message);
  error.status = 403;
  error.code = 'FORBIDDEN';
  return error;
}

// Chat answers 403/404 to spaces.get for a space the caller is not in (and 400
// for an id that is not a real space) — all mean "no access here". Token
// problems (account not linked, scope not granted, API disabled) are NOT
// membership answers — they bubble up to handleGoogleError.
function isNotMemberError(error) {
  const text = String(error?.response?.data?.error?.message || error?.response?.data?.error_description || error?.message || '');
  if (/invalid_grant|invalid email or user id|unauthorized_client|not authorized for any of the scopes|has not been used in project|is disabled|SERVICE_DISABLED/i.test(text)) {
    return false;
  }
  const status = Number(error?.status || error?.code || error?.response?.status);
  return status === 400 || status === 403 || status === 404;
}

// Resolves { name, displayName, spaceType } when the user is a member; throws
// 403 FORBIDDEN otherwise. Cached per (user, space) for 2 minutes.
async function assertMember(user, spaceName) {
  const key = `${user.sub}|${spaceName}`;
  const hit = membershipCache.get(key);
  if (hit && hit.expires > Date.now()) {
    if (!hit.value) throw forbidden();
    return hit.value;
  }
  let space;
  try {
    space = await chatUser.getSpace(user.email, spaceName, { entityId: user.entityId, userId: user.sub });
  } catch (error) {
    if (isNotMemberError(error)) {
      membershipCache.set(key, { value: null, expires: Date.now() + NON_MEMBER_TTL_MS });
      throw forbidden();
    }
    throw error;
  }
  const value = {
    name: space?.name || spaceName,
    displayName: space?.displayName || null,
    spaceType: space?.spaceType || 'SPACE',
  };
  membershipCache.set(key, { value, expires: Date.now() + MEMBERSHIP_TTL_MS });
  return value;
}

function chatClient(subject) {
  return google.chat({ version: 'v1', auth: googleUserClient.userAuth(subject, CHAT_SCOPES) });
}

// Human members of the space → [{ email, name, role }] (role manager|member).
// Names missing from Chat are resolved the same way the Chat page does
// (our users table by google_sub, then the Workspace directory).
async function fetchMembers(user, spaceName) {
  return integrationLog.wrap({
    entityId: user.entityId || null,
    userId: user.sub || null,
    provider: 'google_chat_user',
    operation: 'trackerListMembers',
    requestMeta: { subject: user.email, spaceName },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const chat = chatClient(user.email);
    const memberships = [];
    let pageToken;
    for (let page = 0; page < MAX_MEMBER_PAGES; page += 1) {
      const { data } = await chat.spaces.members.list({ parent: spaceName, pageSize: 200, pageToken });
      memberships.push(...(data.memberships || []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    const humans = memberships.filter((m) => m?.member && m.member.type !== 'BOT');
    const unnamed = humans.map((m) => m.member).filter((m) => !m.displayName || !m.email).map((m) => m.name);
    const people = unnamed.length ? await chatUser.resolvePeople(unnamed, { entityId: user.entityId, userId: user.sub }) : new Map();
    const byEmail = new Map();
    for (const m of humans) {
      const known = people.get(m.member.name) || {};
      const email = lower(m.member.email || known.email);
      if (!email) continue;
      byEmail.set(email, {
        email,
        name: m.member.displayName || known.displayName || email,
        role: m.role === 'ROLE_MANAGER' ? 'manager' : 'member',
      });
    }
    return [...byEmail.values()];
  });
}

async function listMembers(user, spaceName) {
  const hit = membersCache.get(spaceName);
  if (hit && hit.expires > Date.now()) return hit.members;
  if (membersInFlight.has(spaceName)) return membersInFlight.get(spaceName);
  const request = fetchMembers(user, spaceName)
    .then((members) => {
      membersCache.set(spaceName, { members, expires: Date.now() + MEMBERS_TTL_MS });
      return members;
    })
    .finally(() => membersInFlight.delete(spaceName));
  membersInFlight.set(spaceName, request);
  return request;
}

function cachedMembers(spaceName) {
  const hit = membersCache.get(spaceName);
  return hit ? hit.members : null;
}

// Who is known locally to belong to the space, for the realtime fan-out:
// the last member list read from Chat (emails) plus the users whose own
// membership was confirmed in this process (ids). Null when no member list
// has been read yet — the caller then keeps the entity-wide fan-out.
function knownAudience(spaceName) {
  const members = cachedMembers(spaceName);
  if (!members || !members.length) return null;
  const userIds = [];
  const suffix = `|${spaceName}`;
  for (const [key, hit] of membershipCache) {
    if (hit?.value && key.endsWith(suffix)) userIds.push(Number(key.slice(0, -suffix.length)));
  }
  return { emails: members.map((m) => m.email).filter(Boolean), userIds };
}

// Best-effort message to the space AS the acting user. Never throws; the
// integration log row is written by googleChatUser.createMessage's wrap.
async function postUpdate(user, spaceName, text) {
  if (!text) return false;
  try {
    await chatUser.createMessage(user.email, spaceName, { text: String(text).slice(0, 4000) }, {
      entityId: user.entityId, userId: user.sub,
    });
    return true;
  } catch (error) {
    logger.warn({ err: error.message, spaceName }, '[tracker] space update not posted');
    return false;
  }
}

function clearCaches() {
  membershipCache.clear();
  membersCache.clear();
  membersInFlight.clear();
}

module.exports = {
  assertMember,
  listMembers,
  cachedMembers,
  knownAudience,
  postUpdate,
  isNotMemberError,
  forbidden,
  clearCaches,
};
