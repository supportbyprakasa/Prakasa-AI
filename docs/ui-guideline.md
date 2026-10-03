# Prakasa Workspace — UI Guideline

Satu acuan untuk semua tampilan. **Rujukan tunggal: Google Admin console (admin.google.com)**, dengan angka dari
[referensi-desain-admin-console.md](referensi-desain-admin-console.md) (diukur 30 September 2026). Keputusan
cara memakainya ada di [program-desain-admin-console.md](program-desain-admin-console.md) (K1–K12).

- Setiap komponen menyalin komponen padanannya di admin console apa adanya: ukuran, warna, huruf, jarak, bayangan, dan gerak.
- Bila admin console punya dua generasi untuk komponen yang sama, dipakai generasi B (Material 3).
- Nilai bertanda **(sementara)** belum teramati di admin console. Nilai itu memakai standar Material Google dan diganti bila ada pengukuran baru. Nilai lain adalah angka ukur.

Aturan di dokumen ini **ditegakkan otomatis** oleh `frontend/test/uiGuideline.test.js`.
Kalau tes gagal, perbaiki kodenya — jangan melonggarkan tesnya. Semua nilai tinggal di
`src/styles/tokens.css`; CSS lain hanya memakai token.

---

## 1. Fondasi

### 1.1 Warna

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--pw-primary` | `#0B57D0` | Tombol utama, tautan, cincin fokus |
| `--pw-on-primary` | `#FFFFFF` | Teks di atas primer |
| `--pw-accent` | `#3367D6` | Komponen generasi A: item menu aktif, checkbox tercentang, garis fokus field, label fokus, app bar dialog layar penuh, badge hitungan, tautan kecil |
| `--pw-tab` | `#1A73E8` | Tab aktif dan indikatornya, radio terpilih, progress |
| `--pw-selected` | `#E8F0FE` | Latar item menu aktif, baris tabel terpilih, chip filter terpilih |
| `--pw-secondary-container` / `--pw-on-secondary-container` | `#C2E7FF` / `#001D35` | Segmented terpilih, tombol tonal |
| `--pw-text` | `rgba(0,0,0,.87)` | Teks utama, judul halaman, sel kolom pertama |
| `--pw-text-strong` | `#212121` | Teks item menu saat hover, header kolom yang diurutkan |
| `--pw-text-title` | `#1F1F1F` | Bilah atas, judul kartu |
| `--pw-text-secondary` | `#444746` | Subjudul, ikon bilah atas, judul bagian |
| `--pw-text-nav` | `#424242` | Item menu samping, judul kartu dialog, footer menu |
| `--pw-text-header` | `#616161` | Header kolom tabel, label statistik |
| `--pw-text-muted` | `rgba(0,0,0,.54)` | Sel tabel selain kolom pertama, teks bantuan, ikon tombol, label field |
| `--pw-text-meta` | `#757575` | Meta redup (waktu, oleh siapa) |
| `--pw-text-stat` | `#3C4043` | Angka statistik besar |
| `--pw-text-input` / `--pw-text-select` | `#000000` / `#444444` | Teks isian field / teks select (angka ukur) |
| `--pw-surface` | `#FFFFFF` | Halaman, bilah atas, menu samping, panel tabel, dialog |
| `--pw-surface-tint` | `#F0F4F9` | Kartu ringkasan/dasbor dan bagian halaman detail (generasi B) |
| `--pw-surface-container` | `#F5F5F5` | Header tabel, kotak pencarian |
| `--pw-hover-row` | `#EEEEEE` | Hover baris tabel |
| `--pw-hover-nav` | `rgba(66,66,66,.04)` | Hover item menu samping |
| `--pw-divider` | `#E0E0E0` | Pemisah baris tabel, garis bawah header, pemisah bilah filter |
| `--pw-outline-panel` | `rgba(0,0,0,.12)` | Border panel tabel, garis bawah field |
| `--pw-outline-banner` | `#DADCE0` | Border banner |
| `--pw-outline-strong` | `#C4C7C5` | Pemisah footer menu samping |
| `--pw-outline-control` | `#747775` | Border tombol outlined dan segmented (sementara) |
| `--pw-chip-dashed` | `rgba(0,0,0,.26)` | Border putus-putus chip "Tambah filter" |
| `--pw-success` | `#0B8043` | Status berhasil/aktif |
| `--pw-error` | `#D93025` | Status gagal, pesan error field, tombol bahaya (sementara) |
| `--pw-error-tint` | `#FCE8E6` | Latar lembut untuk keadaan error (sementara) |
| `--pw-warning` | `#B06000` | Status butuh perhatian (sementara; lebih gelap dari `#E37400` Google supaya teks status 12px tetap terbaca, kontras WCAG AA) |
| `--pw-info` | `#1A73E8` | Status sedang berjalan |
| `--pw-tooltip-bg` / `--pw-tooltip-text` | `#3C4043` / `#E8EAED` | Tooltip |
| `--pw-snackbar-bg` / `--pw-snackbar-action` | `#323232` / `#8AB4F8` | Snackbar (sementara) |
| `--pw-scrim` | `rgba(0,0,0,.32)` | Scrim dialog kecil, side sheet, dan drawer (sementara) |
| `--pw-disabled-bg` / `--pw-disabled-text` | `rgba(153,153,153,.1)` / `rgba(68,68,68,.5)` | Tombol nonaktif |
| `--pw-chart-series` / `--pw-chart-grid` / `--pw-chart-axis` | `#4184F3` / `#EEEEEE` / `#9E9E9E` | Grafik |

