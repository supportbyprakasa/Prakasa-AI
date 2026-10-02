const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const groups = require('../src/services/googleGroups.service');
const ctrl = require('../src/controllers/googleGroups.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const user = (overrides = {}) => ({ sub: 14, entityId: 1, email: 'me@prakasafoods.com', permissions: ['google.groups.view'], ...overrides });
const rethrow = (error) => { throw error; };

test('"mine" always asks Google for the signed-in user, ignoring any userKey from the client', async (t) => {
  let asked = null;
  t.mock.method(groups, 'listUserGroups', async (email) => { asked = email; return [{ id: 'g1', email: 'sales@prakasafoods.com', name: 'Sales' }]; });
  t.mock.method(groups, 'listDomainGroups', async () => { throw new Error('must not be called'); });

  const res = responseDouble();
  await ctrl.listGroups({ user: user(), query: { scope: 'mine', userKey: 'boss@prakasafoods.com' } }, res, rethrow);

  assert.equal(res.statusCode, 200);
  assert.equal(asked, 'me@prakasafoods.com');
  assert.equal(res.body.data.scope, 'mine');
  assert.equal(res.body.data.groups[0].conversationUrl, 'https://groups.google.com/a/prakasafoods.com/g/sales');
});

test('"all" lists the domain directory', async (t) => {
  t.mock.method(groups, 'listDomainGroups', async () => [{ id: 'g1', email: 'a@x.com', name: 'A' }, { id: 'g2', email: 'b@x.com', name: 'B' }]);
  const res = responseDouble();
  await ctrl.listGroups({ user: user(), query: { scope: 'all' } }, res, rethrow);
  assert.equal(res.body.data.groups.length, 2);
});

test('an unknown scope is rejected before calling Google', async (t) => {
  t.mock.method(groups, 'listUserGroups', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.listGroups({ user: user(), query: { scope: 'everyone' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('group keys are validated (email or directory id only)', () => {
  assert.equal(ctrl.isValidGroupKey('sales@prakasafoods.com'), true);
  assert.equal(ctrl.isValidGroupKey('03as4ipq1fbd5rx'), true);
  assert.equal(ctrl.isValidGroupKey('../users'), false);
  assert.equal(ctrl.isValidGroupKey('a b@x.com'), false);
  assert.equal(ctrl.isValidGroupKey(''), false);
});

test('group detail rejects an invalid key without calling Google', async (t) => {
  t.mock.method(groups, 'getGroup', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.getGroup({ user: user(), params: { groupKey: 'x?y=1' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
});

test('group detail resolves member names from our users table by email (case-insensitive)', async (t) => {
  t.mock.method(groups, 'getGroup', async () => ({ id: 'g1', email: 'ops@prakasafoods.com', name: 'Ops', directMembersCount: 2 }));
  t.mock.method(groups, 'listMembers', async () => [
    { id: 'm1', email: 'Budi@PrakasaFoods.com', role: 'OWNER', type: 'USER' },
    { id: 'm2', email: 'outside@gmail.com', role: 'MEMBER', type: 'USER' },
  ]);
  let queried = null;
  t.mock.method(pool, 'query', async (sql, params) => { queried = params[0]; return [[{ email: 'budi@prakasafoods.com', name: 'Budi Santoso' }]]; });

  t.mock.method(groups, 'listUserGroups', async () => [{ id: 'g1', email: 'ops@prakasafoods.com' }]);
  const res = responseDouble();
  await ctrl.getGroup({ user: user(), params: { groupKey: 'ops@prakasafoods.com' } }, res, rethrow);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSeeMembers, true);
  assert.deepEqual(queried, ['budi@prakasafoods.com', 'outside@gmail.com']);
  assert.equal(res.body.data.members[0].name, 'Budi Santoso');
  assert.equal(res.body.data.members[1].name, null);
  assert.equal(res.body.data.group.conversationUrl, 'https://groups.google.com/a/prakasafoods.com/g/ops');
});

test('a missing delegated admin is a clear setup error, not a crash', async (t) => {
  t.mock.method(groups, 'listUserGroups', async () => { throw Object.assign(new Error('x'), { code: 'GOOGLE_ADMIN_NOT_CONFIGURED' }); });
  const res = responseDouble();
  await ctrl.listGroups({ user: user(), query: {} }, res, rethrow);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_ADMIN_NOT_CONFIGURED');
});

test('a Google 401 never reaches the browser as a 401', async (t) => {
  t.mock.method(groups, 'listDomainGroups', async () => { throw Object.assign(new Error('Not Authorized to access this resource/api'), { code: 401, status: 401 }); });
  const res = responseDouble();
  await ctrl.listGroups({ user: user(), query: { scope: 'all' } }, res, rethrow);
  assert.notEqual(res.statusCode, 401);
});

test('service shaping keeps only the fields the page needs', () => {
  assert.deepEqual(groups.shapeGroup({ id: 'g', email: 'e@x.com', name: '', directMembersCount: '7', etag: 'secret', aliases: ['z'] }), {
    id: 'g', email: 'e@x.com', name: 'e@x.com', description: '', directMembersCount: 7, adminCreated: false,
  });
  assert.deepEqual(groups.shapeMember({ email: 'm@x.com', role: 'MANAGER', type: 'USER', status: 'ACTIVE', etag: 'x' }), {
    id: 'm@x.com', email: 'm@x.com', role: 'MANAGER', type: 'USER', status: 'ACTIVE',
  });
});

test('members of a group are hidden from users who are not in it (and not admins)', async (t) => {
  t.mock.method(groups, 'getGroup', async () => ({ id: 'g9', email: 'hr-private@prakasafoods.com', name: 'HR', directMembersCount: 4 }));
  t.mock.method(groups, 'listUserGroups', async () => [{ id: 'g1', email: 'all@prakasafoods.com' }]);
  t.mock.method(groups, 'listMembers', async () => { throw new Error('must not be called'); });
  const res = responseDouble();
  await ctrl.getGroup({ user: user(), params: { groupKey: 'hr-private@prakasafoods.com' } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canSeeMembers, false);
  assert.deepEqual(res.body.data.members, []);
});

test('admins (user.manage) can see members of any group', async (t) => {
  t.mock.method(groups, 'getGroup', async () => ({ id: 'g9', email: 'hr-private@prakasafoods.com', name: 'HR' }));
  t.mock.method(groups, 'listUserGroups', async () => { throw new Error('must not be called'); });
  t.mock.method(groups, 'listMembers', async () => [{ id: 'm1', email: 'a@prakasafoods.com', role: 'MEMBER', type: 'USER' }]);
  t.mock.method(pool, 'query', async () => [[]]);
  const res = responseDouble();
  await ctrl.getGroup({ user: user({ permissions: ['google.groups.view', 'user.manage'] }), params: { groupKey: 'hr-private@prakasafoods.com' } }, res, rethrow);
  assert.equal(res.body.data.canSeeMembers, true);
  assert.equal(res.body.data.members.length, 1);
});
