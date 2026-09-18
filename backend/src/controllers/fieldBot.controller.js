const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const botSvc = require('../services/fieldSalesBot.service');
const pipelineSvc = require('../services/salesPipeline.service');

async function startSession(req, res, next) {
  try {
    const { quickAction, context } = req.body;
    const s = await botSvc.startSession({
      entityId: req.user.entityId,
      departmentId: req.user.departmentId,
      userId: req.user.sub,
      quickAction,
      context,
    });
    return ok(res, s, undefined, 201);
  } catch (e) { next(e); }
}

/**
 * POST /sales/field-bot/sessions/:id/message
 * Body: { text, mediaDriveFileIds? }
 *
 * Alur:
 * 1. Simpan pesan user
 * 2. Kirim ke AI → JSON terstruktur
 * 3. Simpan hasil AI ke ai_summaries
 * 4. Berdasarkan action dari AI:
 *    - visit_report → buat sales_visit_report
 *    - follow_up → buat sales_followups
 *    - request_sample → buat sales_sample_requests (via controller lain)
 *    - update_deal → update stage pipeline (perlu user konfirmasi; tapi untuk MVP auto)
 * 5. Simpan balasan assistant
 */
async function sendMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { text, mediaDriveFileIds } = req.body;

    const [sRows] = await pool.query(
      `SELECT * FROM field_sales_bot_sessions WHERE id=? AND is_closed=0`, [id]
    );
    const session = sRows[0];
    if (!session) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    if (session.user_id !== req.user.sub) return fail(res, 'FORBIDDEN', 'Bukan sesi Anda', 403);

    await botSvc.appendMessage({ sessionId: id, role: 'user', content: text });

    const { raw, parsed } = await botSvc.parseFieldReport(text);

    const promptHash = crypto.createHash('sha256').update(text).digest('hex');
    const [aiIns] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, department_id, module, subject_type, subject_id,
        provider, model, prompt_hash, content, tokens_in, tokens_out, created_by)
       VALUES (?, ?, 'field_sales_bot', 'bot_session', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.entity_id, session.department_id, session.id,
       raw.provider, raw.model, promptHash, raw.content,
       raw.tokensIn || null, raw.tokensOut || null, req.user.sub]
    );

    // Ambil customer via nama (kalau ada)
    let customerId = session.context ? JSON.parse(session.context).customerId : null;
    if (!customerId && parsed.customer_name) {
      const [c] = await pool.query(
        `SELECT id FROM sales_customers WHERE entity_id=? AND name LIKE ?
          AND deleted_at IS NULL LIMIT 1`,
        [session.entity_id, `%${parsed.customer_name}%`]
      );
      if (c[0]) customerId = c[0].id;
    }

    const actions = [];

    // Simpan hasil sesuai action
    if (parsed.action === 'visit_report') {
      const [vr] = await pool.query(
        `INSERT INTO sales_visit_reports
         (entity_id, department_id, customer_id, pipeline_id, visit_date,
          summary, raw_input, photos, created_by)
         VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
        [session.entity_id, session.department_id, customerId, null,
         parsed.summary || text, text,
         mediaDriveFileIds ? JSON.stringify(mediaDriveFileIds) : null, req.user.sub]
      );
      actions.push({ type: 'visit_report', id: vr.insertId });
    } else if (parsed.action === 'follow_up') {
      const [fu] = await pool.query(
        `INSERT INTO sales_followups
         (entity_id, department_id, customer_id, assigned_to, due_date, title,
          description, source, created_by)
         VALUES (?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 1 DAY), ?, ?, 'ai', ?)`,
        [session.entity_id, session.department_id, customerId, req.user.sub,
         parsed.summary || 'Follow up', text, req.user.sub]
      );
      actions.push({ type: 'follow_up', id: fu.insertId });
    } else if (parsed.action === 'update_deal' && session.context) {
      const ctx = JSON.parse(session.context);
      if (ctx.pipelineId && parsed.suggested_pipeline_stage) {
        try {
          await pipelineSvc.changeStage({
            pipelineId: ctx.pipelineId,
            toStage: parsed.suggested_pipeline_stage,
            userId: req.user.sub,
            note: `AI: ${parsed.summary || ''}`,
          });
          actions.push({ type: 'pipeline_stage', pipelineId: ctx.pipelineId,
                         stage: parsed.suggested_pipeline_stage });
        } catch { /* ignore invalid stage */ }
      }
    }
    // request_sample & request_quotation tetap lewat endpoint khusus (butuh konfirmasi user)

    const assistantReply = `Tercatat: ${parsed.action}. ${parsed.summary || ''}\n(Aksi: ${JSON.stringify(actions)})`;
    await botSvc.appendMessage({
      sessionId: id, role: 'assistant', content: assistantReply, aiSummaryId: aiIns.insertId,
    });

    await log({
      entityId: session.entity_id, userId: req.user.sub,
      action: 'field_bot.message', subjectType: 'field_bot_session', subjectId: Number(id),
      metadata: { action: parsed.action, actions },
    });

    return ok(res, {
      parsed,
      actions,
      reply: assistantReply,
      aiSummaryId: aiIns.insertId,
    }, undefined, 201);
  } catch (e) { next(e); }
}

async function closeSession(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE field_sales_bot_sessions SET is_closed=1, closed_at=NOW()
        WHERE id=? AND user_id=? AND is_closed=0`, [id, req.user.sub]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    return ok(res, { id: Number(id), closed: true });
  } catch (e) { next(e); }
}

async function getSession(req, res, next) {
  try {
    const { id } = req.params;
    const [sRows] = await pool.query(
      `SELECT * FROM field_sales_bot_sessions WHERE id=?`, [id]
    );
    if (!sRows[0]) return fail(res, 'NOT_FOUND', 'Session tidak ditemukan', 404);
    const [msgs] = await pool.query(
      `SELECT id, role, content, created_at AS createdAt
         FROM field_sales_bot_messages WHERE session_id=? ORDER BY id ASC`, [id]
    );
    return ok(res, { ...sRows[0], messages: msgs });
  } catch (e) { next(e); }
}

module.exports = { startSession, sendMessage, closeSession, getSession };
