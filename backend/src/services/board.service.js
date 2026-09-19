const pool = require('../db/pool');
const taskAccess = require('./taskAccess.service');
const { log: activityLog } = require('./activityLog.service');

async function listBoards({ user, filters = {} }) {
  const entityId = taskAccess.resolveTargetEntity({
    user, requestedEntityId: filters.entityId,
  });

  const where = ['b.deleted_at IS NULL', 'b.entity_id = ?'];
  const args = [entityId];
  if (filters.departmentId) { where.push('b.department_id = ?'); args.push(filters.departmentId); }
  if (filters.activeOnly !== '0') where.push('b.is_archived = 0');

  const [rows] = await pool.query(
    `SELECT b.id, b.entity_id AS entityId, b.department_id AS departmentId,
            b.name, b.description, b.is_archived AS isArchived,
            b.created_at AS createdAt
       FROM boards b
      WHERE ${where.join(' AND ')}
      ORDER BY b.id DESC`,
    args
  );
  return rows;
}

async function getBoardDetail({ boardId, user }) {
  const board = await taskAccess.loadBoard(boardId);
  if (!board) { const e = new Error('Board tidak ditemukan'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
  taskAccess.assertBoardAccess({ user, board, action: 'view' });

  const [cols] = await pool.query(
    `SELECT id, name, position, wip_limit AS wipLimit
       FROM board_columns WHERE board_id = ? ORDER BY position ASC, id ASC`,
    [boardId]
  );
  return {
    id: board.id,
    entityId: board.entity_id,
    departmentId: board.department_id,
    name: board.name,
    description: board.description,
    isArchived: !!board.is_archived,
    createdAt: board.created_at,
    columns: cols,
  };
}

async function createBoard({ user, input }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const entityId = taskAccess.resolveTargetEntity({
      user, requestedEntityId: input.entityId,
    });

    const [entities] = await conn.query(
      `SELECT id FROM entities WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [entityId]
    );
    if (!entities[0]) {
      const e = new Error('Entity tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }

    if (input.departmentId) {
      const [d] = await conn.query(
        `SELECT id FROM departments
          WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
        [input.departmentId, entityId]
      );
      if (!d[0]) {
        await conn.rollback();
        const e = new Error('Department tidak valid untuk entity ini');
        e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
      }
    }

    const name = String(input.name || '').trim();
    if (!name) {
      const e = new Error('name wajib');
      e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
    }

    const [r] = await conn.query(
      `INSERT INTO boards (entity_id, department_id, name, description, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [entityId, input.departmentId || null, name,
       input.description == null ? null : String(input.description).slice(0, 500), user.sub]
    );

    const defaultCols = input.columns?.length
      ? input.columns
      : [
          { name: 'Backlog', position: 0 },
          { name: 'To Do', position: 1 },
          { name: 'In Progress', position: 2 },
          { name: 'Done', position: 3 },
        ];
    for (const col of defaultCols) {
      await conn.query(
        `INSERT INTO board_columns (board_id, name, position, wip_limit)
         VALUES (?, ?, ?, ?)`,
        [r.insertId, col.name, col.position ?? 0, col.wipLimit ?? null]
      );
    }

    await conn.commit();

    try {
      await activityLog({
        entityId, userId: user.sub, action: 'board.create',
        subjectType: 'board', subjectId: r.insertId,
        metadata: { name },
      });
    } catch { /* board is already committed */ }
    return { id: r.insertId };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function deleteBoard({ boardId, user }) {
  const board = await taskAccess.loadBoard(boardId);
  if (!board) { const e = new Error('Board tidak ditemukan'); e.status = 404; e.code = 'NOT_FOUND'; throw e; }
  taskAccess.assertBoardAccess({ user, board, action: 'manage' });

  await pool.query(`UPDATE boards SET deleted_at = NOW() WHERE id = ?`, [boardId]);
  try {
    await activityLog({
      entityId: board.entity_id, userId: user.sub, action: 'board.delete',
      subjectType: 'board', subjectId: boardId,
    });
  } catch { /* board deletion is already committed */ }
  return { id: boardId };
}

module.exports = { listBoards, getBoardDetail, createBoard, deleteBoard };