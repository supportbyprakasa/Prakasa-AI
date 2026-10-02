# Program 4 divisi: Sales · Warehouse · Procurement · Management

Status: **disetujui owner 29 September 2026** ("cari cara supaya bisa kamu kerjakan sekaligus namun tidak berantakan, tetap on the track").

Dokumen ini satu-satunya sumber kebenaran untuk pekerjaan keempat divisi. Semua yang dikerjakan ada di sini, dengan status. Yang tidak ada di sini tidak dikerjakan. Rincian aturan dan hasil probe ada di [accurate-divisi-rencana.md](accurate-divisi-rencana.md).

## Cara kerja: sekaligus, tapi terkunci

1. **Gelombang, bukan satu perubahan raksasa.** Pekerjaan dibagi ke dalam 4 gelombang. Satu gelombang baru dimulai setelah gelombang sebelumnya lolos gerbang.
2. **Kepemilikan file.** Setiap alur kerja hanya menyentuh file miliknya: satu modul per divisi (`*RecordTypes.js`, `*Collector.js`, service, controller, route, dan halaman sendiri). File bersama (registri jenis data, registri tarikan, navigasi, izin, migrasi) hanya disunting satu orang, yaitu integrator. Karena itu alur kerja bisa berjalan paralel tanpa saling menimpa.
3. **Nomor migrasi dipesan per alur** supaya tidak bentrok:
   - fondasi 081–084 (081 dipakai satuan barang);
   - Procurement 085–089 (085 izin, 086–088 view, 089 saran pesan ulang) dan 098 (Tgl kirim PO, karena 085–089 sudah habis);
   - Warehouse 090–094 (093–094 untuk pencocokan 3.2) dan 099 (OTIF 3.4);
   - Sales 095–097;
   - Management 100–104.
4. **Saklar per fitur Accurate.** Setiap tarikan baru mati sampai lolos gerbang (`ACCURATE_WAREHOUSE_DOCUMENTS`, `ACCURATE_SYNC_SCOPES`, dst.), karena arsip hanya bertambah dan tidak bisa dihapus.
5. **Gerbang setiap gelombang** (semuanya wajib sebelum saklar dinyalakan):
   - seluruh tes backend dan frontend lolos, dan build berhasil;
   - uji dengan data asli di dalam transaksi yang dibatalkan (tidak ada yang tersimpan);
   - cek di browser headless (desktop 1280 dan ponsel 390, tanpa error);
   - tinjauan independen dengan pembantah per temuan, lalu temuan yang sahih diperbaiki;
   - dokumen ini diperbarui, lalu laporan singkat ke owner.
6. **Aturan yang tidak pernah dilanggar:**
   - Accurate hanya dibaca;
   - data lama tidak diubah atau dihapus (TEGAS);
   - setiap data Accurate lewat persetujuan divisinya;
   - tanpa harga untuk Warehouse, tanpa harga beli untuk anggota Procurement;
   - tanpa data pribadi;
   - UI Material 3;
   - setiap modul masuk eskalasi, target, dan KPI manajemen.

## Keputusan yang berlaku

- **Procurement:** harga beli hanya untuk Head/Supervisor dan Management Office (P1); faktur dan pembayaran pembelian milik Finance (P2); penyetuju Head Procurement dengan pengganti Head Management Office (P3).
- **Warehouse:**
  - D1 tanpa harga;
  - D2 stok terlihat oleh Warehouse serta Supervisor/Head Management Office;
  - D4 penerimaan milik Warehouse;
  - D5 alamat tidak disimpan sama sekali: tujuan = kota dari nomor customer, dan alamat lengkap dilihat di surat jalan Accurate;
  - D7 "Menipis" = cukup kurang dari 7 hari, dihitung dari barang keluar 30 hari terakhir.
