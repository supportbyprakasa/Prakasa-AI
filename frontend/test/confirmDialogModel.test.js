import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCloseDialogOnKey } from '../src/components/confirmDialogModel.js';

test('only Escape closes an idle confirmation dialog', () => {
  assert.equal(shouldCloseDialogOnKey({ key: 'Escape', loading: false }), true);
  assert.equal(shouldCloseDialogOnKey({ key: 'Enter', loading: false }), false);
  assert.equal(shouldCloseDialogOnKey({ key: 'Escape', loading: true }), false);
});
