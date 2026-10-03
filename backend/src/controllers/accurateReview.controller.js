const { ok, fail } = require('../utils/response');
const logger = require('../utils/logger');
const review = require('../services/accurateBatchReview.service');
const { positiveId } = require('../services/salesQuery');

// "Periksa dengan AI" on a Data Accurate batch: notes for the human who
// decides. Read-only towards the batch — this controller has no way to change
// a batch or its approval, and never calls the approval engine.

const SSE_HEARTBEAT_MS = 15000;
const NOT_FOUND = 'Batch data Accurate tidak ditemukan';

const handle = (next, res) => (e) => {
  if (e.status && e.code) return fail(res, e.code, e.message, e.status);
  return next(e);
};

async function latest(req, res, next) {
  try {
    const id = positiveId(req.params.id);
    if (!id) return fail(res, 'NOT_FOUND', NOT_FOUND, 404);
    return ok(res, await review.latest(req.user, id));
  } catch (e) { return handle(next, res)(e); }
}

// POST /accurate/batches/:id/review  { ai?: boolean }
//   without ai: JSON — the automatic findings (kept as the batch's review).
//   with ai:    the findings at once, then Prakasa AI's note. As Server-Sent
//               Events when the browser asks for them (`findings`, `status`,
//               `delta`, then one `done`), else one JSON answer at the end.
// An unavailable engine or a reached daily limit is not an error: the findings
// are returned with a note saying so.
async function reviewBatch(req, res, next) {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 'NOT_FOUND', NOT_FOUND, 404);
  const ai = req.body?.ai === true;
  let result;
  try {
    result = await review.run(req.user, id, { ai });
  } catch (e) { return handle(next, res)(e); }
  if (!ai) return ok(res, result);

  const stream = String(req.headers.accept || '').includes('text/event-stream');
  if (!stream) {
    try {
      const note = await review.writeNote(req.user, id);
      return ok(res, { ...result, aiNote: note.note || null, aiStatus: note.status, aiNotice: note.notice || null });
    } catch (e) { return handle(next, res)(e); }
  }

  let clientGone = false;
  res.on('close', () => { clientGone = true; });
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const send = (event, data) => {
    if (clientGone || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => { if (!clientGone && !res.writableEnded) res.write(': keep-alive\n\n'); }, SSE_HEARTBEAT_MS);
  try {
    send('findings', result);
    // The note is still written and saved when the browser goes away.
    const note = await review.writeNote(req.user, id, {
      onDelta: (text) => send('delta', { text }),
      onStatus: (status) => send('status', status),
    });
    send('done', { aiNote: note.note || null, aiStatus: note.status, aiNotice: note.notice || null });
  } catch (error) {
    logger.error({ err: error.message }, 'accurate batch review stream failed');
    send('done', { aiNote: null, aiStatus: 'failed', aiNotice: 'Prakasa AI belum bisa menulis catatan sekarang. Hasil pemeriksaan otomatis di atas tetap berlaku; coba lagi nanti.' });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
  return undefined;
}

module.exports = { latest, review: reviewBatch };
