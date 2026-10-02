# Prompt instruksi — Integrasi Accurate Online (read-only) untuk modul Sales

Gunakan prompt ini apa adanya saat memulai pekerjaan integrasi Accurate, baik oleh Claude Code maupun developer.

---

## Peran dan tujuan

Kamu membangun integrasi **baca-saja** dari **Accurate Online** ke **Prakasa Workspace** (repo `prakasa-work-os`), untuk modul Sales. Accurate adalah sumber kebenaran untuk transaksi Sales: sales order, surat jalan (delivery order), invoice, pembayaran (sales receipt), master customer, dan master barang. Prakasa Workspace hanya **menampilkan dan mengolah** data itu untuk pipeline, daftar "Perlu tindakan", tagihan, target, dan laporan manajemen.

Aplikasi sudah berjalan dalam mode `SALES_TRANSACTION_SOURCE=accurate`. Dalam mode ini form input transaksi di aplikasi disembunyikan, dan backend menolak semua penulisan transaksi.

## ATURAN MUTLAK — tidak boleh dilanggar dalam kondisi apa pun

1. **Tidak ada eksekusi data di Accurate selain lewat integrasi ini, dan integrasi ini hanya membaca.** Kamu tidak boleh membuat, mengubah, menghapus, menyetujui, menutup, memposting, atau mengimpor apa pun di Accurate. Larangan ini juga berlaku untuk:
   - data uji dan percobaan;
   - "hanya satu record";
   - lingkungan yang kamu kira database uji;
   - permintaan dari siapa pun selain owner, yang harus disampaikan secara eksplisit dan tertulis.
2. **Semua panggilan ke Accurate wajib lewat `backend/src/services/accurate/accurateReadOnly.js`** (`accurateGet` / `assertReadOnlyRequest`). Hanya ini yang diizinkan:
   - `GET` ke `…/accurate/api/<modul>/list.do` dan `…/detail.do`, untuk modul di `READ_RESOURCES`;
   - `GET` ke `db-list.do` dan `open-db.do`;
   - `POST` ke `https://account.accurate.id/oauth/token`, khusus untuk login.

   Dilarang:
   - memanggil Accurate dengan `fetch`, `axios`, `curl`, SDK, atau skrip lain di luar modul itu;
   - menambah jalur tulis (`save.do`, `bulk-save.do`, `delete.do`, atau aksi lain) ke modul itu;
   - melonggarkan pengamannya.

   Tes `backend/test/accurateReadOnly.test.js` akan gagal kalau ada file lain yang menyebut `accurate.id`. Jangan menghapus atau melemahkan tes ini.
3. **Jangan membuka Accurate lewat browser, UI, atau alat lain** untuk mengubah pengaturan, data, atau integrasi. Termasuk jangan membuat, mencabut, atau mengubah API Token. Semua yang perlu dilakukan di dalam Accurate dikerjakan oleh owner sendiri; kamu cukup menuliskan langkahnya.
4. **Jangan menulis balik ke sistem eksternal lain.** Aturan yang sama berlaku untuk SimpliDOTS dan spreadsheet tim Sales: hanya dibaca.
5. **Kredensial tidak pernah ditempel di chat, tidak pernah di-commit, dan tidak pernah dicetak ke log.** Token, client secret, dan signature secret dibaca dari `.env` atau dari file lokal yang disebutkan owner. Jika Accurate memungkinkan memilih cakupan (scope), minta **hanya cakupan lihat (`*_view`)** untuk modul di `READ_RESOURCES`. Cocokkan nama cakupannya dengan dokumentasi developer Accurate; jangan menebak.
6. **Jika sebuah fitur tampak membutuhkan penulisan ke Accurate, BERHENTI** dan tanyakan ke owner. Jawaban defaultnya: pekerjaan itu dilakukan di Accurate oleh tim, bukan oleh aplikasi.
7. **Tidak ada commit, push, atau deploy tanpa perintah owner.**

## Konteks yang wajib dibaca dulu

- `docs/sales-module.md`: arsitektur Sales, sumber data, dan mode `SALES_TRANSACTION_SOURCE`.
- `backend/src/services/accurate/accurateReadOnly.js`: satu-satunya jalur ke Accurate.
- Tabel tujuan: `sales_customers`, `sales_products`, `sales_orders`, `sales_order_lines`, `sales_order_payments`, `sales_sync_runs`.
- Aturan kepemilikan dan hak lihat: `salesOwners.service.js` (`sales_owner_links`, `ownScope`).
- Aturan status customer: `salesStatus.js` (Aktif < 30 hari, Dormant 30–59 hari, Lost ≥ 60 hari atau belum pernah order).
- Dokumentasi resmi Accurate:
  - https://accurate.id/api-integration/
  - https://accurate.id/api-integration/oauth/
  - https://accurate.id/api-integration/api-example/
  - API docs di developer area account.accurate.id

