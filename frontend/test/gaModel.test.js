import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATE_CHOICES, addDays, agendaTime, apiErrorMessage, bookingActions, buildAgenda, buildAtk, buildOther, buildRepair,
  buildRoomBooking, buildVehicleBooking, dayRange, findClash, formatWib, formatWibRange, hasErrors, requestActions,
  processorMatches, resourceErrors, slotLabel, stepErrors, targetText, toApiTime, todayWib, wibParts,
} from '../src/pages/ga/gaModel.js';
import { timeSlots } from '../src/components/timeSlots.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';
import { buildNavSections, hasRouteAccess } from '../src/components/navigation.js';

// Layanan GA (People & Culture wave 2, row 2.2) — page models.

const NOW = Date.parse('2026-10-01T03:00:00Z'); // 10.00 WIB

test('times are WIB whatever the browser zone; 23:30 and 00:30 fall on their own WIB days', () => {
  assert.deepEqual(wibParts('2026-10-01T23:30:00+07:00'), { day: '2026-10-01', time: '23:30' });
  assert.deepEqual(wibParts(new Date('2026-10-01T17:30:00Z')), { day: '2026-10-02', time: '00:30' });
  assert.equal(todayWib(Date.parse('2026-10-01T16:59:00Z')), '2026-10-01');
  assert.equal(todayWib(Date.parse('2026-10-01T17:00:00Z')), '2026-10-02');
  assert.equal(toApiTime('2026-10-02', '09:15'), '2026-10-02T09:15:00+07:00');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.deepEqual(dayRange('2026-10-02'), { from: '2026-10-02T00:00:00+07:00', to: '2026-10-03T00:00:00+07:00' });
  assert.equal(formatWib('2026-10-02T09:05:00+07:00'), '2 Okt 2026, 09.05');
  assert.equal(formatWibRange('2026-10-02T09:00:00+07:00', '2026-10-02T10:30:00+07:00'), '2 Okt 2026, 09.00–10.30');
  assert.equal(formatWibRange('2026-10-02T23:30:00+07:00', '2026-10-03T00:30:00+07:00'), '2 Okt 2026, 23.30 – 3 Okt 2026, 00.30');
});

test('TimeInput lists quarter hours only', () => {
  const slots = timeSlots();
  assert.equal(slots.length, 96);
  assert.deepEqual(slots.slice(0, 2), [{ value: '00:00', label: '00.00' }, { value: '00:15', label: '00.15' }]);
  assert.equal(slots.at(-1).value, '23:45');
  assert.equal(timeSlots({ min: '08:00', max: '09:00' }).length, 5);
});

test('the create menu offers the five services of §3.5 in order', () => {
  assert.deepEqual(CREATE_CHOICES.map((c) => c.label), ['ATK', 'Perbaikan fasilitas', 'Pinjam ruang', 'Pinjam kendaraan', 'Lainnya']);
});

test('forms: ATK lines, repair, other — errors on the fields, bodies the API accepts', () => {
  const empty = buildAtk({ locationId: '', items: [{ itemName: '', qty: '', unit: '' }] });
  assert.deepEqual(Object.keys(empty.errors).sort(), ['items', 'locationId']);
  const atk = buildAtk({ locationId: '3', items: [{ itemName: ' Kertas A4 ', qty: '2,5', unit: 'rim' }, { itemName: '', qty: '', unit: '' }], note: '' });
  assert.equal(hasErrors(atk.errors), false);
  assert.deepEqual(atk.body, { requestType: 'atk', locationId: 3, items: [{ itemName: 'Kertas A4', qty: 2.5, unit: 'rim' }] });
  assert.ok(buildAtk({ locationId: '3', items: [{ itemName: 'Map', qty: '0', unit: 'pcs' }] }).errors.items);
  assert.ok(buildAtk({ locationId: '3', items: Array.from({ length: 21 }, () => ({ itemName: 'x', qty: '1', unit: 'pcs' })) }).errors.items);
  const repair = buildRepair({ locationId: '1', area: 'AC', description: 'Bocor', urgent: true });
  assert.deepEqual(repair.body, { requestType: 'facility_repair', locationId: 1, area: 'AC', description: 'Bocor', urgent: true });
  assert.deepEqual(Object.keys(buildRepair({ locationId: '1', area: '', description: '' }).errors).sort(), ['area', 'description']);
  assert.equal(buildOther({ locationId: '1', title: 'Tenda', description: 'Acara' }).body.requestType, 'other');
});

