const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const connection = require('../src/services/accurate/accurateConnection.service');
const batches = require('../src/services/salesAccurateBatches.service');
const sync = require('../src/services/accurate/accurateSync.service');
const fc = require('../src/services/accurate/financeCollector');
const { FINANCE_TYPE_NAMES } = require('../src/services/accurate/financeRecordTypes');
const { READ_ENDPOINTS } = require('../src/services/accurate/accurateReadOnly');
const aging = require('../src/services/financeAging');
const { BUCKET_SQL } = require('../src/services/salesReceivables.service');
const receivables = require('../src/services/financeReceivables.service');
const payables = require('../src/services/financePayables.service');
const provider = require('../src/management/providers/financeLedger');
const { validateProvider } = require('../src/management/contract');

// Finance: piutang (from the Sales mirror) and utang (the read-only 'finance'
// pull: purchase invoices and payments only). No real Accurate or DB call here.

process.env.ACCURATE_SYNC_DELAY_MS = '0';

// ------------------------------------------------------------------ aging math

test('aging buckets: due today is not late; 30/60/90 days close their bucket; no due date is current', () => {
  const today = '2026-10-01';
  const cases = [
    [null, 'current'], ['2026-10-15', 'current'], ['2026-10-01', 'current'],
    ['2026-09-30', 'd1_30'], ['2026-09-01', 'd1_30'], ['2026-08-31', 'd31_60'],
    ['2026-08-02', 'd31_60'], ['2026-08-01', 'd61_90'], ['2026-07-03', 'd61_90'], ['2026-07-02', 'd90_plus'], ['2025-01-01', 'd90_plus'],
  ];
  for (const [due, bucket] of cases) assert.equal(aging.bucketOf(due, today), bucket, `${due}`);
  assert.deepEqual(aging.BUCKETS.map((b) => b.key), ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
});

test('the bucket SQL is exactly the Sales "Umur piutang" rule, so both pages agree', () => {
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(flat(aging.bucketSql('i.due_date')), flat(BUCKET_SQL));
});

test('aging rows add up per bucket, with shares, and per channel largest first', () => {
  const out = aging.agingFromRows([
    { group: 'GT', bucket: 'current', invoices: 2, amount: '100.00' },
    { group: 'GT', bucket: 'd90_plus', invoices: 1, amount: '300.00' },
    { group: 'MT', bucket: 'd1_30', invoices: '3', amount: 600 },
    { group: null, bucket: 'd1_30', invoices: 1, amount: 0 },
    { group: 'MT', bucket: 'bogus', invoices: 9, amount: 9 },
  ]);
  assert.deepEqual(out.total, { invoices: 7, amount: 1000 });
  assert.deepEqual(out.buckets.map((b) => [b.key, b.invoices, b.amount, b.share]), [
    ['current', 2, 100, 10], ['d1_30', 4, 600, 60], ['d31_60', 0, 0, 0], ['d61_90', 0, 0, 0], ['d90_plus', 1, 300, 30],
  ]);
  assert.deepEqual(out.groups.map((g) => [g.name, g.total.amount]), [['MT', 600], ['GT', 400], ['Lainnya', 0]]);
  assert.equal(out.groups[1].buckets.find((b) => b.key === 'd90_plus').share, 75);
});

test('12-month window crosses the year and fills empty months with 0; DSO needs billing', () => {
  assert.equal(aging.windowStart('2026-10-01'), '2025-11-01');
  assert.equal(aging.windowStart('2026-01-31'), '2025-02-01');
  const months = aging.fillMonths([{ month: '2026-01', amount: '12.5', count: 2 }], '2026-02-10');
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { month: '2025-03', amount: 0, count: 0 });
  assert.deepEqual(months[10], { month: '2026-01', amount: 12.5, count: 2 });
  assert.equal(months[11].month, '2026-02');
  assert.equal(aging.dso(1000, 3000, 90), 30);
  assert.equal(aging.dso(1000, 0), null);
});

// ------------------------------------------------------------------ piutang

function recording(t, answer = () => [[]]) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => { calls.push({ sql, args }); return answer(sql, args); });
  return calls;
}

