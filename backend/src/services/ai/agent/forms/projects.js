// Project Tracker forms Prakasa AI may fill (contract: ../formCatalog.js; how
// to add one: docs/prakasa-ai-rencana.md §9.9). Every tracker endpoint is
// behind google.chat.use; membership of the space is checked per request.
const PERMISSION = 'google.chat.use';
const PROJECT = '/projects/<id space>';

module.exports = [
  {
    id: 'tracker-issue', title: 'Buat issue', route: `${PROJECT}?baru=1`, permission: PERMISSION,
    file: 'pages/projects/CreateIssueModal.jsx',
    fields: {
      ai: ['type', 'title', 'description', 'priority', 'startDate', 'dueDate', 'storyPoints', 'sprintId', 'columnId', 'parentId', 'labels'],
      userOnly: ['assigneeEmail'],
    },
    note: 'Penanggung jawab dipilih pengguna (orang itu diberi tahu saat issue dibuat). Status hanya bisa diisi AI dengan kolom yang belum berarti selesai. Label: AI memilih dari label yang sudah dipakai di project; label baru diketik pengguna. Bila project mengirim update ke space, issue baru diumumkan di Google Chat saat pengguna menekan "Buat issue".',
  },
  {
    id: 'tracker-issue-comment', title: 'Komentar issue', route: `${PROJECT}?issue=<id issue>`, permission: PERMISSION,
    file: 'pages/projects/IssueDrawer.jsx',
    fields: { ai: ['comment'], userOnly: [] },
    note: 'Hanya teks komentar; pengguna yang menekan "Kirim komentar". Kolom lain di laci issue (judul, status, penanggung jawab, dan lainnya) langsung tersimpan saat diubah, jadi tidak pernah diisi AI.',
  },
  {
    id: 'tracker-sprint', title: 'Buat sprint', route: `${PROJECT}?baru=sprint`, permission: PERMISSION,
    file: 'pages/projects/SprintDialog.jsx',
    fields: { ai: ['name', 'goal', 'startDate', 'endDate'], userOnly: [] },
    note: 'Memulai dan menyelesaikan sprint adalah keputusan pengguna (tombol di backlog), bukan bagian formulir ini.',
  },
  {
    id: 'tracker-sprint-edit', title: 'Ubah sprint', route: `${PROJECT}?ubah=<id sprint>`, permission: PERMISSION,
    file: 'pages/projects/SprintDialog.jsx', mode: 'edit', record: 'tracker_sprint',
    fields: { ai: ['name', 'goal', 'startDate', 'endDate'], userOnly: [] },
    note: 'Hanya sprint yang belum selesai. Memulai dan menyelesaikan sprint adalah keputusan pengguna.',
  },
  {
    id: 'tracker-project-division', title: 'Divisi project', route: `${PROJECT}?form=divisi`, permission: PERMISSION,
    file: 'pages/projects/DivisionDialog.jsx', mode: 'edit', record: 'tracker_project',
    fields: { ai: ['departmentId'], userOnly: [] },
    note: 'Divisi menentukan di laporan divisi mana project ini dihitung. Pengguna memeriksa lalu menekan "Simpan".',
  },
];
