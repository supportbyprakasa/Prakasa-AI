const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const workflowSvc = require('../services/workflow.service');

/* ============================================================
   DEFINITIONS
   ============================================================ */

async function list(req, res, next) {
  try {
    const rows = await workflowSvc.listDefinitions({
      entityId: req.entityScope.entityId,
      activeOnly: req.query.activeOnly !== '0',
    });
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const def = await workflowSvc.getDefinitionDetail(id);
    if (!def) return fail(res, 'NOT_FOUND', 'Workflow definition tidak ditemukan', 404);
    if (def.entity_id !== req.entityScope.entityId &&
        !(req.user.permissions || []).includes('entity.manage')) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses', 403);
    }
    return ok(res, def);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { name, slug, description, appliesTo, referenceId, isActive = true, statuses = [], transitions = [] } = req.body;
    const entityId = req.entityScope.entityId;

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return fail(res, 'VALIDATION_ERROR', 'Slug hanya huruf kecil, angka, dan dash', 400);
    }
    if (!statuses.length) return fail(res, 'VALIDATION_ERROR', 'Minimal 1 status', 400);
    if (!statuses.some((s) => s.isInitial)) {
      return fail(res, 'VALIDATION_ERROR', 'Harus ada 1 status initial', 400);
    }

    await conn.beginTransaction();

    const [w] = await conn.query(
      `INSERT INTO workflow_definitions
       (entity_id, name, slug, description, applies_to, reference_id, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, name, slug, description || null, appliesTo || null,
       referenceId || null, isActive ? 1 : 0, req.user.sub]
    );

    const codeToId = {};
    for (let i = 0; i < statuses.length; i++) {
      const s = statuses[i];
      const [r] = await conn.query(
        `INSERT INTO workflow_statuses
         (workflow_definition_id, code, label, color, is_initial, is_final, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [w.insertId, s.code, s.label, s.color || '#64748b',
         s.isInitial ? 1 : 0, s.isFinal ? 1 : 0,
         Number.isInteger(s.orderIndex) ? s.orderIndex : i]
      );
      codeToId[s.code] = r.insertId;
    }

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      const fromId = codeToId[t.fromStatusCode];
      const toId = codeToId[t.toStatusCode];
      if (!fromId || !toId) {
        throw new Error(`Transition reference tidak valid: ${t.fromStatusCoge} → ${t.toStatusCode}`);
      }
      await conn.query(
        `INSERT INTO workflow_transitions
         (workflow_definition_id, from_status_id, to_status_id, action_label,
          required_permission_code, requires_approval, requires_signature,
          requires_comment, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [w.insertId, fromId, toId, t.actionLabel,
         t.requiredPermissionCode || null,
         t.requiresApproval ? 1 : 0, t.requiresSignature ? 1 : 0,
         t.requiresComment ? 1 : 0, Number.isInteger(t.orderIndex) ? t.orderIndex : i]
      );
    }

    await conn.commit();

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.create', subjectType: 'workflow_definition',
      subjectId: w.insertId, metadata: { name, slug },
    });

    return ok(res, { id: w.insertId }, undefined, 201);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Slug sudah dipakai', 409);
    if (/reference tidak valid/i.test(e.message)) {
      return fail(res, 'VALIDATION_ERROR', e.message, 400);
    }
    next(e);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, appliesTo, referenceId, isActive } = req.body;

    const [rows] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    await pool.query(
      `UPDATE workflow_definitions SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         applies_to = COALESCE(?, applies_to),
         reference_id = COALESCE(?, reference_id),
         is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [name ?? null, description ?? null, appliesTo ?? null,
       referenceId ?? null,
       isActive === undefined ? null : (isActive ? 1 : 0),
       id]
    );

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.update', subjectType: 'workflow_definition', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE workflow_definitions SET deleted_at = NOW(), is_active = 0
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.delete', subjectType: 'workflow_definition', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/* ============================================================
   STATUSES
   ============================================================ */

