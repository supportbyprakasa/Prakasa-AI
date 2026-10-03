// Warehouse quantities (program 4.1). The stock tools live in ../supplyTools.js
// with their owner rules (quantities only, never a price, private conversations
// only); this file says which pages they serve, and adds the movement documents
// made in Prakasa Workspace itself (barang masuk / barang keluar).
const { TOOLS } = require('../supplyTools');
const movements = require('../../../warehouseMovement.service');
const { text, int } = require('./_shared');

const MODULES = {
  stok_barang: ['warehouse', 'procurement'],
  jadwal_kirim: ['warehouse'],
  gudang_hari_ini: ['warehouse'],
};

const MOVEMENT_VIEW = 'warehouse.movement.view';
const TYPES = { masuk: 'inbound', keluar: 'outbound' };
const TYPE_LABEL = { inbound: 'barang masuk', outbound: 'barang keluar' };
const STATUSES = {
  draf: 'draft', menunggu_persetujuan: 'pending_approval', diminta_revisi: 'revision_requested', disetujui: 'approved', ditolak: 'rejected', dibatalkan: 'cancelled',
};
const STATUS_LABEL = Object.fromEntries(Object.entries(STATUSES).map(([label, key]) => [key, label]));
const MAX_LINES = 100;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const day = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const moment = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const routeOf = (m) => `/warehouse/movements/${m.type}/${m.id}`;
const editable = (m) => ['draft', 'revision_requested'].includes(m.status);

// One movement as the list shows it: who, when, how many lines — no line detail.
const header = (m) => ({
  id: m.id,
  jenis: TYPE_LABEL[m.type] || m.type,
  tanggal: day(m.movementDate),
  nomor_referensi: m.referenceNo,
  // Inbound: the supplier. Outbound: a branch or a customer name, never a street.
  [m.type === 'inbound' ? 'pemasok' : 'tujuan']: m.party,
  status: STATUS_LABEL[m.status] || m.status,
  jumlah_baris: m.items.length,
  dibuat_oleh: m.createdByName,
  diajukan_pada: moment(m.submittedAt),
  disetujui_oleh: m.approvedByName,
  disetujui_pada: moment(m.approvedAt),
  rute: routeOf(m),
  ...(editable(m) ? { rute_ubah: `${routeOf(m)}/edit` } : {}),
});

// The movement documents of Prakasa Workspace: what came in and what went out,
// with their approval state. Quantities only — a movement holds no price.
const pergerakanGudang = {
  name: 'pergerakan_gudang',
  module: ['warehouse'],
  label: 'Membaca dokumen pergerakan gudang',
  description: 'Dokumen pergerakan gudang yang dibuat di Prakasa Workspace: barang masuk dan barang keluar, dengan tanggal, nomor referensi, pemasok atau tujuan, status '
    + '(draf, menunggu persetujuan, diminta revisi, disetujui, ditolak, dibatalkan), jumlah baris, pembuat, dan penyetujunya. '
    + 'Dengan jenis + id: satu dokumen beserta baris barangnya (kode, produk, jumlah, satuan, batch, kedaluwarsa, lokasi, catatan) dan catatan keputusannya. '
    + 'Bisa disaring per jenis, status, rentang tanggal, atau kata (nomor referensi, pemasok, tujuan). Mengikuti aturan halaman Warehouse: di luar divisi Warehouse hanya dokumen yang sudah disetujui atau dibatalkan. '
    + 'Pakai untuk "pergerakan mana yang menunggu persetujuan", "barang masuk minggu ini", "isi dokumen barang keluar nomor …". '
    + 'Hanya jumlah dan status: tanpa harga, nilai barang, atau alamat; tidak pernah menyetujui, mengajukan, atau mengubah dokumen.',
  inputSchema: {
    type: 'object',
    properties: {
      jenis: { type: 'string', enum: Object.keys(TYPES), description: 'masuk atau keluar; kosong = keduanya (wajib bila id diisi)' },
      id: { type: 'integer', minimum: 1, description: 'Id dokumen: hasilnya satu dokumen dengan baris barangnya' },
      status: { type: 'string', enum: Object.keys(STATUSES) },
      dari: { type: 'string', description: 'Tanggal awal YYYY-MM-DD' },
      sampai: { type: 'string', description: 'Tanggal akhir YYYY-MM-DD' },
      cari: { type: 'string', maxLength: 80, description: 'Nomor referensi, pemasok, atau tujuan' },
      jumlah: { type: 'integer', minimum: 1, maximum: 50, description: 'Maksimal dokumen (default 20)' },
    },
    additionalProperties: false,
  },
  permission: MOVEMENT_VIEW,
  privateOnly: true,
  async run(user, input = {}) {
    const type = TYPES[input.jenis] || null;
    if (Number.isInteger(input.id) && input.id > 0) {
      if (!type) return { ditemukan: false, catatan: 'Sebut jenisnya (masuk atau keluar) bersama id dokumen.' };
      let m;
      try {
        m = await movements.get({ user, type, id: input.id });
      } catch (error) {
        if (error?.status === 404 || error?.status === 403) return { ditemukan: false, catatan: 'Dokumen pergerakan itu tidak ditemukan, atau tidak boleh Anda lihat.' };
        throw error;
      }
      return {
        ditemukan: true,
        dokumen: {
          ...header(m),
          catatan: m.notes,
          catatan_keputusan: m.decisionNote,
          alasan_batal: m.cancellationReason,
          barang: m.items.slice(0, MAX_LINES).map((item, index) => ({
            no: index + 1, kode: item.sku, produk: item.product, jumlah: item.quantity, satuan: item.unit,
            batch: item.batchNo, kedaluwarsa: day(item.expiresOn), lokasi: item.location, catatan: item.note,
          })),
          ...(m.items.length > MAX_LINES ? { barang_terpotong: true } : {}),
          boleh_diubah: m.permissions?.canEdit === true,
          boleh_diajukan: m.permissions?.canSubmit === true,
        },
        keterangan: 'Jumlah adalah hasil hitung yang dicatat pembuat dokumen. Menyetujui, mengajukan, dan mengubah dilakukan pengguna di halamannya.',
      };
    }
    const limit = int(input.jumlah, { min: 1, max: 50, fallback: 20 });
    const result = await movements.list({
      user,
      type: type || undefined,
      status: STATUSES[input.status] || undefined,
      from: isDate(input.dari) ? input.dari : undefined,
      to: isDate(input.sampai) ? input.sampai : undefined,
      q: text(input.cari, 80) || undefined,
      page: 1,
      limit,
    });
    const visible = result.statusesVisible.map((status) => STATUS_LABEL[status] || status);
    return {
      rute: '/warehouse',
      total_cocok: result.total,
      ditampilkan: result.rows.length,
      status_yang_boleh_dilihat: visible,
      dokumen: result.rows.map(header),
      ...(result.rows.length ? {} : { catatan: 'Tidak ada dokumen pergerakan yang cocok di antara yang boleh Anda lihat.' }),
      keterangan: 'Untuk baris barang satu dokumen, panggil lagi dengan jenis dan id-nya. Tanpa harga: dokumen pergerakan hanya memuat jumlah.',
    };
  },
};

module.exports = [
  ...TOOLS.filter((tool) => MODULES[tool.name]).map((tool) => ({ ...tool, module: MODULES[tool.name] })),
  pergerakanGudang,
];
