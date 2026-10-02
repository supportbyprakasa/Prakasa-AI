// Layanan GA cards on the home page's work summary (§3.5):
//   ga_assigned  "Permintaan GA untuk Anda"    — open/in-progress requests assigned
//                to the caller, or unassigned ones when the caller is the GA PIC
//   ga_approval  "Layanan GA menunggu persetujuan Anda" — vehicle bookings and
//                "Lainnya" requests whose active step the caller can decide
//                (never their own: separation of duties)
//   ga_mine      "Permintaan dan peminjaman GA saya" — still running
// Same card shape as controllers/workSummary.controller.js.

const pool = require('../db/pool');
const rules = require('./gaRules');
const shared = require('./gaShared.service');

const PER_CARD_ITEMS = 3;
const card = (key, group, title, count, to, items) => ({ key, group, title, count: Number(count) || 0, to, items: items || [] });
const iso = (value) => (value ? new Date(value).toISOString() : null);

// The active step of the record's approval is decidable by the caller.
const MY_STEP = `EXISTS (
  SELECT 1 FROM approval_requests ar JOIN approval_steps s ON s.approval_request_id = ar.id
   WHERE ar.id = %ID% AND ar.status = 'pending' AND s.status = 'pending' AND s.activated_at IS NOT NULL
     AND (s.approver_user_id = ? OR s.escalated_to_user_id = ?
          OR s.approver_role_id IN (SELECT role_id FROM user_roles WHERE user_id = ?)
          OR s.escalated_to_role_id IN (SELECT role_id FROM user_roles WHERE user_id = ?)))`;
const myStep = (column) => MY_STEP.replace('%ID%', column);

async function gaCards(user) {
  if (!shared.has(user, 'ga.request.create')) return [];
  const me = Number(user.sub);
  const out = [];

  if (shared.canProcess(user)) {
    const { picUserId } = await shared.gaRecipients(user.entityId);
    const [rows] = await pool.query(
      `SELECT id, request_number, title, status, due_at FROM ga_requests
        WHERE entity_id = ? AND status IN ('open', 'in_progress')
          AND (assigned_to = ? OR (assigned_to IS NULL AND ? = 1))
        ORDER BY due_at ASC, id ASC`,
      [user.entityId, me, picUserId === me ? 1 : 0],
    );
    if (rows.length) {
      out.push(card('ga_assigned', 'action', 'Permintaan GA untuk Anda', rows.length, '/ga?tab=semua',
        rows.slice(0, PER_CARD_ITEMS).map((r) => ({
          id: `r${r.id}`, title: `${r.request_number} · ${r.title}`,
          meta: r.status === 'open' ? 'Baru' : 'Diproses', to: `/ga/requests/${r.id}`, at: iso(r.due_at),
        }))));
    }
  }

  if (shared.has(user, 'approval.decide')) {
    const [rows] = await pool.query(
      `SELECT * FROM (
         SELECT 'request' AS kind, r.id, r.request_number AS number, r.title, r.created_at AS at FROM ga_requests r
          WHERE r.entity_id = ? AND r.status = 'pending_approval' AND r.requester_user_id <> ? AND ${myStep('r.approval_request_id')}
         UNION ALL
         SELECT 'booking', b.id, b.booking_number, g.name, b.starts_at FROM ga_bookings b
           JOIN ga_resources g ON g.entity_id = b.entity_id AND g.id = b.resource_id
          WHERE b.entity_id = ? AND b.status = 'pending_approval' AND b.starts_at > UTC_TIMESTAMP()
            AND b.requester_user_id <> ? AND ${myStep('b.approval_request_id')}
       ) x ORDER BY at ASC`,
      [user.entityId, me, me, me, me, me, user.entityId, me, me, me, me, me],
    );
    if (rows.length) {
      out.push(card('ga_approval', 'action', 'Layanan GA menunggu persetujuan Anda', rows.length, '/ga',
        rows.slice(0, PER_CARD_ITEMS).map((r) => ({
          id: `${r.kind[0]}${r.id}`, title: `${r.number} · ${r.title}`,
          meta: r.kind === 'booking' ? 'Peminjaman kendaraan' : 'Permintaan lainnya',
          to: r.kind === 'booking' ? `/ga/bookings/${r.id}` : `/ga/requests/${r.id}`, at: iso(r.at),
        }))));
    }
  }

  const [mine] = await pool.query(
    `SELECT * FROM (
       SELECT 'request' AS kind, id, request_number AS number, title, status, created_at AS at FROM ga_requests
        WHERE entity_id = ? AND requester_user_id = ? AND status IN ('pending_approval', 'open', 'in_progress')
       UNION ALL
       SELECT 'booking', b.id, b.booking_number, g.name, b.status, b.starts_at FROM ga_bookings b
         JOIN ga_resources g ON g.entity_id = b.entity_id AND g.id = b.resource_id
        WHERE b.entity_id = ? AND b.requester_user_id = ?
          AND (b.status IN ('pending_approval', 'in_use') OR (b.status = 'confirmed' AND b.ends_at > UTC_TIMESTAMP()))
     ) x ORDER BY at DESC`,
    [user.entityId, me, user.entityId, me],
  );
  if (mine.length) {
    const label = { pending_approval: 'Menunggu persetujuan', open: 'Baru', in_progress: 'Diproses', confirmed: 'Terkonfirmasi', in_use: 'Dipakai' };
    out.push(card('ga_mine', 'mine', 'Permintaan dan peminjaman GA saya', mine.length, '/ga',
      mine.slice(0, PER_CARD_ITEMS).map((r) => ({
        id: `${r.kind[0]}${r.id}`, title: `${r.number} · ${r.title}`, meta: label[r.status] || r.status,
        to: r.kind === 'booking' ? `/ga/bookings/${r.id}` : `/ga/requests/${r.id}`, at: iso(r.at),
      }))));
  }
  return out;
}

module.exports = { gaCards, SUBJECTS: [rules.SUBJECT_REQUEST, rules.SUBJECT_BOOKING] };
