# Program desain: tampilan admin.google.com

Status: **diminta owner 30 September 2026**: "konsistensi layout design serta efek yang harus seirama dan mengikuti guideline. Dan saya maunya 100% sama dengan admin.google.com. tanpa terkecuali".

Dokumen ini satu-satunya sumber kebenaran untuk pekerjaan tampilan. Cara kerjanya sama dengan [program-4-divisi.md](program-4-divisi.md): tahap, gerbang per tahap, keputusan tercatat, dan laporan ke owner.

Dokumen terkait:
- **Angka acuan:** [referensi-desain-admin-console.md](referensi-desain-admin-console.md) (putaran 1, diukur 30 September 2026) dan putaran 2 (menyusul, lewat [prompts/ai-browser-referensi-desain-admin-google-2.md](prompts/ai-browser-referensi-desain-admin-google-2.md)).
- **Kondisi awal dan daftar perubahan:** [audit-ui-admin-console.md](audit-ui-admin-console.md), berisi 146 temuan dan rencana per komponen.
- **Aturan yang ditegakkan tes:** [ui-guideline.md](ui-guideline.md). Pedoman ini ditulis ulang di tahap 1 memakai angka referensi.

## Batas yang tidak dilanggar

- **Hanya tampilan.** Tidak ada perubahan data, alur kerja, izin, atau perilaku bisnis. Aturan data (Accurate hanya dibaca, data lama tidak diubah atau dihapus) tetap berlaku.
- **Yang ditiru adalah ukuran, warna, huruf, jarak, dan perilaku, bukan merek.** Logo Google, kata "Admin", huruf merek Product Sans, dan ikon produk Google tidak dipakai.
- **Program 4 divisi diselesaikan lebih dulu.** Perbaikan temuan tinjauan akhir sedang berjalan. Kode tampilan baru diubah setelah gerbang akhir 4 divisi lolos, supaya jaminan "siap pakai" tidak bercampur dengan perubahan tampilan.
- Aturan lama tetap berlaku: bahasa Indonesia, tanpa commit kecuali diminta, cek di browser (desktop dan ponsel) sebelum dinyatakan selesai.

## Keputusan yang berlaku

Diambil Claude sebagai Head of Design / UI Lead atas delegasi owner ("apapun itu yang membutuhkan keputusanku, saya mau kamu wakili"), 30 September 2026.

- **K1 Rujukan tunggal:** admin.google.com, dengan angka dari laporan pengukuran. Rujukan lama (Google Drive untuk tampilan, YouTube untuk breakpoint) tidak berlaku lagi.
- **K2 Satu komponen, satu padanan.** Admin console saat ini memakai dua generasi desain sekaligus: A (Material 2) dan B (Material 3). Aturannya:
  - Setiap komponen aplikasi menyalin angka komponen padanannya di admin console apa adanya, termasuk huruf dan warnanya. Contoh: item menu aktif `#E8F0FE` dengan teks `#3367D6`; tombol `#0B57D0`; tab `#1A73E8`. Hasilnya sama dengan yang terlihat di admin console hari ini.
  - Bila admin console punya dua versi untuk komponen yang sama, yang dipakai versi generasi B. Ini berlaku untuk tombol (pil, huruf kapital di awal saja), judul halaman (Google Sans 24/32), kartu ringkasan (`#F0F4F9`, radius 12), dan segmented button.
  - Komponen yang hanya ada di generasi A disalin sesuai ukurannya: menu samping, tabel, paginasi, checkbox, radio, field bergaris bawah dengan label melayang, bilah filter dan chip "Tambah filter", toolbar panel, tooltip, dan dialog layar penuh.
  - Alasan: satu komponen selalu tampil sama di semua halaman (konsisten), dan tetap identik dengan admin console. Tombol UPPERCASE generasi A tidak dipakai karena generasi B sudah menggantinya dan label Indonesia huruf kapital semua sulit dibaca.
- **K3 Huruf.** Aturannya per kelompok elemen:
  - **Google Sans** (lisensi terbuka OFL) dipakai untuk bilah atas, judul, tab, dan segmented. Ukuran optiknya otomatis memakai potongan "Text" pada ukuran kecil, jadi menggantikan Google Sans Text yang tidak berlisensi terbuka.
  - **Google Sans Flex** (OFL) dipakai untuk tombol dan tautan.
  - **Roboto** dipakai untuk menu samping, tabel, field, teks isi, dan keterangan.
  - Product Sans (huruf merek Google) tidak dipakai. Nama "Prakasa Workspace" ditulis dengan Google Sans 22 px.
