const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const notif = require('../src/services/notification.service');
const itTicket = require('../src/services/itTicket.service');

function baseTicket(overrides = {}) {
  return {
    id: 5, entity_id: 1, department_id: 9, category: 'device_damage',
    title: 'Laptop tidak menyala', description: 'x', priority: 'normal', status: 'open',
    device_id: null, requester_id: 10,
    ...overrides,
  };
}

test('the IT lifecycle only allows the documented forward transitions', () => {
  assert.deepEqual(itTicket.allowedNextStatuses('open', 'it'), ['in_progress', 'cancelled']);
  assert.deepEqual(itTicket.allowedNextStatuses('in_progress', 'it'), ['waiting_on_user', 'resolved', 'cancelled']);
  assert.deepEqual(itTicket.allowedNextStatuses('waiting_on_user', 'it'), ['in_progress', 'resolved', 'cancelled']);
  assert.deepEqual(itTicket.allowedNextStatuses('resolved', 'it'), ['closed', 'in_progress']);
  assert.deepEqual(itTicket.allowedNextStatuses('closed', 'it'), []);
  assert.deepEqual(itTicket.allowedNextStatuses('cancelled', 'it'), []);
});

test('a requester may only cancel their own ticket, and only while it is still open', () => {
  assert.equal(itTicket.canTransition('open', 'cancelled', 'requester'), true);
  assert.equal(itTicket.canTransition('in_progress', 'cancelled', 'requester'), false);
  assert.equal(itTicket.canTransition('open', 'in_progress', 'requester'), false, 'requester cannot start work themselves');
  assert.equal(itTicket.canTransition('resolved', 'closed', 'requester'), false);
});

test('creating a ticket rejects an unknown category and an empty title or description', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    itTicket.createTicket({ entityId: 1, category: 'not_a_category', title: 'x', description: 'x', requesterId: 10 }),
    { code: 'VALIDATION_ERROR' }
  );
  await assert.rejects(
    itTicket.createTicket({ entityId: 1, category: 'network', title: '  ', description: 'x', requesterId: 10 }),
    { code: 'VALIDATION_ERROR' }
  );
});

test('creating a ticket with a device the requester does not own is rejected', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM devices')) return [[]];
    throw new Error('must not insert');
  });
  await assert.rejects(
    itTicket.createTicket({ entityId: 1, category: 'device_damage', title: 'x', description: 'x', requesterId: 10, deviceId: 99 }),
    { code: 'DEVICE_NOT_OWNED' }
  );
});

test('creating a valid ticket notifies every IT admin in the entity and the requester', async (t) => {
  const notified = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('INSERT INTO it_tickets')) return [{ insertId: 5 }];
    if (s.includes('it_ticket.manage')) return [[{ id: 20 }, { id: 21 }]];
    return [{ affectedRows: 1 }];
  });
  t.mock.method(notif, 'create', async (payload) => { notified.push(payload); return 1; });

  const result = await itTicket.createTicket({
    entityId: 1, departmentId: 9, category: 'network', title: 'Wifi mati', description: 'x', requesterId: 10,
  });

  assert.equal(result.id, 5);
  const recipientIds = notified.map((n) => n.userId).sort();
  assert.deepEqual(recipientIds, [10, 20, 21]);
  assert.ok(notified.every((n) => n.subjectId === 5 && n.actionUrl === '/it/tickets/5'));
});

test('listing tickets scopes to the caller unless they can manage all tickets', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    queries.push([String(sql), args]);
    if (String(sql).includes('COUNT(*)')) return [[{ total: 0 }]];
    return [[]];
  });

  await itTicket.listTickets({ entityId: 1, requesterId: 10, canManage: false });
  const [selfSql, selfArgs] = queries[0];
  assert.match(selfSql, /t\.requester_id = \?/);
  assert.ok(selfArgs.includes(10));

  queries.length = 0;
  await itTicket.listTickets({ entityId: 1, requesterId: 10, canManage: true });
  const [allSql] = queries[0];
  assert.doesNotMatch(allSql, /t\.requester_id = \?/);
});

test('a ticket cannot be opened by anyone other than its requester or IT', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM it_tickets t')) return [[baseTicket()]];
    return [[]];
  });
  await assert.rejects(
    itTicket.getTicket(5, { userId: 999, canManage: false, entityId: 1 }),
    { code: 'FORBIDDEN' }
  );
  const own = await itTicket.getTicket(5, { userId: 10, canManage: false, entityId: 1 });
  assert.equal(own.id, 5);
});

test('an invalid status transition is rejected before any write', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('SELECT * FROM it_tickets')) return [[baseTicket({ status: 'closed' })]];
    throw new Error('must not write after a closed ticket');
  });
  await assert.rejects(
    itTicket.updateStatus(5, { status: 'in_progress', actorId: 1, canManage: true, entityId: 1 }),
    { code: 'INVALID_TRANSITION' }
  );
});

test('IT resolving a ticket notifies only the requester, not the whole IT team', async (t) => {
  const notified = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('SELECT * FROM it_tickets')) return [[baseTicket({ status: 'in_progress' })]];
    return [{ affectedRows: 1 }];
  });
  t.mock.method(notif, 'create', async (payload) => { notified.push(payload); return 1; });

  await itTicket.updateStatus(5, { status: 'resolved', actorId: 30, canManage: true, entityId: 1 });
  assert.deepEqual(notified.map((n) => n.userId), [10]);
  assert.match(notified[0].title, /Selesai/);
});

