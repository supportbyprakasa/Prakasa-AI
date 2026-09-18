const pool = require('../db/pool');
const { log: activityLog } = require('./activityLog.service');

async function listDefinitions({ entityId, activeOnly = true } = {}) {
  const where = ['wd.deleted_at IS NULL'];
  const args = [];

  if (entityId) {
    where.push('wd.entity_id = ?');
    args.push(entityId);
  }
  if (activeOnly) where.push('wd.is_active = 1');

  const [rows] = await pool.query(
    `SELECT wd.id, wd.entity_id AS entityId, wd.name, wd.slug, wd.description,
            wd.applies_to AS appliesTo, wd.is_active AS isActive,
            wd.created_at AS createdAt,
            (SELECT COUNT(*) FROM workflow_statuses ws
              WHERE ws.workflow_definition_id = wd.id) AS statusCount,
            (SELECT COUNT(*) FROM workflow_transitions wt
              WHERE wt.workflow_definition_id = wd.id) AS transitionCount
       FROM workflow_definitions wd
      WHERE ${where.join(' AND ')}
      ORDER BY wd.id DESC`,
    args
  );

  return rows;
}

async function getDefinitionDetail(definitionId) {
  const [definitions] = await pool.query(
    `SELECT * FROM workflow_definitions
      WHERE id = ? AND deleted_at IS NULL`,
    [definitionId]
  );
  const definition = definitions[0];
  if (!definition) return null;

  const [statuses] = await pool.query(
    `SELECT id, code, label, color,
            is_initial AS isInitial,
            is_final AS isFinal,
            order_index AS orderIndex
       FROM workflow_statuses
      WHERE workflow_definition_id = ?
      ORDER BY order_index ASC, id ASC`,
    [definitionId]
  );

  const [transitions] = await pool.query(
    `SELECT wt.id,
            wt.from_status_id AS fromStatusId,
            from_status.code AS fromCode,
            wt.to_status_id AS toStatusId,
            to_status.code AS toCode,
            wt.action_label AS actionLabel,
            wt.required_permission_code AS requiredPermissionCode,
            wt.requires_approval AS requiresApproval,
            wt.requires_signature AS requiresSignature,
            wt.requires_comment AS requiresComment,
            wt.order_index AS orderIndex
       FROM workflow_transitions wt
       JOIN workflow_statuses from_status ON from_status.id = wt.from_status_id
       JOIN workflow_statuses to_status ON to_status.id = wt.to_status_id
      WHERE wt.workflow_definition_id = ?
      ORDER BY wt.order_index ASC, wt.id ASC`,
    [definitionId]
  );

  return { ...definition, statuses, transitions };
}