- **Pemilik eskalasi:**
  - pengiriman terlambat → Warehouse (satu eskalasi: "SO lewat janji kirim");
  - pergerakan gudang tidak cocok dengan Accurate → Warehouse;
  - surat jalan belum difaktur → Sales/Retail Commerce;
  - PO terlambat → Procurement;
  - piutang dan tukar faktur → Sales;
  - stok minus → Warehouse;
  - barang habis sebelum barang datang, belum dipesan → Procurement (satu baris per pemasok; Management Office memakai "Ditangani", dan "Selesai" hanya bila memang tidak ada yang perlu dipesan dari pemasok itu, karena barang lain dari pemasok yang sama baru muncul lagi setelah PO berikutnya).
- **Omzet:** dihitung bersih setelah retur, dan faktur uang muka tidak dihitung. Perkiraan margin hanya untuk manajemen.
- **PO terlambat (rekomendasi, berlaku sampai owner mengubah):** PO belum ditutup dan belum diterima penuh, lewat lebih dari 1 hari dari "Tgl kirim" Accurate (tanpa Tgl kirim: 14 hari dari tanggal PO, ditandai "perkiraan"). Hanya PO sejak 22 September 2026 yang masuk eskalasi; PO yang lebih lama tampil sebagai "PO lama belum ditutup" untuk ditutup di Accurate.
- **Tgl kirim bawaan Accurate (Head Supply Chain, 30 September):** Accurate mengisi Tgl kirim PO sama dengan tanggal PO (341 dari 347 PO), sehingga setiap PO baru dianggap terlambat dua hari setelah dibuat. Tgl kirim yang sama atau lebih awal dari tanggal PO dianggap belum diisi → 14 hari dari tanggal PO, "perkiraan". Migrasi 098 (view saja; data asli tetap) dan aturan yang sama di tarikan. Uji data asli: PO terlambat palsu 2 → 0.
- **Harga beli untuk Management Office:** Supervisor dan Head MO sama-sama boleh melihat (rekomendasi atas P1).
- **Wewenang keputusan (owner, 30 September 2026):** "apapun itu yang membutuhkan keputusanku, saya mau kamu wakili … berperan senior role yang dibutuhkan". Keputusan di bawah ini diambil Claude atas nama owner dari sudut pandang peran senior terkait, dan dicatat di sini. Aturan keras tetap tidak didelegasikan: Accurate hanya dibaca, data lama tidak diubah/dihapus, tanpa commit kecuali diminta.
- **Tukar faktur (Sales Ops + Finance Controller, ditetapkan 30 September):** wajib untuk faktur kredit (jatuh tempo setelah tanggal faktur) yang belum lunas; dieskalasi ke Sales bila 7 hari belum ditukar, hanya faktur 60 hari terakhir (saldo lama diikuti di Umur piutang).
- **Faktur uang muka (Finance Controller, 30 September):** dikecualikan dari omzet. Jumlah faktur uang muka yang dikecualikan ditampilkan di KPI omzet supaya terlihat; bila faktur pertama muncul, perlakuan pemotongannya di faktur pelunasan dicek dengan data asli.
- **D2 diperluas (Head Supply Chain, 30 September):** Supervisor/Head Procurement dan Management Office boleh melihat "Saran pesan ulang" beserta stok total dan hari-cukupnya, karena pengadaan tidak bisa direncanakan tanpa itu. Anggota Procurement tidak. Stok per gudang tetap hanya Warehouse dan MO.
- **Janji kirim SO dan OTIF (Head Supply Chain, 30 September):**
  - Janji kirim = Tgl kirim di SO Accurate bila diisi setelah tanggal SO; selain itu standar 2×24 jam dari tanggal SO, dan bila jatuh pada hari Minggu digeser ke Senin (Accurate mengisi Tgl kirim sama dengan tanggal dokumen secara bawaan). Satu definisi untuk Jadwal kirim, Hari ini, OTIF, dan eskalasi; halaman alur lintas divisi (3.3) memakai view yang sama, tanpa eskalasi kedua.
  - Tepat waktu & lengkap = terkirim 100% (tanggal surat jalan terakhir; bila tanpa surat jalan, faktur terakhir selain uang muka) paling lambat janji kirim. SO yang masih terbuka setelah janji dihitung gagal.
  - Hanya SO sejak 22 September 2026 (`WAREHOUSE_OTIF_FROM`), karena data Accurate diisi mundur. Target minimal 5 SO jatuh tempo per periode. SO yang ditutup tanpa terkirim sebelum janji tidak dihitung; ditutup setelah janji = kurang.
  - Tidak dinilai selama batch Sales/Retail Commerce SO itu masih menunggu persetujuan (datanya belum lengkap).
  - Tarikan Sales menyimpan Tgl kirim SO hanya bila setelah tanggal SO, dan "ditutup" hanya bila ditutup manual; SO lain tidak mendapat versi baru. Tarikan kering 30 September: 58 SO (HoReCa) punya janji eksplisit.
