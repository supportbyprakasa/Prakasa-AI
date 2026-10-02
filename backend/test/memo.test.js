const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemo, permissionsHash, scopeKey } = require('../src/utils/memo');
const { mapLimit } = require('../src/utils/mapLimit');

// utils/memo.js — the in-process result cache (load test, 1 Oct 2026).

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const memoOn = (opts = {}) => createMemo({ enabled: true, ...opts });

test('a value is kept for its TTL, then computed again', async () => {
  const m = memoOn();
  let calls = 0;
  const load = async () => { calls += 1; return calls; };
  assert.equal(await m.get('k', 40, load), 1);
  assert.equal(await m.get('k', 40, load), 1, 'within the TTL: cached');
  await tick(60);
  assert.equal(await m.get('k', 40, load), 2, 'after the TTL: computed again');
  assert.equal(m.stats().hits, 1);
  assert.equal(m.stats().misses, 2);
});

test('the TTL may depend on the value (connected 5 min, not yet 30 s)', async () => {
  const m = memoOn();
  let value = false;
  let calls = 0;
  const ttl = (v) => (v ? 10000 : 20);
  const load = async () => { calls += 1; return value; };
  assert.equal(await m.get('src', ttl, load), false);
  value = true;
  await tick(40);
  assert.equal(await m.get('src', ttl, load), true, 'the short "false" TTL ran out');
  value = false;
  await tick(40);
  assert.equal(await m.get('src', ttl, load), true, 'the long "true" TTL still holds');
  assert.equal(calls, 2);
});

test('single-flight: concurrent callers share one computation', async () => {
  const m = memoOn();
  const gate = deferred();
  let calls = 0;
  const load = async () => { calls += 1; return gate.promise; };
  const metas = [{}, {}, {}];
  const all = Promise.all(metas.map((meta) => m.get('dash', 1000, load, meta)));
  await tick();
  gate.resolve({ kpis: 60 });
  const results = await all;
  assert.equal(calls, 1, 'the loader ran once for three callers');
  assert.ok(results.every((r) => r === results[0]));
  assert.deepEqual(metas.map((x) => x.outcome), ['miss', 'shared', 'shared']);
  const meta = {};
  await m.get('dash', 1000, load, meta);
  assert.equal(meta.outcome, 'hit');
});

test('a failed computation is never stored and every waiter sees the error', async () => {
  const m = memoOn();
  let calls = 0;
  const load = async () => { calls += 1; await tick(5); throw new Error('db down'); };
  const results = await Promise.allSettled([m.get('x', 1000, load), m.get('x', 1000, load)]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
  await assert.rejects(m.get('x', 1000, load), /db down/);
  assert.equal(calls, 2, 'the next caller asks again');
  assert.equal(m.has('x'), false);
});

test('keys carry the scope: company, division and exact permissions never share', () => {
  const base = { sub: 1, entityId: 1, departmentId: 2, permissions: ['b.view', 'a.view'] };
  assert.equal(scopeKey(base), scopeKey({ ...base, sub: 9, permissions: ['a.view', 'b.view', 'a.view'] }), 'same scope, any order/duplicates: shared');
  assert.notEqual(scopeKey(base), scopeKey({ ...base, permissions: ['a.view'] }), 'fewer permissions');
  assert.notEqual(scopeKey(base), scopeKey({ ...base, permissions: [...base.permissions, 'sales.data.view_all'] }), 'more permissions');
  assert.notEqual(scopeKey(base), scopeKey({ ...base, departmentId: 3 }), 'another division');
  assert.notEqual(scopeKey(base), scopeKey({ ...base, entityId: 2 }), 'another company');
  assert.notEqual(scopeKey(base, { perUser: true }), scopeKey({ ...base, sub: 9 }, { perUser: true }), 'personal answers: per user');
  assert.equal(permissionsHash([]), permissionsHash(undefined));
  assert.match(permissionsHash(['x.y']), /^[0-9a-f]{16}$/);
});

test('scoped keys keep values apart in the cache', async () => {
  const m = memoOn();
  const head = { entityId: 1, departmentId: 2, permissions: ['management_dashboard.division'] };
  const mgmt = { entityId: 1, departmentId: 2, permissions: ['management_dashboard.view'] };
  assert.equal(await m.get(`mgmt:${scopeKey(head)}|/summary`, 1000, async () => 'division only'), 'division only');
  assert.equal(await m.get(`mgmt:${scopeKey(mgmt)}|/summary`, 1000, async () => 'whole company'), 'whole company');
  assert.equal(await m.get(`mgmt:${scopeKey(head)}|/summary`, 1000, async () => 'recomputed'), 'division only');
});

test('invalidate drops entries by prefix — and a computation running meanwhile is not stored', async () => {
  const m = memoOn();
  await m.get('mgmt:a', 1000, async () => 1);
  await m.get('mgmt:b', 1000, async () => 2);
  await m.get('sales:a', 1000, async () => 3);
  assert.equal(m.invalidate('mgmt:'), 2);
  assert.equal(m.has('mgmt:a'), false);
  assert.equal(m.has('sales:a'), true);

  const gate = deferred();
  const before = m.get('mgmt:c', 1000, () => gate.promise);
  await tick();
  m.invalidate('mgmt:'); // a write committed while the old figures were being read
  let fresh = 0;
  const after = m.get('mgmt:c', 1000, async () => { fresh += 1; return 'new'; });
  gate.resolve('old');
  assert.equal(await before, 'old', 'the caller already waiting gets its answer');
  assert.equal(await after, 'new', 'a caller after the write computes again');
  assert.equal(fresh, 1);
  assert.equal(await m.get('mgmt:c', 1000, async () => 'other'), 'new', 'the stored value is the post-write one');
  assert.equal(m.invalidate(), 2, 'no prefix: everything');
  assert.equal(m.stats().size, 0);
});

test('max entries: the least recently used entry goes first', async () => {
  const m = memoOn({ maxEntries: 3 });
  for (const k of ['a', 'b', 'c']) await m.get(k, 1000, async () => k);
  await m.get('a', 1000, async () => 'x'); // a is used again
  await m.get('d', 1000, async () => 'd');
  assert.equal(m.stats().size, 3);
  assert.equal(m.has('b'), false, 'b was the least recently used');
  assert.equal(m.has('a'), true);
  assert.equal(m.has('d'), true);
  assert.equal(m.stats().evictions, 1);
});

test('switched off (the default under node --test): every call computes', async () => {
  const m = createMemo();
  assert.equal(m.enabled, false, 'tests see fresh values unless a cache is switched on');
  let calls = 0;
  await m.get('k', 1000, async () => { calls += 1; });
  await m.get('k', 1000, async () => { calls += 1; });
  assert.equal(calls, 2);
  m.setEnabled(true);
  assert.equal(m.enabled, true);
});

test('mapLimit: at most N at a time, results in input order, first error rejects', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 3, async (ms, i) => {
    running += 1; peak = Math.max(peak, running);
    await tick(ms * 3);
    running -= 1;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
  await assert.rejects(mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x; }), /boom/);
});