Tidak ada warna di luar tabel ini. **Dilarang** hex/rgb di JSX.

### 1.2 Huruf

Tiga keluarga, dimuat dari Google Fonts di `index.html`. Semuanya berlisensi terbuka.

| Token | Keluarga | Dipakai untuk |
|---|---|---|
| `--pw-font-sans` | `"Google Sans", Roboto, Helvetica, Arial, sans-serif` | Bilah atas, judul halaman/kartu/dialog, tab, segmented, angka statistik |
| `--pw-font-flex` | `"Google Sans Flex", "Google Sans", Roboto, Arial, sans-serif` | Tombol dan tautan di kartu |
| `--pw-font-roboto` | `Roboto, Arial, sans-serif` | Default `body`: teks isi, menu samping, tabel, field, keterangan, tooltip |

Google Sans memakai `font-optical-sizing: auto`, sehingga di bawah 18 px tampil sebagai potongan "Text", sama dengan Google Sans Text di admin console.

Peran teks (font-size / line-height, tebal, warna). Hanya 400 dan 500; 700 hanya untuk hitungan di toolbar kontekstual.

| Peran (kelas) | Nilai |
|---|---|
| Judul halaman `.pw-title-page` | Google Sans 24/32, 400, `--pw-text` |
| Subjudul halaman | Google Sans 16/24, 400, `--pw-text-secondary` |
| Judul kartu `.pw-title-card` | Google Sans 22/28, 400, `--pw-text-title` |
| Subjudul kartu | Google Sans 14/20, 400, `--pw-text-secondary` |
| Judul bagian `.pw-title-section` | Roboto 18/24, 400, `--pw-text-secondary` |
| Judul panel/toolbar tabel `.pw-title-panel` | Roboto 15/16, 500, `--pw-text` |
| Teks isi (default) | Roboto 14/20, 400, `--pw-text` |
| Label tebal | Roboto 14/20, 500, `--pw-text` |
| Teks tabel | Roboto 13/20, 400 |
| Header tabel | Roboto 12/16, 500, `--pw-text-header` |
| Keterangan / bantuan `.pw-text-helper` | Roboto 12/16, 400, `--pw-text-muted` |
| Meta `.pw-text-meta` | Roboto 12/18, 400, `--pw-text-meta` |
| Judul seksi kecil `.pw-overline` | Roboto 12/16, 500, `--pw-text-muted` (tidak huruf kapital semua) |
| Angka statistik | Google Sans 32/40, 400, `--pw-text-stat` |
| Label statistik | Roboto 12/16, 400, `letter-spacing: .3px`, `--pw-text-header` |
| Tombol | Google Sans Flex 14/20, 500 |
| Tab | Google Sans 14/20, 500, `letter-spacing: .25px` |
| Item menu samping | Roboto 14/20 |
| Tooltip | Roboto 12/16, `letter-spacing: .4px` |
| Nama aplikasi di bilah atas | Google Sans 22/48, 400, `--pw-text-title` |
| Judul dialog kecil | Google Sans 22/28, 400, `--pw-text-title` (sementara) |
| Judul dialog layar penuh | Roboto 20/26, 400, putih |

Ukuran yang diizinkan (px): **12, 13, 14, 15, 16, 18, 20, 22, 24, 32**, ditambah 36 hanya di halaman Login.
Semua tebal `<b>`/`<strong>` = 500. Tidak ada teks huruf kapital semua.

### 1.3 Bentuk (radius)

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--pw-radius-xs` | 2px | Kartu grafik |
| `--pw-radius-sm` | 3px | Panel tabel, checkbox, daftar select, dropdown paginasi |
| `--pw-radius-md` | 4px | Tooltip, snackbar, menu, banner (sementara) |
| `--pw-radius-lg` | 8px | Dialog kecil (sementara) |
| `--pw-radius-xl` | 12px | Kartu (generasi B) |
| `--pw-radius-search` | 28px | Kotak pencarian |
| `--pw-radius-full` | 999px | Tombol, chip, tombol ikon, avatar, badge hitungan |

Item menu samping: `0 20px 20px 0` (sisi kanan penuh); indikator tab: `3px 3px 0 0`.

### 1.4 Bayangan

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--pw-elev-1` | `0 1px 1px 0 rgba(0,0,0,.14), 0 2px 1px -1px rgba(0,0,0,.12), 0 1px 3px 0 rgba(0,0,0,.2)` | Footer menu samping |
| `--pw-elev-2` | `0 2px 2px 0 rgba(0,0,0,.14), 0 3px 1px -2px rgba(0,0,0,.12), 0 1px 5px 0 rgba(0,0,0,.2)` | Kartu grafik |
| `--pw-elev-appbar` | `0 1px 2px 0 rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)` | App bar dialog layar penuh, bilah atas saat di-scroll (sementara), kotak pencarian saat fokus (sementara) |
| `--pw-elev-menu` | `0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12)` | Menu, dropdown, popover (sementara) |
| `--pw-elev-dialog` | `0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12)` | Dialog kecil, side sheet (sementara) |
| `--pw-elev-fullscreen` | `0 12px 15px 0 rgba(0,0,0,.24)` | Dialog layar penuh |
| `--pw-elev-snackbar` | `0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14), 0 1px 18px 0 rgba(0,0,0,.12)` | Snackbar (sementara) |

