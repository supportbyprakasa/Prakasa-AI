const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const exchanges = require('../src/services/salesExchanges.service');
const receivables = require('../src/services/salesReceivables.service');

// Tukar faktur and receivables aging (program 2.3): app records against approved
// Accurate invoices; a record is never deleted.

const user = { sub: 7, entityId: 1, permissions: ['sales.data.view_all'] };

test('only a credit invoice the user can see can be recorded; a second live record is refused', async (t) => {
  const calls = [];
  let dup = false;
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_invoices_accurate i\s+WHERE/.test(sql)) return [[args.includes('SI-CASH') ? { invoice_number: 'SI-CASH', customer_code: 'C1', credit: 0 } : args.includes('SI1') ? { invoice_number: 'SI1', customer_code: 'C1', credit: 1 } : undefined].filter(Boolean)];
    if (/INSERT INTO sales_invoice_exchanges/.test(sql)) { if (dup) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); return [{ insertId: 31 }]; }
    return [[]];
  });
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI-X', exchangedOn: '2026-09-29' }), (e) => e.status === 404);
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI-CASH', exchangedOn: '2026-09-29' }), (e) => e.status === 400);
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI1', exchangedOn: '29/09/2026' }), (e) => e.status === 400);
  assert.deepEqual(await exchanges.record(user, { invoiceNumber: 'SI1', exchangedOn: '2026-09-29', receiptNo: 'TT-1', promisedPayDate: '2026-10-15' }), { id: 31 });
  const insert = calls.find((c) => /INSERT INTO sales_invoice_exchanges/.test(c.sql));
  assert.deepEqual(insert.args, [1, 'SI1', 'C1', '2026-09-29', 'TT-1', '2026-10-15', null, 7]);
  dup = true;
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI1', exchangedOn: '2026-09-29' }), (e) => e.status === 409);
});

test('cancelling keeps the record (never deleted)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_invoice_exchanges WHERE id = \?/.test(sql)) return [[{ id: 31, invoice_number: 'SI1' }]];
    if (/FROM sales_invoices_accurate i\s+WHERE/.test(sql)) return [[{ invoice_number: 'SI1', customer_code: 'C1', credit: 1 }]];
    return [{ affectedRows: 1 }];
  });
  await exchanges.cancel(user, 31);
  assert.ok(calls.some((c) => /UPDATE sales_invoice_exchanges SET cancelled_at = NOW\(\)/.test(c.sql)));
  assert.ok(!calls.some((c) => /DELETE/i.test(c.sql)));
});

test('the pending list is credit invoices still owed, bound to the company and the viewer\'s scope', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return /COUNT|SUM/.test(sql) && /pending/.test(sql) ? [[{ pending: 2, done: 1 }]] : [[]]; });
  const r = await exchanges.list({ sub: 9, entityId: 1, permissions: [] }, { status: 'pending' });
  assert.deepEqual(r.counts, { pending: 2, done: 1 });
  for (const c of calls) {
    assert.match(c.sql, /i\.due_date > i\.trans_date/, 'credit invoices only');
    assert.match(c.sql, /sales_person_accounts|sales_owner_links/, 'own invoices for a salesperson');
    assert.equal(c.args[0], 1);
  }
});

test('receivables age by how late, per payment term; totals add up', async (t) => {
  t.mock.method(pool, 'query', async () => [[
    { term_days: 0, bucket: 'current', invoices: 2, outstanding: '100.00' },
    { term_days: 7, bucket: 'd90_plus', invoices: 3, outstanding: '900.50' },
    { term_days: 7, bucket: 'd1_30', invoices: 1, outstanding: '50' },
  ]]);
  const a = await receivables.aging(user);
  assert.deepEqual(a.terms.map((x) => [x.termDays, x.total.invoices, x.total.outstanding]), [[0, 2, 100], [7, 4, 950.5]]);
  assert.deepEqual(a.grand, { invoices: 6, outstanding: 1050.5 });
  assert.equal(a.totals.d90_plus.outstanding, 900.5);
});

test('an impossible date or a promise before the hand-over is a 400, never a database error', async (t) => {
  t.mock.method(pool, 'query', async (sql) => (/FROM sales_invoices_accurate i\s+WHERE/.test(sql) ? [[{ invoice_number: 'SI1', customer_code: 'C1', credit: 1 }]] : [{ insertId: 1 }]));
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI1', exchangedOn: '2026-02-31' }), (e) => e.status === 400);
  await assert.rejects(() => exchanges.record(user, { invoiceNumber: 'SI1', exchangedOn: '2026-09-29', promisedPayDate: '2026-09-01' }), (e) => e.status === 400);
});
