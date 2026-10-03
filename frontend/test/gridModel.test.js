import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportMatrix,
  fieldErrorsFromApi,
  parseCsv,
  payloadFromValues,
  rowsFromImportMatrix,
  toCsv,
  validateValues,
} from '../src/components/datagrid/gridModel.js';

const columns = [
  { key: 'id', header: 'ID', editable: false },
  { key: 'name', header: 'Nama', required: true },
  { key: 'email', header: 'Email', type: 'email' },
  { key: 'seats', header: 'Kursi', type: 'number' },
  {
    key: 'entityId',
    header: 'Entity',
    type: 'select',
    required: true,
    options: [{ value: 1, label: 'Prakasa Group' }, { value: 2, label: 'Prakasa Foods' }],
  },
];

test('validation reports required, email, number, and select errors per field', () => {
  assert.deepEqual(validateValues(columns, {
    name: '  ', email: 'bukan-email', seats: 'dua', entityId: 9,
  }), {
    name: 'Nama wajib diisi',
    email: 'Format email tidak valid',
    seats: 'Kursi harus berupa angka',
    entityId: 'Pilihan Entity tidak dikenal',
  });
  assert.deepEqual(validateValues(columns, {
    name: 'Gudang', email: '', seats: '', entityId: '1',
  }), {});
});

test('custom column validators run after built-in checks', () => {
  const cols = [{ key: 'code', header: 'Kode', validate: (v) => (v.length > 3 ? 'Maksimal 3 huruf' : undefined) }];
  assert.deepEqual(validateValues(cols, { code: 'ABCD' }), { code: 'Maksimal 3 huruf' });
});

test('payload only contains editable columns converted to API types', () => {
  assert.deepEqual(payloadFromValues(columns, {
    id: 5, name: ' Gudang ', email: '', seats: '12', entityId: '2', extra: 'x',
  }), { name: 'Gudang', email: null, seats: 12, entityId: 2 });
});

test('export uses option labels and exportValue, not React elements', () => {
  const cols = [
    ...columns.slice(0, 2),
    columns[4],
    { key: 'status', header: 'Status', exportValue: (row) => (row.active ? 'Aktif' : 'Nonaktif') },
  ];
  assert.deepEqual(exportMatrix(cols, [{ id: 1, name: 'A', entityId: 2, active: true }]), [
    ['ID', 'Nama', 'Entity', 'Status'],
    [1, 'A', 'Prakasa Foods', 'Aktif'],
  ]);
});

test('csv output escapes quotes, delimiters, newlines and neutralizes formula injection', () => {
  const csv = toCsv([['Nama', 'Catatan'], ['PT "Maju", Tbk', 'baris1\nbaris2'], ['=HYPERLINK("x")', '-5+1']]);
  assert.equal(csv, '﻿Nama,Catatan\r\n"PT ""Maju"", Tbk","baris1\nbaris2"\r\n"\'=HYPERLINK(""x"")",\'-5+1\r\n');
});

test('negative numbers stay numeric in csv', () => {
  assert.equal(toCsv([['n'], [-5]]), '﻿n\r\n-5\r\n');
});

test('csv parser handles BOM, quotes, CRLF, and semicolon delimiters', () => {
  assert.deepEqual(parseCsv('﻿Nama,Catatan\r\n"PT ""Maju"", Tbk","a\nb"\r\n'), [
    ['Nama', 'Catatan'],
    ['PT "Maju", Tbk', 'a\nb'],
  ]);
  assert.deepEqual(parseCsv('Nama;Entity\nGudang;Prakasa Group\n'), [
    ['Nama', 'Entity'],
    ['Gudang', 'Prakasa Group'],
  ]);
});

test('import maps headers by label or key, resolves option labels, and reports row errors', () => {
  const result = rowsFromImportMatrix(columns, [
    ['nama', 'ENTITY', 'Email', 'Tidak dikenal'],
    ['Gudang', 'Prakasa Foods', 'gudang@prakasa.co', 'x'],
    ['', 'Entah', 'salah', ''],
    ['', '', '', ''],
  ]);
  assert.deepEqual(result.unknownHeaders, ['Tidak dikenal']);
  assert.deepEqual(result.missingRequiredHeaders, []);
  assert.deepEqual(result.rows, [
    { rowNumber: 2, values: { name: 'Gudang', entityId: 2, email: 'gudang@prakasa.co' }, errors: {} },
    {
      rowNumber: 3,
      values: { name: '', entityId: 'Entah', email: 'salah' },
      errors: { name: 'Nama wajib diisi', entityId: 'Pilihan Entity tidak dikenal', email: 'Format email tidak valid' },
    },
  ]);
});

test('import reports required columns missing from the file header', () => {
  const result = rowsFromImportMatrix(columns, [['Email'], ['a@b.co']]);
  assert.deepEqual(result.missingRequiredHeaders, ['Nama', 'Entity']);
});

test('api validation details map back onto grid fields', () => {
  assert.deepEqual(fieldErrorsFromApi({
    response: { data: { error: { details: { fieldErrors: { name: ['Terlalu panjang'], other: [] } } } } },
  }), { name: 'Terlalu panjang' });
  assert.deepEqual(fieldErrorsFromApi(new Error('network')), {});
});

test('export writes dates in local, spreadsheet-friendly form', () => {
  const cols = [
    { key: 'd', header: 'Tanggal', type: 'date' },
    { key: 't', header: 'Waktu', type: 'datetime' },
  ];
  const at = new Date(2026, 8, 24, 7, 5);
  assert.deepEqual(exportMatrix(cols, [{ d: '2026-09-24', t: at.toISOString() }])[1], ['2026-09-24', '2026-09-24 07:05']);
  assert.deepEqual(exportMatrix(cols, [{ d: null, t: 'bukan tanggal' }])[1], ['', 'bukan tanggal']);
});

test('F04: the export menu says what the file holds', async () => {
  const { exportScope } = await import('../src/components/datagrid/gridModel.js');
  // 45 rows, 20 per page, no export-all: the file has the 20 on this page.
  assert.equal(exportScope({ manual: true, pageRows: 20, total: 45 }), 'Hanya halaman ini: 20 baris dari 45');
  // A page that exports every match from its API.
  assert.equal(exportScope({ exportAll: true, manual: true, total: 45 }), 'Semua hasil sesuai filter (45 baris)');
  // Rows loaded in the browser, after search and filters.
  assert.equal(exportScope({ filteredRows: 12 }), 'Semua hasil terfilter: 12 baris');
  assert.equal(exportScope({ filteredRows: 5000, truncated: true }), '5.000 baris yang dimuat (daftar terpotong)');
  // A list that is itself limited says so.
  assert.equal(exportScope({ filteredRows: 20, note: '20 produk terlaris' }), 'Semua hasil terfilter: 20 baris · 20 produk terlaris');
});