Kartu, panel, tabel, dan tombol **tidak** berbayang.

### 1.5 Gerak

| Token | Nilai |
|---|---|
| `--pw-ease-standard` | `cubic-bezier(.4, 0, .2, 1)` |
| `--pw-ease-decelerate` | `cubic-bezier(0, 0, .2, 1)` (elemen yang masuk) |
| `--pw-ease-accelerate` | `cubic-bezier(.4, 0, 1, 1)` (elemen yang keluar, sementara) |
| `--pw-ease-overshoot` | `cubic-bezier(.4, .1, .5, 1.4)` |
| `--pw-dur-state` | 75ms: state layer hover (linear) |
| `--pw-dur-xs` | 100ms: lebar menu samping, kotak pencarian, chip |
| `--pw-dur-menu` | 120ms: menu terbuka (sementara) |
| `--pw-dur-enter` | 150ms: dialog kecil dan snackbar masuk (sementara) |
| `--pw-dur-sm` | 200ms: checkbox, latar tombol teks |
| `--pw-dur-dialog` | 225ms: dialog masuk |
| `--pw-dur-md` | 250ms: drawer overlay, bayangan bilah atas |
| `--pw-dur-icon` | 300ms: latar tombol ikon |
| `--pw-dur-ripple` | 450ms: ripple (sementara) |
| `--pw-dur-loop` | 1350ms: putaran spinner, skeleton, progress tak tentu |
| `--pw-delay-tooltip` | 500ms |

Setiap animasi masuk punya animasi keluar. Satu blok `prefers-reduced-motion` di `tokens.css` mematikan semuanya.

### 1.6 Lapisan (z-index)

`--pw-z-sticky` 10 · `--pw-z-appbar` 100 · `--pw-z-drawer` 200 · `--pw-z-sheet` 250 · `--pw-z-dialog` 300 ·
`--pw-z-menu` 400 · `--pw-z-snackbar` 500 · `--pw-z-tooltip` 600. Tidak ada angka z-index lain selain 0, 1, dan -1 lokal.
Snackbar selalu di atas dialog, dan menu yang dibuka di dalam dialog tampil di atas dialog.

### 1.7 Ukuran

| Token | Nilai |
|---|---|
| `--pw-topbar-height` | 64px (56px di ≤ 600) |
| `--pw-nav-width` / `--pw-nav-rail-width` / `--pw-nav-drawer-width` | 256 / 64 / 280px |
| `--pw-nav-item-height` | 40px |
| `--pw-control-height` | 40px: tombol, segmented |
| `--pw-icon-button` / `--pw-icon-button-sm` | 48 / 40px |
| `--pw-field-height` | 62px: field bergaris bawah |
| `--pw-search-height` | 46px |
| `--pw-chip-height` | 32px |
| `--pw-tab-height` | 48px |
| `--pw-row-height` / `--pw-header-row-height` | 48 / 48px (ditambah garis 1px) |
| `--pw-filterbar-height` / `--pw-toolbar-height` / `--pw-pager-height` | 56 / 48 / 57px |
| `--pw-icon-sm` / `--pw-icon-md` / `--pw-icon-lg` | 18 / 20 / 24px |
| `--pw-page-gutter` | 24px |

Target sentuh minimum 40px.

### 1.8 Spasi

Skala: 4 · 8 · 12 · 16 · 24 · 32 · 48. Angka ukur khusus dipakai di dalam komponennya saja: sel tabel 10, header
tabel 17/10, bilah filter 8/12/8/32, label menu samping 46/62. Jarak antar-elemen diatur oleh **kontainer** (`pw-stack`, `pw-row`, `pw-form-grid`, `gap`), bukan margin di elemen.

### 1.9 Breakpoint (sesuai pengukuran)

| Nama | Lebar | Perilaku |
|---|---|---|
| Ponsel | ≤ 600 | Bilah atas 56px, pencarian jadi ikon, tabel jadi kartu bertumpuk (label kolom di atas nilai), satu kolom |
| Ringkas | 601–1023 | Menu samping hilang dan dibuka sebagai drawer 280px; tabel lebar digeser ke samping |
| Desktop | ≥ 1024 | Menu samping permanen 256px, bisa diciutkan ke 64px lewat ☰ |

CSS: `@media (max-width: 600px)`, `(max-width: 1023px)`, `(min-width: 1024px)`. Tidak ada nilai lain.

### 1.10 Interaksi

- **State layer** (`.pw-state-layer`, satu-satunya sistem): hover 4%, fokus 12%, tekan 10% dari warna teks. Tombol terisi: hover 5% (angka ukur), transisi `opacity 75ms linear`.
- **Ripple** (`src/styles/ripple.js`): gelombang dari titik klik, opacity 12%, tumbuh 450ms selama ditekan, memudar saat dilepas (sementara). Otomatis untuk semua kontrol bersama dan semua elemen ber-class `pw-state-layer`.
- **Kartu dan baris** tidak berubah bayangan saat hover. Baris tabel memakai latar `--pw-hover-row`; kartu yang bisa diklik hanya state layer.
- **Cincin fokus** (pengecualian aksesibilitas K5): `outline: 2px solid var(--pw-primary); outline-offset: 2px`, hanya `:focus-visible`.
- **Nonaktif**: latar `--pw-disabled-bg`, teks `--pw-disabled-text`, `cursor: not-allowed`.

### 1.11 Ikon