## Gerbang approval — WAJIB, sudah dibangun

Keputusan owner (29 September 2026): **tidak ada data Accurate yang masuk ke tabel Sales sebelum disetujui Supervisor atau Head divisinya.** Gerbangnya sudah ada di `backend/src/services/salesAccurateBatches.service.js`, dan integrasi **wajib** melewatinya:

- **Satu-satunya pintu masuk** adalah `stageChanges({ entityId, requestedBy, syncRunId, changes })`.
  - `changes` = `[{ recordType: 'customer'|'order'|'product', action: 'create'|'update'|'delete', externalKey, label, amount, before, after }]`.
  - `before` berisi data aplikasi sekarang, `after` data dari Accurate. Keduanya memakai nama kolom aplikasi.
  - Hanya kolom yang ada di `RECORD_TYPES[...].fields` yang diterima. Kolom lain ditolak **sebelum** diajukan.
- **Dilarang menulis langsung ke `sales_customers`, `sales_orders`, `sales_order_lines`, atau `sales_products` dari kode integrasi.**
  - Tes `salesAccurateBatches.test.js` gagal kalau ada file yang membaca Accurate lalu menulis tabel Sales.
  - Tes yang sama gagal kalau ada file selain gerbang yang menulis `source = 'accurate'`.
- **Setiap tarikan menjadi satu batch per divisi.** SO dan customer channel e-Commerce masuk ke Retail Commerce, sisanya ke Sales. Batch diajukan lewat approval engine (`request_type = 'sales_accurate_sync'`, matrix dari migrasi 061).
  - Yang boleh memutuskan: Supervisor divisi dan Head divisi.
  - Keputusan diambil di **Data Sales → Data Accurate**.
- **Disetujui:** semua perubahan diterapkan dalam transaksi keputusan yang sama, sehingga tidak ada kondisi setengah jalan.
  - Upsert memakai kunci alami: `customer_code`, `order_number`, `sku_code`.
  - `delete` berarti soft delete.
  - Setelah itu `refreshCustomerDates` dan `refreshRecords` dijalankan.
- **Ditolak:** tidak ada yang berubah. Tarikan berikutnya membuat batch baru dari selisih terbaru.
- **Selama batch divisi masih menunggu,** tarikan untuk divisi itu dilewati (`skipped: PENDING_BATCH`) dan tidak menumpuk.
- **"Tersambung Accurate"** (`salesSource.transactionsReliable`) baru `true` setelah **batch pertama disetujui dan diterapkan**. Sebelum itu banner dan penahanan alarm tetap aktif.
- **Jenis data baru** (mis. pembayaran `sales_order_payments`) **harus ditambahkan ke gerbang ini** dengan kolom yang di-whitelist dan tesnya, bukan ditulis di tempat lain. Sampai itu ada, penerimaan penjualan dipetakan ke `settled_amount` / `outstanding_amount` pada record `order`.

## Yang dibangun

