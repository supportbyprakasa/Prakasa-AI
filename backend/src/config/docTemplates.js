// Built-in document templates (migration 115): berita acara serah terima
// (BAST) for devices and company phone numbers — the work IT and GA share in
// People & Culture. Each is built as a .docx (docxKit.buildTemplateDocx),
// imported once as a Google Doc into the Shared Drive folder "Template
// dokumen", and may then be refined in Google Docs as long as the
// {{placeholders}} stay.
//
// Placeholder names: karyawan_* = the employee (holder), petugas_* = the IT or
// GA staff handling it, mengetahui_* = the other team (or a supervisor) who
// acknowledges. Standard placeholders every template gets: nomor_dokumen,
// tanggal, perusahaan, divisi, dibuat_oleh.

const STANDARD_FIELDS = Object.freeze(['nomor_dokumen', 'tanggal', 'perusahaan', 'divisi', 'dibuat_oleh']);

const FIELD_LABELS = Object.freeze({
  nomor_dokumen: 'Nomor dokumen',
  tanggal: 'Tanggal',
  perusahaan: 'Perusahaan',
  divisi: 'Divisi',
  dibuat_oleh: 'Dibuat oleh',
  lokasi: 'Lokasi',
  karyawan_nama: 'Nama karyawan',
  karyawan_jabatan: 'Jabatan karyawan',
  karyawan_divisi: 'Divisi karyawan',
  petugas_nama: 'Nama petugas',
  petugas_jabatan: 'Jabatan petugas',
  petugas_tim: 'Tim petugas',
  mengetahui_nama: 'Nama yang mengetahui',
  mengetahui_jabatan: 'Jabatan yang mengetahui',
  jenis_perangkat: 'Jenis perangkat',
  merek_model: 'Merek / model',
  nomor_seri: 'Nomor seri',
  kode_aset: 'Kode aset',
  spesifikasi: 'Spesifikasi',
  imei: 'IMEI',
  nomor_hp: 'Nomor',
  jenis_nomor: 'Jenis nomor',
  operator: 'Operator',
  paket: 'Paket',
  perangkat: 'Perangkat terkait',
  kelengkapan: 'Kelengkapan',
  kondisi: 'Kondisi',
  catatan: 'Catatan',
});

const party = (role, prefix, third) => [
  { text: role, bold: true },
  { fields: [['Nama', `{{${prefix}_nama}}`], ['Jabatan', `{{${prefix}_jabatan}}`], third] },
];

const deviceRows = [
  ['Jenis perangkat', '{{jenis_perangkat}}'],
  ['Merek / model', '{{merek_model}}'],
  ['Nomor seri', '{{nomor_seri}}'],
  ['Kode aset', '{{kode_aset}}'],
  ['Spesifikasi', '{{spesifikasi}}'],
  ['IMEI', '{{imei}}'],
];
const phoneRows = [
  ['Nomor', '{{nomor_hp}}'],
  ['Jenis', '{{jenis_nomor}}'],
  ['Operator', '{{operator}}'],
  ['Paket', '{{paket}}'],
  ['Perangkat terkait', '{{perangkat}}'],
];

const opening = { text: 'Pada hari ini, {{tanggal}}, bertempat di {{lokasi}}, kami yang bertanda tangan di bawah ini:', justify: true };
const notes = { text: 'Catatan: {{catatan}}' };

