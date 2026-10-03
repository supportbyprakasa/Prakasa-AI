const pool = require('../db/pool');
const engine = require('./approvalEngine.service');
const approvalAudit = require('./approvalAudit.service');
const { notifySteps } = require('./approvalNotify.service');
const { log: activityLog } = require('./activityLog.service');
const {
  MOVEMENT_TYPES,
  STATUS,
  movementError,
  typeConfig,
  typeForSubject,
  assertMovementTransition,
  isEditableStatus,
  validateMovementInput,
  requireDecisionNote,
  movementDto,
} = require('./warehouseMovementModel');

// Warehouse inbound/outbound movements. Records belong to the entity's Warehouse
// division; the Approval Engine is authoritative for decisions and this service keeps
// the movement in step with it. Approved movements are never posted anywhere else.

const HISTORY_STATUSES = [STATUS.APPROVED, STATUS.CANCELLED];
const MAX_LIMIT = 100;

const hasPerm = (user, code) => (user?.permissions || []).includes(code);

// ---------------------------------------------------------------- MySQL repository

const USER_NAME_COLUMNS = `
  cu.name AS created_by_name, su.name AS submitted_by_name, au.name AS approved_by_name`;
const USER_NAME_JOINS = (alias) => `
  LEFT JOIN users cu ON cu.id=${alias}.created_by
  LEFT JOIN users su ON su.id=${alias}.submitted_by
  LEFT JOIN users au ON au.id=${alias}.approved_by`;

