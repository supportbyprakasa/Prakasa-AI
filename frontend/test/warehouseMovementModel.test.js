import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVEMENT_STATUSES,
  emptyMovementItem,
  normalizeMovementItem,
  movementValidationSummary,
  movementStatusLabel,
  nextActorText,
  canEditMovement,
  canCancelMovement,
  movementPayload,
} from '../src/pages/warehouse/warehouseMovementModel.js';

const perms = (...codes) => ({ permissions: codes });
const valid = {
  movementDate: '2026-09-24',
  referenceNo: 'PO-1',
  party: 'PT A',
  notes: '',
  items: [{ ...emptyMovementItem(), product: 'Kopi', quantity: '5', unit: 'kg' }],
};

test('an empty item row has every field of the stable item shape', () => {
  assert.deepEqual(Object.keys(emptyMovementItem()).sort(), ['batchNo', 'expiresOn', 'key', 'location', 'note', 'product', 'quantity', 'sku', 'unit'].sort());
  assert.notEqual(emptyMovementItem().key, emptyMovementItem().key);
});

test('item rows are normalized for the API with blanks as null', () => {
  assert.deepEqual(normalizeMovementItem({ key: 'x', sku: ' ', product: ' Gula ', quantity: '2,5', unit: 'sak', batchNo: '', expiresOn: '', location: 'R1', note: '' }), {
    sku: null, product: 'Gula', quantity: 2.5, unit: 'sak', batchNo: null, expiresOn: null, location: 'R1', note: null,
  });
});

test('validation summary lists exact, row-specific messages', () => {
  assert.deepEqual(movementValidationSummary(valid), []);
  const messages = movementValidationSummary({
    ...valid,
    movementDate: '',
    items: [
      { ...emptyMovementItem(), product: '', quantity: '0', unit: '' },
      { ...emptyMovementItem(), sku: 'A', product: 'Kopi', quantity: '1', unit: 'kg' },
      { ...emptyMovementItem(), sku: 'a', product: 'Kopi', quantity: '1', unit: 'kg' },
    ],
  });
  assert.ok(messages.includes('Tanggal transaksi wajib diisi.'));
  assert.ok(messages.includes('Baris 1: produk wajib diisi.'));
  assert.ok(messages.includes('Baris 1: jumlah harus lebih dari 0.'));
  assert.ok(messages.includes('Baris 1: satuan wajib diisi.'));
  assert.ok(messages.some((message) => message.startsWith('SKU A muncul di baris 2 dan 3')));
  assert.deepEqual(movementValidationSummary({ ...valid, items: [] }), ['Tambahkan minimal satu barang.']);
});

test('status copy is human-readable and never claims an external sync', () => {
  for (const status of MOVEMENT_STATUSES) {
    const { label, tone } = movementStatusLabel(status);
    assert.ok(label && tone, status);
    assert.equal(/accurate|sync|sinkron/i.test(label), false, status);
  }
  assert.equal(movementStatusLabel('approved').label, 'Disetujui');
  assert.equal(movementStatusLabel('pending_approval').label, 'Menunggu review');
});

test('next actor text explains who must act and why editing is locked', () => {
  assert.match(nextActorText({ status: 'draft' }), /Pembuat/);
  assert.match(nextActorText({ status: 'pending_approval' }), /Supervisor/);
  assert.match(nextActorText({ status: 'revision_requested' }), /perbaiki/i);
  assert.match(nextActorText({ status: 'approved' }), /tidak dapat diubah/);
});

test('edit and cancel visibility follow server permissions, state, and role', () => {
  const draft = { status: 'draft', permissions: { canEdit: true } };
  assert.equal(canEditMovement(perms('warehouse.movement.update'), draft), true);
  assert.equal(canEditMovement(perms(), draft), false);
  assert.equal(canEditMovement(perms('warehouse.movement.update'), { ...draft, status: 'approved' }), false);
  assert.equal(canEditMovement(perms('warehouse.movement.update'), { ...draft, permissions: { canEdit: false } }), false);

  const approved = { status: 'approved', permissions: { canCancel: true } };
  assert.equal(canCancelMovement(perms('warehouse.movement.cancel'), approved), true);
  assert.equal(canCancelMovement(perms('warehouse.movement.update'), approved), false);
  assert.equal(canCancelMovement(perms('warehouse.movement.cancel'), { ...approved, status: 'pending_approval' }), false);
});

test('payload contains only fields the API accepts', () => {
  const payload = movementPayload({ ...valid, entityId: 99, status: 'approved' });
  assert.deepEqual(Object.keys(payload).sort(), ['items', 'movementDate', 'notes', 'party', 'referenceNo']);
  assert.equal(payload.notes, null);
  assert.equal(payload.items[0].quantity, 5);
});
