// Keeps the Accurate connection alive: Accurate access tokens last 15 days, and
// the app only refreshes one when it is used. Until the sync runs every day,
// this job (daily; launchd on the owner's Mac, cron on a server) refreshes any
// token that expires within 2 days. Sign-in call only (POST oauth/token through
// accurateReadOnly.js); no Accurate data is read or written.
// Usage: node src/jobs/accurateTokenRefresh.js
require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const accurate = require('../services/accurate/accurateConnection.service');

async function main() {
  const [rows] = await pool.query("SELECT entity_id, expires_at FROM accurate_connections WHERE status = 'connected' AND tokens_encrypted IS NOT NULL");
  if (!rows.length) { console.log('[accurateTokenRefresh] tidak ada koneksi Accurate'); return; }
  for (const row of rows) {
    const before = row.expires_at ? new Date(row.expires_at) : null;
    try {
      // Refreshes only inside the 2-day window; otherwise just returns the current token.
      await accurate.getAccessToken(row.entity_id);
      const status = await accurate.getStatus(row.entity_id);
      const renewed = before && status.expiresAt && new Date(status.expiresAt) > before;
      console.log(`[accurateTokenRefresh] entity ${row.entity_id}: ${renewed ? 'diperbarui' : 'masih berlaku'} sampai ${new Date(status.expiresAt).toISOString()}`);
    } catch (error) {
      console.error(`[accurateTokenRefresh] entity ${row.entity_id}: gagal (${error.code || error.name})`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error('[accurateTokenRefresh] gagal:', e.message); process.exitCode = 1; }).finally(() => drainAndEnd(pool));
