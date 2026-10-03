import test from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_CYCLE_LABELS, DEVICE_TYPE_LABELS, formatAmount, labelFor, optionsFrom } from '../src/pages/it/itModel.js';

test('IT amounts are rupiah through format.js; another currency keeps its code', () => {
  assert.equal(formatAmount(1250000, 'IDR'), 'Rp 1.250.000');
  assert.equal(formatAmount(1250000, null), 'Rp 1.250.000');
  assert.equal(formatAmount('99.5', 'USD'), 'USD 99,5');
  assert.equal(formatAmount(null, 'IDR'), '—');
  assert.equal(formatAmount('', 'USD'), '—');
});

test('IT codes show Indonesian labels, and an unknown code stays readable', () => {
  assert.equal(labelFor(DEVICE_TYPE_LABELS, 'external_hdd'), 'Harddisk eksternal');
  assert.equal(labelFor(DEVICE_TYPE_LABELS, 'drone'), 'drone');
  assert.equal(labelFor(DEVICE_TYPE_LABELS, null), '—');
  assert.deepEqual(optionsFrom(BILLING_CYCLE_LABELS, ['monthly', 'yearly']), [
    { value: 'monthly', label: 'Bulanan' },
    { value: 'yearly', label: 'Tahunan' },
  ]);
});

// ------------------------------------------------------------ People & Culture wave 1 (row 1.2)
import { createRequire } from 'node:module';
import {
  ASSIGNABLE_FROM, DEVICE_STATUS_LABELS, FINAL_DEVICE_STATUSES, LOCATION_KIND_LABELS, MAIN_DEVICE_STATUSES,
  OTHER_DEVICE_STATUSES, PROBLEMATIC_STATUSES, brandModel, deviceBody, deviceFieldErrorFromApi, deviceFormErrors,
  deviceFormValues, deviceQuery, deviceStatusKey, deviceTitle, holderName, specLine, statusChangeBody,
  statusChangeErrors, statusTransitions,
} from '../src/pages/it/itModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';
import { dashboardBars } from '../src/pages/it/itDashboardModel.js';

const backend = createRequire(import.meta.url)('../../backend/src/config/itAssets.js');

test('device types: the frontend list is exactly the backend list, with the same Indonesian labels (rule 20)', () => {
  assert.deepEqual(Object.keys(DEVICE_TYPE_LABELS).sort(), [...backend.DEVICE_TYPES].sort());
  assert.deepEqual(DEVICE_TYPE_LABELS, { ...backend.DEVICE_TYPE_LABELS });
  assert.equal(DEVICE_TYPE_LABELS.telephone, 'Telepon');
  assert.equal(DEVICE_TYPE_LABELS.label_printer, 'Printer label');
  assert.equal(DEVICE_TYPE_LABELS.fingerprint, 'Mesin sidik jari');
});

test('device statuses, location kinds and the status rules match the backend (rule 14)', () => {
  assert.deepEqual(DEVICE_STATUS_LABELS, { ...backend.DEVICE_STATUS_LABELS });
  assert.deepEqual([...MAIN_DEVICE_STATUSES, ...OTHER_DEVICE_STATUSES].sort(), [...backend.DEVICE_STATUSES].sort());
  assert.deepEqual(PROBLEMATIC_STATUSES, [...backend.PROBLEMATIC_STATUSES]);
  assert.deepEqual(FINAL_DEVICE_STATUSES, [...backend.FINAL_STATUSES]);
  assert.deepEqual(ASSIGNABLE_FROM, [...backend.ASSIGNABLE_FROM]);
  assert.deepEqual(LOCATION_KIND_LABELS, { ...backend.LOCATION_KIND_LABELS });
  assert.deepEqual(MAIN_DEVICE_STATUSES.map((s) => DEVICE_STATUS_LABELS[s]), ['Aktif', 'Cadangan', 'Rusak', 'Tidak aktif']);
});

