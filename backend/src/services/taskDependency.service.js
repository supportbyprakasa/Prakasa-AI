const pool = require('../db/pool');
const { assertTaskAccess } = require('./taskAccess.service');
const activity = require('./taskActivity.service');

function error(message, status = 400, code = 'VALIDATION_ERROR') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

async function wouldCreateCycle({ predecessorTaskId, successorTaskId }, conn = pool) {
  if (Number(predecessorTaskId) === Number(successorTaskId)) return true;

  const target = Number(predecessorTaskId);
  const visited = new Set();
  const stack = [Number(successorTaskId)];

  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === target) return true;

    const [edges] = await conn.query(
      `SELECT successor_task_id AS successorId
         FROM task_dependencies
        WHERE predecessor_task_id = ?
          AND dependency_type = 'blocks'`,
      [current]
    );
    for (const row of edges) {
      const next = Number(row.successorId);
      if (!visited.has(next)) stack.push(next);
    }
  }
  return false;
}

async function list({ task, user }) {
  assertTaskAccess({ user, task, action: 'view' });

  const [blockedBy] = await pool.query(
    `SELECT d.id, d.predecessor_task_id AS taskId,
            t.title, t.status, t.due_date AS dueDate
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.predecessor_task_id
      WHERE d.successor_task_id = ?
        AND d.dependency_type = 'blocks'
        AND t.deleted_at IS NULL`,
    [task.id]
  );
  const [blocking] = await pool.query(
    `SELECT d.id, d.successor_task_id AS taskId,
            t.title, t.status, t.due_date AS dueDate
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.successor_task_id
      WHERE d.predecessor_task_id = ?
        AND d.dependency_type = 'blocks'
        AND t.deleted_at IS NULL`,
    [task.id]
  );
  const [related] = await pool.query(
    `SELECT d.id,
            d.predecessor_task_id AS predecessorTaskId,
            p.title AS predecessorTitle,
            d.successor_task_id AS successorTaskId,
            s.title AS successorTitle
       FROM task_dependencies d
       JOIN tasks p ON p.id=d.predecessor_task_id AND p.deleted_at IS NULL
       JOIN tasks s ON s.id=d.successor_task_id AND s.deleted_at IS NULL
      WHERE d.dependency_type='related'
        AND (d.predecessor_task_id=? OR d.successor_task_id=?)`,
    [task.id, task.id]
  );
  return { blockedBy, blocking, related };
}