const BUILTIN_TEMPLATES = Object.freeze([
  {
    key: 'bast_device_handover',
    name: 'BAST serah terima perangkat',
    description: 'Berita acara saat laptop, HP, atau perangkat lain diserahkan kepada karyawan.',
    documentType: 'bast',
    prefix: 'BAST',
    subjectType: 'device_assignment',
    kind: 'handover',
    blocks: [
      { title: 'BERITA ACARA SERAH TERIMA PERANGKAT' },
      { subtitle: 'Nomor: {{nomor_dokumen}}' },
      opening,
      ...party('PIHAK PERTAMA (yang menyerahkan)', 'petugas', ['Tim', '{{petugas_tim}} — {{perusahaan}}']),
      ...party('PIHAK KEDUA (yang menerima)', 'karyawan', ['Divisi', '{{karyawan_divisi}}']),
      { text: 'PIHAK PERTAMA menyerahkan kepada PIHAK KEDUA perangkat milik {{perusahaan}} dengan rincian berikut:', justify: true },
      { fields: [...deviceRows, ['Kelengkapan', '{{kelengkapan}}'], ['Kondisi', '{{kondisi}}']], bordered: true },
      notes,
      { text: 'PIHAK KEDUA menyatakan telah menerima perangkat tersebut sesuai rincian di atas, akan menjaga dan menggunakannya untuk keperluan pekerjaan, dan mengembalikannya saat diminta atau ketika tidak lagi bekerja di {{perusahaan}}.', justify: true },
      { gap: true },
      { signatures: [['Yang menyerahkan,', '{{petugas_nama}}', '{{petugas_jabatan}}'], ['Yang menerima,', '{{karyawan_nama}}', '{{karyawan_jabatan}}'], ['Mengetahui,', '{{mengetahui_nama}}', '{{mengetahui_jabatan}}']] },
    ],
  },
  {
    key: 'bast_device_return',
    name: 'BAST pengembalian perangkat',
    description: 'Berita acara saat karyawan mengembalikan perangkat, termasuk saat offboarding.',
    documentType: 'bast',
    prefix: 'BAST',
    subjectType: 'device_assignment',
    kind: 'return',
    blocks: [
      { title: 'BERITA ACARA PENGEMBALIAN PERANGKAT' },
      { subtitle: 'Nomor: {{nomor_dokumen}}' },
      opening,
      ...party('PIHAK PERTAMA (yang mengembalikan)', 'karyawan', ['Divisi', '{{karyawan_divisi}}']),
      ...party('PIHAK KEDUA (yang menerima)', 'petugas', ['Tim', '{{petugas_tim}} — {{perusahaan}}']),
      { text: 'PIHAK PERTAMA mengembalikan kepada PIHAK KEDUA perangkat milik {{perusahaan}} dengan rincian berikut:', justify: true },
      { fields: [...deviceRows, ['Kelengkapan dikembalikan', '{{kelengkapan}}'], ['Kondisi saat kembali', '{{kondisi}}']], bordered: true },
      notes,
      { text: 'PIHAK KEDUA telah memeriksa dan menerima perangkat tersebut sesuai rincian di atas.', justify: true },
      { gap: true },
      { signatures: [['Yang mengembalikan,', '{{karyawan_nama}}', '{{karyawan_jabatan}}'], ['Yang menerima,', '{{petugas_nama}}', '{{petugas_jabatan}}'], ['Mengetahui,', '{{mengetahui_nama}}', '{{mengetahui_jabatan}}']] },
    ],
  },
  {
    key: 'bast_phone_handover',
    name: 'BAST serah terima nomor HP',
    description: 'Berita acara saat nomor HP atau ekstensi perusahaan diserahkan kepada karyawan.',
    documentType: 'bast',
    prefix: 'BAST',
    subjectType: 'it_phone_line',
    kind: 'handover',
    blocks: [
      { title: 'BERITA ACARA SERAH TERIMA NOMOR PERUSAHAAN' },
      { subtitle: 'Nomor: {{nomor_dokumen}}' },
      opening,
      ...party('PIHAK PERTAMA (yang menyerahkan)', 'petugas', ['Tim', '{{petugas_tim}} — {{perusahaan}}']),
      ...party('PIHAK KEDUA (yang menerima)', 'karyawan', ['Divisi', '{{karyawan_divisi}}']),
      { text: 'PIHAK PERTAMA menyerahkan kepada PIHAK KEDUA nomor milik {{perusahaan}} dengan rincian berikut:', justify: true },
      { fields: [...phoneRows, ['Kelengkapan', '{{kelengkapan}}'], ['Kondisi', '{{kondisi}}']], bordered: true },
      notes,
      { text: 'Nomor tersebut tetap milik {{perusahaan}}, dipakai untuk keperluan pekerjaan, dan wajib dikembalikan saat diminta atau ketika tidak lagi bekerja di {{perusahaan}}. PIN, PUK, dan nomor kartu SIM tidak dicantumkan dalam berita acara ini.', justify: true },
      { gap: true },
      { signatures: [['Yang menyerahkan,', '{{petugas_nama}}', '{{petugas_jabatan}}'], ['Yang menerima,', '{{karyawan_nama}}', '{{karyawan_jabatan}}'], ['Mengetahui,', '{{mengetahui_nama}}', '{{mengetahui_jabatan}}']] },
    ],
  },
  {
    key: 'bast_phone_return',
    name: 'BAST pengembalian nomor HP',
    description: 'Berita acara saat nomor HP atau ekstensi perusahaan dikembalikan.',
    documentType: 'bast',
    prefix: 'BAST',
    subjectType: 'it_phone_line',
    kind: 'return',
    blocks: [
      { title: 'BERITA ACARA PENGEMBALIAN NOMOR PERUSAHAAN' },
      { subtitle: 'Nomor: {{nomor_dokumen}}' },
      opening,
      ...party('PIHAK PERTAMA (yang mengembalikan)', 'karyawan', ['Divisi', '{{karyawan_divisi}}']),
      ...party('PIHAK KEDUA (yang menerima)', 'petugas', ['Tim', '{{petugas_tim}} — {{perusahaan}}']),
      { text: 'PIHAK PERTAMA mengembalikan kepada PIHAK KEDUA nomor milik {{perusahaan}} dengan rincian berikut:', justify: true },
      { fields: [...phoneRows, ['Kelengkapan dikembalikan', '{{kelengkapan}}'], ['Kondisi', '{{kondisi}}']], bordered: true },
      notes,
      { text: 'Sejak tanggal tersebut nomor tidak lagi dipakai oleh PIHAK PERTAMA.', justify: true },
      { gap: true },
      { signatures: [['Yang mengembalikan,', '{{karyawan_nama}}', '{{karyawan_jabatan}}'], ['Yang menerima,', '{{petugas_nama}}', '{{petugas_jabatan}}'], ['Mengetahui,', '{{mengetahui_nama}}', '{{mengetahui_jabatan}}']] },
    ],
  },
]);

