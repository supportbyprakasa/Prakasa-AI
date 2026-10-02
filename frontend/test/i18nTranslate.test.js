import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranslator, normalizeText, replacementGroups, templateGroups, templateToRegexSource,
} from '../src/i18n/translate.js';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty, formatTime } from '../src/components/format.js';
import { getLanguage, setLanguageForTest } from '../src/i18n/language.js';
import manualPatterns, { finish } from '../src/i18n/en/patterns.js';

const translate = createTranslator({
  exact: {
    Simpan: 'Save',
    'Belum ada data': 'No data yet',
    Disetujui: 'Approved',
    terlambat: 'late',
    Gudang: 'Warehouse',
    kosong: '',
  },
  templates: {
    '$1 hari lalu': '$1 days ago',
    '$1 hari': '$1 days',
    'Status: $1': 'Status: $t1',
    'Hapus $1?': 'Delete $1?',
    '$1 hari$2': '$1 days$t2',
    '$2 dari $1': '$1 of $2',
  },
  patterns: [
    { match: /^1 hari lalu$/, to: '1 day ago' },
    { match: '^(\\d+) baris$', to: ([n]) => (n === '1' ? '1 row' : `${n} rows`) },
  ],
});

test('exact strings translate; unknown text, numbers and symbols are left alone', () => {
  assert.equal(translate('Simpan'), 'Save');
  assert.equal(translate('Belum ada data'), 'No data yet');
  assert.equal(translate('Toko Maju Jaya'), 'Toko Maju Jaya');
  assert.equal(translate('simpan'), 'simpan', 'the lookup is case-sensitive');
  for (const text of ['1.234', '12/09/2026', '—', '', '   ', '99+', 'Rp 1.000'.replace('Rp ', '')]) assert.equal(translate(text), text);
  assert.equal(translate(null), null);
  assert.equal(translate(42), 42);
  assert.equal(translate('kosong'), 'kosong', 'an empty translation is no translation');
});

test('whitespace: the key is normalised, the original edges are kept', () => {
  assert.equal(normalizeText('  Belum   ada\n data '), 'Belum ada data');
  assert.equal(translate('  Simpan '), '  Save ');
  assert.equal(translate('\n    Belum ada\n    data\n  '), '\n    No data yet\n  ');
  assert.equal(translate(' terlambat'), ' late');
});

test('patterns: hand-written first, then templates, the most literal first', () => {
  assert.equal(translate('1 hari lalu'), '1 day ago');
  assert.equal(translate('3 hari lalu'), '3 days ago');
  assert.equal(translate('3 hari'), '3 days');
  assert.equal(translate('1 baris'), '1 row');
  assert.equal(translate('12 baris'), '12 rows');
  assert.equal(translate('5 dari 12'), '12 of 5', 'groups are named by their number, not their position');
  assert.equal(translate('b dari a'), 'b dari a', 'one word around one word is what people write, not a count');
});

test('a captured group is record data unless the English side asks for $t', () => {
  // $1: verbatim, even when the dictionary knows the word (a warehouse named "Gudang").
  assert.equal(translate('Hapus Gudang?'), 'Delete Gudang?');
  // $t1: translated through the dictionary, kept when unknown.
  assert.equal(translate('Status: Disetujui'), 'Status: Approved');
  assert.equal(translate('Status: Toko Maju'), 'Status: Toko Maju');
  // An optional tail that is itself a label keeps its spacing.
  assert.equal(translate('5 hari terlambat'), '5 days late');
});

test('template helpers', () => {
  assert.equal(templateToRegexSource('Hapus $1?'), '^Hapus ([\\s\\S]*?)\\?$');
  assert.deepEqual(templateGroups('$2 dari $1'), [2, 1]);
  assert.deepEqual(replacementGroups('$1 of $t2'), [{ n: 1, translate: false }, { n: 2, translate: true }]);
  assert.equal(translate.has('Simpan'), true);
  assert.equal(translate.has('Toko'), false);
});

test('many patterns stay cheap: a text only meets the patterns sharing a word with it', () => {
  const templates = {};
  for (let i = 0; i < 3000; i += 1) templates[`kata${i} $1 unik${i}`] = `word${i} $1`;
  const big = createTranslator({ templates });
  const start = performance.now();
  for (let i = 0; i < 20000; i += 1) big(`PT Pelanggan Nomor ${i}`);
  assert.equal(big('kata7 x unik7'), 'word7 x');
  assert.ok(performance.now() - start < 1500, 'no linear scan of every pattern per text');
});

test('dates follow the language; numbers and Rp stay Indonesian', () => {
  assert.equal(getLanguage(), 'id', 'Indonesian outside the browser');
  const date = new Date(2026, 9, 5, 14, 5);
  assert.equal(formatDate(date), '5 Okt 2026');
  assert.equal(formatDateTime(date), '5 Okt 2026, 14.05');
  assert.equal(formatMoney(1234567), 'Rp 1.234.567');
  assert.equal(formatQty(12.5, 'Ctns'), '12,5 Ctns');
  setLanguageForTest('en');
  try {
    assert.equal(formatDate(date), '5 Oct 2026');
    assert.equal(formatDateTime(date), '5 Oct 2026, 14:05');
    assert.equal(formatTime(date), '14:05');
    assert.equal(formatMoney(1234567), 'Rp 1.234.567');
    assert.equal(formatMoney(-5000), '-Rp 5.000');
    assert.equal(formatQty(12.5, 'Ctns'), '12,5 Ctns');
    assert.equal(formatNumber(1738), '1.738');
  } finally {
    setLanguageForTest('id');
  }
  assert.equal(formatDate(date), '5 Okt 2026');
});

