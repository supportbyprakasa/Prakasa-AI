# Referensi desain — Google Admin Console (admin.google.com), putaran 1

Sumber: pengamatan baca-saja oleh Claude di Chrome atas permintaan owner, 30 September 2026, memakai prompt [prompts/ai-browser-referensi-desain-admin-google.md](prompts/ai-browser-referensi-desain-admin-google.md). Dokumen ini disalin apa adanya dari laporan yang diserahkan owner dan menjadi **sumber angka** untuk [ui-guideline.md](ui-guideline.md). Keputusan cara memakainya ada di [program-desain-admin-console.md](program-desain-admin-console.md).

---

# Spesifikasi Desain — Google Admin Console (admin.google.com)

Referensi pengamatan untuk aplikasi internal. Semua nilai diambil langsung dari
`getComputedStyle()` pada DOM live (bukan perkiraan visual), pada viewport
**1498 × 1008 px**, devicePixelRatio 1, bahasa UI Inggris (en-GB).
Tanggal pengambilan: 30 September 2026.

**Catatan penting sebelum dipakai:** Admin console saat ini memuat **dua generasi
desain sekaligus**.

| | Generasi | Dipakai di | Ciri |
|---|---|---|---|
| A | **Material 2 (lama)** | Directory/Users, Groups, Apps, Reporting, dialog, tabel, dialog | Roboto, radius 2–3 px, biru `#3367D6`, tombol UPPERCASE, elevation shadow 3-lapis |
| B | **Material 3 (baru)** | Beranda, halaman detail pengguna, bilah atas, tombol pill | Google Sans / Google Sans Text / Google Sans Flex, radius 12–28 px, biru `#0B57D0`, tombol sentence-case |

Angka di bawah menyebutkan generasi mana bila berbeda. Untuk aplikasi internal baru,
disarankan mengikuti **generasi B** dan hanya memakai angka generasi A untuk
komponen tabel/dialog yang belum ada padanannya.

Data pribadi tidak dicatat; nilai teks contoh diganti "X".

---

## 1. Bilah atas

| Properti | Nilai |
|---|---|
| Tinggi | `64px` (fixed, `z-index: 986`) |
| Latar | `#FFFFFF` |
| Bayangan / garis bawah | tidak ada saat scroll-top; `transition: box-shadow 0.25s` (shadow muncul saat konten di-scroll) |
| Font dasar | `"Google Sans Text", Roboto, Helvetica, Arial, sans-serif`, `13px` |
| Warna teks | `#1F1F1F` |
| Tombol ☰ (Main menu) | `48 × 48px`, `border-radius: 50%`, `padding: 12px`, `margin: 0 4px`, ikon `24 × 24px` warna `#444746` |
| Wordmark "Admin" | Product Sans `22px` / `48px`, warna `#1F1F1F`, `padding-left: 8px`; area logo `169 × 64px` |

### Kotak pencarian global

| Properti | Nilai |
|---|---|
| Ukuran | `720 × 46px` (bounding box `722 × 48px` dengan border 1px) |
| Latar | `#F5F5F5` |
| Border | `1px solid transparent` |
| Radius | `28px` |
| Posisi | `x = 266px`, `y = 8px` |
| Input | Google Sans `16px`, warna `#444746`, lebar `664px`, tinggi `46px` |
| Ikon search / clear | area sentuh `56 × 46px` |
| Transition | `background 0.1s ease-in, width 0.1s ease-out` |

### Ikon kanan & avatar (dari kiri ke kanan, `x` pada viewport 1498)

| Item | Ukuran | x |
|---|---|---|
| Alerts | `48 × 48` | 1202 |
| Tasks | `48 × 48` | 1250 |
| Support | `48 × 48` | 1298 |
| Ask Gemini | `40 × 40` | 1354 |
| Google apps | `40 × 40` | 1396 |
| Avatar akun | `40 × 40` (lingkaran) | ±1440 |

**Perilaku:** bilah atas tetap (fixed) dan hanya menumbuhkan bayangan saat konten
di-scroll, memakai transisi 250 ms. Kotak pencarian melebar/menyempit dengan
animasi 100 ms dan berubah latar saat fokus.

---

## 2. Menu samping (navigation drawer)

