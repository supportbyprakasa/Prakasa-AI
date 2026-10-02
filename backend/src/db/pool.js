const mysql = require('mysql2/promise');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('./connectionConfig');
const logger = require('../utils/logger');

const pool = mysql.createPool({
  ...buildDbConnectionConfig(),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 5),
  queueLimit: 0,
});

// Runs before anything else on a new connection (commands queue in order).
pool.on('connection', (connection) => {
  connection.query(SESSION_TIME_ZONE_SQL, (err) => {
    if (err) logger.error(`[db] zona waktu sesi gagal diset: ${err.message}`);
  });
});

module.exports = pool;