test('room booking: clash-aware against the loaded bookings; touching slots are fine; masked slots count', () => {
  const bookings = [
    { masked: true, resourceId: 7, startsAt: '2026-10-02T09:00:00+07:00', endsAt: '2026-10-02T10:00:00+07:00', departmentName: 'Sales' },
    { id: 4, resourceId: 7, status: 'cancelled', startsAt: '2026-10-02T10:00:00+07:00', endsAt: '2026-10-02T12:00:00+07:00' },
  ];
  const base = { resourceId: '7', date: '2026-10-02', purpose: 'Rapat' };
  const clash = buildRoomBooking({ ...base, start: '09:30', end: '10:30' }, { now: NOW, bookings });
  assert.match(clash.errors.end, /Bentrok dengan 09\.00–10\.00 · Sales/);
  const touching = buildRoomBooking({ ...base, start: '10:00', end: '11:00' }, { now: NOW, bookings });
  assert.equal(hasErrors(touching.errors), false, 'touching + a cancelled booking do not clash');
  assert.deepEqual(touching.body, { resourceId: 7, startsAt: '2026-10-02T10:00:00+07:00', endsAt: '2026-10-02T11:00:00+07:00', purpose: 'Rapat' });
  assert.ok(buildRoomBooking({ ...base, start: '07:00', end: '19:15' }, { now: NOW }).errors.end, 'room ≤ 12 h');
  assert.ok(buildRoomBooking({ ...base, date: '2026-10-01', start: '09:00', end: '09:30' }, { now: NOW }).errors.start, 'past');
  assert.ok(buildRoomBooking({ ...base, date: '2027-01-10', start: '09:00', end: '09:30' }, { now: NOW }).errors.start, 'beyond 90 days');
});

test('vehicle booking: pending holds only before its start; in use holds until now; ≤ 7 days', () => {
  const bookings = [
    { id: 1, resourceId: 2, status: 'pending_approval', startsAt: '2026-10-01T08:00:00+07:00', endsAt: '2026-10-01T18:00:00+07:00' },
    { id: 2, resourceId: 2, status: 'in_use', startsAt: '2026-09-30T08:00:00+07:00', endsAt: '2026-10-01T09:00:00+07:00' },
  ];
  assert.equal(findClash(bookings, 2, '2026-10-01T11:00:00+07:00', '2026-10-01T12:00:00+07:00', NOW), null, 'pending started already, in-use returned by now? no — ends before 11.00');
  assert.equal(findClash(bookings, 2, '2026-10-01T09:45:00+07:00', '2026-10-01T10:30:00+07:00', NOW)?.id, 2, 'in use until now (10.00)');
  const ok = buildVehicleBooking({ resourceId: '2', startDate: '2026-10-02', startTime: '08:00', endDate: '2026-10-03', endTime: '17:00', destination: 'Bandung', needsDriver: true }, { now: NOW });
  assert.equal(hasErrors(ok.errors), false);
  assert.equal(ok.body.destination, 'Bandung');
  assert.equal(ok.body.needsDriver, true);
  assert.ok(buildVehicleBooking({ resourceId: '2', startDate: '2026-10-02', startTime: '08:00', endDate: '2026-10-09', endTime: '08:15', destination: 'x' }, { now: NOW }).errors.end);
});

