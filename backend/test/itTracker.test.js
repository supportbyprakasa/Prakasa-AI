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
  t.mock.method(itTicket, 'updateStatus', async (id, opts) => { steps.push([id, opts.status, opts.fromTracker, opts.entityId]); return {}; });
  db(t, { 'FROM it_tickets WHERE tracker_issue_id': [[{ id: 55, status: 'open', entity_id: 1 }]] });
  const manager = { sub: 3, entityId: 1, permissions: ['it_ticket.manage'] };
  const result = await itTracker.onIssueMoved(900, 'done', manager);
  assert.equal(result.synced, true);
  assert.equal(result.status, 'resolved');
  assert.deepEqual(steps, [[55, 'in_progress', true, 1], [55, 'resolved', true, 1]]);
  steps.length = 0;
  const other = await itTracker.onIssueMoved(900, 'done', { ...manager, entityId: 2 });
  assert.equal(other.synced, false, 'another company: nothing');
  assert.deepEqual(steps, []);
});

test('F23: a Space member without it_ticket.manage cannot move a ticket through the tracker', async (t) => {
  const steps = [];
  t.mock.method(itTicket, 'updateStatus', async (id, opts) => { steps.push([id, opts.status]); return {}; });
  db(t, { 'FROM it_tickets WHERE tracker_issue_id': [[{ id: 55, status: 'open', entity_id: 1 }]] });
  const member = { sub: 8, entityId: 1, permissions: ['google.chat.use'] };
  await assert.rejects(itTracker.assertIssueMove(900, 'done', member), (e) => e.status === 403 && e.code === 'IT_TICKET_LINKED' && /\/it\/tickets\/55/.test(e.message));
  await assert.rejects(itTracker.assertIssueMove(900, 'in_progress', member), { code: 'IT_TICKET_LINKED' });
  const after = await itTracker.onIssueMoved(900, 'done', member);
  assert.equal(after.synced, false, 'the ticket does not follow a move the actor may not make');
  assert.equal(after.reason, 'not_allowed');
  assert.deepEqual(steps, [], 'no ticket step without the permission');
  // A manager of another company is refused the same way.
  await assert.rejects(itTracker.assertIssueMove(900, 'done', { sub: 3, entityId: 2, permissions: ['it_ticket.manage'] }), { code: 'IT_TICKET_LINKED' });
});

test('F23: the tracker follows the ticket lifecycle — closed/cancelled never reopen, worked tickets never return to Open', async (t) => {
  const manager = { sub: 3, entityId: 1, permissions: ['it_ticket.manage'] };
  const cases = [
    ['open', 'in_progress', ['in_progress']],
    ['open', 'done', ['in_progress', 'resolved']],
    ['waiting_on_user', 'done', ['resolved']],
    ['resolved', 'in_progress', ['in_progress']],
    ['resolved', 'done', []],
    ['open', 'todo', []],
  ];
  for (const [status, category, steps] of cases) assert.deepEqual(itTracker.planIssueMove(status, category).steps, steps, `${status} → ${category}`);
  for (const [status, category] of [['closed', 'in_progress'], ['cancelled', 'in_progress'], ['in_progress', 'todo'], ['resolved', 'todo'], ['closed', 'todo']]) {
    assert.ok(itTracker.planIssueMove(status, category).refuse, `${status} → ${category} is refused`);
  }
  for (const status of ['closed', 'cancelled']) {
    t.mock.method(pool, 'query', async () => [[{ id: 55, status, entity_id: 1 }]]);
    await assert.rejects(itTracker.assertIssueMove(900, 'in_progress', manager), { code: 'IT_TICKET_LINKED' });
    pool.query.mock.restore();
  }
  // An issue with no ticket moves freely.
  t.mock.method(pool, 'query', async () => [[]]);
  assert.equal(await itTracker.assertIssueMove(901, 'done', { sub: 8, entityId: 1, permissions: [] }), null);
});

test('a status change that came from the tracker does not move the issue again', async (t) => {
  const moves = [];
  t.mock.method(tracker, 'moveSystemIssue', async () => { moves.push(1); return true; });
  db(t, {
    'SELECT \\* FROM it_tickets WHERE id': [[{ id: 55, status: 'open', entity_id: 1, requester_id: 9, title: 'x' }]],
    'SELECT tracker_issue_id FROM it_tickets': [[{ tracker_issue_id: 900 }]],
  });
  await itTicket.updateStatus(55, { status: 'in_progress', actorId: 3, canManage: true, entityId: 1, fromTracker: true });
  assert.equal(moves.length, 0);
  await itTicket.updateStatus(55, { status: 'in_progress', actorId: 3, canManage: true, entityId: 1 });
  assert.equal(moves.length, 1);
});
