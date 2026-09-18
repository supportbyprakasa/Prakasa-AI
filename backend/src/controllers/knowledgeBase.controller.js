const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { runModule } = require('../services/ai/provider');
const kbSvc = require('../services/knowledgeBase.service');

async function listDocs(req, res, next) {
  try {
    const where = ['deleted_at IS NULL', 'is_active=1'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id=?'); args.push(req.query.entityId); }
    if (req.query.category) { where.push('category=?'); args.push(req.query.category); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              title, category, visibility, is_active AS isActive, created_at AS createdAt
         FROM kb_documents WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function createDoc(req, res, next) {
  try {
    const {
      entityId, departmentId, title, category, sourceDocumentId,
      driveFileId, extractedText, visibility = 'entity', allowedRoleIds,
    } = req.body;

    const [r] = await pool.query(
      `INSERT INTO kb_documents
       (entity_id, department_id, title, category, source_document_id,
        drive_file_id, extracted_text, visibility, allowed_role_ids, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, title, category || null,
       sourceDocumentId || null, driveFileId || null, extractedText || null,
       visibility, allowedRoleIds ? JSON.stringify(allowedRoleIds) : null,
       req.user.sub]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'kb.create', subjectType: 'kb_document', subjectId: r.insertId,
      metadata: { title, category, visibility },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function removeDoc(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE kb_documents SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Dokumen KB tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * POST /kb/query
 * Body: { question, entityId?, topK? }
 * AI HANYA menjawab dari konteks dokumen yang user boleh akses.
 */
async function query(req, res, next) {
  try {
    const { question, entityId, topK = 5 } = req.body;
    const useEntityId = entityId || req.user.entityId;
    if (!useEntityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);

    // Ambil role user untuk filter visibility
    const [roles] = await pool.query(
      `SELECT role_id AS roleId FROM user_roles WHERE user_id=?`, [req.user.sub]
    );
    const roleIds = roles.map((r) => r.roleId);

    const docs = await kbSvc.findRelevantDocs({
      entityId: useEntityId,
      userDepartmentId: req.user.departmentId,
      userRoleIds: roleIds,
      question,
      limit: topK,
    });

    if (!docs.length) {
      return ok(res, {
        answer: 'Informasi ini tidak ditemukan di dokumen SOP yang tersedia.',
        sources: [],
        provider: null,
      });
    }

    const contextText = docs.map((d, i) =>
      `--- Sumber ${i + 1}: ${d.title} (${d.category || 'umum'}) ---\n${d.extracted_text || '(kosong)'}`
    ).join('\n\n');

    const prompt = `Pertanyaan user:\n${question}\n\nKonteks dokumen:\n${contextText}`;
    const result = await runModule('knowledge_base', prompt);

    // Simpan ringkasan & query log
    const [ins] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, module, subject_type, subject_id, provider, model,
        content, tokens_in, tokens_out, created_by)
       VALUES (?, 'knowledge_base', 'kb_query', 0, ?, ?, ?, ?, ?, ?)`,
      [useEntityId, result.provider, result.model, result.content,
       result.tokensIn || null, result.tokensOut || null, req.user.sub]
    );
    await pool.query(
      `INSERT INTO kb_query_logs
       (kb_document_id, user_id, entity_id, question, answer, ai_summary_id, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [docs[0].id, req.user.sub, useEntityId, question, result.content,
       ins.insertId, result.provider, result.model]
    );

    await log({
      entityId: useEntityId, userId: req.user.sub,
      action: 'kb.query', subjectType: 'kb_query', subjectId: ins.insertId,
      metadata: { question: question.slice(0, 200), docsUsed: docs.map((d) => d.id) },
    });

    return ok(res, {
      answer: result.content,
      sources: docs.map((d) => ({ id: d.id, title: d.title, category: d.category })),
      provider: result.provider,
      model: result.model,
    }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { listDocs, createDoc, removeDoc, query };
