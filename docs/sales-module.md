# Modul Sales

Divisi Sales berisi empat modul: **Customers, Leads, Sales Pipeline, dan Data Sales**. Aplikasi ini adalah layar kerja dan lapisan manajemennya; sistem operasionalnya adalah **Accurate** (transaksi & pembukuan) dan **SimpliDOTS** (kunjungan lapangan).

## Sumber data

| Data | Sumber kebenaran | Cara masuk ke aplikasi |
|---|---|---|
| SO, surat jalan, invoice, pembayaran, master produk | **Accurate** | Integrasi API / impor berkala (tahap berikutnya); sementara ini data awal hasil impor |
| Kunjungan lapangan | **SimpliDOTS** + form di aplikasi | *Leads → Impor SimpliDOTS* (export "DailyVisits", idempoten) dan form "Catat kunjungan" untuk kunjungan di luar rute |
| Customer, lead, pemetaan sales, target | Aplikasi | Diinput langsung |

Mode transaksi diatur lewat env `SALES_TRANSACTION_SOURCE`:

- **`accurate`** (aktif sekarang): form input SO/surat jalan/invoice/pembayaran, edit produk, dan cetak dokumen **disembunyikan**; backend menolak tulisnya (409 `SOURCE_ACCURATE`, guard di `salesSource.js`). Aplikasi read-only untuk transaksi supaya tidak ada dua versi pembukuan.
- **`app`**: semua form input dan cetak kembali aktif (perilaku sebelum Accurate). Kodenya tidak dihapus.

Tidak ada satu pun tulisan balik ke Accurate, SimpliDOTS, maupun spreadsheet tim — aturan lama tetap berlaku. Satu-satunya jalur ke Accurate adalah `backend/src/services/accurate/accurateReadOnly.js` (hanya `GET list.do/detail.do` untuk modul Sales); tes `accurateReadOnly.test.js` menolak jalur lain. Prompt instruksi untuk membangun integrasinya: [`docs/prompts/integrasi-accurate.md`](prompts/integrasi-accurate.md). Penyambungan OAuth (hanya scope `*_view`, database produksi saja, token terenkripsi) sudah ada di **Administrasi → Integrasi Accurate** (`/admin/accurate`, izin `integration.accurate.manage`, khusus Super Admin); klien sinkronnya belum. Sinkron ke rekap manual (Sales Data Tracker Google Sheet) sudah dihapus dan tidak akan dihidupkan lagi; data lamanya tersimpan sebagai data awal (`source = 'import'`).

### Data Accurate: dibaca, disetujui divisi, disimpan terpisah

Keputusan owner (29 Sep 2026), dengan penegasan **"TEGAS"**: tidak ada perubahan atau penghapusan data apa pun, baik di Accurate maupun di data lama aplikasi.

1. **Tarik (hanya baca).** Tombol *Data Sales → Data Accurate → Tarik sekarang*, atau `node src/jobs/accurateSync.js` (tambahkan `--dry-run` untuk hanya membandingkan tanpa menulis apa pun). Yang diambil hanya dokumen **final**: SO dan faktur berstatus Draf/Diajukan/Ditolak dibuang. Detail faktur (salesman, tautan SO) hanya dibaca untuk faktur yang baru atau berubah. Kalau jumlah data tiba-tiba turun drastis, tarikan dihentikan. Kodenya ada di `services/accurate/accurateSync.service.js`.
2. **Batch per divisi.** Channel dibaca dari **kode pelanggan** (`PFN-xx-SHP-…` → Shopee), karena kategori Accurate tidak konsisten. Shopee/Tokopedia masuk ke Retail Commerce, sisanya ke Sales. Batch diajukan lewat approval engine (`sales_accurate_sync`, migrasi 061). Yang memutuskan adalah **Supervisor atau Head** divisi; Head memegang langkah yang sama sejak awal.
3. **Disetujui = hanya menambah.** Isi batch disimpan di `accurate_records` (migrasi 066) sebagai **baris versi baru**. Perubahan di Accurate menjadi versi berikutnya. Dokumen yang hilang atau tidak lagi final di Accurate menjadi versi baru bertanda `missing`. **Tidak pernah ada UPDATE atau DELETE** pada tabel ini, dan **tidak ada penulisan ke `sales_customers`, `sales_orders`, `sales_leads`, atau `sales_owner_links`**. Tes `salesAccurateBatches.test.js` menjaga aturan ini.
4. **Ditolak:** tidak ada yang berubah. Tarikan berikutnya membawa selisih terbaru.
5. **Satu batch menunggu per divisi.** Tarikan berikutnya untuk divisi itu dilewati sampai batch yang ada diputuskan. Batch yang menunggu lebih dari 1 hari masuk eskalasi manajemen.