Material Symbols Outlined (weight 400, fill 0), lewat `<Icon name="…" size="sm|md|lg" />` saja. Ukuran: 24 untuk tombol ikon,
bilah atas, dan chip; 20 untuk menu samping; 18 di dalam tombol berlabel. Ikon dekoratif selalu `aria-hidden`.

---

## 2. Bingkai

### 2.1 Bilah atas (`Navbar`)
- Tinggi 64px (56px di ≤ 600), latar putih, tanpa garis. Bayangan `--pw-elev-appbar` muncul hanya saat halaman di-scroll (`box-shadow 250ms`).
- Kiri: tombol ☰ 48×48 (margin 0 4px, ikon 24 `--pw-text-secondary`), lalu nama aplikasi "Prakasa Workspace" (Google Sans 22/48, padding kiri 8px).
- Pencarian: lebar maks 720px × tinggi 46px, latar `--pw-surface-container`, border 1px transparan, radius 28, Google Sans 16 `--pw-text-secondary`.
  - Di desktop, pencarian dimulai sejajar dengan judul halaman (x = lebar menu samping + gutter 24 = 280px; admin console: 266px karena gutter 10px — kami memilih sejajar dengan konten).
  - Ikon cari dan hapus masing-masing punya area 56×46.
  - Saat fokus, latar putih dengan `--pw-elev-appbar` (sementara).
  - Transisi: `background 100ms ease-in, width 100ms ease-out`.
- Kanan: tombol ikon 48 (notifikasi, tugas, bantuan), tombol ikon 40 (Prakasa AI, peluncur aplikasi), dan avatar 40.
- Di ≤ 600, pencarian menjadi tombol ikon 44×48.

### 2.2 Menu samping (`Sidebar`)
- **Lebar dan latar:** putih, 256px. Bisa diciutkan ke 64px dengan ☰ (`width 100ms`). Di < 1024, menu menjadi drawer 280px dengan scrim (`transform 250ms standard`).
- **Item:** tinggi 40px, bentuk pil `0 20px 20px 0`, padding tautan `4px 8px 4px 16px`. Ikon 20 di kotak 24; label mulai di x = 46. Anak bersarang menjorok +16px.
- **Keadaan item:**

  | Keadaan | Latar | Teks |
  |---|---|---|
  | Normal | — | `--pw-text-nav`, 400 |
  | Hover | `--pw-hover-nav` | `--pw-text-strong` |
  | Aktif | `--pw-selected` | `--pw-accent`, 500 |

  Ikon berwarna `--pw-text`. Ikon item aktif berwarna `--pw-accent`.
- **Grup:** grup (Divisi, Manajemen, …) dapat dibuka-tutup. Baris grup berisi panah dan label Roboto 14/20 500. Grup yang memuat halaman aktif otomatis terbuka.
- **Urutan menurut prioritas pemakaian:**
  1. Dashboard, Notifikasi, Prakasa AI.
  2. **Pekerjaan divisi sendiri** (`ROLE_FOCUS` di navigation.js):

     | Divisi | Menu yang naik ke atas |
     |---|---|
     | Sales | Sales |
     | Warehouse | Warehouse |
     | Procurement | Procurement |
     | People & Culture | People & Culture (Onboarding, Offboarding, Layanan GA) dan IT (Tiket IT dulu) |
     | Management Office | Manajemen dan Laporan |
     | Retail Commerce | Sales dan Warehouse |
     | Marketing | Pelanggan dan Leads |

     Grup ini terbuka sendiri sampai pengguna menutupnya. Bila pengguna punya beberapa peran, divisi dengan peran tertinggi didahulukan (Head, lalu Supervisor, lalu Member). Finance belum punya menu yang naik karena modulnya masih "Segera hadir". Operations bukan divisi: pekerjaannya ditangani GA di People & Culture.
  3. Manajemen (hanya Head dan manajemen yang melihatnya).
  4. Kerja harian, Komunikasi, Dokumen.
  5. Modul divisi lain, lalu Laporan.
  6. Administrasi paling bawah.

  Setiap menu tetap muncul tepat satu kali.
- **Saat menciut:** item menjadi pil 40×40 di x = 12, dengan tooltip.
- **Footer:** di bawah menu, dipisah garis 1px `--pw-outline-strong` dan `--pw-elev-1`. Isinya teks Roboto 12/16 `--pw-text-nav`.

### 2.3 Halaman
- Permukaan putih penuh, tanpa lembar membulat.
- Gutter 24px di semua lebar.
- Urutan dari atas:
  1. `PageTrail` (jejak: Beranda › … › halaman), Roboto 14 `--pw-text-muted`;
  2. `PageHeader`: judul Google Sans 24/32, subjudul Google Sans 16/24;
  3. isi, 24px di bawah header.
- `PageTrail` adalah satu-satunya tombol kembali.
- Pembungkus halaman: `<Page>` (mengatur jarak header → isi dan antar-bagian). Halaman tidak membuat pembungkus sendiri.

---

## 3. Template halaman

### 3.1 Halaman daftar
```
<Page>
  <PageHeader title description actions={<Button icon="add">Tambah X</Button>} />
  <Banner …/>   (bila perlu)
  <DataGrid title search filters … />     // toolbar, bilah filter, tabel, paginasi dalam satu panel
</Page>
```
- Satu pencarian dan satu tempat filter per daftar, keduanya di dalam DataGrid.
- Tombol **Tambah** hanya satu, di `actions` PageHeader.
- Klik baris membuka detail. Pengecualian modul Sales: baris tidak bisa diklik, dan detail dibuka lewat aksi "Lihat detail" (keputusan owner).