test('piutang: company first, then the division in SQL; down payments left out', async (t) => {
  const calls = recording(t, () => [[{}]]);
  await receivables.summary(1, { departmentId: 5 });
  await receivables.aging(1, { departmentId: 5 });
  await receivables.customers(1, { departmentId: 5 });
  await receivables.dueSoon(1, { departmentId: 5 });
  await receivables.collections(1, { departmentId: 5, today: '2026-10-01' });
  assert.ok(calls.length >= 6);
  for (const c of calls) {
    assert.equal(c.args[0], 1, 'the company is bound first');
    assert.match(c.sql, /(i|r)\.department_id = \?/);
    assert.equal(c.args[1], 5, 'then the division');
  }
  for (const c of calls.filter((x) => /FROM sales_invoices_accurate i\s+WHERE[^]*outstanding_amount > 0/.test(x.sql))) assert.match(c.sql, /NOT i\.is_dp/);
  assert.ok(calls.some((c) => /FROM sales_receipts_accurate r/.test(c.sql) && c.args.includes('2025-11-01')), '12 months of receipts');
});

test('piutang for Finance is company-wide: no division filter when none is given', async (t) => {
  const calls = recording(t, () => [[{}]]);
  await receivables.summary(1);
  await receivables.aging(1);
  for (const c of calls) assert.doesNotMatch(c.sql, /department_id = \?/);
});

test('piutang overview: not ready until an approved Accurate invoice exists', async (t) => {
  const calls = recording(t, (sql) => (/AS live/.test(sql) ? [[{ live: 0, applied_at: null }]] : [[{}]]));
  const out = await receivables.overview(1);
  assert.deepEqual(out, { ready: false, reason: receivables.NOT_READY });
  assert.equal(calls.length, 1, 'nothing else is read');
});

test('piutang: top customers sorted by overdue amount, with the oldest days', async (t) => {
  recording(t, () => [[{ customer_code: 'GT-1', customer_name: 'Toko A', customer_id: 9, channel: 'GT', invoices: 3, outstanding: '300', overdue_invoices: 2, overdue_amount: '250', oldest_days: 45, oldest_due: new Date('2026-08-17T00:00:00Z') }]]);
  const [row] = await receivables.customers(1);
  assert.deepEqual(row, {
    customerCode: 'GT-1', customerName: 'Toko A', customerId: 9, channel: 'GT', salesPersonName: null,
    invoices: 3, outstanding: 300, overdueInvoices: 2, overdueAmount: 250, oldestDays: 45, oldestDue: '2026-08-17',
  });
});

// ------------------------------------------------------------------ utang

test('utang: every endpoint answers ready:false until the first Finance batch is approved — nothing else is read', async (t) => {
  const calls = recording(t, () => [[]]);
  for (const fn of ['summary', 'aging', 'vendors', 'dueSoon', 'overdue', 'payments', 'overview']) {
    const out = await payables[fn](1);
    assert.equal(out.ready, false, fn);
    assert.equal(out.reason, 'Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance', fn);
  }
  assert.ok(!calls.some((c) => /fin_purchase_/.test(c.sql)), 'no payables view is read before approval');
});

test('utang: once approved, rupiah only, no down payments, Finance-scoped in SQL', async (t) => {
  const calls = recording(t, (sql) => {
    if (/b\.status = 'applied'/.test(sql)) return [[{ id: 12, decided_at: '2026-10-01', decided_by: 'Head Finance' }]];
    if (/FROM fin_purchase_invoices_accurate p\s+WHERE p\.entity_id = \?(?! AND p\.department)[^]*non_idr/.test(sql) || /non_idr/.test(sql)) {
      return [[{ invoices: 4, vendors: 2, outstanding: '4000', overdue_invoices: 1, overdue_amount: '1000', due_soon_invoices: 2, due_soon_amount: '2000', non_idr: 1, dp_open: 1 }]];
    }
    if (/FROM fin_purchase_payments_accurate y/.test(sql) && /COUNT\(\*\) AS payments/.test(sql)) return [[{ payments: 3, amount: '900' }]];
    return [[]];
  });
  const out = await payables.summary(1);
  assert.equal(out.ready, true);
  assert.equal(out.asOf.batchId, 12);
  assert.deepEqual(out.summary.overdue, { invoices: 1, amount: 1000 });
  assert.deepEqual(out.summary.paidThisMonth, { amount: 900, payments: 3 });
  assert.equal(out.summary.nonIdrOpen, 1);
  const reads = calls.filter((c) => /fin_purchase_/.test(c.sql));
  assert.ok(reads.every((c) => /currency = 'IDR'/.test(c.sql)));
  assert.ok(reads.filter((c) => /fin_purchase_invoices/.test(c.sql)).every((c) => /NOT p\.is_dp/.test(c.sql)));

  calls.length = 0;
  await payables.data.agingData(1, { departmentId: 3 });
  await payables.data.vendorsData(1, { departmentId: 3 });
  await payables.data.overdueData(1, { departmentId: 3 });
  for (const c of calls) { assert.equal(c.args[0], 1); assert.equal(c.args[1], 3); assert.match(c.sql, /p\.department_id = \?/); }
});

