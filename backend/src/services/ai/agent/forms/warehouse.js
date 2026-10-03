// Warehouse forms Prakasa AI may fill (contract: ../formCatalog.js; how to add
// one: docs/prakasa-ai-rencana.md §9.9). Quantities only — this module has no
// prices. The counted quantity of a movement line is the user's: the AI fills
// what a document says (code, product, unit, batch, expiry), the user counts.
const MOVEMENT_FILE = 'pages/warehouse/WarehouseMovementForm.jsx';
const DASHBOARD_FILE = 'pages/warehouse/WarehouseOperations.jsx';
const MOVEMENT_FIELDS = {
  ai: ['movementDate', 'referenceNo', 'party', 'notes',
    'items', 'items.sku', 'items.product', 'items.unit', 'items.batchNo', 'items.expiresOn', 'items.location', 'items.note'],
  userOnly: ['items.quantity'],
};
const MOVEMENT_NOTE = 'Barang diisi sebagai baris (kode barang, produk, satuan, batch, kedaluwarsa, lokasi, catatan). '
  + 'Jumlah tiap baris adalah hasil hitung fisik: hanya diisi pengguna. Baris yang sudah diketik pengguna tidak diubah. '
  + 'Mengajukan ke Supervisor ("Simpan & ajukan") dilakukan pengguna.';

module.exports = [
  {
    id: 'warehouse-movement-inbound', title: 'Buat barang masuk', route: '/warehouse/movements/inbound/new', permission: 'warehouse.movement.create',
    file: MOVEMENT_FILE, fields: MOVEMENT_FIELDS, note: MOVEMENT_NOTE,
  },
  {
    id: 'warehouse-movement-outbound', title: 'Buat barang keluar', route: '/warehouse/movements/outbound/new', permission: 'warehouse.movement.create',
    file: MOVEMENT_FILE, fields: MOVEMENT_FIELDS, note: `${MOVEMENT_NOTE} Tujuan: cabang atau nama pelanggan, tanpa alamat.`,
  },
  {
    id: 'warehouse-movement-inbound-edit', title: 'Ubah draft barang masuk', route: '/warehouse/movements/inbound/<id pergerakan>/edit', permission: 'warehouse.movement.update',
    file: MOVEMENT_FILE, mode: 'edit', record: 'warehouse_movement', fields: MOVEMENT_FIELDS,
    note: `${MOVEMENT_NOTE} Hanya draft atau pergerakan yang diminta revisi yang bisa diubah.`,
  },
  {
    id: 'warehouse-movement-outbound-edit', title: 'Ubah draft barang keluar', route: '/warehouse/movements/outbound/<id pergerakan>/edit', permission: 'warehouse.movement.update',
    file: MOVEMENT_FILE, mode: 'edit', record: 'warehouse_movement', fields: MOVEMENT_FIELDS,
    note: `${MOVEMENT_NOTE} Tujuan: cabang atau nama pelanggan, tanpa alamat. Hanya draft atau pergerakan yang diminta revisi yang bisa diubah.`,
  },
  {
    id: 'warehouse-checklist', title: 'Buat checklist harian', route: '/warehouse/operations?tab=checklist&baru=1', permission: 'warehouse.checklist.manage',
    file: DASHBOARD_FILE,
    fields: { ai: ['checklistDate', 'title', 'items'], userOnly: [] },
    note: 'Item ditulis satu per baris. Mencentang item dan menyelesaikan checklist dilakukan pengguna.',
  },
  {
    id: 'warehouse-incident', title: 'Laporkan insiden', route: '/warehouse/operations?tab=incidents&baru=1', permission: 'warehouse.incident.manage',
    file: DASHBOARD_FILE,
    fields: { ai: ['incidentDate', 'category', 'severity', 'description'], userOnly: [] },
    note: 'Menyelesaikan atau menutup insiden (status dan resolusinya) adalah keputusan pengguna.',
  },
];