async function createInstance({
  workflowDefinitionId,
  entityId,
  departmentId,
  subjectType,
  subjectId,
  createdBy,
}, conn = pool) {
  const [definitionRows] = await conn.query(
    `SELECT id, entity_id
       FROM workflow_definitions
      WHERE id = ? AND deleted_at IS NULL AND is_active = 1`,
    [workflowDefinitionId]
  );
  const definition = definitionRows[0];
  if (!definition) throw new Error('Workflow definition tidak ditemukan atau tidak aktif');
  if (Number(definition.entity_id) !== Number(entityId)) {
    throw new Error('Workflow definition tidak sesuai entity subject');
  }

  const [statusRows] = await conn.query(
    `SELECT id FROM workflow_statuses
      WHERE workflow_definition_id = ? AND is_initial = 1
      ORDER BY order_index ASC, id ASC
      LIMIT 1`,
    [workflowDefinitionId]
  );
  if (!statusRows[0]) throw new Error('Workflow tidak punya status awal');

  const [result] = await conn.query(
    `INSERT INTO workflow_instances
     (workflow_definition_id, entity_id, department_id,
      subject_type, subject_id, current_status_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowDefinitionId,
      entityId,
      departmentId || null,
      subjectType,
      subjectId,
      statusRows[0].id,
      createdBy || null,
    ]
  );

  await conn.query(
    `INSERT INTO workflow_instance_history
     (workflow_instance_id, from_status_id, to_status_id,
      transition_id, actor_user_id, comment)
     VALUES (?, NULL, ?, NULL, ?, ?)`,
    [result.insertId, statusRows[0].id, createdBy || null, 'Instance created']
  );

  return result.insertId;
}

async function getInstance(instanceId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT wi.*,
            wd.name AS workflowName,
            wd.slug AS workflowSlug,
            ws.code AS currentStatusCode,
            ws.label AS currentStatusLabel,
            ws.color AS currentStatusColor,
            ws.is_final AS currentIsFinal
       FROM workflow_instances wi
       JOIN workflow_definitions wd ON wd.id = wi.workflow_definition_id
       JOIN workflow_statuses ws ON ws.id = wi.current_status_id
      WHERE wi.id = ?`,
    [instanceId]
  );

  if (!rows[0]) return null;

  const [history] = await conn.query(
    `SELECT h.id,
            h.from_status_id AS fromStatusId,
            from_status.code AS fromCode,
            h.to_status_id AS toStatusId,
            to_status.code AS toCode,
            h.transition_id AS transitionId,
            t.action_label AS actionLabel,
            h.actor_user_id AS actorUserId,
            u.name AS actorName,
            h.comment,
            h.metadata_json AS metadata,
            h.created_at AS createdAt
       FROM workflow_instance_history h
       LEFT JOIN workflow_statuses from_status ON from_status.id = h.from_status_id
       JOIN workflow_statuses to_status ON to_status.id = h.to_status_id
       LEFT JOIN workflow_transitions t ON t.id = h.transition_id
       LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.workflow_instance_id = ?
      ORDER BY h.id ASC`,
    [instanceId]
  );

  const [availableTransitions] = await conn.query(
    `SELECT wt.id,
            wt.action_label AS actionLabel,
            to_status.code AS toCode,
            to_status.label AS toLabel,
            wt.required_permission_code AS requiredPermissionCode,
            wt.requires_approval AS requiresApproval,
            wt.requires_signature AS requiresSignature,
            wt.requires_comment AS requiresComment
       FROM workflow_transitions wt
       JOIN workflow_statuses to_status ON to_status.id = wt.to_status_id
      WHERE wt.workflow_definition_id = ?
        AND wt.from_status_id = ?
      ORDER BY wt.order_index ASC, wt.id ASC`,
    [rows[0].workflow_definition_id, rows[0].current_status_id]
  );

  return { ...rows[0], history, availableTransitions };
}

