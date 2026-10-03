// Layanan GA (People & Culture wave 2, row 2.2) — the rules in one place, so the
// service, the reminder job and the management provider can never disagree
// (docs/rancangan-people-culture-g2.md §3.2, decisions 16–20). Pure: no I/O.

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;
const WIB_OFFSET_MS = 7 * HOUR_MS;

const REQUEST_TYPES = Object.freeze(['atk', 'facility_repair', 'other']);
const REQUEST_TYPE_LABELS = Object.freeze({ atk: 'ATK', facility_repair: 'Perbaikan fasilitas', other: 'Lainnya' });
const RESOURCE_KINDS = Object.freeze(['room', 'vehicle']);
const RESOURCE_KIND_LABELS = Object.freeze({ room: 'Ruang', vehicle: 'Kendaraan' });

// Decision 18: calendar days, like IT tickets. Stored on the request when the
// clock starts, so a later change here never rewrites the on-time history.
const SLA_DAYS = Object.freeze({ atk: 2, facility_repair: Object.freeze({ normal: 3, urgent: 1 }), other: 5 });

// Decision 17: only "Lainnya" requests (and vehicle bookings) need approval.
const APPROVAL_REQUEST_TYPE = Object.freeze({ other: 'ga_request_other' });
const VEHICLE_REQUEST_TYPE = 'ga_vehicle_booking';
const SUBJECT_REQUEST = 'ga_request';
const SUBJECT_BOOKING = 'ga_booking';

const REQUEST_STATUSES = Object.freeze(['pending_approval', 'open', 'in_progress', 'done', 'rejected', 'cancelled']);
const BOOKING_STATUSES = Object.freeze(['pending_approval', 'confirmed', 'in_use', 'returned', 'rejected', 'cancelled', 'expired']);
const OPEN_REQUEST = Object.freeze(['open', 'in_progress']);

// What GA (ga.request.process) may move a request to, from each status.
// "done" needs a resolution note, "rejected" a reason (checked by the service).
const PROCESS_TRANSITIONS = Object.freeze({
  open: Object.freeze(['in_progress', 'rejected']),
  in_progress: Object.freeze(['done', 'rejected']),
});
// The requester may cancel while nobody has started on it.
const CANCELLABLE_REQUEST = Object.freeze(['pending_approval', 'open']);

// Booking validation (§3.2).
const BOOKING_STEP_MINUTES = 15;
const BOOKING_START_GRACE_MINUTES = 15;
const BOOKING_HORIZON_DAYS = 90;
const BOOKING_MAX_HOURS = Object.freeze({ room: 12, vehicle: 7 * 24 });
const BOOKING_LIST_MAX_DAYS = 31;
// A vehicle still out this long after its end time is escalated.
const VEHICLE_LATE_HOURS = 2;
// Vehicles are borrowed in TrackCar, the company's own app (owner, 1 Oct
// 2026): the GA module books rooms only and never runs a second vehicle system.
const TRACKCAR_URL = 'https://trackcar.prakasafoods.com';
const VEHICLES_IN_TRACKCAR = 'Peminjaman kendaraan lewat TrackCar (trackcar.prakasafoods.com), bukan di Layanan GA.';

const MAX_ITEMS = 20;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

function slaDaysFor(requestType, urgency = 'normal') {
  const rule = SLA_DAYS[requestType];
  if (rule == null) return null;
  if (typeof rule === 'number') return rule;
  return rule[urgency === 'urgent' ? 'urgent' : 'normal'];
}

const dueAtFrom = (clockStart, slaDays) => new Date(new Date(clockStart).getTime() + Number(slaDays) * DAY_MS);

function needsApproval(requestType) {
  return Boolean(APPROVAL_REQUEST_TYPE[requestType]);
}

function canProcessTransition(from, to) {
  return Boolean(PROCESS_TRANSITIONS[from]?.includes(to));
}

// The API speaks ISO-8601 with the WIB offset; the database stores UTC.
function toApiTime(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
}

