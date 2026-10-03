// People & Culture forms Prakasa AI may fill (contract: ../formCatalog.js; how
// to add one: docs/prakasa-ai-rencana.md §9.9).
//
// The HRIS is KantorKu: these forms hold no salary, bank account, NIK/KTP,
// NPWP, BPJS, birth date, home address or personal phone, and none may be
// added to `ai`. The reason for leaving, free-text People & Culture notes,
// the work phone, a person's status / exclusion / resign date stay with the
// user (userOnly: listed, never filled, never read back).
const WORKFLOW = 'pages/hrga/WorkflowFormDialog.jsx';
const TASKS = 'pages/hrga/TaskDialogs.jsx';
const TEMPLATES = 'pages/hrga/ChecklistTemplates.jsx';
const PERSON = 'pages/people/PersonFormDialog.jsx';

const ONBOARDING = [
  'employeeFullName', 'employeePosition', 'departmentId', 'managerKey', 'locationId', 'plannedWorkEmail', 'personKey', 'joinDate',
  'needGoogle', 'needApp', 'needIdCard', 'needDesk', 'needDevice', 'needPhone', 'needLicenses', 'hrgaPicUserId',
];
const TEMPLATE_ROWS = ['items', 'items.ownerGroup', 'items.category', 'items.title', 'items.offsetDays', 'items.requires'];
const PERSON_AI = ['name', 'workEmail', 'departmentId', 'position', 'managerKey', 'locationId'];
const PERSON_USER = ['workPhone', 'kind', 'excludedReason', 'status', 'resignedOn', 'notes'];
const TASK_ROUTE = (action) => `/hrga/workflows/<id alur>?form=${action}.<id tugas>`;

