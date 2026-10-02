import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMovementItem, movementAiErrors } from '../src/pages/warehouse/warehouseMovementModel.js';
import { escalationRecordId, findEscalation } from '../src/pages/advanced/escalationsModel.js';
import { findTargetCell, normalizeTargets, targetRecordId } from '../src/pages/advanced/targetsModel.js';
import { createFormRegistry, describeForm, fillForm, undoFill } from '../src/components/ai/aiFormModel.js';
import { bindAIForm, defineAIForm, f } from '../src/components/ai/aiFormFields.js';

// Pure helpers behind the Finance / Warehouse / Management forms Prakasa AI may
// fill (Wave C2, docs/prakasa-ai-rencana.md §9.9).

const line = (patch) => ({ ...emptyMovementItem(), ...patch });

test('movementAiErrors: a missing quantity is the user\'s to fill, a duplicate SKU refuses the rows', () => {
  const base = { movementDate: '2026-10-02', referenceNo: '', party: '', notes: '' };
  // No quantity anywhere: nothing here refuses the AI's rows.
  assert.deepEqual(movementAiErrors({ ...base, items: [line({ sku: 'MKR-002', product: 'Makaroni', unit: 'Ctns' })] }), {});
  assert.deepEqual(movementAiErrors({ ...base, movementDate: '', items: [line({})] }), { movementDate: 'Tanggal transaksi wajib diisi.' });
  const twice = movementAiErrors({ ...base, items: [line({ sku: 'MKR-002', product: 'A', unit: 'Pcs' }), line({ sku: 'mkr-002', product: 'B', unit: 'Pcs' })] });
  assert.match(twice.items, /^Baris 2: Sama dengan baris 1/);
  // Another batch is another line.
  assert.deepEqual(movementAiErrors({ ...base, items: [line({ sku: 'MKR-002', product: 'A', unit: 'Pcs', batchNo: 'B1' }), line({ sku: 'MKR-002', product: 'A', unit: 'Pcs', batchNo: 'B2' })] }), {});
});

test('a movement line: the AI fills what the document says, never the counted quantity; the user\'s rows stay', () => {
  const definition = defineAIForm({
    id: 'warehouse-movement-inbound', title: 'Buat barang masuk', permission: 'warehouse.movement.create', submitLabel: 'Simpan draft',
    fields: [
      f.date('movementDate', 'Tanggal transaksi', { required: true }),
      f.rows('items', 'Barang', [
        f.text('sku', 'Kode barang Accurate', { maxLength: 80 }),
        f.text('product', 'Produk', { required: true, maxLength: 190 }),
        f.userOnly('quantity', 'Jumlah', 'number', { required: true }),
        f.text('unit', 'Satuan', { required: true, maxLength: 40 }),
        f.date('expiresOn', 'Kedaluwarsa'),
      ], { required: true, maxRows: 50, emptyRow: emptyMovementItem }),
    ],
  });
  let values = { movementDate: '2026-10-02', items: [line({ sku: 'GLA-001', product: 'Gula milik pengguna', quantity: '7', unit: 'Sak' }), emptyMovementItem()] };
  const initial = { movementDate: '2026-10-02', items: [emptyMovementItem()] };
  const registry = createFormRegistry();
  registry.register('warehouse-movement-inbound', () => bindAIForm(definition, {
    values, setValues: (update) => { values = update(values); }, initialValues: initial, validate: movementAiErrors,
  }));
  const entry = registry.get('warehouse-movement-inbound');
  const described = describeForm(entry).kolom.find((field) => field.nama === 'items');
  assert.equal(described.kolom_baris.find((column) => column.nama === 'quantity').bisa_diisi, false);
  assert.equal(described.baris[0].isi.quantity, undefined, 'a user-only cell is never read');

  const result = fillForm(entry, [{ kolom: 'items', baris: [
    { sku: 'MKR-002', product: 'Makaroni', quantity: '12', unit: 'Ctns', expiresOn: '31/12/2027', unitPrice: '15000' },
    { sku: 'KCP-001', quantity: '3', unit: 'Pcs' }, // no product: refused
  ] }], { registry });
  assert.deepEqual(result.diisi, ['items']);
  assert.deepEqual(result.baris, { items: 1 });
  const refused = Object.fromEntries(result.ditolak.map((item) => [item.nama, item.alasan]));
  assert.equal(refused['items[1].quantity'], 'Kolom ini hanya diisi pengguna.');
  assert.equal(refused['items[1].unitPrice'], 'Kolom ini tidak ada di formulir.');
  assert.match(refused['items[2]'], /Produk/);
  assert.equal(values.items.length, 2, 'the empty row made room');
  assert.equal(values.items[0].product, 'Gula milik pengguna');
  assert.equal(values.items[0].quantity, '7');
  assert.deepEqual({ sku: values.items[1].sku, product: values.items[1].product, quantity: values.items[1].quantity, unit: values.items[1].unit, expiresOn: values.items[1].expiresOn },
    { sku: 'MKR-002', product: 'Makaroni', quantity: '', unit: 'Ctns', expiresOn: '2027-12-31' });
  assert.ok(values.items[1].key, 'the row keeps the form\'s own key');

  undoFill(entry, registry);
  assert.deepEqual(values.items.map((item) => item.product), ['Gula milik pengguna'], 'undo removes the AI row only');
});

