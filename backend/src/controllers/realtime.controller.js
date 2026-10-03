const realtime = require('../services/realtime.service');
const { fail } = require('../utils/response');

// REALTIME_ENABLED=0 switches the stream off (e.g. a host whose proxy buffers
// long responses). The client gets 503 REALTIME_DISABLED and pages keep
// working without live updates.
function realtimeEnabled() {
  return String(process.env.REALTIME_ENABLED ?? '1').trim() !== '0';
}

// GET /api/v1/realtime/stream — Server-Sent Events. The client authenticates
// with the usual Authorization header (fetch-based SSE, see
// frontend/src/api/aiStream.js), so requireAuth runs before this. Only events
// of the user's own entity AND audience (division, named users — see
// realtime.service.js) are delivered; `: ping` every 20s keeps proxies open.
function stream(req, res) {
  if (!realtimeEnabled()) {
    return fail(res, 'REALTIME_DISABLED', 'Pembaruan langsung sedang dimatikan di server.', 503);
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0);

  const client = realtime.addClient({ ...realtime.clientOf(req.user), res });
  res.write('retry: 5000\n\n');
  res.write(realtime.format('ready', { at: new Date().toISOString() }));

  const cleanup = () => realtime.removeClient(client);
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

module.exports = { stream, realtimeEnabled };