const mysqlRepo = {
  async isSuperAdmin(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id=ur.role_id AND r.deleted_at IS NULL
        WHERE ur.user_id=? AND r.role_key='system.super_admin'
        LIMIT 1`,
      [userId]
    );
    return Boolean(rows[0]);
  },

  async departmentByCode(entityId, code, conn = pool) {
    const [rows] = await conn.query(
      'SELECT id FROM departments WHERE entity_id=? AND code=? AND deleted_at IS NULL LIMIT 1',
      [entityId, code]
    );
    return rows[0]?.id ?? null;
  },

  async insertMovement(config, fields, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO ${config.table}
       (entity_id, department_id, ${config.dateColumn}, reference_no, ${config.partyColumn},
        items, notes, status, created_by, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        fields.entity_id, fields.department_id, fields[config.dateColumn], fields.reference_no,
        fields[config.partyColumn], JSON.stringify(fields.items), fields.notes, fields.status,
        fields.created_by,
      ]
    );
    return result.insertId;
  },

  async lockMovement(config, { id, entityId }, conn) {
    const [rows] = await conn.query(
      `SELECT * FROM ${config.table} WHERE id=? AND entity_id=? LIMIT 1 FOR UPDATE`,
      [id, entityId]
    );
    return rows[0] || null;
  },

  async findMovement(config, { id, entityId }, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.*, ${USER_NAME_COLUMNS}
         FROM ${config.table} m
         ${USER_NAME_JOINS('m')}
        WHERE m.id=? AND m.entity_id=?
        LIMIT 1`,
      [id, entityId]
    );
    return rows[0] || null;
  },

  async updateMovement(config, id, patch, expectedVersion, conn) {
    const columns = Object.keys(patch);
    const assignments = columns.map((column) => `${column}=?`);
    const values = columns.map((column) => (column === 'items' ? JSON.stringify(patch[column]) : patch[column]));
    let sql = `UPDATE ${config.table} SET ${assignments.join(', ')}, version=version+1 WHERE id=?`;
    const args = [...values, id];
    if (expectedVersion != null) {
      sql += ' AND version=?';
      args.push(expectedVersion);
    }
    const [result] = await conn.query(sql, args);
    return result.affectedRows;
  },

  async listMovements(config, filters, conn = pool) {
    const where = ['m.entity_id=?'];
    const args = [filters.entityId];
    if (filters.departmentId != null) { where.push('m.department_id=?'); args.push(filters.departmentId); }
    if (filters.statuses?.length) { where.push('m.status IN (?)'); args.push(filters.statuses); }
    if (filters.from) { where.push(`m.${config.dateColumn}>=?`); args.push(filters.from); }
    if (filters.to) { where.push(`m.${config.dateColumn}<=?`); args.push(filters.to); }
    if (filters.q) {
      where.push(`(m.reference_no LIKE ? OR m.${config.partyColumn} LIKE ?)`);
      args.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const [rows] = await conn.query(
      `SELECT m.*, ${USER_NAME_COLUMNS}
         FROM ${config.table} m
         ${USER_NAME_JOINS('m')}
        WHERE ${where.join(' AND ')}
        ORDER BY m.${config.dateColumn} DESC, m.id DESC
        LIMIT ? OFFSET ?`,
      [...args, filters.limit, filters.offset]
    );
    const [[{ total }]] = await conn.query(
      `SELECT COUNT(*) AS total FROM ${config.table} m WHERE ${where.join(' AND ')}`,
      args
    );
    return { rows, total: Number(total) };
  },

  async approvalSummary(approvalRequestId, conn = pool) {
    if (!approvalRequestId) return null;
    const [requests] = await conn.query(
      `SELECT id, status, decision_note AS decisionNote, decided_at AS decidedAt,
              created_at AS createdAt
         FROM approval_requests WHERE id=? LIMIT 1`,
      [approvalRequestId]
    );
    if (!requests[0]) return null;
    const [steps] = await conn.query(
      `SELECT s.id, s.status, s.order_index AS orderIndex, s.activated_at AS activatedAt,
              s.decided_at AS decidedAt, s.note, r.name AS approverRoleName,
              er.name AS escalatedToRoleName, d.name AS decidedByName
         FROM approval_steps s
         LEFT JOIN roles r ON r.id=s.approver_role_id
         LEFT JOIN roles er ON er.id=s.escalated_to_role_id
         LEFT JOIN users d ON d.id=s.decided_by
        WHERE s.approval_request_id=?
        ORDER BY s.order_index, s.id`,
      [approvalRequestId]
    );
    return { ...requests[0], steps };
  },

  async userRoleIds(userId, entityId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ur.role_id AS roleId FROM user_roles ur
         JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=? AND r.entity_id=? AND r.deleted_at IS NULL`,
      [userId, entityId]
    );
    return rows.map((row) => Number(row.roleId));
  },

  async auditRows(subjectType, subjectId, entityId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT l.id, l.action, l.metadata, l.created_at AS createdAt, u.name AS actorName
         FROM activity_logs l
         LEFT JOIN users u ON u.id=l.user_id
        WHERE l.subject_type=? AND l.subject_id=? AND l.entity_id=?
        ORDER BY l.id DESC
        LIMIT 200`,
      [subjectType, subjectId, entityId]
    );
    return rows.map((row) => ({
      ...row,
      metadata: typeof row.metadata === 'string' ? safeParse(row.metadata) : row.metadata,
    }));
  },
};

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function mysqlTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------- service