test('escalation record id: one URL-safe word per row, found again in the loaded queue', () => {
  const items = [{ source: 'approval_aged', sourceId: 41 }, { source: 'tracker_issue_overdue', sourceId: 7 }];
  assert.equal(escalationRecordId(items[0]), 'approval_aged-41');
  // The whole source key stays in the id (the limit is 100 characters since Wave C2, the same on the server).
  assert.equal(escalationRecordId({ source: 'warehouse_recon_not_in_accurate', sourceId: 1234567890 }), 'warehouse_recon_not_in_accurate-1234567890');
  assert.match(escalationRecordId({ source: 'x'.repeat(150), sourceId: 1 }), /^[A-Za-z0-9_-]{100}$/);
  assert.equal(escalationRecordId({ source: 'a:b', sourceId: 'x/1' }), 'a_b-x_1');
  assert.equal(escalationRecordId(null), '');
  assert.equal(escalationRecordId({ source: 'approval_aged' }), '');
  assert.equal(findEscalation(items, 'tracker_issue_overdue-7'), items[1]);
  assert.equal(findEscalation(items, 'tracker_issue_overdue-8'), null);
  assert.equal(findEscalation(items, ''), null);
  assert.equal(findEscalation(null, 'approval_aged-41'), null);
});

test('target record id: the cell of a division and a metric, whatever module is shown', () => {
  const data = normalizeTargets({
    period: { key: '2026-Q4', label: 'Kuartal 4 2026' },
    metrics: [
      { key: 'sales_orders', label: 'SO', unit: 'count', provider: 'sales', providerLabel: 'Sales' },
      { key: 'warehouse_movements_approved', label: 'Pergerakan disetujui', unit: 'count', provider: 'warehouse', providerLabel: 'Warehouse' },
    ],
    divisions: [{ id: 3, name: 'Sales' }, { id: 5, name: 'Warehouse' }],
    cells: [{ departmentId: 5, metricKey: 'warehouse_movements_approved', target: 40, note: 'Disepakati', status: 'on_track' }],
    canEdit: true,
  });
  assert.equal(targetRecordId(5, 'warehouse_movements_approved'), '5-warehouse_movements_approved');
  assert.match(targetRecordId(12345, 'finance_receivable_overdue_share'), /^[A-Za-z0-9_-]{1,40}$/);
  assert.equal(targetRecordId(null, 'x'), '');
  const found = findTargetCell(data, '5-warehouse_movements_approved');
  assert.equal(found.division.id, 5);
  assert.equal(found.metric.key, 'warehouse_movements_approved');
  assert.equal(found.cell.note, 'Disepakati');
  const empty = findTargetCell(data, '3-sales_orders');
  assert.equal(empty.cell.status, 'no_target', 'a cell without a target still opens');
  assert.equal(findTargetCell(data, '9-sales_orders'), null);
  assert.equal(findTargetCell(data, ''), null);
});
