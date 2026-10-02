import { apiBaseUrl } from './endpoint';
import { parseSseEvents } from '../pages/ai/aiCommandCenterModel';

// Errors mimic axios' shape so callers can reuse their existing error handling.
function streamError(status, code, message) {
  const error = new Error(message || 'Pemeriksaan batch gagal');
  error.response = { status, data: { error: { code, message } } };
  return error;
}

function handleUnauthorized() {
  localStorage.removeItem('prakasa.token');
  if (!location.pathname.startsWith('/login')) location.href = '/login';
}

/**
 * "Periksa dengan AI" on a Data Accurate batch: POST /accurate/batches/:id/review
 * with { ai: true }. The automatic findings arrive first (`onFindings`), then
 * Prakasa AI's note as it is written (`onStatus` steps, `onDelta` text).
 * Resolves with { aiNote, aiStatus, aiNotice }; throws an axios-like error.
 */
export async function streamBatchReview(batchId, { onFindings, onDelta, onStatus }) {
  const token = localStorage.getItem('prakasa.token');
  const response = await fetch(`${apiBaseUrl}/accurate/batches/${batchId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ai: true }),
  });
  const isEventStream = (response.headers.get('content-type') || '').includes('text/event-stream');
  if (!response.ok || !isEventStream || !response.body) {
    if (response.status === 401) handleUnauthorized();
    let payload = null;
    try { payload = await response.json(); } catch { /* non-JSON error page */ }
    // A proxy that buffers the stream answers with plain JSON: still a result.
    if (response.ok && payload?.data) {
      onFindings?.(payload.data);
      return { aiNote: payload.data.aiNote || null, aiStatus: payload.data.aiStatus || null, aiNotice: payload.data.aiNotice || null };
    }
    throw streamError(response.status, payload?.error?.code, payload?.error?.message || 'Pemeriksaan batch gagal');
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
      if (event === 'findings') onFindings?.(payload);
      else if (event === 'delta') onDelta?.(payload.text || '');
      else if (event === 'status') onStatus?.(payload);
      else if (event === 'done') outcome = payload;
    }
  }
  if (!outcome) throw streamError(502, 'STREAM_INTERRUPTED', 'Koneksi terputus sebelum catatan AI selesai. Hasil pemeriksaan otomatis tetap tersimpan.');
  return outcome;
}
