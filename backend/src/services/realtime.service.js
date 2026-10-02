const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const { spansDivisions } = require('./divisionAccess');

// In-process realtime bus + SSE client registry.
//
// Services call publish() AFTER their transaction commits; the connected SSE
// clients of the same entity that belong to the event's audience receive it
// and refetch what they show. Payloads carry ids only (never titles/bodies),
// so a client learns nothing it could not already fetch — it still has to pass
// the normal access checks.
//
// Audience (third argument of publish, never part of the payload):
//   none                         → every client of the entity (as before);
//   { departmentId }             → that division + cross-division users
//                                  (Management Office, Super Admin);
//   { userIds } and/or { emails } → only those users;
//   { userIds, crossDivision: true } → those users + cross-division users;
//   departmentId together with userIds/emails → the union of both.
// A client's division and permissions are read when its stream opens; a change
// of division reaches the stream on its next reconnect.
//
// Single Node process only: with several backend instances behind a load
// balancer, publish() must go through a shared channel (e.g. Redis pub/sub)
// and each instance fans the message out to its own clients via deliver().

const HEARTBEAT_MS = 20 * 1000;
// Two tabs per user (load test, 1 Oct 2026): on shared hosting every open
// stream holds one of the account's Entry Processes, so a user with many tabs
// must not use up the host's limit. A third stream closes the oldest one; that
// page retries with backoff (frontend realtimeModel.js), and a hidden tab
// pauses its stream, so normally only the visible tabs hold one.
const MAX_CONNECTIONS_PER_USER = 2;
const EVENT_NAME_RE = /^[a-z][a-z0-9_.-]{0,40}$/;

const bus = new EventEmitter();
bus.setMaxListeners(0);

const clients = new Map(); // userId → Array<client> (oldest first)
let nextClientId = 1;

function clientCount(userId) {
  if (userId == null) {
    let total = 0;
    for (const list of clients.values()) total += list.length;
    return total;
  }
  return (clients.get(Number(userId)) || []).length;
}

function write(client, chunk) {
  if (client.closed || client.res.writableEnded || client.res.destroyed) return false;
  try {
    client.res.write(chunk);
    return true;
  } catch (error) {
    logger.debug({ err: error.message }, '[realtime] write failed');
    removeClient(client);
    return false;
  }
}

function removeClient(client) {
  if (client.closed) return;
  client.closed = true;
  clearInterval(client.heartbeat);
  const list = clients.get(client.userId) || [];
  const rest = list.filter((c) => c !== client);
  if (rest.length) clients.set(client.userId, rest);
  else clients.delete(client.userId);
  try { if (!client.res.writableEnded) client.res.end(); } catch { /* socket already gone */ }
}

// Registers an SSE response. The oldest connection of the user is closed when
// the cap is reached (a reloaded tab usually leaves a stale one behind).
function addClient({ userId, entityId, departmentId = null, email = null, crossDivision = false, res, heartbeatMs = HEARTBEAT_MS }) {
  const uid = Number(userId);
  const client = {
    id: nextClientId++,
    userId: uid,
    entityId: Number(entityId),
    departmentId: departmentId == null ? null : Number(departmentId),
    email: email ? String(email).trim().toLowerCase() : null,
    crossDivision: Boolean(crossDivision),
    res,
    closed: false,
    heartbeat: null,
  };

  const list = clients.get(uid) || [];
  while (list.length >= MAX_CONNECTIONS_PER_USER) {
    const oldest = list.shift();
    clients.set(uid, list);
    removeClient(oldest);
  }
  list.push(client);
  clients.set(uid, list);

  client.heartbeat = setInterval(() => write(client, ': ping\n\n'), heartbeatMs);
  if (typeof client.heartbeat.unref === 'function') client.heartbeat.unref();

  return client;
}

function format(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function idList(values) {
  if (!Array.isArray(values)) return null;
  return new Set(values.map(Number).filter((n) => Number.isInteger(n) && n > 0));
}

// Normalises the audience; null means "the whole entity".
function audienceOf(audience) {
  if (!audience || typeof audience !== 'object') return null;
  const userIds = idList(audience.userIds);
  const emails = Array.isArray(audience.emails)
    ? new Set(audience.emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
    : null;
  const dept = audience.departmentId == null ? null : Number(audience.departmentId);
  const departmentId = Number.isInteger(dept) && dept > 0 ? dept : null;
  if (!userIds && !emails && departmentId === null) return null;
  return {
    userIds, emails, departmentId,
    // A division event always reaches the cross-division roles as well.
    crossDivision: departmentId !== null || audience.crossDivision === true,
  };
}

function inAudience(client, target) {
  if (!target) return true;
  if (target.userIds?.has(client.userId)) return true;
  if (client.email && target.emails?.has(client.email)) return true;
  if (target.crossDivision && client.crossDivision) return true;
  return target.departmentId !== null && client.departmentId === target.departmentId;
}

// Fan-out to the connected clients of this process.
function deliver(event, data, audience = null) {
  const entityId = Number(data?.entityId);
  if (!Number.isInteger(entityId) || entityId <= 0) return 0;
  const target = audienceOf(audience);
  const chunk = format(event, data);
  let sent = 0;
  for (const list of clients.values()) {
    for (const client of [...list]) {
      if (client.entityId !== entityId) continue;
      if (!inAudience(client, target)) continue;
      if (write(client, chunk)) sent += 1;
    }
  }
  return sent;
}

// Never throws: realtime is a convenience, committed work must not fail on it.
function publish(event, data, audience = null) {
  try {
    if (!EVENT_NAME_RE.test(String(event))) return 0;
    const payload = { ...data, at: data?.at || new Date().toISOString() };
    const sent = deliver(event, payload, audience);
    bus.emit(event, payload);
    return sent;
  } catch (error) {
    logger.warn({ err: error.message }, '[realtime] publish failed');
    return 0;
  }
}

/** addClient fields for a signed-in user (req.user as requireAuth builds it). */
function clientOf(user) {
  return {
    userId: user.sub,
    entityId: user.entityId,
    departmentId: user.departmentId ?? null,
    email: user.email || null,
    crossDivision: spansDivisions(user) || (user.permissions || []).includes('entity.cross_access'),
  };
}

function subscribe(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

// Ends every open stream (graceful shutdown); the clients reconnect to the
// next process on their own.
function closeAll() {
  for (const list of [...clients.values()]) for (const client of [...list]) removeClient(client);
  clients.clear();
}

// Test helper.
function reset() {
  for (const list of [...clients.values()]) for (const client of [...list]) removeClient(client);
  clients.clear();
  bus.removeAllListeners();
}

module.exports = {
  HEARTBEAT_MS,
  MAX_CONNECTIONS_PER_USER,
  addClient,
  clientOf,
  removeClient,
  clientCount,
  publish,
  subscribe,
  deliver,
  format,
  reset,
  closeAll,
};
