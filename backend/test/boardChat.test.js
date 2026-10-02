const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const googleChat = require('../src/services/googleChat.service');
const taskSvc = require('../src/services/task.service');
const ctrl = require('../src/controllers/boardChat.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function baseBoard() {
  return {
    id: 5, entity_id: 1, department_id: null, name: 'Tim Gudang',
    google_chat_space_name: 'spaces/AAA', google_chat_space_url: 'https://chat.google.com/room/AAA',
  };
}

test('a Space message can only be converted into a task once', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM boards')) return [[baseBoard()]];
    return [{ insertId: 1, affectedRows: 1 }];
  });
  t.mock.method(googleChat, 'getMessage', async () => ({
    name: 'spaces/AAA/messages/BBB', text: 'Tolong siapkan laporan mingguan',
  }));
  t.mock.method(taskSvc, 'finalizeCreatedTask', async () => {});

  let linkExists = false;
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      const s = String(sql);
      if (s.includes('FROM entities')) return [[{ id: 1 }]];
      if (s.includes('FROM boards')) return [[{ boardId: 5, entityId: 1, departmentId: null, isArchived: 0 }]];
      if (s.startsWith('INSERT INTO tasks')) return [{ insertId: 42 }];
      if (s.includes('FROM users')) return [[{ id: 10 }]];
      if (s.startsWith('INSERT IGNORE INTO task_watchers')) return [{ affectedRows: 1 }];
      if (s.startsWith('INSERT INTO task_activity')) return [{ insertId: 1 }];
      if (s.startsWith('INSERT INTO chat_task_links')) {
        if (linkExists) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
        linkExists = true;
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected conn.query: ${s}`);
    },
  };
  t.mock.method(pool, 'getConnection', async () => connection);

  const req = {
    params: { id: '5' },
    body: { messageName: 'spaces/AAA/messages/BBB' },
    user: { sub: 10, entityId: 1, email: 'requester@prakasagroup.com', permissions: ['task.create'] },
  };

  const first = responseDouble();
  await ctrl.convertMessageToTask(req, first, (e) => { throw e; });
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.data.id, 42);

  const second = responseDouble();
  await ctrl.convertMessageToTask(req, second, (e) => { throw e; });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.error.code, 'CONFLICT');
});

test('convert-to-task refuses a board with no linked Google Chat Space', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM boards')) {
      return [[{ id: 6, entity_id: 1, department_id: null, name: 'Tanpa Space', google_chat_space_name: null }]];
    }
    return [{ insertId: 1, affectedRows: 1 }];
  });
  t.mock.method(googleChat, 'getMessage', async () => { throw new Error('must not call Chat API'); });

  const req = {
    params: { id: '6' },
    body: { messageName: 'spaces/AAA/messages/BBB' },
    user: { sub: 10, entityId: 1, email: 'requester@prakasagroup.com', permissions: ['task.create'] },
  };
  const res = responseDouble();
  await ctrl.convertMessageToTask(req, res, (e) => { throw e; });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'SPACE_NOT_LINKED');
});

test('createTask records an externalRef-only trusted source (e.g. a Google Chat message)', async () => {
  const inserted = [];
  const connection = {
    async query(sql, args) {
      const s = String(sql);
      if (s.includes('FROM entities')) return [[{ id: 1 }]];
      if (s.includes('FROM boards')) return [[{ boardId: 5, entityId: 1, departmentId: null, isArchived: 0 }]];
      if (s.startsWith('INSERT INTO tasks')) { inserted.push(args); return [{ insertId: 99 }]; }
      if (s.includes('FROM users')) return [[{ id: 10 }]];
      if (s.startsWith('INSERT IGNORE INTO task_watchers')) return [{ affectedRows: 1 }];
      if (s.startsWith('INSERT INTO task_activity')) return [{ insertId: 1 }];
      throw new Error(`Unexpected query: ${s}`);
    },
  };
  const created = await taskSvc.createTask({
    input: { entityId: 1, boardId: 5, title: 'Dari Space', assigneeId: null },
    user: { sub: 10, entityId: 1, permissions: [] },
    trustedSource: { type: 'chat', id: null, externalRef: 'spaces/AAA/messages/BBB' },
    conn: connection,
  });
  assert.equal(created.id, 99);
  // source_type, source_id, source_external_ref are the last three INSERT columns/values.
  assert.deepEqual(inserted[0].slice(-3), ['chat', null, 'spaces/AAA/messages/BBB']);
});

test('createTask still rejects a trustedSource with neither an id nor an externalRef', async () => {
  const connection = {
    async query(sql) {
      if (String(sql).includes('FROM entities')) return [[{ id: 1 }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    taskSvc.createTask({
      input: { entityId: 1, title: 'x' },
      user: { sub: 10, entityId: 1, permissions: [] },
      trustedSource: { type: 'chat', id: null },
      conn: connection,
    }),
    { code: 'VALIDATION_ERROR' }
  );
});
