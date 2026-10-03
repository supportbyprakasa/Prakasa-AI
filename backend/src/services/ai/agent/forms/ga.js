// GA forms Prakasa AI may fill (contract: ../formCatalog.js; how to add one:
// docs/prakasa-ai-rencana.md §9.9).
const FILE = 'pages/ga/GaForms.jsx';
const OPS = 'pages/ga/GaOpsDialogs.jsx';

// Operasional GA (Wave C2): one add form and one edit form per register. Rupiah
// (biaya, tagihan), the customer / meter number, the day a bill was paid, the
// usage figure copied from a bill and a status are the user's.
const MAINTENANCE = ['name', 'category', 'locationId', 'vendorName', 'intervalDays', 'lastDoneOn', 'nextDueOn', 'notes'];
const CONTRACT = ['vendorName', 'kind', 'description', 'locationId', 'startOn', 'endOn', 'noticeDays', 'notes'];
// usageAmount is the kWh / m³ on the bill, not rupiah (fieldPolicy.js NOT_MONEY).
const BILL = ['utility', 'locationId', 'period', 'usageAmount', 'dueOn', 'notes'];
const BILL_USER = ['customerNumber', 'amount', 'paidOn'];

module.exports = [
  {
    id: 'ga-request-facility_repair', title: 'Perbaikan fasilitas', route: '/ga?baru=facility_repair', permission: 'ga.request.create',
    file: FILE,
    fields: { ai: ['locationId', 'area', 'description', 'urgent'], userOnly: ['photo'] },
    note: 'Foto atau lampiran dipilih pengguna sendiri.',
  },
  {
    id: 'ga-request-other', title: 'Permintaan lainnya (GA)', route: '/ga?baru=other', permission: 'ga.request.create',
    file: FILE,
    fields: { ai: ['locationId', 'title', 'description'], userOnly: [] },
    note: 'Disetujui atasan dulu setelah pengguna mengirimnya.',
  },
  {
    id: 'ga-request-atk', title: 'Permintaan ATK', route: '/ga?baru=atk', permission: 'ga.request.create',
    file: FILE,
    fields: { ai: ['locationId', 'note', 'items', 'items.itemName', 'items.qty', 'items.unit'], userOnly: [] },
    note: 'Daftar barang diisi sebagai baris (nama barang, jumlah, satuan). Baris yang sudah diketik pengguna tidak diubah.',
  },
  {
    id: 'ga-booking-room', title: 'Pinjam ruang', route: '/ga?form=pinjam-ruang', permission: 'ga.request.create',
    file: FILE,
    fields: { ai: ['resourceId', 'date', 'start', 'end', 'purpose'], userOnly: [] },
    note: 'Jam memakai kelipatan 15 menit. Bila jam bentrok dengan jadwal ruang itu, kolom jam ditolak: tawarkan jam lain ke pengguna. Peminjaman kendaraan lewat TrackCar, bukan di sini. Pengguna yang menekan Pesan ruang.',
  },
  {
    id: 'ga-resource', title: 'Tambah ruang', route: '/ga?tab=sumber&form=ruang', permission: 'ga.resource.manage',
    file: FILE,
    fields: { ai: ['name', 'locationId', 'capacity', 'notes'], userOnly: [] },
    note: 'Hanya ruang (kendaraan dikelola di TrackCar). Pengguna yang menekan Simpan.',
  },
  {
    id: 'ga-resource-edit', title: 'Ubah ruang', route: '/ga?tab=sumber&ubah=<id ruang>', permission: 'ga.resource.manage',
    file: FILE, mode: 'edit', record: 'ga_resource',
    fields: { ai: ['name', 'locationId', 'capacity', 'notes'], userOnly: [] },
    note: 'Menonaktifkan atau mengaktifkan ruang adalah keputusan pengguna lewat menu aksi, bukan kolom formulir ini.',
  },
  {
    id: 'ga-request-assign', title: 'Tugaskan permintaan', route: '/ga/requests/<id permintaan>?form=tugaskan', permission: 'ga.request.process',
    file: 'pages/ga/GaRequestDetail.jsx', mode: 'edit', record: 'ga_request',
    fields: { ai: ['assignee'], userOnly: [] },
    note: 'Penanggung jawab dicari dari daftar pemroses GA di halaman; bila nama tidak tepat satu, tanyakan ke pengguna. Menyetujui, menolak, menyelesaikan, membatalkan, dan melampirkan file tetap dilakukan pengguna.',
  },
  {
    id: 'ga-ops-maintenance', title: 'Tambah jadwal perawatan', route: '/ga/operations?tab=maintenance&baru=1', permission: 'ga.ops.manage',
    file: OPS,
    fields: { ai: MAINTENANCE, userOnly: [] },
    note: 'Jadwal berikutnya boleh dikosongkan: dihitung dari perawatan terakhir + interval. Pengguna yang menekan Simpan.',
  },
  {
    id: 'ga-ops-maintenance-edit', title: 'Ubah jadwal perawatan', route: '/ga/operations?tab=maintenance&ubah=<id jadwal perawatan>', permission: 'ga.ops.manage',
    file: OPS, mode: 'edit', record: 'ga_maintenance_item',
    fields: { ai: MAINTENANCE, userOnly: ['status'] },
    note: 'Status (aktif / tidak dipakai) diubah pengguna.',
  },
  {
    id: 'ga-ops-contract', title: 'Tambah kontrak', route: '/ga/operations?tab=contracts&baru=1', permission: 'ga.ops.manage',
    file: OPS,
    fields: { ai: CONTRACT, userOnly: ['monthlyCost'] },
    note: 'Biaya per bulan (rupiah) diisi pengguna.',
  },
  {
    id: 'ga-ops-contract-edit', title: 'Ubah kontrak', route: '/ga/operations?tab=contracts&ubah=<id kontrak>', permission: 'ga.ops.manage',
    file: OPS, mode: 'edit', record: 'ga_contract',
    fields: { ai: CONTRACT, userOnly: ['monthlyCost', 'status'] },
    note: 'Biaya per bulan (rupiah) dan status kontrak (aktif / selesai) diubah pengguna.',
  },
  {
    id: 'ga-ops-bill', title: 'Catat tagihan', route: '/ga/operations?tab=bills&baru=1', permission: 'ga.ops.manage',
    file: OPS,
    fields: { ai: BILL, userOnly: BILL_USER },
    note: 'Jumlah tagihan (rupiah), ID pelanggan / nomor meter, dan tanggal dibayar disalin pengguna dari tagihannya. Pemakaian (kWh atau m³) boleh diisi AI bila pengguna menyebut angkanya. Pembayaran tetap diajukan lewat Finance.',
  },
  {
    id: 'ga-ops-bill-edit', title: 'Ubah tagihan', route: '/ga/operations?tab=bills&ubah=<id tagihan>', permission: 'ga.ops.manage',
    file: OPS, mode: 'edit', record: 'ga_utility_bill',
    fields: { ai: BILL, userOnly: BILL_USER },
    note: 'Jumlah tagihan (rupiah), ID pelanggan / nomor meter, dan tanggal dibayar (tanda lunas) diubah pengguna. Pemakaian (kWh atau m³) boleh diisi AI bila pengguna menyebut angkanya.',
  },
  {
    id: 'ga-ops-maintenance-log', title: 'Catat perawatan', route: '/ga/operations?tab=maintenance&open=<id jadwal perawatan>&form=catat-perawatan',
    // POST /ga/ops/maintenance/:id/logs: ga.ops.view AND (the Supervisor / Head: ga.ops.manage, or GA staff: ga.request.process).
    permission: ['ga.ops.manage', 'ga.request.process'], requires: ['ga.ops.view'],
    file: OPS,
    fields: { ai: ['doneOn', 'result', 'note'], userOnly: ['cost'] },
    note: 'Biaya (rupiah) diisi pengguna. Hanya untuk jadwal yang aktif, dan hanya bagi yang boleh mencatat perawatan (tombol Catat perawatan tampil). Menyimpan memajukan jadwal berikutnya: pengguna yang menekan Simpan.',
  },
];
