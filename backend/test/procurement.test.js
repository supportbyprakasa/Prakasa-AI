const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const connection = require('../src/services/accurate/accurateConnection.service');
const batches = require('../src/services/salesAccurateBatches.service');
const sync = require('../src/services/accurate/accurateSync.service');
const pc = require('../src/services/accurate/procurementCollector');
const { stateOf } = require('../src/services/accurate/procurementPull');
const orders = require('../src/services/procurementOrders.service');
const vendors = require('../src/services/procurementVendors.service');
const prices = require('../src/services/procurementPrices.service');
const provider = require('../src/management/providers/procurement');
const rules = require('../src/services/procurementRules');

// Procurement stage 1 (program 2.1): vendors (list only) and POs from Accurate,
// read-only; prices only for price viewers (P1); no vendor personal data.

process.env.ACCURATE_SYNC_DELAY_MS = '0';

const VENDOR = { id: 5, vendorNo: 'V-001', name: 'PT Pemasok Susu', category: { name: 'Dairy' }, suspended: false, lookupSubText: 'Jl. Rahasia 1 · 0812-3456-7890', vendorBranchName: 'Pusat' };
const PO_LIST = { id: 1550, number: 'PO.2026.09.00012', transDate: '24/09/2026', statusName: 'Menunggu diproses', approvalStatus: 'APPROVED', percentShipped: 0, shipDate: '24/09/2026', vendor: { vendorNo: 'V-001', name: 'PT Pemasok Susu' }, lastUpdate: 'L1' };
const PO_DETAIL = {
  number: 'PO.2026.09.00012', transDate: '24/09/2026', shipDate: '24/09/2026', percentShipped: 0, manualClosed: false, totalAmount: 1110000, tax1Amount: 110000, subTotal: 1000000,
  paymentTerm: { name: 'Net 30', netDays: 30 }, currency: { code: 'IDR' },
  vendor: { vendorNo: 'V-001', name: 'PT Pemasok Susu', npwpNo: '01.234.567.8-901.000', idCard: '3171234567890001', vendorBankList: [{ bankAccount: '1234567890' }] },
  detailItem: [{ item: { no: 'DAI-OAT', name: 'Oatside' }, quantity: 10, itemUnit: { name: 'Ctns' }, unitRatio: 6, shipQuantity: 0, remainingQuantity: 10, returnQuantity: 0, closed: false,
    warehouse: { name: 'WH A' }, purchaseRequisitionId: 0, unitPrice: 100000, itemDiscPercent: 0, totalPrice: 1000000, itemCost: 99999, detailNotes: 'catatan' }],
  description: 'hubungi 0812 9999 8888',
};

test('a vendor keeps its number, name, category and status — never the list\'s lookup line', () => {
  assert.deepEqual(pc.vendorRow(VENDOR), { number: 'V-001', name: 'PT Pemasok Susu', status: 'Aktif', data: { category: 'Dairy' } });
  assert.equal(pc.cleanText('CV Maju 0812-3456-7890 maju@mail.com'), 'CV Maju');
  assert.equal(pc.cleanText('Toko 3171234567890001'), 'Toko');
  assert.equal(pc.cleanText('UD Sinar (BCA 1234567890 a.n. Budi)'), 'UD Sinar (BCA a.n. Budi)', 'a bank account number');
  assert.equal(pc.vendorRow({ vendorNo: 'V-9', name: '0812-3456-7890' }).name, 'V-9', 'a name that was only a phone number');
});

test('whatever the cleaner returns, the staging guard accepts — a name can never block a pull', () => {
  const { scanPersonal } = require('../src/services/accurate/procurementRecordTypes');
  const names = ['12345 0812-3456-7890 67890', 'PT Maju 1234567 - 12345678', 'CV A 021 5551234 / 0813 1111 2222', 'x@y.co 1234567890', 'Toko 99', 'PT (0811 222 333 444)'];
  for (const n of names) assert.equal(scanPersonal(pc.cleanText(n)), false, n);
});

test('a Procurement batch is decided by the Head (stand-in: Management Office Head), never a Supervisor alone', () => {
  assert.equal(batches.HEAD_ONLY_DIVISIONS.has('procurement'), true);
  assert.equal(batches.HEAD_ONLY_DIVISIONS.has('sales'), false);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/services/salesAccurateBatches.service.js'), 'utf8');
  assert.match(src, /SET s\.approver_role_id = am\.escalation_role_id/);
});