| Properti | Nilai |
|---|---|
| Lebar terbuka (rail permanen) | `256px` (kontainer `266px` termasuk gutter scrollbar) |
| Lebar tertutup | `64px` |
| Lebar drawer overlay (mode sempit) | `280px`, `transform: translateX(-280px)` saat tertutup |
| Transition drawer overlay | `transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)`, `visibility 0s linear 0.25s` |
| Transition lebar rail | `width 0.1s` |
| Latar | `#FFFFFF` |
| Padding bawah daftar | `16px` |
| Tinggi item | `40px` (pitch antar item tepat `40px`) |
| Radius item (pill) | `0 20px 20px 0` — saat tertutup menjadi `20px` penuh, pill `40 × 40px` di `x = 12px` |
| Padding kiri label level 1 | link mulai `x = 46px` |
| Padding kiri label level 2 (bersarang) | link mulai `x = 62px` → **indent +16px** |
| Ikon item | `20 × 20px` (kotak `24 × 24px`), warna `rgba(0,0,0,0.87)` |
| Font item | Roboto `14px` / `20px` |

### Status item

| Status | Latar pill | Warna teks | Weight |
|---|---|---|---|
| Normal | transparan | `#424242` | 400 |
| Hover | `rgba(66, 66, 66, 0.04)` | `#212121` | 400 |
| Aktif (`aria-selected="true"`) | `#E8F0FE` | `#3367D6` | 500 |
| Fokus keyboard | — | — | focus ring bawaan Chrome (lihat §15) |

Padding link di dalam pill: `4px 8px 4px 16px`.

### Footer menu samping

| Item | Nilai |
|---|---|
| Tombol "Upgrade" | tinggi `48px`, label Roboto `14px` / `20px` weight 500 |
| "Send feedback" | Roboto `14px` / `20px`, `#424242` |
| Copyright | Roboto `12px` / `16px`, `#424242` |
| Tautan legal | Roboto `12px` / `16px`, `#3367D6` |
| Pemisah di atas footer | `1px solid #C4C7C5` + `box-shadow: 0 1px 1px 0 rgba(0,0,0,0.14), 0 2px 1px -1px rgba(0,0,0,0.12), 0 1px 3px 0 rgba(0,0,0,0.2)` |

**Perilaku:** rail permanen menyempit dari 256 → 64 px dalam 100 ms saat ☰ ditekan;
label ikut menghilang tanpa animasi opacity tersendiri. Di viewport ≤1000 px rail
hilang total dan diganti drawer overlay 280 px yang meluncur masuk 250 ms.

---

## 3. Latar halaman dan permukaan kartu

| Properti | Nilai |
|---|---|
| `document.body` background | `#EEEEEE` |
| Permukaan shell aplikasi | `#FFFFFF` (menutupi body di sebagian besar halaman) |
| Kolom konten Beranda | `max-width: 800px`, `padding: 48px 32px 32px` |

### Kartu Beranda (generasi B)

| Properti | Nilai |
|---|---|
| Ukuran | `388 × 310px` |
| Jarak antar kartu | `24px` (2 kolom) |
| Latar | `#F0F4F9` |
| Radius | `12px` |
| Border | `1px solid transparent` |
| Bayangan | `none` |
| Padding header kartu | `0 16px 0 24px`, tinggi header `80px` |

### Panel/kartu modul (generasi A)

| Varian | Nilai |
|---|---|
| Panel Users | `#FFFFFF`, `border: 1px solid rgba(0,0,0,0.12)`, `border-radius: 3px`, tanpa bayangan |
| Panel Groups | `#FFFFFF`, `border: 1px solid #E0E0E0`, `border-radius: 0` |
| Kartu baris pengaturan | `#FFFFFF`, `border-radius: 2px`, `margin-bottom: 12px`, padding dalam `0 24px`, bayangan **elevation-1**: `0 1px 1px 0 rgba(0,0,0,0.14), 0 2px 1px -1px rgba(0,0,0,0.12), 0 1px 3px 0 rgba(0,0,0,0.2)` |
| Kartu grafik Reporting | `#FFFFFF`, `border-radius: 2px`, `padding: 24px 24px 0`, bayangan **elevation-2**: `0 2px 2px 0 rgba(0,0,0,0.14), 0 3px 1px -2px rgba(0,0,0,0.12), 0 1px 5px 0 rgba(0,0,0,0.2)` |
| Banner info | `#FFFFFF`, `border: 1px solid #DADCE0`, tinggi `50px`, `margin-bottom: 12px`, padding horizontal `16px` |