async function createStatus(req, res, next) {
  try {
    const { id } = req.params; // workflow definition id
    const { code, label, color, isInitial, isFinal, orderIndex } = req.body;

    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    // Enforce single initial
    if (isInitial) {
      await pool.query(
        `UPDATE workflow_statuses SET is_initial = 0
          WHERE workflow_definition_id = ?`, [id]
      );
    }

    const [r] = await pool.query(
      `INSERT INTO workflow_statuses
       (workflow_definition_id, code, label, color, is_initial, is_final, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, code, label, color || '#64748b',
       isInitial ? 1 : 0, isFinal ? 1 : 0, orderIndex || 0]
    );

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.status.create', subjectType: 'workflow_definition',
      subjectId: Number(id), metadata: { code, label },
    });

    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Code status sudah dipakai', 409);
    next(e);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { id, statusId } = req.params;
    const { label, color, isInitial, isFinal, orderIndex } = req.body;

    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    if (isInitial) {
      await pool.query(
        `UPDATE workflow_statuses SET is_initial = 0
          WHERE workflow_definition_id = ? AND id <> ?`, [id, statusId]
      );
    }

    const [r] = await pool.query(
      `UPDATE workflow_statuses SET
         label = COALESCE(?, label),
         color = COALESCE(?, color),
         is_initial = COALESCE(?, is_initial),
         is_final = COALESCE(?, is_final),
         order_index = COALESCE(?, order_index)
       WHERE id = ? AND workflow_definition_id = ?`,
      [
        label ?? null, color ?? null,
        isInitial === undefined ? null : (isInitial ? 1 : 0),
        isFinal === undefined ? null : (isFinal ? 1 : 0),
        orderIndex ?? null,
        statusId, id,
      ]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Status tidak ditemukan', 404);

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.status.update', subjectType: 'workflow_definition',
      subjectId: Number(id), metadata: { statusId },
    });

    return ok(res, { id: Number(statusId) });
  } catch (e) { next(e); }
}

async function removeStatus(req, res, next) {
  try {
    const { id, statusId } = req.params;

    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    // Prevent deleting initial or in-use status
    const [s] = await pool.query(
      `SELECT * FROM workflow_statuses WHERE id = ? AND workflow_definition_id = ?`,
      [statusId, id]
    );
    if (!s[0]) return fail(res, 'NOT_FOUND', 'Status tidak ditemukan', 404);
    if (s[0].is_initial) return fail(res, 'CONFLICT', 'Tidak bisa hapus status initial', 409);

    const [usage] = await pool.query(
      `SELECT COUNT(*) AS c FROM workflow_instances WHERE current_status_id = ?`,
      [statusId]
    );
    if (usage[0].c > 0) {
      return fail(res, 'CONFLICT', 'Status masih dipakai oleh workflow instance', 409);
    }

    await pool.query(
      `DELETE FROM workflow_statuses WHERE id = ? AND workflow_definition_id = ?`,
      [statusId, id]
    );
    return ok(res, { id: Number(statusId) });
  } catch (e) { next(e); }
}

/* ============================================================
   TRANSITIONS
   ============================================================ */

async function createTransition(req, res, next) {
  try {
    const { id } = req.params;
    const {
      fromStatusCode, toStatusCode, actionLabel,
      requiredPermissionCode, requiresApproval, requiresSignature,
      requiresComment, orderIndex,
    } = req.body;

    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    const [sts] = await pool.query(
      `SELECT id, code FROM workflow_statuses WHERE workflow_definition_id = ?`,
      [id]
    );
    const fromId = sts.find((s) => s.code === fromStatusCode)?.id;
    const toId = sts.find((s) => s.code === toStatusCode)?.id;
    if (!fromId || !toId) {
      return fail(res, 'VALIDATION_ERROR', 'fromStatusCode / toStatusCode tidak valid', 400);
    }

    const [r] = await pool.query(
      `INSERT INTO workflow_transitions
       (workflow_definition_id, from_status_id, to_status_id, action_label,
        required_permission_code, requires_approval, requires_signature,
        requires_comment, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, fromId, toId, actionLabel,
       requiredPermissionCode || null,
       requiresApproval ? 1 : 0, requiresSignature ? 1 : 0,
       requiresComment ? 1 : 0, orderIndex || 0]
    );

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.transition.create', subjectType: 'workflow_definition',
      subjectId: Number(id), metadata: { fromStatusCode, toStatusCode },
    });

    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Transisi sudah ada', 409);
    next(e);
  }
}

async function updateTransition(req, res, next) {
  try {
    const { id, transitionId } = req.params;
    const {
      actionLabel, requiredPermissionCode, requiresApproval,
      requiresSignature, requiresComment, orderIndex,
    } = req.body;

    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    const [r] = await pool.query(
      `UPDATE workflow_transitions SET
         action_label = COALESCE(?, action_label),
         required_permission_code = COALESCE(?, required_permission_code),
         requires_approval = COALESCE(?, requires_approval),
         requires_signature = COALESCE(?, requires_signature),
         requires_comment = COALESCE(?, requires_comment),
         order_index = COALESCE(?, order_index)
       WHERE id = ? AND workflow_definition_id = ?`,
      [
        actionLabel ?? null, requiredPermissionCode ?? null,
        requiresApproval === undefined ? null : (requiresApproval ? 1 : 0),
        requiresSignature === undefined ? null : (requiresSignature ? 1 : 0),
        requiresComment === undefined ? null : (requiresComment ? 1 : 0),
        orderIndex ?? null, transitionId, id,
      ]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Transition tidak ditemukan', 404);
    return ok(res, { id: Number(transitionId) });
  } catch (e) { next(e); }
}

async function removeTransition(req, res, next) {
  try {
    const { id, transitionId } = req.params;
    const [wf] = await pool.query(
      `SELECT * FROM workflow_definitions
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);

    const [usage] = await pool.query(
      `SELECT COUNT(*) AS c FROM workflow_instance_history WHERE transition_id = ?`,
      [transitionId]
    );
    if (usage[0].c > 0) {
      return fail(res, 'CONFLICT', 'Transition sudah pernah dipakai di history', 409);
    }

    await pool.query(
      `DELETE FROM workflow_transitions WHERE id = ? AND workflow_definition_id = ?`,
      [transitionId, id]
    );
    return ok(res, { id: Number(transitionId) });
  } catch (e) { next(e); }
}

module.exports = {
  list, detail, create, update, remove,
  createStatus, updateStatus, removeStatus,
  createTransition, updateTransition, removeTransition,
};
