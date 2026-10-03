require('dotenv').config();
const logger = require('./utils/logger');

// Refuse to start in production with missing/placeholder secrets or no
// database settings (config/validateEnv.js) — before anything else loads.
require('./config/validateEnv').validateEnv({ logger });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const pool = require('./db/pool');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { allowedOrigins, corsOriginCheck } = require('./utils/corsOrigins');
const { healthHandler } = require('./utils/health');
const pendingWork = require('./utils/pendingWork');
const realtime = require('./services/realtime.service');

const isProduction = process.env.NODE_ENV === 'production';

const app = express();
// Number of reverse-proxy hops in front of the API (Passenger/LiteSpeed on
// cPanel: 1). req.ip — and so every per-IP rate limit — depends on it: too
// high lets a client spoof X-Forwarded-For, too low makes every visitor share
// the proxy's IP. Verify on the host (.env.example, TRUST_PROXY).
const trustProxyHops = Number(process.env.TRUST_PROXY ?? 1);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);
app.disable('x-powered-by');

// Security headers for a JSON API (the web app is served from its own origin).
// CSP is left to the frontend host; frames are refused; HSTS only in
// production (HTTPS). CORP same-site lets <domain> read api.<domain> files.
app.use(helmet({
  contentSecurityPolicy: false,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  strictTransportSecurity: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
}));

// The Accurate OAuth callback carries a one-time code in its query string;
// keep it out of the request log.
const OAUTH_CALLBACK_PATH = /\/integrations\/accurate\/callback/;
// Health probes (Passenger, uptime monitor) and the long-lived realtime stream
// are not logged per request: they would drown the log in noise.
const UNLOGGED_PATHS = /^\/api\/(health|v1\/realtime\/stream)(\/|\?|$)/;
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => UNLOGGED_PATHS.test(req.url || '') },
  serializers: {
    req(req) {
      if (req && typeof req.url === 'string' && OAUTH_CALLBACK_PATH.test(req.url)) {
        req.url = req.url.split('?')[0];
        req.query = undefined;
      }
      return req;
    },
  },
}));
app.use(express.json({ limit: '1mb' }));

// Exactly the CORS_ORIGINS list; in development any localhost port as well
// when a localhost origin is configured (utils/corsOrigins.js).
app.use(cors({
  origin: corsOriginCheck(allowedOrigins(process.env.CORS_ORIGINS)),
  credentials: true,
}));

app.get('/api/health', healthHandler({ pool }));

app.use('/verify', require('./routes/publicVerify.routes'));

const {
  isSetupEnabled,
  shouldMountSetupRoutes,
} = require('./middleware/setupGuard');

if (shouldMountSetupRoutes()) {
  app.use('/api/v1/setup', require('./routes/setup.routes'));
  logger.warn(
    '[app] Temporary production setup routes are ENABLED at /api/v1/setup'
  );
} else if (isSetupEnabled()) {
  logger.error(
    '[app] SETUP_ENABLED=yes but SETUP_TOKEN is invalid; setup routes NOT mounted'
  );
}

app.use('/api/v1', routes);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Prakasa Workspace API listening on :${PORT}`);
  // Fill the division dashboards' 12-month series in the background shortly
  // after start, so the first visitor after a restart does not wait for them
  // (DASHBOARD_WARMUP=0 turns it off).
  if (process.env.DASHBOARD_WARMUP !== '0') {
    require('./services/divisionDashboard.service').scheduleWarmUp(Number(process.env.DASHBOARD_WARMUP_DELAY_MS || 15000));
  }
});

// --- process lifecycle -----------------------------------------------------

// A stray rejected promise is logged, not fatal: one bad background task must
// not take the single API process down for every user.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason), stack: reason?.stack }, '[process] unhandledRejection');
});

// After an uncaught exception the process state is unknown: log and exit so
// Passenger starts a fresh one.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error.message, stack: error.stack }, '[process] uncaughtException');
  process.exit(1);
});

// Graceful shutdown (Passenger/cPanel restart, Ctrl+C): stop accepting
// requests, end the realtime streams, let running requests and background
// work finish, then close the database pool. Forced after SHUTDOWN_TIMEOUT_MS.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[app] ${signal} diterima; menutup server`);
  const force = setTimeout(() => {
    logger.error('[app] shutdown timeout; keluar paksa');
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000));
  force.unref();

  realtime.closeAll();
  server.close(async (error) => {
    if (error) logger.error({ err: error.message }, '[app] server.close gagal');
    await pendingWork.flush(5000);
    try { await pool.end(); } catch (e) { logger.error({ err: e.message }, '[app] pool.end gagal'); }
    clearTimeout(force);
    process.exit(error ? 1 : 0);
  });
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