// ------------------------------------------------- hand-written patterns
// en/patterns.js with a small dictionary: every pattern there has a case here.
const real = createTranslator({
  patterns: manualPatterns,
  finish,
  same: ['Sales', 'Warehouse', 'SO', 'Head', 'Supervisor', 'resign'],
  exact: {
    Selesai: 'Done', Dikerjakan: 'In progress', Aktif: 'Active', Rusak: 'Broken', Tertinggal: 'Behind', Nama: 'Name', Pelanggan: 'Customers',
    aktif: 'active', judul: 'title', 'jatuh tempo': 'due date', prioritas: 'priority', dilihat: 'viewed', 'sedang diproses': 'in progress',
    'akun aplikasi aktif': 'active app account', Faktur: 'Invoice', 'Bukti bayar': 'Proof of payment', Omzet: 'Revenue',
    'Hanya untuk yang berwenang melihat harga beli': 'Only for those allowed to see purchase prices',
  },
  templates: {
    '$1 hari lalu': '$1 days ago', '$1 baris': '$1 rows', '$1 baru': '$1 new', '$1 berubah': '$1 changed', '$1 lisensi': '$1 licenses',
    '$1 dan $2': '$1 and $2', 'Hapus $1?': 'Delete $1?', 'Khusus $1': '$1 only', 'disetujui $1': 'approved $t1',
    'Perjalanan capaian $1 – $2': 'Achievement journey $1 – $2', 'Catatan: $1': 'Note: $1',
    '$1 faktur uang muka': '$1 down payment invoices', '$1 faktur mata uang asing': '$1 foreign currency invoices',
    '$1 ($2 tersedia)': '$1 ($2 available)',
  },
});
const cases = (list) => { for (const [id, en] of list) assert.equal(real(id), en, id); };

test('patterns.js: the step "Mengisi N kolom di formulir <judul>" names one form, and declines for a title that is not interface text', () => {
  cases([
    ['Mengisi 4 kolom di formulir Pelanggan baru', 'Filling 4 fields in the New customer form'],
    ['Mengisi 1 kolom di formulir Faktur', 'Filling 1 field in the Invoice form'],
    ['Mengisi 2 kolom di formulir Toko Maju Jaya', 'Mengisi 2 kolom di formulir Toko Maju Jaya'],
  ]);
});

test('patterns.js: dates written by the backend', () => {
  cases([
    ['Okt 2026', 'Oct 2026'],
    ['Mei 2026', 'May 2026'],
    ['Agustus 2026', 'August 2026'],
    ['5 Okt 2026', '5 Oct 2026'],
    ['Sen, 5 Okt', 'Mon, 5 Oct'],
    ['5 Okt 2026, 14.05', '5 Oct 2026, 14:05'],
    ['5–11 Okt 2026', '5–11 Oct 2026'],
    ['Kamis, 1 Okt pukul 14.05 WIB', 'Thursday, 1 Oct, 14:05 WIB'],
    ['Okt–Des', 'Oct–Dec'],
    ['Jan – Mei 2026', 'Jan – May 2026'],
    ['Kuartal 4 2026 (Okt–Des)', 'Q4 2026 (Oct–Dec)'],
    ['Kuartal 1 2027', 'Q1 2027'],
    ['Mei', 'May'], ['Okt', 'Oct'], ['Jan', 'Jan'],
    ['Sen', 'Mon'], ['Jumat', 'Friday'],
  ]);
});

test('patterns.js: a date inside a verbatim group is still a date; a name never changes', () => {
  // The backend bakes "Okt 2025" into a label the template inserts with $1.
  assert.equal(real('Perjalanan capaian Okt 2025 – Sep 2026'), 'Achievement journey Oct 2025 – Sep 2026');
  assert.equal(real('Catatan: 5 Okt 2026'), 'Note: 5 Oct 2026');
  // Not a date: record data in a verbatim group is untouched, even a word the dictionary knows.
  assert.equal(real('Catatan: Selesai'), 'Note: Selesai');
  assert.equal(real('Catatan: 3 hari'), 'Note: 3 hari', 'a duration typed by a user is not a "safe" shape');
  assert.equal(real('Hapus Mei?'), 'Delete Mei?', 'a lone month word can be a name');
  assert.equal(real('Hapus Toko Mei 2026?'), 'Delete Toko Mei 2026?');
});

test('patterns.js: relative time, durations and overdue text, with English plurals', () => {
  cases([
    ['1 hari lalu', '1 day ago'], ['12 hari lalu', '12 days ago'], ['1 jam lalu', '1 hour ago'], ['5 menit lalu', '5 minutes ago'],
    ['3 detik lalu', '3 seconds ago'], ['2 minggu lalu', '2 weeks ago'], ['1 bulan lalu', '1 month ago'], ['2 tahun yang lalu', '2 years ago'],
    ['3 hari lagi', 'in 3 days'], ['1 jam lagi', 'in 1 hour'], ['10 menit lagi', 'in 10 minutes'], ['2 minggu lagi', 'in 2 weeks'], ['1 bulan lagi', 'in 1 month'],
    ['3 hari', '3 days'], ['1 hari', '1 day'], ['0,4 hari', '0,4 days'], ['10 jam', '10 hours'], ['1 tahun', '1 year'],
    ['± 3 hari', '± 3 days'], ['> 90 hari', '> 90 days'],
    ['2 jam 05 mnt', '2 h 05 min'],
    ['lewat 5 hari', '5 days overdue'], ['Lewat 1 hari', '1 day overdue'], ['Terlambat 3 hari', '3 days late'], ['Terlambat bayar 2 hari', '2 days late paying'],
    ['maks. 1 hari', 'max. 1 day'], ['maks. 6 issue', 'max. 6 issues'],
  ]);
});

