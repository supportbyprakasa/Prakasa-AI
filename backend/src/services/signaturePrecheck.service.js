const crypto = require('crypto');
const pool = require('../db/pool');
const { runModule } = require('./ai/provider');
const { getDocPlainText } = require('./googleDocs.service');

function canCrossEntity(user) {
  return (user?.permissions || []).includes('entity.cross_access');
}

function sanitizeFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return findings.slice(0, 100).map((finding) => ({
    severity: ['low', 'medium', 'high'].includes(finding?.severity)
      ? finding.severity
      : 'medium',
    message: String(finding?.message || '').slice(0, 1000),
    ref: String(finding?.ref || '').slice(0, 500),
  }));
}

async function runPrecheck({
  documentId,
  signatureRequestId = null,
  approvalRequestId = null,
  module = 'signature_precheck',
  user,
}) {
  const startedAt = Date.now();

  const [docs] = await pool.query(
    `SELECT d.id, d.entity_id, d.department_id, d.title,
            d.document_type, d.status, d.drive_file_id,
            f.mime_type AS mimeType
       FROM documents d
       LEFT JOIN drive_files_metadata f
         ON f.drive_file_id = d.drive_file_id
      WHERE d.id = ? AND d.deleted_at IS NULL
      LIMIT 1`,
    [documentId]
  );
  const doc = docs[0];

  if (!doc) {
    const error = new Error('Dokumen tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (
    user?.entityId &&
    Number(user.entityId) !== Number(doc.entity_id) &&
    !canCrossEntity(user)
  ) {
    const error = new Error('Tidak punya akses ke dokumen entity lain');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  let sourceText = '';
  if (
    doc.mimeType === 'application/vnd.google-apps.document' &&
    doc.drive_file_id
  ) {
    try {
      sourceText = await getDocPlainText(doc.drive_file_id, {
        entityId: doc.entity_id,
        userId: user?.sub || null,
        subjectType: 'document',
        subjectId: doc.id,
      });
    } catch {
      sourceText = '';
    }
  }

  if (!sourceText) {
    sourceText = [
      `Judul: ${doc.title}`,
      `Tipe: ${doc.document_type}`,
      `Status: ${doc.status}`,
    ].join('\n');
  }

  let approvalContext = '';
  if (approvalRequestId) {
    const [approvals] = await pool.query(
      `SELECT id, entity_id, title, status, current_level
         FROM approval_requests
        WHERE id = ?
        LIMIT 1`,
      [approvalRequestId]
    );
    const approval = approvals[0];
    if (!approval || Number(approval.entity_id) !== Number(doc.entity_id)) {
      const error = new Error('Approval request tidak sesuai dengan dokumen');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    approvalContext =
      `\nApproval terkait: ${approval.title} ` +
      `(status=${approval.status}, level=${approval.current_level})`;
  }

  const prompt = `Dokumen yang akan ditandatangani:
Judul: ${doc.title}
Tipe: ${doc.document_type}
Status: ${doc.status}${approvalContext}

Isi dokumen:
"""
${sourceText.slice(0, 12000)}
"""

Periksa kelengkapan dan konsistensi dokumen untuk diajukan tanda tangan.`;

  let aiResult;
  try {
    aiResult = await runModule(module, prompt, {
      entityId: doc.entity_id,
      userId: user?.sub || null,
      subjectType: 'document',
      subjectId: doc.id,
    });
  } catch (error) {
    const [inserted] = await pool.query(
      `INSERT INTO signature_precheck_logs
       (entity_id, department_id, document_id, signature_request_id,
        approval_request_id, status, summary, provider, model,
        duration_ms, created_by)
       VALUES (?, ?, ?, ?, ?, 'skipped', ?, NULL, NULL, ?, ?)`,
      [
        doc.entity_id,
        doc.department_id,
        doc.id,
        signatureRequestId,
        approvalRequestId,
        `Precheck gagal: ${error.message}`.slice(0, 4000),
        Date.now() - startedAt,
        user?.sub || null,
      ]
    );

    return {
      status: 'skipped',
      summary: `Precheck gagal: ${error.message}`,
      findings: [],
      aiSummaryId: null,
      precheckLogId: inserted.insertId,
      provider: null,
      model: null,
    };
  }

  let parsed = {
    status: 'warning',
    summary: aiResult.content || '',
    findings: [],
  };

  try {
    const cleaned = String(aiResult.content || '')
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const decoded = JSON.parse(cleaned);
    parsed = {
      status: ['passed', 'warning', 'failed'].includes(decoded.status)
        ? decoded.status
        : 'warning',
      summary: String(decoded.summary || '').slice(0, 10000),
      findings: sanitizeFindings(decoded.findings),
    };
  } catch {
    parsed = {
      status: 'warning',
      summary: String(aiResult.content || '').slice(0, 10000),
      findings: [],
    };
  }

  const promptHash = crypto
    .createHash('sha256')
    .update(prompt)
    .digest('hex');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [summaryResult] = await conn.query(
      `INSERT INTO ai_summaries
       (entity_id, department_id, module, subject_type, subject_id,
        provider, model, prompt_hash, content, tokens_in, tokens_out, created_by)
       VALUES (?, ?, ?, 'document', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.entity_id,
        doc.department_id,
        module,
        doc.id,
        aiResult.provider,
        aiResult.model,
        promptHash,
        aiResult.content || '',
        aiResult.tokensIn || null,
        aiResult.tokensOut || null,
        user?.sub || null,
      ]
    );

    const [precheckResult] = await conn.query(
      `INSERT INTO signature_precheck_logs
       (entity_id, department_id, document_id, signature_request_id,
        approval_request_id, ai_summary_id, status, summary, findings_json,
        provider, model, tokens_in, tokens_out, duration_ms, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.entity_id,
        doc.department_id,
        doc.id,
        signatureRequestId,
        approvalRequestId,
        summaryResult.insertId,
        parsed.status,
        parsed.summary || null,
        JSON.stringify(parsed.findings),
        aiResult.provider,
        aiResult.model,
        aiResult.tokensIn || null,
        aiResult.tokensOut || null,
        Date.now() - startedAt,
        user?.sub || null,
      ]
    );

    await conn.commit();

    return {
      status: parsed.status,
      summary: parsed.summary,
      findings: parsed.findings,
      aiSummaryId: summaryResult.insertId,
      precheckLogId: precheckResult.insertId,
      provider: aiResult.provider,
      model: aiResult.model,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { runPrecheck };
