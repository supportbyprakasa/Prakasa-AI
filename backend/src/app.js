require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);

app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

// If at least one configured CORS origin is localhost/127.0.0.1,
// treat the backend as local-development friendly and allow Vite to
// move between ports (5173, 5174, 5175, etc.) without editing .env.
const allowAnyLoopbackPort = origins.some(isLoopbackOrigin);

app.use(cors({
  origin(origin, callback) {
    // Requests without Origin (curl, server-to-server, health checks) are allowed.
    if (!origin) return callback(null, true);

    if (origins.includes(origin)) {
      return callback(null, true);
    }

    if (allowAnyLoopbackPort && isLoopbackOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
);

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
app.listen(PORT, () => logger.info(`Prakasa Work OS API listening on :${PORT}`));