**Perilaku:** kartu pengaturan tidak berubah latar maupun bayangan saat hover —
`cursor: pointer` adalah satu-satunya indikasi; umpan balik visual datang dari
ripple saat klik.

---

## 4. Tipografi

### Generasi B (Beranda, detail pengguna, bilah atas)

| Peran | Font | Size / Line-height | Weight | Letter-spacing | Warna |
|---|---|---|---|---|---|
| Judul halaman (H2) | Google Sans | `24px` / `32px` | 400 | normal | `rgba(0,0,0,0.87)` |
| Subjudul halaman | Google Sans | `16px` / `24px` | 400 | normal | `#444746` |
| Judul kartu | Google Sans | `22px` / `28px` | 400 | normal | `#1F1F1F` |
| Subjudul kartu | Google Sans Text | `14px` / `20px` | 400 | normal | `#444746` |
| Tautan dalam kartu | Google Sans Flex | `14px` / `20px` | 500 | normal | `#0B57D0` |
| Angka statistik besar | Google Sans | `32px` | 400 | normal | `#3C4043` |
| Nama pengguna (detail) | Roboto | `24px` / `32px` | 400 | normal | `rgba(0,0,0,0.87)` |

### Generasi A (modul lama)

| Peran | Font | Size / Line-height | Weight | Letter-spacing | Warna |
|---|---|---|---|---|---|
| Judul halaman (H1) | Roboto | `28px` | **300** | normal | `rgba(0,0,0,0.87)` |
| Judul kartu grafik | Roboto | `20px` | 500 | normal | `rgba(0,0,0,0.87)` |
| Judul akordeon | Roboto | `18px` / `24px` | 400 | normal | `#444746` (kartu dialog: `#424242`; detail pengguna: `rgba(0,0,0,0.54)`) |
| Judul panel/toolbar | Roboto | `15px` / `16px` | 500 | normal | `rgba(0,0,0,0.87)` |
| Teks isi | Roboto | `14px` | 400 | normal | `rgba(0,0,0,0.87)` |
| Label pengaturan | Roboto | `14px` | 500 | normal | `rgba(0,0,0,0.87)` |
| Teks tabel | Roboto | `13px` | 400 | normal | kolom 1 `rgba(0,0,0,0.87)`, lain `rgba(0,0,0,0.54)` |
| Keterangan / helper | Roboto | `12px` | 400 | normal | `rgba(0,0,0,0.54)` |
| Meta redup | Roboto | `12px` / `18px` | 400 | normal | `#757575` |
| Label statistik | Roboto | `12px` / `16px` | 400 | `0.3px` | `#616161` |
| Angka statistik | Roboto | `24px` / `32px` | 400 | normal | `#424242` |
| Judul seksi kecil | Roboto | `12px` | 500 | normal | `rgba(0,0,0,0.54)` |
| Tautan kecil | Roboto | `12px` | 400 | normal | `#3367D6` |

### Palet warna yang terpakai

| Peran | Hex |
|---|---|
| Primer gen. A | `#3367D6` |
| Primer gen. A (tab/radio) | `#1A73E8` |
| Primer gen. B | `#0B57D0` |
| Latar terpilih / aktif | `#E8F0FE` |
| Latar segmented terpilih | `#C2E7FF` (teks `#001D35`) |
| Teks utama | `#212121` / `rgba(0,0,0,0.87)` |
| Teks sekunder | `#444746`, `#424242`, `#616161` |
| Teks redup | `#757575`, `rgba(0,0,0,0.54)` |
| Garis / divider | `#E0E0E0`, `#DADCE0`, `#C4C7C5`, `rgba(0,0,0,0.12)` |
| Latar halaman | `#EEEEEE` |
| Latar kartu gen. B | `#F0F4F9` |
| Latar hover baris | `#EEEEEE` |
| Latar field / search | `#F5F5F5` |
| Sukses / Active | `#0B8043` |
| Seri grafik | `#4184F3` |
| Tab aktif Reporting | `#4285F4` |
| Tooltip | latar `#3C4043`, teks `#E8EAED` |

