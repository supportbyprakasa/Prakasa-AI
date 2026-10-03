import { getLanguage } from '../../i18n/language.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';
// Layanan GA — pure helpers for the pages (no React, no I/O), tested in
// test/gaModel.test.js. Times: the API sends ISO-8601 with the WIB offset
// ("2026-10-02T09:00:00+07:00"); everything shown or entered here is WIB,
// whatever the browser's own time zone is.

export const REQUEST_TYPE_LABELS = Object.freeze({ atk: 'ATK', facility_repair: 'Perbaikan fasilitas', other: 'Lainnya' });
export const RESOURCE_KIND_LABELS = Object.freeze({ room: 'Ruang', vehicle: 'Kendaraan' });
export const REQUEST_STATUSES = Object.freeze(['pending_approval', 'open', 'in_progress', 'done', 'rejected', 'cancelled']);
export const REQUEST_STATUS_LABELS = Object.freeze({
  pending_approval: 'Menunggu approval', open: 'Baru', in_progress: 'Diproses', done: 'Selesai', rejected: 'Ditolak', cancelled: 'Dibatalkan',
});
export const BOOKING_STATUS_LABELS = Object.freeze({
  pending_approval: 'Menunggu approval', confirmed: 'Terkonfirmasi', in_use: 'Dipakai', returned: 'Dikembalikan',
  rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
});
export const APPROVER_BASIS_LABELS = Object.freeze({
  manager: 'Atasan langsung', division_head: 'Head divisi', management_office: 'Head Management Office',
});

// Vehicle borrowing lives in TrackCar, the company's own app.
export const TRACKCAR_URL = 'https://trackcar.prakasafoods.com';

// "Buat permintaan" menu (§3.5), in this order.
export const CREATE_CHOICES = Object.freeze([
  { kind: 'atk', label: 'ATK', icon: 'edit_note', description: 'Alat tulis dan perlengkapan kantor' },
  { kind: 'facility_repair', label: 'Perbaikan fasilitas', icon: 'build', description: 'AC, lampu, pintu, dan lainnya' },
  { kind: 'room', label: 'Pinjam ruang', icon: 'meeting_room', description: 'Langsung terkonfirmasi bila kosong' },
  // Vehicles are borrowed in the company's own TrackCar app (owner, 1 Oct 2026):
  // a link out, never a second booking system here.
  { kind: 'trackcar', label: 'Pinjam kendaraan', icon: 'directions_car', description: 'Lewat TrackCar (aplikasi peminjaman kendaraan)', href: TRACKCAR_URL },
  { kind: 'other', label: 'Lainnya', icon: 'more_horiz', description: 'Perlu persetujuan atasan' },
]);

// StatusBadge keys (tones live in components/statusTone.js).
export const requestStatusKey = (status) => `ga_${status}`;
export const bookingStatusKey = (status) => `booking_${status}`;

// Booking rules shown in the forms (the server checks them again).
export const BOOKING_STEP_MINUTES = 15;
export const BOOKING_HORIZON_DAYS = 90;
export const BOOKING_MAX_HOURS = Object.freeze({ room: 12, vehicle: 7 * 24 });
export const MAX_ITEMS = 20;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

const WIB_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const WIB_ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\+07:00$/;