**Tahapan:**
- **Tahap A (selesai, 29 Sep 2026):** tarik → batch → arsip Accurate.
- **Tahap B (selesai, 29 Sep 2026; aktif otomatis begitu batch pertama disetujui):** angka Sales membaca view dari data Accurate yang sudah disetujui (migrasi 067/069, `services/salesFacts.js`):
  - **Omzet (sebelum PPN) = total faktur − PPN.** Terverifikasi: 68 faktur September = Rp 534,46 jt, dibanding laporan "Penjualan per Pelanggan" Rp 534,54 jt. `dppAmount` Accurate adalah DPP pajak e-Faktur dan kosong untuk sebagian besar faktur, jadi hanya disimpan sebagai keterangan.
  - **Status customer** (Aktif/Dormant/Lost, NOO) dari tanggal faktur Accurate.
  - **Piutang dan tagihan terlambat** dari sisa per faktur (`primeOwing`). Catatan terbuka: jumlahnya Rp 6,24 M, sedangkan laporan umur piutang Accurate Rp 5,69 M. Selisihnya kemungkinan dari penerimaan atau uang muka yang belum dialokasikan ke faktur, dan perlu dicek bersama Finance.
  - **Salesman:** dari faktur; kalau kosong (609 dari 728 faktur), dipakai nama sales customer yang sudah ada di aplikasi.
  - **Data Sales:** tab Sales order (dengan faktur terkait dan % terkirim), Surat jalan, Faktur, Penerimaan (faktur yang dibayar, kas/bank), Retur, dan Produk (omzet serta qty per produk dari baris faktur, sesuai periode; tanpa ongkir atau biaya lain di tingkat faktur, selisihnya ±0,05%). Pipeline menampilkan **Produk terlaris bulan ini**. Migrasi 070/071. Perlu tindakan: "Belum terkirim" (SO < 100% terkirim) dan "Tagihan terlambat" dari faktur. Target, pengingat (log `accurate_invoice_reminders`), dan dashboard manajemen (eskalasi `sales_accurate_invoice_overdue`) ikut membaca data yang sama.
  - Data lama tetap tersimpan sebagai arsip dan tidak dipakai lagi untuk angka.
- **Batch tarikan pertama:**
  - #3/#4 **ditarik kembali** oleh pengaju karena pemetaan omzet salah. Keduanya tetap tersimpan dengan status "Ditarik kembali".
  - #5/#6 juga ditarik kembali, karena diganti tarikan lengkap yang menambahkan barang, surat jalan, penerimaan, retur, dan baris faktur, supaya approver cukup memutuskan sekali.
  - Yang sekarang menunggu keputusan: **#7 Sales (3.655)** dan **#8 Retail Commerce (40)**.
  - Kegagalan jaringan sesaat di tengah tarikan dicoba ulang otomatis (maksimal 4 kali, dengan jeda bertahap).
  - Retail Commerce belum punya Supervisor/Head, jadi **Head Sales memutuskan sebagai pengganti** (`FALLBACK_DECIDER_ROLE`) sampai divisi itu punya penyetuju sendiri.

### Selama Accurate belum tersambung

Keputusan owner (29 Sep 2026): angka transaksi yang ada sekarang masih data lama dari rekap dan jauh dari pembukuan. Contohnya September: aplikasi mencatat 64 SO dengan DPP ± Rp 97,7 jt, sedangkan Accurate mencatat 77 SO dengan DPP Rp 534,5 jt. Karena itu, sampai data Accurate masuk:

- **Ditandai.** Customers, Sales Pipeline, Data Sales, detail customer dan detail order menampilkan banner kuning "Belum tersambung Accurate — angka transaksi belum lengkap". KPI Sales di dashboard manajemen diberi keterangan yang sama, tanpa tanda merah.
- **Ditahan.** Selama belum tersambung, alarm berikut tidak jalan:
  - job pengingat dormant/tagihan (log: "ditahan: transaksi belum tersambung Accurate");
  - badge menu (0);
  - eskalasi Sales ke manajemen (kosong);
  - warna mendesak di "Perlu tindakan". Daftarnya tetap tampil, dengan catatan "Dari data lama".
- **Lepas sendiri.** Tahap B sudah aktif (`NUMBERS_FROM_ACCURATE = true`), jadi begitu batch pertama disetujui, banner hilang, pengingat dan badge aktif, dan angka membaca Accurate. Dicek di `salesSource.transactionsReliable()`. Di mode `app` kondisinya selalu tersambung.

## Omzet = DPP (sebelum PPN)

