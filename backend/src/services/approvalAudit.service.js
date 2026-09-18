const pool = require('../db/pool');

function safeJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

async function log({
  entityId = null,
  actorUserId = null,
  entityType,
  entityIdRef = null,
  action,
  before = null,
  after = null,
}, conn = pool) {
  await conn.query(
    `INSERT INTO approval_audit_log
     (entity_id, actor_user_id, entity_type, entity_id_ref,
      action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entityId,
      actorUserId,
      entityType,
      entityIdRef,
      action,
      safeJson(before),
      safeJson(after),
    ]
  );
}

module.exports = { log };
