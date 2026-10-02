// Layanan GA — daily reminders and expiry (docs/rancangan-people-culture-g2.md
// §3.4), run by the People & Culture reminder job. Every notification has a
// dedupe key, so running the job twice a day never repeats one.
//   1. Request due tomorrow (WIB)      → assignee, or the GA PIC
//   2. Vehicle booking still waiting for approval and starting within 24 h
//                                      → users of the active approval step
//   3. Pending booking whose start passed → expired, approval withdrawn
//   4. Confirmed vehicle booking never collected, end passed → expired ("Tidak diambil")
//   5. Vehicle in use, end + 2 h passed → borrower + GA PIC, once per WIB day

const pool = require('../db/pool');
const rules = require('./gaRules');
const shared = require('./gaShared.service');

const EXPIRED_PENDING = 'Kedaluwarsa: belum disetujui sebelum jam mulai';
const EXPIRED_NOT_TAKEN = 'Tidak diambil';

async function requestsDueTomorrow(now) {
  const tomorrow = rules.wibDay(new Date(now).getTime() + rules.DAY_MS);
  const [rows] = await pool.query(
    `SELECT id, entity_id, request_number, title, assigned_to FROM ga_requests
      WHERE status IN ('open', 'in_progress') AND DATE(due_at + INTERVAL 7 HOUR) = ?`,
    [tomorrow],
  );
  let sent = 0;
  for (const r of rows) {
    const targets = r.assigned_to ? [Number(r.assigned_to)] : (await shared.gaRecipients(r.entity_id)).userIds;
    await shared.notifyUsers(targets, {
      entityId: r.entity_id, title: 'Permintaan GA jatuh tempo besok', body: `${r.request_number} · ${r.title}`,
      event: 'ga.request_due', subjectType: rules.SUBJECT_REQUEST, subjectId: r.id, actionUrl: `/ga/requests/${r.id}`,
      dedupeKey: `ga_request_due:${r.id}:${tomorrow}`,
    });
    sent += targets.length;
  }
  return sent;
}

async function pendingStartingSoon(now) {
  const [rows] = await pool.query(
    `SELECT b.id, b.entity_id, b.booking_number, b.requester_user_id, b.approval_request_id, g.name AS resource_name
       FROM ga_bookings b JOIN ga_resources g ON g.entity_id = b.entity_id AND g.id = b.resource_id
      WHERE b.status = 'pending_approval' AND b.starts_at > ? AND b.starts_at <= ? + INTERVAL 24 HOUR`,
    [now, now],
  );
  let sent = 0;
  for (const b of rows) {
    const users = await shared.activeStepUsers(b.entity_id, b.approval_request_id, [b.requester_user_id]);
    await shared.notifyUsers(users, {
      entityId: b.entity_id, title: 'Peminjaman kendaraan mulai < 24 jam, belum diputuskan', body: `${b.booking_number} · ${b.resource_name}`,
      event: 'ga.booking_pending', subjectType: rules.SUBJECT_BOOKING, subjectId: b.id, actionUrl: `/ga/bookings/${b.id}`,
      dedupeKey: `ga_booking_pending:${b.id}`,
    });
    sent += users.length;
  }
  return sent;
}

// One transaction per booking: lock it, re-check, expire, withdraw its approval, log.
async function expire(where, note, now) {
  const [rows] = await pool.query(`SELECT id, entity_id FROM ga_bookings b WHERE ${where}`, [now]);
  const expired = [];
  for (const { id, entity_id: entityId } of rows) {
    const done = await shared.transaction(async (conn) => {
      const [[b]] = await conn.query(`SELECT * FROM ga_bookings b WHERE id = ? AND ${where} FOR UPDATE`, [id, now]);
      if (!b) return null;
      if (b.status === 'pending_approval') await shared.withdrawApproval(conn, b.approval_request_id, null, note);
      await conn.query(
        "UPDATE ga_bookings SET status = 'expired', decision_note = ?, version = version + 1 WHERE id = ?",
        [note, b.id],
      );
      await shared.log(conn, {
        entityId, userId: null, action: 'ga.booking.expired', subjectType: rules.SUBJECT_BOOKING, subjectId: b.id, metadata: { reason: note },
      });
      return b;
    });
    if (done) {
      expired.push(done);
      await shared.notifyUsers([done.requester_user_id], {
        entityId, title: 'Peminjaman kedaluwarsa', body: `${done.booking_number} — ${note}`,
        event: 'ga.booking_status', subjectType: rules.SUBJECT_BOOKING, subjectId: done.id, actionUrl: `/ga/bookings/${done.id}`,
        dedupeKey: `ga_booking_expired:${done.id}`,
      });
    }
  }
  return expired.length;
}

async function lateReturns(now) {
  const today = rules.wibDay(now);
  const [rows] = await pool.query(
    `SELECT b.id, b.entity_id, b.booking_number, b.requester_user_id, g.name AS resource_name
       FROM ga_bookings b JOIN ga_resources g ON g.entity_id = b.entity_id AND g.id = b.resource_id
      WHERE b.status = 'in_use' AND b.resource_kind = 'vehicle'
        AND b.ends_at < ? - INTERVAL ${Number(rules.VEHICLE_LATE_HOURS)} HOUR`,
    [now],
  );
  let sent = 0;
  for (const b of rows) {
    const { userIds } = await shared.gaRecipients(b.entity_id);
    const targets = [Number(b.requester_user_id), ...userIds];
    await shared.notifyUsers(targets, {
      entityId: b.entity_id, title: 'Kendaraan belum dikembalikan', body: `${b.booking_number} · ${b.resource_name}`,
      event: 'ga.vehicle_late', subjectType: rules.SUBJECT_BOOKING, subjectId: b.id, actionUrl: `/ga/bookings/${b.id}`,
      dedupeKey: `ga_vehicle_late:${b.id}:${today}`,
    });
    sent += new Set(targets).size;
  }
  return sent;
}

async function runGaReminders({ now = new Date() } = {}) {
  const at = new Date(now);
  return {
    dueTomorrow: await requestsDueTomorrow(at),
    pendingSoon: await pendingStartingSoon(at),
    expiredPending: await expire("b.status = 'pending_approval' AND b.starts_at <= ?", EXPIRED_PENDING, at),
    expiredNotTaken: await expire("b.status = 'confirmed' AND b.resource_kind = 'vehicle' AND b.checked_out_at IS NULL AND b.ends_at < ?", EXPIRED_NOT_TAKEN, at),
    lateReturns: await lateReturns(at),
  };
}

module.exports = { runGaReminders, EXPIRED_PENDING, EXPIRED_NOT_TAKEN };