test('patterns.js: nouns counted with a unit chosen at run time', () => {
  cases([
    ['12 barang', '12 items'], ['1 barang', '1 item'], ['3 dokumen', '3 documents'], ['1 dokumen', '1 document'],
    ['6 issue', '6 issues'], ['1 poin', '1 point'], ['1.234 item', '1.234 items'], ['4 kamera', '4 cameras'], ['2 orang', '2 people'],
  ]);
});

test('patterns.js: the English singular is restored in template results', () => {
  assert.equal(real('1 baris'), '1 row');
  assert.equal(real('21 baris'), '21 rows');
  assert.equal(real('11 hari lalu'), '11 days ago');
  assert.equal(finish('approved 1 days ago · update waiting 1 hours'), 'approved 1 day ago · update waiting 1 hour');
  assert.equal(finish('0,1 days'), '0,1 days');
  assert.equal(finish('1 files · 31 rows'), '1 file · 31 rows');
});

test('patterns.js: the singular reaches a noun up to three words after the count', () => {
  const list = [
    ['1 invoices', '1 invoice'], ['1 days late', '1 day late'], ['1 users', '1 user'], ['1 rows', '1 row'], ['1 items', '1 item'],
    ['1 foreign currency invoices', '1 foreign currency invoice'], ['1 down payment invoices', '1 down payment invoice'],
    ['1 overdue invoices and 2 bills', '1 overdue invoice and 2 bills'], ['1 open tickets · 1 more events on Monday', '1 open ticket · 1 more event on Monday'],
    ['1 access/asset items still open', '1 access/asset item still open'], ['1 item lines', '1 item line'], ['1 · 1 of 1 POs', '1 · 1 of 1 PO'],
    ['1 BAST templates set up in the Shared Drive', '1 BAST template set up in the Shared Drive'], ['1 replies', '1 reply'], ['1 people added', '1 person added'],
    // the verb right after the noun follows it
    ['1 items have negative stock', '1 item has negative stock'], ['1 targets are billed monthly', '1 target is billed monthly'],
    ['1 Sales items need action', '1 Sales item needs action'], ['Sheet "A": 1 fields contain passwords', 'Sheet "A": 1 field contains passwords'],
    ['1 people do not have access yet', '1 person does not have access yet'],
  ];
  for (const [many, single] of list) assert.equal(finish(many), single, many);
  // Untouched: another count, a part of a number, a noun phrase that has ended, a number that names something, an unknown noun.
  for (const text of ['11 invoices', '21 open tickets', '0,1 days', '1–1 rows', '1/1 rows', '1 of 3 items', '1 day until orders close', '1 new, 2 changed rows',
    'Batch #1 rows', '1 file for all customers', '1 images/scans read with AI vision.', '1 very long foreign currency invoices', '1 boxes', '2 invoices']) assert.equal(finish(text), text, text);
});

test('patterns.js: app launcher favourites', () => {
  cases([['Hapus Gmail dari favorit', 'Remove Gmail from favorites'], ['Tambahkan Google Chat ke favorit', 'Add Google Chat to favorites']]);
});

test('patterns.js: text the app assembles itself', () => {
  cases([
    ['median 1 hari · rata-rata 0,4 · p90 3 · 97 SO', 'median 1 day · average 0,4 · p90 3 · 97 SO'],
    ['12 hari / target maks. 10 hari (Tertinggal)', '12 days / target max. 10 days (Behind)'],
    ['Diubah: judul, jatuh tempo, prioritas', 'Changed: title, due date, priority'],
    ['Omzet tidak ditampilkan untuk akun Anda. Hanya untuk yang berwenang melihat harga beli.', 'Revenue is not shown for your account. Only for those allowed to see purchase prices.'],
    ['Data Accurate Sales dan Warehouse masih menunggu persetujuan — angka di sini belum memuatnya.', 'Accurate data for Sales and Warehouse is still awaiting approval — the figures here do not include it yet.'],
    ['Lampirkan dulu: Faktur, Bukti bayar', 'Attach first: Invoice, Proof of payment'],
    ['Wajib dilampirkan sebelum diajukan: Faktur.', 'Must be attached before submitting: Invoice.'],
    ['3 faktur uang muka dan 2 faktur mata uang asing belum lunas tidak dihitung dalam angka di halaman ini.', '3 down payment invoices and 2 foreign currency invoices not yet paid are not counted in the figures on this page.'],
    ['Resign tanpa offboarding — masih terbuka: akun aplikasi aktif, 2 lisensi', 'Resigned without offboarding — still open: active app account, 2 licenses'],
    ['Permintaan GA sedang diproses', 'GA request in progress'],
    ['Sales, aktif; Warehouse, resign. Tautkan bila orangnya sama (misalnya bekerja lagi), supaya direktori tidak ganda.', 'Sales, active; Warehouse, resign. Link if it is the same person (for example, working here again), so the directory has no duplicates.'],
    ['Divisi Baru, aktif. Tautkan bila orangnya sama (misalnya bekerja lagi), supaya direktori tidak ganda.', 'Divisi Baru, aktif. Link if it is the same person (for example, working here again), so the directory has no duplicates.'],
    ['2 baris tanpa kode barang — belum bisa dicocokkan dengan DO-1, DO-2 +3 lainnya', '2 lines without an item code — cannot be matched with DO-1, DO-2 +3 more yet'],
    ['4 barang beda jumlah dengan DO-9 (satuan dasar)', '4 items differ in quantity from DO-9 (base unit)'],
    ['DO-1, DO-2 +3 lainnya', 'DO-1, DO-2 +3 more'],
    ['30 hari sebelumnya: Rp 1.200.000', 'Previous 30 days: Rp 1.200.000'],
    ['Pelanggan: 3 baru, 2 berubah', 'Customers: 3 new, 2 changed'],
  ]);
});

