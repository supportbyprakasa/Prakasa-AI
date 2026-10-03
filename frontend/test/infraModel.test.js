import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import * as m from '../src/pages/it/infraModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

// IT infrastructure registers (wave 2, row 2.3): the page's pure model.
const require = createRequire(import.meta.url);
const backend = require('../../backend/src/config/itInfra.js');

test('labels and the import allow-list mirror the backend config', () => {
  const pairs = [
    ['NETWORK_TYPE_LABELS'], ['NETWORK_STATUS_LABELS'], ['ISP_STATUS_LABELS'], ['CCTV_RECORDER_LABELS'], ['CCTV_STATUS_LABELS'],
    ['BACKUP_FREQUENCY_LABELS'], ['BACKUP_STORAGE_LABELS'], ['BACKUP_RESULT_LABELS'], ['BACKUP_STATUS_LABELS'],
    ['PHONE_KIND_LABELS'], ['PHONE_STATUS_LABELS'], ['VENDOR_KIND_LABELS'],
  ];
  for (const [name] of pairs) assert.deepEqual(m[name], { ...backend[name] }, name);
  for (const kind of backend.IMPORT_KINDS) {
    assert.deepEqual(m.IMPORT_COLUMNS[kind].map((c) => [c.field, c.headers]), backend.IMPORT_COLUMNS[kind].map((c) => [c.field, [...c.headers]]), kind);
  }
});

test('tabs: Jaringan, ISP, CCTV, Backup, Google Workspace, Telepon & HP, Vendor; unknown tab → Jaringan', () => {
  assert.deepEqual(m.TABS.map((t) => t.l), ['Jaringan', 'ISP', 'CCTV', 'Backup', 'Google Workspace', 'Telepon & HP', 'Vendor']);
  assert.equal(m.tabFrom('cctv'), 'cctv');
  assert.equal(m.tabFrom('x'), 'network');
  assert.equal(m.tabCount({ cctv: { total: 3 }, vendors: { total: 2 } }, 'cctv'), 3);
  assert.equal(m.tabCount({ vendors: { total: 2 } }, 'vendor'), 2);
});

test('status keys exist in statusTone with the spec tones (tone is never local)', () => {
  const expected = {
    net_active: 'success', net_spare: 'default', net_damaged: 'error', net_retired: 'default',
    cctv_online: 'success', cctv_partial: 'warning', cctv_offline: 'error',
    backup_ok: 'success', backup_failed: 'error', backup_unknown: 'default',
    line_active: 'success', line_spare: 'default', line_terminated: 'default', isp_active: 'success', isp_terminated: 'default',
  };
  for (const [key, tone] of Object.entries(expected)) assert.equal(statusTone(key), tone, key);
  assert.equal(statusLabel('cctv_partial'), 'Sebagian offline');
  assert.equal(m.statusKey('backup', { status: 'active', lastResult: 'failed' }), 'backup_failed');
  assert.equal(m.statusKey('backup', { status: 'retired', lastResult: 'ok' }), 'backup_retired');
  assert.equal(m.statusKey('phone', { status: 'spare' }), 'line_spare');
  assert.equal(m.statusText('network', { status: 'damaged' }), 'Rusak');
});

test('chips: location and status counts; filters', () => {
  const rows = [
    { id: 1, locationId: 2, locationName: 'PFN Office', status: 'active' },
    { id: 2, locationId: 2, locationName: 'PFN Office', status: 'spare' },
    { id: 3, locationId: 5, locationName: 'Alsut Office', status: 'active' },
  ];
  assert.deepEqual(m.locationChips(rows).map((c) => [c.name, c.count]), [['Alsut Office', 1], ['PFN Office', 2]]);
  assert.deepEqual(m.statusChips('network', rows).map((c) => [c.key, c.count]), [['net_active', 2], ['net_spare', 1]]);
  assert.deepEqual(m.filterRows('network', rows, { location: '2', status: 'net_active' }).map((r) => r.id), [1]);
});