- **K4 Ikon:** Material Symbols Outlined (lisensi Apache 2.0), padanan publik dari ikon admin console (Google Symbols / Material Icons Extended). Ikon dipasang lewat satu komponen `<Icon>` dengan ukuran 20 (menu samping) dan 24 (tombol ikon, bilah atas, chip). Ikon lucide diganti bertahap di balik komponen itu.
- **K5 Fokus keyboard (satu pengecualian yang disengaja):** admin console menyerahkan cincin fokus ke browser. Aplikasi memakai cincin fokus 2 px `#0B57D0` dengan jarak 2 px, dan hanya tampil saat fokus dari keyboard. Alasannya aksesibilitas; pengguna mouse melihat tampilan yang sama persis. Laporan pengukuran juga menyarankan hal ini.
- **K6 Perilaku responsif sesuai pengukuran.** Pedoman lama memakai batas 760 dan 1280 px; batas baru adalah 600 dan 1024 px:

  | Lebar layar | Perilaku |
  |---|---|
  | ≥ 1024 px | Menu samping permanen 256 px, bisa diciutkan ke 64 px lewat ☰ |
  | < 1024 px | Menu samping hilang dan dibuka sebagai drawer 280 px. Tabel lebar digeser ke samping. |
  | ≤ 600 px | Bilah atas 56 px, pencarian menjadi ikon, dan tabel menjadi kartu bertumpuk dengan label kolom di atas nilai |

- **K7 Cakupan "100%":** bingkai (bilah atas, menu samping, halaman) dan semua komponen bersama. Layar yang tidak punya padanan di admin console tetap memakai token yang sama (huruf, warna, bentuk, gerak) tanpa bentuk khusus. Layar tersebut: chat, ruang kerja AI, kalender, kanban, Gantt, penjelajah Drive, dan lembar cetak.
- **K8 Nilai sementara:** beberapa nilai belum bisa diukur tanpa mengubah data. Sampai putaran 2 masuk, dipakai standar Material Google, dengan tanda "sementara" di pedoman:
  - snackbar: latar `#323232`, teks putih 14 px, radius 4, tinggi 48;
  - pesan error field: `#D93025`, 12 px, dengan garis bawah 2 px;
  - menu ⋮, dialog kecil, efek hover tombol ikon, fokus kotak pencarian, dan bayangan bilah atas saat halaman di-scroll.

  Setelah putaran 2 masuk, nilai-nilai ini diganti dengan angka terukur.
- **K9 Tampilan status** (pil berwarna atau teks berwarna seperti "Active" `#0B8043` di admin console) diputuskan setelah putaran 2 bagian 19. Sampai saat itu tetap pil dari `statusTone.js`.
- **K10 Yang tetap seperti keputusan owner sebelumnya:**
  - bahasa Indonesia dengan huruf kapital di awal saja;
  - baris tabel modul Sales tidak bisa diklik, detail dibuka lewat aksi "Lihat detail";
  - nada status hanya dari `statusTone.js`;
  - tanpa data pribadi di layar.
- **K11 Halaman yang sedang ditutup** (`/approvals`, `/documents`, `/templates`) tidak dikerjakan khusus. Halaman itu ikut berubah lewat komponen bersama bila dibuka lagi.
- **K12 Istilah:** judul halaman sama dengan label menu yang sudah dipakai staf. Istilah yang sudah umum di kantor (Approval, SO, PO, surat jalan) dipertahankan.

## Peta komponen

| Komponen aplikasi | Padanan di admin console | Angka (referensi) |
|---|---|---|
| Bilah atas (`Navbar`) | Bilah atas, kotak pencarian, ikon kanan, avatar | §1 |
| Menu samping (`Sidebar`) | Navigation drawer: 256 / 64 / overlay 280 | §2 |
| Bingkai halaman | Shell putih, konten mulai setelah menu samping | §3, §15 |
| `PageHeader` | Judul halaman generasi B (Google Sans 24/32) | §4 |
| `Card` ringkasan / dasbor, `StatCard` | Kartu Beranda (`#F0F4F9`, radius 12, angka Google Sans 32) | §3, §4 |
| Bagian halaman detail | Halaman detail pengguna (putaran 2 §16) | sementara |
| `Button` utama | Tombol pil terisi generasi B | §5 |
| `Button` sekunder, teks, tonal, bahaya | Turunan pil generasi B (putaran 2 §7) | §5, sementara |
| `IconButton` | Tombol ikon 48 / 40 | §5 |
| `Input`, `Select`, `Textarea` | Field bergaris bawah dengan label melayang | §6 |
| Kolom pencarian | Kotak pencarian bilah atas dan panel samping | §1, §6 |
| `DataGrid` | Tabel, toolbar panel, bilah filter, paginasi, kartu di ponsel | §7, §15 |
| Checkbox, radio | Checkbox dan radio tabel | §7 |
| `Chip` filter | Chip "Add a filter" | §8 |
| Pilihan tampilan | Segmented button | §8 |
| `TabBar` | Tab (indikator 3 px selebar label) | §9 |
| Form panjang dan halaman form | Dialog layar penuh "Add new user" | §10 |
| `Modal` kecil, `ConfirmDialog` | Dialog kecil (putaran 2 §4) | sementara |
| Tooltip | Tooltip | §11 |
| Toast → snackbar | Snackbar (putaran 2 §6) | sementara |
| Grafik | Grafik Reporting | §14 |

