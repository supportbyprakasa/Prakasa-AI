const crypto = require('node:crypto');

// The wire between an agent answer and the browser showing it (Wave C). While
// an answer streams, its channel is open: a page tool asks the browser to do
// one thing (`client_tool` event on that answer's stream) and waits for the
// browser's result (POST /ai-command/sessions/:id/tool-results).
//
//   - a channel belongs to ONE answer (the agent token's id), one session and
//     one user; it closes when the answer ends, and what is still waiting then
//     ends as "halaman tidak tersedia";
//   - a result is accepted once, from the same user, for the same session;
//   - no result within the timeout reads as "pengguna tidak merespons".
//
// In memory, in this process: the answer's stream, the agent's tool calls
// (mcpServer.js → /ai-agent/tools) and the browser's results must reach the
// same Node process. A second process would answer "halaman tidak tersedia".

const DEFAULT_TIMEOUT_MS = 30_000;
const UNAVAILABLE = 'Halaman pengguna tidak tersedia (percakapan tidak sedang berjalan di panel halaman).';
const NO_ANSWER = 'Pengguna tidak merespons atau halaman tidak tersedia.';

const channels = new Map(); // answerId → channel
const calls = new Map(); // callId → { answerId, sessionId, userId, settle }

// `fromDocument`: the conversation carries a file the user attached (a receipt,
// a delivery note); clientTools.js then refuses identifiers copied from it.
function open({ answerId, sessionId, userId, route = null, emit, fromDocument = false }) {
  if (!answerId || typeof emit !== 'function') throw new Error('clientBridge.open butuh answerId dan emit');
  const channel = {
    answerId, sessionId: Number(sessionId), userId: Number(userId), route, emit, forms: new Map(), open: true, fromDocument: fromDocument === true,
  };
  channels.set(answerId, channel);
  return function close() {
    channel.open = false;
    channels.delete(answerId);
    for (const [callId, call] of calls) {
      if (call.answerId === answerId) call.settle({ ok: false, error: UNAVAILABLE, unavailable: true }, callId);
    }
  };
}

const channelOf = (answerId) => channels.get(answerId) || null;

// Asks the browser of this answer to do one thing. Always resolves:
//   { ok: true, result } | { ok: false, error, timedOut?, unavailable? }
function request({ answerId, tool, op, input = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const channel = channelOf(answerId);
  if (!channel || !channel.open) return Promise.resolve({ ok: false, error: UNAVAILABLE, unavailable: true });
  const callId = crypto.randomUUID();
  return new Promise((resolve) => {
    let timer = null;
    const settle = (outcome, id = callId) => {
      if (!calls.has(id)) return;
      calls.delete(id);
      clearTimeout(timer);
      resolve(outcome);
    };
    calls.set(callId, { answerId, sessionId: channel.sessionId, userId: channel.userId, settle });
    timer = setTimeout(() => settle({ ok: false, error: NO_ANSWER, timedOut: true }), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      channel.emit({ callId, tool, op, input });
    } catch {
      settle({ ok: false, error: UNAVAILABLE, unavailable: true });
    }
  });
}

const refuse = (message, status, code) => Object.assign(new Error(message), { status, code });

// The browser's answer to one call. Single use; only the user and the session
// the call was sent to may answer it (a refused answer does not use the call up).
function resolve({ sessionId, userId, callId, ok, result = null, error = null }) {
  const call = calls.get(String(callId || ''));
  if (!call) throw refuse('Permintaan ini sudah dijawab, kedaluwarsa, atau tidak dikenal', 404, 'CLIENT_TOOL_UNKNOWN');
  if (call.userId !== Number(userId) || call.sessionId !== Number(sessionId)) {
    throw refuse('Permintaan ini bukan untuk percakapan Anda', 403, 'FORBIDDEN');
  }
  call.settle(ok === true
    ? { ok: true, result: result && typeof result === 'object' ? result : {} }
    : { ok: false, error: String(error || 'Halaman tidak bisa menjalankannya').slice(0, 300) });
  return true;
}

// Tests only.
function reset() {
  for (const [callId, call] of calls) call.settle({ ok: false, error: UNAVAILABLE, unavailable: true }, callId);
  channels.clear();
}

module.exports = {
  DEFAULT_TIMEOUT_MS, UNAVAILABLE, NO_ANSWER, open, channelOf, request, resolve, reset,
  pendingCount: () => calls.size,
};
