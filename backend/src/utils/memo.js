const crypto = require('crypto');

// In-process result cache with single-flight (load test, 1 Oct 2026).
//
// The API runs as ONE Node process on shared hosting, so a plain Map is the
// cache: no Redis, nothing to operate. Each entry is key → { value, expiresAt }.
// While a value is being computed, every other caller of the same key waits
// for that one computation (single-flight) instead of starting its own — the
// load test showed twenty dashboards asking MySQL the same sixty questions at
// once. A failed computation is never stored: the next caller asks again.
//
// Keys carry their scope. Anything that depends on who asks must put the
// company, the division and the caller's permissions (scopeKey) — or the user
// id — into the key, so a value never crosses scopes. Values are shared
// between callers: treat them as read-only.
//
// Invalidation is by key prefix (invalidate('mgmt:')), called by the writes
// that change the figures: an approved Accurate batch, a saved target or
// escalation follow-up, and the like. A computation that was running when its
// key was invalidated still answers the callers already waiting, but its
// result is not stored.
//
// RESULT_CACHE=0 in .env turns every cache off (kill switch).
// Under `node --test` every cache is off unless MEMO_IN_TESTS=1, so tests that
// change rows and read the figures again keep seeing fresh values; the cache's
// own tests switch it on per instance.

const DEFAULT_MAX_ENTRIES = 1000;
const testRun = () => Boolean(process.env.NODE_TEST_CONTEXT) && process.env.MEMO_IN_TESTS !== '1';
// RESULT_CACHE=0 switches every in-process cache off (an operations kill switch).
const switchedOff = () => process.env.RESULT_CACHE === '0' || testRun();

function createMemo({ name = 'memo', maxEntries = DEFAULT_MAX_ENTRIES, enabled = null } = {}) {
  const store = new Map(); // key → { value, expiresAt }   (Map order = least recently used first)
  const inflight = new Map(); // key → { promise }
  const counters = { hits: 0, misses: 0, shared: 0, stored: 0, evictions: 0, invalidated: 0, errors: 0 };
  let on = enabled;

  const isEnabled = () => (on == null ? !switchedOff() : Boolean(on));

  function evictIfFull() {
    if (store.size < maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
    while (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
      counters.evictions += 1;
    }
  }

  function set(key, value, ttlMs) {
    if (!(ttlMs > 0)) return;
    store.delete(key);
    evictIfFull();
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    counters.stored += 1;
  }

  /**
   * The cached value of `key`, or the result of `loader()` — computed once for
   * every concurrent caller. `ttl` is milliseconds, or a function of the value
   * (e.g. "true for 5 minutes, false for 30 seconds"). `meta.outcome` tells the
   * caller whether it was a 'hit', 'shared' (joined a running computation) or
   * 'miss' (ran the loader itself).
   */
  async function get(key, ttl, loader, meta = null) {
    if (!isEnabled()) {
      if (meta) meta.outcome = 'off';
      return loader();
    }
    const hit = store.get(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        counters.hits += 1;
        // Least recently used goes first when the cache is full.
        store.delete(key);
        store.set(key, hit);
        if (meta) meta.outcome = 'hit';
        return hit.value;
      }
      store.delete(key);
    }
    const running = inflight.get(key);
    if (running) {
      counters.shared += 1;
      if (meta) meta.outcome = 'shared';
      return running.promise;
    }
    counters.misses += 1;
    if (meta) meta.outcome = 'miss';
    const entry = {};
    entry.promise = Promise.resolve().then(loader);
    inflight.set(key, entry);
    try {
      const value = await entry.promise;
      // Invalidated meanwhile: answer, but do not keep a value computed before the write.
      if (inflight.get(key) === entry) set(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
      return value;
    } catch (error) {
      counters.errors += 1;
      throw error;
    } finally {
      if (inflight.get(key) === entry) inflight.delete(key);
    }
  }

  /** Drops every entry (and running computation) whose key starts with `prefix`; all without one. */
  function invalidate(prefix = '') {
    let n = 0;
    for (const map of [store, inflight]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) {
          map.delete(key);
          n += 1;
        }
      }
    }
    counters.invalidated += n;
    return n;
  }

  function stats() {
    return { name, enabled: isEnabled(), size: store.size, inflight: inflight.size, maxEntries, ...counters };
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  return {
    get,
    invalidate,
    stats,
    clear,
    has: (key) => Boolean(store.get(key) && store.get(key).expiresAt > Date.now()),
    setEnabled: (value) => { on = value; },
    get enabled() { return isEnabled(); },
  };
}

// The application's shared cache. Namespaces (key prefixes) in use:
//   mgmt:      management dashboard, division dashboard, escalations, targets
//   mgmtkpi:   one KPI / metric figure of one company + division (no user)
//   esc:       one escalation source's open items of one company + division
//   series:    a division dashboard series (12 months of one metric)
//   sales:     Sales pages (per user: their own customers and names)
//   salesSrc:  whether approved Accurate Sales data has arrived (per company)
//   retail:    Retail Commerce pages
//   marketing: Marketing insights
//   finance:   Finance receivables / payables reports
//   warehouse: Warehouse stock and reconciliation
//   brief:     the home page's morning briefing (per user; services/morningBriefing.service.js)
//   review:    the automatic findings of one Accurate batch (services/accurateBatchReview.service.js)
const memo = createMemo({ name: 'app', maxEntries: 2000 });

/** Order-independent short hash of a permission list. */
function permissionsHash(permissions) {
  const list = [...new Set((permissions || []).map(String))].sort();
  return crypto.createHash('sha1').update(list.join(',')).digest('hex').slice(0, 16);
}

/**
 * The part of a cache key that pins a value to who may see it: company,
 * division and the exact set of permissions — plus the user when the answer
 * is personal (their own customers, their names).
 */
function scopeKey(user, { perUser = false } = {}) {
  const parts = [
    `e${user?.entityId ?? '-'}`,
    `d${user?.departmentId ?? '-'}`,
    `p${permissionsHash(user?.permissions)}`,
  ];
  if (perUser) parts.push(`u${user?.sub ?? '-'}`);
  return parts.join('|');
}

/**
 * Every change to the mirrored Accurate data (an approved batch) or to the
 * figures built on it: drops everything derived from them. Cheap — the caches
 * refill on the next read.
 */
const FIGURE_NAMESPACES = Object.freeze(['mgmt:', 'mgmtkpi:', 'esc:', 'series:', 'sales:', 'salesSrc:', 'retail:', 'marketing:', 'finance:', 'warehouse:', 'brief:', 'review:']);
function invalidateFigures() {
  return FIGURE_NAMESPACES.reduce((n, prefix) => n + memo.invalidate(prefix), 0);
}

module.exports = {
  createMemo, memo, permissionsHash, scopeKey, invalidateFigures, FIGURE_NAMESPACES,
};
