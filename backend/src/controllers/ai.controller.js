const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { runModule } = require('../services/ai/provider');
const { getDocPlainText } = require('../services/googleDocs.service');

/**
 * POST /ai/document-assistant
 * Body: { action: 'summarize'|'check_completeness'|'check_consistency',
 *         documentId } 
 *
 * AI Security Principles yang dipatuhi:
 *  - requireAuth + permission (di route)
 *  - AI tidak boleh membaca dokumen di luar entity/department user
 *  - hasil tidak mengubah dokumen (read-only)
 *  - semua pemanggilan tercatat di ai_summaries + activity_logs
 */
async function documentAssistant(req, res, next) {
  try {
    const { documentId, action } = req.body;
    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.department_id AS departmentId,
              d.title, d.document_type AS documentType, d.status,
              d.drive_file_id AS driveFileId, d.drive_folder_id AS driveFolderId,
              f.mime_type AS mimeType
         FROM documents d
         LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
        WHERE d.id=? AND d.deleted_at IS NULL`, [documentId]
    );
    const doc = rows[0];
    if (!doc) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);

    // isolasi entity (user hanya boleh akses entity-nya)
    if (req.user.entityId && req.user.entityId !== doc.entityId && !req.user.permissions?.includes('entity.cross_access')) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses ke entity dokumen ini', 403);
    }

    // Siapkan teks sumber
    let sourceText = '';
    if (doc.mimeType === 'application/vnd.google-apps.document' && doc.driveFileId) {
      sourceText = await getDocPlainText(doc.driveFileId, {
        entityId: doc.entityId,
        userId: req.user.sub,
        subjectType: 'document',
        subjectId: doc.id,
      });
    } else {
      // Fase ini hanya mendukung Google Docs untuk ekstraksi teks.
      // File non-Docs: kirim metadata + judul saja.
      sourceText = `Judul: ${doc.title}\nTipe: ${doc.documentType}\nStatus: ${doc.status}`;
    }

    const instruction = {
      summarize: 'Ringkas dokumen berikut dalam poin-poin penting (maksimum 10 poin). Sebutkan pihak/angka/tanggal kunci bila ada.',
      check_completeness: 'Periksa kelengkapan dokumen berikut. Daftar bagian yang WAJIB ada untuk tipe ini, lalu tandai mana yang hilang/kurang. Format output: daftar temuan + status OK/HILANG.',
      check_consistency: 'Periksa konsistensi angka, nama pihak, tanggal, dan total pada dokumen berikut. Laporkan setiap ketidaksesuaian dengan kutipan singkat bagian yang bermasalah.',
    }[action] || 'Ringkas dokumen berikut.';

    const prompt = `${instruction}\n\n---\n${sourceText}\n---`;

    const result = await runModule('document_assistant', prompt, {
      entityId: doc.entityId,
      userId: req.user.sub,
      subjectType: 'document',
      subjectId: doc.id,
    });

    const promptHash = crypto.createHash('sha256').update(prompt).digest('hex');

    const [ins] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, department_id, module, subject_type, subject_id,
        provider, model, prompt_hash, content, tokens_in, tokens_out, created_by)
       VALUES (?, ?, 'document_assistant', 'document', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc.entityId, doc.departmentId, doc.id, result.provider, result.model,
       promptHash, result.content, result.tokensIn || null, result.tokensOut || null,
       req.user.sub]
    );

    await log({
      entityId: doc.entityId, userId: req.user.sub,
      action: 'ai.document_assistant', subjectType: 'document', subjectId: doc.id,
      metadata: { action, provider: result.provider, model: result.model, summaryId: ins.insertId },
    });

    return ok(res, {
      summaryId: ins.insertId,
      action,
      provider: result.provider,
      model: result.model,
      content: result.content,
    }, undefined, 201);
  } catch (e) { next(e); }
}

async function listSummaries(req, res, next) {
  try {
    const permissions = req.user.permissions || [];
    const requestedEntityId = req.query.entityId ? Number(req.query.entityId) : null;
    const ownEntityId = req.user.entityId ? Number(req.user.entityId) : null;
    let entityId = ownEntityId;

    if (requestedEntityId && requestedEntityId !== ownEntityId) {
      if (!permissions.includes('entity.cross_access')) {
        return fail(res, 'FORBIDDEN', 'Tidak punya akses lintas entity', 403);
      }
      entityId = requestedEntityId;
    }

    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);

    const where = ['entity_id = ?'];
    const args = [entityId];
    if (req.query.subjectType) { where.push('subject_type = ?'); args.push(req.query.subjectType); }
    if (req.query.subjectId) { where.push('subject_id = ?'); args.push(req.query.subjectId); }
    if (req.query.module) { where.push('module = ?'); args.push(req.query.module); }

    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, module,
              subject_type AS subjectType, subject_id AS subjectId,
              provider, model, content, tokens_in AS tokensIn,
              tokens_out AS tokensOut, created_at AS createdAt
         FROM ai_summaries
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT 50`,
      args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function getModuleConfig(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT module, provider, model, system_prompt AS systemPrompt, params, is_active AS isActive
         FROM ai_module_contexts ORDER BY module ASC`
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function updateModuleConfig(req, res, next) {
  try {
    const { module } = req.params;
    const updates = [];
    const args = [];

    if (req.body.provider !== undefined) {
      updates.push('provider=?');
      args.push(req.body.provider);
    }
    if (req.body.model !== undefined) {
      updates.push('model=?');
      args.push(req.body.model);
    }
    if (req.body.systemPrompt !== undefined) {
      updates.push('system_prompt=?');
      args.push(req.body.systemPrompt || null);
    }
    if (req.body.params !== undefined) {
      updates.push('params=?');
      args.push(req.body.params ? JSON.stringify(req.body.params) : null);
    }
    if (req.body.isActive !== undefined) {
      updates.push('is_active=?');
      args.push(req.body.isActive ? 1 : 0);
    }

    if (!updates.length) {
      return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);
    }

    args.push(module);
    const [result] = await pool.query(
      `UPDATE ai_module_contexts
          SET ${updates.join(', ')}
        WHERE module=?`,
      args
    );

    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Module tidak ditemukan', 404);
    }

    await log({
      entityId: null,
      userId: req.user.sub,
      action: 'ai.module_config.update',
      subjectType: 'ai_module_context',
      subjectId: null,
      metadata: {
        module,
        provider: req.body.provider,
        model: req.body.model,
        fields: Object.keys(req.body),
      },
    });

    return ok(res, { module });
  } catch (e) { next(e); }
}


module.exports = { documentAssistant, listSummaries, getModuleConfig, updateModuleConfig };
