// Documents: the document records, what a division has stored, and the
// document templates.
//
// Rules these tools keep:
//   - metadata and the Drive link only (title, type, status, division, who,
//     when). Never the content of a file, and never a Google call: only what
//     the app already recorded is read, so a file dropped straight into Google
//     Drive is not listed (the tool says so);
//   - a document is visible by the documents rule (own division, company-wide,
//     or made by the user; every division only for cross-division roles);
//     a division's storage only for that division, as on Penyimpanan divisi;
//   - a link opens in Google with the user's own Drive access — the link
//     itself grants nothing;
//   - private conversations only.
const documents = require('../../../documentRead.service');
const { hasPerm, text, int } = require('./_shared');

const MAX_ROWS = 50;
const DOC_STATUS = { draf: 'draft', final: 'final', diarsipkan: 'archived' };
const DOC_STATUS_LABEL = { draft: 'draf', final: 'final', archived: 'diarsipkan' };
const FILE_KIND = [
  [/google-apps\.document|wordprocessingml|msword/, 'dokumen'],
  [/google-apps\.spreadsheet|spreadsheetml|ms-excel|csv/, 'spreadsheet'],
  [/google-apps\.presentation|presentationml|powerpoint/, 'presentasi'],
  [/pdf/, 'PDF'],
  [/^image\//, 'gambar'],
];
const STORAGE_NOTE = 'Daftar ini berasal dari catatan dokumen di aplikasi (dokumen yang dibuat atau diunggah lewat Prakasa Workspace). '
  + 'File yang ditaruh langsung di Google Drive tidak tercatat di sini; buka halaman Penyimpanan divisi untuk daftar lengkapnya.';

const id = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const fileKind = (mime) => (mime ? (FILE_KIND.find(([pattern]) => pattern.test(mime)) || [null, 'berkas'])[1] : null);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// A division by name or code; null when the text matches none.
async function divisionByName(user, name) {
  const list = await documents.divisions(user);
  return { list, found: name ? list.find((d) => same(d.name, name) || same(d.code, name)) || null : null };
}

const docOut = (r) => ({
  id: Number(r.id),
  judul: r.title,
  jenis: r.documentTypeName || r.documentType,
  kode_jenis: r.documentType,
  status: DOC_STATUS_LABEL[r.status] || r.status,
  divisi: r.departmentName || 'Seluruh perusahaan',
  dibuat_oleh: r.createdByName || null,
  dibuat_pada: iso(r.createdAt),
  diubah_pada: iso(r.updatedAt),
  jenis_berkas: fileKind(r.mimeType),
  tautan: r.webViewLink || null,
});

const cariDokumen = {
  name: 'cari_dokumen',
  module: ['documents'],
  label: 'Mencari dokumen',
  description: 'Mencari catatan dokumen yang boleh dilihat pengguna (divisinya sendiri, dokumen seluruh perusahaan, dan yang ia buat; semua divisi hanya untuk Management Office) '
    + 'berdasarkan kata di judul, jenis dokumen, status (draf, final, diarsipkan), atau divisi. Memberi judul, jenis, status, divisi, pembuat, tanggal, dan tautan Google Drive-nya. '
    + 'Pakai untuk "carikan dokumen X", "dokumen kontrak divisi saya". '
    + 'Hanya metadata dan tautan: tidak pernah isi file, dan tidak pernah dokumen divisi lain.',
  inputSchema: {
    type: 'object',
    properties: {
      cari: { type: 'string', maxLength: 100, description: 'Kata di judul atau jenis dokumen' },
      jenis: { type: 'string', maxLength: 60, description: 'Kode jenis dokumen persis (kode_jenis dari hasil sebelumnya)' },
      status: { type: 'string', enum: Object.keys(DOC_STATUS) },
      divisi: { type: 'string', maxLength: 120, description: 'Nama divisi' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal dokumen (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'document.view',
  privateOnly: true,
  async run(user, input = {}) {
    let departmentId = null;
    const divisionName = text(input.divisi, 120);
    if (divisionName) {
      const { list, found } = await divisionByName(user, divisionName);
      if (!found) return { divisi_tidak_dikenal: divisionName, divisi_tersedia: list.map((d) => d.name) };
      departmentId = found.id;
    }
    const result = await documents.searchDocuments(user, {
      q: text(input.cari, 100),
      documentType: text(input.jenis, 60),
      status: DOC_STATUS[input.status] || '',
      departmentId,
      limit: int(input.jumlah, { max: MAX_ROWS, fallback: 20 }),
    });
    const notes = [];
    if (result.total > result.rows.length) notes.push(`Hanya ${result.rows.length} dari ${result.total} dokumen ditampilkan; persempit pencarian.`);
    if (!result.total) notes.push('Tidak ada dokumen yang cocok di antara dokumen yang boleh Anda lihat.');
    return {
      total_cocok: result.total,
      ditampilkan: result.rows.length,
      dokumen: result.rows.map(docOut),
      isi_file: 'tidak dibaca (hanya metadata dan tautan)',
      ...(notes.length ? { catatan: notes.join(' ') } : {}),
    };
  },
};

const dokumenDivisi = {
  name: 'dokumen_divisi',
  module: ['division-storage'],
  label: 'Membaca dokumen penyimpanan divisi',
  description: 'Dokumen yang tercatat di penyimpanan sebuah divisi: dokumen yang dibuat dari template (nomor dokumen, judul, template, pembuat, tanggal, tautan) dan dokumen divisi yang punya file di Google Drive, terbaru di atas. '
    + 'Default divisi pengguna sendiri; divisi lain hanya untuk peran lintas divisi. Pakai untuk "file apa saja yang baru di divisi saya", "ringkas isi penyimpanan divisi". '
    + 'Hanya yang tercatat di aplikasi (file yang ditaruh langsung di Google Drive tidak terdaftar). Tidak pernah isi file, dan tidak pernah penyimpanan divisi lain.',
  inputSchema: {
    type: 'object',
    properties: {
      divisi: { type: 'string', maxLength: 120, description: 'Nama divisi (hanya peran lintas divisi); kosong = divisi Anda' },
      cari: { type: 'string', maxLength: 100, description: 'Kata di judul atau nomor dokumen' },
      jumlah: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: 'Maksimal per bagian (default 20)' },
    },
    additionalProperties: false,
  },
  permission: 'document.view',
  privateOnly: true,
  async run(user, input = {}) {
    // Same rule as Penyimpanan divisi: own division, or any with workspace.cross_division.view.
    const cross = hasPerm(user, 'workspace.cross_division.view');
    const { list, found } = await divisionByName(user, text(input.divisi, 120));
    const wanted = text(input.divisi, 120);
    if (wanted && !found) return { divisi_tidak_dikenal: wanted, divisi_tersedia: (cross ? list : list.filter((d) => d.id === Number(user.departmentId))).map((d) => d.name) };
    const division = found || list.find((d) => d.id === Number(user.departmentId)) || null;
    if (!division) return { ditemukan: false, catatan: 'Akun Anda belum terhubung ke divisi; sebutkan nama divisinya (hanya untuk peran lintas divisi).' };
    if (!cross && division.id !== Number(user.departmentId)) {
      return { ditemukan: false, catatan: 'Penyimpanan divisi lain tidak termasuk hak akses Anda.' };
    }
    const limit = int(input.jumlah, { max: MAX_ROWS, fallback: 20 });
    const q = text(input.cari, 100).toLowerCase();
    const generated = (await documents.generatedDocuments(user, { limit: 500 }))
      .filter((g) => g.departmentId === division.id)
      .filter((g) => !q || String(g.title).toLowerCase().includes(q) || String(g.number).toLowerCase().includes(q));
    const stored = await documents.searchDocuments(user, { q, departmentId: division.id, withFile: true, limit });
    return {
      ditemukan: true,
      divisi: division.name,
      dari_template: {
        total: generated.length,
        dokumen: generated.slice(0, limit).map((g) => ({
          nomor: g.number,
          judul: g.title,
          template: g.templateName || null,
          dibuat_oleh: g.createdByName || null,
          dibuat_pada: g.createdAt,
          tautan: g.webViewLink || null,
        })),
      },
      dokumen_tersimpan: { total: stored.total, dokumen: stored.rows.map(docOut) },
      isi_file: 'tidak dibaca (hanya metadata dan tautan)',
      rute: '/division-storage',
      catatan: STORAGE_NOTE,
    };
  },
};

const templateOut = (t) => ({
  id: t.id,
  nama: t.name,
  jenis_dokumen: t.documentType,
  awalan_nomor: t.prefix,
  untuk: t.departmentName,
  bawaan: t.builtin,
  aktif: t.isActive,
  keterangan: t.description,
  kolom_isian: t.placeholders.filter((p) => !p.standard).map((p) => ({ kunci: p.key, label: p.label })),
  kolom_otomatis: t.placeholders.filter((p) => p.standard).map((p) => p.label),
  kolom_diperiksa_pada: t.checkedAt,
  tautan: t.webViewLink,
});

const templateDokumen = {
  name: 'template_dokumen',
  module: ['doc-templates', 'templates'],
  label: 'Membaca template dokumen',
  description: 'Template dokumen yang tersedia untuk pengguna (template divisinya dan template seluruh perusahaan, mis. BAST): nama, jenis dokumen, awalan nomor, untuk divisi mana, '
    + 'kolom yang harus diisi saat membuat dokumen (kolom_isian) dan kolom yang terisi otomatis (nomor, tanggal, perusahaan, divisi, pembuat). '
    + 'Dengan template_id atau cari, hanya template itu. Pakai untuk "template apa saja yang ada", "apa yang perlu saya isi untuk BAST". '
    + 'Prakasa AI tidak membuat dokumennya: pengguna yang menekan Buat dokumen di halaman Template dokumen. Tidak pernah isi template divisi lain, kop surat, atau cap.',
  inputSchema: {
    type: 'object',
    properties: {
      cari: { type: 'string', maxLength: 100, description: 'Kata di nama atau jenis template (mis. BAST)' },
      template_id: { type: 'integer', minimum: 1 },
      hanya_aktif: { type: 'boolean', description: 'Default true: hanya template yang aktif' },
    },
    additionalProperties: false,
  },
  permission: 'template.view',
  privateOnly: true,
  async run(user, input = {}) {
    const { templates, missingBuiltins } = await documents.templates(user);
    const q = text(input.cari, 100).toLowerCase();
    const templateId = id(input.template_id);
    const activeOnly = input.hanya_aktif !== false;
    const hits = templates
      .filter((t) => !templateId || t.id === templateId)
      .filter((t) => !activeOnly || t.isActive)
      .filter((t) => !q || [t.name, t.documentType, t.templateKey, t.prefix, t.description].some((v) => String(v || '').toLowerCase().includes(q)));
    const notes = [];
    if (!hits.length) notes.push(templateId || q ? 'Tidak ada template yang cocok di antara template yang boleh Anda pakai.' : 'Belum ada template dokumen yang siap dipakai.');
    if (hits.some((t) => !t.checkedAt)) notes.push('Sebagian template belum diperiksa kolomnya; daftar kolom isian bisa belum lengkap.');
    return {
      jumlah_template: hits.length,
      template: hits.slice(0, MAX_ROWS).map(templateOut),
      template_bawaan_belum_disiapkan: missingBuiltins.map((b) => ({ nama: b.name, keterangan: b.description })),
      cara_pakai: 'Buka halaman Template dokumen, pilih template, isi kolomnya, lalu tekan Buat dokumen. Butuh izin membuat dokumen.',
      rute: '/doc-templates',
      ...(notes.length ? { catatan: notes.join(' ') } : {}),
    };
  },
};

module.exports = [cariDokumen, dokumenDivisi, templateDokumen];
