const test = require('node:test');
const assert = require('node:assert/strict');
const retention = require('../src/services/retention.service');

function fakeDb(plan) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql: String(sql), args });
      const table = /FROM (\w+)/.exec(sql)[1];
      if (/^SELECT COUNT/.test(sql)) return [[{ n: 7 }]];
      const queue = plan[table] || [];
      return [{ affectedRows: queue.length ? queue.shift() : 0 }];
    },
  };
}

test('deletes in batches until a batch comes back short', async () => {
  const db = fakeDb({ integration_logs: [5000, 5000, 12], notifications: [3] });
  const results = await retention.run(db, { env: {}, pauseMs: 0 });
  assert.deepEqual(results, [
    { name: 'integration_logs', days: 90, deleted: 10012 },
    { name: 'notifications_read', days: 180, deleted: 3 },
  ]);
  const deletes = db.calls.filter((c) => c.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 4);
  for (const c of deletes) assert.match(c.sql, /LIMIT \?$/);
  assert.deepEqual(deletes[0].args, [90, 5000]);
  assert.deepEqual(deletes[3].args, [180, 5000]);
});

test('only integration_logs and READ notifications are touched; audit tables never', async () => {
  const db = fakeDb({});
  await retention.run(db, { env: {}, pauseMs: 0 });
  const tables = new Set(db.calls.map((c) => /FROM (\w+)/.exec(c.sql)[1]));
  assert.deepEqual([...tables].sort(), ['integration_logs', 'notifications']);
  for (const c of db.calls) {
    for (const protectedTable of retention.PROTECTED_TABLES) assert.ok(!c.sql.includes(protectedTable), c.sql);
  }
  const notif = db.calls.find((c) => c.sql.includes('FROM notifications'));
  assert.match(notif.sql, /is_read = 1/);
  const logs = db.calls.find((c) => c.sql.includes('FROM integration_logs'));
  assert.match(logs.sql, /NOT LIKE 'setup\.%'/);
});

test('retention days come from env, never below 30 days', async () => {
  const [logs, notif] = retention.policies({ RETENTION_INTEGRATION_LOG_DAYS: '120', RETENTION_NOTIFICATION_DAYS: '5' });
  assert.equal(logs.days, 120);
  assert.equal(notif.days, 180);
});

test('dry run only counts', async () => {
  const db = fakeDb({});
  const results = await retention.run(db, { env: {}, dryRun: true });
  assert.ok(db.calls.every((c) => c.sql.startsWith('SELECT COUNT')));
  assert.deepEqual(results.map((r) => r.wouldDelete), [7, 7]);
});

test('a runaway loop stops at maxBatches', async () => {
  const db = { calls: 0, async query() { this.calls += 1; return [{ affectedRows: 10 }]; } };
  await retention.run(db, { env: {}, batchSize: 10, pauseMs: 0, maxBatches: 3 });
  assert.equal(db.calls, 6);
});