test('a requester cancelling their own ticket notifies the IT team, not themselves', async (t) => {
  const notified = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('SELECT * FROM it_tickets')) return [[baseTicket({ status: 'open' })]];
    if (s.includes('it_ticket.manage')) return [[{ id: 20 }, { id: 21 }]];
    return [{ affectedRows: 1 }];
  });
  t.mock.method(notif, 'create', async (payload) => { notified.push(payload); return 1; });

  await itTicket.updateStatus(5, { status: 'cancelled', actorId: 10, canManage: false, entityId: 1 });
  assert.deepEqual(notified.map((n) => n.userId).sort(), [20, 21]);
});

test('a requester cannot cancel someone else\'s ticket', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).startsWith('SELECT * FROM it_tickets')) return [[baseTicket({ status: 'open', requester_id: 10 })]];
    throw new Error('must not write');
  });
  await assert.rejects(
    itTicket.updateStatus(5, { status: 'cancelled', actorId: 999, canManage: false, entityId: 1 }),
    { code: 'FORBIDDEN' }
  );
});

test('an empty comment is rejected', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    itTicket.addComment(5, { authorId: 10, body: '   ', canManage: false, entityId: 1 }),
    { code: 'VALIDATION_ERROR' }
  );
});

test('a comment from IT notifies the requester; a comment from the requester notifies IT', async (t) => {
  const notified = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('SELECT * FROM it_tickets')) return [[baseTicket()]];
    if (s.startsWith('INSERT INTO it_ticket_comments')) return [{ insertId: 1 }];
    if (s.includes('it_ticket.manage')) return [[{ id: 20 }]];
    return [[]];
  });
  t.mock.method(notif, 'create', async (payload) => { notified.push(payload); return 1; });

  await itTicket.addComment(5, { authorId: 30, body: 'Sudah dicek', canManage: true, entityId: 1 });
  assert.deepEqual(notified.map((n) => n.userId), [10]);

  notified.length = 0;
  await itTicket.addComment(5, { authorId: 10, body: 'Masih belum jalan', canManage: false, entityId: 1 });
  assert.deepEqual(notified.map((n) => n.userId), [20]);
});

// F24: a ticket of another company reads as "not found" for every actor, IT
// managers included, before any comment, attachment, upload or notification.
function crossEntityDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const s = String(sql);
    calls.push({ sql: s, args });
    // The ticket exists, but in entity 2: a query scoped to entity 1 finds nothing.
    if (/FROM it_tickets/.test(s)) return [/entity_id\s*=\s*\?/.test(s) && Number(args[1]) === 2 ? [baseTicket({ entity_id: 2 })] : []];
    return [[]];
  });
  const notified = [];
  t.mock.method(notif, 'create', async (payload) => { notified.push(payload); return 1; });
  return { calls, notified };
}

test('F24: an IT manager of entity 1 cannot read, move or comment on a ticket of entity 2', async (t) => {
  const { calls, notified } = crossEntityDb(t);
  const manager = { canManage: true, entityId: 1 };
  await assert.rejects(itTicket.getTicket(5, { userId: 30, ...manager }), { code: 'NOT_FOUND' });
  await assert.rejects(itTicket.updateStatus(5, { status: 'in_progress', actorId: 30, ...manager }), { code: 'NOT_FOUND' });
  await assert.rejects(itTicket.addComment(5, { authorId: 30, body: 'cek', ...manager }), { code: 'NOT_FOUND' });
  assert.ok(calls.every((c) => !/it_ticket_comments|it_ticket_attachments/.test(c.sql)), 'no child rows were read or written');
  assert.ok(calls.every((c) => !/^\s*(UPDATE|INSERT)/.test(c.sql)), 'nothing was written');
  assert.ok(calls.filter((c) => /FROM it_tickets/.test(c.sql)).every((c) => /entity_id/.test(c.sql)), 'every ticket read is scoped to the entity');
  assert.deepEqual(notified, []);
  // The same ticket opens for a manager of its own entity.
  const own = await itTicket.getTicket(5, { userId: 30, canManage: true, entityId: 2 });
  assert.equal(own.id, 5);
});

test('F24: without the actor entity the service refuses instead of reading by id alone', async (t) => {
  const { calls } = crossEntityDb(t);
  await assert.rejects(itTicket.getTicket(5, { userId: 30, canManage: true }), { code: 'NOT_FOUND' });
  await assert.rejects(itTicket.updateStatus(5, { status: 'in_progress', actorId: 30, canManage: true }), { code: 'NOT_FOUND' });
  assert.equal(calls.length, 0);
});

test('F24: an attachment upload to a ticket of another entity never reaches Drive', async (t) => {
  crossEntityDb(t);
  const drive = require('../src/services/googleDrive.service');
  const upload = t.mock.method(drive, 'uploadFile', async () => ({ id: 'x' }));
  const ctrl = require('../src/controllers/itTickets.controller');
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await ctrl.uploadAttachment({
    params: { id: '5' }, file: { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 1 },
    user: { sub: 30, entityId: 1, permissions: ['it_ticket.manage'] },
  }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 404);
  assert.equal(upload.mock.callCount(), 0);
});

test('F24: a status change that lost a race is refused, not applied over the newer status', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.startsWith('SELECT * FROM it_tickets')) return [[baseTicket({ status: 'in_progress' })]];
    if (s.startsWith('UPDATE it_tickets')) return [{ affectedRows: 0 }];
    throw new Error('must not continue');
  });
  await assert.rejects(itTicket.updateStatus(5, { status: 'resolved', actorId: 30, canManage: true, entityId: 1 }), { code: 'STALE_STATUS' });
});