// A blank custom template: a short guide the user replaces in Google Docs.
const BLANK_TEMPLATE_BLOCKS = Object.freeze([
  { title: '{{judul}}' },
  { subtitle: 'Nomor: {{nomor_dokumen}}' },
  { text: 'Tulis isi template di sini. Bagian yang diisi saat dokumen dibuat ditulis di antara kurung kurawal ganda, misalnya {{nama_penerima}} atau {{jumlah}}. Nama isian memakai huruf kecil, angka, dan garis bawah.', justify: true },
  { text: 'Isian yang selalu terisi otomatis: {{nomor_dokumen}}, {{tanggal}}, {{perusahaan}}, {{divisi}}, {{dibuat_oleh}}. Kop dan footer mengikuti pengaturan divisi, jadi tidak perlu dibuat di template.', justify: true },
  { text: 'Jakarta, {{tanggal}}' },
  { gap: true },
  { signatures: [['Dibuat oleh,', '{{dibuat_oleh}}', '{{divisi}}']] },
]);

const humanize = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const fieldLabel = (key) => FIELD_LABELS[key] || humanize(key);

module.exports = { STANDARD_FIELDS, FIELD_LABELS, BUILTIN_TEMPLATES, BLANK_TEMPLATE_BLOCKS, fieldLabel };
