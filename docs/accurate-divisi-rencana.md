# Rencana — Data Accurate untuk setiap divisi

Status: **disetujui owner 29 September 2026**. Urutan pengerjaan mengikuti alur barang. Pesan owner: "cek lagi, jangan sampai ada yang terlewat".

## Aturan yang berlaku untuk semua divisi

1. **Accurate hanya dibaca.** Semua permintaan lewat `services/accurate/accurateReadOnly.js`, dan scope yang diminta hanya `*_view`.
2. **TEGAS: tidak ada perubahan atau penghapusan data**, baik di Accurate maupun pada data lama aplikasi. Data Accurate masuk ke arsip tersendiri (`accurate_records`) yang hanya bertambah: setiap perubahan menjadi versi baru, dan data yang hilang di Accurate hanya ditandai.
3. **Disetujui divisinya.** Setiap tarikan dipecah menjadi batch per divisi dan diputuskan oleh Supervisor atau Head divisi itu. Kalau divisi belum punya penyetuju, ada penyetuju pengganti yang ditetapkan owner.
4. **Setiap divisi tersambung ke manajemen**: eskalasi, target, dan KPI dashboard, dengan scope per divisi.
5. **UI/UX mengikuti Material Design 3 / Google Workspace** (`docs/ui-guideline.md`, ditegakkan tes otomatis). Rinciannya:
   - komponen bersama (DataGrid, Card, Chip, Banner, Modal);
   - layout satu kolom yang lega, dengan panel samping untuk detail;
   - status memakai Badge standar, bukan warna buatan sendiri;
   - responsif di 390 px, 760 px, dan 1280 px;
   - tidak memakai logo atau merek Google.

## Peta divisi ↔ data Accurate

Peta ini disusun dari laporan dokumentasi API Accurate (67 resource) dan kajian per divisi pada 29 September 2026.

