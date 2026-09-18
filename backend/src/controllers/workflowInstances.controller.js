const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { assertEntityAccess } = require('../middleware/entityScope');
const workflowSvc = require('../services/workflow.service');

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const instance = await workflowSvc.getInstance(id);
    if (!instance) return fail(res, 'NOT_FOUND', 'Workflow instance tidak ditemukan', 404);
    assertEntityAccess(req, { entity_id: instance.entity_id });

    // Filter available transitions by user permission
    const perms = req.user.permissions || [];
    const filtered = (instance.availableTransitions || []).filter((t) => {
      if (!t.requiredPermissionCode) return true;
      return perms.includes(t.requiredPermissionCode);
    });

    return ok(res, { ...instance, availableTransitions: filtered });
  } catch (e) { next(e); }
}

async function listBySubject(req, res, next) {
  try {
    const { subjectType, subjectId } = req.query;
    if (!subjectType || !subjectId) {
      return fail(res, 'VALIDATION_ERROR', 'subjectType & subjectId wajib', 400);
    }
    const instanceId = await workflowSvc.findInstanceBySubject({
      entityId: req.entityScope.entityId,
      subjectType,
      subjectId: Number(subjectId),
    });
    if (!instanceId) return ok(res, null);
    const instance = await workflowSvc.getInstance(instanceId);
    if (!instance) return ok(res, null);
    assertEntityAccess(req, { entity_id: instance.entity_id });
    return ok(res, instance);
  } catch (e) { next(e); }
}

async function transition(req, res, next) {
  try {
    const { id } = req.params;
    const { transitionId, comment, metadata } = req.body;

    const instance = await workflowSvc.getInstance(id);
    if (!instance) return fail(res, 'NOT_FOUND', 'Workflow instance tidak ditemukan', 404);
    assertEntityAccess(req, { entity_id: instance.entity_id });

    const result = await workflowSvc.transition({
      instanceId: Number(id),
      transitionId: Number(transitionId),
      user: req.user,
      comment,
      metadata,
    });

    return ok(res, result);
  } catch (e) {
    if (e.status === 403) return fail(res, 'FORBIDDEN', e.message, 403);
    if (e.status === 404) return fail(res, 'NOT_FOUND', e.message, 404);
    if (e.status === 409) return fail(res, e.code || 'CONFLICT', e.message, 409);
    if (e.status === 400) return fail(res, 'VALIDATION_ERROR', e.message, 400);
    next(e);
  }
}

async function listByEntity(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['wi.entity_id = ?'];
    const args = [req.entityScope.entityId];
    if (req.query.subjectType) { where.push('wi.subject_type = ?'); args.push(req.query.subjectType); }
    if (req.query.statusId) { where.push('wi.current_status_id = ?'); args.push(req.query.statusId); }
    if (req.query.definitionId) { where.push('wi.workflow_definition_id = ?'); args.push(req.query.definitionId); }

    const [rows] = await pool.query(
      `SELECT wi.id, wi.workflow_definition_id AS workflowDefinitionId,
              wd.name AS workflowName, wd.slug AS workflowSlug,
              wi.subject_type AS subjectType, wi.subject_id AS subjectId,
              wi.current_status_id AS currentStatusId,
              ws.code AS currentStatusCode, ws.label AS currentStatusLabel,
              ws.color AS currentStatusColor, ws.is_final AS isFinal,
              wi.created_by AS createdBy, u.name AS createdByName,
              wi.created_at AS createdAt, wi.closed_at AS closedAt
         FROM workflow_instances wi
         JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
         JOIN workflow_statuses ws ON ws.id = wi.current_status_id
         LEFT JOIN users u ON u.id = wi.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY wi.id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM workflow_instances wi WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

module.exports = { detail, listBySubject, transition, listByEntity };