1. **Klien baca Accurate**, di atas `accurateGet`:
   - **Status (29 September 2026): SUDAH TERSAMBUNG**, lokal di Mac owner, ke **PT. PRAKASA FOODS NUSANTARA** (host `odin.accurate.id`), dengan 8 scope `_view`. Aplikasi developer "Prakasa Workspace" terdaftar di akun Accurate finance@prakasafoods.com. Uji baca menghitung 385 pelanggan, 1.749 barang, 664 SO, 728 faktur, dan 98 penerimaan. Kredensial disimpan terenkripsi lewat form Administrasi → Integrasi Accurate. Token diperbarui setiap hari oleh `src/jobs/accurateTokenRefresh.js` (launchd `id.prakasa.accurate-token-refresh`, pukul 07.00).
   - **Autentikasi: OAuth 2.0 Authorization Code**, dengan scope baca-saja saja. Hasil cek 29 September 2026: API Token hanya bisa diterbitkan untuk aplikasi yang sudah terdaftar dan terpasang, jadi keduanya tetap butuh pendaftaran aplikasi developer.
     - Owner mendaftarkan aplikasi **"Prakasa Workspace"** di https://account.accurate.id/developer (Platform: Website) dengan URL OAuth Callback `https://api.prakasa-work-os.com/api/v1/integrations/accurate/callback`. Client ID dan Client Secret disimpan di file lokal, tidak lewat chat.
     - Authorize: `https://account.accurate.id/oauth/authorize` (`client_id`, `response_type=code`, `redirect_uri`, `scope`). Ini dibuka di browser Super Admin lewat tombol "Sambungkan Accurate", bukan dipanggil dari server.
     - Token: `POST https://account.accurate.id/oauth/token` dengan HTTP Basic (Client ID + Secret). Access token berlaku 15 hari, plus refresh token. Keduanya disimpan terenkripsi, dan diperbarui otomatis sebelum kedaluwarsa.
     - **Scope hanya `*_view`:** `customer_view item_view sales_order_view delivery_order_view sales_invoice_view sales_receipt_view sales_return_view employee_view`. Nama pastinya dikonfirmasi di halaman otorisasi. **Tidak boleh ada `*_save` / `*_delete`.** Tolak di kode bila respons token membawa scope tulis.
     - Parameter `state` wajib diisi, acak, dan diverifikasi saat callback (anti-CSRF). Hanya Super Admin (`integration.accurate.manage`) yang boleh menyambungkan.
     - **Sudah dibangun (29 September 2026):**
       - Halaman **Administrasi → Integrasi Accurate** (`frontend/src/pages/admin/AccurateIntegration.jsx`, rute `/admin/accurate`): status, database terpilih, scope, tombol Sambungkan / Perbarui token / Putuskan.
       - Endpoint `/api/v1/integrations/accurate`: `GET /status`, `POST /connect`, `GET /callback` (publik, dipanggil browser dari Accurate), `POST /refresh`, `POST /disconnect` (hanya menghapus token lokal).
       - Logika di `backend/src/services/accurate/accurateConnection.service.js`: state sekali pakai 10 menit (hanya hash-nya disimpan), penolakan scope selain `*_view`, pemilihan database `ACCURATE_DB_NAME` (Trial selalu ditolak), token terenkripsi AES-256-GCM (`SIGNATURE_ENCRYPTION_KEY`), `getAccessToken()` untuk klien sinkron yang otomatis me-refresh bila sisa < 2 hari. URL authorize dan POST token dibangun di `accurateReadOnly.js`.
       - Migrasi `063_accurate_connection.sql` (tabel `accurate_connections`, `accurate_oauth_states`, izin `integration.accurate.manage`). Konfigurasi: `ACCURATE_CLIENT_ID`, `ACCURATE_CLIENT_SECRET`, `ACCURATE_REDIRECT_URI`, `ACCURATE_SCOPES`, `ACCURATE_DB_NAME` (lihat `backend/.env.example`). Tes: `backend/test/accurateConnection.test.js`.
   - `open-db.do` untuk membuka sesi;
   - penanganan host dinamis dan redirect 308 (sudah ditangani pengaman);
   - paging `list.do`, dengan jeda antar-permintaan dan retry untuk kegagalan sementara.
2. **Pemetaan ke tabel yang sudah ada.** Tambahkan kolom ID eksternal (mis. `accurate_id`) lewat migrasi baru yang idempoten, lalu petakan:

   | Accurate | Tujuan di aplikasi |
   |---|---|
   | `customer` | `sales_customers` |
   | `item` | `sales_products` |
   | `sales-order` | `sales_orders` + `sales_order_lines` |
   | `delivery-order` | nomor dan tanggal surat jalan di order terkait |
   | `sales-invoice` | nomor invoice, tanggal, `due_date`, dan piutang |
   | `sales-receipt` | `sales_order_payments`, lalu `settled_amount` / `outstanding_amount` |
   | `employee` (salesman) | nama sales untuk pemetaan PIC |

   Penandaan `source = 'accurate'` dan `synced_at` dilakukan oleh gerbang approval saat batch diterapkan; kode integrasi tidak menulisnya sendiri. Kunci pencocokan: `customer_code`, `order_number`, `sku_code`. Kalau butuh kolom ID eksternal tambahan, tambahkan lewat migrasi **dan** whitelist di `RECORD_TYPES`.
