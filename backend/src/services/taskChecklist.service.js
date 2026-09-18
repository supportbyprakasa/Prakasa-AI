const pool = require('../db/pool');
const { assertTaskAccess } = require('./taskAccess.service');
const activity = require('./taskActivity.service');

function validationError(message) {
  const e = new Error(message);
  e.status = 400;
  e.code = 'VALIDATION_ERROR';
  return e;
}

async function list({ task, user, conn = pool }) {
  assertTaskAccess({ user, task, action: 'view' });
  const [rows] = await conn.query(
    `SELECT id, title, is_done AS isDone, position,
            completed_by AS completedBy, completed_at AS completedAt,
            created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM task_checklist_items
      WHERE task_id = ? AND deleted_at IS NULL
      ORDER BY position ASC, id ASC`,
    [task.id]
  );
  const done = rows.filter((row) => Boolean(row.isDone)).length;
  const total = rows.length;
  return {
    items: rows,
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

async function create({ task, user, title, position }, conn = pool) {
  assertTaskAccess({ user, task, action: 'manage' });
  const clean = String(title || '').trim();
  if (!clean) throw validationError('title wajib');
  if (clean.length > 500) throw validationError('title maksimal 500 karakter');

  let pos = position;
  if (pos == null) {
    const [[{ maxp }]] = await conn.query(
      `SELECT COALESCE(MAX(position), -1) AS maxp
         FROM task_checklist_items
        WHERE task_id = ? AND deleted_at IS NULL`,
      [task.id]
    );
    pos = Number(maxp) + 1;
  }

  const [result] = await conn.query(
    `INSERT INTO task_checklist_items
     (task_id, title, position, created_by)
     VALUES (?, ?, ?, ?)`,
    [task.id, clean, Number(pos) || 0, user.sub]
  );

  await activity.record({
    taskId: task.id,
    entityId: task.entity_id,
    actorUserId: user.sub,
    event: 'task.checklist_added',
    metadata: { itemId: result.insertId, title: clean },
  }, conn);

  return { id: result.insertId };
}

async function patch({ task, user, itemId, changes }) {
  assertTaskAccess({ user, task, action: 'manage' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM task_checklist_items
        WHERE id = ? AND task_id = ? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [itemId, task.id]
    );
    const item = rows[0];
    if (!item) {
      const e = new Error('Item tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }

    const sets = [];
    const args = [];
    if (Object.prototype.hasOwnProperty.call(changes, 'title')) {
      const clean = String(changes.title || '').trim();
      if (!clean) throw validationError('title tidak boleh kosong');
      if (clean.length > 500) throw validationError('title maksimal 500 karakter');
      sets.push('title = ?');
      args.push(clean);
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'position')) {
      sets.push('position = ?');
      args.push(Number(changes.position) || 0);
    }

    let targetDone = Boolean(item.is_done);
    if (Object.prototype.hasOwnProperty.call(changes, 'isDone')) {
      targetDone = Boolean(changes.isDone);
      if (targetDone !== Boolean(item.is_done)) {
        sets.push('is_done = ?', 'completed_by = ?', 'completed_at = ?');
        args.push(targetDone ? 1 : 0, targetDone ? user.sub : null, targetDone ? new Date() : null);
      }
    }

    if (sets.length) {
      args.push(itemId, task.id);
      await conn.query(
        `UPDATE task_checklist_items
            SET ${sets.join(', ')}
          WHERE id = ? AND task_id = ? AND deleted_at IS NULL`,
        args
      );
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'isDone') &&
        targetDone !== Boolean(item.is_done)) {
      await activity.record({
        taskId: task.id,
        entityId: task.entity_id,
        actorUserId: user.sub,
        event: targetDone ? 'task.checklist_completed' : 'task.checklist_reopened',
        metadata: { itemId, title: item.title },
      }, conn);
    }

    await conn.commit();
    return { id: itemId, isDone: targetDone, changed: sets.length > 0 };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function update({ task, user, itemId, title, position }) {
  return patch({ task, user, itemId, changes: { ...(title !== undefined ? { title } : {}), ...(position !== undefined ? { position } : {}) } });
}

async function toggle({ task, user, itemId, isDone }) {
  return patch({ task, user, itemId, changes: { isDone: Boolean(isDone) } });
}

async function remove({ task, user, itemId }) {
  assertTaskAccess({ user, task, action: 'manage' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM task_checklist_items
        WHERE id = ? AND task_id = ? AND deleted_at IS NULL
        LIMIT 1 FOR UPDATE`,
      [itemId, task.id]
    );
    if (!rows[0]) {
      const e = new Error('Item tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }
    await conn.query(
      `UPDATE task_checklist_items SET deleted_at = NOW()
        WHERE id = ? AND task_id = ?`,
      [itemId, task.id]
    );
    await activity.record({
      taskId: task.id,
      entityId: task.entity_id,
      actorUserId: user.sub,
      event: 'task.checklist_deleted',
      metadata: { itemId },
    }, conn);
    await conn.commit();
    return { id: itemId };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function reorder({ task, user, orderedIds }) {
  assertTaskAccess({ user, task, action: 'manage' });
  const ids = Array.isArray(orderedIds) ? orderedIds.map(Number) : [];
  if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw validationError('orderedIds wajib array ID positif');
  }
  if (new Set(ids).size !== ids.length) {
    throw validationError('orderedIds tidak boleh duplikat');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [items] = await conn.query(
      `SELECT id FROM task_checklist_items
        WHERE task_id = ? AND deleted_at IS NULL
        ORDER BY id FOR UPDATE`,
      [task.id]
    );
    if (items.length !== ids.length) {
      throw validationError('orderedIds harus memuat seluruh checklist aktif');
    }
    const current = new Set(items.map((item) => Number(item.id)));
    if (ids.some((id) => !current.has(id))) {
      throw validationError('Beberapa item tidak ditemukan di task ini');
    }

    for (let index = 0; index < ids.length; index += 1) {
      await conn.query(
        `UPDATE task_checklist_items SET position = ? WHERE id = ? AND task_id = ?`,
        [index, ids[index], task.id]
      );
    }
    await conn.commit();
    return { taskId: task.id, reordered: ids.length };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { list, create, update, toggle, patch, remove, reorder };
