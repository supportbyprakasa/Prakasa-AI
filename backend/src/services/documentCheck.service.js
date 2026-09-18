const pool = require('../db/pool');
const { runModule } = require('./ai/provider');

/**
 * Definisi dokumen wajib per jenis pengajuan.
 * Sesuai SOW: AI HANYA memeriksa kelengkapan, bukan memutuskan approve.
 */
const REQUIRED_DOCS = {
  payment_request: {
    required: ['invoice'],
    optional: ['po', 'quotation', 'tax_doc'],
    notes: 'Payment request wajib memiliki invoice. PO/quotation menambah kelengkapan.',
  },
  reimbursement: {
    required: ['receipt'],
    optional: ['invoice', 'tax_doc', 'bank_proof'],
    notes: 'Reimbursement wajib memiliki bukti pembayaran (receipt).',
  },
  onboarding: {
    required: ['offer_letter'],
    optional: ['contract', 'id_document'],
    notes: 'Onboarding wajib memiliki offer letter.',
  },
  offboarding: {
    required: ['resignation_letter'],
    optional: ['handover_note'],
    notes: 'Offboarding wajib memiliki surat pengunduran diri.',
  },
};

/**
 * Cek kelengkapan dokumen via AI + rule-based.
 * Return { status, missing, warnings, aiSummaryId, notes }
 */
async function checkCompleteness({ module, attachments, workflowMeta, entityId, departmentId, subjectType, subjectId, userId }) {
  const rule = REQUIRED_DOCS[module];
  if (!rule) throw new Error(`Document check untuk ${module} tidak dikenal`);

  const uploadedTypes = new Set(attachments.map((a) => a.attachment_type));
  const missing = rule.required.filter((t) => !uploadedTypes.has(t));
  const missingOptional = rule.optional.filter((t) => !uploadedTypes.has(t));

  let ruleStatus = 'passed';
  if (missing.length) ruleStatus = 'failed';
  else if (missingOptional.length) ruleStatus = 'warning';

  // Bangun prompt AI
  const prompt = `Modul: ${module}
Jenis workflow: ${workflowMeta.workflow_type}
Judul: ${workflowMeta.title}
Deskripsi: ${workflowMeta.description || '-'}
Nominal: ${workflowMeta.amount || '-'} ${workflowMeta.currency || 'IDR'}
Tanggal pengajuan: ${workflowMeta.request_date || workflowMeta.effective_date}

Dokumen yang diunggah:
${attachments.map((a) => `- ${a.attachment_type}: ${a.name}`).join('\n') || '(tidak ada)'}

Dokumen wajib untuk jenis ini: ${rule.required.join(', ')}
Dokumen opsional: ${rule.optional.join(', ')}
Catatan rule: ${rule.notes}

Periksa kelengkapan dokumen di atas.`;

  let aiResult = null;
  try {
    aiResult = await runModule('document_check', prompt);
  } catch (e) {
    // AI gagal → tetap kembalikan hasil rule-based
    console.error('[documentCheck] AI error:', e.message);
  }

  let aiParsed = null;
  if (aiResult) {
    try {
      const cleaned = aiResult.content.replace(/```json|```/g, '').trim();
      aiParsed = JSON.parse(cleaned);
    } catch {
      aiParsed = null;
    }
  }

  // Gabungkan: rule-based sebagai baseline, AI sebagai pelengkap
  const finalStatus = missing.length
    ? 'failed'
    : (aiParsed?.status === 'failed' ? 'failed'
       : (aiParsed?.status === 'warning' || missingOptional.length ? 'warning' : 'passed'));

  const notes = [
    rule.notes,
    missing.length ? `Dokumen wajib belum diunggah: ${missing.join(', ')}.` : null,
    missingOptional.length ? `Dokumen opsional belum diunggah: ${missingOptional.join(', ')}.` : null,
    aiParsed?.notes || null,
  ].filter(Boolean).join('\n');

  // Simpan ke ai_summaries kalau AI berjalan
  let aiSummaryId = null;
  if (aiResult) {
    const crypto = require('crypto');
    const promptHash = crypto.createHash('sha256').update(prompt).digest('hex');
    const [ins] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, department_id, module, subject_type, subject_id,
        provider, model, prompt_hash, content, tokens_in, tokens_out, created_by)
       VALUES (?, ?, 'document_check', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, subjectType, subjectId,
       aiResult.provider, aiResult.model, promptHash, aiResult.content,
       aiResult.tokensIn || null, aiResult.tokensOut || null, userId]
    );
    aiSummaryId = ins.insertId;
  }

  return {
    status: finalStatus,
    missing,
    missingOptional,
    notes,
    aiSummaryId,
    rule,
  };
}

module.exports = { checkCompleteness, REQUIRED_DOCS };
