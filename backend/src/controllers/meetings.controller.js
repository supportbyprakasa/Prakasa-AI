const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const calSvc = require('../services/googleCalendar.service');
const crypto = require('crypto');

/**
 * Buat meeting + Google Calendar event + Meet link.
 * Body:
 *   entityId, departmentId, title, description, agenda, location,
 *   meetingType, startTime, endTime, timezone,
 *   participants: [{ userId?, email?, name?, role? }],
 *   links: [{ linkedType, linkedId }],
 *   contextRecordId? (opsional, untuk cross-division)
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, title, description, agenda, location,
      meetingType = 'internal', startTime, endTime,
      timezone = 'Asia/Jakarta', participants = [], links = [],
      contextRecordId, withMeet = true,
    } = req.body;

    // 1. Resolve participant emails (kombinasi user internal + eksternal)
    const internalUserIds = participants.filter((p) => p.userId).map((p) => p.userId);
    let internalUsers = [];
    if (internalUserIds.length) {
      const [rows] = await pool.query(
        `SELECT id, name, email FROM users WHERE id IN (?) AND deleted_at IS NULL`,
        [internalUserIds]
      );
      internalUsers = rows;
    }
    const attendeeList = [
      ...internalUsers.map((u) => ({ email: u.email, displayName: u.name })),
      ...participants
        .filter((p) => p.email && !p.userId)
        .map((p) => ({ email: p.email, displayName: p.name || null })),
    ];

    // 2. Ambil email organizer
    const [orgRows] = await pool.query(
      `SELECT id, name, email FROM users WHERE id=?`, [req.user.sub]
    );
    const organizer = orgRows[0];
    if (!organizer) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Organizer tidak ditemukan', 404); }

    // 3. Buat event di Google Calendar
    let eventData = null;
    let meetLink = null;
    try {
      eventData = await calSvc.createEvent({
        organizerEmail: organizer.email,
        title, description, agenda, location,
        startTime, endTime, timezone,
        attendees: attendeeList,
        withMeet,
      }, {
        entityId,
        userId: req.user.sub,
        subjectType: 'meeting',
        subjectId: null,
      });
      meetLink = eventData.hangoutLink || eventData.conferenceData?.entryPoints?.[0]?.uri || null;
    } catch (calErr) {
      // Jangan gagalkan meeting internal kalau Calendar API error (mis. belum setup service account)
      console.error('[meetings.create] Calendar error:', calErr.message);
    }

    // 4. Simpan meeting
    await conn.beginTransaction();
    const [m] = await conn.query(
      `INSERT INTO meetings
       (entity_id, department_id, title, description, agenda, location,
        meeting_type, start_time, end_time, timezone,
        google_event_id, google_calendar_id, meet_link, conference_type,
        organizer_user_id, status, context_record_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      [entityId, departmentId || null, title, description || null, agenda || null,
       location || null, meetingType, startTime, endTime, timezone,
       eventData?.id || null, eventData ? 'primary' : null,
       meetLink, withMeet && meetLink ? 'meet' : 'none',
       req.user.sub, contextRecordId || null, req.user.sub]
    );

    // 5. Simpan peserta
    for (const p of participants) {
      await conn.query(
        `INSERT INTO meeting_participants
         (meeting_id, user_id, external_email, external_name, role, rsvp_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [m.insertId, p.userId || null, p.email || null, p.name || null,
         p.role || 'required', p.userId ? 'needs_action' : 'none']
      );
    }
    // Tambahkan organizer sebagai participant kalau belum
    await conn.query(
      `INSERT IGNORE INTO meeting_participants
       (meeting_id, user_id, role, rsvp_status) VALUES (?, ?, 'organizer', 'accepted')`,
      [m.insertId, req.user.sub]
    );

    // 6. Simpan links
    for (const l of links) {
      await conn.query(
        `INSERT IGNORE INTO meeting_links (meeting_id, linked_type, linked_id, notes)
         VALUES (?, ?, ?, ?)`,
        [m.insertId, l.linkedType, l.linkedId, l.notes || null]
      );
    }
    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'meeting.create', subjectType: 'meeting', subjectId: m.insertId,
      metadata: { title, startTime, googleEventId: eventData?.id || null },
    });

    // 7. Notifikasi peserta internal
    for (const u of internalUsers) {
      if (u.id === req.user.sub) continue;
      await notif.create({
        userId: u.id, entityId,
        title: 'Undangan meeting',
        body: `${title} · ${new Date(startTime).toLocaleString('id-ID')}`,
        event: 'meeting.invited',
        subjectType: 'meeting', subjectId: m.insertId,
        actionUrl: `/meetings/${m.insertId}`,
      });
    }

    return ok(res, {
      id: m.insertId,
      googleEventId: eventData?.id || null,
      meetLink,
      htmlLink: eventData?.htmlLink || null,
    }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function list(req, res, next) {
  try {
    const where = ['m.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('m.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('m.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.status) { where.push('m.status = ?'); args.push(req.query.status); }
    if (req.query.from) { where.push('m.start_time >= ?'); args.push(req.query.from); }
    if (req.query.to) { where.push('m.start_time <= ?'); args.push(req.query.to); }
    if (req.query.organizerUserId) { where.push('m.organizer_user_id = ?'); args.push(req.query.organizerUserId); }
    if (req.query.contextRecordId) { where.push('m.context_record_id = ?'); args.push(req.query.contextRecordId); }

    const [rows] = await pool.query(
      `SELECT m.id, m.entity_id AS entityId, m.department_id AS departmentId,
              m.title, m.meeting_type AS meetingType, m.start_time AS startTime,
              m.end_time AS endTime, m.timezone, m.status,
              m.meet_link AS meetLink, m.recording_link AS recordingLink,
              m.transcript_link AS transcriptLink, m.ai_summary_id AS aiSummaryId,
              m.organizer_user_id AS organizerUserId, u.name AS organizerName,
              m.context_record_id AS contextRecordId,
              m.created_at AS createdAt
         FROM meetings m
         LEFT JOIN users u ON u.id = m.organizer_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.start_time DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT m.*, u.name AS organizerName, u.email AS organizerEmail
         FROM meetings m
         LEFT JOIN users u ON u.id = m.organizer_user_id
        WHERE m.id=? AND m.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Meeting tidak ditemukan', 404);

    const [participants] = await pool.query(
      `SELECT p.id, p.user_id AS userId, u.name AS userName, u.email AS userEmail,
              p.external_email AS externalEmail, p.external_name AS externalName,
              p.role, p.rsvp_status AS rsvpStatus, p.attended
         FROM meeting_participants p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.meeting_id=? ORDER BY p.role, p.id`, [id]
    );
    const [links] = await pool.query(
      `SELECT id, linked_type AS linkedType, linked_id AS linkedId, notes
         FROM meeting_links WHERE meeting_id=?`, [id]
    );
    const [actionItems] = await pool.query(
      `SELECT id, title, description, suggested_assignee_user_id AS suggestedAssigneeUserId,
              suggested_assignee_name AS suggestedAssigneeName, due_date AS dueDate,
              priority, status, created_task_id AS createdTaskId, created_at AS createdAt
         FROM meeting_action_items WHERE meeting_id=? ORDER BY id`, [id]
    );

    return ok(res, { ...rows[0], participants, links, actionItems });
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title, description, agenda, location, startTime, endTime, timezone, status,
    } = req.body;

    const [rows] = await pool.query(
      `SELECT m.*, u.email AS organizerEmail FROM meetings m
         LEFT JOIN users u ON u.id = m.organizer_user_id
        WHERE m.id=? AND m.deleted_at IS NULL`, [id]
    );
    const meeting = rows[0];
    if (!meeting) return fail(res, 'NOT_FOUND', 'Meeting tidak ditemukan', 404);

    // Update Google Calendar kalau ada event ID
    if (meeting.google_event_id) {
      try {
        await calSvc.updateEvent({
          organizerEmail: meeting.organizerEmail,
          eventId: meeting.google_event_id,
          title, description,
          startTime, endTime,
          timezone: timezone || meeting.timezone,
          status: status === 'cancelled' ? 'cancelled' : undefined,
        }, {
          entityId: meeting.entity_id,
          userId: req.user.sub,
          subjectType: 'meeting',
          subjectId: meeting.id,
        });
      } catch (calErr) {
        console.error('[meetings.update] Calendar error:', calErr.message);
      }
    }

    await pool.query(
      `UPDATE meetings SET
         title=COALESCE(?,title), description=COALESCE(?,description),
         agenda=COALESCE(?,agenda), location=COALESCE(?,location),
         start_time=COALESCE(?,start_time), end_time=COALESCE(?,end_time),
         timezone=COALESCE(?,timezone), status=COALESCE(?,status)
       WHERE id=?`,
      [title || null, description || null, agenda || null, location || null,
       startTime || null, endTime || null, timezone || null, status || null, id]
    );

    await log({
      entityId: meeting.entity_id, userId: req.user.sub,
      action: 'meeting.update', subjectType: 'meeting', subjectId: Number(id),
      metadata: req.body,
    });

    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function cancel(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT m.*, u.email AS organizerEmail FROM meetings m
         LEFT JOIN users u ON u.id = m.organizer_user_id
        WHERE m.id=? AND m.deleted_at IS NULL AND m.status != 'cancelled'`, [id]
    );
    const meeting = rows[0];
    if (!meeting) return fail(res, 'NOT_FOUND', 'Meeting tidak ditemukan atau sudah dibatalkan', 404);

    if (meeting.google_event_id) {
      try {
        await calSvc.deleteEvent({
          organizerEmail: meeting.organizerEmail,
          eventId: meeting.google_event_id,
        }, {
          entityId: meeting.entity_id,
          userId: req.user.sub,
          subjectType: 'meeting',
          subjectId: meeting.id,
        });
      } catch (calErr) {
        console.error('[meetings.cancel] Calendar error:', calErr.message);
      }
    }

    await pool.query(
      `UPDATE meetings SET status='cancelled' WHERE id=?`, [id]
    );

    await log({
      entityId: meeting.entity_id, userId: req.user.sub,
      action: 'meeting.cancel', subjectType: 'meeting', subjectId: Number(id),
    });

    // Notifikasi ke peserta internal
    const [parts] = await pool.query(
      `SELECT user_id AS userId FROM meeting_participants
        WHERE meeting_id=? AND user_id IS NOT NULL AND user_id != ?`,
      [id, req.user.sub]
    );
    for (const p of parts) {
      await notif.create({
        userId: p.userId, entityId: meeting.entity_id,
        title: 'Meeting dibatalkan',
        body: meeting.title,
        event: 'meeting.cancelled',
        subjectType: 'meeting', subjectId: Number(id),
        actionUrl: `/meetings/${id}`,
      });
    }

    return ok(res, { id: Number(id), status: 'cancelled' });
  } catch (e) { next(e); }
}

/**
 * Lampirkan link recording/transcript.
 * Body: { recordingLink?, transcriptLink?, recordingDriveFileId?, transcriptDriveFileId? }
 */
