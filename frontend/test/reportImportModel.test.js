import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySummary, bodyTooLarge, canUpdate, cellValue, companyCodeError, companyOptions, filterRows, findHeaderRow,
  ignoredColumnsNotes, importBody, importHolderText, isCredentialHeader, keepValidUpdates, pickSheet, prepareSheet,
  previewSummary, sheetProblem, updatableKeys, worstLevel, MAX_COLUMNS,
} from '../src/pages/it/reportImportModel.js';

// People & Culture wave 1, rule 18 / API contract §4 — the browser side of the
// IT report import. Synthetic data only (never the owner's file).

const DEVICE_HEADER = ['No', 'Device Type', 'Brand / Model', 'Serial Number', 'Asset No.', 'Purchase Year', 'User Name', 'Location', 'Company', 'Status', 'Notes'];

test('credential columns are recognised; "User Name" (the holder) is not', () => {
  for (const h of ['WiFi Password', 'password', 'Kata Sandi', 'Username', 'Admin username', 'Credential', 'Router credentials']) assert.equal(isCredentialHeader(h), true, h);
  for (const h of ['User Name', 'Employee Name', 'Status', 'Notes', null]) assert.equal(isCredentialHeader(h), false, String(h));
});

test('prepareSheet drops password / sandi / username / credential columns from every row, keeps User Name', () => {
  const raw = [
    ['IT Device Inventory', null, null],
    [...DEVICE_HEADER, 'WiFi Password', 'Username', 'Kata sandi admin'],
    [1, 'Laptop', 'IdeaPad', 'SN1', null, 2024, 'Ani Wijaya', 'PFN Office', 'PFN', 'Active', null, 'rahasia-1', 'ani', 'rahasia-2'],
    [2, 'Router', 'TP-Link', 'SN2', null, 2023, 'Ops Team', 'PFN Office', 'PFN', 'Active', null, 'rahasia-3', 'admin', 'rahasia-4'],
  ];
  const out = prepareSheet(raw, 'devices');
  assert.equal(out.headerFound, true);
  assert.deepEqual(out.credentialColumns, ['WiFi Password', 'Username', 'Kata sandi admin']);
  assert.deepEqual(out.matrix[1], DEVICE_HEADER, 'header without the credential columns');
  assert.deepEqual(out.matrix[2], [1, 'Laptop', 'IdeaPad', 'SN1', null, 2024, 'Ani Wijaya', 'PFN Office', 'PFN', 'Active'], 'trailing empty Notes cut');
  const text = JSON.stringify(out.matrix);
  for (const secret of ['rahasia', '"ani"', '"admin"']) assert.equal(text.includes(secret), false, `${secret} never leaves the browser`);
  assert.ok(text.includes('User Name') && text.includes('Ani Wijaya'), 'the holder column stays');
});

test('without a header row, credential words in the first rows still drop the column', () => {
  const out = prepareSheet([['Nama', 'Password'], ['A', 'x1']], 'devices');
  assert.equal(out.headerFound, false);
  assert.deepEqual(out.matrix, [['Nama'], ['A']]);
});

test('cells travel as JSON can carry them; trailing empty rows/columns are cut, blank rows inside kept', () => {
  assert.equal(cellValue(new Date('2024-05-01T00:00:00Z')), '2024-05-01T00:00:00.000Z');
  assert.equal(cellValue('  PFN  '), 'PFN');
  assert.equal(cellValue(''), null);
  assert.equal(cellValue(undefined), null);
  assert.equal(cellValue(Number.NaN), null);
  assert.equal(cellValue('x'.repeat(1200)).length, 1000);
  const out = prepareSheet([DEVICE_HEADER, [1, 'Laptop', null, '', null], [null, ''], [2, 'PC'], [null, null], ['', '']], 'devices');
  assert.deepEqual(out.matrix.slice(1), [[1, 'Laptop'], [], [2, 'PC']]);
  assert.equal(out.rowCount, 4);
  const wide = prepareSheet([Array.from({ length: 90 }, (_, i) => `C${i}`)], 'devices');
  assert.equal(wide.matrix[0].length, MAX_COLUMNS);
  assert.equal(wide.columnsCut, 10);
});

