const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const aiCommand = require('../src/services/aiCommand.service');

const member = { sub: 11, entityId: 1, departmentId: 9, permissions: ['ai_command.use', 'ai_command.department.view'] };
const divisionSession = {
  id: 40, entity_id: 1, department_id: 9, owner_user_id: 77, visibility: 'department',
  status: 'active', deleted_at: null, generation_status: 'idle', ai_module: 'ai_command_center',
};

function fakeTransaction(t, { target }) {
  const statements = [];
  const conn = {
    async beginTransaction() {},
    async commit() { statements.push('COMMIT'); },
    async rollback() { statements.push('ROLLBACK'); },
    release() {},
    async query(sql, args) {
      const text = String(sql);
      statements.push(text.replace(/\s+/g, ' ').trim());
      if (text.includes('FROM ai_sessions')) return [[{ ...divisionSession }]];
      if (text.includes('SELECT id, role, created_by FROM ai_messages')) return [target ? [target] : []];
      if (text.startsWith('UPDATE ai_messages') || text.includes('UPDATE ai_messages')) return [{ affectedRows: 3 }];
      if (text.includes('INSERT INTO ai_messages')) return [{ insertId: 500, args }];
      return [{ affectedRows: 1 }];
    },
  };
  t.mock.method(pool, 'getConnection', async () => conn);
  // Anything after the transaction (AI call, usage logging) fails fast; tests only
  // inspect what happened inside the transaction.
  t.mock.method(pool, 'query', async () => { throw new Error('stop after transaction'); });
  return statements;
}

test('a user outside a division cannot open a chat for that division', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ id: 9 }]]);
  await assert.rejects(
    aiCommand.createSession({ user: { ...member, departmentId: null }, visibility: 'department', departmentId: 9 }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    aiCommand.createSession({ user: { ...member, departmentId: 4 }, visibility: 'department', departmentId: 9 }),
    (error) => error.status === 403,
  );
});

test('an AI administrator may open a chat for any division of the entity', async (t) => {
  const inserts = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    if (String(sql).includes('FROM departments')) return [[{ id: 9 }]];
    if (String(sql).includes('INSERT INTO ai_sessions')) { inserts.push(args); return [{ insertId: 41 }]; }
    return [{ insertId: 1 }];
  });
  const admin = { sub: 2, entityId: 1, departmentId: null, permissions: ['ai_command.use', 'ai_command.admin.view'] };
  const result = await aiCommand.createSession({ user: admin, visibility: 'department', departmentId: 9, title: 'Rapat Warehouse' });
  assert.equal(result.id, 41);
  assert.equal(inserts[0][1], 9, 'department stored on the session');
});

test('only your own user message can be edited', async (t) => {
  fakeTransaction(t, { target: { id: 120, role: 'user', created_by: 77 } });
  await assert.rejects(
    aiCommand.sendMessage({ sessionId: 40, userMessage: 'versi baru', user: member, editMessageId: 120 }),
    (error) => error.status === 403,
  );
});

test('assistant replies and unknown messages cannot be edited', async (t) => {
  fakeTransaction(t, { target: { id: 121, role: 'assistant', created_by: null } });
  await assert.rejects(
    aiCommand.sendMessage({ sessionId: 40, userMessage: 'x', user: member, editMessageId: 121 }),
    (error) => error.status === 400,
  );
  t.mock.restoreAll();
  fakeTransaction(t, { target: null });
  await assert.rejects(
    aiCommand.sendMessage({ sessionId: 40, userMessage: 'x', user: member, editMessageId: 999 }),
    (error) => error.status === 404,
  );
});

test('editing hides the message and everything after it, expires their proposals, and links the new message', async (t) => {
  const statements = fakeTransaction(t, { target: { id: 120, role: 'user', created_by: member.sub } });
  await assert.rejects(aiCommand.sendMessage({ sessionId: 40, userMessage: 'Pertanyaan yang diperbaiki', user: member, editMessageId: 120 }));

  const hide = statements.find((sql) => sql.startsWith('UPDATE ai_messages SET deleted_at=NOW()'));
  assert.ok(hide && hide.includes('id>=?'), 'later messages hidden, not deleted');
  assert.ok(statements.some((sql) => sql.includes("UPDATE ai_action_proposals SET status='expired'")));
  const insertIndex = statements.findIndex((sql) => sql.includes('INSERT INTO ai_messages'));
  assert.ok(statements[insertIndex].includes('edited_from_message_id'));
  assert.ok(statements.indexOf(hide) < insertIndex, 'hide happens before the new message');
  assert.ok(statements.includes('COMMIT'));
  assert.equal(statements.some((sql) => /DELETE FROM ai_messages/i.test(sql)), false);
});