- **Perkiraan margin (Finance Controller, 30 September):** diberi label "Perkiraan margin (harga PO)", hanya untuk Management Office dengan izin harga beli. Pendapatan = DPP baris faktur bersih (tanpa uang muka); biaya = harga PO bersih sebelum PPN per satuan dasar, PO terakhir sebelum penjualan. Rebate/program prinsipal di luar PO tidak termasuk, jadi angkanya bukan HPP akuntansi: uji data asli (batch #9–#11) memberi margin ± 1,3% dengan beberapa bulan negatif karena beberapa barang dibeli hampir di harga jual.
- **Pencocokan gudang (Head Warehouse + IT/Data Lead, 30 September):** kunci = nomor referensi pergerakan (huruf/angka saja, minimal 4 karakter dengan angka) terhadap nomor dokumen Accurate, No. SJ pemasok, atau PO/SO di baris (±14 hari); dibandingkan per barang dalam satuan dasar; hanya pergerakan yang disetujui sejak 22 September dan dalam 180 hari terakhir (siklus bulanan; selisih lebih lama diselesaikan lewat stock opname), sehingga biaya kueri tetap di tingkat 6 bulan (< 0,6 detik) berapa pun panjang riwayatnya. Accurate tidak pernah diubah: selisih diperbaiki di sumbernya, dipasangkan manual, atau dijelaskan.
- **Barang lambat laku (Head Supply Chain, 30 September):** hanya di halaman manajemen (Management Office dengan izin stok), dipisah "pernah laku, tidak laku ≥ 90 hari" dan "belum pernah terjual (cek kode lama)". 254 dari 255 barang diam adalah kode lama (MKR-), jadi belum dijadikan KPI Warehouse sampai kode barang di Accurate dirapikan.
- **Saran pesan ulang (Head Supply Chain, 30 September):** dihitung dalam hari cukup.
  - Posisi = stok total (minus dihitung 0, ditandai) + sisa PO berjalan sejak 22 September dalam satuan dasar. PO lama tampil, tidak dihitung.
  - Keluar per hari = sumber "hari cukup" Warehouse (minimal 7 hari riwayat).
  - Waktu datang = rata-rata pemasok dari penerimaan gudang yang disetujui (minimal 3 PO dalam 90 hari, dan tidak pernah lebih pendek dari umur PO pemasok itu yang masih menunggu); selain itu 14 hari "perkiraan".
  - "Habis sebelum barang datang": posisi < keluar/hari × waktu datang. "Pesan sekarang": posisi < keluar/hari × (waktu datang + 7 hari stok pengaman = ambang "Menipis" D7). "Habis, perlu dicek": stok habis, tanpa PO, laju belum diketahui, dibeli lewat PO dalam 180 hari terakhir (jumlahnya ditentukan manual).
  - Jumlah saran = sampai cukup waktu datang + 7 + 14 hari (siklus pesan dua minggu), dibulatkan ke atas per satuan beli PO terakhir, minimal 1.
  - Harga terakhir (bersih sebelum PPN, termasuk diskon kepala PO dan PO harga termasuk pajak) dan perkiraan nilai hanya untuk `procurement.price.view` (P1).
- **Izin saran pesan ulang (IT/Security Lead, 30 September):** satu kode, `procurement.reorder.view` (migrasi 089), untuk Supervisor/Head Procurement, Supervisor/Head MO, dan Super Admin. Kode yang sama membuka stok total untuk Prakasa AI; tidak ada kode kedua.
- **Prakasa AI dan data stok/PO (Head of IT Security, 30 September):** alat stok/PO hanya jalan di percakapan pribadi tanpa riset web. Percakapan yang pernah membaca stok/PO tidak bisa dibagikan, tidak bisa diekspor ke Shared Drive/Dokumen, dan jawabannya dibuang bila percakapan dibagikan saat jawaban sedang ditulis. Setiap pemanggilan alat stok/PO wajib tercatat di log; bila pencatatan gagal, datanya tidak dikirim.
- **Saklar (IT/Data Lead, 30 September 00.05):** pengingat batch, satuan barang, dan Jadwal kirim dinyalakan setelah lolos gerbang.
- **Prakasa AI:** boleh membaca jumlah Warehouse/Procurement, tidak harga beli (rekomendasi, berlaku sampai owner mengubah).
- **Akun uji "[UJI]":** dibiarkan, tidak diubah, sampai uji coba pengguna.
- **Commit:** hanya bila owner meminta.

## Keputusan penyelesaian (30 September 2026)

Owner: "perlu diputuskan untuk menyelesaikan secara final untuk keutuhan yang kita fokuskan ini di sesi ini". Diputuskan (Claude sebagai penanggung jawab program):

- **Lingkup final sesi ini:** semua butir Gelombang 3 (3.1–3.4) dan Gelombang 4 (4.1–4.2) diselesaikan di sesi ini. Tidak ada fitur baru di luar daftar ini.
- **Definisi selesai untuk setiap butir:**
  - dibangun sesuai spesifikasi yang sudah dikritik;
  - tes backend dan frontend lolos, build berhasil;
  - diuji dengan data asli di dalam transaksi yang dibatalkan;
  - dicek di browser headless (desktop dan ponsel);
  - lolos tinjauan independen, dan temuannya diperbaiki;
  - dicatat di dokumen ini.
- **Penutup sesi:** regresi penuh (`gate-all`), tinjauan akhir lintas modul, daftar uji coba untuk pengguna (UAT), dan laporan akhir ke owner.
- **Tetap di luar sesi** (butuh orang lain atau izin khusus):
  - persetujuan batch #9–#11 oleh Head/Supervisor;
  - pindah ke server: **shared hosting** (2 vCPU, 4 GB RAM, 100 GB NVMe), bukan VPS (owner, 30 September); untuk sekarang fokus di lokal;
  - uji coba dengan pengguna asli;
  - commit (hanya bila owner meminta);
  - kirim data ke Accurate (write-back), yang butuh izin tulis Accurate dan keputusan owner sendiri karena termasuk aturan keras.

## Gelombang dan status

Legenda: ⬜ belum · 🔵 dikerjakan · ✅ lolos gerbang · ⏸ menunggu pihak lain

### Gelombang 0: persiapan
| # | Pekerjaan | Status |
|---|---|---|
| 0.1 | Dokumen program ini | ✅ |
| 0.2 | Verifikasi perbaikan tinjauan tahap 2, lalu nyalakan dokumen gudang. Tes backend dan frontend lolos, build berhasil, uji data asli di-rollback (1.520 baris, 0 alamat, 0 tersisa), cek headless desktop dan ponsel tanpa error, tinjauan ulang independen "aman dinyalakan". Temuannya ikut diperbaiki: tarikan Sales tidak pernah menyimpan baris setengah baru; satu dokumen yang gagal dibaca tidak menghentikan tarikan; "tidak ada lagi" hanya bila Accurate sendiri menjawab tidak ada; pemeriksaan bergiliran. `ACCURATE_WAREHOUSE_DOCUMENTS=1` menyala 29 September 22.15; dokumen masuk batch berikutnya setelah batch #10 diputuskan | ✅ |
| 0.3 | Modularisasi agar alur bisa paralel: mesin bersama (`syncCore.js`), tarikan per divisi (`salesPull.js`, `warehousePull.js`), registri tarikan per lingkup | ✅ |

### Gelombang 1: fondasi bersama
| # | Pekerjaan | Kriteria selesai | Status |
|---|---|---|---|
| 1.1 | Perbaikan zona waktu (jam maju 7 jam) | Sesi database selalu UTC (sama dengan driver), jadi waktu tampil benar di Mac maupun VPS; "hari ini", tanggal per hari, batas periode target, dan filter tanggal di SQL ditulis eksplisit WIB (dijaga tes); "hari ini" dan "bulan ini" di JavaScript memakai WIB. Data lama tidak diubah; cermin Accurate terbaca identik (3.695 catatan). Catatan: nilai DATETIME lama yang ditulis `NOW()` (waktu keputusan batch #1–#8, login terakhir) tetap tampil +7 jam; yang baru benar | ✅ |
| 1.2 | Persetujuan batch yang ringan | Notifikasi berisi ringkasan satu kalimat (apa yang berubah dan hasil pemeriksaan tarikan) dan sampai ke Supervisor, Head/pengganti, serta owner; tombol "Setujui" langsung dari notifikasi baru (menolak tetap di halaman batch karena wajib beralasan); pengingat setelah 8 jam, lalu eskalasi ke Head dan owner tiap hari (saklar `ACCURATE_BATCH_REMINDERS`); notifikasi keputusan menuju halaman batch | ✅ (saklar menyala setelah owner setuju) |
| 1.3 | Satuan dan rasio barang dari Accurate | Jenis data baru "Satuan barang" (disetujui Warehouse, saklar `ACCURATE_ITEM_UNITS`), view `item_units_accurate` (migrasi 081) untuk menghitung jumlah dalam satuan dasar di Sales, Warehouse, dan Procurement; modal stok menampilkan "1 Ctns = 6 Pack". Uji data asli di-rollback: 1.738 barang, 2.740 baris satuan | ✅ (saklar menyala setelah owner setuju) |
| 1.4 | "Perlu dibereskan di Accurate" | Data Accurate → "Perlu dibereskan di Accurate": stok minus, stok per gudang ≠ total, pindah gudang belum dicatat diterima (≥ 3 hari), tanggal lebih dari 7 hari ke depan, nama satuan tidak seragam; per divisi, bisa diekspor; KPI manajemen "Perlu dibereskan di Accurate" | ✅ |

### Gelombang 2: tiga alur paralel
| # | Alur | Pekerjaan | Status |
|---|---|---|---|
| 2.1 | Procurement | Tahap 1 selesai dibangun: pemasok (daftar saja, rincian ditutup di gerbang), PO dengan baris, jumlah, tanggal, dan harga (P1); halaman Hari ini, Purchase order, Pemasok, Data Accurate; eskalasi "PO terlambat datang", KPI dan metrik manajemen; migrasi 085–087. Uji data asli di-rollback: 138 pemasok, 347 PO, 0 data pribadi, 0 kunci harga untuk anggota, data lain terbukti tidak berubah. Tinjauan independen "aman dinyalakan"; temuannya ikut diperbaiki: nomor rekening di nama pemasok dibuang dengan aturan yang sama persis dengan penjaga staging (tarikan tidak bisa macet karenanya), batch Procurement hanya diputuskan Head (pengganti Head MO, P3), fill rate pemasok tanpa PO lama. Saklar menyala 29 September 23.23 (`ACCURATE_PROCUREMENT=1`, lingkup sinkron + `procurement`) | ✅ |
| 2.2 | Warehouse | Dibangun: "Jadwal kirim" (SO belum terkirim penuh dari Accurate, stok dibagi menurut tgl kirim, cukup/kurang per SO dan per baris; jenis data `wh_so_open`, saklar `ACCURATE_WAREHOUSE_SO`, migrasi 091); kartu "PO akan datang (7 hari)" di Hari ini (dari PO 2.1, jumlah dan tanggal saja); kartu stok per barang dari dokumen yang disetujui. Uji data asli di-rollback: 11 SO terbuka, semuanya sisa lama (lewat 74–111 hari, stok kurang) — ditambahkan ke "Perlu dibereskan di Accurate" untuk ditutup Sales Tinjauan independen menemukan dua hal penting yang sudah diperbaiki: jumlah terkirim/diterima dari Accurate dalam satuan dasar (migrasi 092; juga baris PO Procurement, migrasi 088 — fill rate dan rincian PO kini benar), dan SO yang ditutup di Accurate keluar dari jadwal. Saklar `ACCURATE_WAREHOUSE_SO` menunggu owner | ✅ (saklar menunggu owner) |
| 2.3 | Sales | Dibangun: omzet bersih retur tanpa faktur uang muka (view `sales_revenue_accurate`, migrasi 095; dipakai di ringkasan, target, dan KPI manajemen; penanda uang muka hanya disimpan bila ada — saat ini 0 dari 1.296 faktur); tab "Umur piutang" per syarat bayar (dihitung dari jatuh tempo − tanggal faktur; data asli: 632 faktur, Rp 6,24 miliar, Rp 4,99 miliar lewat > 90 hari); tab "Tukar faktur" (dicatat di aplikasi karena Accurate tidak memakainya; migrasi 096; eskalasi "Faktur belum tukar faktur" 7 hari untuk faktur kredit 60 hari terakhir); satuan dasar di produk terlaris, tab Produk, dan profil customer (setelah satuan barang disetujui); profil customer (omzet bersih 12 bulan, piutang, lewat jatuh tempo, produk teratas, umur piutang) Tinjauan independen: aman; perbaikannya ikut dikerjakan (retur dibebankan ke salesperson faktur terakhir customer — migrasi 097; ringkasan Data Sales memakai "nilai faktur/SO" karena omzet bersih ada di ringkasan; tautan lewat jatuh tempo; tanggal mustahil ditolak; umur piutang per customer) | ✅ |

### Gelombang 3: nilai dan lintas divisi
| # | Alur | Pekerjaan | Status |
|---|---|---|---|
| 3.1 | Procurement | Dibangun: tab "Harga beli" (harga terakhir per pemasok × barang × satuan, sebelumnya, naik/turun; riwayat dan pemasok lain; data asli: 684 harga, 65 naik, 50 turun); rapor pemasok (fill rate, tepat waktu, rata-rata waktu datang — terisi setelah penerimaan gudang disetujui); metrik manajemen "PO datang tepat waktu" dan "Rata-rata waktu datang". Tab "Saran pesan ulang" (aturan di Keputusan; izin `procurement.reorder.view`), kartu "Perlu dipesan" di Hari ini, KPI "Barang perlu dipesan" dan eskalasi "Barang habis sebelum barang datang, belum dipesan" (per pemasok, hanya hari, tertahan sampai stok, riwayat 7 hari, dan PO disetujui); migrasi 098 (Tgl kirim bawaan). Rancangan dikritik independen; 12 temuannya diperbaiki (angka dari MySQL, harga bersih sebelum PPN, bias waktu datang, hari eskalasi, Tgl kirim, KPI tanpa PO, dan lainnya). Uji data asli di-rollback (batch #10 dan #11): 658 barang dalam cakupan, 124 "habis, perlu dicek", 0 kritis karena riwayat stok belum 7 hari (mulai 6 Oktober); simulasi riwayat 20 hari: 30/30 kritis, 30/30 pesan sekarang, 30/30 aman sesuai rumus; harga bersih cocok (PO termasuk pajak: Rp 70.270,33/Ctn, bukan Rp 78.000); cermin tidak berubah; 0,5 detik. Cek browser: anggota tanpa tab dan tanpa kartu, Head lengkap dengan hitungan dan harga, ponsel tanpa overflow, tanpa error. Lolos tinjauan akhir 4.2; temuannya diperbaiki (lihat 4.2) | ✅ |
| 3.2 | Warehouse | Dibangun: tab "Cocokkan Accurate" (Barang Masuk/Keluar yang disetujui ↔ penerimaan, surat jalan, pindah gudang, penyesuaian yang disetujui; per barang dalam satuan dasar; status Cocok, Selisih jumlah, Belum di Accurate, Belum di aplikasi, Belum bisa dibandingkan, Dijelaskan), kartu di detail pergerakan, "Catat sekarang" dari dokumen Accurate, petunjuk referensi dan kode barang di formulir; pasangkan manual dan penjelasan hanya oleh Supervisor/Head yang tidak mencatat pergerakannya (tercatat di log, bisa dibatalkan, tidak pernah dihapus); izin `warehouse.recon.view`/`warehouse.recon.resolve` (migrasi 093), 8 view (094); eskalasi "belum di Accurate", "selisih jumlah" (termasuk baris tanpa kode barang), "belum di aplikasi"; KPI dan metrik target "Pergerakan cocok dengan Accurate". Rancangan dikritik independen; temuannya diperbaiki (kunci bertipe dan satu kunci gabungan, referensi asal-asalan seperti N/A/0/001 tidak dicocokkan, tanggal mulai dari persetujuan pertama, tanda tangan tanpa GROUP_CONCAT, jam eskalasi dari hari dokumen pertama masuk). Keputusan tambahan: jendela 180 hari (lihat Keputusan). Data asli hari ini kosong di kedua sisi, jadi diuji dengan skenario sintetis di dalam transaksi yang di-rollback: semua status, pasangkan/lepas, penjelasan gugur saat data berubah, cermin dan tabel tidak berubah; volume setahun: semua kueri 0,4–0,6 detik. Cek browser 4 persona (Supervisor, anggota, MO, Sales) tanpa error, tanpa overflow ponsel. Lolos tinjauan akhir 4.2; temuannya diperbaiki (lihat 4.2) | ✅ |
| 3.3 | Management | Dibangun: halaman "Alur & Margin" (`/management/flow`, khusus manajemen): alur penjualan SO → terkirim lengkap → ditagih → lunas (median/rata-rata/p90 per langkah, per divisi, yang tertahan), alur pembelian PO → datang → lengkap, "Perkiraan margin (harga PO)" (hanya dengan izin harga beli), "Lambat laku" (hanya dengan izin stok; rupiah hanya dengan izin harga beli); provider `flow` dengan eskalasi "Surat jalan belum difaktur" → Sales/RC, KPI "Surat jalan belum difaktur" dan "Pesanan sampai lunas (median)", metrik target "Hari faktur sampai lunas"; migrasi 100–102 (view saja). SO terlambat memakai view dan eskalasi 3.4 (satu eskalasi). Prakasa AI tidak membaca margin/harga/nilai stok. Rancangan dikritik independen; temuannya diperbaiki. Uji data asli (batch #9–#11 di-rollback): 1.231 SO, lunas median 5 hari; margin YTD ± 1,3% (cakupan harga 93,6%; September 25,6% karena kode barang baru belum pernah di-PO); lambat laku: 27 tidak laku ≥ 90 hari, 7 lambat, 237 belum pernah terjual (kode lama); semua kueri < 160 ms; cermin tidak berubah. Cek browser 3 persona: Head MO semua tab, Supervisor MO tanpa izin harga tanpa tab margin dan tanpa rupiah, Head divisi tidak bisa membuka; tanpa error, tanpa overflow. Lolos tinjauan akhir 4.2; temuannya diperbaiki (lihat 4.2) | ✅ |
| 3.4 | Target | Dibangun: view `wh_so_fulfilment_accurate` (migrasi 099) dengan janji kirim (lihat Keputusan); metrik target Warehouse "SO terkirim tepat waktu & lengkap" dan "Rata-rata hari SO sampai terkirim lengkap" (minimal 5 SO); KPI "SO tepat waktu & lengkap (30 hari)" (tanpa angka palsu 0% bila belum ada yang jatuh tempo); eskalasi "SO lewat janji kirim" → Warehouse, satu-satunya eskalasi SO terlambat; Jadwal kirim, Hari ini, "Perlu dibereskan di Accurate", dan alat AI jadwal kirim memakai janji yang sama; SO sebelum 22 September ditandai "SO lama". Procurement "PO tepat waktu" sudah ada dan kini benar berkat migrasi 098. Rancangan dikritik independen; semua temuan diperbaiki (status "dinilai" memakai waktu tarikan terakhir sehingga Mac tidur tidak membuat SO terlihat gagal; tanggal tutup SO = tarikan yang melihatnya; view per jenis data, 31 ms; penjaga mode transaksi di aplikasi; janji standar yang jatuh hari Minggu digeser ke Senin). Uji data asli (batch #9–#11 di-rollback): 9 dari 9 SO sejak 22 September tepat waktu & lengkap, seluruh September 62 dari 73 (84,9%); 0 eskalasi karena SO yang lewat janji semuanya sebelum 22 September. Tarikan kering: 58 SO punya Tgl kirim eksplisit. Cek browser: tautan eskalasi membuka "Lewat janji kirim", modal menampilkan janji dan Tgl kirim Accurate, ponsel tanpa overflow. Lolos tinjauan akhir 4.2; temuannya diperbaiki (lihat 4.2) | ✅ |

### Gelombang 4: penyelesaian
| # | Pekerjaan | Status |
|---|---|---|
| 4.1 | Prakasa AI membaca jumlah Warehouse/Procurement (tanpa harga beli): enam alat (stok, jadwal kirim, gudang hari ini, status PO, procurement hari ini, rapor pemasok), hanya di percakapan pribadi, mengikuti hak akses pengguna (stok total untuk Procurement Sup/Head, stok per gudang hanya Warehouse/MO), penjaga keluaran yang menolak kunci harga/pembayaran/alamat. Rancangan dikritik independen; temuannya diperbaiki: ekspor jawaban berisi stok/PO ke Shared Drive ditolak (blocker), kunci saat jawaban sedang ditulis, log audit wajib, riset web tidak bersamaan dengan alat stok/PO, kunci konteks halaman `nomor_po`/`kode_pemasok`/`nomor_so`, catatan satuan. Tes backend dan frontend lolos. Lolos tinjauan akhir 4.2; temuannya diperbaiki (lihat 4.2) | ✅ |
| 4.2 | Regresi penuh, tinjauan akhir, daftar uji coba untuk pengguna. Tinjauan akhir independen (5 sudut: akses, keamanan data, ketepatan, manajemen, UX dan tes), setiap temuan dibuktikan pembantah: 33 temuan nyata (14 penting, 19 kecil) dan 3 dibantah; semuanya diperbaiki. Di antaranya: riset web dikunci di percakapan yang berisi data stok/PO/notifikasi; pencocokan gudang dan OTIF menunggu data Accurate lengkap sebelum menilai (migrasi 103–104); ID eskalasi pencocokan berepisode; harga bonus Rp 2 tidak lagi jadi harga terakhir; barang stok minus ikut dieskalasi; KPI/target nilai PO butuh izin harga beli; tautan hanya ke halaman yang boleh dibuka; kecepatan: saran pesan ulang 17–22 detik → 0,2 detik dan pencocokan 1,2–1,6 → 0,3 detik pada volume setahun (migrasi 105, tanpa perubahan data). Gerbang akhir: tes backend 841 dan frontend 383 lolos, build berhasil; 6 cek browser tanpa error dan tanpa overflow; 799 panggilan manajemen dengan batch #9, #10, #12 diterapkan lalu dibatalkan: 0 error, 0 di atas 1 detik, 0 bocor antar divisi, checksum cermin sama. UAT: [uat-program-4-divisi.md](uat-program-4-divisi.md) | ✅ |

### Di luar sesi (butuh owner atau pihak lain)
| Pekerjaan | Pemilik |
|---|---|
| Persetujuan batch #9 (Sales), #10 (Warehouse), dan #11 (Procurement, hanya Head Procurement atau pengganti Head MO) | Head/Supervisor divisi |
| Pindah ke shared hosting (2 vCPU, 4 GB RAM, 100 GB NVMe) supaya sinkron tidak berhenti saat Mac tidur. Syarat yang dicek dulu: MySQL 8.0+ (bukan MariaDB — view memakai JSON_TABLE, JSON_VALUE … RETURNING, window function), izin `SET time_zone` dan GET_LOCK, aplikasi Node.js yang berjalan terus, cron tiap 5 menit untuk sinkron Accurate (pengganti launchd) dan refresh token harian, koneksi HTTPS keluar ke Accurate, HTTPS untuk redirect OAuth Accurate | Owner + Claude Code |
| Uji coba dengan pengguna asli | Owner + Head divisi |
| Commit | Owner (atas permintaan) |
| Kirim data ke Accurate (write-back) | Tahap terpisah setelah program ini |
