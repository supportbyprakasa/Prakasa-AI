// Checks every 5 minutes (cron) that every Claude Team seat behind Prakasa AI —
// this server's CLI login or a runner (gateway v2) — is reachable and
// still valid, so a lapsed login is noticed by the Super Admin before users
// hit it. Usage-window warnings come from the answers themselves
// (services/ai/claudeTeamLimits.js). Usage: node src/jobs/claudeTeamHealth.js
require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const { listSeatHealth } = require('../services/ai/claudeTeamSeats.service');

async function main() {
  const seats = await listSeatHealth();
  if (!seats.length) console.log('[claudeTeamHealth] tidak ada akun Claude Team aktif');
  for (const s of seats) {
    console.log(`[claudeTeamHealth] ${s.label} (${s.mode}) reachable=${s.reachable} login=${s.loggedIn} window=${s.rateType || '-'} utilization=${s.utilization ?? '-'} cooldownUntil=${s.cooldownUntil || '-'}${s.lastError ? ` error=${s.lastError}` : ''}`);
  }
}

main()
  .catch((e) => { console.error('[claudeTeamHealth] gagal:', e.message); process.exitCode = 1; })
  .finally(() => drainAndEnd(pool));