// The WIB calendar day of an instant, YYYY-MM-DD.
const wibDay = (value = Date.now()) => new Date(new Date(value).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

// The instant a WIB calendar day starts (00:00 WIB).
const wibDayStart = (day) => new Date(`${day}T00:00:00+07:00`);

function ruleError(code, message, details) {
  return { code, message, ...(details ? { details } : {}) };
}

/**
 * Checks one booking window against the rules of §3.2. Returns null when it is
 * fine, or { code, message } describing the first problem.
 */
function bookingWindowProblem({ kind, startsAt, endsAt, now = new Date() }) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return ruleError('BOOKING_TIME_INVALID', 'Jam mulai dan selesai wajib diisi');
  }
  const onStep = (d) => d.getTime() % (BOOKING_STEP_MINUTES * MINUTE_MS) === 0;
  if (!onStep(start) || !onStep(end)) {
    return ruleError('BOOKING_STEP', `Jam dipilih per ${BOOKING_STEP_MINUTES} menit (mis. 09.00, 09.15, 09.30)`);
  }
  if (end.getTime() <= start.getTime()) {
    return ruleError('BOOKING_TIME_INVALID', 'Jam selesai harus setelah jam mulai');
  }
  const nowMs = new Date(now).getTime();
  if (start.getTime() < nowMs - BOOKING_START_GRACE_MINUTES * MINUTE_MS) {
    return ruleError('BOOKING_IN_PAST', 'Jam mulai sudah lewat');
  }
  if (start.getTime() > nowMs + BOOKING_HORIZON_DAYS * DAY_MS) {
    return ruleError('BOOKING_TOO_FAR', `Peminjaman paling jauh ${BOOKING_HORIZON_DAYS} hari ke depan`);
  }
  const maxHours = BOOKING_MAX_HOURS[kind];
  if (maxHours && end.getTime() - start.getTime() > maxHours * HOUR_MS) {
    return ruleError('BOOKING_TOO_LONG', kind === 'room'
      ? `Ruang dipinjam paling lama ${maxHours} jam`
      : `Kendaraan dipinjam paling lama ${maxHours / 24} hari`);
  }
  return null;
}

/**
 * Does an existing booking hold the slot [start, end)? Half-open intervals:
 * touching bookings (one ends 10.00, the next starts 10.00) do not clash.
 * Mirrors the SQL of the service: confirmed and in_use block (in_use until it
 * is returned — at least until now); pending_approval blocks only while its
 * start is still in the future (a pending booking whose start passed expires).
 */
function blocksSlot(existing, { startsAt, endsAt, now = new Date() }) {
  const nowMs = new Date(now).getTime();
  const exStart = new Date(existing.startsAt).getTime();
  let exEnd = new Date(existing.endsAt).getTime();
  if (existing.status === 'in_use') exEnd = Math.max(exEnd, nowMs);
  else if (existing.status === 'pending_approval') {
    if (exStart <= nowMs) return false;
  } else if (existing.status !== 'confirmed') return false;
  return exStart < new Date(endsAt).getTime() && new Date(startsAt).getTime() < exEnd;
}

module.exports = {
  REQUEST_TYPES,
  REQUEST_TYPE_LABELS,
  RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  SLA_DAYS,
  APPROVAL_REQUEST_TYPE,
  VEHICLE_REQUEST_TYPE,
  SUBJECT_REQUEST,
  SUBJECT_BOOKING,
  REQUEST_STATUSES,
  BOOKING_STATUSES,
  OPEN_REQUEST,
  PROCESS_TRANSITIONS,
  CANCELLABLE_REQUEST,
  BOOKING_STEP_MINUTES,
  BOOKING_START_GRACE_MINUTES,
  BOOKING_HORIZON_DAYS,
  BOOKING_MAX_HOURS,
  BOOKING_LIST_MAX_DAYS,
  VEHICLE_LATE_HOURS,
  TRACKCAR_URL,
  VEHICLES_IN_TRACKCAR,
  MAX_ITEMS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_TYPES,
  DAY_MS,
  slaDaysFor,
  dueAtFrom,
  needsApproval,
  canProcessTransition,
  toApiTime,
  wibDay,
  wibDayStart,
  bookingWindowProblem,
  blocksSlot,
};