// ------------------------------------------------------------------ management provider

test('provider: valid, keys fit their columns, rupiah figures sit behind the finance permissions', () => {
  const p = validateProvider(provider);
  assert.equal(p.key, 'finance_ledger');
  assert.deepEqual(p.navPaths, ['/finance/receivables', '/finance/payables']);
  for (const e of p.escalations) assert.ok(e.key.length <= 32, e.key);
  for (const m of p.metrics) assert.ok(m.key.length <= 40, m.key);
  for (const x of [...p.metrics, ...p.kpis].filter((y) => y.unit === 'rupiah')) {
    assert.ok(['finance.receivable.view', 'finance.payable.view'].includes(x.permission), `${x.key} declares its permission`);
  }
  assert.deepEqual(p.escalations.map((e) => e.key), ['finance_payable_overdue']);
  assert.ok(!p.escalations.some((e) => /invoice_overdue/.test(e.key)), 'the Sales provider already escalates late receivables');
});

test('provider escalation: Finance-scoped in SQL, no amounts in its text, locate is bound to the company', async (t) => {
  const calls = recording(t, (sql) => (/FROM fin_purchase_invoices_accurate p/.test(sql)
    ? [[{ id: 77, invoice_number: 'PI.2026.09.0001', vendor_no: 'V-1', vendor_name: 'PT Susu', due_date: new Date('2026-09-20T00:00:00Z'), term_name: 'Net 30', currency: 'IDR', department_id: 3, department_name: 'Finance', days_late: 11 }]]
    : [[{ entity_id: 1, department_id: 3 }]]));
  const [item] = await provider.escalations[0].list(1, { departmentId: 3 });
  assert.deepEqual(calls[0].args, [1, 3]);
  assert.match(calls[0].sql, /p\.department_id = \?/);
  assert.equal(item.sourceId, 77);
  assert.equal(item.daysLate, 11);
  assert.equal(item.link, '/finance/payables?tab=overdue');
  assert.doesNotMatch(`${item.title} ${item.context}`, /Rp|\d{4,}\.\d\d/);
  assert.deepEqual(await provider.escalations[0].locate(77, { entityId: 1 }), { entityId: 1, departmentId: 3 });
  assert.deepEqual(calls[1].args, [77, 1]);
});

test('provider KPI utang: waits for the first approved batch; another division reads nothing', async (t) => {
  const kpi = provider.kpis.find((k) => k.key === 'payable_due_14');
  let answer = [[{ ready: 0 }]];
  const calls = recording(t, () => answer);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: null, sub: payables.NOT_READY, alert: false });
  assert.deepEqual(calls[0].args, [1], 'the company first');
  answer = [[]];
  assert.equal((await kpi.value(1, { departmentId: 5 })).value, null);
  assert.deepEqual(calls[1].args, [1, 5], 'then the division, inside the same statement');
  answer = [[{ ready: 1, due_invoices: 2, due_amount: '5000', overdue_invoices: 1, overdue_amount: '700' }]];
  const ok = await kpi.value(1, { departmentId: 3 });
  assert.equal(ok.value, 5000);
  assert.equal(ok.alert, true);
});

test('provider metrics: collections and overdue share per selling division; payables paid only once ready', async (t) => {
  const calls = recording(t, (sql) => (/sales_receipts_accurate/.test(sql) ? [[{ department_id: 5, amount: '1200' }]]
    : /pct/.test(sql) ? [[{ department_id: 5, pct: '12.34' }, { department_id: 8, pct: null }]] : [[]]));
  const period = { start: '2026-09-01', end: '2026-09-30' };
  const byKey = Object.fromEntries(provider.metrics.map((m) => [m.key, m]));
  assert.deepEqual([...(await byKey.finance_collections.actuals(1, period, { departmentId: 5 }))], [[5, 1200]]);
  assert.deepEqual([...(await byKey.finance_receivable_overdue_share.actuals(1, period, { departmentId: null }))], [[5, 12.3]]);
  assert.deepEqual([...(await byKey.finance_payables_paid.actuals(1, period, { departmentId: 3 }))], []);
  for (const c of calls) assert.equal(c.args[0], 1, 'the company is bound first');
  assert.match(calls[2].sql, /WHERE f\.ready/);
  assert.deepEqual(calls[2].args, [1, 3, '2026-09-01', '2026-09-30']);
  assert.equal(byKey.finance_receivable_overdue_share.permission, undefined, 'a percentage carries no rupiah');
});

