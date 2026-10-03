const { google } = require('googleapis');
const pool = require('../db/pool');
const googleUserClient = require('./googleUserClient');
const logger = require('../utils/logger');

// Remembers Google account id → email/name for everyone in the Workspace, so a
// person keeps their name in Prakasa Workspace after their Google account is
// deleted (Google anonymises deleted accounts and the directory forgets them
// after ~20 days). Filled from the directory (active + recently deleted) and
// from every successful per-id lookup.

const DIRECTORY_SCOPES = ['https://www.googleapis.com/auth/admin.directory.user.readonly'];
const SNAPSHOT_EVERY_MS = 12 * 60 * 60 * 1000;
const ID_RE = /^\d{5,40}$/;
let lastSnapshotAt = 0;
let snapshotRunning = null;

function directory() {
  return google.admin({
    version: 'directory_v1',
    auth: googleUserClient.userAuth(process.env.GOOGLE_ADMIN_DELEGATED_USER, DIRECTORY_SCOPES),
  });
}

async function upsert(people) {
  const rows = people
    .filter((p) => ID_RE.test(String(p.googleId || '')) && (p.name || p.email))
    .map((p) => [String(p.googleId), p.email ? String(p.email).toLowerCase() : null, p.name || null, p.isDeleted ? 1 : 0]);
  if (!rows.length) return 0;
  // A later "deleted" sighting never erases a name we already know.
  await pool.query(
    `INSERT INTO google_people (google_id, email, name, is_deleted) VALUES ?
     ON DUPLICATE KEY UPDATE
       email = COALESCE(VALUES(email), email),
       name = COALESCE(VALUES(name), name),
       is_deleted = VALUES(is_deleted)`,
    [rows]
  );
  return rows.length;
}

async function listAll(showDeleted) {
  const users = [];
  let pageToken;
  do {
    const { data } = await directory().users.list({
      customer: 'my_customer',
      maxResults: 500,
      showDeleted: showDeleted ? 'true' : undefined,
      fields: 'nextPageToken,users(id,primaryEmail,name/fullName)',
      pageToken,
    });
    users.push(...(data.users || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return users.map((u) => ({ googleId: u.id, email: u.primaryEmail, name: u.name?.fullName || null, isDeleted: showDeleted }));
}

// Active users + accounts deleted in the last ~20 days (still listed by Google).
async function snapshot() {
  if (!process.env.GOOGLE_ADMIN_DELEGATED_USER) return 0;
  const [active, deleted] = await Promise.all([listAll(false), listAll(true).catch(() => [])]);
  const count = await upsert([...active, ...deleted]);
  lastSnapshotAt = Date.now();
  return count;
}

// Fire-and-forget refresh at most every 12h; never blocks or fails a request.
function ensureFresh() {
  if (snapshotRunning || Date.now() - lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
  snapshotRunning = snapshot()
    .catch((error) => { logger.warn({ err: error.message }, 'google_people snapshot failed'); lastSnapshotAt = Date.now(); })
    .finally(() => { snapshotRunning = null; });
}

// googleIds → Map(id → { email, name, isDeleted }).
async function lookup(googleIds) {
  const ids = [...new Set(googleIds.map(String).filter((id) => ID_RE.test(id)))];
  if (!ids.length) return new Map();
  const [rows] = await pool.query('SELECT google_id, email, name, is_deleted FROM google_people WHERE google_id IN (?)', [ids]);
  return new Map((rows || []).map((r) => [r.google_id, { email: r.email, name: r.name, isDeleted: Boolean(r.is_deleted) }]));
}

async function waitForSnapshot() {
  ensureFresh();
  if (snapshotRunning) await snapshotRunning;
}

module.exports = { upsert, lookup, snapshot, ensureFresh, waitForSnapshot };