---

## 5. Tombol

### Tombol primer terisi (generasi B — "pill")

| Properti | Nilai |
|---|---|
| Tinggi | `40px` (area sentuh `48px`) |
| Padding | `0 24px` |
| Radius | `20px` |
| Latar | `#0B57D0` |
| Label | Google Sans Flex `14px` weight 500, `#FFFFFF` |
| Margin | `4px 0` |
| Hover | state-layer `opacity: 0.05` (≈5% putih di atas primer), `transition: opacity 0.075s linear` |
| Transition radius | `border-radius 0.35s cubic-bezier(0.4, 0.1, 0.5, 1.4)` |
| Ripple | ada (lapisan `span` terpisah di dalam tombol) |

### Tombol primer terisi (generasi A — dialog)

| Properti | Nilai |
|---|---|
| Tinggi | `36px` |
| Padding | `0 10px` |
| Radius | `3px` |
| Margin kiri | `16px` |
| Label | Roboto `14px` weight 500, **UPPERCASE** |
| Disabled | latar `rgba(153,153,153,0.1)`, teks `rgba(68,68,68,0.5)` |
| Transition | `box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1)` |

### Tombol teks (generasi A)

| Properti | Nilai |
|---|---|
| Tinggi | `35–36px` |
| Radius | `3px` |
| Latar | transparan |
| Warna (toolbar) | `#3367D6` |
| Warna (Cancel di dialog) | `rgba(0,0,0,0.54)` |
| Label | Roboto `14px` / `20px` weight 500, **UPPERCASE** |
| Transition | `background 0.2s 0.1s` |

### Tombol ikon

| Properti | Nilai |
|---|---|
| Ukuran | `48 × 48px` (bilah atas & toolbar), `40 × 40px` (sebagian ikon kanan) |
| Radius | `50%` |
| Ikon | `24 × 24px`, font `Material Icons Extended`, warna `rgba(0,0,0,0.54)` |
| Transition | `background 0.3s` |

### Daftar aksi pada halaman detail pengguna

Roboto `14px` / `16px` weight 500, **UPPERCASE**, warna `#616161`, tinggi baris `38–40px`.

**Perilaku:** semua tombol Material memakai `outline: none` dan mengandalkan
state-layer + ripple; hover pada tombol terisi hanya menaikkan opacity lapisan 5%
dalam 75 ms, jadi perubahan sangat halus.

---

## 6. Field input / select

| Properti | Nilai |
|---|---|
| Tinggi total field | `62px` (`padding-bottom: 4px`) |
| Tinggi area isi | `50px` (`padding-top: 10px`) |
| Tinggi input teks | `24px` |
| Lebar (dialog 2 kolom) | `472px` |
| Latar | transparan (bukan filled) |
| Garis bawah normal | `1px`, warna `rgba(0,0,0,0.12)` |
| Garis bawah fokus | `2px`, warna `#3367D6`, muncul dengan animasi scale dari tengah |
| Label | **melayang** (floating) — naik ke atas saat fokus/berisi |
| Warna label fokus | `#3367D6` |
| Teks input | `14px`, warna `#000000` |
| Helper text | Roboto `12px`, `rgba(0,0,0,0.54)`, tinggi blok `24px` |
| Tanda wajib | tanda `*` diikutkan di teks label (mis. "First name *") |
| Select / dropdown | tinggi sama, ikon `arrow_drop_down` di kanan, teks `#444444` |
| Radius listbox | `3px` |

### Search field di panel samping

Tinggi `46px`, radius `28px`, latar `#F5F5F5`, ikon search `24px`, placeholder `rgba(0,0,0,0.54)`.

**Perilaku:** fokus menaikkan garis bawah dari 1 px abu ke 2 px biru; tidak ada
perubahan latar. Pesan error belum teramati (tidak ada field yang divalidasi tanpa
melakukan submit).

---

## 7. Tabel

