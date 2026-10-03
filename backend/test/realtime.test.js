const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const realtime = require('../src/services/realtime.service');
const ctrl = require('../src/controllers/realtime.controller');
const trackerChat = require('../src/services/trackerChat.service');
const tracker = require('../src/services/tracker.service');

function fakeRes() {
  const res = new EventEmitter();
  res.chunks = [];
  res.headers = null;
  res.statusCode = null;
  res.writableEnded = false;
  res.destroyed = false;
  res.write = (chunk) => { res.chunks.push(String(chunk)); return true; };
  res.end = () => { res.writableEnded = true; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (headers) => { res.headers = headers; return res; };
  res.flushHeaders = () => {};
  return res;
}

const events = (res, name) => res.chunks
  .filter((c) => c.startsWith(`event: ${name}\n`))
  .map((c) => JSON.parse(c.split('\n')[1].slice('data: '.length)));

test.afterEach(() => realtime.reset());

test('events reach only clients of the same entity', () => {
  const a = fakeRes();
  const b = fakeRes();
  realtime.addClient({ userId: 1, entityId: 1, res: a });
  realtime.addClient({ userId: 2, entityId: 2, res: b });
  const sent = realtime.publish('tracker', { type: 'issue.created', entityId: 1, projectId: 5, issueId: 9, actorUserId: 1 });
  assert.equal(sent, 1);
  const [event] = events(a, 'tracker');
  assert.equal(event.type, 'issue.created');
  assert.equal(event.projectId, 5);
  assert.ok(event.at, 'timestamp added');
  assert.equal(events(b, 'tracker').length, 0);
});

test('events without a valid entity are dropped and publish never throws', () => {
  const a = fakeRes();
  realtime.addClient({ userId: 1, entityId: 1, res: a });
  assert.equal(realtime.publish('tracker', { type: 'x' }), 0);
  assert.equal(realtime.publish('bad name!', { entityId: 1 }), 0);
  a.write = () => { throw new Error('socket gone'); };
  assert.doesNotThrow(() => realtime.publish('tracker', { entityId: 1 }));
  assert.equal(realtime.clientCount(1), 0, 'broken client removed');
});

test('connections per user are capped; the oldest is closed', () => {
  const list = Array.from({ length: realtime.MAX_CONNECTIONS_PER_USER + 1 }, () => fakeRes());
  for (const res of list) realtime.addClient({ userId: 7, entityId: 1, res });
  assert.equal(realtime.clientCount(7), realtime.MAX_CONNECTIONS_PER_USER);
  assert.equal(list[0].writableEnded, true);
  assert.equal(list.at(-1).writableEnded, false);
});

test('heartbeat pings and cleanup on close', async () => {
  const res = fakeRes();
  const client = realtime.addClient({ userId: 3, entityId: 1, res, heartbeatMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.ok(res.chunks.some((c) => c === ': ping\n\n'));
  realtime.removeClient(client);
  assert.equal(realtime.clientCount(3), 0);
  const before = res.chunks.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(res.chunks.length, before, 'no pings after close');
});

test('the default heartbeat is 20 seconds', () => {
  assert.equal(realtime.HEARTBEAT_MS, 20000);
});

test('stream endpoint sets SSE headers, registers the user and unregisters on close', () => {
  const req = new EventEmitter();
  req.user = { sub: 11, entityId: 4 };
  const res = fakeRes();
  ctrl.stream(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/event-stream/);
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  assert.equal(realtime.clientCount(11), 1);
  assert.equal(events(res, 'ready').length, 1);
  realtime.publish('tracker', { type: 'project.updated', entityId: 4, projectId: 1 });
  assert.equal(events(res, 'tracker').length, 1);
  req.emit('close');
  assert.equal(realtime.clientCount(11), 0);
});

test('in-process subscribers receive published events', () => {
  const seen = [];
  const off = realtime.subscribe('tracker', (data) => seen.push(data.type));
  realtime.publish('tracker', { type: 'sprint.updated', entityId: 1 });
  off();
  realtime.publish('tracker', { type: 'sprint.updated', entityId: 1 });
  assert.deepEqual(seen, ['sprint.updated']);
});

// ---------------------------------------------------------------- audience

function connect(spec) {
  const res = fakeRes();
  realtime.addClient({ entityId: 1, ...spec, res });
  return res;
}

function room() {
  return {
    sales: connect({ userId: 1, departmentId: 5, email: 'Sales@prakasa.test' }),
    finance: connect({ userId: 2, departmentId: 3, email: 'finance@prakasa.test' }),
    office: connect({ userId: 3, departmentId: 9, email: 'mo@prakasa.test', crossDivision: true }),
    noDivision: connect({ userId: 4 }),
    otherEntity: connect({ userId: 5, entityId: 2, departmentId: 5, crossDivision: true }),
  };
}

const got = (clients) => Object.entries(clients).filter(([, res]) => events(res, 'task').length).map(([name]) => name).sort();

test('a division event reaches that division and the cross-division roles only', () => {
  const c = room();
  const sent = realtime.publish('task', { type: 'task.updated', entityId: 1, taskId: 8 }, { departmentId: 5 });
  assert.equal(sent, 2);
  assert.deepEqual(got(c), ['office', 'sales']);
  const [event] = events(c.sales, 'task');
  assert.deepEqual(Object.keys(event).sort(), ['at', 'entityId', 'taskId', 'type'], 'the audience never travels in the payload');
});

test('an event for named users reaches only them (ids or emails), in their entity', () => {
  const c = room();
  assert.equal(realtime.publish('task', { entityId: 1 }, { userIds: [2, '4', 5, 'x'] }), 2);
  assert.deepEqual(got(c), ['finance', 'noDivision'], 'user 5 is another entity; cross-division roles are not added');
  realtime.reset();

  const d = room();
  assert.equal(realtime.publish('task', { entityId: 1 }, { emails: [' SALES@prakasa.test '] }), 1);
  assert.deepEqual(got(d), ['sales']);
  realtime.reset();

  const e = room();
  assert.equal(realtime.publish('task', { entityId: 1 }, { userIds: [] }), 0, 'an empty list is nobody, not everybody');
  assert.deepEqual(got(e), []);
});

test('named users and a division are a union; crossDivision adds the cross-division roles', () => {
  const c = room();
  realtime.publish('task', { entityId: 1 }, { userIds: [2], departmentId: 5 });
  assert.deepEqual(got(c), ['finance', 'office', 'sales']);
  realtime.reset();

  const d = room();
  realtime.publish('task', { entityId: 1 }, { userIds: [2], crossDivision: true });
  assert.deepEqual(got(d), ['finance', 'office']);
});

test('no audience (or an empty one) stays entity-wide; subscribers still get every event', () => {
  const c = room();
  const seen = [];
  realtime.subscribe('task', (data) => seen.push(data.entityId));
  assert.equal(realtime.publish('task', { entityId: 1 }), 4);
  assert.equal(realtime.publish('task', { entityId: 1 }, {}), 4);
  assert.equal(realtime.publish('task', { entityId: 1 }, { departmentId: null }), 4);
  realtime.publish('task', { entityId: 1 }, { userIds: [99] });
  assert.deepEqual(got(c), ['finance', 'noDivision', 'office', 'sales']);
  assert.equal(seen.length, 4, 'the in-process bus is not filtered');
});

test('the stream registers the user with division, email and cross-division role', () => {
  const open = (user) => {
    const req = new EventEmitter();
    req.user = user;
    const res = fakeRes();
    ctrl.stream(req, res);
    return res;
  };
  const member = open({ sub: 21, entityId: 1, departmentId: 5, email: 'a@prakasa.test', permissions: ['task.view'] });
  const other = open({ sub: 22, entityId: 1, departmentId: 3, email: 'b@prakasa.test', permissions: ['task.view'] });
  const office = open({ sub: 23, entityId: 1, departmentId: 9, email: 'c@prakasa.test', permissions: ['management_dashboard.view'] });
  const admin = open({ sub: 24, entityId: 1, departmentId: null, email: 'd@prakasa.test', permissions: ['entity.cross_access'] });
  realtime.publish('task', { entityId: 1 }, { departmentId: 5 });
  assert.deepEqual([member, other, office, admin].map((res) => events(res, 'task').length), [1, 0, 1, 1]);
});

test('tracker events: project members when a local list exists, otherwise entity-wide', (t) => {
  const board = { id: 5, entity_id: 1, department_id: 7, google_chat_space_name: 'spaces/AAAA1234' };
  trackerChat.clearCaches();
  assert.equal(trackerChat.knownAudience('spaces/AAAA1234'), null);
  assert.equal(tracker._audienceFor(board, { sub: 3 }), null, 'no local member list → unchanged');

  t.mock.method(trackerChat, 'knownAudience', () => ({ emails: ['ani@prakasa.test'], userIds: [8] }));
  assert.deepEqual(tracker._audienceFor(board, { sub: 3 }), {
    emails: ['ani@prakasa.test'], userIds: [8, 3], departmentId: 7, crossDivision: true,
  });
  assert.equal(tracker._audienceFor({ ...board, department_id: null }, { sub: 3 }).departmentId, null);
});
