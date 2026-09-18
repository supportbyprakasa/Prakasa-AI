const pool = require('../db/pool');

async function log({
  entityId = null,
  userId = null,
  action,
  subjectType,
  subjectId = null,
  metadata = null,
}) {
  await pool.query(
    `INSERT INTO activity_logs
     (entity_id, user_id, action, subject_type, subject_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entityId, userId, action, subjectType, subjectId, metadata ? JSON.stringify(metadata) : null]
  );
}

module.exports = { log };