test('forms: > 5 fields go full screen; create sends filled fields; edit sends changes with version', () => {
  assert.equal(m.usesFullScreen('network', false), true);
  const values = m.formValues('network', null);
  assert.equal(values.status, 'active');
  const errors = m.formErrors('network', values);
  assert.ok(errors.deviceType && errors.brandModel && errors.locationId);
  const filled = { ...values, deviceType: 'router', brandModel: 'Asus AX6000', locationId: '3', ipAddress: '10.0.0.1', installedYear: '2026', notes: '' };
  assert.deepEqual(m.formErrors('network', filled), {});
  assert.deepEqual(m.formBody('network', filled), { deviceType: 'router', brandModel: 'Asus AX6000', locationId: 3, ipAddress: '10.0.0.1', installedYear: 2026, status: 'active' });
  const row = { id: 9, version: 4, deviceType: 'router', brandModel: 'Asus AX6000', locationId: 3, ipAddress: '10.0.0.1', installedYear: 2026, status: 'active', notes: null };
  const edit = { ...m.formValues('network', row), status: 'damaged', notes: 'Port 3 mati' };
  assert.deepEqual(m.formBody('network', edit, row), { status: 'damaged', notes: 'Port 3 mati', version: 4 });
  assert.deepEqual(m.formBody('network', m.formValues('network', row), row), {}, 'nothing changed');
  assert.equal(m.formErrors('network', { ...filled, notes: 'password: admin' }).notes, m.SECRET_TEXT_MESSAGE);
  // Phone: a mobile line needs a number; status Aktif comes only from "Ganti pemegang".
  assert.equal(m.formErrors('phone', { ...m.formValues('phone', null), locationId: '3' }).number, 'Isi nomor HP perusahaan.');
  assert.ok(!m.formFields('phone', false).some((f) => f.name === 'status'));
  assert.ok(m.formFields('phone', true).some((f) => f.name === 'status'));
  // CCTV "same network as PC" keeps "not confirmed yet" as null.
  const cctv = { ...m.formValues('cctv', null), locationId: '3', cameraCount: '18' };
  assert.equal(m.formBody('cctv', cctv).sameNetworkAsPc, undefined);
  assert.equal(m.formBody('cctv', { ...cctv, sameNetworkAsPc: 'no' }).sameNetworkAsPc, false);
  // Vendors have no version and never send null (the API reads empty as "keep").
  const vendor = { id: 1, name: 'Biznet', vendorKind: 'isp', contactPerson: 'Andi' };
  assert.deepEqual(m.formBody('vendor', { ...m.formValues('vendor', vendor), contactPerson: '' }, vendor), {});
});

test('dialogs: CCTV status, backup check, holder and Google Workspace bodies', () => {
  const row = { id: 1, version: 2, cameraCount: 18 };
  assert.deepEqual(m.cctvStatusErrors({ status: 'partial', camerasOffline: '' }, row), { camerasOffline: 'Isi 1–17.' });
  assert.deepEqual(m.cctvStatusBody({ status: 'partial', camerasOffline: '3', note: ' kabel putus ' }, row), { status: 'partial', version: 2, camerasOffline: 3, note: 'kabel putus' });
  assert.deepEqual(m.cctvStatusBody({ status: 'offline' }, row), { status: 'offline', version: 2 });
  assert.deepEqual(m.backupCheckErrors({ checkedOn: '2026-10-05', result: 'ok' }, '2026-10-01'), { checkedOn: 'Tanggal tidak boleh di masa depan.' });
  assert.deepEqual(m.backupCheckBody({ checkedOn: '2026-10-01', result: 'failed', restoreTested: 1, note: '' }), { checkedOn: '2026-10-01', result: 'failed', restoreTested: true });
  assert.deepEqual(m.holderBody({ mode: 'entry', entry: { personId: 7 } }, row), { version: 2, personId: 7 });
  assert.deepEqual(m.holderBody({ mode: 'entry', entry: { userId: 5, personId: null } }, row), { version: 2, userId: 5 });
  assert.deepEqual(m.holderBody({ mode: 'label', label: ' Tim Sales ' }, row), { version: 2, holderLabel: 'Tim Sales' });
  assert.deepEqual(m.holderBody({ mode: 'none' }, row), { version: 2 });
  assert.deepEqual(m.holderErrors({ mode: 'label', label: 'PIN: 12' }), { label: m.SECRET_TEXT_MESSAGE });
  const gws = { reviewedOn: '2026-09-30', activeUsers: '34', superAdmins: '40', exUsersActive: '0', notes: '' };
  assert.equal(m.gwsErrors(gws, '2026-10-01').superAdmins, 'Tidak boleh lebih dari pengguna aktif.');
  assert.deepEqual(m.gwsBody({ ...gws, superAdmins: '2', mfaEnforced: true }), {
    reviewedOn: '2026-09-30', activeUsers: 34, superAdmins: 2, exUsersActive: 0, mfaEnforced: true, externalSharingRestricted: false, sharedAccountsUsed: false,
  });
});

