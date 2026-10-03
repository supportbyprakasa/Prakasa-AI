import { apiBaseUrl } from './endpoint';
import { parseSseEvents } from '../pages/ai/aiCommandCenterModel';

// Errors mimic axios' shape so callers can reuse their existing error handling.
function streamError(status, code, message, extra = {}) {
  const error = new Error(message || 'Gagal mengirim pesan');
  error.response = { status, data: { error: { code, message } } };
  Object.assign(error, extra);
  return error;
}

function handleUnauthorized() {
  localStorage.removeItem('prakasa.token');
  if (!location.pathname.startsWith('/login')) location.href = '/login';
}

/**
 * Sends a message and streams the assistant reply.
 * Resolves with the same payload as POST /messages; throws an axios-like error.
 * Throws with `streamUnavailable: true` when the backend has no stream endpoint.
 */
// Page tools (Wave C): `surface` says where the conversation is shown ('panel'
// on a page, 'full' in the Command Center) and `route` which page the panel is
// on. A `client_tool` event asks this browser to open a page or fill a
// registered form: `onClientTool(call)` resolves with { ok, result | error }
// (components/ai/aiClientTools.js) and the result is posted back, once.
async function postToolResult(sessionId, token, callId, outcome) {
  try {
    await fetch(`${apiBaseUrl}/ai-command/sessions/${sessionId}/tool-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(outcome.ok ? { callId, ok: true, result: outcome.result || {} } : { callId, ok: false, error: String(outcome.error || '').slice(0, 300) }),
    });
  } catch { /* the server times the request out and tells the model */ }
}

export async function streamSessionMessage(sessionId, message, {
  onDelta, onStatus, editMessageId = null, surface = null, route = null, onClientTool = null, attachmentIds = [],
}) {
  const token = localStorage.getItem('prakasa.token');
  const handleClientTool = (call) => {
    if (!call?.callId) return;
    const run = typeof onClientTool === 'function'
      ? Promise.resolve().then(() => onClientTool(call)).catch((error) => ({ ok: false, error: error?.message }))
      : Promise.resolve({ ok: false, error: 'Halaman ini tidak menjalankan alat halaman.' });
    run.then((outcome) => postToolResult(sessionId, token, call.callId, outcome || { ok: false, error: 'Tidak ada hasil.' }));
  };
  const response = await fetch(`${apiBaseUrl}/ai-command/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      ...(editMessageId ? { editMessageId } : {}),
      ...(surface ? { surface } : {}),
      ...(surface && route ? { route: String(route).slice(0, 300) } : {}),
      // Files attached to this message (ids from POST /sessions/:id/files).
      ...(attachmentIds?.length ? { attachmentIds } : {}),
    }),
  });

  const isEventStream = (response.headers.get('content-type') || '').includes('text/event-stream');
  if (!response.ok || !isEventStream || !response.body) {
    if (response.status === 401) handleUnauthorized();
    let payload = null;
    try { payload = await response.json(); } catch { /* non-JSON error page */ }
    throw streamError(
      response.status,
      payload?.error?.code,
      payload?.error?.message,
      { streamUnavailable: response.status === 404 && !payload?.error },
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseEvents(buffer);
    buffer = parsed.rest;
    for (const { event, data } of parsed.events) {
      const payload = JSON.parse(data);
      if (event === 'delta') onDelta(payload.text || '');
      else if (event === 'status') onStatus?.(payload);
      else if (event === 'client_tool') handleClientTool(payload);
      else if (event === 'done') outcome = { ok: true, payload };
      else if (event === 'error') outcome = { ok: false, payload };
    }
  }

  if (!outcome) {
    throw streamError(502, 'STREAM_INTERRUPTED', 'Koneksi ke AI terputus sebelum jawaban selesai.');
  }
  if (!outcome.ok) {
    throw streamError(outcome.payload.status, outcome.payload.code, outcome.payload.message);
  }
  return outcome.payload;
}