## Tahap dan status

Legenda: ⬜ belum · 🔵 dikerjakan · ✅ lolos gerbang · ⏸ menunggu pihak lain

### Tahap 0: persiapan
| # | Pekerjaan | Status |
|---|---|---|
| 0.1 | Referensi putaran 1 disimpan di repo | ✅ |
| 0.2 | Audit konsistensi seluruh frontend (146 temuan) dan rencana perubahan | ✅ |
| 0.3 | Keputusan desain dan peta komponen (dokumen ini) | ✅ |
| 0.4 | Referensi putaran 2 untuk nilai yang belum teramati. Tidak ditunggu (owner, 30 September: "jangan tanya keputusan ku … saya hanya mau lihat result"): nilai bertanda "sementara" memakai standar Material Google dan diganti bila hasil putaran 2 dikirim. Prompt tetap tersedia | ✅ |
| 0.5 | Salinan frontend "sebelum" disimpan (untuk screenshot sebelum/sesudah kapan saja) | ✅ |

### Tahap 1: fondasi
| # | Pekerjaan | Status |
|---|---|---|
| 1.1 | Token: warna, huruf, bentuk, bayangan, gerak, z-index, ukuran ikon, dan bingkai sesuai angka referensi. Token lama dipetakan ke nilai baru (lapisan kompatibel) dan dihapus di tahap akhir | ✅ |
| 1.2 | Huruf Google Sans, Google Sans Flex, Roboto, dan Material Symbols dimuat; komponen `<Icon>` dan peta ikon | ✅ |
| 1.3 | Aturan global yang bocor di `layout.css` dihapus; CSS halaman dipindah keluar dari file global | ✅ |
| 1.4 | `ui-guideline.md` ditulis ulang dengan tabel token dari referensi (✅); tes pedoman diperluas ke komponen dan CSS dengan anggaran pelanggaran yang hanya boleh turun | ✅ |

### Tahap 2: bingkai
| # | Pekerjaan | Status |
|---|---|---|
| 2.1 | Bilah atas: 64 px, pencarian 720×46 radius 28 `#F5F5F5`, tombol ikon 48/40, avatar 40, dan bayangan saat di-scroll | ✅ |
| 2.2 | Menu samping: 256 / 64 / overlay 280, item 40 px berbentuk pil `0 20px 20px 0`, aktif `#E8F0FE`/`#3367D6`, bersarang +16 px, beserta animasinya | ✅ |
| 2.3 | Bingkai halaman: permukaan putih, judul halaman, jarak judul ke isi, dan satu tombol kembali (`PageTrail`) | ✅ |

### Tahap 3: komponen
| # | Pekerjaan | Status |
|---|---|---|
| 3.1 | Satu sistem hover dan klik (state layer dan ripple); sistem kedua di AI dan efek hover buatan sendiri dihapus | ✅ |
| 3.2 | Tombol, tombol ikon, chip, segmented, dan tab | ✅ |
| 3.3 | Field bergaris bawah dengan label melayang, select, checkbox, radio, switch, dan pesan error | ✅ |
| 3.4 | Overlay: dialog kecil, dialog layar penuh, side sheet, menu, tooltip, dan snackbar, dengan urutan tumpukan (z-index) yang benar (termasuk perbaikan toast yang tertutup dialog) | ✅ |
| 3.5 | Kartu, panel, kartu statistik, progress bar, banner, keadaan kosong, memuat, dan error | ✅ |

