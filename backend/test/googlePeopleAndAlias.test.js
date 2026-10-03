const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const googlePeople = require('../src/services/googlePeople.service');
const chatUser = require('../src/services/googleChatUser.service');
const ctrl = require('../src/controllers/googleChatApp.controller');

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (body, spaceId = 'AAAAxyz123') => ({ user: { sub: 14, entityId: 1, email: 'me@prakasafoods.com' }, params: { spaceId }, body });

test('archiving never erases a name we already know when an account is later seen as deleted', async (t) => {
  let sql = '';
  let rows = null;
  t.mock.method(pool, 'query', async (q, params) => { sql = String(q); rows = params[0]; return [{ affectedRows: 1 }]; });
  await googlePeople.upsert([{ googleId: '123456', email: 'Budi@PrakasaFoods.com', name: 'Budi', isDeleted: true }, { googleId: 'bad', name: 'x' }]);
  assert.match(sql, /name = COALESCE\(VALUES\(name\), name\)/);
  assert.deepEqual(rows, [['123456', 'budi@prakasafoods.com', 'Budi', 1]]);
});

test('a conversation label is trimmed, capped and only saved for a space the user can open', async (t) => {
  const saved = [];
  t.mock.method(chatUser, 'getSpace', async () => ({ name: 'spaces/AAAAxyz123' }));
  t.mock.method(chatUser, 'setAlias', async (userId, spaceName, alias) => { saved.push([userId, spaceName, alias]); return { spaceName, alias }; });
  const r = res();
  await ctrl.setAlias(req({ alias: '  Budi   Santoso ' }), r, (e) => { throw e; });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(saved[0], [14, 'spaces/AAAAxyz123', 'Budi Santoso']);

  const tooLong = res();
  await ctrl.setAlias(req({ alias: 'x'.repeat(121) }), tooLong, (e) => { throw e; });
  assert.equal(tooLong.statusCode, 400);

  const cleared = res();
  await ctrl.setAlias(req({ alias: null }), cleared, (e) => { throw e; });
  assert.deepEqual(saved[1], [14, 'spaces/AAAAxyz123', null]);
});

test('a label cannot be set on a space the user is not in', async (t) => {
  t.mock.method(chatUser, 'getSpace', async () => { throw Object.assign(new Error('Permission denied'), { code: 403, status: 403 }); });
  t.mock.method(chatUser, 'setAlias', async () => { throw new Error('must not save'); });
  const r = res();
  await ctrl.setAlias(req({ alias: 'Budi' }), r, (e) => { throw e; });
  assert.notEqual(r.statusCode, 200);
  assert.notEqual(r.statusCode, 401);
});
