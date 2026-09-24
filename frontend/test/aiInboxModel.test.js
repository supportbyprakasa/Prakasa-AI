import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirmationDialogCopy,
  confirmationSuccessMessage,
  shouldShowInboxEmpty,
} from '../src/components/ai/aiInboxModel.js';

test('confirmation feedback distinguishes executed and deferred actions', () => {
  assert.equal(
    confirmationSuccessMessage({ executionDeferred: false }),
    'Aksi dikonfirmasi dan dijalankan',
  );
  assert.equal(
    confirmationSuccessMessage({ executionDeferred: true }),
    'Aksi dikonfirmasi, tetapi belum dapat dijalankan otomatis',
  );
});

test('confirmation dialog warns when an action has no automatic executor', () => {
  assert.match(
    confirmationDialogCopy({ actionType: 'create_document', actionLabel: 'Buat dokumen', title: 'SOP gudang' }),
    /belum dijalankan otomatis/i,
  );
  assert.match(
    confirmationDialogCopy({ actionType: 'create_task', actionLabel: 'Buat task', title: 'Cek stok' }),
    /langsung dijalankan/i,
  );
});

test('load errors never masquerade as an empty inbox', () => {
  const emptyData = { proposals: [], approvals: [], notifications: [] };
  assert.equal(shouldShowInboxEmpty({ loading: false, error: null, data: emptyData }), true);
  assert.equal(shouldShowInboxEmpty({ loading: false, error: 'Gagal memuat', data: null }), false);
  assert.equal(shouldShowInboxEmpty({ loading: true, error: null, data: null }), false);
});
