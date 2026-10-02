# Bahasa antarmuka: Indonesia ⇄ Inggris

Catatan singkat untuk developer. Kode ada di `frontend/src/i18n/`, tombolnya di
`frontend/src/components/LanguageSwitch.jsx` (bar atas, sebelah lonceng; pojok kanan atas layar login).

## Cara kerjanya

- **Sumber aplikasi tetap bahasa Indonesia.** Bahasa Inggris adalah lapisan saat jalan: tidak ada `t('key')` di halaman.
- Pilihan bahasa disimpan di `localStorage` (`pw.lang` = `id` | `en`). Mengganti bahasa memuat ulang halaman
  (`i18n/language.js`), jadi teks dan format tanggal berganti bersamaan.
- Pilihan itu juga disimpan di akun (`users.language`, `PATCH /auth/me/preferences`): tombol bahasa dan halaman
  "Akun saya" (`/akun`) menyimpannya (`i18n/accountLanguage.js`; tombol bar atas tetap berganti bahasa walau simpan
  gagal atau belum masuk). Saat masuk, bahasa akun dipakai bila berbeda dari `pw.lang` (`accountLanguageToApply`,
  `context/AuthContext.jsx`) — satu kali muat ulang, tidak berulang.
- Mode Indonesia tidak memuat apa pun. Mode Inggris memuat kamus (`i18n/en/`, chunk terpisah) lalu menjalankan
  penerjemah DOM (`i18n/domTranslator.js`) sebelum React merender (`i18n/boot.js`).
- Penerjemah DOM memakai `MutationObserver`: ia hanya mengganti `nodeValue` teks dan nilai beberapa atribut
  (`placeholder`, `aria-label`, `title`, `alt`, `data-pw-tooltip`, `data-label`, …). Ia tidak pernah menambah,
  membungkus, atau memindahkan node, jadi React tidak terganggu. Teks SVG dan `<title>` ikut diterjemahkan.
- Mesin terjemahan (`i18n/translate.js`) mencari teks utuh di kamus, lalu pola:
  - `en/<chunk>.json` — `{ "Indonesia": "English" }`
  - `en/<chunk>.patterns.json` — templat dengan `$1`, `$2` … (`"$1 hari lalu": "$1 days ago"`). `$1` disisipkan apa
    adanya (angka, nama, data); `$t1` diterjemahkan lagi (hanya untuk bagian yang memang label).
  - `en/patterns.js` — pola tulis-tangan untuk bentuk umum: tanggal dari server, durasi, hitungan dengan jamak,
    "Label (12)", "a · b", judul yang dirakit backend. Setiap pola punya kasus di `test/i18nTranslate.test.js`.
  - `en/<chunk>.same.json`, `i18n/same.json` — teks yang sama di kedua bahasa (nama produk, singkatan).
  - `en/contexts.js` — kata yang artinya beda di satu tempat ("Jumlah" = Quantity di kolom barang, Amount di tempat
    lain). Dipakai lewat `translateContext` (kolom DataGrid, item KeyValue), `<Context name="…">`,
    `<Translate context="…">`, atau `tr(teks, 'konteks')`.
