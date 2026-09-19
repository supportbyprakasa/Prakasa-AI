const pool = require('../db/pool');

const MAX_METADATA_CHARS = 4000;

function safeMetadata(meta, depth = 0) {
  if (meta == null || depth > 8) return null;

  const SENSITIVE = [
    'password','token','jwt','secret','api_key','apikey',
    'authorization','private_key','client_secret','access_token',
    'refresh_token','id_token','signature',
  ];

  const sanitize = (value, key = '', level = depth) => {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE.some((s) => normalizedKey.includes(s.replace(/[^a-z0-9]/g, '')))) {
      return '[REDACTED]';
    }
    if (level > 8) return '[TRUNCATED]';
    if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
    if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitize(v, '', level + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, k, level + 1);
      return out;
    }
    return value;
  };

  const out = sanitize(meta);
  const serialized = JSON.stringify(out);
  if (serialized.length > MAX_METADATA_CHARS) {
    return { _truncated: true, preview: serialized.slice(0, MAX_METADATA_CHARS) };
  }
  return out;
}

/**
 * Record an activity event for a task.
 * Uses task's real entity_id — never null for known task events.
 */
async function record({
  taskId, entityId, actorUserId = null, event, metadata = null,
}, conn = pool) {
  if (!taskId || !entityId || !event) {
    throw new Error('record() membutuhkan taskId, entityId, event');
  }
  const [r] = await conn.query(
    `INSERT INTO task_activity (task_id, entity_id, actor_user_id, event, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [taskId, entityId, actorUserId, event,
     metadata ? JSON.stringify(safeMetadata(metadata)) : null]
  );
  return r.insertId;
}

async function list({ taskId, page = 1, limit = 50 }) {
  const offset = (page - 1) * limit;
  const [rows] = await pool.query(
    `SELECT a.id, a.event, a.actor_user_id AS actorUserId, u.name AS actorName,
            a.metadata_json AS metadataJson, a.created_at AS createdAt
       FROM task_activity a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.task_id = ?
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [taskId, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM task_activity WHERE task_id = ?`, [taskId]
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      metadata: r.metadataJson
        ? (typeof r.metadataJson === 'string' ? safeParse(r.metadataJson) : r.metadataJson)
        : null,
      metadataJson: undefined,
    })),
    total, page, limit,
  };
}

function safeParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

module.exports = { record, list, safeMetadata };