test('sheets are found by name (hidden "User List" included); header row found under title rows', () => {
  const names = ['Summary', 'Device Inventory', 'WiFi', 'User List'];
  assert.equal(pickSheet(names, 'devices'), 'Device Inventory');
  assert.equal(pickSheet(names, 'people'), 'User List');
  assert.equal(pickSheet(['device inventory 2026'], 'devices'), 'device inventory 2026');
  assert.equal(pickSheet(['Data'], 'people'), '');
  assert.equal(findHeaderRow([['Judul'], [], ['no', 'device  type', 'COMPANY', 'status']], 'devices'), 2);
  assert.equal(findHeaderRow([['No', 'Employee Name', 'Entity', 'Status', 'Email']], 'people'), 0);
  assert.equal(findHeaderRow([['No', 'Device Type']], 'devices'), -1);
  assert.equal(sheetProblem(prepareSheet([], 'devices'), 'Device Inventory'), 'Sheet "Device Inventory" kosong.');
  assert.equal(sheetProblem(prepareSheet([DEVICE_HEADER], 'devices'), 'Device Inventory'), null);
  assert.equal(bodyTooLarge({ devices: [['x'.repeat(900)]] }), false);
  assert.equal(bodyTooLarge({ devices: Array.from({ length: 1200 }, () => ['x'.repeat(900)]) }), true);
});

test('request body: preview, then apply with the confirmed code, fingerprint and ticked updates', () => {
  const devices = [DEVICE_HEADER];
  const people = [['No', 'Employee Name', 'Entity', 'Status']];
  assert.deepEqual(importBody({ kind: 'devices', devices, createLocations: false }), { devices, createLocations: false });
  assert.deepEqual(importBody({ kind: 'devices', devices, people, createLocations: true, personChoices: { 'p:4': 'new' } }),
    { devices, people, createLocations: true, personChoices: { 'p:4': 'new' } });
  assert.deepEqual(importBody({ kind: 'people', people, devices, apply: { companyCode: 'PFN', fingerprint: 'f'.repeat(64), updates: ['p:7'] } }),
    { people, companyCode: 'PFN', fingerprint: 'f'.repeat(64), updates: ['p:7'] });
  assert.deepEqual(importBody({ kind: 'devices', devices, apply: { companyCode: 'PFN', fingerprint: 'a', updates: [] } }),
    { devices, createLocations: false, companyCode: 'PFN', fingerprint: 'a' });
});

const PREVIEW = {
  companyCode: 'PFN',
  fingerprint: 'f'.repeat(64),
  createLocations: false,
  newLocations: ['Alsut Office'],
  counts: {
    devices: { rows: 3, new: 1, exists: 1, updatable: 1, skipped: 1, byStatus: { assigned: 1, damaged: 1 }, holders: { user: 1, label: 1 },
      holderResigned: 1, withoutSerial: 1, sharedAssetCodes: [{ assetCode: 'LAP/1', rows: [3, 4] }], summaryRowsSkipped: 5, emptyRowsSkipped: 1,
      missingCompany: 0, otherCompany: { IGS: 19, PMK: 12 } },
    people: { rows: 2, new: 1, link: 1, exists: 0, updatable: 0, skipped: 0, nameOnly: 1, resigned: 1, emailsDropped: 1, missingCompany: 0, otherCompany: { D77: 5 } },
  },
  sheets: { devices: { credentialColumnsIgnored: ['WiFi Password'], otherColumnsIgnored: ['Keterangan lain'] }, people: { credentialColumnsIgnored: [], otherColumnsIgnored: [] } },
  devices: [
    { key: 'd:3', rowNumber: 3, action: 'new', deviceType: 'laptop', status: 'assigned', holder: { kind: 'user', userId: 30, name: 'Ani Wijaya' }, holderText: 'Ani Wijaya', differences: [], issues: [{ level: 'warning', code: 'ASSET_CODE_SHARED', message: 'Nomor aset LAP/1 dipakai 2 perangkat' }] },
    { key: 'd:4', rowNumber: 4, action: 'exists', deviceType: 'monitor', status: 'damaged', holder: null, holderText: 'Budi', differences: [{ field: 'status', label: 'Status', current: 'Aktif', incoming: 'Rusak' }], issues: [{ level: 'info', code: 'HOLDER_IGNORED', message: 'Rusak: pemakai "Budi" dicatat di catatan' }] },
    { key: 'd:5', rowNumber: 5, action: 'skip', deviceType: null, reportType: '', differences: [], issues: [{ level: 'error', code: 'TYPE_MISSING', message: 'Tipe perangkat kosong' }] },
  ],
  people: [],
};

