const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function listByBoard(req, res, next) {
  try {
    const { id } = req.params; // board id
    const where = ['t.deleted_at IS NULL', 't.board_id = ?'];
    const args = [id];
    if (req.query.assigneeId) { where.push('t.assignee_id = ?'); args.push(req.query.assigneeId); }
    if (req.query.priority) { where.push('t.priority = ?'); args.push(req.query.priority); }

    const [rows] = await pool.query(
      `SELECT t.id, t.board_id AS boardId, t.column_id AS columnId,
              t.title, t.description, t.status, t.priority,
              t.assignee_id AS assigneeId, u.name AS assigneeName,
              t.reporter_id AS reporterId, t.due_date AS dueDate,
              t.position, t.created_at AS createdAt
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.column_id ASC, t.position ASC, t.id ASC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT t.*, u.name AS assigneeName FROM tasks t
         LEFT JOIN users u ON u.id=t.assignee_id
        WHERE t.id=? AND t.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);
    const [comments] = await pool.query(
      `SELECT c.id, c.body, c.user_id AS userId, u.name AS userName, c.created_at AS createdAt
         FROM task_comments c JOIN users u ON u.id=c.user_id
        WHERE c.task_id=? ORDER BY c.id ASC`, [id]
    );
    const [attachments] = await pool.query(
      `SELECT id, drive_file_id AS driveFileId, name, mime_type AS mimeType,
              web_view_link AS webViewLink, created_at AS createdAt
         FROM task_attachments WHERE task_id=? ORDER BY id DESC`, [id]
    );
    return ok(res, { ...rows[0], comments, attachments });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, boardId, columnId, title, description,
      priority = 'normal', assigneeId, dueDate, sourceType, sourceId,
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO tasks
       (entity_id, department_id, board_id, column_id, title, description,
        priority, assignee_id, reporter_id, due_date, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, boardId || null, columnId || null,
       title, description || null, priority, assigneeId || null, req.user.sub,
       dueDate || null, sourceType || null, sourceId || null]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'task.create', subjectType: 'task', subjectId: r.insertId,
      metadata: { title, assigneeId, boardId, sourceType, sourceId },
    });
    if (assigneeId && assigneeId !== req.user.sub) {
      await notif.create({
        userId: assigneeId, entityId,
        title: 'Task baru untuk Anda',
        body: title,
        event: 'task.assigned',
        subjectType: 'task', subjectId: r.insertId,
        actionUrl: `/tasks/${r.insertId}`,
      });
    }
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title, description, columnId, status, priority, assigneeId, dueDate, position,
    } = req.body;

    const [prev] = await pool.query(`SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL`, [id]);
    if (!prev[0]) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);

    await pool.query(
      `UPDATE tasks SET
         title=COALESCE(?,title), description=COALESCE(?,description),
         column_id=COALESCE(?,column_id), status=COALESCE(?,status),
         priority=COALESCE(?,priority), assignee_id=COALESCE(?,assignee_id),
         due_date=COALESCE(?,due_date), position=COALESCE(?,position),
         completed_at = CASE WHEN ? = 'done' AND completed_at IS NULL THEN NOW()
                             WHEN ? <> 'done' THEN NULL ELSE completed_at END
       WHERE id=?`,
      [title || null, description || null, columnId ?? null, status || null,
       priority || null, assigneeId ?? null, dueDate || null, position ?? null,
       status || '', status || '', id]
    );

    await log({
      entityId: prev[0].entity_id, userId: req.user.sub,
      action: 'task.update', subjectType: 'task', subjectId: Number(id),
      metadata: req.body,
    });

    if (assigneeId && assigneeId !== prev[0].assignee_id) {
      await notif.create({
        userId: assigneeId, entityId: prev[0].entity_id,
        title: 'Anda ditugaskan ke task',
        body: prev[0].title,
        event: 'task.assigned',
        subjectType: 'task', subjectId: Number(id),
        actionUrl: `/tasks/${id}`,
      });
    }

    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE tasks SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'task.delete', subjectType: 'task', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function addComment(req, res, next) {
  try {
    const { id } = req.params;
    const { body } = req.body;
    const [r] = await pool.query(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)`,
      [id, req.user.sub, body]
    );
    await log({
      entityId: null, userId: req.user.sub,
      action: 'task.comment', subjectType: 'task', subjectId: Number(id),
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { listByBoard, detail, create, update, remove, addComment };
