import test from 'node:test';
import assert from 'node:assert/strict';
import { agingRows, cellText, overdueShare, termLabel } from '../src/pages/sales/salesAgingModel.js';

const AGING = {
  buckets: [{ key: 'current', label: 'Belum jatuh tempo' }, { key: 'd1_30', label: '1–30 hari' }, { key: 'd90_plus', label: '> 90 hari' }],
  terms: [{ termDays: 0, total: { invoices: 2, outstanding: 300 }, buckets: { current: { invoices: 1, outstanding: 100 }, d1_30: { invoices: 0, outstanding: 0 }, d90_plus: { invoices: 1, outstanding: 200 } } }],
  totals: { current: { invoices: 1, outstanding: 100 }, d1_30: { invoices: 0, outstanding: 0 }, d90_plus: { invoices: 1, outstanding: 200 } },
  grand: { invoices: 2, outstanding: 300 },
};

test('each payment term is a row, then the total', () => {
  const rows = agingRows(AGING);
  assert.deepEqual(rows.map((r) => r.term), ['Tunai / jatuh tempo hari itu', 'Total']);
  assert.equal(termLabel(30), '30 hari');
  assert.equal(rows.at(-1).isTotal, true);
  assert.deepEqual(agingRows(null), []);
});

test('a cell reads rupiah and invoices; the past-due share leaves out what is not due yet', () => {
  assert.equal(cellText({ invoices: 0, outstanding: 0 }), '—');
  assert.match(cellText({ invoices: 3, outstanding: 1500000 }), /3 faktur$/);
  assert.equal(overdueShare(AGING), 66.7);
  assert.equal(overdueShare({ grand: { outstanding: 0 } }), null);
});