| Properti | Nilai |
|---|---|
| Permukaan tabel | `#FFFFFF` |
| Tinggi baris header | `48px` (`49px` termasuk garis) |
| Latar header | `#F5F5F5` |
| Garis bawah header | `1px solid #E0E0E0` |
| Font header | Roboto `12px` weight 500 |
| Warna header kolom aktif (ter-sort) | `#212121` |
| Warna header kolom lain | `#616161` |
| Padding tombol sort header | `17px 10px` |
| Tinggi baris isi | `49px` (48 px + garis) |
| Pemisah baris | `border-top: 1px solid #E0E0E0` pada setiap baris kecuali baris pertama |
| Padding sel | `0 10px`; sel pertama (checkbox) `0 16px 0 32px`, lebar `68px` |
| `vertical-align` sel | `middle` |
| Teks sel kolom 1 | Roboto `13px`, `rgba(0,0,0,0.87)` |
| Teks sel kolom lain | Roboto `13px`, `rgba(0,0,0,0.54)` |
| Avatar dalam baris | `24 × 24px` lingkaran |
| Hover baris | latar `#EEEEEE`; aksi inline ("Reset password", "Rename user", "More options") muncul di kolom kanan |
| Baris terpilih | latar `#E8F0FE` |
| Lebar kolom contoh | `68 / 272 / 190 / 190 / 190 / 85 / 413` px |
| Baris kosong | tidak ada tinggi minimum khusus; daftar kosong menampilkan pesan teks, bukan baris kosong |

### Checkbox

| Properti | Nilai |
|---|---|
| Ukuran kotak | `20 × 20px` |
| Radius | `3px` |
| Area sentuh / ripple | `50 × 50px`, `border-radius: 100%` |
| Tidak tercentang | border `2px` efektif, warna `rgba(0,0,0,0.54)` |
| Tercentang | kotak terisi penuh `#3367D6` (diimplementasi dengan `border: 10px solid #3367D6`) |
| Ripple tercentang | `rgba(51,103,214,0.2)` |
| Ripple normal | `rgba(0,0,0,0.2)` |
| Transition | `border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)` |

### Radio button

`28 × 28px` area sentuh, visual `20 × 20px`, `border-radius: 50%`,
border `2px solid #1A73E8` saat terpilih.

### Paginasi

| Properti | Nilai |
|---|---|
| Tinggi bilah | `57px` |
| Posisi | di bawah tabel, di dalam panel, `role="navigation"` |
| Latar | `#FFFFFF` |
| Padding | `4px 24px` |
| Label "Rows per page:" | Roboto `14px`, `rgba(0,0,0,0.87)` |
| Dropdown jumlah baris | `56 × 46px`, radius `3px`, teks `#444444` |
| Teks "Page 1 of 1" | Roboto `14px` |
| Tombol navigasi | ikon `48 × 48px` (first / prev / next) |

### Toolbar panel

Tinggi `±48px`; judul "Users" Roboto `15px` / `16px` weight 500 `rgba(0,0,0,0.87)`;
tombol teks `#3367D6` tinggi `35px`.
Saat baris terpilih, toolbar berganti menjadi toolbar kontekstual berisi hitungan
("1 user" — Roboto `15px` / `16px` weight **700**, `#616161`) plus aksi massal.

### Bilah filter

Tinggi `56px`, `padding: 8px 12px 8px 32px`,
`box-shadow: inset 0 -1px 0 0 #E0E0E0` sebagai pemisah bawah.

---

## 8. Chip / filter

| Properti | Nilai (chip "Add a filter") |
|---|---|
| Ukuran | `123 × 32px` |
| Radius | `32px` |
| Border | `1px dashed rgba(0,0,0,0.26)` |
| Latar | transparan |
| Padding | `0 16px 0 8px` |
| Teks | Roboto `14px`, `rgba(0,0,0,0.54)` |
| Ikon | `24px` `Material Icons Extended`, `padding-right: 6px` |
| Transition | `opacity 0.1s cubic-bezier(0.4, 0, 0.2, 1)` |

### Segmented button (Single-select / Multi-select)