test('IT dashboard "Infrastruktur": a card per register with rows, none for an empty register, no IP/cost', () => {
  assert.deepEqual(m.infraCards(null), []);
  assert.deepEqual(m.infraCards({ cctv: { total: 0 }, isp: { total: 0 }, backup: { total: 0 }, gws: { total: 0 }, phone: { total: 0 } }), []);
  const cards = m.infraCards({
    cctv: { total: 2, cameras: 38, systemsNotOnline: 1 },
    isp: { total: 1, primaryMbps: 150, locationsWithoutBackup: 1, contractsEnding: 0, contractWindowDays: 60 },
    backup: { total: 1, active: 1, failing: 1, overdue: 0, restoreUntested: 1 },
    gws: { total: 1, mfaEnforced: false, superAdmins: 2, reviewedOn: '2026-05-01', riskFlags: 2, overdue: true },
    phone: { total: 3, active: 2, spare: 1 },
  });
  assert.deepEqual(cards.map((c) => c.key), ['cctv', 'bandwidth', 'contracts', 'backup', 'gws', 'phone']);
  assert.equal(cards[0].note, '1 sistem offline/sebagian');
  assert.equal(cards[0].alert, true);
  assert.equal(cards[1].note, '1 lokasi tanpa ISP cadangan');
  assert.equal(cards[1].alert, false);
  assert.equal(cards[2].label, 'Kontrak ISP berakhir ≤ 60 hari');
  assert.equal(cards[3].note, '1 gagal / terlambat diperiksa · restore belum diuji 1');
  assert.equal(cards[4].value, 'MFA belum wajib');
  for (const c of cards) assert.ok(c.to.startsWith('/it/infrastructure?tab='));
});

test('detail sheet: Indonesian labels, unknown CCTV network flag reads "Belum dipastikan"', () => {
  const items = m.detailItems('cctv', { cameraCount: 18, camerasOffline: 0, recorderType: 'nvr', remoteAccess: false, sameNetworkAsPc: null, status: 'online' });
  assert.equal(items.find((i) => i.label === 'Satu jaringan dengan PC').value, 'Belum dipastikan');
  assert.equal(items.find((i) => i.label === 'Perekam').value, 'NVR');
  assert.equal(m.phoneText({ number: '+6281234567890', extension: '12' }), '+6281234567890 · ext. 12');
});

test('the page never publishes register data to Prakasa AI and is registered as a route', () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, '../src/pages/it/Infrastructure.jsx'), 'utf8');
  assert.doesNotMatch(page, /usePublishPrakasaAIContext/);
  const app = fs.readFileSync(path.join(import.meta.dirname, '../src/App.jsx'), 'utf8');
  assert.match(app, /path="it\/infrastructure" element=\{<Infrastructure \/>\}/);
  const nav = fs.readFileSync(path.join(import.meta.dirname, '../src/components/navigation.js'), 'utf8');
  assert.match(nav, /\{ to: '\/it\/infrastructure', label: 'Infrastruktur IT', symbol: 'lan', permission: 'it\.infra\.view' \}/);
});