// ------------------------------------------------------------------ the Finance pull

const PI_LIST = {
  id: 901, number: 'PI.2026.09.00012', transDate: '24/09/2026', dueDate: '24/10/2026', statusName: 'Belum Lunas', approvalStatus: 'APPROVED',
  totalAmount: 1110000, tax1Amount: 110000, primeOwing: 610000, invoiceDp: false,
  vendor: { vendorNo: 'V-001', name: 'PT Pemasok Susu 0812-3456-7890', npwpNo: '01.234.567.8-901.000' }, lastUpdate: 'L1',
};
const PI_DETAIL = {
  number: 'PI.2026.09.00012', paymentTerm: { name: 'Net 30', netDays: 30 }, currency: { code: 'IDR' },
  vendor: { vendorNo: 'V-001', name: 'PT Pemasok Susu', npwpNo: '01.234.567.8-901.000', vendorBankList: [{ bankAccount: '1234567890' }] },
  detailItem: [{ item: { no: 'DAI-OAT' }, purchaseOrder: { number: 'PO.2026.09.00012' }, unitPrice: 100000, itemCost: 99999 },
    { item: { no: 'DAI-MLK' }, purchaseOrder: { number: 'PO.2026.09.00012' } }],
  description: 'transfer ke 1234567890 a.n. Budi',
};
const PP_LIST = { id: 55, number: 'PP.2026.09.00003', transDate: '30/09/2026', totalPayment: 500000, vendor: { vendorNo: 'V-001', name: 'PT Pemasok Susu' }, bank: { name: 'Bank BCA 1234567890' }, lastUpdate: 'P1' };
const PP_DETAIL = { currency: { code: 'IDR' }, detailInvoice: [{ invoice: { number: 'PI.2026.09.00012' }, paymentAmount: 500000, discountAmount: 0 }], description: 'catatan' };

test('record types: Finance owns them, they fit record_type VARCHAR(20), and are read-only endpoints', () => {
  assert.deepEqual([...FINANCE_TYPE_NAMES], ['fin_purchase_invoice', 'fin_purchase_payment']);
  for (const name of FINANCE_TYPE_NAMES) {
    assert.ok(name.length <= 20, `${name} fits sales_accurate_batch_items.record_type VARCHAR(20)`);
    assert.equal(batches.RECORD_TYPES[name].division, 'finance');
  }
  assert.deepEqual([...batches.FINANCE_TYPE_NAMES], [...FINANCE_TYPE_NAMES]);
  assert.deepEqual([...READ_ENDPOINTS['purchase-invoice']], ['list', 'detail']);
  assert.deepEqual([...READ_ENDPOINTS['purchase-payment']], ['list', 'detail']);
});

test('a purchase invoice keeps amounts owed, dates, term and PO numbers — never vendor tax, bank or notes', () => {
  const row = fc.purchaseInvoiceRow(PI_LIST, fc.purchaseInvoiceExtra(PI_DETAIL));
  assert.deepEqual(row, {
    number: 'PI.2026.09.00012', trans_date: '2026-09-24', due_date: '2026-10-24', customer_no: 'V-001', customer_name: 'PT Pemasok Susu',
    status: 'Belum Lunas', dpp_amount: 1000000, total_amount: 1110000, outstanding_amount: 610000,
    data: { tax_amount: 110000, po_numbers: ['PO.2026.09.00012'], term: 'Net 30', term_days: 30, currency: 'IDR', _last_update: 'L1' },
  });
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.fin_purchase_invoice, row.data), []);
  assert.doesNotMatch(JSON.stringify(row), /npwp|1234567890|0812|bank|itemCost|99999|Budi/i);
  assert.equal(fc.purchaseInvoiceRow({ ...PI_LIST, invoiceDp: true }).data.dp, true, 'a down payment is marked');
});

