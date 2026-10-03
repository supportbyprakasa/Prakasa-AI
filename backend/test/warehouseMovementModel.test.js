const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MOVEMENT_TYPES,
  STATUS,
  assertMovementTransition,
  isEditableStatus,
  validateMovementInput,
  requireDecisionNote,
  movementDto,
} = require('../src/services/warehouseMovementModel');

const item = (overrides = {}) => ({ product: 'Kopi Arabika', quantity: 10, unit: 'kg', ...overrides });
const input = (overrides = {}) => ({
  movementDate: '2026-09-24',
  referenceNo: 'PO-001',
  party: 'PT Sumber Kopi',
  notes: null,
  items: [item()],
  ...overrides,
});

test('movement types map to their own tables, request types, and party columns', () => {
  assert.equal(MOVEMENT_TYPES.inbound.table, 'warehouse_inbound');
  assert.equal(MOVEMENT_TYPES.inbound.requestType, 'warehouse_inbound');
  assert.equal(MOVEMENT_TYPES.inbound.partyColumn, 'supplier');
  assert.equal(MOVEMENT_TYPES.outbound.table, 'warehouse_outbound');
  assert.equal(MOVEMENT_TYPES.outbound.requestType, 'warehouse_outbound');
  assert.equal(MOVEMENT_TYPES.outbound.partyColumn, 'destination');
});

test('every allowed lifecycle path is accepted', () => {
  const allowed = [
    [STATUS.DRAFT, STATUS.PENDING],
    [STATUS.PENDING, STATUS.APPROVED],
    [STATUS.PENDING, STATUS.REVISION],
    [STATUS.PENDING, STATUS.REJECTED],
    [STATUS.REVISION, STATUS.DRAFT],
    [STATUS.APPROVED, STATUS.CANCELLED],
  ];
  for (const [from, to] of allowed) assert.doesNotThrow(() => assertMovementTransition(from, to), `${from}->${to}`);
});

test('forbidden transitions are rejected with a conflict', () => {
  const forbidden = [
    [STATUS.DRAFT, STATUS.APPROVED],
    [STATUS.APPROVED, STATUS.DRAFT],
    [STATUS.APPROVED, STATUS.PENDING],
    [STATUS.REJECTED, STATUS.PENDING],
    [STATUS.CANCELLED, STATUS.APPROVED],
    [STATUS.PENDING, STATUS.CANCELLED],
    [STATUS.REVISION, STATUS.APPROVED],
  ];
  for (const [from, to] of forbidden) {
    assert.throws(() => assertMovementTransition(from, to), (error) => error.status === 409, `${from}->${to}`);
  }
});

test('only draft and revision-requested movements are editable', () => {
  assert.equal(isEditableStatus(STATUS.DRAFT), true);
  assert.equal(isEditableStatus(STATUS.REVISION), true);
  for (const status of [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.CANCELLED]) {
    assert.equal(isEditableStatus(status), false, status);
  }
});

test('valid input is normalized to the stable item shape', () => {
  const result = validateMovementInput(input({
    items: [item({ sku: ' SKU-1 ', product: ' Kopi ', unit: ' kg ', quantity: '2.5', batchNo: '', expiresOn: '2027-01-31' })],
  }));
  assert.deepEqual(result.items, [{
    sku: 'SKU-1', product: 'Kopi', quantity: 2.5, unit: 'kg',
    batchNo: null, expiresOn: '2027-01-31', location: null, note: null,
  }]);
  assert.equal(result.movementDate, '2026-09-24');
  assert.equal(result.party, 'PT Sumber Kopi');
});

test('quantities must be finite and greater than zero', () => {
  for (const quantity of [0, -1, 'abc', Infinity, null, '']) {
    assert.throws(() => validateMovementInput(input({ items: [item({ quantity })] })), /Jumlah/, String(quantity));
  }
});

test('product and unit are required on every item', () => {
  assert.throws(() => validateMovementInput(input({ items: [item({ product: '  ' })] })), /Produk/);
  assert.throws(() => validateMovementInput(input({ items: [item({ unit: '' })] })), /Satuan/);
});

test('a movement requires at least one item and a valid date', () => {
  assert.throws(() => validateMovementInput(input({ items: [] })), /minimal satu/);
  assert.throws(() => validateMovementInput(input({ movementDate: '2026-02-30' })), /Tanggal/);
  assert.throws(() => validateMovementInput(input({ items: [item({ expiresOn: '31-01-2027' })] })), /kedaluwarsa/);
});

test('duplicate SKU rows are allowed only when batch or location differs', () => {
  assert.throws(
    () => validateMovementInput(input({ items: [item({ sku: 'A' }), item({ sku: 'A' })] })),
    /SKU A/,
  );
  assert.doesNotThrow(() => validateMovementInput(input({ items: [item({ sku: 'A', batchNo: 'B1' }), item({ sku: 'A', batchNo: 'B2' })] })));
  assert.doesNotThrow(() => validateMovementInput(input({ items: [item({ sku: 'A', location: 'R1' }), item({ sku: 'A', location: 'R2' })] })));
  assert.doesNotThrow(() => validateMovementInput(input({ items: [item(), item()] })), 'rows without SKU are not compared');
});

test('revision and rejection require a note; approval does not', () => {
  assert.throws(() => requireDecisionNote('request_revision', ' '), /Catatan/);
  assert.throws(() => requireDecisionNote('reject', null), /Catatan/);
  assert.doesNotThrow(() => requireDecisionNote('approve', null));
});

test('DTO normalizes JSON items and never mentions an external sync', () => {
  const dto = movementDto({
    id: 7, entity_id: 1, department_id: 9, inbound_date: new Date('2026-09-24T00:00:00'),
    reference_no: 'PO-9', supplier: 'PT A', items: '[{"product":"Gula","quantity":3,"unit":"sak"}]',
    notes: null, status: 'approved', version: 3, created_by: 4, approval_request_id: 12,
  }, 'inbound');
  assert.equal(dto.type, 'inbound');
  assert.equal(dto.party, 'PT A');
  assert.equal(dto.movementDate, '2026-09-24');
  assert.deepEqual(dto.items[0], { sku: null, product: 'Gula', quantity: 3, unit: 'sak', batchNo: null, expiresOn: null, location: null, note: null });
  assert.equal(dto.version, 3);
  assert.equal(JSON.stringify(dto).toLowerCase().includes('accurate'), false);
  assert.equal(JSON.stringify(dto).toLowerCase().includes('sync'), false);
});

test('migration 033 adds every workflow column and seeds both Supervisor matrices without external sync', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/033_warehouse_movement_approval.sql'), 'utf8');
  for (const table of ['warehouse_inbound', 'warehouse_outbound']) {
    for (const column of ['status', 'created_by', 'submitted_by', 'submitted_at', 'approval_request_id', 'approved_by',
      'approved_at', 'rejected_by', 'rejected_at', 'decision_note', 'cancelled_by', 'cancelled_at', 'cancellation_reason', 'version']) {
      assert.match(sql, new RegExp(`TABLE_NAME='${table}' AND COLUMN_NAME='${column}'`), `${table}.${column}`);
    }
  }
  for (const config of Object.values(MOVEMENT_TYPES)) assert.match(sql, new RegExp(`'${config.requestType}' AS request_type|'${config.requestType}'\\)?$`, 'm'));
  assert.match(sql, /role_key = 'warehouse\.supervisor'/);
  assert.match(sql, /role_key = 'warehouse\.head'/);
  assert.equal(/accurate/i.test(sql), false);
  assert.equal(/DROP |DELETE FROM/i.test(sql), false);
});
