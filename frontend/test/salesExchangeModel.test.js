import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeBody, exchangeChipLabel, exchangeText, isDueForExchange } from '../src/pages/sales/salesExchangeModel.js';

const fmt = (d) => d;

test('a recorded tukar faktur reads as one line; none reads "Belum"', () => {
  assert.equal(exchangeText(null, fmt), 'Belum');
  assert.equal(exchangeText({ exchangedOn: '2026-09-29', receiptNo: 'TT-12', promisedPayDate: '2026-10-15' }, fmt), 'Tukar 2026-09-29 · TT-12 · janji bayar 2026-10-15');
  assert.equal(exchangeChipLabel('pending', { pending: 478 }), 'Belum tukar faktur (478)');
});

test('an invoice is due for tukar faktur a week after its date', () => {
  assert.equal(isDueForExchange({ daysSinceInvoice: 7, exchange: null }), true);
  assert.equal(isDueForExchange({ daysSinceInvoice: 6, exchange: null }), false);
  assert.equal(isDueForExchange({ daysSinceInvoice: 30, exchange: { id: 1 } }), false);
});

test('the form needs a date, and a promise cannot come before the hand-over', () => {
  assert.match(exchangeBody({ exchangedOn: '' }).error, /tanggal/);
  assert.equal(exchangeBody({ exchangedOn: '' }).field, 'exchangedOn');
  assert.equal(exchangeBody({ exchangedOn: '2026-09-29', promisedPayDate: '2026-09-01' }).field, 'promisedPayDate');
  assert.match(exchangeBody({ exchangedOn: '2026-09-29', promisedPayDate: '2026-09-01' }).error, /Janji bayar/);
  assert.deepEqual(exchangeBody({ exchangedOn: '2026-09-29', receiptNo: '', promisedPayDate: '2026-10-15' }).body,
    { exchangedOn: '2026-09-29', receiptNo: null, promisedPayDate: '2026-10-15', note: null });
});
