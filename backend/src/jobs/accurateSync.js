// Pulls Accurate into approval batches (read-only; see services/accurate/accurateSync.service.js).
//   node src/jobs/accurateSync.js --dry-run   read and compare only, writes nothing
//   node src/jobs/accurateSync.js             stage batches for the divisions to approve
//   --scope=sales|warehouse|procurement        one kind of pull; without it, every scope
//                                              in ACCURATE_SYNC_SCOPES (default "sales"), one after another
// The batches are submitted in the name of ACCURATE_SYNC_USER_ID, or else the
// Super Admin who connected Accurate.
//
// Runs continuously (every few minutes, no fixed hours — owner, 29 Sep 2026):
// a pull that finds nothing new, or whose divisions all still have a batch
// waiting, costs one line in the log. Data reaches the app the moment the
// division's Supervisor or Head approves the batch.
require('dotenv').config();
const pool = require('../db/pool');
const { drainAndEnd } = require('../utils/pendingWork');
const sync = require('../services/accurate/accurateSync.service');
const reminders = require('../services/accurateBatchReminders.service');

// Local wall-clock time (WIB on this Mac), easier to read in the log.
const stamp = () => new Date().toLocaleString('sv-SE');

function summary(result) {
  if (result.skipped === 'ALL_PENDING') return 'dilewati: divisinya masih punya batch menunggu keputusan';
  const staged = (result.batches || []).map((b) => `batch #${b.id} (${b.items} perubahan)`);
  const waiting = (result.skipped || []).length;
  if (staged.length) return `diajukan ${staged.join(', ')}${waiting ? `; ${waiting} divisi masih menunggu` : ''}`;
  return waiting ? `ada perubahan, tetapi ${waiting} divisi masih punya batch menunggu` : 'tidak ada perubahan';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const [[conn]] = await pool.query("SELECT entity_id, connected_by FROM accurate_connections WHERE status = 'connected' LIMIT 1");
  if (!conn) { console.log(`[accurateSync ${stamp()}] Accurate belum tersambung`); return; }
  const requestedBy = Number(process.env.ACCURATE_SYNC_USER_ID) || conn.connected_by;
  const arg = process.argv.find((a) => a.startsWith('--scope='));
  const scopes = arg ? [arg.slice('--scope='.length)] : (process.env.ACCURATE_SYNC_SCOPES || 'sales').split(',').map((x) => x.trim()).filter(Boolean);
  // One scope failing (Accurate busy, a check that stopped the pull) never keeps
  // the next scope from running; the job still exits with an error at the end.
  let failed = false;
  for (const scope of scopes) {
    try {
      const result = await sync.runSync({ entityId: conn.entity_id, requestedBy, dryRun, scope });
      console.log(dryRun ? JSON.stringify(result, null, 2) : `[accurateSync ${stamp()}] ${scope}: ${summary(result)}`);
    } catch (e) {
      if (e.code === 'SYNC_RUNNING') {
        console.log(`[accurateSync ${stamp()}] ${scope}: dilewati, tarikan lain sedang berjalan`);
      } else if (e.code === 'SCOPE_OFF') {
        console.log(`[accurateSync ${stamp()}] ${scope}: dilewati: belum dinyalakan`);
      } else {
        failed = true;
        console.error(`[accurateSync ${stamp()}] ${scope}: gagal:`, e.code || '', e.message);
      }
    }
  }
  // Batches that wait: a reminder after 8 hours, then the Head and the owner
  // once a day (program 1.2), once switched on (ACCURATE_BATCH_REMINDERS=1).
  // Never on a dry run; a failure here stops nothing.
  if (!dryRun && process.env.ACCURATE_BATCH_REMINDERS === '1') {
    try {
      const r = await reminders.run(conn.entity_id);
      if (r.sent) console.log(`[accurateSync ${stamp()}] pengingat: ${r.sent} notifikasi untuk ${r.waiting} batch menunggu`);
    } catch (e) {
      console.error(`[accurateSync ${stamp()}] pengingat gagal:`, e.code || '', e.message);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(`[accurateSync ${stamp()}] gagal:`, e.code || '', e.message); process.exitCode = 1; }).finally(() => drainAndEnd(pool));