test('agenda: one card per resource, bookings of that WIB day sorted; others masked to "Terpakai · divisi"', () => {
  const resources = [{ id: 1, name: 'Ruang A' }, { id: 2, name: 'Ruang B' }];
  const bookings = [
    { id: 9, resourceId: 1, status: 'confirmed', startsAt: '2026-10-02T13:00:00+07:00', endsAt: '2026-10-02T14:00:00+07:00', purpose: 'Rapat', requester: { name: 'Ani' }, departmentName: 'Sales' },
    { masked: true, id: null, resourceId: 1, startsAt: '2026-10-02T08:00:00+07:00', endsAt: '2026-10-02T09:00:00+07:00', departmentName: 'Warehouse' },
    { masked: true, id: null, resourceId: 1, startsAt: '2026-10-02T23:30:00+07:00', endsAt: '2026-10-03T00:30:00+07:00', departmentName: 'Finance' },
  ];
  const [a, b] = buildAgenda(resources, bookings, '2026-10-02');
  assert.deepEqual(a.items.map((i) => i.time), ['08.00–09.00', '13.00–14.00', '23.30–…']);
  assert.deepEqual([a.items[0].title, a.items[0].sub, a.items[0].to], ['Terpakai', 'Warehouse', null]);
  assert.deepEqual([a.items[1].title, a.items[1].to], ['Rapat', '/ga/bookings/9']);
  assert.equal(b.items.length, 0);
  assert.equal(buildAgenda(resources, bookings, '2026-10-03')[0].items[0].time, '…–00.30', 'the night booking continues on the next day');
  assert.deepEqual(slotLabel({ masked: true, departmentName: 'Sales', purpose: 'rahasia' }), { title: 'Terpakai', titleData: false, sub: 'Sales', subParts: ['Sales'] });
  assert.deepEqual(slotLabel({ purpose: 'Rapat', requester: { name: 'Ani' }, departmentName: 'Sales' }).subParts, [{ text: 'Ani', data: true }, 'Sales'], 'the requester is record data, the division is not');
  assert.equal(agendaTime({ startsAt: '2026-10-02T09:00:00+07:00', endsAt: '2026-10-02T10:00:00+07:00' }, '2026-10-02'), '09.00–10.00');
});

test('detail actions follow what the server allows: one primary, two secondary, the rest in ⋮', () => {
  assert.deepEqual(requestActions({ can: { decide: true } }), { primary: ['approve'], secondary: ['decline'], menu: [] });
  assert.deepEqual(requestActions({ can: { start: true, reject: true, assign: true, attach: true } }), { primary: ['start'], secondary: ['reject'], menu: ['assign', 'attach'] });
  assert.deepEqual(requestActions({ can: { cancel: true, attach: true } }), { primary: [], secondary: [], menu: ['attach', 'cancel'] });
  assert.deepEqual(requestActions({ can: {} }), { primary: [], secondary: [], menu: [] });
  assert.deepEqual(bookingActions({ can: { checkout: true, cancel: true } }), { primary: ['checkout'], secondary: ['cancel'] });
  assert.deepEqual(bookingActions({ can: { return: true } }), { primary: ['return'], secondary: [] });
  assert.equal(targetText({ status: 'pending_approval', dueAt: null }), 'Setelah disetujui');
});

test('a 409 clash reads as the slot and the division only', () => {
  const error = { response: { data: { error: { code: 'BOOKING_CONFLICT', message: 'Ruang A sudah terpakai pada jam itu', details: { clash: { startsAt: '2026-10-02T09:00:00+07:00', endsAt: '2026-10-02T10:00:00+07:00', departmentName: 'Sales' } } } } } };
  assert.equal(apiErrorMessage(error), 'Ruang A sudah terpakai pada jam itu: 2 Okt 2026, 09.00–10.00 · Sales.');
  assert.equal(apiErrorMessage({}, 'x'), 'x');
});