- Hitungan satu dibaca tunggal: hasil pola dilewatkan ke `finish` (`en/patterns.js`), yang mengubah
  "1 <paling banyak tiga kata> <kata benda jamak>" menjadi tunggal ("1 foreign currency invoices" → "1 foreign currency
  invoice", "1 items have" → "1 item has"). Hanya untuk kata benda di daftar `SINGULAR` — tambahkan kata baru di sana bila
  templat baru menghitung benda lain. Zona data tidak pernah disentuh.
- Angka dan "Rp" tetap format Indonesia di kedua bahasa (sama dengan Accurate). Tanggal dan jam mengikuti bahasa
  (`components/format.js`, `i18n/names.js`).
- `tr()` (`i18n/tr.js`) menerjemahkan secara sinkron untuk teks yang tidak pernah jadi node DOM: isi `<option>` yang
  mencampur nama dan keterangan, `document.title`, canvas. Di mode Indonesia ia mengembalikan teks aslinya.

## Aturan utama: data Accurate dan ketikan pengguna tidak diterjemahkan

Nama pelanggan, barang, pemasok, sales, gudang, karyawan; nomor dokumen; catatan, alasan, komentar; judul tugas dan
event; nama file; isi email dan chat; jawaban AI — **tidak pernah** diterjemahkan. Pelanggan bernama "Gudang" atau
"Selesai" dan barang bernama "Simpan" harus tampil persis seperti diketik.

Caranya: setiap tempat yang menampilkan teks milik record adalah **zona data**.

| Keadaan | Yang dipakai |
| --- | --- |
| Sel DataGrid, nilai KeyValue, opsi `<Select dataOptions>` | sudah zona data secara bawaan |
| Nilai record di JSX | `<span data-no-translate="">{row.name}</span>`, `{...noTranslate}`, `<NoTranslate>` |
| Judul halaman / kartu / dialog / sheet / grid berupa nama record | `dataTitle` (Card juga `dataSubtitle`) |
| Baris campuran label + data (`a · b · c`) | `<Mixed parts={[LABEL[x], formatDate(d), data(row.note)]} />`; di KeyValue: `parts` |
| Label di dalam zona data (status, "Ya/Tidak", jenis) | `translate: true` pada kolom / item, atau `<Translate>` |
| Nama record + keterangan dalam satu `<option>` | `{ label: nama, suffix: '(nonaktif)' }` |
| Atribut yang isinya hanya data (aria-label = judul event) | `data-no-translate="attr"` (`{...dataAttributes}`) |
| Teks yang dirakit backend di sekitar data, atau bisa juga ketikan pengguna (isi notifikasi, konteks eskalasi, judul permintaan GA) | zona kalimat: `{...strictTranslate}`, `<Translate strict>`, `translate: 'strict'`, `dataTitle="strict"` |
| Chip, tab, opsi, menu yang isinya nama record | `data` pada komponennya |

Baris konteks Pusat Eskalasi disusun provider di backend (`backend/src/management/providers/`) dan tampil di zona
kalimat. Bentuk yang seluruhnya label aplikasi ("Jaringan · prioritas Tinggi", "62.5% terkirim · janji kirim …") punya
pola `strict: true` di `en/patterns.js`; bentuk baru perlu pola (dan kasus uji) sendiri. `reference` sebuah eskalasi
biasanya nomor dokumen (data). Provider yang mengisi `reference` dengan label aplikasi (jenis kontrak, tujuan kampanye)
mengirim `referenceLabel: true` lewat `escalationItem`, lalu halaman menerjemahkannya.

Zona kalimat hanya menerjemahkan kalimat utuh milik aplikasi (entri kamus ≥ 3 kata, templat, tanggal, hitungan).
Satu-dua kata seperti "Selesai" atau "Sudah dibayar" dianggap ketikan orang dan dibiarkan.

Mesin juga menjaga dirinya: templat "lemah" (satu kata, misalnya `"$1 dan $2"`, `"Tambah $1"`) tidak dipakai untuk
frasa bebas, jadi kalimat yang diketik pengguna tidak terpotong-potong menjadi campuran dua bahasa.

Jangan pernah merakit satu teks dari potongan huruf atau kata (`` `${x ? 'P' : 'p'}iutang` ``,
`` `${label} ${tanggal}` `` tanpa kalimat): tulis kalimat utuh per cabang. Teks diterjemahkan per node, utuh.

## Menambah teks baru

1. Tulis teksnya dalam bahasa Indonesia seperti biasa.
2. Jalankan `cd frontend && node scripts/i18n-extract.mjs`. Teks baru masuk ke
   `src/i18n/catalog/chunks/additions.todo.json` (dan `additions.patterns.todo.json` untuk templat).
3. Terjemahkan ke `src/i18n/en/additions.json` / `additions.patterns.json` (ikuti `src/i18n/glossary.md`:
   sentence case, tanpa tanda seru). Teks yang sama di bahasa Inggris masuk `additions.same.json`; yang bukan teks
   antarmuka masuk `src/i18n/ignore.json`.
4. Jalankan lagi extractor, lalu `node --test test/*.test.js`. Selama ada teks katalog yang belum diterjemahkan,
   `test/i18nCoverage.test.js` gagal (penanda `src/i18n/en/.complete` mengaktifkan pemeriksaan ini).
5. Bila teks baru menampilkan data record, tandai zonanya (tabel di atas).

Pemeriksaan di browser (mode dev, bahasa Inggris): `window.__pwI18nReport()` mengembalikan `misses` (teks antarmuka
yang belum punya terjemahan, atau data record di luar zona data) dan `skipped` (teks di zona data yang sebenarnya
punya terjemahan — mungkin label yang perlu `translate: true`).

## Yang sengaja tidak diterjemahkan

- Data dari Accurate dan semua ketikan pengguna (aturan utama di atas).
- Email, chat, isi dokumen Google di dalam iframe, dan file yang diunggah.
- Jawaban Prakasa AI: tidak diterjemahkan penerjemah DOM. AI sendiri menulis dalam bahasa antarmuka akun (`users.language`;
  aturan `languageRule` di `backend/src/services/ai/agent/agentRun.js`), kecuali pengguna jelas meminta bahasa lain. Hasil
  alat dan nama record tetap seperti tersimpan.
- Dokumen cetak dan ekspor: surat jalan / invoice / kwitansi (`pages/sales/SalesPrint.jsx`), isi template BAST dan
  dokumen hukum (`backend/src/config/docTemplates.js`), pratinjau kop, CSV/Excel hasil ekspor — selalu bahasa Indonesia.
- Nama merek dan singkatan (Prakasa Workspace, Accurate, SimpliDOTS, SO, PO, DPP, PPN, BAST …).
- Tombol bahasa itu sendiri ("ID" / "EN").
- Potongan label pendek di dalam baris yang dirakit backend di sekitar data (misalnya status satu kata di baris
  konteks eskalasi): aman dibiarkan daripada berisiko menerjemahkan nama record.