// The WIB calendar day and wall-clock time of an instant (ISO string or Date).
export function wibParts(value) {
  if (!value) return null;
  const m = typeof value === 'string' ? WIB_ISO.exec(value) : null;
  if (m) return { day: m[1], time: `${m[2]}:${m[3]}` };
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = new Date(date.getTime() + WIB_MS).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export const todayWib = (now = Date.now()) => wibParts(new Date(now)).day;

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

// "2026-10-02" + "09:15" → "2026-10-02T09:15:00+07:00"
export const toApiTime = (day, time) => (day && time ? `${day}T${time}:00+07:00` : null);
export const toMs = (value) => (value ? new Date(value).getTime() : NaN);

export function formatWibDay(day) {
  if (!day) return '—';
  const [y, mo, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[mo - 1]} ${y}`;
}
// Indonesian clock "09.00"; English "09:00" (like components/format.js).
const dot = (time) => (getLanguage() === 'en' ? time : time.replace(':', '.'));

// "2 Okt 2026, 09.00"
export function formatWib(value) {
  const p = wibParts(value);
  return p ? `${formatWibDay(p.day)}, ${dot(p.time)}` : '—';
}

// "2 Okt 2026, 09.00–10.00" or "2 Okt 2026, 23.30 – 3 Okt 2026, 00.30"
export function formatWibRange(start, end) {
  const a = wibParts(start);
  const b = wibParts(end);
  if (!a || !b) return '—';
  if (a.day === b.day) return `${formatWibDay(a.day)}, ${dot(a.time)}–${dot(b.time)}`;
  return `${formatWibDay(a.day)}, ${dot(a.time)} – ${formatWibDay(b.day)}, ${dot(b.time)}`;
}

// The agenda line of a booking on one day: "09.00–10.00", or with "…" where it
// continues from / into another day.
export function agendaTime(booking, day) {
  const a = wibParts(booking.startsAt);
  const b = wibParts(booking.endsAt);
  if (!a || !b) return '—';
  const from = a.day === day ? dot(a.time) : '…';
  const to = b.day === day ? dot(b.time) : '…';
  return `${from}–${to}`;
}

/** [from, to) of one WIB day for GET /ga/bookings. */
export const dayRange = (day) => ({ from: toApiTime(day, '00:00'), to: toApiTime(addDays(day, 1), '00:00') });

/**
 * Does an existing booking hold [start, end)? Same rule as the server (§3.2):
 * half-open intervals; confirmed and in_use block (in_use at least until
 * now); pending_approval only while its start is in the future.
 */
export function blocksSlot(existing, startsAt, endsAt, now = Date.now()) {
  const exStart = toMs(existing.startsAt);
  let exEnd = toMs(existing.endsAt);
  const status = existing.masked ? 'confirmed' : existing.status;
  if (status === 'in_use') exEnd = Math.max(exEnd, now);
  else if (status === 'pending_approval') { if (exStart <= now) return false; }
  else if (status !== 'confirmed') return false;
  return exStart < toMs(endsAt) && toMs(startsAt) < exEnd;
}

export function findClash(bookings, resourceId, startsAt, endsAt, now = Date.now()) {
  return (bookings || []).find((b) => Number(b.resourceId) === Number(resourceId) && blocksSlot(b, startsAt, endsAt, now)) || null;
}

/** Who/what a slot shows: others' bookings are masked for non-processors (S12). */
export function slotLabel(booking) {
  // titleData / subParts: what is record data for the language switch (the
  // purpose and the requester are; "Terpakai" and a division name are not).
  if (booking.masked) return { title: 'Terpakai', titleData: false, sub: booking.departmentName || null, subParts: [booking.departmentName || null] };
  return {
    title: booking.purpose || 'Terpakai',
    titleData: Boolean(booking.purpose),
    sub: [booking.requester?.name, booking.departmentName].filter(Boolean).join(' · ') || null,
    subParts: [booking.requester?.name ? { text: booking.requester.name, data: true } : null, booking.departmentName || null],
  };
}

/**
 * The agenda of one WIB day: one entry per resource (in the given order),
 * with that day's bookings sorted by start.
 */
export function buildAgenda(resources, bookings, day) {
  const { from, to } = dayRange(day);
  const start = toMs(from);
  const end = toMs(to);
  return (resources || []).map((resource) => ({
    resource,
    items: (bookings || [])
      .filter((b) => Number(b.resourceId) === Number(resource.id) && toMs(b.startsAt) < end && start < toMs(b.endsAt))
      .sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt))
      .map((b, index) => ({
        key: b.id ? `b${b.id}` : `m${resource.id}-${index}`,
        booking: b,
        time: agendaTime(b, day),
        ...slotLabel(b),
        to: b.id && !b.masked ? `/ga/bookings/${b.id}` : null,
      })),
  }));
}

// ------------------------------------------------------------------ forms

const clean = (value) => String(value ?? '').trim();

/** ATK lines: name, quantity and unit each; empty rows are ignored. */
export function buildAtk({ locationId, items, note }) {
  const errors = {};
  const lines = (items || []).filter((i) => clean(i.itemName) || clean(i.qty) || clean(i.unit));
  if (!locationId) errors.locationId = 'Pilih lokasi.';
  if (!lines.length) errors.items = 'Isi minimal satu barang.';
  if (lines.length > MAX_ITEMS) errors.items = `Paling banyak ${MAX_ITEMS} barang.`;
  const parsed = lines.map((line) => ({ itemName: clean(line.itemName), qty: Number(String(line.qty).replace(',', '.')), unit: clean(line.unit) }));
  if (parsed.some((l) => !l.itemName || !l.unit || !(l.qty > 0))) errors.items = errors.items || 'Setiap barang perlu nama, jumlah lebih dari 0, dan satuan.';
  return {
    errors,
    body: { requestType: 'atk', locationId: Number(locationId), items: parsed, ...(clean(note) ? { note: clean(note) } : {}) },
  };
}

export function buildRepair({ locationId, area, description, urgent }) {
  const errors = {};
  if (!locationId) errors.locationId = 'Pilih lokasi.';
  if (!clean(area)) errors.area = 'Tulis area atau objek yang rusak.';
  if (!clean(description)) errors.description = 'Tulis uraian kerusakan.';
  return { errors, body: { requestType: 'facility_repair', locationId: Number(locationId), area: clean(area), description: clean(description), urgent: Boolean(urgent) } };
}

export function buildOther({ locationId, title, description }) {
  const errors = {};
  if (!locationId) errors.locationId = 'Pilih lokasi.';
  if (!clean(title)) errors.title = 'Tulis judul permintaan.';
  if (!clean(description)) errors.description = 'Tulis uraian permintaan.';
  return { errors, body: { requestType: 'other', locationId: Number(locationId), title: clean(title), description: clean(description) } };
}

function windowErrors(kind, startsAt, endsAt, now) {
  const errors = {};
  const s = toMs(startsAt);
  const e = toMs(endsAt);
  if (!Number.isFinite(s)) { errors.start = 'Pilih tanggal dan jam mulai.'; return errors; }
  if (!Number.isFinite(e)) { errors.end = 'Pilih jam selesai.'; return errors; }
  if (e <= s) errors.end = 'Jam selesai harus setelah jam mulai.';
  else if (e - s > BOOKING_MAX_HOURS[kind] * 3600e3) {
    errors.end = kind === 'room' ? 'Ruang dipinjam paling lama 12 jam.' : 'Kendaraan dipinjam paling lama 7 hari.';
  }
  if (s < now - BOOKING_STEP_MINUTES * 60e3) errors.start = 'Jam mulai sudah lewat.';
  else if (s > now + BOOKING_HORIZON_DAYS * DAY_MS) errors.start = `Paling jauh ${BOOKING_HORIZON_DAYS} hari ke depan.`;
  return errors;
}

/** Room: one day, start and end time. */
export function buildRoomBooking({ resourceId, date, start, end, purpose }, { now = Date.now(), bookings = [] } = {}) {
  const startsAt = toApiTime(date, start);
  const endsAt = toApiTime(date, end);
  const errors = {};
  if (!resourceId) errors.resourceId = 'Pilih ruang.';
  if (!date) errors.date = 'Pilih tanggal.';
  Object.assign(errors, windowErrors('room', startsAt, endsAt, now));
  if (!clean(purpose)) errors.purpose = 'Tulis keperluan.';
  const clash = !errors.start && !errors.end && resourceId ? findClash(bookings, resourceId, startsAt, endsAt, now) : null;
  if (clash) errors.end = `Bentrok dengan ${agendaTime(clash, date)}${clash.departmentName ? ` · ${clash.departmentName}` : ''}.`;
  return { errors, clash, body: { resourceId: Number(resourceId), startsAt, endsAt, purpose: clean(purpose) } };
}

/** Vehicle: start and end date+time, destination, driver needed. */
export function buildVehicleBooking({ resourceId, startDate, startTime, endDate, endTime, destination, needsDriver }, { now = Date.now(), bookings = [] } = {}) {
  const startsAt = toApiTime(startDate, startTime);
  const endsAt = toApiTime(endDate, endTime);
  const errors = {};
  if (!resourceId) errors.resourceId = 'Pilih kendaraan.';
  Object.assign(errors, windowErrors('vehicle', startsAt, endsAt, now));
  if (!clean(destination)) errors.destination = 'Tulis tujuan.';
  const clash = !errors.start && !errors.end && resourceId ? findClash(bookings, resourceId, startsAt, endsAt, now) : null;
  if (clash) errors.end = `Bentrok dengan ${formatWibRange(clash.startsAt, clash.endsAt)}${clash.departmentName ? ` · ${clash.departmentName}` : ''}.`;
  return {
    errors,
    clash,
    body: {
      resourceId: Number(resourceId), startsAt, endsAt,
      purpose: `Perjalanan ke ${clean(destination)}`.slice(0, 255), destination: clean(destination), needsDriver: Boolean(needsDriver),
    },
  };
}

export const hasErrors = (errors) => Object.keys(errors || {}).length > 0;

/** The time fields list quarter hours only: a time off that step cannot be shown by them. */
export function stepErrors(values = {}, names = []) {
  const errors = {};
  for (const name of names) {
    const time = String(values[name] || '');
    if (time && Number(time.slice(3, 5)) % BOOKING_STEP_MINUTES !== 0) errors[name] = `Pilih jam kelipatan ${BOOKING_STEP_MINUTES} menit.`;
  }
  return errors;
}

/** Add / edit a room or vehicle: what the dialog checks before sending. */
export function resourceErrors(values = {}) {
  const errors = {};
  if (!clean(values.name)) errors.name = 'Tulis nama.';
  if (!values.locationId) errors.locationId = 'Pilih lokasi.';
  if (values.kind === 'vehicle' && !clean(values.plateNumber)) errors.plateNumber = 'Tulis nomor polisi.';
  if (values.kind === 'room' && values.capacity !== '' && values.capacity !== null && values.capacity !== undefined && !(Number(values.capacity) >= 1)) errors.capacity = 'Kapasitas minimal 1.';
  return errors;
}

/**
 * The "Tugaskan ke…" picker as a search (Prakasa AI's person field): the
 * accounts the Select already lists (GET /ga/processors: id and name), narrowed
 * to the names that hold every word typed. Only what the Select shows goes out.
 */
export function processorMatches(processors, text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return (processors || [])
    .filter((p) => p && p.id && p.name && words.every((word) => String(p.name).toLowerCase().includes(word)))
    .map((p) => ({ value: String(p.id), label: p.name, hint: '' }));
}

/** The server's 409 clash, in words (time and division only). */
export function apiErrorMessage(error, fallback = 'Periksa koneksi, lalu coba lagi.') {
  const data = error?.response?.data?.error;
  if (data?.code === 'BOOKING_CONFLICT' && data.details?.clash) {
    const c = data.details.clash;
    return `${data.message}: ${formatWibRange(c.startsAt, c.endsAt)}${c.departmentName ? ` · ${c.departmentName}` : ''}.`;
  }
  return data?.message || fallback;
}

// ------------------------------------------------------------------ detail

export const HISTORY_LABELS = Object.freeze({
  'ga.request.create': 'Permintaan dibuat',
  'ga.request.cancel': 'Dibatalkan pengaju',
  'ga.request.in_progress': 'Mulai diproses',
  'ga.request.done': 'Diselesaikan',
  'ga.request.rejected': 'Ditolak GA',
  'ga.request.assign': 'Penanggung jawab diubah',
  'ga.request.attachment': 'Lampiran ditambahkan',
  'ga.request.approved': 'Disetujui',
  'ga.request.rejected_by_approver': 'Ditolak penyetuju',
  'ga.request.decision_denied': 'Keputusan ditolak sistem',
  'ga.booking.create': 'Peminjaman dibuat',
  'ga.booking.cancel': 'Dibatalkan',
  'ga.booking.confirmed': 'Disetujui',
  'ga.booking.rejected': 'Ditolak penyetuju',
  'ga.booking.checkout': 'Kunci diserahkan',
  'ga.booking.return': 'Diterima kembali',
  'ga.booking.expired': 'Kedaluwarsa',
  'ga.booking.decision_denied': 'Keputusan ditolak sistem',
});
export const historyLabel = (action) => HISTORY_LABELS[action] || 'Perubahan';

/** Header actions of a request detail, by what the server says the viewer may do. */
export function requestActions(request) {
  const can = request?.can || {};
  const primary = [];
  const secondary = [];
  const menu = [];
  if (can.decide) { primary.push('approve'); secondary.push('decline'); }
  if (can.start) primary.push('start');
  if (can.finish) primary.push('finish');
  if (can.reject) secondary.push('reject');
  if (can.assign) menu.push('assign');
  if (can.attach) menu.push('attach');
  if (can.cancel) menu.push('cancel');
  return { primary: primary.slice(0, 1), secondary: [...primary.slice(1), ...secondary].slice(0, 2), menu: [...[...primary.slice(1), ...secondary].slice(2), ...menu] };
}

export function bookingActions(booking) {
  const can = booking?.can || {};
  const primary = [];
  const secondary = [];
  if (can.decide) { primary.push('approve'); secondary.push('decline'); }
  if (can.checkout) primary.push('checkout');
  if (can.return) primary.push('return');
  if (can.cancel) secondary.push('cancel');
  return { primary: primary.slice(0, 1), secondary: [...primary.slice(1), ...secondary].slice(0, 2) };
}

/** Target column: due date, flagged when past. */
export function targetText(request) {
  if (!request?.dueAt) return request?.status === 'pending_approval' ? 'Setelah disetujui' : '—';
  return formatWib(request.dueAt);
}