| Properti | Nilai |
|---|---|
| Tinggi | `40px` (label `20px`) |
| Padding | `0 12px` |
| Radius segmen kiri | `20px 0 0 20px` (segmen kanan cermin) |
| Terpilih | latar `#C2E7FF`, teks `#001D35` |
| Tidak terpilih | latar transparan |
| Font | Google Sans `14px` / `20px` weight 500 |
| Transition | `border-radius 0.35s cubic-bezier(0.27, 1.06, …)` |

### Badge status

| Properti | Nilai |
|---|---|
| Badge "NEW" | latar `#3367D6`, radius `999px`, tinggi `20px`, teks Roboto `12px` weight 500 UPPERCASE `#FFFFFF`, `letter-spacing: 0.3px` |
| Status "Active" (detail pengguna) | teks `#0B8043`, Roboto `12px` / `18px` |
| Status "Suspended…" (tabel) | teks biasa `rgba(0,0,0,0.54)` — tidak ada pil berwarna |

---

## 9. Tab

| Properti | Nilai |
|---|---|
| Tinggi | `48px` |
| Padding | `0 16px` |
| Font | Google Sans `14px` / `20px` weight 500, `letter-spacing: 0.25px` |
| Warna label aktif | `#1A73E8` |
| Warna label non-aktif | `#000000` / `rgba(0,0,0,0.54)` |
| Indikator aktif | `3px solid #1A73E8`, `border-radius: 3px 3px 0 0`, lebar = lebar label (bukan lebar tab penuh — mis. `77px` untuk tab `113px`) |
| Tab Reporting (gaya lama) | tinggi `48px`, Roboto `14px` / `48px` weight 500 **UPPERCASE**; aktif `#4285F4`, non-aktif `rgba(0,0,0,0.54)` |

---

## 10. Dialog

Dialog "Add new user" di Admin console adalah **full-screen dialog**, bukan modal kecil.

| Properti | Nilai |
|---|---|
| Ukuran | `1498 × 1008px` (100% viewport) |
| Latar | `#FFFFFF` |
| Radius | `0` |
| Bayangan | `0 12px 15px 0 rgba(0,0,0,0.24)` |
| Transition masuk | `transform 0.225s cubic-bezier(0, 0, 0.2, 1)` (meluncur dari bawah) |
| Warna scrim | **tidak ada** — dialog menutupi seluruh viewport |
| App bar dialog | tinggi `72px`, latar `#3367D6`, `padding: 12px 24px`, bayangan `0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)` |
| Judul dialog | Roboto `20px` / `26px` weight 400, `#FFFFFF` |
| Tombol tutup (X) | ikon di kiri judul |
| Tombol HELP | Roboto `14px` / `20px` weight 500 UPPERCASE `#FFFFFF`, di kanan |
| Kartu isi | `#FFFFFF`, judul "User Information" Roboto `18px` / `24px` weight 400 `#424242` |
| Posisi tombol aksi | **kanan bawah**, di luar kartu; urutan `CANCEL` lalu `ADD NEW USER` |
| Jarak antar tombol | `margin-left: 16px` |
| Layout field | 2 kolom, tiap field `472px` |

---

## 11. Snackbar, tooltip, badge status

### Tooltip

| Properti | Nilai |
|---|---|
| Latar | `#3C4043` |
| Teks | `#E8EAED`, Roboto `12px` / `16px`, `letter-spacing: 0.4px` |
| Radius | `4px` |
| Padding | `4px 8px` |
| Tinggi | `24px` |
| Posisi | di bawah trigger, offset ±`12px` dari tepi bawah ikon |
| Delay | muncul setelah hover ±0,5 s |

### Snackbar

**Tidak teramati.** Snackbar di Admin console hanya muncul setelah aksi yang
mengubah data (simpan/hapus/suspend), dan pengamatan ini dibatasi baca-saja, jadi
tidak ada snackbar yang bisa diukur. Bila diperlukan, spesifikasi Material 2 standar
adalah acuan terdekat: latar `#323232`, teks `#FFFFFF` `14px`, radius `4px`,
tinggi `48px`, aksi UPPERCASE berwarna aksen.

### Badge status

Lihat §8.

---

## 12. Fokus keyboard

