// Tracks in-flight AI generations so a user can stop one. This lives in process memory,
// which matches the single backend process used today; a multi-instance deployment would
// need a shared signal (e.g. a DB flag polled by the generating instance).

const active = new Map();

function register(sessionId, token) {
  const controller = new AbortController();
  active.set(Number(sessionId), { token, controller });
  return controller.signal;
}

function release(sessionId, token) {
  const entry = active.get(Number(sessionId));
  if (entry && entry.token === token) active.delete(Number(sessionId));
}

function stop(sessionId) {
  const entry = active.get(Number(sessionId));
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

module.exports = { register, release, stop };