### 3.2 Halaman detail
```
<Page>
  <PageHeader eyebrow="Jenis record" title="Nama / nomor" description={status + meta} actions={aksi record} />
  <div className="pw-cols-sidebar"> <div className="pw-stack"><Card title>…</Card></div> <aside className="pw-stack"><Card title="Ringkasan">…</Card></aside> </div>
</Page>
```
- Paling banyak 1 tombol utama dan 2 tombol sekunder di header. Sisanya masuk `ActionMenu` (⋮).
- Aksi keputusan (Setujui/Tolak) diletakkan di header.
- Informasi field-nilai memakai `<KeyValue>`.

### 3.3 Form
- **Form panjang** (buat/ubah record, lebih dari 5 field) memakai `<FullScreenDialog>`, seperti "Add new user" di admin console:
  - app bar 72px `--pw-accent` dengan tombol X di kiri dan judul;
  - kartu isi putih dengan judul bagian Roboto 18/24, field 2 kolom;
  - tombol Batal dan tombol utama di kanan bawah.
  - Halaman form (rute `/…/new`) memakai tampilan yang sama.
- **Form pendek** (≤ 5 field) dan konfirmasi memakai `<Modal size="sm|md">`.
- Selalu `<form>` dengan `<FormActions>`: Batal (teks) di kiri, tombol utama di kanan.

### 3.4 Dasbor
- Kartu ringkasan: `<Card>` bernada `--pw-surface-tint`, radius 12, tanpa bayangan, jarak 24px.
- Angka kunci: `<StatCard>` (angka Google Sans 32, label Roboto 12).

---

## 4. Komponen — wajib dipakai

### 4.1 Tombol (`Button`) — generasi B

| Varian | Tampilan | Kapan |
|---|---|---|
| `primary` (default) | Pil 40px, padding 0 24px, latar `--pw-primary`, teks putih | Satu aksi utama per area |
| `secondary` | Pil outlined: border 1px `--pw-outline-control`, teks `--pw-primary` (sementara) | Aksi alternatif setara (Ekspor, Impor) |
| `text` | Transparan, padding 0 12px, teks `--pw-primary` | Batal, Lihat semua |
| `tonal` | `--pw-secondary-container` / `--pw-on-secondary-container` | Toggle terpilih |
| `danger` | Latar `--pw-error`, teks putih | Aksi merusak — selalu lewat `ConfirmDialog` |

- **Tampilan dasar:**
  - label Google Sans Flex 14/500, huruf kapital di awal saja, berupa kata kerja + objek;
  - ikon 18 lewat prop `icon` (nama Material Symbols); dengan ikon, padding kiri 16 (tombol teks 12/16);
  - tooltip lewat prop `tooltip` (atribut `title` lama diubah otomatis menjadi tooltip);
  - hover memakai state layer (5% di tombol terisi); tanpa bayangan;
  - keadaan nonaktif sesuai §1.10.
- **Aturan penempatan:**
  - Satu primary per area; yang paling penting paling kanan.
  - Tombol yang hanya berisi ikon memakai `<IconButton label>` (tooltip dan `aria-label` wajib).
  - Navigasi memakai `<Button to|href>`.
  - `<a className="pw-button">` dan `<button>` mentah di halaman dilarang.

### 4.2 Tombol ikon (`IconButton`)
- Ukuran 48×48, atau 40×40 dengan `size="sm"`; bulat.
- Ikon 24 `--pw-text-muted`, di bilah atas `--pw-text-secondary`.
- Transisi `background 300ms`. Prop `selected` memakai latar `--pw-selected` dan ikon `--pw-accent` (`aria-pressed`). Slot `badge`: angka/teks → `CountBadge`, `true` → titik. `variant="filled"` untuk tombol kirim.

### 4.3 Field (`Input`, `Select`, `Textarea`, `DateInput`) — generasi A, bergaris bawah
- Tinggi total 62px: area isi 50px (padding atas 10), baris input 24px, blok bantuan 24px. Latar transparan.
- Garis bawah 1px `--pw-outline-panel`. Saat fokus, garis 2px `--pw-accent` tumbuh dari tengah (`transform scaleX`, 200ms standard).
- **Label melayang:**
  - saat kosong, label duduk di baris input (Roboto 14 `--pw-text-muted`);
  - saat fokus atau berisi, label naik menjadi 12px; warnanya `--pw-accent` saat fokus;
  - wajib isi ditandai dengan menulis `*` di teks label ("Nama *").
- Teks input 14px `#000000` (`--pw-text-input`). Select: panah `arrow_drop_down` di kanan, daftar radius 3.
- Bantuan: Roboto 12 `--pw-text-muted`. Error menggantikan bantuan, berwarna `--pw-error`; garis bawah 2px dan label ikut `--pw-error` (sementara).
- Placeholder hanya contoh isi. Kontrol tanpa label terlihat wajib `aria-label`.
- Isi berupa kode: `mono`. Field padat untuk sel tabel: `dense` (tinggi 36, label hanya untuk pembaca layar).
- Field tanpa cincin fokus: garis bawah 2px adalah penanda fokusnya. Tanggal, jam, dan bulan selalu melayangkan label dan menampilkan ikon `calendar_today`/`schedule`. Field dengan bantuan atau error setinggi 78px (baris bantuan 24px).
- **Dilarang** `<input>/<select>/<textarea>` mentah di halaman.

