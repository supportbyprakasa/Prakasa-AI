import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formBody, formErrors, formValues, formatPeriod, periodOptions, stateChips, stateOf, tabCount, attentionText, logBody, logErrors,
} from '../src/pages/ga/gaOpsModel.js';

// Operasional GA (migration 114): the page model.
const TODAY = '2026-10-01';

test('a row state drives its colour and filter chip', () => {
  assert.equal(stateOf('maintenance', { status: 'active', overdue: true }), 'upkeep_overdue');
  assert.equal(stateOf('maintenance', { status: 'active', dueSoon: true }), 'upkeep_soon');
  assert.equal(stateOf('maintenance', { status: 'retired', overdue: true }), 'upkeep_retired');
  assert.equal(stateOf('contracts', { status: 'active', ending: true }), 'contract_ending');
  assert.equal(stateOf('contracts', { status: 'active', ending: true, lapsed: true }), 'contract_lapsed');
  assert.equal(stateOf('bills', { paidOn: '2026-09-20', overdue: true }), 'bill_paid');
  assert.equal(stateOf('bills', { overdue: true }), 'bill_overdue');
  const chips = stateChips('bills', [{ overdue: true }, { paidOn: '2026-09-01' }, {}]);
  assert.deepEqual(chips.map((c) => c.key), ['bill_paid', 'bill_unpaid', 'bill_overdue']);
});

test('periods read as months; the list starts next month and keeps an old one being edited', () => {
  assert.equal(formatPeriod('2026-09'), 'Sep 2026');
  const opts = periodOptions(TODAY);
  assert.equal(opts[0].value, '2026-11');
  assert.equal(opts[1].value, '2026-10');
  assert.equal(opts.length, 25);
  assert.ok(periodOptions(TODAY, '2020-01').some((o) => o.value === '2020-01'));
});

test('required fields, numbers and dates are checked before sending', () => {
  const blank = formValues('maintenance', null, TODAY);
  const errors = formErrors('maintenance', blank, false, TODAY);
  assert.deepEqual(Object.keys(errors).sort(), ['category', 'intervalDays', 'locationId', 'name']);
  assert.equal(formErrors('maintenance', { ...blank, name: 'AC', category: 'ac', locationId: '1', intervalDays: '0' }, false, TODAY).intervalDays, 'Interval 1–1830 hari.');
  assert.equal(formErrors('contracts', { ...formValues('contracts', null, TODAY), vendorName: 'PT Bersih', kind: 'cleaning', startOn: '2026-05-01', endOn: '2026-04-01' }, false, TODAY).endOn, 'Tidak boleh sebelum tanggal mulai.');
  assert.equal(formErrors('bills', { ...formValues('bills', null, TODAY), utility: 'water', locationId: '1', amount: '5', paidOn: '2026-12-01' }, false, TODAY).paidOn, 'Tidak boleh di masa depan.');
});

test('a new row sends filled fields as numbers; an edit sends only changes and the version', () => {
  const v = { ...formValues('bills', null, TODAY), utility: 'electricity', locationId: '3', amount: '1250000', usageAmount: '' };
  assert.deepEqual(formBody('bills', v, null, TODAY), { utility: 'electricity', locationId: 3, period: '2026-10', amount: 1250000 });
  const row = { id: 9, version: 4, utility: 'electricity', locationId: 3, customerNumber: null, period: '2026-10', amount: 1250000, usageAmount: null, dueOn: '2026-10-20', paidOn: null, notes: null };
  const edited = { ...formValues('bills', row, TODAY), paidOn: '2026-10-01' };
  assert.deepEqual(formBody('bills', edited, row, TODAY), { paidOn: '2026-10-01', version: 4 });
});

test('upkeep log, header line and tab counts', () => {
  assert.equal(logErrors({ doneOn: '2026-10-02' }, TODAY).doneOn, 'Tidak boleh di masa depan.');
  assert.deepEqual(logBody({ doneOn: TODAY, result: 'follow_up', cost: '150000', note: ' Freon ' }), { doneOn: TODAY, result: 'follow_up', cost: 150000, note: 'Freon' });
  const s = { maintenanceOverdue: 2, maintenanceDueSoon: 1, contractsEnding: 0, billsOverdue: 1 };
  assert.equal(attentionText(s), '2 perawatan lewat jadwal · 1 tagihan lewat jatuh tempo');
  assert.equal(tabCount(s, 'maintenance'), 3);
  assert.equal(tabCount(s, 'contracts'), undefined);
});
