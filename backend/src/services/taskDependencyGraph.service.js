const pool = require('../db/pool');
const taskAccess = require('./taskAccess.service');

const MAX_DEPTH = 3;
const MAX_NODES = 200;

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Bounded iterative BFS around a root task.
 * Traverses predecessor + successor edges, depth <= 3, nodes <= 200.
 */
async function buildGraph({ taskId, user, depth }) {
  const rootTask = await taskAccess.loadTask(taskId);
  if (!rootTask) {
    const e = new Error('Task tidak ditemukan');
    e.status = 404;
    e.code = 'NOT_FOUND';
    throw e;
  }
  taskAccess.assertTaskAccess({ user, task: rootTask, action: 'view' });

  const requestedDepth = Number(depth);
  const maxDepth = Math.min(
    MAX_DEPTH,
    Math.max(1, Number.isInteger(requestedDepth) ? requestedDepth : MAX_DEPTH)
  );
  const entityId = Number(rootTask.entity_id);

  const visited = new Map();
  visited.set(Number(rootTask.id), {
    id: Number(rootTask.id),
    title: rootTask.title,
    status: rootTask.status,
    dueDate: toIsoDate(rootTask.due_date),
    depth: 0,
    isRoot: true,
    viaType: null,
  });

  const edgeMap = new Map();
  let frontier = [Number(rootTask.id)];
  let truncated = false;

  for (let level = 0; level < maxDepth && frontier.length; level += 1) {
    const [rows] = await pool.query(
      `SELECT d.id,
              d.predecessor_task_id AS predecessorTaskId,
              d.successor_task_id AS successorTaskId,
              d.dependency_type AS dependencyType,
              p.title AS predecessorTitle,
              p.status AS predecessorStatus,
              p.due_date AS predecessorDueDate,
              s.title AS successorTitle,
              s.status AS successorStatus,
              s.due_date AS successorDueDate
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

    for (const row of rows) {
      const from = Number(row.predecessorTaskId);
      const to = Number(row.successorTaskId);

      edgeMap.set(Number(row.id), {
        id: Number(row.id),
        from,
        to,
        type: row.dependencyType,
      });

      const candidates = [
        {
          id: from,
          title: row.predecessorTitle,
          status: row.predecessorStatus,
          dueDate: toIsoDate(row.predecessorDueDate),
        },
        {
          id: to,
          title: row.successorTitle,
          status: row.successorStatus,
          dueDate: toIsoDate(row.successorDueDate),
        },
      ];

      for (const candidate of candidates) {
        if (visited.has(candidate.id)) continue;
        if (visited.size >= MAX_NODES) {
          truncated = true;
          continue;
        }

        visited.set(candidate.id, {
          ...candidate,
          depth: level + 1,
          isRoot: false,
          viaType: row.dependencyType,
        });
        next.add(candidate.id);
      }
    }

    frontier = [...next];
  }

  const visibleIds = new Set(visited.keys());
  const edges = [...edgeMap.values()].filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)
  );
  const nodes = [...visited.values()].sort((a, b) => a.depth - b.depth || a.id - b.id);

  return {
    root: Number(rootTask.id),
    nodes,
    edges,
    meta: {
      depth: maxDepth,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      truncated,
    },
  };
}

module.exports = { buildGraph, MAX_DEPTH, MAX_NODES };