test('a PO keeps quantities, dates and its prices; never the vendor\'s tax, ID or bank data, costs or notes', () => {
  const row = pc.poRow(PO_LIST, PO_DETAIL);
  assert.equal(row.dpp_amount, 1000000, 'total − PPN');
  assert.equal(row.data.expected_date, '2026-09-24');
  assert.deepEqual(row.data.lines[0], {
    item_no: 'DAI-OAT', item_name: 'Oatside', qty: 10, unit: 'Ctns', unit_ratio: 6, received_qty: 0, remaining_qty: 10, returned_qty: 0, closed: false,
    warehouse: 'WH A', pr_id: null, unit_price: 100000, disc_pct: 0, line_total: 1000000,
  });
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.pc_po, row.data), []);
  assert.doesNotMatch(JSON.stringify(row), /npwp|idCard|3171234567890001|1234567890|bank|itemCost|99999|catatan|0812/i);
  assert.equal(pc.linesMatchSubtotal(PO_DETAIL), true);
});

test('a PO\'s state: late only past its date (plus one day) and only from LATE_FROM; older open POs are "PO lama"', () => {
  const row = (trans, expected, extra = {}) => ({ trans_date: trans, status: 'Menunggu diproses', data: { expected_date: expected, percent_received: 0, ...extra } });
  assert.equal(stateOf(row('2026-09-24', '2026-09-26'), '2026-09-29'), 'late');
  // Accurate's default Tgl kirim (= the PO date) is "not set": due 14 days after the PO (migration 098).
  assert.equal(stateOf(row('2026-09-24', '2026-09-24'), '2026-09-29'), 'open');
  assert.equal(stateOf(row('2026-09-24', '2026-09-20'), '2026-10-09'), 'open', 'fallback: due PO date + 14 days, one day of grace');
  assert.equal(stateOf(row('2026-09-24', '2026-09-20'), '2026-10-10'), 'late');
  assert.equal(stateOf(row('2026-09-24', '2026-09-28'), '2026-09-29'), 'open', 'one day of grace');
  assert.equal(stateOf(row('2026-08-01', '2026-08-02'), '2026-09-29'), 'legacy');
  assert.equal(stateOf(row('2026-09-24', null), '2026-09-29'), 'open', 'no Tgl kirim: due 14 days after the PO date');
  assert.equal(stateOf({ ...row('2026-09-24', '2026-09-24'), status: 'Terproses' }, '2026-09-29'), 'received');
  assert.equal(stateOf(row('2026-09-24', '2026-09-24', { closed: true }), '2026-09-29'), 'closed');
});

test('personal data that slipped into a name is refused at staging, without echoing it', async () => {
  for (const name of ['CV Maju 0812-3456-7890', 'Toko maju@mail.com', 'Ahmad 3171234567890001']) {
    const change = { recordType: 'pc_vendor', action: 'create', externalKey: '5', after: { number: 'V-001', name, status: 'Aktif', data: { category: null } } };
    await assert.rejects(() => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [change] }), (e) => {
      assert.equal(e.code, 'PERSONAL_DATA_FOUND');
      assert.equal(e.message.includes(name), false, 'the value is never echoed');
      return true;
    });
  }
});

function fakeProcurementAccurate({ detailFails = false } = {}) {
  const calls = [];
  const respond = (body, status = 200) => ({ status, ok: status < 400, headers: { get: () => null }, json: async () => body });
  const list = (rows) => respond({ s: true, d: rows, sp: { pageCount: 1, rowCount: rows.length } });
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    const u = new URL(url);
    if (u.pathname === '/api/open-db.do') return respond({ host: 'https://odin.accurate.id', session: 'sess' });
    if (u.pathname.endsWith('/vendor/list.do')) return list([VENDOR]);
    if (u.pathname.endsWith('/purchase-order/list.do')) return list([PO_LIST, { ...PO_LIST, id: 1551, number: 'PO-DRAFT', approvalStatus: 'UNAPPROVED', statusName: 'Diajukan' }]);
    if (u.pathname.endsWith('/purchase-order/detail.do')) return detailFails ? respond({ s: false, d: ['Tidak boleh'] }) : respond({ s: true, d: PO_DETAIL });
    if (/\/(purchase-requisition|purchase-return|vendor-claim|roll-over|vendor-price)\/list\.do$/.test(u.pathname)) return respond({ s: true, d: [], sp: { rowCount: 0 } });
    return respond({ s: false, d: ['unknown'] });
  };
  return { fetchImpl, calls };
}

function emptyMirror(t) {
  t.mock.method(connection, 'getAccessToken', async () => ({ accessToken: 'tok', dbId: 7 }));
  t.mock.method(pool, 'query', async () => [[]]);
}

test('the pull reads vendors from the list only (never their detail) and final POs with their detail', async (t) => {
  emptyMirror(t);
  const { fetchImpl, calls } = fakeProcurementAccurate();
  const { changes, checks } = await require('../src/services/accurate/procurementPull').collectProcurement(1, { fetchImpl });
  assert.ok(calls.every((c) => c.method === 'GET'));
  assert.ok(!calls.some((c) => /\/vendor\/detail\.do|\/vendor-category\/detail\.do/.test(c.url)), 'vendor detail never opened');
  assert.deepEqual(changes.map((c) => `${c.recordType}:${c.externalKey}:${c.action}`), ['pc_vendor:5:create', 'pc_po:1550:create'], 'the draft PO is not final');
  assert.equal(changes.find((c) => c.recordType === 'pc_po').amount, 1000000, 'the deciders see the PO value');
  assert.equal(checks.procurement.vendor_detail_calls, 0);
  assert.deepEqual(checks.procurement.lines_match_subtotal, { checked: 1, matched: 1 });
});

