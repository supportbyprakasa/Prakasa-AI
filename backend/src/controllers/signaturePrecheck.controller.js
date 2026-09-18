const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const precheckSvc = require('../services/signaturePrecheck.service');

function parseJson(value) {
  if (!value) return [];
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return []; }
}

async function run(req, res, next) {
  try {
    const {
      documentId,
      signatureRequestId = null,
      approvalRequestId = null,
    } = req.body;
    const entityId = req.entityScope.entityId;

    const [docs] = await pool.query(
      `SELECT id, entity_id
         FROM documents
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [documentId, entityId]
    );
    if (!docs[0]) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);

    let signatureRequest = null;
    if (signatureRequestId) {
      const [rows] = await pool.query(
        `SELECT id, approval_request_id AS approvalRequestId
           FROM signature_requests
          WHERE id=? AND entity_id=? AND document_id=?
          LIMIT 1`,
        [signatureRequestId, entityId, documentId]
      );
      signatureRequest = rows[0] || null;
      if (!signatureRequest) {
        return fail(res, 'VALIDATION_ERROR', 'Signature request tidak sesuai dokumen', 400);
      }
    }

    if (approvalRequestId) {
      const [rows] = await pool.query(
        `SELECT id FROM approval_requests
          WHERE id=? AND entity_id=?
            AND (
              document_id=?
              OR (subject_type='document' AND subject_id=?)
            )
          LIMIT 1`,
        [approvalRequestId, entityId, documentId, documentId]
      );
      if (!rows[0]) {
        return fail(res, 'VALIDATION_ERROR', 'Approval request tidak sesuai dokumen', 400);
      }

      if (
        signatureRequest &&
        signatureRequest.approvalRequestId &&
        Number(signatureRequest.approvalRequestId) !== Number(approvalRequestId)
      ) {
        return fail(
          res,
          'VALIDATION_ERROR',
          'Approval request tidak sesuai signature request',
          400
        );
      }
    }

    const result = await precheckSvc.runPrecheck({
      documentId,
      signatureRequestId,
      approvalRequestId,
      user: req.user,
    });

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'signature_precheck.run',
      subjectType: 'document',
      subjectId: Number(documentId),
      metadata: {
        status: result.status,
        precheckLogId: result.precheckLogId,
      },
    });

    return ok(res, result, undefined, 201);
  } catch (error) {
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 20);
    const offset = (page - 1) * limit;

    const where = ['entity_id=?'];
    const args = [req.entityScope.entityId];

    if (req.query.documentId) {
      where.push('document_id=?');
      args.push(req.query.documentId);
    }
    if (req.query.signatureRequestId) {
      where.push('signature_request_id=?');
      args.push(req.query.signatureRequestId);
    }
    if (req.query.status) {
      where.push('status=?');
      args.push(req.query.status);
    }

    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              document_id AS documentId,
              signature_request_id AS signatureRequestId,
              approval_request_id AS approvalRequestId,
              ai_summary_id AS aiSummaryId,
              status, summary, findings_json AS findingsJson,
              provider, model, tokens_in AS tokensIn,
              tokens_out AS tokensOut, duration_ms AS durationMs,
              created_by AS createdBy, created_at AS createdAt
         FROM signature_precheck_logs
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM signature_precheck_logs
        WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(res, rows.map((row) => ({
      ...row,
      findings: parseJson(row.findingsJson),
      findingsJson: undefined,
    })), { page, limit, total });
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, department_id AS departmentId,
              document_id AS documentId,
              signature_request_id AS signatureRequestId,
              approval_request_id AS approvalRequestId,
              ai_summary_id AS aiSummaryId,
              status, summary, findings_json AS findingsJson,
              provider, model, tokens_in AS tokensIn,
              tokens_out AS tokensOut, duration_ms AS durationMs,
              created_by AS createdBy, created_at AS createdAt
         FROM signature_precheck_logs
        WHERE id=? AND entity_id=?
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Precheck log tidak ditemukan', 404);

    return ok(res, {
      ...rows[0],
      findings: parseJson(rows[0].findingsJson),
      findingsJson: undefined,
    });
  } catch (error) { next(error); }
}

module.exports = { run, list, detail };