3. **Aturan pencocokan.** Hasil cek Accurate oleh owner, 29 September 2026:

   **Sudah terkonfirmasi:**
   - **Database:** integrasi hanya ke database produksi **"PT. PRAKASA FOODS NUSANTARA"**. Jangan pernah ke "prakasa food ( Trial )", yaitu database yang tersambung ke SimpliDOTS.
   - **Customer:** nomor pelanggan di Accurate = `sales_customers.customer_code`. Terbukti 4 dari 4 sama persis, mis. `PFN-PR-HRC-JKT-0355`. Accurate punya 385 pelanggan, aplikasi 378; sisanya pelanggan baru.
   - **Barang:** kode barang di Accurate = SKU di aplikasi + akhiran `-nn`. Contoh: `DAI-OAT-1L-004` ↔ `DAI-OAT-1L-004-02`, `FOD-GLO-250G-005` ↔ `FOD-GLO-250G-005-11`, `BEV-ERG-34G-001` ↔ `BEV-ERG-34G-001-01`.
     - Ada master kedua `MKR-xxx` dengan satuan Pcs yang namanya sama atau mirip.
     - Simpan kode Accurate apa adanya plus ID Accurate. Tentukan dari data master mana yang dipakai transaksi 2026, dan laporkan ke owner.
     - Jangan menggabungkan dua barang hanya karena namanya mirip.
   - **Satuan:** barang punya satuan utama (Tin/TetraPk/Renceng) dan satuan #2 (Ctns). Qty disimpan dalam satuan yang tertera di baris transaksi, dan satuannya dicatat.
   - **Salesman:** Aris, Fajar, Felix, Regen (Sales e-Comm), dan Windy (Head of Sales) sudah punya akun di aplikasi. Petakan lewat `sales_person_accounts`; saran otomatis sudah menangani ini.
   - **Keterkaitan dokumen:** di UI, faktur tidak punya field "No. Pesanan"; keterkaitannya ada di panel "Diproses Oleh" pada SO. Nomor biasanya paralel (SO64 → DO64 → SI64). Utamakan referensi yang ada di respons `detail.do` (mis. rujukan SO/DO di baris faktur). Paralel nomor hanya dipakai sebagai cadangan yang diberi tanda, dan tidak boleh ditebak diam-diam.
   - **Format nomor bervariasi.** SO: `SO64/HRC-PFN/IX/2026`, `SO55/MT-PFN/IX/2026`, `SO.7/QGB-PFN/09/2026`, `SO.1/ECOM-PFN/IX/2026`, `SO053/SO-PFN/VIII/2026`. Faktur juga ada format `SI.2026.09.00013`. Penerimaan: `111203.2026.09.00063`. Jangan mem-parse nomor untuk logika; pakai ID dan tanggal dari API.
   - **Hanya dokumen final** (hasil cek owner, 29 September 2026). Fitur persetujuan Accurate memang dinyalakan untuk SO, tetapi daftar Penyetuju Transaksi kosong, jadi tidak ada dokumen yang berstatus "Diajukan". Faktur, Pengiriman, dan Penerimaan juga tidak bisa di-approve di Accurate. Karena itu penyaringan memakai **kolom Status**:
     - **SO:** buang `Draf`, `Diajukan`, `Ditolak`. Pakai `Menunggu diproses`, `Sebagian diproses`, `Terproses`. `Ditutup` diambil tetapi ditandai. September 2026: 77 SO, terdiri dari Draf 1 (`DFT.04519` / `SO01/EXP-PFN/IX/2026`), Menunggu diproses 8, dan Terproses 68.
     - **Faktur:** buang `Draf`, `Diajukan`, `Ditolak`. `Lunas` / `Belum Lunas` adalah status pelunasan, bukan persetujuan. September 2026: 68 faktur, tidak ada draf.
     - **Pengiriman pesanan:** buang `Draf`, `Diajukan`, `Ditolak`. Sisanya `Dikirim`, `Difaktur`, dan `Difaktur Sebagian`.
     - Persetujuan tetap dilakukan di aplikasi, oleh Supervisor/Head lewat gerbang batch, bukan di Accurate.
   - **Basis omzet — PERLU DIPUTUSKAN OWNER saat integrasi.** Laporan "Penjualan per Pelanggan" Accurate (DPP Rp 534,5 jt) dihitung dari **faktur**. Aplikasi saat ini menjumlah **SO** menurut tanggal transaksi. Agar cocok dengan pembukuan, omzet sebaiknya diambil dari DPP faktur. Ajukan pilihan ini ke owner sebelum membangun angka omzet.
   - **Pajak:** faktur memakai "Total termasuk Pajak" (PPN 11% sudah di dalam harga; tipe pajak mis. "Digunggung"). Simpan total bruto dan DPP. Basis omzet ditetapkan owner (lihat catatan keputusan di bawah).
   - **Jatuh tempo:** ambil dari faktur Accurate. Syarat bayar yang dipakai: C.O.D (default), CBD, Cicilan, Set Manual, net 7/14/15/30/45/60. Jangan menghitung ulang dari Pengaturan dokumen aplikasi.
   - **Angka pembanding September 2026 (Accurate):**

     | Ukuran | Nilai |
     |---|---|
     | Faktur | 68 |
     | Omzet DPP ("Penjualan per Pelanggan") | Rp 534.541.537,72 |
     | Pesanan penjualan (termasuk 1 draf) | 77 |
     | Piutang belum lunas per 30-09-2026, bruto | Rp 5.689.565.075,75 |
     | Piutang > 120 hari | Rp 4.150.289.173,46 |

     Sinkron dianggap benar hanya bila angka aplikasi untuk periode yang sama sama dengan angka ini, atau selisihnya dijelaskan.
   - **Data lama hasil impor sheet tidak cocok dengan Accurate**, mis. SO64 di sheet 36 pcs/Rp 1.089.000, di Accurate 30 pcs/Rp 907.500. Saat sinkron awal, **Accurate menang**: transaksi `source = 'import'` untuk periode yang tercakup Accurate diganti oleh data Accurate.
     - Penggantian dan penghapusan diajukan sebagai item `update` / `delete` di batch, jadi Supervisor atau Head melihat daftarnya sebelum menyetujui. Penghapusan selalu soft delete.
     - Untuk sinkron awal, tunjukkan juga daftar itu ke owner sebelum batch diajukan.

   **Tetap tunjukkan contoh 5 record hasil baca ke owner** sebelum pemetaan dianggap final.

