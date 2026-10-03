// Page tools (Wave C, docs/prakasa-ai-rencana.md §9.8): the three things
// Prakasa AI can do ON the page the user is looking at. They are carried out by
// the user's browser (`client: true`; no run() here) and checked on the server
// before and after (../clientTools.js). There is no tool that presses a button:
// a form is saved, submitted or sent by the user, never by the agent.
const formCatalog = require('../formCatalog');
const registryOf = () => require('../../../aiToolRegistry.service'); // eslint-disable-line global-require

const MAX_LISTED = 40;
const short = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

module.exports = [
  // The forms this user may fill and how each opens. A server tool (it reads
  // the catalog, not the page): the list is long, so it is not part of any
  // tool description — the agent asks for it when it needs a route.
  {
    name: 'daftar_formulir',
    surfaces: ['panel', 'full'],
    module: 'general',
    label: 'Mencari formulir yang bisa diisi',
    description: 'Daftar formulir yang boleh diisi pengguna ini lewat Prakasa AI: id, judul, rute untuk buka_halaman, apa yang dibutuhkan rutenya (rute_butuh: nilai pengganti bagian <…>, diambil dari halaman atau alat baca), mode ubah atau buat-baru, dan catatan tentang kolom yang tetap diisi pengguna. '
      + 'Bisa dibatasi ke satu halaman (rute halamannya, mis. /ga) atau dicari dengan kata kunci (mis. "pelanggan", "tiket"). Pakai bila belum yakin formulir atau rute mana yang dimaksud. '
      + 'Hanya daftar formulir: tanpa isi formulir dan tanpa data modul apa pun, dan tidak pernah membuka, mengisi, atau menyimpan sesuatu.',
    inputSchema: {
      type: 'object',
      properties: {
        halaman: { type: 'string', description: 'Rute halaman dalam aplikasi (mis. /ga, /sales/orders): hanya formulir yang dibuka dari halaman itu.' },
        cari: { type: 'string', description: 'Kata kunci pada judul, id, atau catatan formulir (mis. "pelanggan").' },
      },
      additionalProperties: false,
    },
    permission: null,
    public: true,
    privateOnly: true,
    async run(user, input = {}) {
      const page = short(input.halaman, 200);
      const search = short(input.cari, 80);
      const registry = registryOf();
      // Only forms on a page this user may open (the page's own read rule).
      const reachable = (form) => {
        if (form.rute.startsWith('<')) return true;
        const resolved = registry.resolveTool(form.rute.split('?')[0].replace(/<[^<>]+>/g, '1'));
        return Boolean(resolved) && registry.canRead(user, resolved.tool);
      };
      const all = formCatalog.formsFor(user, { page: page.startsWith('/') ? page : null, search: search || null }).filter(reachable);
      const list = all.slice(0, MAX_LISTED);
      return {
        jumlah: all.length,
        formulir: list,
        ...(all.length > list.length ? { terpotong: true, catatan_daftar: `Hanya ${MAX_LISTED} formulir pertama. Persempit dengan "halaman" atau "cari".` } : {}),
        catatan: all.length
          ? 'Buka formulir dengan buka_halaman memakai rutenya, lalu baca_formulir dan isi_form. Pengguna yang menyimpan.'
          : 'Tidak ada formulir yang cocok untuk pengguna ini. Bila formulirnya ada tetapi pengguna tidak punya izinnya, katakan ia tidak punya akses.',
      };
    },
  },
  {
    name: 'buka_halaman',
    client: true,
    clientOp: 'navigate',
    surfaces: ['panel', 'full'],
    module: 'general',
    label: 'Membuka halaman',
    description: 'Membuka satu halaman Prakasa Workspace di layar pengguna (hanya rute dalam aplikasi yang boleh dibuka pengguna ini), misalnya untuk membuka formulir buat-baru atau formulir ubah data. '
      + 'Rute halaman: dari hasil alat baca (kolom rute) atau dari halaman yang sedang dibuka pengguna. Rute formulir: dari daftar_formulir (id, rute, dan apa yang dibutuhkan rutenya); bagian <…> di rute diganti nilai dari halaman atau dari alat baca, jangan dikarang. '
      + 'Membuka formulir di halaman yang sama tidak menanyai pengguna. Bila pindah ke halaman lain dan ada formulir yang belum disimpan di layar, pengguna ditanya dulu dan boleh menolak. Di Pusat perintah AI halaman tidak dibuka: hasilnya tautan untuk diberikan ke pengguna. '
      + 'Tidak pernah membuka alamat di luar aplikasi, tidak pernah menekan tombol, dan tidak pernah menyimpan atau mengirim apa pun.',
    inputSchema: {
      type: 'object',
      properties: {
        rute: { type: 'string', description: 'Rute dalam aplikasi, diawali "/", boleh dengan parameter (mis. /it/tickets/new, /finance/payment-requests?baru=1).' },
      },
      required: ['rute'],
      additionalProperties: false,
    },
    permission: null,
    privateOnly: true,
  },
  {
    name: 'baca_formulir',
    client: true,
    clientOp: 'readForms',
    surfaces: ['panel'],
    module: 'general',
    label: 'Membaca formulir di halaman',
    description: 'Daftar formulir yang sedang terbuka di halaman pengguna: id formulir, lalu tiap kolom dengan nama, label, jenis, pilihan, isi saat ini, wajib atau tidak, dan apakah boleh diisi AI. '
      + 'Jenis "rows" adalah daftar baris (kolom_baris = kolom tiap baris, baris = isi sekarang); jenis "lookup" dan "person" dipilih lewat pencarian halaman; mode "ubah" berarti formulir mengubah data yang sudah ada. '
      + 'Pakai sebelum isi_form. Bila tidak ada formulir terbuka, hasilnya formulir yang bisa dibuka di halaman itu (formulir halaman lain: daftar_formulir). '
      + 'Tidak pernah mengembalikan kolom kata sandi atau rahasia, dan tanpa isi kolom yang hanya boleh diisi pengguna (rekening bank, keputusan persetujuan, unggahan file, data pribadi, pengenal infrastruktur seperti alamat IP dan nomor seri).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permission: null,
    privateOnly: true,
  },
  {
    name: 'isi_form',
    client: true,
    clientOp: 'fillForm',
    surfaces: ['panel'],
    module: 'general',
    label: 'Mengisi formulir',
    description: 'Mengisi kolom formulir yang terbuka di halaman pengguna, lewat formulir itu sendiri: hanya kolom yang didaftarkan halaman sebagai boleh diisi AI, dan tetap melewati validasi formulirnya. '
      + 'Pilihan (select/radio) diisi dengan label pilihannya, beberapa pilihan (multiselect) dipisah titik koma; tanggal dengan YYYY-MM-DD, tanggal-jam dengan YYYY-MM-DD JJ:MM (WIB), bulan dengan YYYY-MM; centang dengan "ya" atau "tidak". '
      + 'Kolom jenis "lookup" atau "person": tulis nama yang dicari di "isi"; halaman mencarinya dengan pencarian yang sama seperti saat pengguna mengetik. Hanya bila tepat satu yang cocok kolom terisi; selain itu kolom masuk "ditolak" bersama "kandidat" (paling banyak 5 label): tanyakan ke pengguna yang dimaksud, jangan menebak. '
      + 'Kolom jenis "rows" (daftar baris): kirim "baris", yaitu daftar objek { nama_kolom: isi } (paling banyak 20 baris per panggilan). Baris baru ditambahkan atau menggantikan baris yang masih kosong; cara "ganti" hanya mengganti baris yang sebelumnya diisi AI. Baris yang diisi pengguna tidak pernah diubah atau dihapus. '
      + 'Hasilnya: kolom yang terisi, yang ditolak beserta alasannya (baris ditulis "kolom[nomor]" atau "kolom[nomor].nama_kolom"), dan yang masih perlu diisi. '
      + 'Isian belum tersimpan: pengguna yang memeriksa lalu menekan tombol simpan. Tidak pernah menyimpan, mengirim, atau menyetujui; tidak pernah mengisi kata sandi, rekening bank penerima, keputusan persetujuan, atau unggahan file; tidak pernah menimpa kolom yang sudah diisi pengguna.',
    inputSchema: {
      type: 'object',
      properties: {
        formulir: { type: 'string', description: 'id formulir dari baca_formulir.' },
        isian: {
          type: 'array',
          description: 'Kolom yang diisi: nama kolom (dari baca_formulir) dan isinya sebagai teks ("isi"), atau untuk kolom jenis "rows" daftar barisnya ("baris").',
          items: {
            type: 'object',
            properties: {
              kolom: { type: 'string' },
              isi: { type: 'string', description: 'Isi kolom sebagai teks. Tidak dipakai untuk kolom jenis "rows".' },
              baris: {
                type: 'array',
                description: 'Hanya untuk kolom jenis "rows": tiap baris adalah objek { nama_kolom: isi } memakai nama di kolom_baris.',
                items: { type: 'object', additionalProperties: { type: 'string' } },
              },
              cara: { type: 'string', enum: ['tambah', 'ganti'], description: 'Hanya untuk "rows". "tambah" (bawaan): menambah baris. "ganti": mengganti baris yang sebelumnya diisi AI; baris pengguna tetap.' },
            },
            required: ['kolom'],
            additionalProperties: false,
          },
        },
      },
      required: ['formulir', 'isian'],
      additionalProperties: false,
    },
    permission: null,
    privateOnly: true,
  },
];