test('patterns.js: a list is translated only when every item is interface text', () => {
  cases([
    ['Nama, Selesai', 'Name, Done'],
    ['Selesai, Aktif dan Rusak.', 'Done, Active and Broken.'],
    ['Aktif 3, Rusak 2', 'Active 3, Broken 2'],
    ['3 baru, 2 berubah', '3 new, 2 changed'],
    ['judul; prioritas', 'title; priority'],
    ['Sales dan Warehouse', 'Sales and Warehouse'],
    // One unknown item: record data, nothing is translated by the list rule.
    ['PT Maju, Selesai', 'PT Maju, Selesai'],
    ['Selesai, Toko Jaya', 'Selesai, Toko Jaya'],
    // …and the templates still get their turn.
    ['Hapus PT Maju, Tbk?', 'Delete PT Maju, Tbk?'],
    // Two record names joined by "dan" are record data, not a list of labels.
    ['Toko A dan Toko B', 'Toko A dan Toko B'],
    // A phrase only a free-group template matches is not a list item.
    ['Khusus Supervisor, Head', 'Supervisor, Head only'],
  ]);
});

test('patterns.js: fallbacks — fragments joined with " · ", "a → b", "Label: value"', () => {
  cases([
    ['Selesai · Toko Maju · 3 hari lalu', 'Done · Toko Maju · 3 days ago'],
    ['disetujui 1 hari lalu · Aktif', 'approved 1 day ago · Active'],
    ['Produk A · Paket B (3 tersedia)', 'Produk A · Paket B (3 available)'],
    ['Pelanggan: 3 baru · Aktif 2', 'Customers: 3 new · Aktif 2'],
    ['Dikerjakan → Selesai', 'In progress → Done'],
    ['PT A → PT B', 'PT A → PT B'],
    ['Nama: Selesai', 'Name: Done'],
    ['Budi: Selesai', 'Budi: Selesai'],
  ]);
});

test('a sentence-cased label falls back to its lowercase entry', () => {
  assert.equal(real('Dilihat'), 'Viewed');
  assert.equal(real('Judul'), 'Title');
  assert.equal(real('Budi'), 'Budi');
});

test('a hand-written pattern can decline; t.exact is the dictionary only', () => {
  const t = createTranslator({
    exact: { Simpan: 'Save' },
    templates: { 'Hapus $1': 'Delete $1' },
    patterns: [
      { match: /^(Hapus .+)$/, to: ([whole], tr) => (tr.exact(whole) ? 'exact' : null) },
      { match: /^(.+)!$/, to: ([word], tr) => `${tr.exact(word) ? 'label' : 'data'}:${tr.known(word) ? 'known' : 'unknown'}` },
    ],
  });
  assert.equal(t('Hapus Toko'), 'Delete Toko', 'declined → the template is tried');
  assert.equal(t('Simpan!'), 'label:known');
  assert.equal(t('Hapus Toko!'), 'data:known', 'a template match is not an exact label');
  assert.equal(t('Toko!'), 'data:unknown');
});

// ---------------------------------------------- record data is never translated
test('patterns.js: dates the frontend already wrote in English are recognised as they are', () => {
  cases([
    ['30 Sep 2026, 14:05', '30 Sep 2026, 14:05'],
    ['Thursday, 1 Oct 2026', 'Thursday, 1 Oct 2026'],
    ['October 2026', 'October 2026'],
    ['28 Sep – 4 Oct 2026', '28 Sep – 4 Oct 2026'],
    ['21 – 27 Sep 2026', '21 – 27 Sep 2026'],
    ['1 Okt 2026, 14.00–15.30', '1 Oct 2026, 14:00–15:30'],
    // Server-built: claudeTeamLimits.js formatTime, and a month range.
    ['Kamis, 1 Okt 14.00 WIB', 'Thursday, 1 Oct 14:00 WIB'],
    ['Nov 2025 – Okt 2026', 'Nov 2025 – Oct 2026'],
    ['1 Agu 2026 – 1 Okt 2026', '1 Aug 2026 – 1 Oct 2026'],
    ['Dec', 'Dec'], ['Wed', 'Wed'],
  ]);
  for (const text of ['30 Sep 2026, 14:05', 'Thursday, 1 Oct 2026', '28 Sep – 4 Oct 2026', 'Rp 1.234.567', '-Rp 5.000']) assert.equal(real.covered(text), true, text);
  assert.equal(real('PT A – PT B'), 'PT A – PT B', 'two names with a dash are not a date range');
});

test('patterns.js: chips with a count, a suffix in brackets, a figure with its change', () => {
  cases([
    ['Aktif (12)', 'Active (12)'],
    ['Selesai (1.738)', 'Done (1.738)'],
    ['Toko Maju (3)', 'Toko Maju (3)'],
    ['5 Okt 2026 (aktif)', '5 Oct 2026 (active)'],
    ['Okt 2026: 131 (-6,1%)', 'Oct 2026: 131 (-6,1%)'],
    ['Genset lama 60 kVA (sudah diganti)', 'Genset lama 60 kVA (sudah diganti)'],
  ]);
});