### Tahap 4: tabel
| # | Pekerjaan | Status |
|---|---|---|
| 4.1 | DataGrid sesuai tabel admin console: toolbar dan bilah filter, header `#F5F5F5` 48 px, baris 48 px dengan pemisah `#E0E0E0`, hover `#EEEEEE` dengan aksi yang muncul di kanan, baris terpilih `#E8F0FE`, paginasi 57 px, dan kartu bertumpuk di ≤ 600 px | ✅ |
| 4.2 | Satu kolom pencarian dan satu tempat filter per daftar; `DataTable` lama dipensiunkan (25 halaman) | ✅ |

### Tahap 5: ikon
| # | Pekerjaan | Status |
|---|---|---|
| 5.1 | Komponen `<Icon>` dan peralihan 140 ikon lucide ke Material Symbols Outlined | ✅ |

### Tahap 6: halaman per modul
| # | Pekerjaan | Status |
|---|---|---|
| 6.1 | Sales, Warehouse, Procurement, Finance | ✅ |
| 6.2 | Management, proyek, tugas, target, eskalasi | ✅ |
| 6.3 | People & Culture, IT, dokumen, tanda tangan | ✅ |
| 6.4 | Admin, Google (chat, mail, Drive, grup), dan Prakasa AI | ✅ |
| 6.5 | Halaman yang belum diaudit (bagian 2.L audit) diaudit lalu dirapikan | ✅ |

### Tahap 7: gerbang akhir
| # | Pekerjaan | Status |
|---|---|---|
| 7.1 | Perbandingan komponen per komponen dengan angka referensi (diukur di browser dengan `getComputedStyle`), screenshot sebelum/sesudah, desktop dan ponsel, tinjauan independen dengan pembantah, dan laporan akhir | ✅ |

## Hasil (1 Oktober 2026)

- **Fondasi:** satu set token (warna, huruf, bentuk, bayangan, gerak, lapisan, ukuran) dari angka admin console; lapisan token lama dihapus setelah tidak ada file yang memakainya; huruf Google Sans, Google Sans Flex, Roboto, dan ikon Material Symbols (140 ikon lucide diganti, lucide tidak dipakai lagi).
- **Bingkai:** bilah atas 64px dengan pencarian pil 720×46; menu samping 256/64/drawer 280 dengan grup yang bisa dibuka-tutup; halaman putih dengan jejak halaman sebagai satu-satunya tombol kembali; `layout.css` 1.958 → ±920 baris.
- **Komponen:** tombol pil, field bergaris bawah dengan label melayang, checkbox/radio/switch, chip dan "Tambah filter", segmented, tab, tabel generasi A (panel, toolbar, bilah filter, header, baris, paginasi "a–b dari N", kartu di ponsel), dialog kecil, dialog layar penuh dengan konfirmasi "Buang perubahan?", side sheet, menu, snackbar berantrean, tooltip, kartu, kartu statistik, progress, banner, status berupa teks berwarna, avatar dan dialog alasan bersama.
- **Halaman:** semua modul (Sales, Finance, Data Accurate, Warehouse, Procurement, Manajemen, proyek, tugas, kalender, People & Culture, IT, dokumen, tanda tangan, Drive, admin, Google, Prakasa AI, Login) memakai template dan komponen bersama; label menu dan judul halaman dalam bahasa Indonesia.
- **Tinjauan independen:** kesesuaian spesifikasi (84 rute × 3 lebar) dan perilaku (dibanding salinan "sebelum", panggilan API direkam). Semua temuan diperbaiki, termasuk bug menu baris yang ikut membuka baris, form yang tertutup tanpa peringatan, jumlah data yang hilang, dan tombol email yang ikut mengirim.
- **Gerbang akhir:** tes backend 841 dan frontend 485 lulus, build berhasil, 6 cek browser tanpa error, sweep 67 rute × 3 lebar: 0 masalah (sebelum: 95). Tidak ada perubahan backend, data, izin, atau aturan harga.
- **Tersisa (disengaja):** beberapa isian "ID pengguna" tetap angka karena daftar pengguna hanya boleh dibaca admin; nilai bertanda "sementara" menunggu pengukuran putaran 2 bila owner mengirimnya.

## Gerbang setiap tahap

- Seluruh tes backend dan frontend lolos, dan build berhasil.
- Angka diukur di browser (`getComputedStyle`) dan dicocokkan dengan referensi; tidak ada nilai kira-kira.
- Screenshot sebelum/sesudah pada lebar 1440, 1024, dan 390 px. Tidak boleh ada error atau scroll samping halaman di 390 px; tabel lebar di 601–1023 px memang digeser ke samping seperti admin console.
- Tes pedoman diperketat: jumlah pelanggaran hanya boleh turun.
- Dokumen ini diperbarui, lalu laporan singkat ke owner.