| Properti | Nilai |
|---|---|
| Komponen Material (tombol, checkbox, tab) | `outline-style: none` — **tidak ada** focus ring kustom; umpan balik hanya state-layer / ripple |
| Link & elemen non-Material | focus ring bawaan Chrome: `outline: auto 1px #005FCC`, `outline-offset: 0px` (dirender sebagai cincin ganda biru/putih ±2px) |
| Item menu samping | focus ring bawaan Chrome mengikuti bentuk pill `0 20px 20px 0` |
| `:focus-visible` | aktif — cincin hanya tampil untuk fokus dari keyboard, tidak dari klik mouse |

**Perilaku:** Admin console sebagian besar menyerahkan indikator fokus ke browser.
Untuk aplikasi internal, ini adalah titik yang sebaiknya **diperbaiki**, bukan ditiru
— disarankan menambahkan focus ring eksplisit (mis. `outline: 2px solid #0B57D0;
outline-offset: 2px`) agar konsisten lintas browser.

---

## 13. Animasi

| Elemen | Durasi & easing |
|---|---|
| Buka/tutup rail menu samping | `width 0.1s` (tanpa easing eksplisit → `ease`) |
| Buka/tutup drawer overlay | `transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)`; `visibility 0s linear 0.25s` |
| Buka dialog full-screen | `transform 0.225s cubic-bezier(0, 0, 0.2, 1)` |
| Bayangan bilah atas saat scroll | `box-shadow 0.25s` |
| Kotak pencarian | `background 0.1s ease-in, width 0.1s ease-out` |
| Hover tombol terisi (state layer) | `opacity 0.075s linear` |
| Hover tombol teks | `background 0.2s` dengan delay `0.1s` |
| Tombol ikon | `background 0.3s` |
| Checkbox tercentang | `border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)` |
| Radius tombol pill / segmented | `border-radius 0.35s cubic-bezier(0.4, 0.1, 0.5, 1.4)` — overshoot ringan |
| Elevation tombol dialog | `box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1)` |
| Chip filter | `opacity 0.1s cubic-bezier(0.4, 0, 0.2, 1)` |

Dua kurva dominan: **standard** `cubic-bezier(0.4, 0, 0.2, 1)` untuk gerakan
fungsional, dan **decelerate** `cubic-bezier(0, 0, 0.2, 1)` untuk elemen yang masuk.

---

## 14. Grafik (halaman Reporting)

| Properti | Nilai |
|---|---|
| Teknologi | SVG (bukan canvas) |
| Ukuran area plot | `515 × 320px` di dalam kartu `555px` |
| Warna seri | `#4184F3` (isi bar; garis `stroke-width: 2px`) |
| Garis grid | `1px solid #EEEEEE` |
| Garis aksis | `1px solid #9E9E9E` |
| Label aksis | Roboto `12px`, `#757575` |
| Label aksis aktif | Roboto `12px`, `#424242` |
| Hit-area garis (hover) | `stroke: transparent; stroke-width: 10px` |
| Legend | checkbox + label, teks Roboto `12px` |
| Tautan "VIEW DETAILS" | Roboto `14px` / `20px` weight 500 UPPERCASE `#3367D6` |
| Efek bayangan titik | SVG filter `feGaussianBlur stdDeviation=1`, `feOffset dy=2`, alpha slope `0.2` |

---

## 15. Breakpoint

Diukur dengan mengubah lebar jendela nyata dan membaca ulang DOM.

### ≥1024 px (desktop penuh, diukur pada 1498 px)

- Rail menu samping permanen `256px`, konten mulai `x = 266px`.
- Kotak pencarian `720px`.
- Panel filter OU terbuka `300px` di kiri area konten.
- Tabel `1408px`, semua 7 kolom tampil, `display: table-row`.
- Bilah atas `64px`.

### ~1000 px (diukur tepat pada 1000 px)

- **Menu samping hilang total** (`width: 0`) — hanya tersedia sebagai drawer overlay `280px` via ☰.
- Konten memakai lebar penuh: `952px` mulai `x = 24px` (margin samping `24px`).
- Kotak pencarian menyusut `720 → 476px`.
- Panel filter OU **runtuh** menjadi tombol bulat `38 × 38px` (`border-radius: 50%`) menempel di tepi kiri konten, `aria-label="Show Organisational Unit Tree-based filter in sidebar"`.
- Tabel tetap `1408px` → **scroll horizontal**; struktur tabel tidak berubah, tinggi baris tetap `49px`.
- Bilah atas tetap `64px`.