function createWarehouseMovementService({
  repo = mysqlRepo,
  engine: approvalEngine = engine,
  transaction = mysqlTransaction,
  audit = {
    log: (entry) => activityLog(entry).catch(() => {}),
    approval: (entry, conn) => approvalAudit.log(entry, conn),
  },
  notify = { steps: (stepIds, request, options) => notifySteps(stepIds, request, options) },
} = {}) {
  async function accessFor(user, conn) {
    const [superAdmin, warehouseDepartmentId] = await Promise.all([
      repo.isSuperAdmin(user.sub, conn),
      repo.departmentByCode(user.entityId, 'warehouse', conn),
    ]);
    const sameDivision = user.departmentId != null && warehouseDepartmentId != null
      && Number(user.departmentId) === Number(warehouseDepartmentId);
    return {
      superAdmin,
      sameDivision,
      warehouseDepartmentId,
      mode: superAdmin ? 'entity' : sameDivision ? 'division' : 'history',
    };
  }

  function canRead(access, row) {
    if (!row) return false;
    if (access.mode === 'entity') return true;
    if (Number(row.department_id) !== Number(access.warehouseDepartmentId)) return false;
    return access.mode === 'division' || HISTORY_STATUSES.includes(row.status);
  }

  const canWrite = (access, row) => access.superAdmin
    || (access.sameDivision && Number(row.department_id) === Number(access.warehouseDepartmentId));

  const notFound = () => movementError('Pergerakan barang tidak ditemukan', 404, 'NOT_FOUND');
  const forbidden = (message) => movementError(message, 403, 'FORBIDDEN');

  function assertVersion(row, version) {
    if (version != null && Number(row.version) !== Number(version)) {
      throw movementError('Data sudah diubah orang lain. Muat ulang lalu coba lagi.', 409, 'VERSION_CONFLICT');
    }
  }

  function decisionDenial(approval, user, row) {
    if (!row) return notFound();
    if (row.status !== STATUS.PENDING || Number(row.approval_request_id) !== Number(approval.id)) {
      return movementError('Pergerakan ini tidak lagi menunggu approval', 409, 'CONFLICT');
    }
    const actor = Number(user.sub);
    if (actor === Number(row.created_by) || actor === Number(row.submitted_by)) {
      return movementError('Pembuat atau pengaju pergerakan tidak boleh menyetujui pergerakannya sendiri', 403, 'SELF_APPROVAL_FORBIDDEN');
    }
    if (!hasPerm(user, 'approval.decide') || !hasPerm(user, 'warehouse.movement.approve')) {
      return forbidden('Keputusan pergerakan barang memerlukan izin approval dan izin tinjau Warehouse');
    }
    if (user.departmentId == null || Number(user.departmentId) !== Number(row.department_id)) {
      return forbidden('Hanya reviewer dari divisi Warehouse yang dapat memutuskan pergerakan ini');
    }
    return null;
  }

  async function loadForDecision(approval, conn) {
    const type = typeForSubject(approval.subject_type);
    const config = typeConfig(type);
    const row = await repo.lockMovement(config, { id: approval.subject_id, entityId: approval.entity_id }, conn);
    return { type, config, row };
  }

  async function detailPermissions(user, access, row, type) {
    const write = canWrite(access, row);
    const permissions = {
      canEdit: write && isEditableStatus(row.status) && hasPerm(user, 'warehouse.movement.update'),
      canSubmit: write && isEditableStatus(row.status) && hasPerm(user, 'warehouse.movement.submit'),
      canCancel: access.sameDivision && row.status === STATUS.APPROVED && hasPerm(user, 'warehouse.movement.cancel'),
      canDecide: false,
      decideBlockedReason: null,
    };
    if (row.status === STATUS.PENDING && row.approval_request_id) {
      const approval = {
        id: row.approval_request_id,
        entity_id: row.entity_id,
        subject_type: typeConfig(type).subjectType,
        subject_id: row.id,
      };
      const denial = decisionDenial(approval, user, row);
      if (denial) {
        permissions.decideBlockedReason = denial.message;
      } else {
        const roles = await repo.userRoleIds(user.sub, row.entity_id);
        const steps = await approvalEngine.getActiveSteps(row.approval_request_id);
        for (const step of steps) {
          if (await approvalEngine.canDecide({
            step, userId: user.sub, userRoleIds: roles, userPermissions: user.permissions || [],
            entityId: row.entity_id, requestType: typeConfig(type).requestType,
          })) {
            permissions.canDecide = true;
            break;
          }
        }
        if (!permissions.canDecide) permissions.decideBlockedReason = 'Anda bukan approver pada langkah aktif';
      }
    }
    return permissions;
  }

  async function list({ user, type, status, from, to, q, page = 1, limit = 20 }) {
    const access = await accessFor(user);
    const pageNumber = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 20));
    let statuses = status ? [status] : null;
    if (access.mode === 'history') {
      statuses = (statuses || HISTORY_STATUSES).filter((value) => HISTORY_STATUSES.includes(value));
    }
    const statusesVisible = access.mode === 'history' ? HISTORY_STATUSES : Object.values(STATUS);
    if (statuses && !statuses.length) {
      return { rows: [], total: 0, page: pageNumber, limit: pageSize, statusesVisible };
    }

    const base = {
      entityId: user.entityId,
      departmentId: access.mode === 'entity' ? null : access.warehouseDepartmentId,
      statuses,
      from: from || null,
      to: to || null,
      q: q ? String(q).trim().slice(0, 80) : null,
    };
    const types = type ? [type] : Object.keys(MOVEMENT_TYPES);
    const perType = type
      ? { limit: pageSize, offset: (pageNumber - 1) * pageSize }
      : { limit: pageNumber * pageSize, offset: 0 };

    let rows = [];
    let total = 0;
    for (const movementType of types) {
      const result = await repo.listMovements(typeConfig(movementType), { ...base, ...perType });
      rows.push(...result.rows.map((row) => movementDto(row, movementType)));
      total += result.total;
    }
    if (!type) {
      rows.sort((a, b) => String(b.movementDate).localeCompare(String(a.movementDate))
        || String(b.createdAt).localeCompare(String(a.createdAt)));
      rows = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    }
    return { rows, total, page: pageNumber, limit: pageSize, statusesVisible };
  }

  async function get({ user, type, id }) {
    const config = typeConfig(type);
    const access = await accessFor(user);
    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    if (!canRead(access, row)) throw notFound();
    const [approval, permissions] = await Promise.all([
      repo.approvalSummary(row.approval_request_id),
      detailPermissions(user, access, row, type),
    ]);
    return { ...movementDto(row, type), approval, permissions };
  }

  async function create({ user, type, input }) {
    const config = typeConfig(type);
    const access = await accessFor(user);
    if (!access.warehouseDepartmentId) {
      throw movementError('Divisi Warehouse belum dikonfigurasi untuk entity ini', 409, 'WAREHOUSE_NOT_CONFIGURED');
    }
    if (!access.sameDivision && !access.superAdmin) {
      throw forbidden('Hanya anggota divisi Warehouse yang dapat membuat pergerakan barang');
    }
    const data = validateMovementInput(input, config);
    const fields = {
      entity_id: user.entityId,
      department_id: access.warehouseDepartmentId,
      [config.dateColumn]: data.movementDate,
      reference_no: data.referenceNo,
      [config.partyColumn]: data.party,
      items: data.items,
      notes: data.notes,
      status: STATUS.DRAFT,
      created_by: user.sub,
    };
    const id = await transaction((conn) => repo.insertMovement(config, fields, conn));
    await audit.log({
      entityId: user.entityId, userId: user.sub, action: 'warehouse.movement.create',
      subjectType: config.subjectType, subjectId: id, metadata: { items: data.items.length },
    });
    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    return movementDto(row, type);
  }

  async function updateDraft({ user, type, id, input, version }) {
    const config = typeConfig(type);
    if (version == null) throw movementError('Versi data wajib dikirim');
    const access = await accessFor(user);
    const data = validateMovementInput(input, config);

    const previousStatus = await transaction(async (conn) => {
      const row = await repo.lockMovement(config, { id, entityId: user.entityId }, conn);
      if (!canRead(access, row)) throw notFound();
      if (!canWrite(access, row)) throw forbidden('Anda tidak dapat mengubah pergerakan ini');
      if (!isEditableStatus(row.status)) {
        throw movementError('Hanya draft atau pergerakan yang diminta revisi yang dapat diubah', 409, 'NOT_EDITABLE');
      }
      assertVersion(row, version);
      if (row.status === STATUS.REVISION) assertMovementTransition(row.status, STATUS.DRAFT);
      const changed = await repo.updateMovement(config, row.id, {
        [config.dateColumn]: data.movementDate,
        reference_no: data.referenceNo,
        [config.partyColumn]: data.party,
        items: data.items,
        notes: data.notes,
        status: STATUS.DRAFT,
      }, Number(version), conn);
      if (!changed) throw movementError('Data sudah diubah orang lain. Muat ulang lalu coba lagi.', 409, 'VERSION_CONFLICT');
      return row.status;
    });

    await audit.log({
      entityId: user.entityId, userId: user.sub, action: 'warehouse.movement.update',
      subjectType: config.subjectType, subjectId: id,
      metadata: { items: data.items.length, fromStatus: previousStatus },
    });
    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    return movementDto(row, type);
  }

  async function submit({ user, type, id, version = null }) {
    const config = typeConfig(type);
    const access = await accessFor(user);

    const outcome = await transaction(async (conn) => {
      const row = await repo.lockMovement(config, { id, entityId: user.entityId }, conn);
      if (!canRead(access, row)) throw notFound();
      if (!canWrite(access, row)) throw forbidden('Anda tidak dapat mengajukan pergerakan ini');
      if (row.status === STATUS.PENDING && row.approval_request_id) {
        return { alreadySubmitted: true, approvalRequestId: row.approval_request_id };
      }
      assertVersion(row, version);
      if (row.status === STATUS.REVISION) assertMovementTransition(STATUS.REVISION, STATUS.DRAFT);
      else assertMovementTransition(row.status, STATUS.PENDING);

      const dto = movementDto(row, type);
      validateMovementInput(dto, config);
      const title = `${config.label} ${dto.referenceNo || `#${row.id}`}`;
      const approval = await approvalEngine.createApprovalRequest({
        entityId: row.entity_id,
        departmentId: row.department_id,
        subjectType: config.subjectType,
        subjectId: row.id,
        requestType: config.requestType,
        title,
        description: `${dto.items.length} barang${dto.party ? ` · ${dto.party}` : ''}`,
        requestedBy: user.sub,
      }, conn);
      if (approval.flowType === 'legacy') {
        throw movementError(
          'Matrix approval Warehouse belum dikonfigurasi, jadi pergerakan belum dapat diajukan',
          409,
          'APPROVAL_MATRIX_MISSING',
        );
      }
      const changed = await repo.updateMovement(config, row.id, {
        status: STATUS.PENDING,
        submitted_by: user.sub,
        submitted_at: new Date(),
        approval_request_id: approval.id,
        decision_note: null,
      }, Number(row.version), conn);
      if (!changed) throw movementError('Data sudah diubah orang lain. Muat ulang lalu coba lagi.', 409, 'VERSION_CONFLICT');
      await audit.approval({
        entityId: row.entity_id, actorUserId: user.sub, entityType: 'request',
        entityIdRef: approval.id, action: 'create',
        after: { subjectType: config.subjectType, subjectId: row.id, flowType: approval.flowType },
      }, conn);
      return {
        alreadySubmitted: false,
        approvalRequestId: approval.id,
        notifyRequest: { id: approval.id, entity_id: row.entity_id, title },
        departmentId: row.department_id,
        createdBy: row.created_by,
      };
    });

    if (!outcome.alreadySubmitted) {
      await audit.log({
        entityId: user.entityId, userId: user.sub, action: 'warehouse.movement.submit',
        subjectType: config.subjectType, subjectId: id,
        metadata: { approvalRequestId: outcome.approvalRequestId },
      });
      try {
        const active = await approvalEngine.getActiveSteps(outcome.approvalRequestId);
        await notify.steps(active.map((step) => step.id), outcome.notifyRequest, {
          departmentId: outcome.departmentId,
          excludeUserIds: [user.sub, outcome.createdBy].filter(Boolean),
        });
      } catch {
        // Notification failure is logged by the notification layer and never undoes the submit.
      }
    }

    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    return {
      movement: movementDto(row, type),
      approvalRequestId: outcome.approvalRequestId,
      alreadySubmitted: outcome.alreadySubmitted,
    };
  }

  async function cancel({ user, type, id, reason, version = null }) {
    const config = typeConfig(type);
    const access = await accessFor(user);
    const cleanReason = String(reason || '').trim();

    await transaction(async (conn) => {
      const row = await repo.lockMovement(config, { id, entityId: user.entityId }, conn);
      if (!canRead(access, row)) throw notFound();
      if (!access.sameDivision || !hasPerm(user, 'warehouse.movement.cancel')) {
        throw forbidden('Hanya Warehouse Head yang dapat membatalkan pergerakan yang disetujui');
      }
      assertMovementTransition(row.status, STATUS.CANCELLED);
      if (!cleanReason) throw movementError('Alasan pembatalan wajib diisi');
      assertVersion(row, version);
      const changed = await repo.updateMovement(config, row.id, {
        status: STATUS.CANCELLED,
        cancelled_by: user.sub,
        cancelled_at: new Date(),
        cancellation_reason: cleanReason.slice(0, 500),
      }, Number(row.version), conn);
      if (!changed) throw movementError('Data sudah diubah orang lain. Muat ulang lalu coba lagi.', 409, 'VERSION_CONFLICT');
    });

    await audit.log({
      entityId: user.entityId, userId: user.sub, action: 'warehouse.movement.cancel',
      subjectType: config.subjectType, subjectId: id, metadata: { reason: cleanReason.slice(0, 500) },
    });
    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    return movementDto(row, type);
  }

  async function auditTrail({ user, type, id }) {
    const config = typeConfig(type);
    const access = await accessFor(user);
    const row = await repo.findMovement(config, { id, entityId: user.entityId });
    if (!canRead(access, row)) throw notFound();
    return repo.auditRows(config.subjectType, row.id, row.entity_id);
  }

  // ----- Approval subject lifecycle hooks (called inside the approval decision transaction)

  async function assertCanDecide({ approval, user, action, note = null, conn }) {
    const { config, row } = await loadForDecision(approval, conn);
    const denial = decisionDenial(approval, user, row);
    if (denial) {
      await audit.log({
        entityId: approval.entity_id, userId: user.sub, action: 'warehouse.movement.decision_denied',
        subjectType: config.subjectType, subjectId: approval.subject_id,
        metadata: { approvalRequestId: approval.id, action, code: denial.code },
      });
      throw denial;
    }
    requireDecisionNote(action, note);
  }

  async function canUserDecide({ approval, user, conn }) {
    const { row } = await loadForDecision(approval, conn);
    return !decisionDenial(approval, user, row);
  }

  const DECISION_STATUS = {
    approved: STATUS.APPROVED,
    rejected: STATUS.REJECTED,
    revision_requested: STATUS.REVISION,
  };

  async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
    const target = DECISION_STATUS[result?.status];
    if (!target) return { changed: false };

    const { type, config, row } = await loadForDecision(approval, conn);
    if (!row) throw notFound();
    if (Number(row.approval_request_id) !== Number(approval.id)) {
      throw movementError('Approval ini bukan approval aktif pergerakan tersebut', 409, 'STALE_APPROVAL');
    }
    if (row.status === target) return { changed: false };
    assertMovementTransition(row.status, target);

    const now = new Date();
    const patch = { status: target, decision_note: note ? String(note).slice(0, 500) : null };
    if (target === STATUS.APPROVED) Object.assign(patch, { approved_by: actorUserId, approved_at: now });
    if (target === STATUS.REJECTED) Object.assign(patch, { rejected_by: actorUserId, rejected_at: now });

    const changed = await repo.updateMovement(config, row.id, patch, Number(row.version), conn);
    if (!changed) throw movementError('Pergerakan berubah saat keputusan diproses. Coba lagi.', 409, 'VERSION_CONFLICT');
    return {
      changed: true,
      type,
      subjectType: config.subjectType,
      movementId: row.id,
      entityId: row.entity_id,
      status: target,
      approvalRequestId: approval.id,
    };
  }

  async function afterDecision(outcome, actorUserId) {
    if (!outcome?.changed) return;
    await audit.log({
      entityId: outcome.entityId, userId: actorUserId, action: `warehouse.movement.${outcome.status}`,
      subjectType: outcome.subjectType, subjectId: outcome.movementId,
      metadata: { approvalRequestId: outcome.approvalRequestId },
    });
  }

  return {
    list,
    get,
    create,
    updateDraft,
    submit,
    cancel,
    audit: auditTrail,
    assertCanDecide,
    canUserDecide,
    applyApprovalDecision,
    afterDecision,
  };
}

module.exports = {
  createWarehouseMovementService,
  ...createWarehouseMovementService(),
};