- **Jam (`TimeInput`):** select per 15 menit dengan tampilan field yang sama, supaya hanya jam yang valid bisa dipilih (dipakai pemesanan ruang dan kendaraan).

### 4.4 Pencarian (`SearchField`)
Pil 46px, latar `--pw-surface-container`, radius 28, ikon cari 24, placeholder `--pw-text-muted`. Di bilah atas teksnya Google Sans 16 `--pw-text-secondary` (angka ukur). Di dalam panel (DataGrid, `variant="panel"`) teksnya Roboto 14 `--pw-text`, karena panel generasi A memakai Roboto. Escape mengosongkan isian.

### 4.5 Checkbox, radio, switch (`Checkbox`, `Radio`, `Switch`)
- **Checkbox:** kotak 20×20 radius 3, border 2px `--pw-text-muted`. Saat tercentang, terisi penuh `--pw-accent` dengan centang putih. Area sentuh 40 bulat dengan ripple; transisi `border-color 200ms standard`.
- **Radio:** 20×20 dengan area sentuh 28 (sementara 40 untuk ponsel); border 2px `--pw-tab` saat terpilih.
- **Switch** (sementara):
  - track 34×14 radius 7 dan thumb 20;
  - hidup: thumb `--pw-accent`, track `--pw-accent` 50%;
  - mati: thumb putih berbayang, track `rgba(0,0,0,.38)`.

### 4.6 Chip (`Chip`) dan bilah filter
- **Chip filter:** 32px, pil, Roboto 14.
  - Belum terpilih: border 1px `--pw-outline-banner`, teks `--pw-text`.
  - Terpilih: latar `--pw-selected`, teks `--pw-accent`, tanpa border (sementara).
  - Hitungan ditulis dalam label.
- **Ikon di belakang label** (`trailingIcon`, mis. panah dropdown): 24px, 4px setelah label.
- **Chip "Tambah filter":** border 1px putus-putus `--pw-chip-dashed`, padding 0 16px 0 8px, ikon 24 dengan padding kanan 6, teks `--pw-text-muted`.
- **Bilah filter:** di dalam DataGrid, tinggi 56px, padding `8px 12px 8px 32px`, pemisah bawah `inset 0 -1px 0 0 --pw-divider`.

### 4.7 Segmented (`Segmented`)
40px, padding 0 12px, segmen pertama radius `20px 0 0 20px` dan terakhir sebaliknya. Segmen terpilih menampilkan centang 18px; pilihan tunggal adalah grup radio (panah memindah dan memilih), `multiple` menjadi toggle. Border 1px `--pw-outline-control` (sementara). Segmen terpilih `--pw-secondary-container`. Huruf Google Sans 14/20 500. Dipakai untuk pilihan tampilan (mis. Papan/Daftar).

### 4.8 Tab (`TabBar`)
- Tinggi 48, padding 0 16, Google Sans 14/20 500 .25px.
- Tab aktif berwarna `--pw-tab`; tab lain `--pw-text-muted`.
- Indikator 3px `--pw-tab`, radius `3px 3px 0 0`, selebar label (bukan selebar tab). Garis bawah bar 1px `--pw-divider` (sementara).
- Tab boleh berisi ikon dan hitungan (`CountBadge`). Panah kiri/kanan, Home, dan End memindahkan fokus (fokus bergulir, tab nonaktif dilewati); cincin fokus digambar di dalam tab karena baris tab bisa digeser. `role="tablist"` hanya di TabBar.

### 4.9 Tabel (`DataGrid`) — generasi A
- **Panel:** putih, border 1px `--pw-outline-panel`, radius 3, tanpa bayangan. Dari atas ke bawah:
  1. **Toolbar 48px:** judul panel Roboto 15/16 500, pencarian, ekspor, aksi. Saat ada baris terpilih, toolbar berganti menjadi toolbar kontekstual: hitungan Roboto 15/16 700 `--pw-text-header`, lalu aksi massal.
  2. **Bilah filter** (§4.6), bila ada filter.
  3. **Header 48px:** latar `--pw-surface-container`, garis bawah 1px `--pw-divider`, Roboto 12/500 `--pw-text-header`; kolom yang diurutkan `--pw-text-strong`. Padding tombol urut `17px 10px`.
  4. **Baris:**
     - tinggi 48px dengan garis atas 1px `--pw-divider` (kecuali baris pertama);
     - padding sel `0 10px`, dengan sel pertama `padding-left: 24px` dan sel terakhir `padding-right: 24px` (sementara); sel checkbox `0 16px 0 32px`, lebar 68;
     - teks 13px: kolom pertama `--pw-text`, kolom lain `--pw-text-muted`; angka rata kanan;
     - sel kosong berisi "—" redup.
     - sel dua baris (judul + meta, `.pw-cell`) boleh membuat baris lebih tinggi dari 48px; teks biasa tetap satu baris.
  5. **Paginasi 57px:** "a–b dari N", lalu padding `4px 24px`, "Baris per halaman:" dengan select 56×46 radius 3, "Halaman x dari y", tombol ikon 48 (pertama, sebelumnya, berikutnya, terakhir).
