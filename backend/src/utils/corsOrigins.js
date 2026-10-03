// Browser origins allowed to call the API: exactly what CORS_ORIGINS lists.
// The old Vercel design previews are allowed only when CORS_ALLOW_VERCEL=1
// (never needed on the production domain).
const VERCEL_WEB_ORIGINS = [
  'https://prakasa-ai-web.vercel.app',
  'https://prakasa-ai-web-git-feat-full-design-revamp-support-prakasa.vercel.app',
  'https://prakasa-ai-git-feat-full-design-revamp-support-prakasa.vercel.app',
];

function allowedOrigins(configuredOrigins = '', env = process.env) {
  return new Set([
    ...(env.CORS_ALLOW_VERCEL === '1' ? VERCEL_WEB_ORIGINS : []),
    ...String(configuredOrigins || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ]);
}

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

// Development convenience: when a localhost origin is configured, any loopback
// port is accepted (Vite moves between 5173, 5174, …). Never in production.
function allowAnyLoopbackPort(origins, env = process.env) {
  return env.NODE_ENV !== 'production' && [...origins].some(isLoopbackOrigin);
}

/** The cors() `origin` callback for a set of origins. */
function corsOriginCheck(origins, env = process.env) {
  const loopback = allowAnyLoopbackPort(origins, env);
  return function origin(requestOrigin, callback) {
    // Requests without Origin (curl, server-to-server, health checks) are allowed.
    if (!requestOrigin) return callback(null, true);
    if (origins.has(requestOrigin)) return callback(null, true);
    if (loopback && isLoopbackOrigin(requestOrigin)) return callback(null, true);
    const error = new Error(`CORS origin not allowed: ${requestOrigin}`);
    error.status = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  };
}

module.exports = { allowedOrigins, isLoopbackOrigin, allowAnyLoopbackPort, corsOriginCheck, VERCEL_WEB_ORIGINS };
