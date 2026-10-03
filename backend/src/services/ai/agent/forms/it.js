// IT forms Prakasa AI may fill (contract: ../formCatalog.js; how to add one:
// docs/prakasa-ai-rencana.md §9.9). The AI never saves: the user reviews the
// fields and presses the form's own button.
//
// Infrastructure and device identifiers — IP address, serial number, IMEI, MAC
// address, ISP customer number, vendor portal address, phone numbers — and
// every rupiah amount are in `userOnly`: never filled by the AI, and their
// value is never read to the model (a field outside `ai` has no `isi` in
// baca_formulir). Licence keys and credentials are not fields of any form
// here: the app does not store them.

const INFRA = '/it/infrastructure';
const NO_SECRET = 'Jangan menulis kata sandi atau kredensial di kolom mana pun.';

// The six registers of Infrastruktur IT: one form to add, one to edit.
// `permission`: a list means "any of" (the vendor register is also open to software_vendor.manage).
const register = (kind, { tab, add, edit, record, ai, userOnly, editOnly = [], note, permission = 'it.infra.manage' }) => [
  {
    id: `it-infra-${kind}`, title: add, route: `${INFRA}?tab=${tab}&baru=1`, permission,
    file: 'pages/it/InfraDialogs.jsx',
    fields: { ai, userOnly: userOnly.filter((name) => !editOnly.includes(name)) },
    note: `${note} ${NO_SECRET}`,
  },
  {
    id: `it-infra-${kind}-edit`, title: edit, route: `${INFRA}?tab=${tab}&ubah=<id baris>`, permission,
    file: 'pages/it/InfraDialogs.jsx', mode: 'edit', record,
    fields: { ai, userOnly },
    note: `${note} ${NO_SECRET}`,
  },
];

const DEVICE_AI = ['deviceType', 'model', 'assetCode', 'purchaseYear', 'locationId', 'ramGb', 'storageGb', 'osVersion', 'purchaseDate', 'supplier',
  'conditionState', 'warrantyStart', 'warrantyEnd', 'warrantyType', 'notes'];
const DEVICE_USER_ONLY = ['serialNumber', 'imei', 'macAddress', 'purchasePrice'];
const DEVICE_NOTE = 'Nomor seri, IMEI, MAC address, dan harga beli diisi pengguna.';

