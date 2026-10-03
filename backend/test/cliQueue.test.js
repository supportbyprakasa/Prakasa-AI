const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../src/services/ai/cliQueue');

const env = (vars, t) => {
  const old = {};
  for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; process.env[k] = String(v); }
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
};

test('runs at most N at once; the rest wait in order and are told their place', async (t) => {
  env({ CLAUDE_TEAM_MAX_CONCURRENT: 2, CLAUDE_TEAM_MAX_QUEUE: 5, CLAUDE_TEAM_QUEUE_TIMEOUT_MS: 5000 }, t);
  const q = createQueue();
  const a = await q.acquire();
  const b = await q.acquire();
  const places = [];
  const order = [];
  const c = q.acquire({ onQueue: (p) => places.push(['c', p]) }).then((release) => { order.push('c'); return release; });
  const d = q.acquire({ onQueue: (p) => places.push(['d', p]) }).then((release) => { order.push('d'); return release; });
  assert.deepEqual(q.stats().running, 2);
  assert.deepEqual(q.stats().waiting, 2);
  a();
  const releaseC = await c;
  assert.deepEqual(order, ['c']);
  assert.ok(places.some(([who, p]) => who === 'd' && p === 1), 'd moves up to first in line');
  b();
  const releaseD = await d;
  releaseC(); releaseD();
  releaseC(); // releasing twice does not free an extra slot
  assert.equal(q.stats().running, 0);
});

test('a full line or a long wait fails with a clear message; stopping leaves the line', async (t) => {
  env({ CLAUDE_TEAM_MAX_CONCURRENT: 1, CLAUDE_TEAM_MAX_QUEUE: 1, CLAUDE_TEAM_QUEUE_TIMEOUT_MS: 50 }, t);
  const q = createQueue();
  const held = await q.acquire();
  const waiting = q.acquire();
  await assert.rejects(q.acquire(), (e) => e.code === 'AI_BUSY' && /ramai/.test(e.message));
  await assert.rejects(waiting, (e) => e.code === 'AI_BUSY' && /Antrean/.test(e.message));
  const controller = new AbortController();
  const stopped = q.acquire({ signal: controller.signal });
  controller.abort();
  await assert.rejects(stopped, (e) => e.code === 'GENERATION_STOPPED');
  assert.equal(q.stats().waiting, 0);
  held();
  assert.equal(q.stats().running, 0);
});