test('a purchase payment keeps the invoices it paid and the account NAME only', () => {
  const row = fc.purchasePaymentRow(PP_LIST, PP_DETAIL);
  assert.deepEqual(row, {
    number: 'PP.2026.09.00003', trans_date: '2026-09-30', customer_no: 'V-001', customer_name: 'PT Pemasok Susu', total_amount: 500000,
    data: { bank: 'Bank BCA', currency: 'IDR', invoices: [{ number: 'PI.2026.09.00012', amount: 500000 }], _last_update: 'P1' },
  });
  assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES.fin_purchase_payment, row.data), []);
});

test('a vendor name still holding personal data is refused at staging, without echoing it', async () => {
  const change = {
    recordType: 'fin_purchase_invoice', action: 'create', externalKey: '901',
    after: { number: 'PI1', trans_date: '2026-09-24', customer_name: 'CV Maju 0812-3456-7890', data: {} },
  };
  await assert.rejects(() => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [change] }), (e) => {
    assert.equal(e.code, 'PERSONAL_DATA_FOUND');
    assert.equal(e.message.includes('0812'), false);
    return true;
  });
});

function fakeFinanceAccurate() {
  const calls = [];
  const respond = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const list = (rows) => respond({ s: true, d: rows, sp: { pageCount: 1, rowCount: rows.length } });
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    const u = new URL(url);
    if (u.pathname === '/api/open-db.do') return respond({ host: 'https://odin.accurate.id', session: 'sess' });
    if (u.pathname.endsWith('/purchase-invoice/list.do')) return list([PI_LIST, { ...PI_LIST, id: 902, number: 'PI-DRAFT', statusName: 'Draf' }]);
    if (u.pathname.endsWith('/purchase-invoice/detail.do')) return respond({ s: true, d: PI_DETAIL });
    if (u.pathname.endsWith('/purchase-payment/list.do')) return list([PP_LIST]);
    if (u.pathname.endsWith('/purchase-payment/detail.do')) return respond({ s: true, d: PP_DETAIL });
    return respond({ s: false, d: ['unknown'] });
  };
  return { fetchImpl, calls };
}

test('the Finance pull only GETs purchase invoices and payments (never the ledger) and stages final documents', async (t) => {
  t.mock.method(connection, 'getAccessToken', async () => ({ accessToken: 'tok', dbId: 7 }));
  t.mock.method(pool, 'query', async () => [[]]);
  const { fetchImpl, calls } = fakeFinanceAccurate();
  const { changes, checks } = await require('../src/services/accurate/financePull').collectFinance(1, { fetchImpl });
  assert.ok(calls.every((c) => c.method === 'GET'));
  const resources = new Set(calls.map((c) => new URL(c.url).pathname.split('/')[3]).filter(Boolean));
  assert.deepEqual([...resources].sort(), ['purchase-invoice', 'purchase-payment']);
  assert.ok(!calls.some((c) => /glaccount|journal|\/tax\/|bank-transfer|other-payment/.test(new URL(c.url).pathname)));
  assert.deepEqual(changes.map((c) => `${c.recordType}:${c.externalKey}:${c.action}`), ['fin_purchase_invoice:901:create', 'fin_purchase_payment:55:create'], 'the draft is not final');
  assert.equal(changes[0].amount, 1110000, 'the deciders see the invoice value');
  assert.equal(checks.finance.owed.outstanding_idr, 610000);
  assert.equal(checks.finance.complete, true);
});

test('a real Finance pull stays off until ACCURATE_FINANCE=1; its batches go to Finance', async () => {
  delete process.env.ACCURATE_FINANCE;
  await assert.rejects(() => sync.runSync({ entityId: 1, requestedBy: 2, scope: 'finance' }), (e) => e.code === 'SCOPE_OFF');
  assert.deepEqual(sync.syncDivisions('finance'), ['finance']);
  assert.equal(batches.HEAD_ONLY_DIVISIONS.has('finance'), false, 'Supervisor or Head decides, as the approval matrix says');
});

// ------------------------------------------------------------------ routes

test('routes: every report needs its finance permission and only reads', () => {
  const router = require('../src/routes/finance.reports.routes');
  const routes = router.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
  assert.ok(routes.length >= 12);
  assert.ok(routes.every((r) => r.methods.length === 1 && r.methods[0] === 'get'));
  for (const p of ['/receivables', '/receivables/aging', '/receivables/customers', '/receivables/due-soon', '/receivables/collections',
    '/payables', '/payables/summary', '/payables/vendors', '/payables/due-soon', '/payables/payments']) {
    assert.ok(routes.some((r) => r.path === p), p);
  }
});