module.exports = [
  {
    id: 'it-ticket', title: 'Tiket IT', route: '/it/tickets/new', permission: 'it_ticket.create',
    file: 'pages/it/ItTicketForm.jsx',
    fields: { ai: ['category', 'priority', 'title', 'description', 'deviceId'], userOnly: [] },
    note: 'Tiket untuk tim IT. Perangkat terkait hanya bila kategorinya kerusakan perangkat.',
  },
  {
    id: 'it-help', title: 'Butuh bantuan IT', route: '<halaman saat ini>?bantuan=it', permission: 'it_ticket.create',
    file: 'components/support/ItHelpSheet.jsx',
    fields: { ai: ['category', 'title', 'description', 'priority', 'deviceId'], userOnly: [] },
    note: 'Lembar singkat dari bar atas; hasilnya tiket IT yang sama.',
  },
  {
    id: 'it-ticket-comment', title: 'Tanggapan tiket IT', route: '/it/tickets/<id tiket>', permission: 'it_ticket.comment',
    file: 'pages/it/ItTicketDetail.jsx',
    fields: { ai: ['comment'], userOnly: [] },
    note: 'Hanya teks tanggapan; pengguna yang menekan Kirim tanggapan. Status tiket dan lampiran diubah pengguna lewat tombol di halaman.',
  },

  // ---------------------------------------------------------------- devices
  {
    id: 'it-device', title: 'Tambah perangkat', route: '/it/devices?baru=1', permission: 'device.manage',
    file: 'pages/it/DeviceDialogs.jsx',
    fields: { ai: DEVICE_AI, userOnly: DEVICE_USER_ONLY },
    note: `${DEVICE_NOTE} Perangkat baru berstatus Cadangan.`,
  },
  {
    id: 'it-device-edit', title: 'Ubah perangkat', route: '/it/devices/<id perangkat>?ubah=1', permission: 'device.manage',
    file: 'pages/it/DeviceDialogs.jsx', mode: 'edit', record: 'device',
    fields: { ai: DEVICE_AI, userOnly: DEVICE_USER_ONLY },
    note: `${DEVICE_NOTE} Status diubah lewat formulir status, bukan di sini.`,
  },
  {
    id: 'it-device-status', title: 'Ubah status perangkat', route: '/it/devices/<id perangkat>?form=status', permission: 'device.manage',
    file: 'pages/it/DeviceDialogs.jsx', mode: 'edit', record: 'device',
    fields: { ai: ['holderMode', 'entryKey', 'label', 'note'], userOnly: ['status'] },
    note: 'Status baru dipilih pengguna. Untuk menyerahkan perangkat buka rute dengan form=serahkan (status Aktif sudah terpilih): AI mengisi pemegang (orang di direktori atau label tim) dan keperluan. Kolom pemegang dan catatan baru muncul setelah status dipilih.',
  },
  {
    id: 'it-device-return', title: 'Kembalikan perangkat', route: '/it/devices/<id perangkat>?form=kembalikan', permission: 'device.assign',
    file: 'pages/it/DeviceDialogs.jsx', mode: 'edit', record: 'device_assignment',
    fields: { ai: ['condition', 'notes'], userOnly: [] },
    note: 'Hanya untuk perangkat yang sedang dipegang. Kondisi Kurang atau Rusak membuat perangkat berstatus Rusak saat pengguna menekan Kembalikan perangkat.',
  },
  {
    id: 'it-device-maintenance', title: 'Catat perawatan', route: '/it/devices/<id perangkat>?form=perawatan', permission: 'device.log.manage',
    file: 'pages/it/DeviceDetail.jsx',
    fields: { ai: ['maintenanceDate', 'maintenanceType', 'description', 'performedBy', 'nextMaintenanceDate'], userOnly: ['cost'] },
    note: 'Biaya diisi pengguna.',
  },
  {
    id: 'it-device-repair', title: 'Catat perbaikan di vendor', route: '/it/devices/<id perangkat>?form=perbaikan', permission: 'device.log.manage',
    file: 'pages/it/DeviceDetail.jsx',
    fields: { ai: ['reportedDate', 'severity', 'issueDescription', 'vendorName'], userOnly: [] },
    note: 'Saat disimpan pengguna, perangkat berstatus Perbaikan.',
  },
  {
    id: 'it-bast-device', title: 'BAST perangkat', route: '/it/devices/<id perangkat>?form=bast-serah-terima',
    permission: ['device.handover.manage', 'ga.ops.manage'], // POST /it/assignments/:id/bast accepts either
    file: 'pages/it/BastDialog.jsx',
    fields: { ai: ['team', 'accessories', 'conditionCode', 'condition', 'notes'], userOnly: ['acknowledgerUserId'] },
    note: 'BAST serah terima untuk pemegang saat ini; form=bast-pengembalian untuk pengembalian terakhir. "Mengetahui" (penanda tangan) dipilih pengguna. Dokumen Google Docs baru dibuat saat pengguna menekan Buat BAST.',
  },
  {
    id: 'it-location', title: 'Tambah lokasi', route: '/it/devices?tab=lokasi&baru=1', permission: 'device.manage',
    file: 'pages/it/LocationsPanel.jsx',
    fields: { ai: ['name', 'kind', 'notes'], userOnly: [] },
    note: 'Lokasi kantor, toko, atau gudang perusahaan.',
  },
  {
    id: 'it-location-edit', title: 'Ubah lokasi', route: '/it/devices?tab=lokasi&ubah=<id lokasi>', permission: 'device.manage',
    file: 'pages/it/LocationsPanel.jsx', mode: 'edit', record: 'it_location',
    fields: { ai: ['name', 'kind', 'notes'], userOnly: ['isActive'] },
    note: 'Mengaktifkan atau menonaktifkan lokasi ("Aktif") dilakukan pengguna.',
  },

  // ---------------------------------------------------------------- subscriptions
  {
    id: 'it-subscription', title: 'Tambah langganan', route: '/it/subscriptions?baru=1', permission: 'subscription.manage',
    file: 'pages/it/SoftwareSubscriptions.jsx',
    fields: { ai: ['productName', 'planName', 'totalSeats', 'startDate', 'renewalDate', 'billingCycle'], userOnly: ['unitPrice'] },
    note: 'Harga per seat diisi pengguna.',
  },
  {
    id: 'it-subscription-invoice', title: 'Catat invoice langganan', route: '/it/subscriptions?form=invoice&langganan=<id langganan>', permission: 'subscription.invoice.manage',
    file: 'pages/it/SoftwareSubscriptions.jsx',
    fields: { ai: ['invoiceNumber', 'invoiceDate', 'jurnalReferenceId'], userOnly: ['amount', 'taxAmount', 'totalAmount', 'currency', 'file'] },
    note: 'Subtotal, pajak, total (harus subtotal + pajak), mata uang, dan file PDF diisi pengguna. Tanpa PDF, invoice tercatat "Menunggu file PDF" dan belum bisa diverifikasi. jurnalReferenceId adalah Nomor bukti di Accurate, dicatat manual; aplikasi tidak menyinkronkan Accurate.',
  },
  {
    id: 'it-license', title: 'Tambah lisensi', route: '/it/subscriptions/<id langganan>?form=lisensi', permission: 'subscription.license.manage',
    file: 'pages/it/SubscriptionDetail.jsx',
    fields: { ai: ['seatLabel'], userOnly: [] },
    note: 'Hanya label seat. Kunci lisensi tidak disimpan di aplikasi dan tidak boleh ditulis di label.',
  },

  // ---------------------------------------------------------------- infrastructure
  ...register('network', {
    tab: 'network', add: 'Tambah perangkat jaringan', edit: 'Ubah perangkat jaringan', record: 'it_network_device',
    ai: ['deviceType', 'brandModel', 'locationId', 'installedYear', 'ispLinkId', 'firmwareUpdatedOn', 'notes'],
    userOnly: ['serialNumber', 'ipAddress', 'status'],
    note: 'Alamat IP, nomor seri, dan status diisi pengguna; isinya tidak dibacakan ke AI.',
  }),
  ...register('isp', {
    tab: 'isp', add: 'Tambah ISP', edit: 'Ubah ISP', record: 'it_isp_link',
    ai: ['providerName', 'locationId', 'vendorId', 'bandwidthMbps', 'isBackup', 'publicIpDedicated', 'contractStart', 'contractEnd', 'notes'],
    userOnly: ['customerNumber', 'monthlyCost', 'status'],
    note: 'No. pelanggan, biaya per bulan, dan status diisi pengguna; isinya tidak dibacakan ke AI.',
  }),
  ...register('cctv', {
    tab: 'cctv', add: 'Tambah CCTV', edit: 'Ubah CCTV', record: 'it_cctv',
    ai: ['locationId', 'cameraCount', 'cameraModel', 'recorderType', 'recorderDeviceId', 'remoteAccess', 'sameNetworkAsPc', 'notes'],
    userOnly: ['serialNumber'],
    note: 'Nomor seri diisi pengguna. Status CCTV diubah lewat formulir Ubah status CCTV.',
  }),
  ...register('backup', {
    tab: 'backup', add: 'Tambah backup', edit: 'Ubah backup', record: 'it_backup',
    ai: ['dataScope', 'method', 'frequency', 'storageLocation', 'locationId', 'retention', 'notes'],
    userOnly: ['status'], editOnly: ['status'],
    note: 'Status (aktif / tidak aktif) diubah pengguna.',
  }),
  ...register('phone', {
    tab: 'phone', add: 'Tambah nomor', edit: 'Ubah nomor', record: 'it_phone_line',
    ai: ['kind', 'extension', 'locationId', 'provider', 'planName', 'startedOn', 'deviceId', 'notes'],
    userOnly: ['number', 'monthlyCost', 'status'], editOnly: ['status'],
    note: 'Nomor telepon, biaya per bulan, dan status diisi pengguna. Hanya nomor milik perusahaan; PIN, PUK, dan nomor SIM tidak dicatat.',
  }),
  ...register('vendor', {
    tab: 'vendor', add: 'Tambah vendor', edit: 'Ubah vendor', record: 'it_vendor',
    permission: ['it.infra.manage', 'software_vendor.manage'], // POST / PATCH /it/vendors
    ai: ['name', 'vendorKind', 'contactPerson', 'email', 'notes'],
    userOnly: ['phone', 'portalUrl'],
    note: 'Telepon PIC dan alamat portal vendor diisi pengguna; isinya tidak dibacakan ke AI. Akun atau kata sandi portal tidak pernah dicatat.',
  }),
  {
    id: 'it-cctv-status', title: 'Ubah status CCTV', route: `${INFRA}?tab=cctv&open=<id cctv>&form=status`, permission: 'it.infra.manage',
    file: 'pages/it/InfraDialogs.jsx', mode: 'edit', record: 'it_cctv',
    fields: { ai: ['camerasOffline', 'note'], userOnly: ['status'] },
    note: `Status dipilih pengguna; jumlah kamera offline hanya ada bila statusnya Sebagian offline. ${NO_SECRET}`,
  },
  {
    id: 'it-backup-check', title: 'Catat pemeriksaan backup', route: `${INFRA}?tab=backup&open=<id backup>&form=pemeriksaan`, permission: 'it.infra.manage',
    file: 'pages/it/InfraDialogs.jsx',
    fields: { ai: ['checkedOn', 'result', 'restoreTested', 'note'], userOnly: [] },
    note: `Hasil pemeriksaan diisi sesuai yang dikatakan pengguna, tidak ditebak. ${NO_SECRET}`,
  },
  {
    id: 'it-gws-review', title: 'Catat review Google Workspace', route: `${INFRA}?tab=gws&baru=1`, permission: 'it.infra.manage',
    file: 'pages/it/InfraDialogs.jsx',
    fields: { ai: ['reviewedOn', 'activeUsers', 'superAdmins', 'exUsersActive', 'mfaEnforced', 'externalSharingRestricted', 'sharedAccountsUsed', 'notes'], userOnly: [] },
    note: 'Angka dan jawaban ya/tidak berasal dari konsol admin Google yang dibaca pengguna: tanyakan, jangan ditebak. Nama atau email akun admin, kode pemulihan, dan kata sandi tidak dicatat.',
  },
  {
    id: 'it-phone-holder', title: 'Ganti pemegang', route: `${INFRA}?tab=phone&open=<id nomor>&form=pemegang`, permission: 'it.infra.manage',
    file: 'pages/it/InfraDialogs.jsx', mode: 'edit', record: 'it_phone_line',
    fields: { ai: ['mode', 'entryKey', 'label'], userOnly: [] },
    note: 'Pemegang: orang di direktori (dicari dengan namanya), nama tim, atau tanpa pemegang (nomor menjadi Cadangan). Kolom orang atau nama tim muncul sesuai pilihan Pemegang.',
  },
  {
    id: 'it-bast-phone', title: 'BAST nomor perusahaan', route: `${INFRA}?tab=phone&open=<id nomor>&form=bast-serah-terima`,
    permission: ['it.infra.manage', 'ga.ops.manage'], // POST /it/infrastructure/phone-lines/:id/bast
    file: 'pages/it/BastDialog.jsx',
    fields: { ai: ['team', 'holderName', 'holderPosition', 'holderDivision', 'accessories', 'condition', 'notes'], userOnly: ['acknowledgerUserId'] },
    note: 'form=bast-pengembalian untuk BAST pengembalian. "Mengetahui" (penanda tangan) dipilih pengguna. Dokumen Google Docs baru dibuat saat pengguna menekan Buat BAST.',
  },
];
