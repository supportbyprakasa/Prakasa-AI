const test = require('node:test');
const assert = require('node:assert/strict');
const { billingStatus, invoiceCoverage } = require('../src/controllers/salesOrders.controller');

// Revision F01 (3 Oct 2026): the billing state of a sales order comes from its
// invoices. A zero or missing outstanding amount is never enough for "Lunas".

test('an order without an invoice is "Belum difakturkan", never Lunas', () => {
  assert.equal(billingStatus({ invoiceCount: 0, outstanding: 0, orderDpp: 1000, invoicedDpp: null }), 'not_invoiced');
});

test('an invoice that still owes makes the order "Belum lunas"', () => {
  assert.equal(billingStatus({ invoiceCount: 1, outstanding: 250, orderDpp: 1000, invoicedDpp: 1000 }), 'unpaid');
});

test('paid invoices that cover only part of the order are not "Lunas" for the whole order', () => {
  assert.equal(billingStatus({ invoiceCount: 1, outstanding: 0, orderDpp: 1000, invoicedDpp: 400 }), 'partly_billed');
  assert.equal(invoiceCoverage(1000, 400), 40);
});

test('fully invoiced and nothing owed is "Lunas" (a rupiah of rounding tolerated)', () => {
  assert.equal(billingStatus({ invoiceCount: 2, outstanding: 0, orderDpp: 1000, invoicedDpp: 999.5 }), 'paid');
  assert.equal(invoiceCoverage(1000, 1000), 100);
});

test('missing amounts are "Data pembayaran belum tersedia", not zero', () => {
  assert.equal(billingStatus({ invoiceCount: null, outstanding: 0 }), 'unknown');
  assert.equal(billingStatus({ invoiceCount: 1, outstanding: null, orderDpp: 1000, invoicedDpp: 1000 }), 'unknown');
  assert.equal(invoiceCoverage(0, 100), null);
  assert.equal(invoiceCoverage(1000, null), null);
});

test('recap mode (no coverage known): invoiced and nothing owed is Lunas', () => {
  assert.equal(billingStatus({ invoiceCount: 1, outstanding: 0, orderDpp: null, invoicedDpp: null }), 'paid');
});

test('the Accurate order list: no invoice → Belum difakturkan, partly billed → not Lunas, owed → Belum lunas', async (t) => {
  const pool = require('../src/db/pool');
  const { listAccurateOrders } = require('../src/controllers/salesOrders.controller');
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    calls.push(text);
    if (/FROM sales_so_accurate s\s+WHERE/.test(text) && /LIMIT \? OFFSET \?/.test(text)) {
      return [[
        { id: 1, orderNumber: 'SO-1', totalAmount: 1110, orderDpp: 1000, invoiceCount: 0, invoicedDpp: null, outstandingAmount: null, dueDate: null },
        { id: 2, orderNumber: 'SO-2', totalAmount: 1110, orderDpp: 1000, invoiceCount: 1, invoicedDpp: 400, outstandingAmount: 0, dueDate: null },
        { id: 3, orderNumber: 'SO-3', totalAmount: 1110, orderDpp: 1000, invoiceCount: 1, invoicedDpp: 1000, outstandingAmount: 300, dueDate: null },
        { id: 4, orderNumber: 'SO-4', totalAmount: 1110, orderDpp: 1000, invoiceCount: 2, invoicedDpp: 1000, outstandingAmount: 0, dueDate: null },
      ]];
    }
    if (/COUNT\(\*\) AS n/.test(text)) return [[{ n: 4, revenue: 4000, outstanding: 300 }]];
    return [[]];
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await listAccurateOrders({ query: {}, user: { sub: 1, entityId: 1, permissions: ['sales.data.view_all'] } }, res);
  const rows = res.body.data;
  assert.deepEqual(rows.map((r) => r.billingStatus), ['not_invoiced', 'partly_billed', 'unpaid', 'paid']);
  assert.equal(rows[0].outstandingAmount, 0);
  assert.equal(rows[1].invoiceCoverage, 40);
  const list = calls.find((c) => /LIMIT \? OFFSET \?/.test(c));
  assert.match(list, /SELECT SUM\(li\.outstanding_amount\)/, 'the owed amount is not forced to zero');
  assert.match(list, /AS invoiceCount/);
});
