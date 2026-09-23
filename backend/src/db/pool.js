const mysql = require('mysql2/promise');
const { buildDbConnectionConfig } = require('./connectionConfig');

const pool = mysql.createPool({
  ...buildDbConnectionConfig(),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 5),
  queueLimit: 0,
});

module.exports = pool;
