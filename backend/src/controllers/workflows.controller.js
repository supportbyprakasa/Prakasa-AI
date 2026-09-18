const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const workflowSvc = require('../services/workflow.service');

async function getWorkflow(id, entityId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT * FROM workflow_definitions
      WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
    [id, entityId]
  );
  return rows[0] || null;
}

async function ensurePermissionCode(code, conn = pool) {
  if (code === undefined || code === null || code === '') return;
  const [rows] = await conn.query(
    'SELECT id FROM permissions WHERE code=? LIMIT 1',
    [code]
  );
  if (!rows[0]) {
    const error = new Error(`Permission code tidak dikenal: ${code}`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

function validateDefinition(statuses) {
  if (!statuses.length) {
    const error = new Error('Minimal 1 status');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (statuses.filter((status) => status.isInitial).length !== 1) {
    const error = new Error('Workflow harus punya tepat 1 status initial');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (!statuses.some((status) => status.isFinal)) {
    const error = new Error('Workflow harus punya minimal 1 status final');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  const codes = statuses.map((status) => status.code);
  if (new Set(codes).size !== codes.length) {
    const error = new Error('Code status tidak boleh duplikat');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  if (codes.some((code) => !/^[a-z0-9_-]+$/.test(code))) {
    const error = new Error('Code status hanya huruf kecil, angka, dash, underscore');
    error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
}

async function list(req, res, next) {
  try {
    const rows = await workflowSvc.listDefinitions({
      entityId: req.entityScope.entityId,
      activeOnly: req.query.activeOnly !== '0',
    });
    return ok(res, rows);
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const definition = await workflowSvc.getDefinitionDetail(req.params.id);
    if (!definition) {
      return fail(res, 'NOT_FOUND', 'Workflow definition tidak ditemukan', 404);
    }
    if (Number(definition.entity_id) !== Number(req.entityScope.entityId)) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses', 403);
    }
    return ok(res, definition);
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      name, slug, description, appliesTo, referenceId,
      isActive = true, statuses = [], transitions = [],
    } = req.body;
    const entityId = req.entityScope.entityId;

    validateDefinition(statuses);

    await conn.beginTransaction();
    for (const transition of transitions) {
      await ensurePermissionCode(transition.requiredPermissionCode, conn);
    }

    const [result] = await conn.query(
      `INSERT INTO workflow_definitions
       (entity_id, name, slug, description, applies_to, reference_id,
        is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId, name, slug, description ?? null,
        appliesTo ?? null, referenceId ?? null,
        isActive ? 1 : 0, req.user.sub,
      ]
    );

    const codeToId = new Map();
    for (let index = 0; index < statuses.length; index++) {
      const status = statuses[index];
      const [statusResult] = await conn.query(
        `INSERT INTO workflow_statuses
         (workflow_definition_id, code, label, color,
          is_initial, is_final, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId, status.code, status.label,
          status.color || '#64748b',
          status.isInitial ? 1 : 0,
          status.isFinal ? 1 : 0,
          Number.isInteger(status.orderIndex) ? status.orderIndex : index,
        ]
      );
      codeToId.set(status.code, statusResult.insertId);
    }

    for (let index = 0; index < transitions.length; index++) {
      const transition = transitions[index];
      const fromId = codeToId.get(transition.fromStatusCode);
      const toId = codeToId.get(transition.toStatusCode);
      if (!fromId || !toId) {
        const error = new Error(
          `Transition reference tidak valid: ${transition.fromStatusCode} -> ${transition.toStatusCode}`
        );
        error.status = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }
      if (fromId === toId) {
        const error = new Error('Transition from/to status tidak boleh sama');
        error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
      }

      await conn.query(
        `INSERT INTO workflow_transitions
         (workflow_definition_id, from_status_id, to_status_id,
          action_label, required_permission_code, requires_approval,
          requires_signature, requires_comment, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId, fromId, toId, transition.actionLabel,
          transition.requiredPermissionCode ?? null,
          transition.requiresApproval ? 1 : 0,
          transition.requiresSignature ? 1 : 0,
          transition.requiresComment ? 1 : 0,
          Number.isInteger(transition.orderIndex) ? transition.orderIndex : index,
        ]
      );
    }

    await conn.commit();

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.create',
      subjectType: 'workflow_definition',
      subjectId: result.insertId,
      metadata: { name, slug, statusCount: statuses.length, transitionCount: transitions.length },
    });

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Slug/status/transition sudah dipakai', 409);
    }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally { conn.release(); }
}

async function update(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }

    const map = {
      name: 'name',
      description: 'description',
      appliesTo: 'applies_to',
      referenceId: 'reference_id',
      isActive: 'is_active',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (key === 'isActive') value = value ? 1 : 0;
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.id, entityId);
      await pool.query(
        `UPDATE workflow_definitions SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.update', subjectType: 'workflow_definition',
      subjectId: Number(req.params.id), metadata: req.body,
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      `UPDATE workflow_definitions
          SET deleted_at=NOW(), is_active=0
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }
    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'workflow.delete', subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

async function createStatus(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId, conn))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }
    if (!/^[a-z0-9_-]+$/.test(req.body.code)) {
      return fail(res, 'VALIDATION_ERROR', 'Code status tidak valid', 400);
    }

    await conn.beginTransaction();
    if (req.body.isInitial) {
      await conn.query(
        'UPDATE workflow_statuses SET is_initial=0 WHERE workflow_definition_id=?',
        [req.params.id]
      );
    }
    const [result] = await conn.query(
      `INSERT INTO workflow_statuses
       (workflow_definition_id, code, label, color, is_initial, is_final, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, req.body.code, req.body.label,
        req.body.color || '#64748b',
        req.body.isInitial ? 1 : 0,
        req.body.isFinal ? 1 : 0,
        req.body.orderIndex ?? 0,
      ]
    );
    await conn.commit();

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.status.create',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { statusId: result.insertId, code: req.body.code },
    });
    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Code status sudah dipakai', 409);
    }
    next(error);
  } finally { conn.release(); }
}

async function updateStatus(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId, conn))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }

    await conn.beginTransaction();
    const [statusRows] = await conn.query(
      `SELECT * FROM workflow_statuses
        WHERE id=? AND workflow_definition_id=? FOR UPDATE`,
      [req.params.statusId, req.params.id]
    );
    const current = statusRows[0];
    if (!current) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Status tidak ditemukan', 404);
    }

    if (current.is_initial && req.body.isInitial === false) {
      const [others] = await conn.query(
        `SELECT id FROM workflow_statuses
          WHERE workflow_definition_id=? AND id<>? AND is_initial=1 LIMIT 1`,
        [req.params.id, req.params.statusId]
      );
      if (!others[0]) {
        await conn.rollback();
        return fail(res, 'CONFLICT', 'Workflow harus tetap punya status initial', 409);
      }
    }

    if (req.body.isInitial === true) {
      await conn.query(
        `UPDATE workflow_statuses SET is_initial=0
          WHERE workflow_definition_id=? AND id<>?`,
        [req.params.id, req.params.statusId]
      );
    }

    const map = {
      label: 'label',
      color: 'color',
      isInitial: 'is_initial',
      isFinal: 'is_final',
      orderIndex: 'order_index',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (key === 'isInitial' || key === 'isFinal') value = value ? 1 : 0;
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.statusId, req.params.id);
      await conn.query(
        `UPDATE workflow_statuses SET ${fields.join(', ')}
          WHERE id=? AND workflow_definition_id=?`,
        values
      );
    }
    await conn.commit();

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.status.update',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { statusId: Number(req.params.statusId), ...req.body },
    });
    return ok(res, { id: Number(req.params.statusId) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally { conn.release(); }
}

async function removeStatus(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }

    const [statusRows] = await pool.query(
      `SELECT * FROM workflow_statuses
        WHERE id=? AND workflow_definition_id=?`,
      [req.params.statusId, req.params.id]
    );
    const status = statusRows[0];
    if (!status) return fail(res, 'NOT_FOUND', 'Status tidak ditemukan', 404);
    if (status.is_initial) {
      return fail(res, 'CONFLICT', 'Tidak bisa hapus status initial', 409);
    }

    const [[usage]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM workflow_instances WHERE current_status_id=?) AS currentCount,
         (SELECT COUNT(*) FROM workflow_instance_history
           WHERE from_status_id=? OR to_status_id=?) AS historyCount`,
      [req.params.statusId, req.params.statusId, req.params.statusId]
    );
    if (Number(usage.currentCount) > 0 || Number(usage.historyCount) > 0) {
      return fail(res, 'CONFLICT', 'Status sudah dipakai workflow/history', 409);
    }

    await pool.query(
      'DELETE FROM workflow_statuses WHERE id=? AND workflow_definition_id=?',
      [req.params.statusId, req.params.id]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.status.delete',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { statusId: Number(req.params.statusId) },
    });
    return ok(res, { id: Number(req.params.statusId) });
  } catch (error) { next(error); }
}

async function createTransition(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }
    await ensurePermissionCode(req.body.requiredPermissionCode);

    const [statuses] = await pool.query(
      'SELECT id, code FROM workflow_statuses WHERE workflow_definition_id=?',
      [req.params.id]
    );
    const fromId = statuses.find((status) => status.code === req.body.fromStatusCode)?.id;
    const toId = statuses.find((status) => status.code === req.body.toStatusCode)?.id;
    if (!fromId || !toId) {
      return fail(res, 'VALIDATION_ERROR', 'fromStatusCode / toStatusCode tidak valid', 400);
    }
    if (fromId === toId) {
      return fail(res, 'VALIDATION_ERROR', 'Transition from/to tidak boleh sama', 400);
    }

    const [result] = await pool.query(
      `INSERT INTO workflow_transitions
       (workflow_definition_id, from_status_id, to_status_id, action_label,
        required_permission_code, requires_approval, requires_signature,
        requires_comment, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, fromId, toId, req.body.actionLabel,
        req.body.requiredPermissionCode ?? null,
        req.body.requiresApproval ? 1 : 0,
        req.body.requiresSignature ? 1 : 0,
        req.body.requiresComment ? 1 : 0,
        req.body.orderIndex ?? 0,
      ]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.transition.create',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { transitionId: result.insertId, ...req.body },
    });
    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Transisi sudah ada', 409);
    }
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function updateTransition(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }
    await ensurePermissionCode(req.body.requiredPermissionCode);

    const map = {
      actionLabel: 'action_label',
      requiredPermissionCode: 'required_permission_code',
      requiresApproval: 'requires_approval',
      requiresSignature: 'requires_signature',
      requiresComment: 'requires_comment',
      orderIndex: 'order_index',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (['requiresApproval','requiresSignature','requiresComment'].includes(key)) {
        value = value ? 1 : 0;
      }
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.transitionId, req.params.id);
      const [result] = await pool.query(
        `UPDATE workflow_transitions SET ${fields.join(', ')}
          WHERE id=? AND workflow_definition_id=?`,
        values
      );
      if (!result.affectedRows) {
        return fail(res, 'NOT_FOUND', 'Transition tidak ditemukan', 404);
      }
    }

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.transition.update',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { transitionId: Number(req.params.transitionId), ...req.body },
    });
    return ok(res, { id: Number(req.params.transitionId) });
  } catch (error) {
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function removeTransition(req, res, next) {
  try {
    const entityId = req.entityScope.entityId;
    if (!(await getWorkflow(req.params.id, entityId))) {
      return fail(res, 'NOT_FOUND', 'Workflow tidak ditemukan', 404);
    }

    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM workflow_instance_history WHERE transition_id=?',
      [req.params.transitionId]
    );
    if (Number(count) > 0) {
      return fail(res, 'CONFLICT', 'Transition sudah pernah dipakai di history', 409);
    }

    const [result] = await pool.query(
      'DELETE FROM workflow_transitions WHERE id=? AND workflow_definition_id=?',
      [req.params.transitionId, req.params.id]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Transition tidak ditemukan', 404);
    }

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'workflow.transition.delete',
      subjectType: 'workflow_definition',
      subjectId: Number(req.params.id),
      metadata: { transitionId: Number(req.params.transitionId) },
    });
    return ok(res, { id: Number(req.params.transitionId) });
  } catch (error) { next(error); }
}

module.exports = {
  list, detail, create, update, remove,
  createStatus, updateStatus, removeStatus,
  createTransition, updateTransition, removeTransition,
};