- **Hover dan pilih:** hover baris berlatar `--pw-hover-row`, dan aksi baris (maks. 2 `IconButton` + ⋮) muncul di kolom kanan. Aksi juga tampil saat baris fokus keyboard, dan selalu tampil di layar sentuh. Baris terpilih berlatar `--pw-selected`.
- **Keadaan khusus:** daftar kosong menampilkan `EmptyState` ringkas; gagal memuat menampilkan `EmptyState tone="error"` dengan "Coba lagi"; saat memuat, skeleton berbentuk sama dengan tabel.
- **Layar sempit:** di 601–1023, tabel digeser ke samping di dalam panel. Di ≤ 600, setiap baris menjadi kartu: header disembunyikan, setiap sel menjadi blok dengan label kolom di atas nilai (Roboto 13 `--pw-text-muted`), padding `8px 16px`, dan antarkartu dipisah garis `--pw-divider`.
- `DataTable` lama tidak dipakai lagi.

### 4.10 Kartu dan panel (`Card`)
- `Card` (default): latar `--pw-surface-tint`, radius 12, border 1px transparan, tanpa bayangan. Header punya judul kartu Google Sans 22/28, atau `size="sm"`: judul bagian Roboto 18/24. Padding 24.
- `Card variant="panel"`: putih, border 1px `--pw-outline-panel`, radius 3. Dipakai untuk isi berbentuk daftar atau form.
- `Card variant="chart"`: putih, radius 2, padding `24px 24px 0`, `--pw-elev-2`; judul Roboto 20/500.
- DataGrid tidak dibungkus Card. DataGrid sudah merupakan panel.

### 4.11 Statistik dan progres
- `StatCard`: angka Google Sans 32/40 `--pw-text-stat`, label Roboto 12/16 .3px `--pw-text-header`, dan catatan kecil. Keadaan perlu perhatian ditandai dengan catatan berwarna `--pw-error`, bukan latar merah.
- `ProgressBar`: tinggi 4, track `--pw-selected`, isi `--pw-tab`, radius 0 (sementara). Spinner: lingkaran `--pw-tab` 24/40, garis 3px.

### 4.12 Status (`StatusBadge`, `PriorityBadge`, `CountBadge`)
- **Status tampil sebagai teks berwarna**, seperti "Active" di admin console: Roboto 12/18, tanpa pil. Nada hanya dari `statusTone(status)` di `src/components/statusTone.js`:

  | Nada | Warna | Contoh |
  |---|---|---|
  | `default` | `--pw-text-muted` | draft, open, pending |
  | `info` | `--pw-info` | in_progress, processing, submitted |
  | `warning` | `--pw-warning` | pending_approval, revision_requested |
  | `success` | `--pw-success` | approved, paid, completed |
  | `error` | `--pw-error` | rejected, cancelled, failed, overdue |

- Label status selalu bahasa Indonesia, bukan kode. Modul boleh mengganti **label**, tetapi **nada tidak pernah** ditentukan lokal.
- Prioritas: `<PriorityBadge>` memakai aturan yang sama (Rendah/Normal default, Tinggi warning, Mendesak error).
- Hitungan: `<CountBadge>` berupa pil 20px `--pw-accent`, teks putih Roboto 12/500 .3px, atau varian titik 8px.

### 4.13 Umpan balik

| Situasi | Pakai |
|---|---|
| Aksi berhasil/gagal | `toast(pesan, 'success' \| 'error')` → **snackbar** |
| Kesalahan per field | error di field |
| Kondisi halaman | `<Banner tone>` |
| Aksi merusak | `ConfirmDialog` |

- **Snackbar** (sementara):
  - Letak: kiri bawah 24px; di ponsel lebar penuh dengan jarak 8.
  - Tampilan: latar `--pw-snackbar-bg`, teks putih Roboto 14/20, radius 4, tinggi minimal 48, padding `6px 16px`, `--pw-elev-snackbar`.
  - Isi: aksi berupa tombol teks `--pw-snackbar-action` dan tombol tutup.
  - Tampil 4 detik, atau sampai ditutup untuk error. `role="status"`/`alert`.
- **Banner:** putih, border 1px `--pw-outline-banner`, radius 4, tinggi minimal 50, padding 0 16. Ikon 24 berwarna nada. Teks Roboto 14 `--pw-text`. Tanpa latar berwarna.

### 4.13b Grafik dashboard (`components/charts`)
- **TrendChart:** garis dan area 12 bulan. Garisnya tergambar sendiri saat terlihat (`--pw-dur-chart-draw`), titik muncul bergiliran, dan target digambar putus-putus `--pw-success`. Pemandu nilai muncul saat hover, sentuh, atau tombol panah. Ada tabel tersembunyi untuk pembaca layar.
- **MotionChart:** perlombaan batang capaian bulan demi bulan.
  - Diputar dengan tombol play/pause/ulang (IconButton filled). Slider bulan bisa dipakai dengan keyboard.
  - Batang dan urutan bergerak dengan `--pw-dur-chart` / `--pw-ease-chart`.
  - Batang hijau berarti terhadap target; biru berarti terhadap bulan terbaik.
- **AnimatedNumber:** angka menghitung naik (`useTweenedNumber`). Pembaca layar langsung mendapat nilai akhirnya.
- **Gerak minimal:** semua gerak berhenti bila `prefers-reduced-motion: reduce`.

