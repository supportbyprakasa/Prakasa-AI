import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, createRealtimeHub, parseSseChunk, HIDDEN_PAUSE_MS, IDLE_CLOSE_MS } from '../src/api/realtimeModel.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeTimers() {
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => [...timers.values()],
    runAll() { const list = [...timers.entries()]; timers.clear(); list.forEach(([, t]) => t.fn()); },
  };
}

// A controllable SSE response body.
function streamResponse() {
  const encoder = new TextEncoder();
  const queue = [];
  let wake = null;
  let closed = false;
  const body = {
    getReader: () => ({
      read: async () => {
        while (!queue.length && !closed) await new Promise((r) => { wake = r; });
        if (queue.length) return { value: encoder.encode(queue.shift()), done: false };
        return { done: true };
      },
      cancel: () => { closed = true; wake?.(); },
    }),
  };
  return {
    response: { ok: true, status: 200, headers: { get: () => 'text/event-stream; charset=utf-8' }, body },
    push(text) { queue.push(text); wake?.(); },
    end() { closed = true; wake?.(); },
  };
}

test('parseSseChunk splits events, ignores comments/pings and keeps the tail', () => {
  const { events, rest } = parseSseChunk(': ping\n\nevent: tracker\ndata: {"a":1}\n\nevent: tracker\ndata: {"b"');
  assert.deepEqual(events, [{ event: 'tracker', data: '{"a":1}' }]);
  assert.equal(rest, 'event: tracker\ndata: {"b"');
});

test('backoffDelay grows exponentially with jitter and caps at 30s', () => {
  assert.equal(backoffDelay(0, () => 0.5), 1000);
  assert.equal(backoffDelay(3, () => 0.5), 8000);
  assert.equal(backoffDelay(20, () => 0.5), 30000);
  assert.ok(backoffDelay(1, () => 0) < backoffDelay(1, () => 1));
});

test('one shared connection delivers parsed JSON to every subscriber of the event', async () => {
  const timers = fakeTimers();
  const stream = streamResponse();
  let calls = 0;
  let sentHeaders = null;
  const hub = createRealtimeHub({
    url: '/api/v1/realtime/stream',
    fetchImpl: async (url, init) => { calls += 1; sentHeaders = init.headers; return stream.response; },
    getToken: () => 'tok',
    ...timers,
  });
  const a = [];
  const b = [];
  hub.subscribe('tracker', (d) => a.push(d));
  hub.subscribe('tracker', (d) => b.push(d));
  hub.subscribe('other', () => {});
  await flush();
  assert.equal(calls, 1);
  assert.equal(sentHeaders.Authorization, 'Bearer tok');
  assert.equal(hub.getStatus(), 'live');
  stream.push('event: tracker\ndata: {"projectId":7}\n\n: ping\n\n');
  await flush(); await flush();
  assert.deepEqual(a, [{ projectId: 7 }]);
  assert.deepEqual(b, [{ projectId: 7 }]);
  hub._close();
});

test('401 stops without retrying (no logout loop)', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const hub = createRealtimeHub({
    url: '/x',
    fetchImpl: async () => { calls += 1; return { ok: false, status: 401, headers: { get: () => 'application/json' } }; },
    getToken: () => 'expired',
    ...timers,
  });
  hub.subscribe('tracker', () => {});
  await flush();
  assert.equal(hub.getStatus(), 'stopped');
  assert.equal(timers.pending().length, 0);
  hub.subscribe('tracker', () => {});
  await flush();
  assert.equal(calls, 1, 'same token is not retried');
});

test('network failure schedules a backoff retry, then reconnect broadcasts a resync', async () => {
  const timers = fakeTimers();
  const stream = streamResponse();
  let calls = 0;
  const hub = createRealtimeHub({
    url: '/x',
    fetchImpl: async () => { calls += 1; if (calls === 2) throw new Error('offline'); return stream.response; },
    getToken: () => 'tok',
    random: () => 0.5,
    ...timers,
  });
  const seen = [];
  hub.subscribe('tracker', (d, meta) => seen.push(meta?.resync ? 'resync' : d));
  await flush();
  assert.equal(hub.getStatus(), 'live');
  stream.end(); // server closed the stream
  await flush(); await flush();
  assert.equal(hub.getStatus(), 'reconnecting');
  assert.equal(timers.pending()[0].ms, 1000);
  timers.runAll(); // attempt 2 fails
  await flush(); await flush();
  assert.equal(timers.pending()[0].ms, 2000);
  const second = streamResponse();
  stream.response.body = second.response.body;
  timers.runAll(); // attempt 3 succeeds
  await flush(); await flush();
  assert.equal(hub.getStatus(), 'live');
  assert.deepEqual(seen, ['resync']);
  hub._close();
});

test('pauses after 60s hidden and resumes with a resync when visible', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const hub = createRealtimeHub({
    url: '/x',
    fetchImpl: async () => { calls += 1; return streamResponse().response; },
    getToken: () => 'tok',
    ...timers,
  });
  const seen = [];
  hub.subscribe('tracker', (d, meta) => seen.push(meta?.resync));
  await flush();
  hub.onVisibilityChange(true);
  assert.equal(timers.pending()[0].ms, HIDDEN_PAUSE_MS);
  timers.runAll();
  assert.equal(hub.getStatus(), 'paused');
  hub.onVisibilityChange(false);
  await flush(); await flush();
  assert.equal(calls, 2);
  assert.equal(hub.getStatus(), 'live');
  assert.deepEqual(seen, [true]);
  hub._close();
});

test('closes the connection a few seconds after the last subscriber leaves', async () => {
  const timers = fakeTimers();
  const hub = createRealtimeHub({ url: '/x', fetchImpl: async () => streamResponse().response, getToken: () => 'tok', ...timers });
  const off = hub.subscribe('tracker', () => {});
  await flush();
  off();
  assert.equal(timers.pending()[0].ms, IDLE_CLOSE_MS);
  timers.runAll();
  assert.equal(hub.getStatus(), 'idle');
});

test('live updates switched off on the server stop for good; a restart 503 is retried', async () => {
  const { createRealtimeHub } = await import('../src/api/realtimeModel.js');
  const mk = (body) => async () => ({ status: 503, ok: false, headers: { get: () => 'application/json' }, json: async () => body });
  const off = createRealtimeHub({ url: '/x', getToken: () => 't', fetchImpl: mk({ error: { code: 'REALTIME_DISABLED' } }), setTimer: () => 1, clearTimer: () => {}, isHidden: () => false });
  off.subscribe('x', () => {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(off.getStatus(), 'stopped');
  const restart = createRealtimeHub({ url: '/x', getToken: () => 't', fetchImpl: mk({ error: { code: 'X' } }), setTimer: () => 1, clearTimer: () => {}, isHidden: () => false });
  restart.subscribe('x', () => {});
  await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(restart.getStatus(), 'stopped');
});
