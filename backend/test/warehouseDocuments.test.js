const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const docs = require('../src/services/warehouseDocuments.service');

// Warehouse documents from approved Accurate data: read-only, the user's own
// company, quantities only, and the delivery address only on one document.

function fakeDb(t, rows = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS n FROM wh_documents_accurate d WHERE d\.entity_id = \? AND d\.doc_type = \? AND d\.trans_date/.test(sql)) {
      return [[{ n: (rows.docs || []).filter((d) => d.doc_type === args[1]).length + (args[1] === 'delivery' ? 60 : 0) }]];
    }
    if (/COUNT\(\*\) AS n FROM wh_documents_accurate d/.test(sql)) return [[{ n: 1 }]];
    if (/GROUP BY doc_type/.test(sql)) return [[{ doc_type: 'delivery', n: 68 }, { doc_type: 'adjustment', n: 115 }]];
    if (/AS in_transit/.test(sql)) return [[{ today: '2026-09-30', in_transit: 3, stuck: 1, minus: 138 }]];
    if (/d\.doc_type = \? AND d\.trans_date = DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) ORDER BY/.test(sql)) return [(rows.docs || []).filter((d) => d.doc_type === args[1])];
    if (/^\s*SELECT line_no/.test(sql)) return [rows.lines || []];
    if (/FROM wh_documents_accurate d/.test(sql)) return [rows.docs || []];
    return [[]];
  });
  return calls;
}
const writes = (calls) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
const DO = { id: 74, doc_type: 'delivery', number: 'DO1', trans_date: '2026-09-29', status: 'Difaktur', party: 'Toko Satu', channel: 'GT', so_numbers: '["SO1"]', po_numbers: null, line_count: 1, customer_no: 'PFN-PR-GT-TGR-0001', unit_cost: 5 };

test('document lists are bound to the company and never carry an address', async (t) => {
  const calls = fakeDb(t, { docs: [DO] });
  const r = await docs.listDocuments(1, { type: 'delivery', q: 'toko', warehouse: 'WH A', from: '2026-09-01', to: 'bukan-tanggal' });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].destination, undefined, 'no destination in a list');
  assert.equal(r.items[0].unit_cost, undefined);
  assert.deepEqual(r.items[0].soNumbers, ['SO1']);
  assert.deepEqual(r.counts, { delivery: 68, receipt: 0, transfer: 0, adjustment: 115 });
  const q = calls.find((c) => /ORDER BY d\.trans_date DESC/.test(c.sql));
  assert.doesNotMatch(q.sql, /ship_to|customer_no/);
  assert.deepEqual(q.args.slice(0, 3), [1, 'delivery', '2026-09-01'], 'an invalid date is ignored');
  assert.ok(q.args.includes('WH A'));
  assert.deepEqual(writes(calls), []);
  const unknown = fakeDb(t);
  await docs.listDocuments(1, { type: 'payroll' });
  assert.equal(unknown.find((c) => /ORDER BY/.test(c.sql)).args[1], 'delivery', 'an unknown type falls back, it never reads another table');
});

test('one delivery shows where it goes as the city in the customer number — never an address', async (t) => {
  fakeDb(t, { docs: [DO], lines: [{ line_no: 1, item_no: 'A', item_name: 'Oat', qty: '2.0000', unit: 'Ctns', unit_ratio: '6.0000', warehouse: 'WH A', reference: 'SO1' }] });
  const d = await docs.getDocument(1, 'delivery', 74);
  assert.deepEqual(d.destination, { code: 'TGR', name: 'Tangerang' });
  assert.equal(d.shipTo, undefined);
  assert.deepEqual(d.lines[0], { lineNo: 1, itemNo: 'A', itemName: 'Oat', qty: 2, unit: 'Ctns', unitRatio: 6, warehouse: 'WH A', direction: null, receivedQty: null, reference: 'SO1' });
  t.mock.restoreAll();
  fakeDb(t, { docs: [{ ...DO, doc_type: 'receipt' }] });
  assert.equal((await docs.getDocument(1, 'receipt', 74)).destination, null);
  assert.equal(await docs.getDocument(1, 'gaji', 74), null);
});

test('the day view: what ships and arrives today, and transfers stuck in transit', async (t) => {
  const calls = fakeDb(t, { docs: [DO, { ...DO, id: 73, doc_type: 'receipt', number: 'RI1' }] });
  const day = await docs.today(1);
  assert.equal(day.date, '2026-09-30');
  assert.deepEqual(day.deliveries.map((d) => d.number), ['DO1']);
  assert.deepEqual(day.receipts.map((d) => d.number), ['RI1']);
  assert.deepEqual(day.attention, { inTransit: 3, stuckTransfers: 1, stockMinus: 138, soDue: 0 });
  assert.deepEqual(day.totals, { deliveries: 61, receipts: 1 }, 'real counts per kind, beyond what is listed');
  assert.ok(calls.some((c) => /d\.doc_type = \? AND d\.trans_date = DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) ORDER BY d\.number LIMIT 50/.test(c.sql)), 'each kind its own limit');
  assert.match(calls.find((c) => /AS in_transit/.test(c.sql)).sql, new RegExp(`INTERVAL ${docs.TRANSFER_STUCK_DAYS} DAY`));
});