test('preview rows: filters, "Perbarui" only for existing rows with differences, stale ticks dropped', () => {
  assert.deepEqual(filterRows(PREVIEW.devices, 'new').map((r) => r.key), ['d:3']);
  assert.deepEqual(filterRows(PREVIEW.devices, 'issues').map((r) => r.key), ['d:3', 'd:5'], 'info notes alone are not "Ada catatan"');
  assert.equal(filterRows(PREVIEW.devices, 'all').length, 3);
  assert.equal(canUpdate(PREVIEW.devices[1]), true);
  assert.equal(canUpdate(PREVIEW.devices[0]), false);
  assert.deepEqual(updatableKeys(PREVIEW.devices), ['d:4']);
  assert.deepEqual(keepValidUpdates(['d:4', 'd:3', 'p:9'], PREVIEW.devices), ['d:4']);
  assert.equal(worstLevel(PREVIEW.devices[2].issues), 'error');
  assert.equal(worstLevel([{ level: 'info' }, { level: 'warning' }]), 'warning');
  assert.equal(worstLevel([]), '');
  assert.equal(importHolderText(PREVIEW.devices[0]), 'Ani Wijaya · Akun aplikasi');
  assert.equal(importHolderText(PREVIEW.devices[1]), 'Budi (dicatat di catatan)');
});

test('company code: only the account\'s company can be applied; other codes in the file are listed', () => {
  assert.deepEqual(companyOptions(PREVIEW).map((o) => o.value), ['PFN', 'IGS', 'PMK', 'D77']);
  assert.equal(companyOptions(PREVIEW)[0].label, 'PFN (perusahaan akun Anda)');
  assert.equal(companyCodeError('PFN', PREVIEW), '');
  assert.equal(companyCodeError('IGS', PREVIEW), 'Impor hanya untuk baris perusahaan PFN (perusahaan akun Anda).');
  assert.equal(companyCodeError('', PREVIEW), 'Pilih kode perusahaan.');
});

test('summaries read in Indonesian: preview counts, ignored columns, apply result', () => {
  const lines = Object.fromEntries(previewSummary(PREVIEW).map((l) => [l.label, l.value]));
  assert.equal(lines['Perangkat di file (perusahaan ini)'], '3 baris — 1 baru, 1 sudah ada, 1 dilewati');
  assert.equal(lines['Per status'], 'Aktif 1, Rusak 1');
  assert.equal(lines['Perangkat perusahaan lain (tidak diimpor)'], 'IGS 19, PMK 12');
  assert.equal(lines['Baris ringkasan/kosong dilewati'], '6');
  assert.equal(lines['Lokasi belum ada'], 'Alsut Office');
  assert.equal(lines['Berstatus resign'], '1 (tanggal resign = tanggal impor)');
  const notes = ignoredColumnsNotes(PREVIEW, { devices: ['WiFi Password', 'Username'] });
  assert.match(notes[0], /"WiFi Password", "Username" tidak dibaca dan tidak dikirim/);
  assert.match(notes[1], /Keterangan lain/);
  const result = Object.fromEntries(applySummary({ locationsCreated: 2, peopleCreated: 11, peopleLinked: 16, peopleUpdated: 0, devicesCreated: 69, devicesUpdated: 0, assignmentsCreated: 57, unchanged: 0, skipped: 0 }).map((l) => [l.label, l.value]));
  assert.equal(result['Perangkat baru'], '69');
  assert.equal(result['Penugasan dibuat (perangkat Aktif)'], '57');
  assert.equal(result['Lokasi baru'], '2');
});

test('a directory import summary has no device or location lines', () => {
  const labels = applySummary({ locationsCreated: 0, peopleCreated: 11, peopleLinked: 16, peopleUpdated: 0, devicesCreated: 0, devicesUpdated: 0, assignmentsCreated: 0, unchanged: 0, skipped: 1 }, 'people').map((l) => l.label);
  assert.deepEqual(labels, ['Orang baru di direktori', 'Akun ditautkan ke direktori', 'Orang diperbarui', 'Tidak berubah', 'Dilewati']);
});