async function add({ task, user, predecessorTaskId, successorTaskId, dependencyType = 'blocks' }) {
  assertTaskAccess({ user, task, action: 'manage' });
  if (!['blocks', 'related'].includes(dependencyType)) {
    throw error('dependencyType tidak valid');
  }

  const pred = Number(predecessorTaskId);
  const succ = Number(successorTaskId);
  if (!Number.isInteger(pred) || pred <= 0 || !Number.isInteger(succ) || succ <= 0) {
    throw error('predecessorTaskId & successorTaskId wajib');
  }
  if (pred === succ) throw error('Task tidak dapat bergantung ke dirinya sendiri');
  if (Number(task.id) !== pred && Number(task.id) !== succ) {
    throw error('Dependency harus melibatkan task pada URL');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = [pred, succ].sort((a, b) => a - b);
    const [rows] = await conn.query(
      `SELECT id, entity_id
         FROM tasks
        WHERE id IN (?, ?) AND deleted_at IS NULL
        ORDER BY id
        FOR UPDATE`,
      ids
    );
    if (rows.length !== 2) throw error('Salah satu task tidak ditemukan', 404, 'NOT_FOUND');
    if (rows.some((row) => Number(row.entity_id) !== Number(task.entity_id))) {
      throw error('Dependency hanya boleh antar task dalam entity yang sama');
    }

    const [existing] = await conn.query(
      `SELECT id FROM task_dependencies
        WHERE predecessor_task_id=? AND successor_task_id=? AND dependency_type=?
        LIMIT 1`,
      [pred, succ, dependencyType]
    );
    if (existing[0]) {
      await conn.commit();
      return {
        id: existing[0].id,
        predecessorTaskId: pred,
        successorTaskId: succ,
        dependencyType,
        created: false,
      };
    }

    if (dependencyType === 'blocks' &&
        await wouldCreateCycle({ predecessorTaskId: pred, successorTaskId: succ }, conn)) {
      throw error('Dependency akan membuat siklus', 409, 'DEPENDENCY_CYCLE');
    }

    const [result] = await conn.query(
      `INSERT INTO task_dependencies
       (predecessor_task_id, successor_task_id, dependency_type, created_by)
       VALUES (?, ?, ?, ?)`,
      [pred, succ, dependencyType, user.sub]
    );
    await activity.record({
      taskId: task.id,
      entityId: task.entity_id,
      actorUserId: user.sub,
      event: 'task.dependency_added',
      metadata: {
        dependencyId: result.insertId,
        predecessorTaskId: pred,
        successorTaskId: succ,
        type: dependencyType,
      },
    }, conn);
    await conn.commit();
    return {
      id: result.insertId,
      predecessorTaskId: pred,
      successorTaskId: succ,
      dependencyType,
      created: true,
    };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function graph({ task, user, depth = 3, maxNodes = 100 }) {
  assertTaskAccess({ user, task, action: 'view' });

  const safeDepth = Math.min(3, Math.max(1, Number(depth) || 3));
  const safeMaxNodes = Math.min(200, Math.max(10, Number(maxNodes) || 100));
  const entityId = Number(task.entity_id);
  const rootTaskId = Number(task.id);

  const nodeIds = new Set([rootTaskId]);
  let frontier = [rootTaskId];
  const edgeMap = new Map();
  let truncated = false;

  for (let level = 0; level < safeDepth && frontier.length; level += 1) {
    const [edges] = await pool.query(
      `SELECT d.id,
              d.predecessor_task_id AS predecessorTaskId,
              d.successor_task_id AS successorTaskId,
              d.dependency_type AS type
         FROM task_dependencies d
         JOIN tasks p ON p.id=d.predecessor_task_id
                    AND p.deleted_at IS NULL
                    AND p.entity_id=?
         JOIN tasks s ON s.id=d.successor_task_id
                    AND s.deleted_at IS NULL
                    AND s.entity_id=?
        WHERE d.predecessor_task_id IN (?)
           OR d.successor_task_id IN (?)
        ORDER BY d.id ASC`,
      [entityId, entityId, frontier, frontier]
    );

    const next = new Set();
    for (const edge of edges) {
      const from = Number(edge.predecessorTaskId);
      const to = Number(edge.successorTaskId);

      for (const candidate of [from, to]) {
        if (nodeIds.has(candidate)) continue;
        if (nodeIds.size >= safeMaxNodes) {
          truncated = true;
          continue;
        }
        nodeIds.add(candidate);
        next.add(candidate);
      }

      edgeMap.set(Number(edge.id), {
        id: Number(edge.id),
        from,
        to,
        type: edge.type,
      });
    }

    frontier = [...next];
  }

  const ids = [...nodeIds];
  const [rows] = await pool.query(
    `SELECT t.id,
            t.entity_id AS entityId,
            t.department_id AS departmentId,
            t.title,
            t.status,
            t.priority,
            t.assignee_id AS assigneeId,
            u.name AS assigneeName,
            DATE_FORMAT(t.start_date, '%Y-%m-%d') AS startDate,
            DATE_FORMAT(t.due_date, '%Y-%m-%d') AS dueDate,
            t.progress_percent AS progressPercent
       FROM tasks t
       LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.id IN (?)
        AND t.entity_id=?
        AND t.deleted_at IS NULL
      ORDER BY t.id ASC`,
    [ids, entityId]
  );

  const visibleIds = new Set(rows.map((row) => Number(row.id)));
  const links = [...edgeMap.values()].filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)
  );

  const blockedBy = new Map();
  for (const link of links) {
    if (link.type !== 'blocks') continue;
    if (!blockedBy.has(link.to)) blockedBy.set(link.to, []);
    blockedBy.get(link.to).push(link.from);
  }

  const tasks = rows.map((row) => ({
    id: Number(row.id),
    entityId: Number(row.entityId),
    departmentId: row.departmentId == null ? null : Number(row.departmentId),
    title: row.title,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId == null ? null : Number(row.assigneeId),
    assigneeName: row.assigneeName || null,
    startDate: row.startDate || null,
    dueDate: row.dueDate || null,
    progress: Number(row.progressPercent || 0),
    dependencyIds: blockedBy.get(Number(row.id)) || [],
  }));

  return {
    rootTaskId,
    depth: safeDepth,
    tasks,
    links,
    meta: {
      nodeCount: tasks.length,
      linkCount: links.length,
      maxNodes: safeMaxNodes,
      truncated,
    },
  };
}

async function remove({ task, user, dependencyId }) {
  assertTaskAccess({ user, task, action: 'manage' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM task_dependencies WHERE id=? LIMIT 1 FOR UPDATE`,
      [dependencyId]
    );
    const dep = rows[0];
    if (!dep) throw error('Dependency tidak ditemukan', 404, 'NOT_FOUND');
    if (Number(dep.predecessor_task_id) !== Number(task.id) &&
        Number(dep.successor_task_id) !== Number(task.id)) {
      throw error('Dependency tidak terkait dengan task ini');
    }

    await conn.query('DELETE FROM task_dependencies WHERE id=?', [dependencyId]);
    await activity.record({
      taskId: task.id,
      entityId: task.entity_id,
      actorUserId: user.sub,
      event: 'task.dependency_removed',
      metadata: { dependencyId },
    }, conn);
    await conn.commit();
    return { id: Number(dependencyId) };
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { list, add, remove, graph, wouldCreateCycle };
