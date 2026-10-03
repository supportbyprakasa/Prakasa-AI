const { memo, scopeKey } = require('../utils/memo');

// Response cache for heavy read endpoints (dashboards, reports), on top of
// utils/memo.js. The key is the namespace, the caller's scope — company,
// division, a hash of their exact permissions, and their user id when the
// answer is personal — and the full URL with its query string. Two callers
// share an answer only when everything that decides what they may see is the
// same; a 200 is cached, nothing else.
//
// Single-flight: while the first caller's handler runs, the others with the
// same key wait for its answer instead of running the same queries. If that
// handler fails (an error status, or no JSON at all), each waiter runs the
// handler itself.
//
// Mount after requireAuth (it needs req.user) and after requirePermission.
function cachedResponse(namespace, ttlMs, { perUser = false } = {}) {
  if (!/^[a-z][A-Za-z]*:$/.test(namespace)) throw new Error(`cachedResponse: namespace "${namespace}" harus diakhiri ":"`);
  return function cachedResponseMiddleware(req, res, next) {
    if (req.method !== 'GET' || !req.user || !memo.enabled) return next();
    const key = `${namespace}${scopeKey(req.user, { perUser })}|${req.originalUrl}`;
    let leader = false;
    const run = () => new Promise((resolve, reject) => {
      leader = true;
      res.setHeader('X-Cache', 'miss');
      const json = res.json.bind(res);
      let settled = false;
      res.json = (body) => {
        res.json = json;
        settled = true;
        if (res.statusCode === 200) resolve(body);
        else reject(Object.assign(new Error('not cacheable'), { notCacheable: true }));
        return json(body);
      };
      res.on('close', () => {
        if (!settled) reject(Object.assign(new Error('no JSON answer'), { notCacheable: true }));
      });
      next();
    });
    const meta = {};
    memo.get(key, ttlMs, run, meta).then((body) => {
      if (leader || res.headersSent) return;
      res.setHeader('X-Cache', meta.outcome === 'hit' ? 'hit' : 'shared');
      res.status(200).json(body);
    }, (error) => {
      if (leader) {
        // The handler answered (or failed) on its own; only an unexpected
        // failure of the cache itself is passed on.
        if (!error?.notCacheable && !res.headersSent) next(error);
        return;
      }
      if (res.headersSent) return;
      next();
    });
  };
}

/**
 * After a successful write (any non-GET answered below 400), drops the cached
 * answers built on what it may have changed. Mounted per module router.
 */
function invalidateOnWrite(...prefixes) {
  return function invalidateOnWriteMiddleware(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    res.on('finish', () => {
      if (res.statusCode < 400) for (const prefix of prefixes) memo.invalidate(prefix);
    });
    return next();
  };
}

module.exports = { cachedResponse, invalidateOnWrite };