module.exports = [
  {
    id: 'hr-onboarding', title: 'Onboarding', route: '/hrga/onboarding?baru=1', permission: 'hrga.request',
    file: WORKFLOW,
    fields: { ai: ONBOARDING, userOnly: ['notes'] },
    note: 'Draf onboarding karyawan baru. Atasan, orang di direktori, dan PIC ditulis dengan namanya. Catatan diisi pengguna. Data pribadi (NIK, alamat, rekening, gaji, telepon pribadi) ada di KantorKu: jangan ditanyakan dan jangan ditulis di sini. Pengguna menyimpan draf lalu mengajukannya sendiri.',
  },
  {
    id: 'hr-offboarding', title: 'Offboarding', route: '/hrga/offboarding?baru=1', permission: 'hrga.request',
    file: WORKFLOW,
    fields: { ai: ['personKey', 'lastWorkingDate', 'hrgaPicUserId'], userOnly: ['reasonCode', 'notes'] },
    note: 'Draf offboarding. Karyawan dan PIC ditulis dengan namanya. Alasan keluar dan catatan hanya diisi pengguna: jangan menanyakan atau menyimpulkan alasannya.',
  },
  {
    id: 'hr-onboarding-edit', title: 'Ubah onboarding', route: '/hrga/workflows/<id alur>?ubah=1', permission: 'hrga.request',
    file: WORKFLOW, mode: 'edit', record: 'hrga_workflow',
    fields: { ai: ONBOARDING, userOnly: ['notes'] },
    note: 'Hanya draf atau yang diminta revisi yang bisa diubah. Catatan diisi pengguna; data pribadi ada di KantorKu.',
  },
  {
    id: 'hr-offboarding-edit', title: 'Ubah offboarding', route: '/hrga/workflows/<id alur>?ubah=1', permission: 'hrga.request',
    file: WORKFLOW, mode: 'edit', record: 'hrga_workflow',
    fields: { ai: ['lastWorkingDate', 'hrgaPicUserId'], userOnly: ['personKey', 'reasonCode', 'notes'] },
    note: 'Hanya draf atau yang diminta revisi yang bisa diubah. Karyawan tidak bisa diganti; alasan keluar dan catatan hanya diisi pengguna.',
  },
  {
    id: 'hr-checklist-pic', title: 'Penanggung jawab checklist', route: '/hrga/checklist-templates', permission: 'hrga.checklist_template.manage',
    file: TEMPLATES, mode: 'edit', record: 'hrga_pic_setting',
    fields: { ai: ['itUserId', 'gaUserId'], userOnly: [] },
    note: 'PIC IT dan PIC GA ditulis dengan namanya; hanya akun yang punya izin yang sesuai yang bisa dipilih. Pengguna menekan "Simpan penanggung jawab".',
  },
  {
    id: 'hr-checklist-template', title: 'Template checklist', route: '/hrga/checklist-templates?baru=1', permission: 'hrga.checklist_template.manage',
    file: TEMPLATES,
    fields: { ai: ['workflowType', 'departmentId', 'name', ...TEMPLATE_ROWS], userOnly: [] },
    note: 'Isi jenis lebih dulu, lalu item sebagai baris (tim, kategori, judul, hari relatif, hanya bila). "Hanya bila" hanya ada di template onboarding. Mengaktifkan atau menonaktifkan template dilakukan pengguna.',
  },
  {
    id: 'hr-checklist-template-edit', title: 'Ubah template checklist', route: '/hrga/checklist-templates?ubah=<id template>', permission: 'hrga.checklist_template.manage',
    file: TEMPLATES, mode: 'edit', record: 'hrga_checklist_template',
    fields: { ai: ['name', ...TEMPLATE_ROWS], userOnly: ['workflowType', 'departmentId'] },
    note: 'Template offboarding dibuka dengan type=offboarding di rute. Jenis dan divisi tidak bisa diubah. Item yang sudah ada tidak diubah atau dihapus; AI hanya menambah item.',
  },
  {
    id: 'hr-task-assign', title: 'Tugaskan ke', route: TASK_ROUTE('assign'), permission: 'hrga.manage',
    file: TASKS, mode: 'edit', record: 'hrga_task',
    fields: { ai: ['responsibleUserId'], userOnly: [] },
    note: 'Penanggung jawab tugas checklist, ditulis dengan namanya. Orang itu menerima notifikasi setelah pengguna menekan Simpan.',
  },
  {
    id: 'hr-task-it-ticket', title: 'Buat tiket IT', route: TASK_ROUTE('it_ticket'), permission: 'hrga.view',
    file: TASKS,
    fields: { ai: ['category', 'title', 'description'], userOnly: [] },
    note: 'Tiket IT dari tugas checklist tim IT. Jangan menulis kata sandi atau license key di deskripsi.',
  },
  {
    id: 'hr-task-device-handover', title: 'Serahkan perangkat', route: TASK_ROUTE('device_handover'), permission: 'device.assign',
    file: TASKS,
    fields: { ai: ['deviceId', 'expectedReturnDate'], userOnly: [] },
    note: 'Perangkat ditulis dengan nama atau nomor serinya; hanya perangkat Cadangan. Menekan "Serahkan perangkat" menyelesaikan tugas: itu keputusan pengguna.',
  },
  {
    id: 'hr-task-device-return', title: 'Terima kembali perangkat', route: TASK_ROUTE('device_return'), permission: 'device.assign',
    file: TASKS,
    fields: { ai: ['conditionOnReturn', 'notes'], userOnly: [] },
    note: 'Kondisi dan catatan kondisi perangkat saja. Menekan "Terima kembali" menyelesaikan tugas: itu keputusan pengguna.',
  },
  {
    id: 'hr-task-license', title: 'Berikan lisensi', route: TASK_ROUTE('license_assign'), permission: 'subscription.license.manage',
    file: TASKS,
    fields: { ai: ['licenseId'], userOnly: [] },
    note: 'Seat lisensi yang masih kosong, ditulis dengan nama produk atau label seat. Menekan "Berikan lisensi" menyelesaikan tugas: itu keputusan pengguna.',
  },
  {
    id: 'people-person', title: 'Tambah orang ke direktori', route: '/people/directory?baru=1', permission: 'people.directory.manage',
    file: PERSON,
    fields: { ai: PERSON_AI, userOnly: PERSON_USER },
    note: 'Profil kerja saja: nama, email kerja, divisi, jabatan, atasan (ditulis dengan namanya), lokasi kerja. Telepon kerja, jenis dan alasan dikecualikan, status, tanggal resign, dan catatan hanya diisi pengguna. Data pribadi ada di KantorKu.',
  },
  {
    id: 'people-person-edit', title: 'Ubah profil kerja', route: '/people/directory/<key orang>?ubah=1', permission: 'people.directory.manage',
    file: PERSON, mode: 'edit', record: 'directory_person',
    fields: { ai: PERSON_AI, userOnly: PERSON_USER },
    note: 'Untuk orang yang punya akun aplikasi, nama, email kerja, dan divisi diubah di Admin → Pengguna. Telepon kerja, status, tanggal resign, pengecualian, dan catatan hanya diisi pengguna.',
  },
];
