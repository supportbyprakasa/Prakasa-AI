const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const approvalAudit = require('../services/approvalAudit.service');

async function assertEntityUser(conn, entityId, userId, label) {
  const [rows] = await conn.query(
    `SELECT id FROM users
      WHERE id=? AND entity_id=? AND status='active' AND deleted_at IS NULL
      LIMIT 1`,
    [userId, entityId]
  );
  if (!rows[0]) {
    const error = new Error(`${label} tidak valid/aktif di entity ini`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function assertDocumentType(conn, entityId, id) {
  if (id === undefined || id === null) return;
  const [rows] = await conn.query(
    `SELECT id FROM document_types
      WHERE id=? AND entity_id=? AND deleted_at IS NULL
      LIMIT 1`,
    [id, entityId]
  );
  if (!rows[0]) {
    const error = new Error('Document type delegasi tidak valid untuk entity ini');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

function normalize(row) {
  return {
    id: row.id,
    entityId: row.entity_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    appliesToRequestType: row.applies_to_request_type,
    appliesToDocumentTypeId: row.applies_to_document_type_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
    isActive: Boolean(row.is_active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function validWindow(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    end.getTime() > start.getTime();
}

async function assertNoCycleOrOverlap(conn, {
  entityId,
  id = null,
  fromUserId,
  toUserId,
  requestType,
  documentTypeId,
  startsAt,
  endsAt,
}) {
  const [reverse] = await conn.query(
    `SELECT id FROM approval_delegations
      WHERE entity_id=?
        AND from_user_id=?
        AND to_user_id=?
        AND is_active=1
        AND deleted_at IS NULL
        AND starts_at < ?
        AND ends_at > ?
        AND (? IS NULL OR id<>?)
      LIMIT 1`,
    [entityId, toUserId, fromUserId, endsAt, startsAt, id, id]
  );
  if (reverse[0]) {
    const error = new Error('Delegasi membentuk siklus dua arah pada periode yang sama');
    error.status = 409;
    error.code = 'CONFLICT';
    throw error;
  }

  const [overlap] = await conn.query(
    `SELECT id FROM approval_delegations
      WHERE entity_id=?
        AND from_user_id=?
        AND is_active=1
        AND deleted_at IS NULL
        AND starts_at < ?
        AND ends_at > ?
        AND (
          applies_to_request_type <=> ?
        )
        AND (
          applies_to_document_type_id <=> ?
        )
        AND (? IS NULL OR id<>?)
      LIMIT 1`,
    [
      entityId,
      fromUserId,
      endsAt,
      startsAt,
      requestType ?? null,
      documentTypeId ?? null,
      id,
      id,
    ]
  );
  if (overlap[0]) {
    const error = new Error('Sudah ada delegasi aktif yang overlap untuk scope yang sama');
    error.status = 409;
    error.code = 'CONFLICT';
    throw error;
  }
}

async function list(req, res, next) {
  try {
    const where = ['d.entity_id=?', 'd.deleted_at IS NULL'];
    const args = [req.entityScope.entityId];

    if (req.query.fromUserId) {
      where.push('d.from_user_id=?');
      args.push(req.query.fromUserId);
    }
    if (req.query.toUserId) {
      where.push('d.to_user_id=?');
      args.push(req.query.toUserId);
    }
    if (req.query.activeOnly === '1') {
      where.push('d.is_active=1');
      where.push('d.starts_at<=NOW() AND d.ends_at>=NOW()');
    }

    const [rows] = await pool.query(
      `SELECT d.*, fu.name AS fromUserName, tu.name AS toUserName,
              dt.name AS appliesToDocumentTypeName
         FROM approval_delegations d
         JOIN users fu ON fu.id=d.from_user_id
         JOIN users tu ON tu.id=d.to_user_id
         LEFT JOIN document_types dt ON dt.id=d.applies_to_document_type_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC`,
      args
    );

    return ok(res, rows.map((row) => ({
      ...normalize(row),
      fromUserName: row.fromUserName,
      toUserName: row.toUserName,
      appliesToDocumentTypeName: row.appliesToDocumentTypeName || null,
    })));
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const {
      fromUserId,
      toUserId,
      appliesToRequestType = null,
      appliesToDocumentTypeId = null,
      startsAt,
      endsAt,
      reason = null,
    } = req.body;

    if (fromUserId === toUserId) {
      return fail(res, 'VALIDATION_ERROR', 'Delegasi ke diri sendiri tidak valid', 400);
    }

    const start = startsAt ? new Date(startsAt) : new Date();
    const end = new Date(endsAt);
    if (!validWindow(start, end)) {
      return fail(res, 'VALIDATION_ERROR', 'Periode delegasi tidak valid', 400);
    }

    await assertEntityUser(conn, entityId, fromUserId, 'fromUser');
    await assertEntityUser(conn, entityId, toUserId, 'toUser');
    await assertDocumentType(conn, entityId, appliesToDocumentTypeId);
    await assertNoCycleOrOverlap(conn, {
      entityId,
      fromUserId,
      toUserId,
      requestType: appliesToRequestType,
      documentTypeId: appliesToDocumentTypeId,
      startsAt: start,
      endsAt: end,
    });

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO approval_delegations
       (entity_id, from_user_id, to_user_id,
        applies_to_request_type, applies_to_document_type_id,
        starts_at, ends_at, reason, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        entityId,
        fromUserId,
        toUserId,
        appliesToRequestType,
        appliesToDocumentTypeId,
        start,
        end,
        reason,
        req.user.sub,
      ]
    );

    const after = {
      id: result.insertId,
      entityId,
      fromUserId,
      toUserId,
      appliesToRequestType,
      appliesToDocumentTypeId,
      startsAt: start,
      endsAt: end,
      reason,
      isActive: true,
    };

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'delegation',
      entityIdRef: result.insertId,
      action: 'create',
      after,
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_delegation.create',
      subjectType: 'approval_delegation',
      subjectId: result.insertId,
      metadata: { fromUserId, toUserId },
    });

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM approval_delegations
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, entityId]
    );
    const existing = rows[0];
    if (!existing) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Delegasi tidak ditemukan', 404);
    }

    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
    const next = {
      fromUserId: existing.from_user_id,
      toUserId: existing.to_user_id,
      appliesToRequestType: has('appliesToRequestType')
        ? req.body.appliesToRequestType : existing.applies_to_request_type,
      appliesToDocumentTypeId: has('appliesToDocumentTypeId')
        ? req.body.appliesToDocumentTypeId : existing.applies_to_document_type_id,
      startsAt: has('startsAt') && req.body.startsAt
        ? new Date(req.body.startsAt) : existing.starts_at,
      endsAt: has('endsAt') && req.body.endsAt
        ? new Date(req.body.endsAt) : existing.ends_at,
      reason: has('reason') ? req.body.reason : existing.reason,
      isActive: has('isActive') ? req.body.isActive : Boolean(existing.is_active),
    };

    if (!validWindow(next.startsAt, next.endsAt)) {
      await conn.rollback();
      return fail(res, 'VALIDATION_ERROR', 'Periode delegasi tidak valid', 400);
    }
    await assertDocumentType(conn, entityId, next.appliesToDocumentTypeId);

    if (next.isActive) {
      await assertNoCycleOrOverlap(conn, {
        entityId,
        id: Number(req.params.id),
        fromUserId: next.fromUserId,
        toUserId: next.toUserId,
        requestType: next.appliesToRequestType,
        documentTypeId: next.appliesToDocumentTypeId,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
      });
    }

    const fields = [];
    const values = [];
    const map = {
      appliesToRequestType: 'applies_to_request_type',
      appliesToDocumentTypeId: 'applies_to_document_type_id',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      reason: 'reason',
      isActive: 'is_active',
    };

    for (const [key, column] of Object.entries(map)) {
      if (!has(key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (key === 'startsAt' && value) value = new Date(value);
      if (key === 'endsAt' && value) value = new Date(value);
      if (key === 'isActive') value = value ? 1 : 0;
      values.push(value ?? null);
    }

    if (fields.length) {
      values.push(req.params.id, entityId);
      await conn.query(
        `UPDATE approval_delegations SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    const [afterRows] = await conn.query(
      'SELECT * FROM approval_delegations WHERE id=? LIMIT 1',
      [req.params.id]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'delegation',
      entityIdRef: Number(req.params.id),
      action: 'update',
      before: normalize(existing),
      after: afterRows[0] ? normalize(afterRows[0]) : null,
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_delegation.update',
      subjectType: 'approval_delegation',
      subjectId: Number(req.params.id),
      metadata: req.body,
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.status) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
    }
    next(error);
  } finally {
    conn.release();
  }
}

async function remove(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM approval_delegations
        WHERE id=? AND entity_id=? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [req.params.id, entityId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Delegasi tidak ditemukan', 404);
    }

    await conn.query(
      `UPDATE approval_delegations
          SET is_active=0, deleted_at=NOW()
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, entityId]
    );

    await approvalAudit.log({
      entityId,
      actorUserId: req.user.sub,
      entityType: 'delegation',
      entityIdRef: Number(req.params.id),
      action: 'delete',
      before: normalize(rows[0]),
    }, conn);

    await conn.commit();

    await activityLog({
      entityId,
      userId: req.user.sub,
      action: 'approval_delegation.delete',
      subjectType: 'approval_delegation',
      subjectId: Number(req.params.id),
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(error);
  } finally {
    conn.release();
  }
}

module.exports = { list, create, update, remove };