| Divisi | Data Accurate | Fitur | Penyetuju batch | Status |
|---|---|---|---|---|
| **Sales** | Pelanggan, barang, SO, surat jalan, faktur (+ baris barang), penerimaan, retur | Omzet dari faktur, status customer, piutang, Perlu tindakan, tab Surat jalan/Faktur/Penerimaan/Retur/Produk, produk terlaris | Supervisor/Head Sales | **Berjalan**: batch #7 (3.655) disetujui |
| **Retail Commerce** | Sama, untuk pelanggan Shopee/Tokopedia | Sama, dengan scope divisinya | Head Sales (pengganti) sampai ada Supervisor/Head RC | **Berjalan**: batch #8 (40) disetujui |
| **Warehouse** | Barang, gudang, stok per gudang, pindah barang, penyesuaian, stok opname, surat jalan keluar, penerimaan barang masuk | Stok per gudang, stok menipis, jadwal kirim hari ini, barang masuk, selisih opname | Supervisor/Head Warehouse | **Tahap 1 berjalan** (Stok dari Accurate; batch #10 menunggu). **Tahap 2 dibangun** (dokumen gudang, Hari ini), menunggu tinjauan sebelum dinyalakan. Tahap 3–5 menyusul |
| **Procurement** | Pemasok, permintaan barang, PO, penerimaan barang, faktur pembelian, retur pembelian | Status PO, PO terlambat datang, riwayat harga beli, pemasok aktif | Belum ada penyetuju; ditetapkan owner | Perlu scope tambahan; modul masih "coming soon" |
| **Finance** | Piutang (faktur), utang (faktur pembelian), penerimaan, pembayaran, kas/bank, jurnal, akun | Umur piutang dan utang, jatuh tempo, arus kas, rekonsiliasi piutang (menjawab selisih Rp 6,24 M vs Rp 5,69 M) | Supervisor/Head Finance | Perlu scope tambahan; modul masih "Segera hadir" |
| **Management Office** | Gabungan semua | KPI lintas divisi, eskalasi | — (hanya membaca data yang sudah disetujui) | Mengikuti tiap divisi |
| **Marketing** | Baris faktur (barang × channel) | Penjualan per produk dan channel | — (hanya membaca) | Ikut tahap Sales (baris faktur) |
| **People & Culture** | Karyawan (salesman), bila ada: gaji | Pemetaan salesman ↔ akun; data gaji **tidak** ditarik tanpa keputusan owner (data sensitif) | Head People & Culture | Perlu keputusan |
| ~~Operations~~ | Tidak dipakai: Operations bukan divisi. Pekerjaan operasional ditangani GA di People & Culture (owner, 1 Oktober 2026). | — | — | Tidak ada tarikan Accurate |

## Izin yang diminta saat sambung ulang (50, semuanya `_view`)

Daftar persisnya ada di `READ_ENDPOINTS` (`services/accurate/accurateReadOnly.js`), dan tes memastikan daftar itu tidak melebar diam-diam.

- **Tidak diminta tanpa keputusan owner:**
  - `sales_checkin_view`: lokasi GPS salesman;
  - `salesman_commission_view`: komisi.
- **Tidak pernah diminta:**
  - `access_privilege_view`;
  - semua scope produksi/manufaktur, karena 1.738 dari 1.749 barang adalah barang dagang;
  - `fob`/`auto_number`;
  - apa pun yang bukan `_view`. HPP (`item/get-nearest-cost`) butuh izin tulis, jadi tertutup selamanya.
- **Diminta tetapi dibatasi:**
  - karyawan hanya `list` (detailnya berisi NIK, NPWP, alamat, dan rekening);
  - `item/vendor-price` (harga beli) ditutup sampai Procurement membutuhkannya;
  - akun perkiraan, jurnal, kas/bank, beban, anggaran, dan aset hanya untuk Finance dan Manajemen, dengan akun gaji ditampilkan sebagai total.
- **Ditambahkan:** `roll_over_view` (penyelesaian pesanan). Tanpanya, SO atau PO yang ditutup sebagian terus terbaca "belum terkirim" atau "PO terlambat".

## Sinkron berkelanjutan (29 September 2026)

Arahan owner: *"jangan ada waktu dong, once head atau supervisor sudah oke langsung update data … tetapi untuk saat ini cukup sync kan datanya aja, jangan lakukan perubahan apapun dengan datanya."*

- **Tarikan otomatis setiap 5 menit, tanpa jam tetap.** Dijalankan lewat launchd `id.prakasa.accurate-sync` (`backend/src/jobs/accurateSync.js`) selama Mac menyala. Log: `~/Library/Logs/prakasa-accurate-sync.log`.
- Setiap tarikan hanya membaca Accurate. Perubahan diajukan sebagai batch per divisi, dan **begitu Supervisor/Head menyetujui, data langsung tampil di aplikasi**, tanpa menunggu jadwal berikutnya.
- **Tidak ada tarikan dobel.** Tarikan dilewati bila tarikan lain masih berjalan (kunci MySQL bersama antara job dan tombol "Tarik sekarang"), dan juga dilewati tanpa membaca Accurate bila setiap divisi masih punya batch menunggu keputusan.
- Kalau Mac tidur, putaran yang terlewat tidak dikejar; putaran berikutnya membawa semua perubahan. Di VPS nanti jadwal berjalan terus, dan webhook Accurate bisa membuatnya seketika.

## Tahap masa depan: kirim data dari Prakasa Workspace ke Accurate

Owner ingin data yang dikelola di Prakasa Workspace, setelah disetujui Head/Supervisor, langsung diperbarui ke Accurate. **Tahap 1 (pelanggan dan pemasok) dibangun 3 Oktober 2026 di sisi aplikasi** — pengajuan, persetujuan Supervisor/Head, antrean, rekonsiliasi — dengan saluran kirim ke Accurate tetap tertutup: lihat `docs/accurate-pengajuan-2026-10-03.md`. Membuka saluran itu membutuhkan izin tulis Accurate (`*_save`), yang saat ini sengaja ditolak oleh `accurateReadOnly.js` dan dikunci tes (50 izin `_view`), dan tetap menunggu keputusan owner atas:
- dokumen apa saja yang boleh ditulis;
- siapa yang menyetujui;
- bagaimana mencegah data dobel dengan input langsung di Accurate;
- jejak audit.

## Hasil sambung ulang dan probe (29 September 2026)

- **Sambung ulang berhasil: 50 izin, semuanya `_view`.** Daftarnya persis sama dengan yang diminta aplikasi: tidak ada tambahan dan tidak ada yang kurang. Accurate tidak menampilkan halaman persetujuan dan langsung memberi akses setelah login. Karena itu, yang menjaga "hanya membaca" adalah pemeriksaan di aplikasi:
  - token dengan izin selain `_view` ditolak dan tidak disimpan;
  - setiap permintaan hanya boleh berupa GET ke daftar baca.
- **Probe baca-saja** hanya mencatat jumlah data dan nama kolom, tanpa nilai, dan tidak ada yang disimpan:

| Divisi | Data di Accurate |
|---|---|
| Warehouse | 4 gudang; 1.738 barang dengan stok; 17.357 mutasi stok (tanggal transaksi 31/12/2025 s.d. sekarang); 17 pemindahan barang; 115 penyesuaian persediaan; 28 penerimaan barang; stok opname 0 |
| Procurement | 138 pemasok; 349 PO; 264 faktur pembelian; 250 pembayaran pembelian; permintaan barang 0; retur pembelian 0; 1 harga pemasok |
| Finance | 286 akun; 3.336 jurnal umum; 754 pembayaran lain; 9 penerimaan lain; 21 transfer bank; 12 aset tetap; 7 pajak; 9 departemen; 1 cabang; **1 mata uang (IDR)** |
| Sales tambahan | 3 kategori harga; 5 kategori pelanggan; 3 penawaran; tukar faktur, klaim, penyesuaian harga, dan roll-over masih 0 |
| Karyawan | 5 (hanya field daftar) |

- **Database Accurate ini baru diisi sejak 22 September 2026** (`createDate` tertua). Karena itu belum terbukti apakah batas "7 hari" di dokumentasi `stock-mutation-history` benar-benar berlaku. Kalau baris yang dibuat 22 September masih ada pada 30 September, batas itu tidak berlaku. Apa pun hasilnya, **tidak ada data yang hilang**, karena setiap mutasi berasal dari dokumen sumber yang tetap bisa dibaca lengkap: penyesuaian (termasuk saldo awal 31/12/2025), pemindahan, penerimaan barang, surat jalan, faktur, dan retur.
- Satu mutasi faktur bertanggal **3 Desember 2026** (masa depan) belum ada di cermin Sales, mungkin masih draf atau dibuat setelah tarikan terakhir. Tarikan berikutnya akan memperlihatkannya, lalu diteruskan ke Sales/Finance sebagai data yang perlu dicek.
- Mutasi stok memuat `itemNo`, `warehouseName`, `mutation`, `transactionType`/`transactionNumber`, dan `transactionDate`. Karena itu, **stok per gudang bisa dihitung dari mutasi** dan dicocokkan dengan total `item/list-stock`, sebagai pemeriksaan otomatis.
- Nilai biaya (`itemCost`, `unitCost`, `totalCost`) dan harga pada penerimaan barang **tidak ikut disimpan untuk Warehouse**. Nilai itu nanti masuk lewat tarikan Finance.

## Warehouse tahap 0: probe baca-saja (29 September 2026, 491 permintaan GET, tidak ada yang disimpan)

- **Stok per gudang bisa langsung dari Accurate.** `item/list-stock` menerima `warehouseName`, dan setiap gudang mengembalikan ke-1.738 barang, termasuk yang stoknya 0. Jumlah per gudang sama dengan total untuk 1.728 barang; 10 barang tidak cocok dan akan diperiksa di tahap 1. Angka yang dilihat tim gudang selalu angka Accurate sendiri.
- **Stok minus: 138 barang minus secara total, dengan 196 posisi barang × gudang yang minus.** Ini data Accurate yang perlu dibereskan tim gudang/keuangan, dan akan muncul sebagai KPI "Minus". Satu dari empat gudang kosong seluruhnya.
- **Riwayat mutasi tidak lengkap sebagai sumber stok.** Jumlah mutasi hanya cocok dengan stok untuk 1.224 dari 1.738 barang. Dari 115 penyesuaian (termasuk saldo awal 31/12/2025), 103 tidak punya baris mutasi. Mutasi hanya dipakai sebagai pembanding, tidak pernah sebagai angka stok.
- **Sensus mutasi per jenis:**
  - faktur penjualan 17.098 baris (224 barang), karena faktur memotong stok langsung;
  - surat jalan 152;
  - pemindahan 57;
  - penerimaan 37;
  - penyesuaian 12;
  - faktur pembelian 1.
- Sebanyak 3.584 baris mutasi dibuat pada 22/09. Diperiksa lagi 30/09 untuk menentukan apakah batas 7 hari berlaku.
- **Pemindahan barang berjalan dua langkah** (TRANSFER_OUT 10 lalu TRANSFER_IN 7, dengan status SENDING/FULL_RECEIVED) lewat gudang transit, jadi tanda +/- harus mengikuti kedua langkah itu. Penyesuaian semuanya ADJUSTMENT_IN, dan tandanya cocok dengan mutasi (12/12).
- **Deteksi perubahan dokumen:**
  - `lastUpdate` tersedia di daftar pemindahan, penerimaan, surat jalan, faktur penjualan, dan faktur pembelian;
  - penyesuaian dan retur penjualan tidak punya `lastUpdate` maupun `optLock`, sehingga detailnya dibaca ulang setiap tarikan.
- **Baris dokumen:** surat jalan, faktur, dan penerimaan membawa gudang dan `unitRatio` per baris. Header surat jalan dan faktur memuat alamat kirim (disaring sesuai D5).
- **Master barang** punya satuan 1–5 dengan rasionya, `minimumQuantity`/`minimumQuantityReorder` (bisa jadi dasar "Menipis" tanpa input baru), merek, dan UPC.
- Ukuran halaman maksimum API adalah 100. Zona waktu database lokal WIB (+7).

## Warehouse tahap 1: Stok dari Accurate (dibangun 29 September 2026)

- **Keputusan yang berlaku:**
  - D1: Warehouse hanya melihat jumlah, tanpa harga atau biaya;
  - D2: yang boleh melihat stok adalah Warehouse serta Supervisor/Head Management Office;
  - D4: penerimaan barang milik Warehouse (dipakai mulai tahap 2);
  - D3 diganti arahan owner: sinkron berkelanjutan tanpa jam tetap (`ACCURATE_SYNC_SCOPES=sales,warehouse`).
- **Jenis data di arsip** (divisi Warehouse, hanya jumlah):
  - `wh_warehouse` (gudang);
  - `wh_stock_total` (stok per barang, angka total Accurate);
  - `wh_stock` (stok per barang × gudang, dengan kunci `item_id × 1.000.000 + warehouse_id`).
- **Aturan stok di arsip:**
  - stok yang 0 dan belum pernah ada tidak disimpan;
  - stok yang hilang dari bacaan yang **lengkap** menjadi versi 0, tidak pernah "hilang";
  - bacaan yang tidak lengkap tidak menolkan apa pun;
  - lonjakan penolkan (>20%) menghentikan tarikan.
- **Pemeriksaan untuk penyetuju:** jumlah per gudang dibandingkan dengan total Accurate (per 29/09: 1.728/1.738 cocok), barang yang berubah saat ditarik, dan jumlah stok minus (138 barang di 196 posisi).
- **Tampilan:** Warehouse → tab **Stok** berisi pencarian, pilihan gudang, chip Ada/Habis/Minus, detail per gudang, dan riwayat versi. Tab **Data Accurate** berisi batch gudang dan tombol tarik untuk Supervisor/Head.
- **Manajemen:**
  - eskalasi `warehouse_stock_negative`, per gudang, bila stok minus lebih dari 3 hari;
  - KPI "Barang stok minus";
  - KPI "Umur data stok", yang memberi peringatan setelah 48 jam.
- **Uji dengan data asli dalam transaksi yang dibatalkan:** 1.292 baris, 438 barang ada, 1.162 habis, 138 minus. Oatside Barista 1L tercatat −1.071 Ctns, yang menandakan penerimaan barang di Accurate belum lengkap.

## Warehouse tahap 2: dokumen gudang (dibangun 29 September 2026)

- **Jenis data baru** (divisi Warehouse, hanya jumlah): `wh_transfer` (pindah gudang), `wh_adjustment` (penyesuaian, termasuk saldo awal), `wh_receipt` (penerimaan barang; pemasok hanya nama perusahaan), dan `wh_delivery` (surat jalan).
- **Hanya dokumen final** yang diambil (`approvalStatus` APPROVED, bukan draf). Dokumen yang hilang atau tidak final lagi ditandai "tidak ada lagi", dan hanya dari bacaan yang lengkap.
- **Detail dibaca ulang hanya bila `lastUpdate` berubah.** Penyesuaian tidak punya `lastUpdate`, jadi hanya dokumen baru yang dibaca, ditambah pemeriksaan ulang penuh sekali sehari.
- **D5 (alamat kirim):**
  - pelanggan bisnis: nama dan alamat, tanpa nomor telepon atau email (`sanitizeAddress`);
  - Shopee/Tokopedia: tanpa alamat;
  - alamat hanya tampil saat membuka satu surat jalan, tidak pernah di daftar.
- **Saklar `ACCURATE_WAREHOUSE_DOCUMENTS=1`:** kode setengah jadi tidak pernah mengajukan batch. Saklar dinyalakan setelah tinjauan.
- **Tampilan:**
  - tab **Hari ini** (tab pertama): perlu perhatian, kirim hari ini, datang hari ini;
  - tab **Dokumen Accurate**: chip per jenis dengan jumlah, filter tanggal/gudang/pencarian, dan detail dengan baris barang.
- **Manajemen:**
  - eskalasi `warehouse_transfer_stuck`: pindah gudang yang masih dalam perjalanan lebih dari 3 hari;
  - KPI "Surat jalan hari ini";
  - eskalasi stok minus kini dihitung sejak awal episode minus, dengan satu episode per gudang.
- **Uji dengan data asli dalam transaksi yang dibatalkan:**
  - 228 dokumen: 68 surat jalan, 28 penerimaan, 17 pindah gudang, 115 penyesuaian;
  - 67 alamat, 0 yang masih mengandung telepon/email, 0 alamat e-commerce;
  - 3 pindah gudang dalam perjalanan, 1 tertahan lebih dari 3 hari.
- **Perbaikan dari tinjauan independen tahap 1:**
  - `approval_aged` tidak lagi membuang approval tanpa `request_type`;
  - tarikan Sales hanya menandai "tidak ada lagi" dari bacaan lengkap;
  - job tidak berhenti total bila satu lingkup gagal;
  - penjaga penolkan juga menghitung stok yang menjadi 0;
  - "Tarik sekarang" menjawab 409 bila batch masih menunggu;
  - hitungan tarikan terakhir hanya untuk penarik;
  - Management Office bisa membuka Warehouse → Stok;
  - kolom Stok mengikuti gudang yang dipilih.

## Perbaikan dari tinjauan tahap 2 (29 September 2026)

- **Penyaring alamat ditulis ulang** (temuan privasi tinjauan kedua). Yang dibuang:
  - semua nomor telepon, HP maupun kantor, dengan 0/62/+62, dalam kurung, menempel pada kata, atau berderet;
  - NIK, NPWP, dan nomor rekening;
  - email.

  Setiap baris alamat dibersihkan terpisah, sehingga kode pos di baris berikutnya aman. Uji pada 67 alamat asli: 0 nomor tersisa.
- **"Tidak ada lagi" dikonfirmasi** lewat pembacaan detail sebelum diajukan, supaya dokumen yang masih ada dan final tidak ikut ditandai.
- **Penanda yang sudah dicek diingat** (`seenMarkers` di log tarikan). Dokumen yang `lastUpdate`-nya berubah tanpa perubahan isi (misalnya dicetak) tidak dibaca ulang setiap 5 menit.
- **Detail di batch yang menunggu dipakai ulang**, sehingga tarikan Sales turun dari sekitar 4 menit menjadi 26 detik.
- **Pemeriksaan harian penyesuaian** hanya dihitung bila hasilnya tidak ditolak atau ditarik.
- **Manajemen:**
  - eskalasi stok minus diberi kunci episode dari awal minus yang terbaru, dengan tautan langsung ke gudang dan saringan Minus;
  - eskalasi pindah gudang tertahan menaut ke "dalam perjalanan";
  - KPI "Approval menunggu" tidak lagi menghitung batch Accurate;
  - `locate()` terikat ke perusahaan.
- **Tampilan:**
  - "Hari ini" dan "Dokumen" menjelaskan bila dokumen belum aktif atau belum disetujui, alih-alih menampilkan nol;
  - tautan membuka saringan yang tepat;
  - ada pesan bila tab tidak boleh dibuka;
  - angka rata kanan di semua tabel (`align: 'end'`);
  - ekspor tanggal memakai tanggal biasa.
- **Tahap 3 (sebagian):** "Menipis" = stok cukup kurang dari 7 hari berdasarkan rata-rata keluar 30 hari, dari riwayat stok yang disetujui (view `wh_stock_cover_accurate`). Ada chip dan kolom "Cukup untuk", dan KPI "Barang menipis".

## Warehouse tahap 3 (berikutnya): catatan probe 29 September 2026

- **Stok minimum di Accurate kosong:** `minimumQuantity` dan `minimumQuantityReorder` bernilai 0 untuk 1.738 barang aktif, dan tidak bisa ditarik lewat daftar barang. Karena itu **"Menipis" (D7) memakai hari-cukup** (stok ÷ rata-rata keluar per hari selama 30 hari), dihitung dari penurunan antar-versi stok yang sudah disetujui (`wh_stock_total`). Hasilnya dalam satuan dasar, tanpa data baru dari Accurate. Sebelum riwayat mencapai 7 hari, barang ditandai "belum cukup riwayat".
- **"Harus dikirim"** membutuhkan baris SO yang belum terkirim (`wh_so_open`, hanya jumlah), dikerjakan setelah dokumen gudang (tahap 2) berjalan.

## Keputusan owner untuk Procurement (29 September 2026, "kerjakan sesuai rekomendasi kamu")

- **P1 (harga beli):** hanya Head/Supervisor Procurement dan Management Office yang melihat harga. Anggota Procurement dan Warehouse melihat jumlah dan tanggal saja.
- **P2 (faktur dan pembayaran pembelian):** milik **Finance**. Procurement membaca data yang sudah disetujui Finance.
- **P3 (penyetuju batch Procurement):** Head Procurement, dengan pengganti Head Management Office.

## Procurement tahap 0: probe baca-saja (29 September 2026, tidak ada yang disimpan)

- **Pemasok:** 138, semuanya aktif. Nama tanpa pola telepon, e-mail, atau nomor panjang. `vendor/list` tetap mengembalikan `lookupSubText` dan `vendorBranchName` walau kolom diminta eksplisit, jadi normalizer hanya mengambil kolom yang disebut satu per satu. Termin dan "pemasok jasa" tidak tersedia di daftar.
- **PO:** 349 (347 final).
  - Status: 255 terproses, 88 menunggu diproses, 4 sebagian diproses, 1 ditolak, 1 diajukan.
  - Semua punya Tgl kirim, dan hanya 6 bertanggal sejak 22 September.
  - Semua dalam rupiah.
  - Pada 20 rincian contoh, persen diterima cocok dengan baris, dan jumlah baris cocok dengan subtotal.
- **Faktur pembelian:** 264. Barisnya membawa nomor PO tetapi tidak nomor penerimaan, jadi pencocokan tiga arah (tahap 3) bisa lewat nomor PO.
- **Belum dicerminkan:**
  - permintaan barang, retur, klaim, dan roll-over: 0;
  - harga pemasok: 1;
  - pembayaran pembelian: 250 (milik Finance, P2).

## Procurement tahap 1: PO dan pemasok (dibangun 29 September 2026)

- **Gerbang baca-saja:** `vendor` dan `vendor-category` dipersempit ke `list` saja. Rincian pemasok (NIK, NPWP, rekening, kontak, alamat) tidak bisa dibuka sama sekali.
- **Jenis data** (`procurementRecordTypes.js`, divisi Procurement):
  - `pc_vendor`: nomor, nama, status, dan kategori. Tanpa konfirmasi rincian saat "tidak ada lagi".
  - `pc_po`: baris, jumlah per satuannya sendiri, Tgl kirim, persen diterima, dan harga (P1).
  - Pemindaian data pribadi berjalan saat staging, dan nilai temuannya tidak pernah ditampilkan.
- **View (migrasi 085–087):**
  - `pc_po_accurate` dan `pc_po_lines_accurate`: tanpa kolom harga.
  - `pc_po_prices_accurate` dan `pc_po_price_lines_accurate`: hanya dibaca layanan harga dan provider manajemen.
  - Penerimaan milik Warehouse (D4) ditampilkan ulang di bawah Procurement.
  - Migrasi 087 membetulkan pembacaan tanggal: di MySQL 9.6, `CAST(NULLIF(JSON_UNQUOTE(…)) AS DATE)` bernilai NULL.
- **Status PO:** Menunggu barang, Sebagian diterima, Terlambat, Diterima, Ditutup, dan PO lama. Aturannya ada di "Keputusan yang berlaku" di [program-4-divisi.md](program-4-divisi.md).
- **Halaman:**
  - Procurement: Hari ini, Purchase order, Pemasok, dan Data Accurate.
  - Harga, nilai PO, dan nilai 12 bulan hanya tampil untuk `procurement.price.view`.
- **Manajemen:**
  - Eskalasi "PO terlambat datang": ID episode mengikuti tanggal janji, dan tanpa nominal.
  - KPI: PO menunggu barang, dijadwalkan datang 7 hari, nilai PO bulan ini, dan umur data.
  - Metrik: fill rate (per baris, tanpa menjumlah lintas satuan) dan nilai PO.
- **Uji data asli** (di-rollback):
  - 485 perubahan (138 pemasok dan 347 PO), 0 data pribadi, 0 kunci tak terdaftar, 0 kunci harga untuk anggota;
  - 1 PO terlambat, 1 menunggu, 90 PO lama, fill rate 40%;
  - data lain terbukti tidak berubah (checksum).
- **Perbaikan dari tinjauan independen:**
  - satu aturan data pribadi dipakai pembersih nama dan penjaga staging (telepon, e-mail, nomor 10+ digit seperti rekening/NIK/NPWP), sehingga nama yang sudah dibersihkan tidak pernah ditolak; nama yang isinya hanya data pribadi diganti nomor pemasok;
  - batch Procurement hanya diputuskan Head Procurement (pengganti Head MO), sesuai P3, walau nanti ada Supervisor;
  - fill rate pemasok tidak menghitung PO lama.
- **Saklar:** menyala 29 September 2026 pukul 23.23 (`ACCURATE_PROCUREMENT=1`, `ACCURATE_SYNC_SCOPES=sales,warehouse,procurement`). Batch pertama menuju Head Procurement.

## Procurement: saran pesan ulang (dibangun 30 September 2026)

Aturan lengkapnya ada di "Keputusan yang berlaku" di [program-4-divisi.md](program-4-divisi.md). Catatan data dan batasannya:

- **Sumber:**
  - stok total (`wh_stock_total_accurate`); stok per gudang tidak pernah dibaca (D2);
  - keluar per hari dari sumber "hari cukup" Warehouse (`wh_stock_cover_accurate`);
  - PO berjalan dan pemasok/satuan beli terakhir dari view tanpa harga (`pc_po_lines_accurate`, `pc_item_last_po_accurate`, migrasi 089);
  - waktu datang dari penerimaan yang disetujui Warehouse.
- **PO lama tidak dihitung sebagai PO berjalan:** 90 dari 92 PO terbuka adalah PO lama. Sisanya masih tercatat 1.475.726 satuan dasar di 237 barang; bila dihitung, stok yang benar-benar habis tidak akan terlihat. PO lama tetap tampil di baris ("PO lama n, tidak dihitung") supaya ditutup di Accurate.
- **Tgl kirim:** sama dengan tanggal PO pada 341 dari 347 PO, jadi tidak bisa dipakai sebagai waktu datang. Sejak migrasi 098, Tgl kirim yang tidak lebih lambat dari tanggal PO dianggap belum diisi (14 hari, "perkiraan") untuk semua tampilan PO.
- **Harga (hanya `procurement.price.view`):** harga bersih sebelum PPN per satuan beli dihitung dari jumlah baris ÷ jumlah × DPP PO ÷ total baris PO. Dengan cara ini PO harga termasuk pajak (19 dari 347), diskon kepala PO (10 PO), dan diskon yang tidak tercatat di persen diskon (33 baris) ikut terhitung.
- **Batasan yang diketahui:** keluar per hari dihitung dari selisih stok total antar tarikan yang disetujui. Barang yang masuk dan keluar di antara dua tarikan saling menutup, sehingga laju keluar bisa sedikit terlalu rendah. Tindak lanjut Warehouse: laju keluar dari dokumen surat jalan/faktur bila dokumen gudang sudah disetujui.
- **Uji data asli** (batch #10 dan #11 diterapkan di dalam transaksi yang dibatalkan):
  - 658 barang dalam cakupan dan 124 "habis, perlu dicek"; belum ada yang kritis karena riwayat stok baru mulai (laju keluar dihitung mulai 6 Oktober);
  - simulasi riwayat 20 hari: setiap tingkat urgensi keluar persis sesuai rumus;
  - cermin tidak berubah (checksum); halaman dimuat dalam 0,5 detik.
- **Perbaikan tinjauan akhir (migrasi 105, tanpa perubahan data):**
  - **Baris bonus/token tidak dipakai sebagai harga.** Satu PO bisa memuat barang yang sama dua kali: baris berbayar dan baris bonus (MKR-160: Rp 16.000 × 576 dan Rp 2 × 1). Harga terakhir, riwayat harga, dan perkiraan nilai kini memakai aturan yang sama dengan margin (minimal Rp 10 per satuan dasar). "PO terakhir" memilih baris dengan jumlah terbesar. Data asli: MKR-160 kini Rp 16.000 (naik 11,1%), bukan Rp 2 (turun 100%).
  - **Stok minus ikut dieskalasi.** Posisi stok minus dihitung 0, jadi barang kritis tanpa PO dengan stok minus kini masuk eskalasi Procurement, sama dengan KPI-nya. Konteks eskalasi menyebut jumlah barang yang stoknya minus di Accurate.
  - **Tautan eskalasi tepat.** Tautan eskalasi membuka daftar tersaring "Belum ada PO", yang isinya sama persis dengan jumlah di eskalasi. "Perlu dipesan" di Hari ini sama dengan isi daftar Saran pesan ulang.
  - **Kecepatan.** View "hari cukup" hanya membaca 30 hari terakhir. Ditambah satu indeks baru di arsip (`record_type, created_at`); indeks tidak mengubah baris apa pun. Hasil identik dengan cara lama, pada data asli maupun simulasi 30/120/365 hari. Dengan riwayat setahun: daftar saran 17–22 detik → 0,18–0,22 detik, KPI dan eskalasi 6–15 detik → 0,15 detik, lambat laku 3,4–5 detik → 0,26 detik. Waktu tidak lagi bertambah seiring riwayat.

## Target 3.4: SO tepat waktu & lengkap (dibangun 30 September 2026)

- **Sumber:** cermin Sales yang disetujui (status SO dan persen terkirim, surat jalan dan faktur yang menyebut nomor SO), bukan `wh_so_open`, karena SO yang dibuat dan dikirim di antara dua tarikan tidak pernah muncul di sana. View `wh_so_fulfilment_accurate` (migrasi 099).
- **Temuan data:**
  - surat jalan baru dipakai sejak September (68 surat jalan); Januari–Agustus SO diproses langsung dengan faktur, jadi faktur dipakai sebagai bukti kirim bila tidak ada surat jalan;
  - selisih tanggal SO → kirim di September: 30 SO hari yang sama, 30 SO besok, 5 SO H+2, 3 SO lebih lama; tidak ada surat jalan bertanggal Minggu;
  - Accurate mengisi Tgl kirim sama dengan tanggal dokumen; tarikan kering 30 September: hanya 58 SO (HoReCa) yang punya Tgl kirim setelah tanggal SO;
  - batch #9 mengisi mundur 566 SO Februari–Mei, karena itu OTIF dihitung sejak 22 September.
- **MySQL 9.6:** `JSON_TABLE(x.data, '$.so_numbers[*]')` ditolak bila dibaca lewat `accurate_latest`; yang dipakai `JSON_TABLE(JSON_EXTRACT(x.data, '$.so_numbers'), '$[*]')` (dijaga tes).
- **Uji data asli** (batch #9–#11 di-rollback): sejak 22 September 9/9 tepat waktu & lengkap; seluruh September 62/73 (84,9%); rata-rata 0,6 hari sampai terkirim lengkap; view 31 ms.
- **Perbaikan tinjauan akhir (migrasi 103):**
  - "Data sampai" Sales tidak lagi dihitung dari tarikan yang melewati divisi itu (karena batchnya masih menunggu) atau yang batchnya ditolak/ditarik. Uji: setelah #9 diterapkan sementara #12 menunggu, "data sampai" Sales tetap 29 September (sebelumnya melompat ke 30 September).
  - Janji standar yang jatuh pada hari Minggu digeser ke Senin, dan kini ditulis "standar 2×24 jam, digeser ke Senin". Terjadi pada 191 dari 1.231 SO, semuanya SO hari Jumat.

## Pencocokan gudang 3.2 (dibangun 30 September 2026)

- **Yang dicocokkan:** Barang Masuk ↔ penerimaan (dan pindah gudang masuk/penyesuaian masuk bila referensinya menyebutnya); Barang Keluar ↔ surat jalan (dan pindah gudang keluar/penyesuaian keluar). Faktur tidak dipakai: sejak 1 September 68 dari 70 faktur punya surat jalan, dan faktur memuat harga (D1).
- **Batasan MySQL 9.6 yang dijaga:** `REGEXP_REPLACE` menghasilkan LONGTEXT yang tidak bisa diindeks di tabel turunan, jadi kunci di-cast ke CHAR dan digabung jadi satu kunci; `JSON_TABLE` hanya membaca tabel dasar; `GROUP_CONCAT` terpotong di 1.024 karakter, jadi tidak dipakai untuk tanda tangan data.
- **Volume:** tanpa jendela, setahun data (±1.600 dokumen) membuat kueri 1,1–1,6 detik; dengan jendela 180 hari 0,4–0,6 detik dan tidak bertambah lagi.
- **Hari ini:** 0 pergerakan disetujui di aplikasi dan 0 dokumen gudang di cermin (batch #10 hanya berisi stok), jadi tab menjelaskan bahwa ia menunggu batch dokumen gudang.
- **Perbaikan tinjauan akhir (migrasi 104):**
  - **Menunggu data lengkap.** Selisih hanya dinilai bila cermin Warehouse sudah lengkap sampai lewat masa tenggang. "Data sampai" mengikuti aturan yang sama dengan OTIF: tanggal batch Warehouse terakhir yang disetujui selama ada batch menunggu, atau tarikan terakhir yang tidak melewati Warehouse. Grup yang belum bisa dinilai tampil "Menunggu data Accurate" (netral), tidak dieskalasi, dan tidak dihitung di KPI maupun target. Bila data sudah lengkap hari ini, waktu eskalasi tidak berubah.
  - **Satu kejadian per selisih baru.** ID eskalasi memuat episode (`id × 100000 + hari`), jadi selisih baru di grup yang tindak lanjutnya sudah selesai muncul lagi sebagai terbuka.
  - **Kecepatan.** View dibangun ulang dengan CTE yang dihitung sekali, dan eskalasi serta KPI memakai satu query bersama. Hasil view lama dan baru identik (data asli dan volume setahun). Dengan volume setahun: daftar 1,2–1,6 detik → 0,23–0,31 detik; semua eskalasi 2,0–2,3 detik → 0,63–0,71 detik; dengan 2 pengguna bersamaan semua di bawah 1 detik.
  - **Lainnya.** Penjelasan tidak lagi membatalkan penjelasan rekan dengan data yang sama. "Catat sekarang" disembunyikan bila pergerakan dengan referensi yang sama masih menunggu approval. Pergerakan di luar jendela 180 hari ditolak saat dipasangkan dan diberi keterangan yang benar. Kolom tujuan Barang Keluar meminta cabang atau nama customer, tanpa alamat (D5).

## Alur & Margin 3.3 (dibangun 30 September 2026)

- **Alur penjualan:** SO → terkirim lengkap (view 099) → faktur (tanpa uang muka) → lunas (semua faktur lunas; tanggal = penerimaan terakhir). Surat jalan baru dipakai sejak 2 September; sebelumnya faktur sekaligus pengiriman.
- **Perkiraan margin:** pendapatan per baris faktur disebar ke DPP faktur (sama persis dengan `sales_revenue_accurate`); biaya = harga PO bersih sebelum PPN per satuan dasar dari view `pc_po_price_costs_accurate`, yang dibangun dari view harga yang sama dengan saran pesan ulang. Hanya lewat layanan harga beli.
- **Temuan data** (batch #9–#11 di-rollback): margin Januari–September ± 1,3% dengan Maret −1,4% dan April −4,0%. Beberapa barang dibeli hampir di harga jual (MKR-164 Rp 3.001 beli vs Rp 2.952 jual; MKR-412 Rp 119.004 vs Rp 117.171), tanda ada rebate/program prinsipal yang tidak tercatat di PO. Cakupan harga September hanya 25,6% karena banyak kode barang baru belum pernah di-PO.
- **Lambat laku:** 254 dari 255 barang diam ≥ 90 hari adalah kode lama (MKR-), 228 di antaranya belum pernah terjual sejak data penjualan dimulai (2 Januari 2026). Perlu dicek di Accurate apakah stoknya sudah dipindah ke kode baru.

## Aturan tambahan dari kajian

1. **Hanya batch Sales atau Retail Commerce yang mengalihkan angka Sales ke Accurate** (`salesSource.accurateConnected`). Batch Warehouse atau Finance tidak ikut mengalihkannya.
2. **Jumlah terjual tidak pernah dijumlahkan lintas satuan.** Contoh: "6.408 TetraPk + 3 Ctns". Satuan baru digabung setelah rasio satuan barang ditarik.
3. **Harga jual default di Accurate bernilai 0 untuk semua barang**, karena harga disimpan di Kategori Harga. Karena itu kolom "Harga jual" tidak ditampilkan sampai `price_category_view` dan `sellingprice_adjustment_view` masuk.
4. **Sebelum tipe data baru ditarik** (karyawan, pemasok, jurnal):
   - setiap tipe punya daftar kunci data yang boleh disimpan (`dataKeys` di `RECORD_TYPES`, sudah diterapkan dan dites), dan data pribadi tidak pernah masuk arsip, karena arsip hanya bertambah;
   - nama tipe paling panjang 20 karakter (`record_type VARCHAR(20)`);
   - tipe snapshot (saldo, stok) memakai kunci numerik sintetis dan tidak menandai data di luar jendela tarikan sebagai "hilang".
5. **Satu eskalasi untuk satu kejadian** (sudah diterapkan). "Batch menunggu keputusan" memakai satu kunci umum `accurate_batch_pending` (provider manajemen "Data Accurate") yang dibatasi per divisi. `approval_aged` tidak lagi menghitung batch Accurate, jadi tidak ada yang muncul dua kali.
6. **Kartu stok tidak bergantung pada jendela 7 hari.** Riwayat mutasi dipakai selama tersedia. Sumber utamanya tetap dokumen Accurate (penyesuaian, pemindahan, penerimaan, surat jalan, faktur, retur), yang bisa dibaca lengkap, jadi tidak perlu tarikan darurat.
7. **Isi batch Finance, Procurement, dan P&C tidak dikirim ke AI** sebelum owner memutuskan. Tool AI `accurate-batches` saat ini hanya berisi data Sales/RC.

## Keputusan owner yang masih terbuka

Diurutkan menurut tahap yang membutuhkannya.

| Tahap | Keputusan | Rekomendasi |
|---|---|---|
| Warehouse | Apakah Warehouse melihat harga? | Tidak: jumlah dan tanggal saja |
| Warehouse | Siapa pemilik "barang masuk" (`receive-item`)? | Warehouse (1 Head, 2 Supervisor) |
| Procurement | Penyetuju batch (Procurement hanya punya 1 Head) | Head Procurement, dengan pengganti Head Management Office |
| Procurement / Finance | Siapa pemilik faktur pembelian dan pembayaran pembelian? | Finance |
| Finance | Siapa yang boleh melihat buku besar, laba rugi, dan kas? | Finance Supervisor/Head, Management Office, dan Super Admin |
| Finance | Migrasi 012 melarang aplikasi menyimpan jurnal. Apakah arsip Accurate yang hanya dibaca menggantikan larangan itu? | Ya, khusus arsip hanya-baca |
| Finance | Akun gaji, THR, dan pinjaman direksi | Ditampilkan sebagai total saja |
| Sales | Apakah omzet dikurangi retur? Apakah faktur uang muka dikeluarkan? | Ya untuk keduanya |
| Sales / RC | Bagaimana customer intercompany dikenali, dan ke mana GRAB/GOJEK/TikTok diarahkan? | Menunggu data |
| P&C | Kapan data karyawan (field minimal) ditarik, dan siapa penyetujunya? | Saat tahap P&C, disetujui Head P&C |
| Semua | Bolehkah isi batch Accurate non-Sales dibaca Prakasa AI? | Tidak, sampai diputuskan |

## Tahapan

Setiap tahap selesai dengan tes, build, pengecekan headless Chrome, bukti data lama tidak berubah, dan demo ke owner.

1. **Sales & Retail Commerce lengkap:** surat jalan, penerimaan, retur, barang, dan baris faktur. Setelah batch #5/#6 disetujui, semua halaman diperiksa dengan data sungguhan.
2. **Sambung ulang Accurate dengan scope baca tambahan** untuk semua divisi sekaligus (Claude browser), supaya tidak perlu sambung ulang berkali-kali.
3. **Warehouse.**
4. **Procurement:** modul keluar dari "coming soon".
5. **Finance:** modul keluar dari "Segera hadir"; rekonsiliasi piutang.
6. **Management Office dan Marketing:** dashboard dan KPI lintas divisi.
7. **People & Culture** (termasuk GA/operasional), sesuai keputusan owner setelah peta API lengkap.