test('patterns.js: titles the backend composes around a record', () => {
  cases([
    ['ATK: Kertas HVS A4 80gsm (+3 barang lain)', 'Office supplies: Kertas HVS A4 80gsm (+3 more)'],
    ['ATK: Selesai', 'Office supplies: Selesai'],
    ['Perbaikan: Pintu kaca lobi', 'Repair: Pintu kaca lobi'],
    ['Barang Masuk SJ-001', 'Inbound goods SJ-001'],
    ['Penerimaan RI-1, RI-2 +3 lainnya', 'Receipt RI-1, RI-2 +3 more'],
    ['Listrik 2026-09', 'Electricity 2026-09'],
    ['Pelanggan #12', 'Customers #12'],
    ['Pengajuan pembayaran Rp 1.500.000 ke PT Maju', 'Payment request Rp 1.500.000 to PT Maju'],
    ['Reimbursement Rp 50.000', 'Reimbursement Rp 50.000'],
    ['Onboarding mulai 5 Okt 2026', 'Onboarding starts 5 Oct 2026'],
    ['Offboarding hari terakhir 2026-10-05', 'Offboarding last day 2026-10-05'],
    ['Toko A, Toko B, dan 3 lainnya', 'Toko A, Toko B, and 3 more'],
    // A warehouse named "Gudang 2" or a product "Air mineral" is not such a title.
    ['Gudang 2', 'Gudang 2'],
    ['Air mineral 600ml', 'Air mineral 600ml'],
  ]);
});

test('a weak template never takes a record for interface text', () => {
  const t = createTranslator({
    exact: { Nonaktifkan: 'Deactivate', Lokasi: 'Location', Sales: 'Sales', lisensi: 'license' },
    templates: {
      '$1 dan $2': '$1 and $2', '$1 barang$2': '$1 items$2', '$1 akun $2': '$t1 account $2', '$1 baris $2': '$t1 row $2',
      'Tambah $1': 'Add $t1', 'Ubah $1': 'Edit $1', 'ATK: $1$2': 'Office supplies: $1$2', '$1 berakhir $2': '$1 ends $2',
      '$1 belum punya akses ke $2': '$1 has no access to $2 yet', 'Tim $1': '$1 team',
    },
    patterns: manualPatterns,
    finish,
  });
  // Text a user typed, outside any data zone: nothing happens to it.
  assert.equal(t('Laptop tidak bisa menyala, layar hitam dan lampu power berkedip'), 'Laptop tidak bisa menyala, layar hitam dan lampu power berkedip');
  assert.equal(t('Tambah lisensi Canva Teams untuk tim Marketing'), 'Tambah lisensi Canva Teams untuk tim Marketing', 'a $t group that is not a label declines');
  assert.equal(t('Rapat berakhir cepat'), 'Rapat berakhir cepat');
  // The same templates on what the app builds.
  assert.equal(t('Tambah lisensi'), 'Add license');
  assert.equal(t('3 barang · PT Maju'), '3 items · PT Maju');
  assert.equal(t('Nonaktifkan akun budi@prakasa.id'), 'Deactivate account budi@prakasa.id');
  assert.equal(t('Lokasi baris 2'), 'Location row 2');
  assert.equal(t('LPT-001 berakhir 2026-10-01'), 'LPT-001 ends 2026-10-01');
  // The most specific template wins: a literal start counts more than a longer word.
  assert.equal(t('Ubah Pengendalian hama gudang barang kering'), 'Edit Pengendalian hama gudang barang kering');
  assert.equal(t('Tim Gudang belum punya akses ke Drive'), 'Tim Gudang has no access to Drive yet');
});

test('a sentence zone (translate.strict) translates whole sentences of the app only', () => {
  const t = createTranslator({
    exact: {
      Selesai: 'Done', 'Sudah dibayar': 'Paid', Gudang: 'Warehouse',
      'Putuskan perpanjang atau ganti vendor sebelum kontrak berakhir.': 'Decide to renew or change vendor before the contract ends.',
    },
    templates: {
      'Belum order $1 hari. Jadi Lost dalam $2 hari — hubungi sekarang.': 'No orders for $1 days. Becomes Lost in $2 days — contact them now.',
      '$1 berakhir $2': '$1 ends $2', 'Tambah $1': 'Add $t1',
    },
    patterns: manualPatterns,
    finish,
  });
  // What a user can type stays, even when the dictionary knows the words.
  for (const text of ['Selesai', 'Sudah dibayar', 'Gudang', 'PR-2026-001 · Gudang', 'Rapat berakhir cepat', 'Tambah Selesai', 'Sales, Selesai']) {
    assert.equal(t.strict(text), text, text);
  }
  assert.equal(t('Selesai'), 'Done', 'outside a sentence zone the label translates');
  // Whole sentences of the app, dates and counts translate.
  assert.equal(t.strict('Putuskan perpanjang atau ganti vendor sebelum kontrak berakhir.'), 'Decide to renew or change vendor before the contract ends.');
  assert.equal(t.strict('Belum order 75 hari. Jadi Lost dalam 15 hari — hubungi sekarang.'), 'No orders for 75 days. Becomes Lost in 15 days — contact them now.');
  assert.equal(t.strict('LPT-001 berakhir 2026-10-01'), 'LPT-001 ends 2026-10-01', 'codes and dates around a weak template');
  assert.equal(t.strict('GA-2026-010 · ATK: Kertas HVS A4 (+2 barang lain)'), 'GA-2026-010 · Office supplies: Kertas HVS A4 (+2 more)');
  assert.equal(t.strict('5 Okt 2026, 14.05'), '5 Oct 2026, 14:05');
  assert.equal(t.strict('3 hari lalu'), '3 days ago');
});