### ~400 px (diukur tepat pada 401 px)

- Bilah atas menyusut `64 → 56px`.
- Kotak pencarian runtuh menjadi **tombol ikon** `44 × 48px` (radius `28px`, latar transparan).
- Menu samping `width: 0`, hanya drawer overlay.
- Panel filter OU disembunyikan.
- Konten `353px` mulai `x = 24px`.
- **Tabel berubah menjadi daftar kartu bertumpuk:**
  - semua `<th>` `width: 0` (header disembunyikan);
  - tinggi baris `49 → 178px`, lebar `341px`;
  - sel data menjadi `display: block`, lebar `297px`, `padding: 8px 16px 8px 64px`;
  - sel checkbox tetap `table-cell`, lebar `44px`, `padding: 16px 0 0 24px`;
  - nama kolom ditampilkan sebagai label di atas nilai, Roboto `13px` `rgba(0,0,0,0.54)`.
- Paginasi memadat menjadi "Page 1 of 1" + panah.

**Kesimpulan breakpoint:** ada titik putus di sekitar **1024 px** (rail → drawer,
panel samping → tombol) dan sekitar **600 px** (bilah atas 56 px, search → ikon,
tabel → kartu). Nilai persisnya tidak bisa dipastikan dari CSS karena stylesheet
Admin console disajikan lintas-origin sehingga `cssRules` tidak dapat dibaca; yang
tercatat di atas adalah hasil pengukuran pada 1498 / 1000 / 401 px.

---

## 16. Daftar font

Font yang **benar-benar termuat** (`document.fonts`, status `loaded`) pada sesi ini:

- `Roboto` — weight 400, 500, 700
- `Google Sans` — weight 400, 500
- `Google Sans Text`
- `Google Sans Flex`
- `Product Sans` — weight 400 (khusus wordmark "Admin")
- `Material Icons Extended` — weight 400 (ikon modul lama)
- `Google Symbols` — weight 400 (ikon modul baru)

Font-stack persis dari `font-family` computed:

| Konteks | `font-family` |
|---|---|
| Bilah atas / shell | `"Google Sans Text", Roboto, Helvetica, Arial, sans-serif` |
| Input pencarian, judul gen. B | `"Google Sans", Roboto, Helvetica, Arial, sans-serif` |
| Tautan & tombol gen. B | `"Google Sans Flex", …` |
| Seluruh modul gen. A | `Roboto, Arial, sans-serif` |
| Wordmark | `"Product Sans", Arial, sans-serif` |
| Ikon | `"Material Icons Extended"` / `"Google Symbols"` |

Terdaftar tapi tidak termuat di halaman yang diamati: `Roboto Mono` (400),
`Google Material Icons` (400), `Roboto` 300.

---

## Catatan metodologi & batasan

1. Semua angka berasal dari `getComputedStyle()` + `getBoundingClientRect()` pada
   DOM live, bukan dari inspeksi visual screenshot.
2. Stylesheet Admin console disajikan lintas-origin, sehingga `document.styleSheets`
   sebagian tidak terbaca (3 dari 15). Karena itu nilai `:hover`, `:focus` dan
   media query diukur dengan **benar-benar** melakukan hover / Tab / mengubah ukuran
   jendela, bukan dengan membaca aturan CSS.
3. Pengamatan murni baca-saja: tidak ada pengaturan, pengguna, atau grup yang
   diubah. Interaksi yang dilakukan hanya: navigasi, hover, buka/tutup menu samping,
   buka/tutup akordeon, centang lalu batalkan satu checkbox baris, buka dialog
   "Add new user" lalu **Cancel**.
4. Yang tidak berhasil diukur: **snackbar/toast** (butuh aksi yang mengubah data),
   dan **pesan error field** (butuh submit form). Nilai breakpoint persis dari CSS
   juga tidak tersedia karena alasan di poin 2.
5. Nilai warna ditulis hex bila opak dan `rgba()` bila memang semi-transparan di
   sumbernya — penting untuk ditiru apa adanya, karena banyak warna teks Admin
   console memakai alpha di atas latar putih, bukan hex solid.