Omzet di semua tempat dihitung dari `sales_orders.dpp_amount`, yaitu nilai sebelum PPN, sama dengan laporan *Penjualan per Pelanggan* di Accurate. Ini berlaku untuk KPI, grafik per bulan, omzet per sales, ringkasan Data Sales, target, dan dashboard manajemen.

- Harga sudah termasuk PPN, jadi DPP baris kena pajak = total / 1,11, dan baris tidak kena pajak = totalnya.
- Ongkos kirim tidak termasuk omzet.
- `total_amount` tetap berisi nilai yang ditagih ke customer, dan dipakai untuk invoice dan piutang.
- Migrasi 059 mengisi DPP untuk data lama. Order baru (mode `app`) menghitungnya di `computeOrder`.

## Alur kerja

| Modul | Yang dilakukan di aplikasi |
|---|---|
| Leads | Impor kunjungan SimpliDOTS, tambah outlet & catat kunjungan manual, tandai tidak berminat, lalu **Jadikan customer** |
| Customers | Tambah dan edit customer. ID pelanggan dibuat otomatis. Status Aktif / Dormant / Lost dihitung sendiri |
| Data Sales | Memantau SO, surat jalan, invoice, piutang & jatuh tempo (dicatat di Accurate). Dalam mode `app`: input SO, surat jalan, invoice, pembayaran, dan kelola SKU |
| Sales Pipeline | Tidak diinput. Tahapnya dihitung dari kunjungan dan order |

## Perlu tindakan, badge, dan notifikasi

- **Perlu tindakan hari ini**, di bagian atas Sales Pipeline, berisi daftar kerja per jenis. Setiap baris punya satu tombol aksi, dan tautan `?aksi=` langsung membuka dialognya.

  | Jenis | Tombol aksi |
  |---|---|
  | Customer dormant | Telepon |
  | SO belum ada surat jalan (30 hari terakhir) | Buat surat jalan |
  | Tagihan lewat jatuh tempo | Catat pembayaran |
  | Lead belum dikunjungi 14 hari atau lebih | Catat kunjungan |

  Aturannya ada di `salesActions.service.js`.
- **Badge** di menu Sales Pipeline menghitung yang mendesak saja: dormant, belum ada surat jalan, dan tagihan terlambat. Badge ditahan (0) selama Accurate belum tersambung. Lead tidak ikut dihitung, karena canvassing menyisakan banyak lead dan badge akan selalu 99+.
- **Notifikasi lonceng** (hanya di dalam aplikasi):

  | Event | Kapan dikirim |
  |---|---|
  | `sales.assigned` | Supervisor menjadikan seseorang PIC customer atau lead |
  | `sales.customer_dormant` | Customer mencapai 30 hari tanpa order, lalu lagi di hari ke-50 |
  | `sales.invoice_overdue` | Invoice lewat jatuh tempo, lalu lagi di hari ke-30 |

  Job harian: `node src/jobs/salesDormantReminder.js`.

## Jatuh tempo dan tagihan

- Dalam mode `accurate`, nomor surat jalan/invoice, jatuh tempo, dan pembayaran akan terisi dari integrasi Accurate (tahap berikutnya); sampai integrasi terpasang, kolom-kolom itu kosong untuk order baru.
- Dalam mode `app`, jatuh tempo ditetapkan saat invoice dibuat, dengan urutan:
  1. tanggal yang dipilih di form invoice;
  2. kalau tidak dipilih, tanggal invoice + termin di Pengaturan dokumen;
  3. kalau termin juga belum diatur, invoice tidak punya jatuh tempo.
- Jatuh tempo disimpan di `sales_orders.due_date`, jadi tidak ikut berubah kalau termin diubah belakangan.
- Data Sales punya filter "Terlambat bayar" dan kolom jatuh tempo.
- Invoice yang terlambat lebih dari 30 hari menjadi eskalasi `sales_invoice_overdue` di manajemen. KPI "Tagihan terlambat" ada di dashboard.

## Order lagi (mode `app` saja)

Tombol **Order lagi** ada di detail customer dan di detail SO. Tombol ini membuka form dengan barang dan harga dari order sebelumnya (`/sales/orders/new?customer=&dari=`). Saat memilih produk, harganya otomatis memakai harga terakhir yang dibayar customer itu.

## Target per sales

Supervisor mengisi target bulanan omzet dan customer baru (NOO) per akun (`sales_person_targets`). Realisasinya dihitung dari order dan customer milik akun itu, dengan kepemilikan yang sama seperti hak lihat data. Sales Member hanya melihat baris dirinya sendiri.

## Cetak dokumen (mode `app` saja)

