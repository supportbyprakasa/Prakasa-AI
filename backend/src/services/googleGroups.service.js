const { google } = require('googleapis');
const { userAuth } = require('./googleUserClient');
const integrationLog = require('./integrationLog.service');

// Google Groups = the company directory's mailing groups. The Directory API
// only answers when impersonating a Workspace admin (GOOGLE_ADMIN_DELEGATED_USER),
// never the end user — so every call here is read-only and the controller
// decides whose groups are asked for (always req.user.email for "mine").
// Group conversations are NOT available through any Google API; the UI links
// out to groups.google.com for those.
const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group.readonly',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
];
const MAX_GROUPS = 1000;
const MAX_MEMBERS = 2000;

function adminClient() {
  const subject = process.env.GOOGLE_ADMIN_DELEGATED_USER;
  if (!subject) {
    const error = new Error('GOOGLE_ADMIN_DELEGATED_USER belum diisi di .env');
    error.code = 'GOOGLE_ADMIN_NOT_CONFIGURED';
    throw error;
  }
  return google.admin({ version: 'directory_v1', auth: userAuth(subject, SCOPES) });
}

function shapeGroup(group) {
  return {
    id: group.id,
    email: group.email,
    name: group.name || group.email,
    description: group.description || '',
    directMembersCount: Number(group.directMembersCount || 0),
    adminCreated: Boolean(group.adminCreated),
  };
}

function shapeMember(member) {
  return {
    id: member.id || member.email,
    email: member.email || '',
    role: member.role || 'MEMBER',
    type: member.type || 'USER',
    status: member.status || null,
  };
}

async function pagedGroups(params) {
  const admin = adminClient();
  const groups = [];
  let pageToken;
  do {
    const response = await admin.groups.list({ ...params, maxResults: 200, pageToken });
    groups.push(...(response.data.groups || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken && groups.length < MAX_GROUPS);
  return groups.map(shapeGroup).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// Groups the given Workspace user belongs to directly.
async function listUserGroups(email, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_groups',
    operation: 'listUserGroups',
    requestMeta: { userKey: email },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, () => pagedGroups({ userKey: email }));
}

// Every group in the Workspace customer (the company directory).
async function listDomainGroups(ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_groups',
    operation: 'listDomainGroups',
    requestMeta: { customer: 'my_customer' },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, () => pagedGroups({ customer: 'my_customer' }));
}

async function getGroup(groupKey, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_groups',
    operation: 'getGroup',
    requestMeta: { groupKey },
    responseMeta: (result) => ({ id: result?.id }),
  }, async () => {
    const response = await adminClient().groups.get({ groupKey });
    return shapeGroup(response.data);
  });
}

async function listMembers(groupKey, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_groups',
    operation: 'listMembers',
    requestMeta: { groupKey },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const admin = adminClient();
    const members = [];
    let pageToken;
    do {
      const response = await admin.members.list({ groupKey, maxResults: 200, pageToken });
      members.push(...(response.data.members || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken && members.length < MAX_MEMBERS);
    return members.map(shapeMember);
  });
}

module.exports = { listUserGroups, listDomainGroups, getGroup, listMembers, shapeGroup, shapeMember };
