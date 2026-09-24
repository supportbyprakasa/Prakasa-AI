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
export async function streamSessionMessage(sessionId, message, { onDelta, onStatus, editMessageId = null }) {
  const token = localStorage.getItem('prakasa.token');
  const response = await fetch(`${apiBaseUrl}/ai-command/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(editMessageId ? { message, editMessageId } : { message }),
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