Sales Order, Surat Jalan, Invoice, dan Kwitansi (per pembayaran) dicetak dari halaman detail SO atau dari tab Surat Jalan/Invoice di Data Sales.

- Halaman cetaknya adalah `/print/sales/{so|do|invoice|receipt}/:id`, ukuran A4, dan bisa disimpan sebagai PDF lewat dialog cetak browser.
- Kepala dokumen memakai kop surat divisi pemilik order kalau sudah diunggah. Kalau belum, dipakai logo dan data perusahaan dari *Data Sales → Pengaturan dokumen*: nama, alamat, telepon, NPWP, rekening, jatuh tempo, dan catatan.
- Isian yang kosong tidak ikut dicetak.
- Surat jalan tidak menampilkan harga. Invoice menampilkan terbilang, jatuh tempo, sisa tagihan, rekening, dan cap LUNAS bila sudah lunas.

## Penomoran otomatis (SO/DO/SI hanya dipakai di mode `app`; kode customer & lead selalu)

Semua nomor bisa diubah di form. Aturannya ada di `backend/src/services/salesNumbers.js`:

- **Customer:** `PFN-{PR|PT|CV|IN}-{GT|HRC|MT|SHP|TPD|GM|GO|EXP}-{kota}-{urut 4 digit}`
- **Lead:** `PFN-CS-{yymm}{urut 5 digit}`
- **Sales order:** `SO{n}/{HRC-PFN|MT-PFN|SO-PFN}/{bulan romawi}/{tahun}`. Nomor `n` berjalan per bulan untuk semua prefix
- **Surat jalan dan invoice:** sama dengan nomor SO, dengan `SO` diganti `DO` atau `SI`

## Aturan data

- **Total order** = barang + ongkos kirim. PPN 11% untuk baris yang kena pajak dicatat terpisah, sama seperti data impor.
- **Pembayaran** mengurangi piutang baris demi baris. Pembayaran tidak boleh melebihi sisa piutang, dan setiap pembayaran tersimpan di `sales_order_payments`.
- **Order yang sudah ditagih atau dibayar** tidak bisa diubah. Order yang sudah ada pembayarannya tidak bisa dibatalkan. Customer yang punya order tidak bisa dihapus.
- **Status customer** mengikuti tanggal order terakhir:
  - Tanggal order terakhir adalah yang paling baru di antara order di aplikasi dan tanggal hasil impor (`last_order_import`).
  - Kurang dari 30 hari: Aktif. 30–59 hari: Dormant. 60 hari atau lebih, atau belum pernah order: Lost.
  - Aturannya ada di `salesStatus.js`.
- **Divisi:** order channel e-Commerce masuk Retail Commerce, selain itu Sales. Customer mengikuti divisi order terakhirnya.

## Siapa melihat apa

- `sales.data.view_all` (Supervisor/Head Sales, Retail Commerce, Marketing, Super Admin) melihat semua data.
- Tanpa izin itu, Sales Member hanya melihat datanya sendiri. Batasan ini berlaku di semua halaman, API, dan pencarian global. Data milik sendiri adalah:
  - data yang PIC-nya dia (data baru otomatis menjadi milik pembuatnya);
  - data impor yang nama sales-nya dipetakan ke akunnya di *Customers → Pemetaan sales*.
- `sales.order.manage`: input order, surat jalan, invoice, dan pembayaran.
- `sales.master.manage`: kelola produk dan pemetaan nama sales.

## Pagination

Semua daftar Sales diambil per halaman dari server, dengan `page` dan `limit` (default 25, maksimal 100). Pencarian `q` juga dijalankan di server. Endpoint yang memakai aturan ini:

- `/sales/customers`, `/sales/leads`, `/sales/orders`, `/sales/documents`, `/sales/products`
- `/sales/funnel` (per tahap)
- `/sales/customers/:id/visits` dan `/sales/customers/:id/activity`

## Ke manajemen

Provider `backend/src/management/providers/sales.js` menyediakan:

- **Eskalasi:** customer Dormant, invoice terlambat 30 hari atau lebih (keduanya ditahan selama Accurate belum tersambung), dan data Accurate yang menunggu approval lebih dari 1 hari (tidak pernah ditahan).
- **Target:** omzet sebelum PPN, jumlah SO, customer baru (NOO).
- **KPI:** customer aktif, omzet bulan ini (sebelum PPN), tagihan terlambat, prospek belum order. KPI transaksi diberi keterangan "Belum tersambung Accurate" selama belum tersambung.

Job harian `node src/jobs/salesDormantReminder.js` mengingatkan PIC saat customer mulai dormant dan 10 hari sebelum Lost. Job ini ditahan selama Accurate belum tersambung. Tambahkan `--dry-run` untuk melihat rencananya saja.
