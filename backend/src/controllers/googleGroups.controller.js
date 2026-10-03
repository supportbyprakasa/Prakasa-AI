const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { handleGoogleError } = require('../services/googleUserClient');
const groups = require('../services/googleGroups.service');

const SCOPES = new Set(['mine', 'all']);
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
// Directory group ids are short lowercase alphanumeric strings.
const GROUP_ID_RE = /^[0-9a-z]{6,40}$/;

function isValidGroupKey(value) {
  const key = String(value || '');
  return EMAIL_RE.test(key) || GROUP_ID_RE.test(key);
}

// Conversations can't be read through any Google API — the page links here.
function conversationUrl(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return null;
  return `https://groups.google.com/a/${encodeURIComponent(domain)}/g/${encodeURIComponent(local)}`;
}

function onError(error, res, next) {
  if (error?.code === 'GOOGLE_ADMIN_NOT_CONFIGURED') {
    return fail(res, 'GOOGLE_ADMIN_NOT_CONFIGURED',
      'Google Groups belum dikonfigurasi (admin Workspace untuk delegasi belum diisi). Hubungi admin.', 503);
  }
  return handleGoogleError(error, res, next, { service: 'Google Groups' });
}

const ctxOf = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });

async function listGroups(req, res, next) {
  const scope = req.query.scope || 'mine';
  if (!SCOPES.has(scope)) return fail(res, 'VALIDATION_ERROR', 'scope harus mine atau all', 400);
  try {
    // "mine" is always the signed-in user — the client can never pick the userKey.
    const list = scope === 'mine'
      ? await groups.listUserGroups(req.user.email, ctxOf(req))
      : await groups.listDomainGroups(ctxOf(req));
    return ok(res, {
      scope,
      groups: list.map((group) => ({ ...group, conversationUrl: conversationUrl(group.email) })),
    });
  } catch (error) { return onError(error, res, next); }
}

// Names come from our own users table when the member has a Prakasa account.
async function resolveNames(emails) {
  const unique = [...new Set(emails.map((email) => email.toLowerCase()).filter(Boolean))];
  if (!unique.length) return new Map();
  const [rows] = await pool.query('SELECT email, name FROM users WHERE LOWER(email) IN (?)', [unique]);
  return new Map((rows || []).map((row) => [String(row.email).toLowerCase(), row.name]));
}

async function getGroup(req, res, next) {
  const { groupKey } = req.params;
  if (!isValidGroupKey(groupKey)) return fail(res, 'VALIDATION_ERROR', 'Grup tidak valid', 400);
  try {
    const group = await groups.getGroup(groupKey, ctxOf(req));
    // The group directory is open to everyone, but WHO is in a group (HR,
    // finance, management lists) is only shown to its own members and admins.
    let canSeeMembers = (req.user.permissions || []).includes('user.manage');
    if (!canSeeMembers) {
      const mine = await groups.listUserGroups(req.user.email, ctxOf(req));
      const key = String(groupKey).toLowerCase();
      canSeeMembers = mine.some((g) => String(g.email || '').toLowerCase() === key || String(g.id || '').toLowerCase() === key
        || String(g.email || '').toLowerCase() === String(group.email || '').toLowerCase());
    }
    let members = [];
    if (canSeeMembers) {
      const raw = await groups.listMembers(groupKey, ctxOf(req));
      const names = await resolveNames(raw.map((member) => member.email));
      members = raw.map((member) => ({ ...member, name: names.get(member.email.toLowerCase()) || null }));
    }
    return ok(res, {
      group: { ...group, conversationUrl: conversationUrl(group.email) },
      canSeeMembers,
      members,
    });
  } catch (error) { return onError(error, res, next); }
}

module.exports = { listGroups, getGroup, isValidGroupKey, conversationUrl };
