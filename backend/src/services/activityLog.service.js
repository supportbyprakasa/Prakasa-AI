const pool = require('../db/pool');

const INSERT_SQL = `INSERT INTO activity_logs
     (entity_id, user_id, action, subject_type, subject_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`;

const argsOf = ({ entityId = null, userId = null, action, subjectType, subjectId = null, metadata = null }) => (
  [entityId, userId, action, subjectType, subjectId, metadata ? JSON.stringify(metadata) : null]
);

async function log(entry) {
  await pool.query(INSERT_SQL, argsOf(entry));
}

// The same entry written on a caller's connection, inside its transaction: the
// log row commits or rolls back together with the change it describes.
async function logWith(conn, entry) {
  await conn.query(INSERT_SQL, argsOf(entry));
}

module.exports = { log, logWith };