test('covered: what the crawl reports as untranslated interface text', () => {
  const t = createTranslator({
    exact: { Selesai: 'Done', Aktif: 'Active' },
    templates: { 'Ubah $1': 'Edit $1', 'Diselesaikan $1': 'Completed by $1' },
    same: ['Sales', 'Model $1'],
    patterns: manualPatterns,
    finish,
  });
  assert.equal(t.covered('Selesai'), true);
  assert.equal(t.covered('Sales'), true, 'listed as identical in English');
  assert.equal(t.covered('Model sonnet'), true, 'a template listed as identical');
  assert.equal(t.covered('PO-2026-001'), true, 'a code: no lowercase letter');
  assert.equal(t.covered('nama@prakasa.id'), true);
  assert.equal(t.covered('{{nama_isian}}'), true);
  assert.equal(t.covered('Belum ada apa-apa'), false);
  assert.equal(t.covered('Selesai · Budi Santoso'), false, 'a record name beside a label is unmarked record data');
  assert.equal(t.covered('Selesai · Budi Santoso', { pieces: false }), true, 'an attribute joins a label and a title in one string');
  assert.equal(t.covered('Diselesaikan Budi Santoso'), true, 'a name inside a sentence template');
  assert.equal(t.covered('Ubah Access point · Ubiquiti U6'), true, 'a label, then a title that holds " · "');
  assert.equal(t('Model sonnet'), 'Model sonnet', 'an identical template never changes the text');
});

test('patterns.js: sentences the app assembles around a date, a name or a second sentence', () => {
  const t = createTranslator({
    exact: {
      Selesai: 'Done', 'Belum dikerjakan': 'Not started', 'Tanpa divisi': 'No division', Perangkat: 'Devices', 'Sales order': 'Sales orders',
      'tidak ada perubahan': 'no changes', 'Grafik capaian bulanan': 'Monthly achievement chart',
      'Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance': 'Waiting for the first Accurate Finance pull to be approved by the Finance Supervisor/Head',
    },
    templates: {
      '$1 baru': '$1 new', '$1 berubah': '$1 changed', 'gagal: $1': 'failed: $1',
      'Batch #$1 ($2 perubahan) sudah menunggu keputusan.': 'Batch #$1 ($2 changes) is awaiting a decision.',
      'Komposisi $1 issue: $2.': 'Composition of $1 issue: $t2.',
    },
    patterns: manualPatterns,
    finish,
  });
  const list = [
    ['Terakhir: 30 Sep 2026, 08.33 oleh IT Admin, Sales order: 566 baru, 58 berubah.', 'Last: 30 Sep 2026, 08:33 by IT Admin, Sales orders: 566 new, 58 changed.'],
    ['Terakhir: 1 Okt 2026, 10.30, tidak ada perubahan.', 'Last: 1 Oct 2026, 10:30, no changes.'],
    ['Terakhir: 1 Okt 2026, 10.30 oleh Selesai, gagal: timeout.', 'Last: 1 Oct 2026, 10:30 by Selesai, failed: timeout.'],
    ['Tanpa divisi 1 belum selesai, 0 dikerjakan, 0 selesai, 0 terlambat', 'No division 1 not done, 0 in progress, 0 done, 0 late'],
    ['Proyek Gudang 2 belum selesai, 1 dikerjakan, 0 selesai, 0 terlambat', 'Proyek Gudang 2 not done, 1 in progress, 0 done, 0 late'],
    ['Komposisi 1 issue: Belum dikerjakan 1 (100%), Selesai 0 (0%).', 'Composition of 1 issue: Not started 1 (100%), Done 0 (0%).'],
    ['Perbandingan 2 divisi: Tanpa divisi 1 belum selesai, 0 dikerjakan, 0 selesai, 0 terlambat; Toko A 2 belum selesai, 1 dikerjakan, 3 selesai, 0 terlambat.',
      'Comparison of 2 divisions: No division 1 not done, 0 in progress, 0 done, 0 late; Toko A 2 not done, 1 in progress, 3 done, 0 late.'],
    ['Grafik capaian bulanan, Okt 2026', 'Monthly achievement chart, Oct 2026'],
    ['Perangkat:', 'Devices:'],
    ['Menunggu tarikan data Accurate Finance pertama disetujui Supervisor/Head Finance. Batch #18 (514 perubahan) sudah menunggu keputusan.',
      'Waiting for the first Accurate Finance pull to be approved by the Finance Supervisor/Head. Batch #18 (514 changes) is awaiting a decision.'],
    // Two sentences someone typed stay.
    ['Barang rusak. Mohon diganti.', 'Barang rusak. Mohon diganti.'],
    ['Toko Maju, Okt 2026', 'Toko Maju, Okt 2026'],
  ];
  for (const [id, en] of list) assert.equal(t(id), en, id);
});

test('a template whose translated groups hold known labels wins over a shorter prefix', () => {
  const t = createTranslator({
    exact: { 'Kode barang Accurate': 'Accurate item code', Produk: 'Product', 'Tukar faktur': 'Invoice exchange' },
    templates: { 'Kode $1': 'Code $1', 'Produk $1': 'Product $1', '$1 baris $2': '$t1 row $2', '$1 (lihat)': '$t1 (view)', 'Tukar $1': 'Exchanged $1' },
  });
  assert.equal(t('Kode barang Accurate baris 1'), 'Accurate item code row 1');
  assert.equal(t('Produk baris 2'), 'Product row 2');
  assert.equal(t('Tukar faktur (lihat)'), 'Invoice exchange (view)');
  assert.equal(t('Kode SKU-01'), 'Code SKU-01', 'no label template fits: the prefix template is used');
});

