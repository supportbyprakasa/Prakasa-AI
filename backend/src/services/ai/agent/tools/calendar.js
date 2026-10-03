// Kalender: the signed-in user's OWN upcoming Google Calendar events.
//
// Rules this tool keeps:
//   - the same read the Kalender page does (googleCalendarUser.listEvents, the
//     scope the page already uses) AS the signed-in user: the subject is always
//     `user.email` and the calendar is always "primary". No input names a
//     person or a calendar, so nobody else's calendar can be asked for;
//   - read only: nothing is created, changed, answered or sent;
//   - Google is asked once per call. Whatever it does — refuses, errors, or
//     never answers — the tool says "tidak tersedia" instead of throwing or
//     keeping the answer waiting (12 s, like the Project Tracker tools);
//   - title, time (WIB), place, whether a Meet exists, and how many guests.
//     Never the Meet link, a guest's name or email, the description, or an
//     attachment;
//   - private conversations only: an agenda is the user's own.
const calendar = require('../../../googleCalendarUser.service');
const { normalizeEvent, isValidEventId } = require('../../../../controllers/googleCalendarApp.controller');
const { hasPerm, text, int } = require('./_shared');

const TIME_ZONE = 'Asia/Jakarta';
const WIB_MS = 7 * 3600e3;
const DAY_MS = 24 * 3600e3;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;
const MAX_EVENTS = 50;
// The longest record id a page route carries (formCatalog / aiClientTools).
const MAX_ROUTE_ID = 100;
const GOOGLE_WAIT_MS = 12000;

const UNAVAILABLE = 'Kalender belum bisa dibaca: Google Calendar tidak bisa dihubungi saat ini, atau akun Google Anda belum terhubung. '
  + 'Buka halaman Kalender untuk memeriksanya.';

async function orUnavailable(read, waitMs = GOOGLE_WAIT_MS) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), waitMs); });
  try {
    return await Promise.race([
      Promise.resolve().then(read).then((value) => ({ ok: true, value }), () => ({ ok: false })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// WIB has no daylight saving: a WIB calendar day is a fixed UTC window.
const wibDay = (ms) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
const wibDayStart = (ms) => Date.parse(`${wibDay(ms)}T00:00:00+07:00`);
const wibClock = (ms) => `${new Date(ms + WIB_MS).toISOString().slice(0, 16).replace('T', ' ')} WIB`;
const prevDay = (dateKey) => new Date(Date.parse(`${dateKey}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

// One event, field by field. `canWrite` = the user holds meeting.create.
function eventOut(event, { canWrite, now }) {
  const allDay = Boolean(event.allDay);
  const startMs = allDay ? Date.parse(`${event.start.date}T00:00:00+07:00`) : Date.parse(event.start.dateTime);
  const endMs = allDay ? Date.parse(`${event.end.date}T00:00:00+07:00`) : Date.parse(event.end.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const id = isValidEventId(event.id) && event.id.length <= MAX_ROUTE_ID ? event.id : null;
  // Guests other than the user and rooms; a count, never who.
  const guests = (event.attendees || []).filter((a) => !a.self && !a.resource).length;
  return {
    id,
    judul: text(event.summary, 300) || '(tanpa judul)',
    seharian: allDay,
    // An all-day event ends on its last day (Google stores the day after).
    mulai: allDay ? event.start.date : wibClock(startMs),
    selesai: allDay ? prevDay(event.end.date) : wibClock(endMs),
    lokasi: text(event.location, 300) || null,
    ada_meet: Boolean(event.hasConference),
    jumlah_tamu: guests,
    berulang: Boolean(event.recurring),
    sudah_selesai: endMs <= now,
    boleh_diubah: Boolean(canWrite && event.canEdit && id),
    rute: canWrite && event.canEdit && id ? `/calendar?ubah=${id}` : null,
  };
}

const acaraKalenderSaya = {
  name: 'acara_kalender_saya',
  module: ['calendar'],
  label: 'Membaca kalender Anda',
  description: 'Acara di Google Calendar milik pengguna sendiri (kalender utamanya), dibaca atas nama pengguna persis seperti halaman Kalender. '
    + 'Bawaan: mulai hari ini sampai 7 hari ke depan; "hari" mengubah rentangnya (paling lama 31 hari); "hanya_hari_ini" = acara hari ini saja. '
    + 'Tiap acara: judul, mulai dan selesai (WIB), seharian atau tidak, lokasi, ada Google Meet atau tidak, jumlah tamu, sudah selesai atau belum, id, dan rute untuk membuka formulir "Ubah event" bila pengguna boleh mengubahnya. '
    + 'Pakai untuk "apa jadwal saya hari ini", "jadwal minggu ini", "kapan rapat X". '
    + 'Tidak pernah kalender orang lain atau kalender bersama, tautan Google Meet, nama atau email tamu, deskripsi, atau lampiran acara. Tidak membuat, mengubah, menjawab undangan, atau mengirim apa pun.',
  inputSchema: {
    type: 'object',
    properties: {
      hari: { type: 'integer', minimum: 1, maximum: MAX_DAYS, description: 'Jumlah hari mulai hari ini (default 7, maksimal 31)' },
      hanya_hari_ini: { type: 'boolean', description: 'true = hanya acara hari ini' },
    },
    additionalProperties: false,
  },
  permission: 'meeting.view',
  privateOnly: true,
  async run(user, input = {}, { now = Date.now(), waitMs = GOOGLE_WAIT_MS } = {}) {
    const subject = typeof user?.email === 'string' ? user.email.trim() : '';
    if (!subject) return { tersedia: false, catatan: UNAVAILABLE };
    const days = input.hanya_hari_ini === true ? 1 : int(input.hari, { min: 1, max: MAX_DAYS, fallback: DEFAULT_DAYS });
    const from = wibDayStart(now);
    const to = from + days * DAY_MS;
    const result = await orUnavailable(() => calendar.listEvents(subject, {
      calendarId: 'primary',
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      timeZone: TIME_ZONE,
    }, { entityId: user.entityId, userId: user.sub }), waitMs);
    const items = result.ok ? result.value?.items : null;
    if (!Array.isArray(items)) return { tersedia: false, catatan: UNAVAILABLE };
    const canWrite = hasPerm(user, 'meeting.create');
    const events = items
      .filter((item) => item && item.status !== 'cancelled')
      .map((item) => eventOut(normalizeEvent(item, 'primary'), { canWrite, now }))
      .filter(Boolean);
    const shown = events.slice(0, MAX_EVENTS);
    const partial = events.length > shown.length || Boolean(result.value.truncated);
    return {
      tersedia: true,
      rentang: { dari: wibDay(from), sampai: wibDay(to - 1), zona_waktu: 'WIB' },
      jumlah: events.length,
      ditampilkan: shown.length,
      acara: shown,
      ...(partial ? { catatan: `Hanya ${shown.length} acara pertama ditampilkan; persempit rentang harinya.` } : {}),
    };
  },
};

module.exports = [acaraKalenderSaya];
module.exports.orUnavailable = orUnavailable;