test('device status badges read like the report, with one shared tone each', () => {
  for (const status of Object.keys(DEVICE_STATUS_LABELS)) {
    assert.equal(statusLabel(deviceStatusKey(status)), DEVICE_STATUS_LABELS[status], status);
  }
  assert.equal(statusTone(deviceStatusKey('assigned')), 'success');
  assert.equal(statusTone(deviceStatusKey('damaged')), 'error');
  assert.equal(statusTone(deviceStatusKey('retired')), 'default');
  assert.equal(statusTone(deviceStatusKey('repair')), 'warning');
  assert.equal(statusLabel('holder_resigned'), 'Pemegang sudah resign');
  assert.equal(statusTone('holder_resigned'), 'warning');
});

test('status transitions: the dialog offers only what the server accepts', () => {
  const from = (status) => Object.fromEntries(statusTransitions(status).map((t) => [t.status, t.blocked]));
  const spare = from('available');
  assert.equal(spare.available, 'Status saat ini');
  assert.equal(spare.assigned, null);
  assert.equal(spare.damaged, null);
  const active = from('assigned');
  assert.match(active.assigned, /Kembalikan dulu/, 'an Aktif device is returned before it changes holder');
  assert.equal(active.retired, null);
  const lost = from('lost');
  assert.match(lost.assigned, /tidak bisa diserahkan/);
  assert.equal(lost.available, null);
  assert.ok(statusTransitions('disposed').every((t) => t.blocked), 'Dibuang is final');
  const rules = Object.fromEntries(statusTransitions('available').map((t) => [t.status, t]));
  assert.equal(rules.assigned.needsHolder, true);
  for (const s of ['damaged', 'retired', 'lost', 'disposed']) assert.equal(rules[s].needsReason, true, s);
  for (const s of ['available', 'maintenance', 'repair']) assert.equal(rules[s]?.needsReason ?? false, false, s);
});

test('status change body: Aktif carries exactly one holder; other statuses none', () => {
  const account = { key: 'u30', userId: 30, personId: null };
  const personWithAccount = { key: 'p12', userId: 30, personId: 12 };
  const personOnly = { key: 'p45', userId: null, personId: 45 };
  assert.deepEqual(statusChangeBody({ status: 'assigned', holderMode: 'entry', entry: account }), { status: 'assigned', assignedTo: 30 });
  assert.deepEqual(statusChangeBody({ status: 'assigned', holderMode: 'entry', entry: personWithAccount }), { status: 'assigned', assignedTo: 30 });
  assert.deepEqual(statusChangeBody({ status: 'assigned', holderMode: 'entry', entry: personOnly, note: ' Laptop kerja ' }), { status: 'assigned', personId: 45, note: 'Laptop kerja' });
  assert.deepEqual(statusChangeBody({ status: 'assigned', holderMode: 'label', label: ' Ops Team ', entry: account }), { status: 'assigned', holderLabel: 'Ops Team' });
  assert.deepEqual(statusChangeBody({ status: 'damaged', holderMode: 'entry', entry: account, note: 'Layar retak' }), { status: 'damaged', note: 'Layar retak' });
  assert.deepEqual(statusChangeErrors({ status: 'assigned', holderMode: 'entry', entry: null }), { entry: 'Pilih orang dari direktori.' });
  assert.deepEqual(statusChangeErrors({ status: 'assigned', holderMode: 'label', label: 'x'.repeat(121) }), { label: 'Label pemegang maksimal 120 karakter.' });
  assert.deepEqual(statusChangeErrors({ status: 'damaged', note: '  ' }), { note: 'Alasan wajib diisi.' });
  assert.deepEqual(statusChangeErrors({ status: 'available' }), {});
  assert.deepEqual(statusChangeErrors({ status: '' }), { status: 'Pilih status baru.' });
});

test('device list helpers: one "Merek / model", RAM/SSD/OS line, holder, title, query', () => {
  const d = {
    deviceType: 'laptop', brand: 'Lenovo', model: 'IdeaPad Slim 5', ramGb: 16, storageGb: 512, osVersion: 'Windows 11 Pro',
    holder: { kind: 'label', label: 'Ops Team', name: 'Ops Team' }, assetCode: 'LAP/PFN/2024/002',
  };
  assert.equal(brandModel(d), 'Lenovo IdeaPad Slim 5');
  assert.equal(specLine(d), '16 GB · 512 GB · Windows 11 Pro');
  assert.equal(specLine({ storageGb: 1024 }), '1 TB');
  assert.equal(specLine({}), '');
  assert.equal(holderName(d), 'Ops Team');
  assert.equal(holderName({ holder: null }), '');
  assert.equal(deviceTitle(d), 'Laptop Lenovo IdeaPad Slim 5');
  assert.equal(deviceTitle({ deviceType: 'monitor', assetCode: 'MON/1' }), 'Monitor MON/1');
  assert.deepEqual(deviceQuery({ status: 'assigned', deviceType: '', locationId: 'none', q: ' ani ', problematic: true, warrantyDays: 60 }),
    { status: 'assigned', locationId: 'none', q: 'ani', problematic: '1', warrantyDays: '60' });
});

