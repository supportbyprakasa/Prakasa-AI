const crypto = require('crypto');
const pool = require('../db/pool');
const { runModule } = require('./ai/provider');

/**
 * Kirim laporan tidak terstruktur ke AI, minta JSON terstruktur.
 * AI tidak menyimpan apa pun; pemanggil yang menentukan apa yang dibuat.
 */
async function parseFieldReport(userText) {
  const prompt = `Laporan sales lapangan:\n"""${userText}"""\n\nBalas hanya JSON sesuai skema.`;
  const result = await runModule('field_sales_bot', prompt);
  let parsed;
  try {
    // buang code fences kalau ada
    const cleaned = result.content.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { action: 'visit_report', summary: result.content, priority: 'normal' };
  }
  return { raw: result, parsed };
}

async function startSession({ entityId, departmentId, userId, quickAction, context }) {
  const token = crypto.randomBytes(24).toString('hex');
  const [r] = await pool.query(
    `INSERT INTO field_sales_bot_sessions
     (entity_id, department_id, user_id, session_token, quick_action, context)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entityId, departmentId || null, userId, token, quickAction || null,
     context ? JSON.stringify(context) : null]
  );
  return { id: r.insertId, sessionToken: token };
}

async function appendMessage({ sessionId, role, content, aiSummaryId }) {
  const [r] = await pool.query(
    `INSERT INTO field_sales_bot_messages (session_id, role, content, ai_summary_id)
     VALUES (?, ?, ?, ?)`,
    [sessionId, role, content, aiSummaryId || null]
  );
  return r.insertId;
}

module.exports = { parseFieldReport, startSession, appendMessage };
