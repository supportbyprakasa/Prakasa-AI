const test = require('node:test');
const assert = require('node:assert/strict');
const { transactionSource, guardTransactions } = require('../src/services/salesSource');
const simplidots = require('../src/services/simplidotsImport.service');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('transactions default to Accurate; only an explicit "app" brings input back', (t) => {
  const saved = process.env.SALES_TRANSACTION_SOURCE;
  t.after(() => { if (saved === undefined) delete process.env.SALES_TRANSACTION_SOURCE; else process.env.SALES_TRANSACTION_SOURCE = saved; });
  delete process.env.SALES_TRANSACTION_SOURCE;
  assert.equal(transactionSource(), 'accurate');
  process.env.SALES_TRANSACTION_SOURCE = 'salah-ketik';
  assert.equal(transactionSource(), 'accurate', 'an unknown value never silently reopens input');
  process.env.SALES_TRANSACTION_SOURCE = 'app';
  assert.equal(transactionSource(), 'app');
});

test('the guard refuses transaction writes in Accurate mode and passes them in app mode', (t) => {
  const saved = process.env.SALES_TRANSACTION_SOURCE;
  t.after(() => { if (saved === undefined) delete process.env.SALES_TRANSACTION_SOURCE; else process.env.SALES_TRANSACTION_SOURCE = saved; });
  process.env.SALES_TRANSACTION_SOURCE = 'accurate';
  const res = responseDouble();
  let passed = false;
  guardTransactions({}, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SOURCE_ACCURATE');

  process.env.SALES_TRANSACTION_SOURCE = 'app';
  guardTransactions({}, responseDouble(), () => { passed = true; });
  assert.equal(passed, true);
});

// ------------------------------------------------------------------ parser

const VISIT_HEAD = ['EmployeeCode', 'EmployeeName', 'Role', 'Date', 'Planned', 'UnPlaned', 'Visited', 'GeoMismatch',
  'Mismatch', 'CustomerCode', 'CustomerName', 'CustomerAddress', 'Area', 'CustomerLatitude', 'CustomerLongitude',
  'CheckInTime', 'CheckOutTime', 'DistanceInMeter', 'CheckInLatitude', 'CheckInLongitude', 'CheckOutLatitude',
  'CheckOutLongitude', 'Pseq', 'Aseq', 'TotalSalesOrder', 'TotalSalesCanvass', 'TotalSales', 'Notes', null,
  'Checklist', 'Duration', 'Unvisited', 'TargetCall', 'EffCall', 'ImageUrls'];

const visitRow = [
  'EMP-1', 'Fajar', 'Salesman', '2026-09-14', 0, 10, 10, 0, 'False', 'CS-1', 'Kafe Uji', 'Jl. Uji 2', 'Tangerang',
  -6.2008, 106.6555, '15:14', '15:23', 9.9, -6.2, 106.6, -6.2, 106.6, 2, 3, 0, 0, 0, null,
  'Owner belum ada', true, '00:08', 0, 0, 0, 'https://example.test/a.jpg',
];
// The older export layout has no Area: everything from Area on sits one cell left.
const shiftedRow = [
  'EMP-1', 'Fajar', 'Salesman', '2026-09-15', 0, 9, 9, 2, 'True', 'CS-2', 'Toko Geser', 'Jl. Uji 3',
  -6.3078, 106.6535, new Date('1899-12-30T15:23:00Z'), new Date('1899-12-30T15:26:00Z'), 10.5, -6.3, 106.6, -6.3, 106.6,
  0, 6, 0, 0, 0, null, 'Coba lagi minggu depan', new Date('1899-12-30T00:03:00Z'), false, 0, 0, null, null,
];

test('a SimpliDOTS row maps to a lead visit with times, duration and flags', () => {
  const { visits } = simplidots.parseVisits(simplidots.visitRowsFromSheet([VISIT_HEAD, visitRow, []]));
  assert.equal(visits.length, 1);
  assert.deepEqual(visits[0], {
    externalKey: 'EMP-1|2026-09-14|CS-1', salesPersonName: 'Fajar', visitDate: '2026-09-14',
    outletCode: 'CS-1', outletName: 'Kafe Uji', address: 'Jl. Uji 2', area: 'Tangerang',
    latitude: -6.2008, longitude: 106.6555, checkInAt: '2026-09-14 15:14:00', checkOutAt: '2026-09-14 15:23:00',
    durationMinutes: 8, isPlanned: true, isVisited: true, geoMismatch: false, distanceM: 10, totalSales: 0,
    note: 'Owner belum ada', images: ['https://example.test/a.jpg'],
  });
});

test('a row from the older layout without Area is shifted back into place', () => {
  assert.equal(simplidots.realignVisitRow(VISIT_HEAD, visitRow), visitRow, 'an aligned row is left alone');
  const [visit] = simplidots.parseVisits(simplidots.visitRowsFromSheet([VISIT_HEAD, shiftedRow])).visits;
  assert.equal(visit.area, null);
  assert.equal(visit.latitude, -6.3078);
  assert.equal(visit.checkInAt, '2026-09-15 15:23:00');
  assert.equal(visit.durationMinutes, 3);
  assert.equal(visit.geoMismatch, true);
  assert.equal(visit.isPlanned, false, 'Pseq 0 is an unplanned stop');
  assert.equal(visit.note, 'Coba lagi minggu depan');
});

test('the same visit twice is one visit; incomplete rows are skipped; wrong files are refused', () => {
  const incomplete = [...visitRow];
  incomplete[9] = null;
  const { visits, warnings } = simplidots.parseVisits(simplidots.visitRowsFromSheet([VISIT_HEAD, visitRow, visitRow, incomplete]));
  assert.equal(visits.length, 1);
  assert.match(warnings[0], /1 baris/);
  assert.throws(() => simplidots.parseVisits([{ Nama: 'x' }]), /EmployeeCode/);
  assert.throws(() => simplidots.parseVisits([]), /kosong/);
});

test('every write of an import stays inside the caller\'s entity', async () => {
  const calls = [];
  const db = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (/FROM departments/.test(sql)) return [[{ id: 5 }]];
      if (/SELECT id, outlet_code FROM sales_leads/.test(sql)) return [[{ id: 70, outlet_code: 'CS-1' }]];
      if (/COUNT\(\*\) AS n FROM sales_visit_reports/.test(sql)) return [[{ n: 0 }]];
      if (/^\s*SELECT/.test(sql)) return [[]];
      return [{ affectedRows: 0 }];
    },
  };
  const parsed = simplidots.parseVisits(simplidots.visitRowsFromSheet([VISIT_HEAD, visitRow]));
  const stats = await simplidots.applyImport(db, 1, parsed, { triggeredBy: 15 });
  assert.deepEqual(stats, { visits: 1, newVisits: 1, updatedVisits: 0, outlets: 1, leadsLinked: 0 });
  for (const { sql, args } of calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/.test(c.sql))) {
    const flat = JSON.stringify(args);
    assert.ok(/INSERT INTO/.test(sql) ? flat.startsWith('[[[1,') || /INSERT IGNORE INTO sales_owner_links/.test(sql) : args.includes(1), sql.split('\n')[0]);
  }
  const visitInsert = calls.find((c) => /INSERT INTO sales_visit_reports/.test(c.sql));
  assert.match(visitInsert.sql, /ON DUPLICATE KEY UPDATE/, 're-uploading the same export updates, never duplicates');
});
