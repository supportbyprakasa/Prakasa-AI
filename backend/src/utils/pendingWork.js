// Background work that is started but deliberately not awaited (an email after
// a notification, a best-effort log write) — tracked so that a short-lived
// process (a cron job in src/jobs) can wait for it before closing the database
// pool. Web requests never wait: track() returns the same promise untouched.
//
//   track(promise)        remember it until it settles; returns the promise
//   flush(timeoutMs)      wait for everything tracked (including work started
//                         while waiting), at most timeoutMs; never rejects
//   drainAndEnd(pool)     flush, then pool.end() — the last step of every job

const logger = require('./logger');

const pending = new Set();

function track(promise) {
  if (!promise || typeof promise.then !== 'function') return promise;
  const settled = Promise.resolve(promise).then(() => {}, () => {});
  pending.add(settled);
  settled.then(() => pending.delete(settled));
  return promise;
}

function size() {
  return pending.size;
}

async function flush(timeoutMs = 15000) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  // Work that finishes may start more work (an email writes an integration
  // log), so keep waiting until the set stays empty or the time is up.
  while (pending.size) {
    const left = deadline - Date.now();
    if (left <= 0) {
      logger.warn({ pending: pending.size }, '[pendingWork] flush timeout; some background work is still running');
      return false;
    }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, left); });
    await Promise.race([Promise.all([...pending]), timeout]);
    clearTimeout(timer);
  }
  return true;
}

async function drainAndEnd(pool, timeoutMs = Number(process.env.JOB_FLUSH_TIMEOUT_MS || 15000)) {
  await flush(timeoutMs);
  await pool.end();
}

module.exports = { track, flush, size, drainAndEnd };
