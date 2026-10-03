// Task forms Prakasa AI may fill (contract: ../formCatalog.js; how to add one:
// docs/prakasa-ai-rencana.md §9.9).
const DETAIL = 'pages/tasks/TaskDetail.jsx';

module.exports = [
  {
    id: 'task', title: 'Tugas', route: '/tasks?board=<id papan>&baru=1', permission: 'task.create',
    file: 'pages/tasks/TaskBoard.jsx',
    fields: { ai: ['title', 'description', 'columnId', 'priority', 'progressPercent', 'startDate', 'dueDate'], userOnly: ['assigneeId'] },
    note: 'Butuh id papan: dari halaman papan yang sedang terbuka atau dari data papan. Penanggung jawab (ID akun) diisi pengguna: formulir ini belum punya pemilih orang.',
  },
  {
    id: 'task-board', title: 'Tambah board', route: '/tasks?baru=papan', permission: 'board.manage',
    file: 'pages/tasks/TaskBoard.jsx',
    fields: { ai: ['name', 'departmentId', 'description', 'columns', 'columns.name', 'columns.wipLimit'], userOnly: [] },
    note: 'Kolom board diisi sebagai baris (nama kolom, batas WIP). Tiga kolom bawaan (Backlog, Dikerjakan, Selesai) dihitung sebagai baris pengguna: kolom dari AI ditambahkan setelahnya dan pengguna sendiri yang menghapus kolom yang tidak dipakai. Bila daftar divisi tidak bisa dimuat, divisi diisi pengguna.',
  },
  {
    id: 'task-edit', title: 'Detail tugas', route: '/tasks/<id tugas>', permission: 'task.update',
    file: DETAIL, mode: 'edit', record: 'task',
    fields: { ai: ['title', 'description', 'priority', 'progressPercent', 'startDate', 'dueDate'], userOnly: ['status', 'assigneeId'] },
    note: 'Status (termasuk menandai selesai atau membuka kembali) adalah keputusan pengguna. Penanggung jawab (ID akun) diisi pengguna: formulir ini belum punya pemilih orang. Progres tidak bisa diubah pada tugas yang sudah selesai. Tombol "Simpan perubahan" baru muncul setelah ada kolom yang berubah.',
  },
  {
    id: 'task-comment', title: 'Komentar tugas', route: '/tasks/<id tugas>', permission: 'task.update',
    file: DETAIL,
    fields: { ai: ['comment'], userOnly: [] },
    note: 'Hanya teks komentar. Pengguna yang menekan "Kirim komentar".',
  },
  {
    id: 'task-checklist-item', title: 'Item checklist', route: '/tasks/<id tugas>?form=checklist', permission: 'task.checklist.manage',
    file: 'components/tasks/TaskChecklist.jsx',
    fields: { ai: ['title'], userOnly: [] },
    note: 'Satu item per simpan: pengguna menekan "Simpan item", lalu formulir dibuka lagi untuk item berikutnya. Mencentang, mengurutkan, dan menghapus item dilakukan pengguna.',
  },
  {
    id: 'task-dependency', title: 'Tambah dependensi', route: '/tasks/<id tugas>?form=dependensi', permission: 'task.dependency.manage',
    file: 'components/tasks/TaskDependencies.jsx',
    fields: { ai: ['mode', 'otherId'], userOnly: [] },
    note: 'Jenis dependensi dan ID task lain (angka). ID task diambil dari halaman atau dari data tugas pengguna, tidak dikarang; bila tidak diketahui, tanyakan. Apakah task itu ada dan boleh dilihat pengguna diperiksa saat pengguna menekan "Tambah dependensi".',
  },
];
