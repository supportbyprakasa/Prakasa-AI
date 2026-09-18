const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.status) { where.push('a.status = ?'); args.push(req.query.status); }
    if (req.query.entityId) { where.push('a.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('a.department_id = ?'); args.push(req.query.departmentId); }

    const [rows] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId, a.department_id AS departmentId,
              a.document_id AS documentId, a.subject_type AS subjectType,
              a.subject_id AS subjectId, a.title, a.approval_type AS approvalType,
              a.current_level AS currentLevel, a.status,
              a.requested_by AS requestedBy, u.name AS requesterName,
              a.created_at AS createdAt
         FROM approval_requests a
         LEFT JOIN users u ON u.id=a.requested_by
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC LIMIT 100`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM approval_requests WHERE id=?`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Approval request tidak ditemukan', 404);
    const [steps] = await pool.query(
      `SELECT id, level, approver_user_id AS approverUserId,
              approver_role_id AS approverRoleId, status,
              decided_by AS decidedBy, decided_at AS decidedAt, note
         FROM approval_steps WHERE approval_request_id=? ORDER BY level ASC`, [id]
    );
    return ok(res, { ...rows[0], steps });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, documentId,
      subjectType = 'document', subjectId, title, description,
      approvalType = 'level_1',
    } = req.body;

    await conn.beginTransaction();
    const [a] = await conn.query(
      `INSERT INTO approval_requests
       (entity_id, department_id, document_id, subject_type, subject_id,
        title, description, approval_type, current_level, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?)`,
      [entityId, departmentId || null, documentId || null,
       subjectType, subjectId || null, title, description || null,
       approvalType, req.user.sub]
    );

    // Buat approval_steps dari approval_matrix (kalau ada)
    const [matrix] = await conn.query(
      `SELECT level, approver_role_id AS approverRoleId,
              approver_user_id AS approverUserId
         FROM approval_matrix
        WHERE entity_id=? AND (department_id=? OR department_id IS NULL)
          AND document_type=? AND is_required=1
        ORDER BY level ASC`,
      [entityId, departmentId || null, subjectType]
    );

    if (matrix.length) {
      for (const m of matrix) {
        await conn.query(
          `INSERT INTO approval_steps
           (approval_request_id, level, approver_user_id, approver_role_id)
           VALUES (?, ?, ?, ?)`,
          [a.insertId, m.level, m.approverUserId, m.approverRoleId]
        );
      }
    } else {
      // fallback: satu step level 1 tanpa approver (harus diisi admin)
      await conn.query(
        `INSERT INTO approval_steps (approval_request_id, level) VALUES (?, 1)`,
        [a.insertId]
      );
    }
    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'approval.create', subjectType: 'approval_request', subjectId: a.insertId,
      metadata: { title, approvalType },
    });

    // Notifikasi ke approver step level 1 (kalau ada user spesifik)
    const [step1] = await pool.query(
      `SELECT approver_user_id AS approverUserId FROM approval_steps
        WHERE approval_request_id=? AND level=1 LIMIT 1`, [a.insertId]
    );
    if (step1[0]?.approverUserId) {
      await notif.create({
        userId: step1[0].approverUserId, entityId,
        title: 'Approval baru menunggu keputusan Anda',
        body: title,
        event: 'approval.requested',
        subjectType: 'approval_request', subjectId: a.insertId,
        actionUrl: `/approvals/${a.insertId}`,
      });
    }

    return ok(res, { id: a.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function decide(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, note } = req.body; // 'approve' | 'reject' | 'request_revision'

    await conn.beginTransaction();
    const [ar] = await conn.query(
      `SELECT * FROM approval_requests WHERE id=? FOR UPDATE`, [id]
    );
    const reqRow = ar[0];
    if (!reqRow) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Approval tidak ditemukan', 404); }
    if (reqRow.status !== 'pending') { await conn.rollback(); return fail(res, 'CONFLICT', 'Sudah diputuskan', 409); }

    const [steps] = await conn.query(
      `SELECT * FROM approval_steps
        WHERE approval_request_id=? AND level=? LIMIT 1`,
      [id, reqRow.current_level]
    );
    const step = steps[0];
    if (!step) { await conn.rollback(); return fail(res, 'CONFLICT', 'Step tidak ditemukan', 409); }

    let newStatus = 'pending';
    let nextLevel = reqRow.current_level;
    if (action === 'approve') {
      await conn.query(
        `UPDATE approval_steps SET status='approved', decided_by=?, decided_at=NOW(), note=?
          WHERE id=?`, [req.user.sub, note || null, step.id]
      );
      const [maxLevel] = await conn.query(
        `SELECT MAX(level) AS m FROM approval_steps WHERE approval_request_id=?`, [id]
      );
      if (reqRow.current_level >= maxLevel[0].m) {
        newStatus = 'approved';
      } else {
        nextLevel = reqRow.current_level + 1;
      }
    } else if (action === 'reject') {
      await conn.query(
        `UPDATE approval_steps SET status='rejected', decided_by=?, decided_at=NOW(), note=?
          WHERE id=?`, [req.user.sub, note || null, step.id]
      );
      newStatus = 'rejected';
    } else {
      await conn.query(
        `UPDATE approval_steps SET status='pending', decided_by=?, decided_at=NOW(), note=?
          WHERE id=?`, [req.user.sub, note || null, step.id]
      );
      newStatus = 'revision_requested';
    }

    await conn.query(
      `UPDATE approval_requests
          SET status=?, current_level=?, decided_by=?, decided_at=NOW(), decision_note=?
        WHERE id=?`,
      [newStatus, nextLevel, req.user.sub, note || null, id]
    );

    await conn.commit();

    await log({
      entityId: reqRow.entity_id, userId: req.user.sub,
      action: `approval.${action}`, subjectType: 'approval_request', subjectId: Number(id),
      metadata: { note, newStatus, nextLevel },
    });

    // Notifikasi ke requester
    await notif.create({
      userId: reqRow.requested_by, entityId: reqRow.entity_id,
      title: `Approval ${newStatus}`,
      body: reqRow.title,
      event: `approval.${newStatus}`,
      subjectType: 'approval_request', subjectId: Number(id),
      actionUrl: `/approvals/${id}`,
    });

    return ok(res, { id: Number(id), status: newStatus, currentLevel: nextLevel });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

module.exports = { list, detail, create, decide };