test('statuses have their tones in statusTone.js (§3.5)', () => {
  const expected = {
    ga_pending_approval: ['warning', 'Menunggu approval'], ga_open: ['default', 'Baru'], ga_in_progress: ['info', 'Diproses'],
    ga_done: ['success', 'Selesai'], ga_rejected: ['error', 'Ditolak'], ga_cancelled: ['error', 'Dibatalkan'],
    booking_confirmed: ['success', 'Terkonfirmasi'], booking_in_use: ['info', 'Dipakai'], booking_returned: ['success', 'Dikembalikan'],
    booking_expired: ['default', 'Kedaluwarsa'],
  };
  for (const [key, [tone, label]] of Object.entries(expected)) {
    assert.equal(statusTone(key), tone, key);
    assert.equal(statusLabel(key), label, key);
  }
});

test('every employee finds Layanan GA under Kerja harian; detail routes need the same permission', () => {
  const sections = buildNavSections(['ga.request.create']);
  const daily = sections.find((s) => s.title === 'Kerja harian');
  assert.ok(daily.items.some((i) => i.to === '/ga' && i.label === 'Layanan GA' && i.symbol === 'room_service'));
  assert.equal(hasRouteAccess('/ga/bookings/3', ['ga.request.create']), true);
  assert.equal(hasRouteAccess('/ga/requests/3', []), false);
});

// ---- Wave C2: what the forms hand to Prakasa AI (docs/prakasa-ai-rencana.md §9.9)

test('a room or vehicle: the dialog\'s own checks, also for a number set by the AI', () => {
  assert.deepEqual(resourceErrors({ kind: 'room', name: ' ', locationId: '', capacity: '' }), { name: 'Tulis nama.', locationId: 'Pilih lokasi.' });
  assert.deepEqual(resourceErrors({ kind: 'room', name: 'Ruang rapat', locationId: '2', capacity: 0 }), { capacity: 'Kapasitas minimal 1.' });
  assert.deepEqual(resourceErrors({ kind: 'room', name: 'Ruang rapat', locationId: '2', capacity: 12 }), {});
  assert.deepEqual(resourceErrors({ kind: 'room', name: 'Ruang rapat', locationId: '2', capacity: '' }), {});
  assert.deepEqual(resourceErrors({ kind: 'vehicle', name: 'Avanza', locationId: '2', plateNumber: '' }), { plateNumber: 'Tulis nomor polisi.' });
});

test('booking times are quarter hours: a time the list cannot show is refused', () => {
  assert.deepEqual(stepErrors({ start: '09:00', end: '10:45' }, ['start', 'end']), {});
  assert.deepEqual(stepErrors({ start: '09:10', end: '10:00' }, ['start', 'end']), { start: 'Pilih jam kelipatan 15 menit.' });
  assert.deepEqual(stepErrors({ start: '', end: '10:05' }, ['start', 'end']), { end: 'Pilih jam kelipatan 15 menit.' });
});

test('"Tugaskan" as a search: only the names the picker lists, narrowed by every word typed', () => {
  const processors = [{ id: 31, name: 'Budi Santoso' }, { id: 32, name: 'Budi Hartono' }, { id: 40, name: 'Sari Dewi', phone: '0812-0000-0000', email: 'sari@example.invalid' }];
  assert.deepEqual(processorMatches(processors, 'budi'), [{ value: '31', label: 'Budi Santoso', hint: '' }, { value: '32', label: 'Budi Hartono', hint: '' }]);
  assert.deepEqual(processorMatches(processors, 'Santoso  budi'), [{ value: '31', label: 'Budi Santoso', hint: '' }]);
  // Nothing but the id (kept in the browser) and the name leaves the list.
  assert.deepEqual(processorMatches(processors, 'sari'), [{ value: '40', label: 'Sari Dewi', hint: '' }]);
  assert.deepEqual(processorMatches(processors, 'Joko'), []);
  assert.deepEqual(processorMatches(processors, '  '), []);
  assert.deepEqual(processorMatches(null, 'budi'), []);
});