// ------------------------------------------------ the real dictionary (en/)
// Built the way en/index.js builds it (which needs Vite's import.meta.glob).
const { readFileSync: readFile, readdirSync: readDir } = await import('node:fs');
const EN_DIR = new URL('../src/i18n/en/', import.meta.url);
const loadJson = (url) => JSON.parse(readFile(url, 'utf8'));
const dictionary = { exact: {}, templates: {}, same: [...loadJson(new URL('../src/i18n/same.json', import.meta.url))] };
for (const name of readDir(EN_DIR).filter((file) => file.endsWith('.json')).sort()) {
  const content = loadJson(new URL(name, EN_DIR));
  if (name.endsWith('.same.json')) dictionary.same.push(...content);
  else if (name.endsWith('.patterns.json')) Object.assign(dictionary.templates, content);
  else Object.assign(dictionary.exact, content);
}
const english = createTranslator({ ...dictionary, patterns: manualPatterns, finish });
const { default: contexts } = await import('../src/i18n/en/contexts.js');
const { setTranslator, tr, withSuffix } = await import('../src/i18n/tr.js');

test('the dictionary: labels the app lower-cases inside a sentence resolve', () => {
  const list = [
    ['Peminjaman kendaraan', 'Vehicle booking'],
    ['Pinjam ruang', 'Book a room'],
    ['Cari pelanggan', 'Search customers'],
    ['Filter divisi', 'Filter division'],
    ['Buat dokumen', 'Create document'],
    ['Menunggu persetujuan atasan langsung. Target waktu 5 hari dihitung sejak disetujui.', 'Awaiting approval from the direct manager. The 5-day target time is counted from approval.'],
    ['Menunggu persetujuan head divisi. Target waktu 5 hari dihitung sejak disetujui.', 'Awaiting approval from the division head. The 5-day target time is counted from approval.'],
    ['Menunggu persetujuan head management office. Target waktu 5 hari dihitung sejak disetujui.', 'Awaiting approval from the Head of the Management Office. The 5-day target time is counted from approval.'],
    ['Kampanye sudah selesai. Hanya catatan hasil yang masih bisa diubah.', 'The campaign is already done. Only the result notes can still be changed.'],
    ['Kampanye sudah dibatalkan. Hanya catatan hasil yang masih bisa diubah.', 'The campaign is already cancelled. Only the result notes can still be changed.'],
    ['Gagal memuat spreadsheet', 'Failed to load the spreadsheet'],
    ['Belum ada presentasi yang dibagikan', 'No shared presentation yet'],
  ];
  for (const [id, en] of list) assert.equal(english(id), en, id);
  for (const word of ['barang masuk', 'barang keluar', 'selesai', 'dibatalkan', 'dokumen', 'presentasi', 'kendaraan']) assert.notEqual(english(word), word, word);
});

test('the dictionary: escalation context lines of the management providers translate whole in a sentence zone', () => {
  const list = [
    ['Jaringan · prioritas Tinggi', 'Network · High priority'],
    ['hardware_lama · prioritas Tinggi', 'hardware_lama · High priority'],
    ['Diselidiki · tingkat tinggi', 'Under investigation · high severity'],
    ['Terbuka · tingkat kritis', 'Open · critical severity'],
    ['62.5% terkirim · janji kirim 2026-09-22 (Tgl kirim SO)', '62.5% shipped · promised 2026-09-22 (SO delivery date)'],
    ['0% terkirim · janji kirim 2026-09-22 (standar 2×24 jam dari tanggal SO, digeser ke Senin)', '0% shipped · promised 2026-09-22 (standard 2×24 hours from the SO date, moved to Monday)'],
    ['6 barang habis sebelum barang datang, belum ada PO baru · paling cepat habis ± 4 hari · waktu datang 7 hari (perkiraan) · 2 dengan PO lama belum ditutup · 1 stok minus di Accurate',
      '6 items run out before incoming goods arrive, no new PO yet · earliest in ± 4 days · lead time 7 days (estimate) · 2 with old POs not closed yet · 1 with negative stock in Accurate'],
    ['1 barang habis sebelum barang datang, belum ada PO baru · paling cepat habis ± 1 hari · waktu datang 12 hari',
      '1 item runs out before incoming goods arrive, no new PO yet · earliest in ± 1 day · lead time 12 days'],
    ['2 baris tanpa kode barang — belum bisa dicocokkan dengan RI-1, RI-2 +3 lainnya', '2 lines without an item code — cannot be matched with RI-1, RI-2 +3 more yet'],
    ['1 barang beda jumlah dengan DO-1 (satuan dasar)', '1 item differs in quantity from DO-1 (base unit)'],
    ['Offboarding: 1 item checklist lewat tenggat', 'Offboarding: 1 checklist item overdue'],
  ];
  for (const [id, en] of list) assert.equal(english.strict(id), en, id);
  // Not the app's line: a name where the label belongs, or a phrase that only holds a number.
  for (const text of ['Jaringan · prioritas Budi', 'Catatan 5 baru', 'Rapat 3 hari', 'Menunggu keputusan']) assert.equal(english.strict(text), text, text);
});

test('the dictionary: a count of one reads as a singular', () => {
  const list = [
    ['1 faktur mata uang asing', '1 foreign currency invoice'], ['1 faktur uang muka', '1 down payment invoice'], ['2 faktur mata uang asing', '2 foreign currency invoices'],
    ['1 faktur lewat jatuh tempo', '1 overdue invoice'], ['permission aktif · 1 pengguna', 'active permissions · 1 user'], ['1 baris', '1 row'], ['1 barang', '1 item'],
    ['Terlambat 1 hari', '1 day late'], ['1 notifikasi belum dibaca', '1 unread notification'],
  ];
  for (const [id, en] of list) assert.equal(english(id), en, id);
});