async function attachRecording(req, res, next) {
  try {
    const { id } = req.params;
    const {
      recordingLink, transcriptLink,
      recordingDriveFileId, transcriptDriveFileId,
    } = req.body;

    const [r] = await pool.query(
      `UPDATE meetings SET
         recording_link=COALESCE(?,recording_link),
         transcript_link=COALESCE(?,transcript_link),
         recording_drive_file_id=COALESCE(?,recording_drive_file_id),
         transcript_drive_file_id=COALESCE(?,transcript_drive_file_id)
       WHERE id=? AND deleted_at IS NULL`,
      [recordingLink || null, transcriptLink || null,
       recordingDriveFileId || null, transcriptDriveFileId || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Meeting tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'meeting.attach_recording', subjectType: 'meeting', subjectId: Number(id),
    });

    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * Link meeting ke entitas lain (task/project/customer/dll).
 * Body: { linkedType, linkedId, notes? }
 */
async function link(req, res, next) {
  try {
    const { id } = req.params;
    const { linkedType, linkedId, notes } = req.body;

    const [r] = await pool.query(
      `INSERT INTO meeting_links (meeting_id, linked_type, linked_id, notes)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notes=VALUES(notes)`,
      [id, linkedType, linkedId, notes || null]
    );

    await log({
      entityId: null, userId: req.user.sub,
      action: 'meeting.link', subjectType: 'meeting', subjectId: Number(id),
      metadata: { linkedType, linkedId },
    });

    return ok(res, { id: r.insertId || null }, undefined, 201);
  } catch (e) { next(e); }
}

async function unlink(req, res, next) {
  try {
    const { id, linkId } = req.params;
    const [r] = await pool.query(
      `DELETE FROM meeting_links WHERE id=? AND meeting_id=?`, [linkId, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Link tidak ditemukan', 404);
    return ok(res, { id: Number(linkId) });
  } catch (e) { next(e); }
}

module.exports = { create, list, detail, update, cancel, attachRecording, link, unlink };
