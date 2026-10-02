// One shared fetch-based SSE connection per tab (GET /realtime/stream).
// Pure and dependency-injected so it can be unit tested without a browser
// (test/realtimeModel.test.js); src/api/realtime.js wires it to the window.
//
// Behaviour
// - Connects lazily when the first subscriber arrives; closes 5s after the last leaves.
// - Reconnects with exponential backoff + jitter (1s → 30s cap), reset after a healthy stream.
// - 401/403/503 (realtime switched off): stops for good (no logout loop). A later subscribe with a different token retries.
// - Tab hidden > 60s: disconnects ("paused"); when visible again it reconnects and every
//   subscriber receives (null, { resync: true }) so it can refetch what it shows.

export function parseSseChunk(buffer) {
  const normalized = String(buffer || '').replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop();
  const events = [];
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

export function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}

export const HIDDEN_PAUSE_MS = 60000;
export const IDLE_CLOSE_MS = 5000;
const HEALTHY_MS = 15000;

export function createRealtimeHub({
  url,
  fetchImpl,
  getToken,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  random = Math.random,
  isHidden = () => false,
}) {
  const listeners = new Map(); // eventName → Set<handler>
  const statusListeners = new Set();
  let status = 'idle'; // idle | connecting | live | reconnecting | paused | stopped
  let controller = null;
  let attempt = 0;
  let retryTimer = null;
  let idleTimer = null;
  let hiddenTimer = null;
  let stoppedToken = null;
  let connectedOnce = false;
  let generation = 0;

  const subscriberCount = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of statusListeners) fn(status);
  }

  function dispatch(event, data, meta) {
    for (const fn of [...(listeners.get(event) || [])]) {
      try { fn(data, meta); } catch { /* one bad subscriber never breaks the stream */ }
    }
  }

  function broadcastResync() {
    for (const [event] of listeners) dispatch(event, null, { resync: true });
  }

  function clearRetry() { if (retryTimer) { clearTimer(retryTimer); retryTimer = null; } }

  function abort() {
    generation += 1;
    if (controller) { try { controller.abort(); } catch { /* ignore */ } }
    controller = null;
  }

  function scheduleRetry() {
    clearRetry();
    if (!subscriberCount() || status === 'stopped' || status === 'paused') return;
    setStatus('reconnecting');
    const delay = backoffDelay(attempt, random);
    attempt += 1;
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, delay);
  }

  async function connect() {
    clearRetry();
    if (!subscriberCount() || controller) return;
    if (isHidden() && status === 'paused') return;
    const token = getToken();
    if (!token) { stoppedToken = null; setStatus('stopped'); return; }
    if (status === 'stopped' && stoppedToken === token) return;
    const myGen = ++generation;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    controller = ctrl || {};
    setStatus(connectedOnce ? 'reconnecting' : 'connecting');
    const startedAt = now();
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        signal: ctrl?.signal,
        cache: 'no-store',
      });
      if (myGen !== generation) return;
      // 401/403, or live updates switched off on the server (shared hosting:
      // REALTIME_ENABLED=0 → 503 REALTIME_DISABLED): stop, never retry. Any
      // other 503 (a restart) is retried like a network error.
      let disabled = false;
      if (response.status === 503) {
        try { disabled = (await response.json())?.error?.code === 'REALTIME_DISABLED'; } catch { disabled = false; }
      }
      if (response.status === 401 || response.status === 403 || disabled) {
        controller = null;
        stoppedToken = token;
        setStatus('stopped');
        return;
      }
      const type = response.headers?.get?.('content-type') || '';
      if (!response.ok || !response.body || !type.includes('text/event-stream')) throw new Error(`HTTP ${response.status}`);
      const wasConnected = connectedOnce;
      connectedOnce = true;
      setStatus('live');
      if (wasConnected) broadcastResync();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (myGen !== generation) { try { reader.cancel(); } catch { /* ignore */ } return; }
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const { event, data } of parsed.events) {
          let payload = data;
          try { payload = JSON.parse(data); } catch { /* keep raw text */ }
          dispatch(event, payload, { resync: false });
        }
      }
      throw new Error('stream ended');
    } catch {
      if (myGen !== generation) return; // aborted on purpose
      controller = null;
      if (now() - startedAt > HEALTHY_MS) attempt = 0;
      scheduleRetry();
    }
  }

  function disconnect(nextStatus) {
    clearRetry();
    abort();
    setStatus(nextStatus);
  }

  function ensureConnected() {
    if (idleTimer) { clearTimer(idleTimer); idleTimer = null; }
    if (status === 'stopped') {
      const token = getToken();
      if (!token || token === stoppedToken) return;
      status = 'idle';
    }
    if (status === 'paused') return;
    if (!controller && !retryTimer) connect();
  }

  function subscribe(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    ensureConnected();
    return () => {
      const set = listeners.get(event);
      set?.delete(handler);
      if (set && !set.size) listeners.delete(event);
      if (!subscriberCount() && !idleTimer) {
        idleTimer = setTimer(() => {
          idleTimer = null;
          if (!subscriberCount()) { attempt = 0; disconnect(status === 'stopped' ? 'stopped' : 'idle'); }
        }, IDLE_CLOSE_MS);
      }
    };
  }

  function onVisibilityChange(hidden) {
    if (hidden) {
      if (hiddenTimer) clearTimer(hiddenTimer);
      hiddenTimer = setTimer(() => {
        hiddenTimer = null;
        if (status !== 'stopped' && status !== 'idle') disconnect('paused');
      }, HIDDEN_PAUSE_MS);
      return;
    }
    if (hiddenTimer) { clearTimer(hiddenTimer); hiddenTimer = null; }
    if (status === 'paused') {
      status = 'idle';
      attempt = 0;
      connectedOnce = true; // the next successful open broadcasts a resync
      if (subscriberCount()) connect();
    }
  }

  return {
    subscribe,
    onVisibilityChange,
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    getStatus: () => status,
    // test helpers
    _subscriberCount: subscriberCount,
    _close: () => disconnect('idle'),
  };
}