### 4.14 Dialog, side sheet, menu, tooltip
- **Dialog kecil (`Modal size="sm|md"`, `ConfirmDialog`)** (sementara):
  - Lebar 480/640, radius 8, padding 24, `--pw-elev-dialog`, scrim `--pw-scrim`.
  - Judul Google Sans 22/28. Aksi di kanan bawah (Batal teks, lalu tombol utama).
  - Masuk dengan skala .8 → 1 dan fade (150ms decelerate); keluar dengan fade 75ms.
  - Punya focus trap. Escape menutup dialog paling atas. Fokus kembali ke pemicunya.
  - Di ponsel, dialog tampil layar penuh. Pengecualian: `ConfirmDialog` tetap di tengah dengan jarak 16px dari tepi, sesuai aturan Material untuk dialog peringatan.
  - Semua overlay (dialog, sheet, menu, snackbar, tooltip) dirender di `document.body` (portal), sehingga urutan z-index selalu benar.
  - Konfirmasi yang merusak membuka fokus di tombol Batal, supaya Enter yang tidak sengaja tidak menghapus apa pun.
- **Dialog layar penuh (`FullScreenDialog`)** (§3.3):
  - Latar putih, radius 0, `--pw-elev-fullscreen`, tanpa scrim.
  - Masuk dengan meluncur dari bawah (`transform 225ms decelerate`).
- **Side sheet (`SideSheet`)** (sementara): kanan, lebar 400 (layar penuh di ponsel), putih, `--pw-elev-dialog`. Header 64 dengan judul Google Sans 22/28 dan tombol X. Scrim `--pw-scrim`.
- **Menu (`Menu`, `ActionMenu`)** (sementara):
  - Putih, radius 4, `--pw-elev-menu`, padding 8px 0.
  - Item 48px, padding 0 16, Roboto 14/20 `--pw-text`; hover 4%. Pemisah 1px `--pw-divider`.
  - Lebar 112–280. Boleh punya `header` (dengan pemisah bawah), item `checked` (menjadi `menuitemradio` dengan centang `--pw-accent`), baris `description` (Roboto 12/16 `--pw-text-muted`), dan preferensi `placement="top"`. Menu membuka ke atas bila ruang di bawah tidak cukup.
  - Buka: skala .8 dan fade 120ms. Tutup: fade 75ms, dengan Escape, atau dengan klik di luar.
- **Tooltip:**
  - Latar `--pw-tooltip-bg`, teks `--pw-tooltip-text` Roboto 12/16 .4px, radius 4, padding 4px 8px, tinggi 24.
  - Muncul 4px di bawah pemicu setelah 500ms (di atas bila tidak ada ruang), satu gelembung untuk seluruh aplikasi, hilang saat kursor pergi, tekan, scroll, atau Escape.
  - `tooltipPlacement="right"` (menu samping yang diciutkan): 8px di kanan pemicu, di tengah vertikal.
  - Hanya lewat prop `tooltip`/`label` komponen bersama. `title` bawaan browser dilarang.

- **Tooltip kaya (`InfoTip`):** untuk penjelasan yang lebih dari satu baris, misalnya arti setiap peran di Pengguna.
  - **Tombol:** ikon `info` 18px dalam tombol bulat 32px, diletakkan di samping label. Jangan diletakkan di dalam label checkbox, karena klik ikon tidak boleh mencentang.
  - **Kartu:** `--pw-surface`, radius 8, padding 12/16, `--pw-elev-menu`, lebar maksimal 320px. Judul 14/20 500, lalu teks 14/20.
  - **Cara buka:** terbuka setelah 500ms hover atau fokus keyboard, dan tertutup saat kursor keluar atau fokus pindah. Klik (atau ketuk di ponsel) menahannya tetap terbuka sampai diklik lagi, ada klik di tempat lain, atau tombol Escape ditekan.
### 4.15 Keadaan kosong, memuat, error
- Memuat daftar → skeleton DataGrid. Memuat aksi → `Button loading`. Memuat halaman/bagian → `<LoadingState />`. Tidak ada teks "Memuat…" polos.
- Kosong → `<EmptyState icon title description action />` (Roboto 14 `--pw-text-muted`, ikon 48 `--pw-text-muted`; varian ringkas di dalam tabel/kartu memakai ikon 24).
- Gagal → `<EmptyState tone="error" … action={Coba lagi} />`.

### 4.16 Format
Tanggal, uang, dan jumlah hanya lewat `src/components/format.js`: `formatDate` ("30 Sep 2026"), `formatDateTime`, `formatMoney` ("Rp 1.234.567"), `formatQty`. Nilai kosong ditampilkan "—".

---

## 5. Larangan (ditegakkan tes)
1. Hex/rgb warna di JSX, atau di CSS selain `tokens.css`.
2. `style={{…}}` statis — hanya untuk nilai dinamis.
3. `<input>/<select>/<textarea>/<button>` mentah di `src/pages`. Di `src/components`, hanya primitif bersama yang boleh.
4. `window.alert / confirm / prompt`.
5. `Modal maxWidth/minWidth` — pakai `size`.
6. `font-size`, `border-radius`, `font-weight` ≥ 600, `z-index`, durasi, dan breakpoint di luar skala di atas.
7. `<table>` mentah dan `DataTable` di halaman — pakai DataGrid.
8. `role="tab"`/`role="tablist"` di luar TabBar; `title=` bawaan browser pada elemen HTML.
9. `<Badge tone=…>` untuk status di halaman — pakai `StatusBadge`.
10. `toLocale*` dan "IDR" di halaman — pakai `format.js`.
11. Ikon lucide — pakai `<Icon>`.

## 6. Menambah pola baru
Butuh sesuatu yang belum ada? Tambahkan sebagai **komponen bersama** di `src/components/` beserta aturannya di dokumen ini. Jangan membuat versi lokal di satu halaman.
