// GET /api/health — liveness plus a database ping. Tiny on purpose: no
// versions, hosts or settings. 503 when the database does not answer within
// HEALTH_DB_TIMEOUT_MS (default 2000), so an uptime monitor sees the outage.

async function pingDb(pool, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      pool.query({ sql: 'SELECT 1', timeout: timeoutMs }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function healthHandler({ pool, timeoutMs = Number(process.env.HEALTH_DB_TIMEOUT_MS || 2000), ping = pingDb } = {}) {
  return async (req, res) => {
    const dbOk = await ping(pool, timeoutMs);
    res.set('Cache-Control', 'no-store');
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'error',
      db: dbOk ? 'ok' : 'down',
      timestamp: new Date().toISOString(),
    });
  };
}

module.exports = { healthHandler, pingDb };