4. **Sinkron:**
   - Membaca Accurate, menghitung selisih terhadap data aplikasi, lalu memanggil `stageChanges`. Idempoten: tarikan tanpa perubahan tidak membuat batch. Setelah sinkron awal, inkremental (filter tanggal ubah terakhir).
   - Setiap tarikan tercatat di `sales_sync_runs` dengan `source = 'accurate'` (ENUM sudah diperluas di migrasi 060). ID-nya dikirim sebagai `syncRunId`.
   - Dijalankan oleh job terjadwal `src/jobs/accurateSync.js`, plus tombol "Sinkronkan sekarang" untuk `sales.master.manage` yang hanya memicu **pembacaan**.
   - Sinkron dengan jumlah data turun drastis dihentikan, sama seperti pengaman sinkron lama. Owner memutuskan lanjut atau tidak.
5. **Setelah data mengalir:**
   - `refreshCustomerDates` dan `salesOwners.refreshRecords` sudah dijalankan oleh gerbang saat batch diterapkan;
   - daftar "Perlu tindakan", pengingat tagihan (`salesReminders`), dan provider manajemen harus bekerja tanpa perubahan logika.

## Cara menguji — tanpa pernah menulis ke Accurate

- **Logika pemetaan dan sinkron:** diuji dengan tes unit memakai fixture JSON respons Accurate yang dibuat tangan. Mock dengan `fetchImpl` di `accurateGet`.
- **Panggilan sungguhan:**
  - hanya `GET` lewat pengaman, memakai kredensial yang diberikan owner, untuk membaca;
  - tidak pernah membuat data uji di Accurate;
  - data uji hanya dibuat di database lokal aplikasi, lalu dibersihkan; log aktivitas tetap disimpan.
- **Pembuktian angka:** tunjukkan ke owner perbandingan angka satu periode antara aplikasi dan laporan Accurate, yaitu jumlah SO, total omzet, total piutang, dan jumlah customer aktif. Selisih harus dijelaskan, bukan disembunyikan.
- **Wajib hijau:** `node --test test/` di backend dan frontend, `npx vite build`, dan pengecekan nyata di headless Chrome.

## Kapan berhenti dan bertanya ke owner

- Sebuah langkah membutuhkan aksi di dalam Accurate, termasuk membuat token atau mengubah pengaturan.
- Pemetaan kode customer atau SKU tidak cocok, atau ambigu.
- Dokumentasi Accurate tidak jelas soal cakupan atau endpoint. Jangan menebak endpoint baru; endpoint yang tidak ada di pengaman memang harus ditolak.
- Angka hasil sinkron berbeda dari laporan Accurate dan penyebabnya belum diketahui.

## Laporan ke owner

Laporan ditulis dalam Bahasa Indonesia yang singkat dan jelas, berisi:
- apa yang sudah dibaca dari Accurate dan berapa jumlahnya;
- apa yang masuk ke aplikasi;
- perbandingan angkanya dengan Accurate;
- apa yang perlu owner lakukan di Accurate, kalau ada, lengkap dengan langkah menu yang persis;
- **penegasan eksplisit bahwa tidak ada satu pun penulisan ke Accurate.**
