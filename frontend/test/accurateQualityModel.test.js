import test from 'node:test';
import assert from 'node:assert/strict';
import { moreText, orderChecks, totalFindings, valueText } from '../src/pages/accurate/accurateQualityModel.js';

test('findings come first; clean checks after', () => {
  const checks = [{ key: 'a', count: 0 }, { key: 'b', count: 3 }, { key: 'c', count: 0 }, { key: 'd', count: 1 }];
  assert.deepEqual(orderChecks(checks).map((c) => c.key), ['b', 'd', 'a', 'c']);
  assert.equal(totalFindings(checks), 4);
});

test('a row\'s number reads in the words of its check', () => {
  assert.equal(valueText('transfer_not_received', 5), '5 hari');
  assert.equal(valueText('future_date', 65), '65 hari ke depan');
  assert.equal(valueText('unit_names', 12), '12 barang');
  assert.equal(valueText('stock_mismatch', -2.5), 'selisih -2,5');
  assert.equal(valueText('stock_minus', -1071), '-1.071');
  assert.equal(valueText('stock_minus', null), '—');
});

test('a long list says it shows only the first rows', () => {
  assert.equal(moreText({ count: 138, rows: Array(100).fill({}) }), 'Menampilkan 100 dari 138.');
  assert.equal(moreText({ count: 3, rows: [{}, {}, {}] }), '');
});
