import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETURN_REASONS, returnNotice, stripReturnParams, scopeLabel, tokenExpiry,
} from '../src/pages/admin/accurateIntegrationModel.js';

test('return notice reads only ?accurate and ?reason', () => {
  assert.equal(returnNotice(''), null);
  assert.equal(returnNotice('?tab=x'), null);
  assert.equal(returnNotice('?accurate=connected').tone, 'success');
  const error = returnNotice('?accurate=error&reason=db_trial_only');
  assert.equal(error.tone, 'error');
  assert.equal(error.message, RETURN_REASONS.db_trial_only);
  assert.equal(returnNotice('?accurate=error&reason=<script>').message, RETURN_REASONS.internal);
  assert.equal(returnNotice('?accurate=error').message, RETURN_REASONS.internal);
});

test('the return parameters are removed from the address, others kept', () => {
  assert.equal(stripReturnParams('?accurate=error&reason=denied'), '');
  assert.equal(stripReturnParams('?accurate=connected&x=1'), '?x=1');
});

test('scopes read as Indonesian view permissions', () => {
  assert.equal(scopeLabel('sales_invoice_view'), 'Faktur penjualan (lihat)');
  assert.equal(scopeLabel('unknown_view'), 'unknown_view');
});

test('token expiry flags the 2-day refresh window', () => {
  const now = new Date('2026-09-29T00:00:00Z');
  assert.equal(tokenExpiry(null, now), null);
  assert.deepEqual(tokenExpiry('2026-10-14T00:00:00Z', now), { expired: false, soon: false, days: 15 });
  assert.equal(tokenExpiry('2026-09-30T12:00:00Z', now).soon, true);
  assert.equal(tokenExpiry('2026-09-28T00:00:00Z', now).expired, true);
});
