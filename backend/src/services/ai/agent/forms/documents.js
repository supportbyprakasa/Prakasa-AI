// Document forms Prakasa AI may fill: document templates, kop & footer, and
// the "new file / folder" dialogs of the division folder and My Drive
// (contract: ../formCatalog.js; how to add one: docs/prakasa-ai-rencana.md §9.9).
// The AI only types names and text: making the Google file is the user's click.
const TEMPLATES = 'pages/documents/DocTemplateDialogs.jsx';

module.exports = [
  {
    id: 'doc-template', title: 'Tambah template', route: '/doc-templates?baru=1', permission: 'template.manage',
    file: TEMPLATES,
    fields: { ai: ['name', 'scope', 'prefix', 'description'], userOnly: ['source', 'sourceUrl'] },
    note: 'Sumber template (kosong atau salinan Google Docs) dan tautan Google Docs dipilih pengguna.',
  },
  {
    id: 'doc-template-edit', title: 'Ubah template', route: '/doc-templates?ubah=<id template>', permission: 'template.manage',
    file: TEMPLATES, mode: 'edit', record: 'doc_template',
    fields: { ai: ['name', 'prefix', 'description'], userOnly: ['isActive'] },
    note: 'Mengaktifkan atau menonaktifkan template dilakukan pengguna. Nama template bawaan tidak bisa diubah. Isi template diubah di Google Docs.',
  },
  {
    // Field names are the template's own placeholders, known only on the page
    // (dynamicFields): each passes the name policy on the server, and only
    // text / date fields are fillable. Reviewed: formCatalog.js DYNAMIC_FORMS.
    id: 'doc-generate', title: 'Buat dokumen dari template', route: '/doc-templates?buat=<id template>',
    // POST /doc-templates/:id/generate: template.view AND document.create.
    permission: 'document.create', requires: ['template.view'],
    file: TEMPLATES, dynamicFields: true,
    fields: { ai: ['docTitle'], userOnly: [] },
    note: 'Id template: dari data template dokumen. Kolom isian berasal dari placeholder template itu. Kolom bernama data pribadi (NIK, KTP, NPWP, BPJS, gaji, tanggal lahir, alamat rumah, telepon pribadi), rekening bank, pengenal perangkat, atau rupiah hanya diisi pengguna. '
      + 'Nomor, tanggal, perusahaan, divisi, dan pembuat terisi otomatis. Dokumen Google baru dibuat setelah pengguna menekan "Buat dokumen".',
  },
  {
    id: 'doc-kop', title: 'Kop & footer', route: '/doc-templates?tab=kop&form=<id divisi atau company>', permission: 'template.manage',
    file: TEMPLATES, mode: 'edit', record: 'doc_kop',
    fields: { ai: ['layout', 'companyName', 'accentColor', 'headerLines', 'footerText', 'showPageNumber'], userOnly: ['logo'] },
    note: 'Logo diunggah pengguna. Warna aksen berbentuk #RRGGBB. Baris di bawah nama: alamat dan kontak kantor, paling banyak 6 baris.',
  },
  {
    id: 'doc-division-file', title: 'Buat file di folder divisi', route: '/division-storage?baru=<document, spreadsheet, atau presentation>',
    // POST /division-storage/files: document.view (router-wide) AND document.create.
    permission: 'document.create', requires: ['document.view'],
    file: 'pages/documents/DivisionStorage.jsx',
    fields: { ai: ['name'], userOnly: [] },
    note: 'Hanya nama file. File Google baru dibuat setelah pengguna menekan "Buat file".',
  },
  {
    id: 'mydrive-file', title: 'Buat file di My Drive', route: '/my-drive?baru=<document, spreadsheet, atau presentation>',
    // POST /my-drive/files: mydrive.view (router-wide) AND mydrive.manage.
    permission: 'mydrive.manage', requires: ['mydrive.view'],
    file: 'pages/mydrive/MyDrive.jsx',
    fields: { ai: ['name'], userOnly: [] },
    note: 'Hanya nama file. File dibuat di My Drive pengguna setelah ia menekan "Buat file". Unggahan dilakukan pengguna.',
  },
  {
    id: 'mydrive-folder', title: 'Buat folder di My Drive', route: '/my-drive?baru=folder', permission: 'mydrive.manage', requires: ['mydrive.view'], // POST /my-drive/folders
    file: 'pages/mydrive/MyDrive.jsx',
    fields: { ai: ['name'], userOnly: [] },
    note: 'Hanya nama folder. Folder dibuat setelah pengguna menekan "Buat folder".',
  },
];
