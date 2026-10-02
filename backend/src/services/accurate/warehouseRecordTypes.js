// Warehouse record types in the Accurate mirror (docs/accurate-divisi-rencana.md,
// Warehouse stage 1). Owned by the Warehouse division: every batch of these is
// decided by the Warehouse Supervisor or Head, whatever the customer channel.
//
// Quantities and dates only (owner decision D1): no cost, price, amount, account,
// address or person is ever part of these records — the `dataKeys` allowlist
// refuses anything else at staging, and FORBIDDEN_DATA_RE guards the tests.
//
// Stock is a snapshot, not a document: a record is never marked "missing". A
// row that comes back with a different quantity becomes a new version (the
// versions are the stock history); a stock row that disappears from a complete
// read becomes a version with quantity 0. Rows that are zero and never had
// stock are not stored at all, so the mirror only holds what is (or was) there.

const FORBIDDEN_DATA_RE = /cost|price|amount|total|disc|tax|rate|account|currency|phone|telp|email|npwp|nik|ktp|bank|salesman|note|desc|address|street/i;

// "1 Ctns = 6 Pack" — or just the base unit when there is no other.
function unitsText(data) {
  const base = data?.base_unit || '-';
  const others = Array.isArray(data?.units) ? data.units : [];
  return others.length ? others.map((u) => `1 ${u.name} = ${u.ratio} ${base}`).join(', ') : base;
}

const zeroed = (before) => ({ ...before, data: { ...(before?.data || {}), qty: 0, qty_all_units: null } });

const WAREHOUSE_RECORD_TYPES = Object.freeze({
  wh_warehouse: {
    label: 'Gudang',
    division: 'warehouse',
    missing: 'flag',
    required: ['name'],
    fields: ['name', 'status', 'data'],
    dataKeys: { is_default: null, is_scrap: null },
    labelOf: (row) => row.name,
  },
  wh_stock_total: {
    label: 'Stok barang',
    division: 'warehouse',
    missing: 'snapshot',
    required: ['number'],
    fields: ['number', 'name', 'data'],
    dataKeys: { qty: null, qty_all_units: null, upc: null },
    labelOf: (row) => `${row.name || '-'} (${row.number})`,
    zeroRow: zeroed,
  },
  wh_stock: {
    label: 'Stok per gudang',
    division: 'warehouse',
    missing: 'snapshot',
    required: ['number'],
    fields: ['number', 'name', 'data'],
    dataKeys: { item_id: null, warehouse_id: null, warehouse: null, qty: null, qty_all_units: null },
    labelOf: (row) => `${row.name || '-'} (${row.number}) · ${row.data?.warehouse || '-'}`,
    zeroRow: zeroed,
  },
  // Warehouse stage 2 — documents that move goods (quantities only). A document
  // gone from Accurate, or no longer final there, is marked "tidak ada lagi".
  wh_transfer: {
    label: 'Pindah gudang',
    division: 'warehouse',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'status', 'data'],
    dataKeys: {
      transfer_type: null, out_status: null, from_wh: null, to_wh: null, transit_wh: null,
      lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'received_qty'], _rev: null,
    },
    labelOf: (row) => `${row.number} · ${row.data?.from_wh || '-'} → ${row.data?.to_wh || '-'}`,
  },
  wh_adjustment: {
    label: 'Penyesuaian stok',
    division: 'warehouse',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'status', 'data'],
    dataKeys: { kind: null, lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'warehouse', 'direction'], _rev: null },
    labelOf: (row) => `${row.number} · ${row.data?.lines?.length || 0} baris`,
  },
  wh_receipt: {
    label: 'Penerimaan barang',
    division: 'warehouse',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'status', 'data'],
    dataKeys: {
      vendor_no: null, vendor_name: null, supplier_do: null, ship_date: null, po_numbers: null,
      lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'warehouse', 'po_number'], _rev: null,
    },
    labelOf: (row) => `${row.number} · ${row.data?.vendor_name || '-'}`,
  },
  wh_delivery: {
    label: 'Surat jalan (gudang)',
    division: 'warehouse',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'status', 'data'],
    // No address at all: free text cannot be cleaned of every phone number or ID
    // reliably, and the mirror is permanent. Where it goes = customer + the city
    // in the customer number; the full address stays on the Accurate DO.
    dataKeys: { so_numbers: null, lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'warehouse', 'so_number'], _rev: null },
    labelOf: (row) => `${row.number} · ${row.customer_name || '-'}`,
  },
  // Sales orders not fully shipped yet (program 2.2, "Jadwal kirim"): what the
  // Warehouse still has to ship, line by line, in each line's own unit. A SO
  // that is fully shipped (or closed) leaves this list as "tidak ada lagi".
  // Quantities only; no price, and never the ship-to address.
  wh_so_open: {
    label: 'SO belum terkirim',
    division: 'warehouse',
    missing: 'flag',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'status', 'data'],
    dataKeys: {
      ship_date: null, percent_shipped: null,
      lines: ['item_no', 'item_name', 'qty', 'unit', 'unit_ratio', 'shipped_qty', 'warehouse', 'closed'], _rev: null,
    },
    labelOf: (row) => `${row.number} · ${row.customer_name || '-'}`,
  },
  // Units per item (program 1.3): the base unit and how many base units each
  // other unit holds, so Sales, Warehouse and Procurement can count any quantity
  // in base units. Physical handling, so decided by Warehouse like the stock.
  wh_item_unit: {
    label: 'Satuan barang',
    division: 'warehouse',
    missing: 'flag',
    required: ['number'],
    fields: ['number', 'name', 'data'],
    dataKeys: { base_unit: null, units: ['name', 'ratio'] },
    labelOf: (row) => `${row.name || '-'} (${row.number}) · ${unitsText(row.data)}`,
  },
});