async function findInstanceBySubject({
  entityId,
  subjectType,
  subjectId,
}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id FROM workflow_instances
      WHERE entity_id = ? AND subject_type = ? AND subject_id = ?
      LIMIT 1`,
    [entityId, subjectType, subjectId]
  );
  return rows[0]?.id || null;
}

async function resolveTransitionGuards(instance, transition, conn) {
  let approvalSatisfied = !transition.requires_approval;
  let signatureSatisfied = !transition.requires_signature;

  if (transition.requires_approval) {
    const [rows] = await conn.query(
      `SELECT 1
         FROM approval_requests ar
        WHERE ar.entity_id = ?
          AND (
            (ar.subject_type = ? AND ar.subject_id = ?)
            OR (
              ? = 'form_submission'
              AND ar.id = (
                SELECT fs.approval_request_id
                  FROM form_submissions fs
                 WHERE fs.id = ? LIMIT 1
              )
            )
          )
          AND ar.status = 'approved'
        LIMIT 1`,
      [
        instance.entity_id,
        instance.subject_type,
        instance.subject_id,
        instance.subject_type,
        instance.subject_id,
      ]
    );
    approvalSatisfied = Boolean(rows[0]);
  }

  if (transition.requires_signature) {
    const [rows] = await conn.query(
      `SELECT 1
         FROM signature_requests sr
         JOIN approval_requests ar ON ar.id = sr.approval_request_id
        WHERE ar.entity_id = ?
          AND (
            (ar.subject_type = ? AND ar.subject_id = ?)
            OR (
              ? = 'form_submission'
              AND ar.id = (
                SELECT fs.approval_request_id
                  FROM form_submissions fs
                 WHERE fs.id = ? LIMIT 1
              )
            )
          )
          AND sr.status = 'signed'
        LIMIT 1`,
      [
        instance.entity_id,
        instance.subject_type,
        instance.subject_id,
        instance.subject_type,
        instance.subject_id,
      ]
    );
    signatureSatisfied = Boolean(rows[0]);
  }

  return { approvalSatisfied, signatureSatisfied };
}

async function validateTransition({
  instance,
  transitionId,
  user,
  comment,
  conn = pool,
}) {
  if (!instance) {
    const error = new Error('Workflow instance tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (instance.current_is_final || instance.currentIsFinal) {
    const error = new Error('Workflow sudah final');
    error.status = 409;
    error.code = 'WF_FINAL';
    throw error;
  }

  const [transitionRows] = await conn.query(
    `SELECT wt.*,
            to_status.code AS toCode,
            to_status.is_final AS toIsFinal
       FROM workflow_transitions wt
       JOIN workflow_statuses to_status ON to_status.id = wt.to_status_id
      WHERE wt.id = ? AND wt.workflow_definition_id = ?`,
    [transitionId, instance.workflow_definition_id]
  );

  const transition = transitionRows[0];
  if (!transition) {
    const error = new Error('Transition tidak ditemukan di workflow ini');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (Number(transition.from_status_id) !== Number(instance.current_status_id)) {
    const error = new Error('Transition tidak berlaku dari status saat ini');
    error.status = 409;
    error.code = 'WF_INVALID_TRANSITION';
    throw error;
  }

  if (transition.required_permission_code) {
    const permissions = user?.permissions || [];
    if (!permissions.includes(transition.required_permission_code)) {
      const error = new Error(
        `Butuh permission: ${transition.required_permission_code}`
      );
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
  }

  if (transition.requires_comment && !String(comment || '').trim()) {
    const error = new Error('Comment wajib untuk transisi ini');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const guards = await resolveTransitionGuards(instance, transition, conn);

  if (transition.requires_approval && guards.approvalSatisfied !== true) {
    const error = new Error('Approval wajib dipenuhi sebelum transisi ini');
    error.status = 409;
    error.code = 'WF_APPROVAL_REQUIRED';
    throw error;
  }

  if (transition.requires_signature && guards.signatureSatisfied !== true) {
    const error = new Error('Signature wajib dipenuhi sebelum transisi ini');
    error.status = 409;
    error.code = 'WF_SIGNATURE_REQUIRED';
    throw error;
  }

  return transition;
}

async function transition({
  instanceId,
  transitionId,
  user,
  comment,
  metadata,
}) {
  const conn = await pool.getConnection();
  let committed = false;

  try {
    await conn.beginTransaction();

    const [instanceRows] = await conn.query(
      `SELECT wi.*, ws.is_final AS current_is_final
         FROM workflow_instances wi
         JOIN workflow_statuses ws ON ws.id = wi.current_status_id
        WHERE wi.id = ?
        FOR UPDATE`,
      [instanceId]
    );
    const instance = instanceRows[0];
    if (!instance) {
      const error = new Error('Workflow instance tidak ditemukan');
      error.status = 404;
      error.code = 'NOT_FOUND';
      throw error;
    }

    const crossEntity = (user?.permissions || []).includes('entity.cross_access');
    if (!crossEntity && Number(user?.entityId) !== Number(instance.entity_id)) {
      const error = new Error('Tidak punya akses ke workflow instance ini');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const target = await validateTransition({
      instance,
      transitionId,
      user,
      comment,
      conn,
    });

    await conn.query(
      `UPDATE workflow_instances
          SET current_status_id = ?,
              closed_at = CASE WHEN ? = 1 THEN NOW() ELSE NULL END
        WHERE id = ?`,
      [target.to_status_id, target.toIsFinal ? 1 : 0, instanceId]
    );

    if (instance.subject_type === 'form_submission') {
      await conn.query(
        `UPDATE form_submissions
            SET status = ?
          WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
        [target.toCode, instance.subject_id, instance.entity_id]
      );
    }

    await conn.query(
      `INSERT INTO workflow_instance_history
       (workflow_instance_id, from_status_id, to_status_id, transition_id,
        actor_user_id, comment, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        instanceId,
        instance.current_status_id,
        target.to_status_id,
        target.id,
        user?.sub || null,
        comment || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    await conn.commit();
    committed = true;

    try {
      await activityLog({
        entityId: instance.entity_id,
        userId: user?.sub || null,
        action: 'workflow.transition',
        subjectType: instance.subject_type,
        subjectId: instance.subject_id,
        metadata: {
          instanceId,
          transitionId: target.id,
          toCode: target.toCode,
          comment,
        },
      });
    } catch {
      // Transition is already committed; activity log failure must not roll it back.
    }

    return {
      instanceId,
      toStatusId: target.to_status_id,
      toCode: target.toCode,
      isFinal: Boolean(target.toIsFinal),
    };
  } catch (error) {
    if (!committed) {
      try { await conn.rollback(); } catch { /* noop */ }
    }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  listDefinitions,
  getDefinitionDetail,
  createInstance,
  getInstance,
  findInstanceBySubject,
  validateTransition,
  transition,
};