test('a PO Accurate will not show is left for the next pull; the rest goes on', async (t) => {
  emptyMirror(t);
  const { changes, checks } = await require('../src/services/accurate/procurementPull').collectProcurement(1, { fetchImpl: fakeProcurementAccurate({ detailFails: true }).fetchImpl });
  assert.deepEqual(changes.map((c) => c.recordType), ['pc_vendor']);
  assert.deepEqual(checks.procurement.unread_documents, { pc_po: 1 });
});

test('a real Procurement pull stays off until switched on; a dry run may read', async (t) => {
  delete process.env.ACCURATE_PROCUREMENT;
  await assert.rejects(() => sync.runSync({ entityId: 1, requestedBy: 2, scope: 'procurement' }), (e) => e.code === 'SCOPE_OFF');
  assert.deepEqual(sync.syncDivisions('procurement'), ['procurement']);
});

test('members never get a price key; price viewers get the value from the price views only', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 1, open: 1 }]];
    if (/FROM pc_po_prices_accurate WHERE entity_id = \? AND po_id IN/.test(sql)) return [[{ po_id: 1550, dpp_amount: '1000000.00' }]];
    if (/SELECT s\.\*/.test(sql)) return [[{ id: 1550, number: 'PO1', trans_date: '2026-09-24', display_state: 'late', days_late: 5, due_date_eff: '2026-09-24', expected_date: '2026-09-24', percent_received: '0', line_count: 1 }]];
    return [[]];
  });
  const member = await orders.listOrders(7, { state: 'late' }, { prices: false });
  assert.equal('value' in member.items[0], false);
  assert.ok(!calls.some((c) => /pc_po_price/.test(c.sql)), 'members never touch the price views');
  const viewer = await orders.listOrders(7, { state: 'late' }, { prices: true });
  assert.equal(viewer.items[0].value, 1000000);
  await assert.rejects(() => prices.orderValues(7, [1550], {}), (e) => e.status === 403);
  for (const { sql, args } of calls) {
    assert.match(sql, /entity_id = \?/);
    assert.ok(args.includes(7), sql);
  }
  const stated = calls.find((c) => /SELECT s\.\*/.test(c.sql));
  assert.equal(stated.args[0], rules.lateFrom(), 'LATE_FROM is the first bind (the state CASE comes first)');
  assert.equal(stated.args[1], 7);
});

test('the vendor list is company-bound and shows spend only to price viewers', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 1 }]];
    if (/SELECT g\.\*/.test(sql)) return [[{ id: 5, vendor_no: 'V-001', name: 'PT Pemasok Susu', status: 'Aktif', po_count: 2, open_count: 1, late_count: 1 }]];
    if (/SUM\(dpp_amount\) AS spend/.test(sql)) return [[{ vendor_no: 'V-001', spend: '2000000' }]];
    return [[]];
  });
  const member = await vendors.listVendors(7, {}, { prices: false });
  assert.equal('spend12m' in member.items[0], false);
  const viewer = await vendors.listVendors(7, {}, { prices: true });
  assert.equal(viewer.items[0].spend12m, 2000000);
  const grouped = calls.find((c) => /SELECT g\.\*/.test(c.sql));
  assert.deepEqual(grouped.args.slice(0, 3), [rules.lateFrom(), 7, 7]);
});

test('a late PO escalates as an episode of its promised date, and can be found again', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM pc_po_accurate p\s+LEFT JOIN departments/.test(sql)) {
      return [[{ id: 1550, number: 'PO1', vendor_name: 'PT Pemasok Susu', percent_received: '0', expected_date: '2026-09-24', department_id: 9, department_name: 'Procurement', due: '2026-09-24', days_late: 5, due_day: 9763 }]];
    }
    if (/SELECT entity_id, department_id FROM pc_po_accurate/.test(sql)) return [[{ entity_id: 1, department_id: 9 }]];
    return [[]];
  });
  const [item] = await provider.escalations[0].list(1, { departmentId: 9 });
  assert.equal(item.sourceId, 1550 * rules.EPISODE_FACTOR + 9763);
  assert.equal(item.daysLate, 5);
  assert.doesNotMatch(`${item.title} ${item.context}`, /Rp|\d{3}\.\d{3}/, 'no amounts in an escalation');
  assert.deepEqual(calls[0].args, [1, 9, rules.lateFrom()]);
  assert.deepEqual(await provider.escalations[0].locate(item.sourceId, { entityId: 1 }), { entityId: 1, departmentId: 9 });
  assert.deepEqual(calls[1].args, [1550, 1]);
});