// Stage 1 (stock) is always pulled; the documents only once switched on.
const STOCK_TYPE_NAMES = Object.freeze(['wh_warehouse', 'wh_stock_total', 'wh_stock']);
const DOCUMENT_TYPE_NAMES = Object.freeze(['wh_transfer', 'wh_adjustment', 'wh_receipt', 'wh_delivery']);
// Units per item, once switched on (ACCURATE_ITEM_UNITS=1).
const UNIT_TYPE_NAMES = Object.freeze(['wh_item_unit']);
// Open sales orders, once switched on (ACCURATE_WAREHOUSE_SO=1).
const SO_TYPE_NAMES = Object.freeze(['wh_so_open']);

const WAREHOUSE_TYPE_NAMES = Object.freeze(Object.keys(WAREHOUSE_RECORD_TYPES));

// Stock per item × gudang is keyed by one number (accurate_id is a BIGINT):
// item id × 1,000,000 + warehouse id.
const STOCK_KEY_FACTOR = 1000000n;

function stockKey(itemId, warehouseId) {
  const item = BigInt(itemId);
  const warehouse = BigInt(warehouseId);
  if (item <= 0n || warehouse <= 0n || warehouse >= STOCK_KEY_FACTOR || item >= 9200000000000n) {
    throw new Error(`Kunci stok tidak valid untuk barang ${itemId} di gudang ${warehouseId}`);
  }
  return String(item * STOCK_KEY_FACTOR + warehouse);
}

function splitStockKey(key) {
  const n = BigInt(key);
  return { itemId: String(n / STOCK_KEY_FACTOR), warehouseId: String(n % STOCK_KEY_FACTOR) };
}

module.exports = {
  WAREHOUSE_RECORD_TYPES, WAREHOUSE_TYPE_NAMES, STOCK_TYPE_NAMES, DOCUMENT_TYPE_NAMES, UNIT_TYPE_NAMES, SO_TYPE_NAMES,
  FORBIDDEN_DATA_RE, stockKey, splitStockKey, unitsText,
};
