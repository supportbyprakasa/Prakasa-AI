const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const tracker = require('../src/services/tracker.service');
const trackerChat = require('../src/services/trackerChat.service');
const itSupport = require('../src/services/itSupport.service');
const itTicket = require('../src/services/itTicket.service');
const itTracker = require('../src/services/itTracker.service');

// IT tickets ↔ Project Tracker ↔ Google Chat Space.
const BOARD = { id: 4, entity_id: 1, department_id: 7, project_key: 'IT', google_chat_space_name: 'spaces/AAA', post_updates_to_space: 1 };

function db(t, rows = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    calls.push({ sql: text, args });
    for (const [re, value] of Object.entries(rows)) if (new RegExp(re).test(text)) return value;
    if (/^\s*(UPDATE|INSERT)/i.test(text)) return [{ affectedRows: 1, insertId: 1 }];
    return [[]];
  });
  return calls;
}

test('a new ticket becomes an issue in the IT project and is announced in its Space', async (t) => {
  t.mock.method(itSupport, 'getSettings', async () => ({ trackerProjectId: 4, trackerPostAsUserId: 30 }));
  t.mock.method(tracker, 'loadProject', async () => BOARD);
  const created = [];
  t.mock.method(tracker, 'createSystemIssue', async (board, input) => { created.push({ board, input }); return { id: 900, number: 12, key: 'IT-12' }; });
  const posts = [];
  t.mock.method(trackerChat, 'postUpdate', async (user, space, text) => { posts.push({ user, space, text }); return true; });
  const calls = db(t, {
    'FROM users u LEFT JOIN departments': [[{ name: 'Budi', email: 'budi@prakasafoods.com', departmentName: 'Warehouse' }]],
    "FROM users WHERE id = \\? AND status = 'active'": [[{ id: 30, email: 'it.head@prakasafoods.com', entity_id: 1 }]],
  });
  const issue = await itTracker.linkNewTicket({ ticketId: 55, entityId: 1, title: 'Laptop mati', description: 'Tidak menyala', priority: 'urgent', requesterId: 9, sourcePage: '/warehouse' });
  assert.equal(issue.key, 'IT-12');
  assert.equal(created[0].input.title, '[Tiket IT #55] Laptop mati');
  assert.equal(created[0].input.priority, 'urgent');
  assert.deepEqual(created[0].input.labels, ['tiket-it']);
  assert.match(created[0].input.description, /Budi \(Warehouse\)/);
  assert.ok(calls.some((c) => /UPDATE it_tickets SET tracker_issue_id = \?/.test(c.sql) && c.args[0] === 900 && c.args[1] === 55));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].space, 'spaces/AAA');
  assert.equal(posts[0].user.email, 'it.head@prakasafoods.com', 'posted as the IT manager, not the requester');
  assert.match(posts[0].text, /Tiket IT #55 baru · IT-12: Laptop mati/);
});

test('no IT project chosen, or a project of another company: no issue', async (t) => {
  t.mock.method(itSupport, 'getSettings', async () => ({ trackerProjectId: null }));
  const created = [];
  t.mock.method(tracker, 'createSystemIssue', async () => { created.push(1); return { id: 1 }; });
  db(t);
  assert.equal(await itTracker.linkNewTicket({ ticketId: 1, entityId: 1, title: 'x', description: 'y', priority: 'normal', requesterId: 9 }), null);
  itSupport.getSettings.mock.restore();
  t.mock.method(itSupport, 'getSettings', async () => ({ trackerProjectId: 4 }));
  t.mock.method(tracker, 'loadProject', async () => ({ ...BOARD, entity_id: 2 }));
  assert.equal(await itTracker.linkNewTicket({ ticketId: 1, entityId: 1, title: 'x', description: 'y', priority: 'normal', requesterId: 9 }), null);
  assert.equal(created.length, 0);
});

test('ticket status moves the issue to the matching column category', async (t) => {
  const moves = [];
  t.mock.method(tracker, 'moveSystemIssue', async (issueId, category) => { moves.push([issueId, category]); return true; });
  db(t, { 'SELECT tracker_issue_id FROM it_tickets': [[{ tracker_issue_id: 900 }]] });
  for (const status of ['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed', 'cancelled']) await itTracker.onTicketStatus(55, status, 3);
  assert.deepEqual(moves.map((m) => m[1]), ['todo', 'in_progress', 'in_progress', 'done', 'done', 'done']);
});

test('moving the issue moves the ticket (done from open goes through Sedang dikerjakan), never loops back', async (t) => {
  const steps = [];
  t.mock.method(itTicket, 'updateStatus', async (id, opts) => { steps.push([id, opts.status, opts.fromTracker]); return {}; });
  db(t, { 'FROM it_tickets WHERE tracker_issue_id': [[{ id: 55, status: 'open', entity_id: 1 }]] });
  assert.equal(await itTracker.onIssueMoved(900, 'done', { sub: 3, entityId: 1 }), true);
  assert.deepEqual(steps, [[55, 'in_progress', true], [55, 'resolved', true]]);
  steps.length = 0;
  assert.equal(await itTracker.onIssueMoved(900, 'done', { sub: 3, entityId: 2 }), false, 'another company: nothing');
  assert.deepEqual(steps, []);
});

test('a status change that came from the tracker does not move the issue again', async (t) => {
  const moves = [];
  t.mock.method(tracker, 'moveSystemIssue', async () => { moves.push(1); return true; });
  db(t, {
    'SELECT \\* FROM it_tickets WHERE id': [[{ id: 55, status: 'open', entity_id: 1, requester_id: 9, title: 'x' }]],
    'SELECT tracker_issue_id FROM it_tickets': [[{ tracker_issue_id: 900 }]],
  });
  await itTicket.updateStatus(55, { status: 'in_progress', actorId: 3, canManage: true, fromTracker: true });
  assert.equal(moves.length, 0);
  await itTicket.updateStatus(55, { status: 'in_progress', actorId: 3, canManage: true });
  assert.equal(moves.length, 1);
});
