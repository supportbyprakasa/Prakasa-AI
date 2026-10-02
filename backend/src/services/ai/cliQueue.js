// One Claude Team seat serves everyone, so CLI runs are rationed: at most
// CLAUDE_TEAM_MAX_CONCURRENT at once (default 2), the rest wait in line (first
// come, first served) and are told their place. A line that is too long, or a
// wait that is too long, fails with a clear message instead of piling up CLI
// processes until the machine or the seat gives out.

function limits() {
  const n = (key, fallback) => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    concurrent: n('CLAUDE_TEAM_MAX_CONCURRENT', 2),
    maxQueue: n('CLAUDE_TEAM_MAX_QUEUE', 20),
    waitMs: n('CLAUDE_TEAM_QUEUE_TIMEOUT_MS', 120000),
  };
}

function busyError(message) {
  const error = new Error(message);
  error.code = 'AI_BUSY';
  error.status = 503;
  return error;
}

function stoppedError() {
  const error = new Error('Jawaban dihentikan oleh pengguna');
  error.code = 'GENERATION_STOPPED';
  error.status = 499;
  return error;
}

function createQueue() {
  let running = 0;
  const waiting = [];

  const announce = () => {
    waiting.forEach((entry, index) => {
      try { entry.onQueue?.(index + 1); } catch { /* best effort */ }
    });
  };

  const next = () => {
    const { concurrent } = limits();
    while (running < concurrent && waiting.length) {
      const entry = waiting.shift();
      entry.cleanup();
      running += 1;
      entry.resolve(release());
    }
    announce();
  };

  function release() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      running -= 1;
      next();
    };
  }

  // Resolves with a release function once a slot is free.
  function acquire({ signal = null, onQueue = null } = {}) {
    const { concurrent, maxQueue, waitMs } = limits();
    if (signal?.aborted) return Promise.reject(stoppedError());
    if (running < concurrent && !waiting.length) {
      running += 1;
      return Promise.resolve(release());
    }
    if (waiting.length >= maxQueue) {
      return Promise.reject(busyError('Prakasa AI sedang sangat ramai. Coba lagi dalam beberapa menit.'));
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, onQueue };
      const leave = (error) => {
        const index = waiting.indexOf(entry);
        if (index === -1) return;
        waiting.splice(index, 1);
        entry.cleanup();
        announce();
        reject(error);
      };
      const timer = setTimeout(() => leave(busyError('Antrean Prakasa AI terlalu lama. Coba lagi sebentar lagi.')), waitMs);
      const onAbort = () => leave(stoppedError());
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      waiting.push(entry);
      try { onQueue?.(waiting.length); } catch { /* best effort */ }
    });
  }

  const stats = () => ({ running, waiting: waiting.length, ...limits() });

  return { acquire, stats };
}

module.exports = { createQueue, limits, cliQueue: createQueue() };
