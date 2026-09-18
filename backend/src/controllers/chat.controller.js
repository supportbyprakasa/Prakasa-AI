const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function listRooms(req, res, next) {
  try {
    const where = ['r.is_archived = 0'];
    const args = [];
    if (req.query.entityId) { where.push('r.entity_id = ?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId, r.department_id AS departmentId,
              r.name, r.room_type AS roomType, r.created_at AS createdAt
         FROM chat_rooms r
        WHERE ${where.join(' AND ')}
        ORDER BY r.id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function createRoom(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { entityId, departmentId, name, roomType = 'division', memberIds = [] } = req.body;
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO chat_rooms (entity_id, department_id, name, room_type, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, name, roomType, req.user.sub]
    );
    const all = new Set([req.user.sub, ...memberIds]);
    for (const uid of all) {
      await conn.query(
        `INSERT IGNORE INTO chat_room_members (room_id, user_id) VALUES (?, ?)`,
        [r.insertId, uid]
      );
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'chat.room_create', subjectType: 'chat_room', subjectId: r.insertId,
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function listMessages(req, res, next) {
  try {
    const { id } = req.params;
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;

    const where = ['m.room_id = ?'];
    const args = [id];
    if (beforeId) { where.push('m.id < ?'); args.push(beforeId); }

    const [rows] = await pool.query(
      `SELECT m.id, m.room_id AS roomId, m.user_id AS userId, u.name AS userName,
              m.body, m.message_type AS messageType,
              m.converted_task_id AS convertedTaskId, m.created_at AS createdAt
         FROM chat_messages m
         JOIN users u ON u.id=m.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.id DESC LIMIT ?`, [...args, limit]
    );
    return ok(res, rows.reverse());
  } catch (e) { next(e); }
}

async function sendMessage(req, res, next) {
  try {
    const { id } = req.params; // room id
    const { body } = req.body;
    // pastikan user adalah member
    const [m] = await pool.query(
      `SELECT 1 FROM chat_room_members WHERE room_id=? AND user_id=?`, [id, req.user.sub]
    );
    if (!m[0]) return fail(res, 'FORBIDDEN', 'Anda bukan anggota room ini', 403);

    const [r] = await pool.query(
      `INSERT INTO chat_messages (room_id, user_id, body, message_type)
       VALUES (?, ?, ?, 'text')`, [id, req.user.sub, body]
    );
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

/**
 * Convert chat message menjadi task.
 * Membuat task baru + menandai pesan dengan converted_task_id.
 */
async function convertMessageToTask(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { messageId } = req.params;
    const { boardId, columnId, assigneeId, priority = 'normal', dueDate } = req.body;

    const [msgs] = await conn.query(
      `SELECT m.*, r.entity_id AS entityId, r.department_id AS departmentId
         FROM chat_messages m JOIN chat_rooms r ON r.id=m.room_id WHERE m.id=?`, [messageId]
    );
    const m = msgs[0];
    if (!m) return fail(res, 'NOT_FOUND', 'Pesan tidak ditemukan', 404);
    if (m.converted_task_id) return fail(res, 'CONFLICT', 'Pesan sudah dikonversi', 409);

    await conn.beginTransaction();
    const [t] = await conn.query(
      `INSERT INTO tasks
       (entity_id, department_id, board_id, column_id, title, description,
        priority, assignee_id, reporter_id, due_date, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chat', ?)`,
      [m.entityId, m.departmentId, boardId || null, columnId || null,
       m.body.slice(0, 200), m.body, priority, assigneeId || null,
       req.user.sub, dueDate || null, m.id]
    );
    await conn.query(`UPDATE chat_messages SET converted_task_id=? WHERE id=?`, [t.insertId, m.id]);
    await conn.commit();

    await log({
      entityId: m.entityId, userId: req.user.sub,
      action: 'chat.convert_to_task', subjectType: 'task', subjectId: t.insertId,
      metadata: { messageId: m.id },
    });

    return ok(res, { taskId: t.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

module.exports = { listRooms, createRoom, listMessages, sendMessage, convertMessageToTask };