test('device form: create sends filled fields as numbers; edit sends only changes and folds the brand into the model', () => {
  const values = { ...deviceFormValues(null), deviceType: 'laptop', model: ' IdeaPad ', serialNumber: 'pf01', purchaseYear: '2024', ramGb: '16', locationId: '2' };
  assert.deepEqual(deviceBody(values), {
    deviceType: 'laptop', model: 'IdeaPad', serialNumber: 'pf01', purchaseYear: 2024, locationId: 2, ramGb: 16,
    warrantyType: 'manufacturer', conditionState: 'good',
  });
  const device = { id: 7, deviceType: 'laptop', brand: 'Lenovo', model: 'IdeaPad', assetCode: 'A1', ramGb: 8, warrantyType: 'manufacturer', conditionState: 'good' };
  const initial = { values: deviceFormValues(device), brand: device.brand };
  assert.equal(initial.values.model, 'Lenovo IdeaPad');
  assert.deepEqual(deviceBody({ ...initial.values, ramGb: '16' }, initial), { ramGb: 16 });
  assert.deepEqual(deviceBody({ ...initial.values, model: 'Lenovo IdeaPad Slim 5' }, initial), { model: 'Lenovo IdeaPad Slim 5', brand: null });
  assert.deepEqual(deviceBody({ ...initial.values, assetCode: '' }, initial), { assetCode: null });
  assert.deepEqual(deviceBody(initial.values, initial), {});
  assert.deepEqual(deviceFormErrors({ ...deviceFormValues(null) }), { deviceType: 'Pilih tipe perangkat.' });
  assert.ok(deviceFormErrors({ ...values, purchaseYear: '1980' }).purchaseYear);
  assert.ok(deviceFormErrors({ ...values, ramGb: '1.5' }).ramGb);
  const serialTaken = { response: { data: { error: { code: 'SERIAL_TAKEN', message: 'Nomor seri sudah dipakai perangkat lain di perusahaan ini' } } } };
  assert.deepEqual(deviceFieldErrorFromApi(serialTaken), { serialNumber: 'Nomor seri sudah dipakai perangkat lain di perusahaan ini' });
});

test('dashboard bars: the report\'s four statuses, types and locations, each linking to the filtered list', () => {
  const bars = dashboardBars({
    devices: { total: 69, byStatus: { assigned: 57, available: 5, damaged: 4, retired: 3, lost: 0, repair: 0, maintenance: 0, disposed: 0 } },
    byType: [{ deviceType: 'laptop', label: 'Laptop', total: 24 }, { deviceType: 'monitor', total: 20 }, { deviceType: 'fingerprint', total: 0 }],
    byLocation: [{ locationId: 2, name: 'Alsut Office', total: 39, problematic: 4 }, { locationId: null, name: 'Tanpa lokasi', total: 1, problematic: 0 }],
  });
  assert.deepEqual(bars.byStatus.map((b) => [b.label, b.value, b.to]), [
    ['Aktif', 57, '/it/devices?status=assigned'], ['Cadangan', 5, '/it/devices?status=available'],
    ['Rusak', 4, '/it/devices?status=damaged'], ['Tidak aktif', 3, '/it/devices?status=retired'],
  ]);
  assert.deepEqual(bars.byType.map((b) => b.label), ['Laptop', 'Monitor']);
  assert.equal(bars.byLocation[0].note, '4 bermasalah');
  assert.equal(bars.byLocation[1].to, '/it/devices?location=none');
  assert.deepEqual(dashboardBars({ devices: { total: 0, byStatus: {} } }).byStatus, []);
});