test('the dictionary: sentences that used to be glued from fragments are whole strings now', () => {
  const list = [
    ['Piutang Rp 1.250.000 dari 3 faktur', 'Receivables of Rp 1.250.000 from 3 invoices'],
    ['Toko Maju · piutang Rp 1.250.000 dari 3 faktur', 'Toko Maju · receivables of Rp 1.250.000 from 3 invoices'],
    ['Dokumen yang dibagikan orang lain ke Anda akan muncul di sini.', 'Documents other people share with you will appear here.'],
    ['Lihat daftar presentasi', 'View the presentation list'],
    ['Lewat tenggat 28 Sep 2026', 'Overdue since 28 Sep 2026'],
    ['Lebih rendah lebih baik; dinilai dari angka saat ini.', 'Lower is better; rated on the current figure.'],
    ['Modul', 'Module'], ['Stok', 'Stock'],
    ['Kamis, 1 Okt 14.00 WIB', 'Thursday, 1 Oct 14:00 WIB'],
    ['Nov 2025 – Okt 2026', 'Nov 2025 – Oct 2026'],
  ];
  for (const [id, en] of list) assert.equal(english(id), en, id);
  // The reorder rule line: four sentences joined with " · ".
  const rule = english('Pesan bila stok + PO berjalan < keluar per hari × (waktu datang + 7 hari stok pengaman); jumlah = sampai cukup waktu datang + 7 + 14 hari, dibulatkan ke atas per satuan beli · waktu datang 14 hari (perkiraan) sampai penerimaan gudang disetujui · PO lama tidak dihitung · stok total saja, tanpa stok per gudang.');
  assert.doesNotMatch(rule, /\b(bila|waktu|datang|hari|lama|dihitung|saja|tanpa|gudang)\b/, rule);
  assert.equal(english.covered('Budi Santoso'), false, 'a name is not interface text');
});

test('contexts.js: every context gives its word another English than the dictionary', () => {
  for (const [name, words] of Object.entries(contexts)) {
    for (const [word, meaning] of Object.entries(words)) {
      assert.ok(dictionary.exact[word], `${name}: "${word}" has a default translation`);
      assert.notEqual(meaning, dictionary.exact[word], `${name}: "${word}" needs no context — same as the default`);
    }
  }
  assert.equal(contexts.period.Selesai, 'End');
  assert.equal(contexts.campaign.Tujuan, 'Objective');
  assert.equal(contexts.expiry.Kedaluwarsa, 'Expiry');
  assert.equal(contexts.quantity.Jumlah, 'Quantity');
  assert.equal(contexts.mail.Sampah, 'Trash');
  assert.equal(contexts.cover.Cukup, 'Cover');
  assert.equal(contexts.chat.Aplikasi, 'Apps');
  assert.equal(contexts.holder.Orang, 'Person');
  assert.equal(contexts.booking.Pesan, 'Book');
  assert.equal(contexts.direction.Masuk, 'In');
  // The title of one form Prakasa AI fills, against the page or the count of the same name.
  assert.deepEqual(contexts.form, { 'Pelanggan baru': 'New customer', Kampanye: 'Campaign', 'Tiket IT': 'IT ticket', 'Template checklist': 'Checklist template' });
  assert.equal(english('Pelanggan baru'), 'New customers');
  assert.equal(english('Kampanye'), 'Campaigns');
  assert.equal(english('Mengisi 4 kolom di formulir Pelanggan baru'), 'Filling 4 fields in the New customer form');
  assert.equal(english('Mengisi 1 kolom di formulir Kampanye'), 'Filling 1 field in the Campaign form');
  assert.equal(english('Mengisi 3 kolom di formulir Tiket IT'), 'Filling 3 fields in the IT ticket form');
  assert.equal(english('Mengisi 2 kolom di formulir Tindak lanjut eskalasi'), 'Filling 2 fields in the Escalation follow-up form');
  assert.equal(english('Mengisi 2 kolom di formulir Ubah perangkat jaringan'), 'Filling 2 fields in the Edit network device form');
  assert.equal(english('Mengisi 2 kolom di formulir BAST perangkat'), 'Filling 2 fields in the Device handover record (BAST) form');
  assert.equal(english('Mengisi 5 kolom di formulir Buat dokumen dari template'), 'Filling 5 fields in the Create document from template form');
  assert.equal(english('Membuka halaman Tiket IT'), 'Opening page IT tickets');
  assert.equal(english('Masuk'), 'Sign in');
  assert.equal(english('Keluar'), 'Sign out');
});

test('tr(): synchronous translation for strings that never become a DOM text node', () => {
  assert.equal(tr('(nonaktif)'), '(nonaktif)', 'Indonesian (no translator loaded): the text as it is');
  assert.equal(withSuffix('Gudang', '(nonaktif)'), 'Gudang (nonaktif)');
  setTranslator(english, contexts);
  try {
    assert.equal(tr('(nonaktif)'), '(inactive)');
    assert.equal(withSuffix('Gudang', '(nonaktif)'), 'Gudang (inactive)', 'the record name is never translated, the suffix is');
    assert.equal(withSuffix('Selesai', '(saya)'), 'Selesai (me)');
    assert.equal(withSuffix('Sprint 3', '(aktif)'), 'Sprint 3 (active)');
    assert.equal(withSuffix('Indihome', '(cadangan)'), 'Indihome (backup)');
    assert.equal(tr('12 orang'), '12 people');
    assert.equal(tr('Masuk', 'direction'), 'In');
    assert.equal(tr('Sampah', 'mail'), 'Trash');
    assert.equal(tr('Sampah'), 'Waste');
    assert.equal(withSuffix('Gudang', undefined), 'Gudang');
  } finally {
    setTranslator(null);
  }
});
