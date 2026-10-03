# Revisi Prakasa Workspace — hasil (3 Oktober 2026)

Basis: `supportbyprakasa/Prakasa-AI`, commit audit `2947c9d` (branch `feat/full-design-revamp`).
Branch kerja `claude/epic-feynman-xlwoxf` di-merge ke commit itu (merge `4514ec4`, isi pohon = `2947c9d`; tiga commit deploy lama di branch kerja sudah terkandung di `ada47a2`, leluhur `2947c9d`).
Tidak ada deploy, tidak ada perubahan konfigurasi produksi, tidak ada email atau pesan Chat yang dikirim.

| Commit | Isi |
|---|---|
| `15a4cae` | F23, F24 — akses tiket IT per perusahaan, perpindahan issue Tracker |
| `b4bb518` | F02, F03, F05, F06, F14, F15, F21, F25, F26, F27 — langganan software |
| `7a12282` | F01 — status tagihan sales order |
| `62d8ded`, `960fd86` | F07, F08, F09, F10, F11, F20 — satuan, cakupan, label nilai |
| `ed3d2a4` | F04, F16, F17, F22 — ekspor, eskalasi, tanda tangan, verifikasi QR |
| `7aba3f3` | F12, F13, F17, F18, F19, F22 — panduan dan teks (sumber `handbookContent.js`, turunan diregenerasi) |
| `a74fed2` | F25, F27 — perbaikan *locking read* dan test konkurensi MySQL nyata |

## 1. Keputusan kebijakan yang diambil

Pemilik proses memberi wewenang untuk merekomendasikan lalu langsung menjalankan rekomendasi. Keputusan di bawah dapat diubah; masing-masing ada di satu tempat di kode.

| ID | Keputusan | Alasan | Lokasi |
|---|---|---|---|
| F25 | **Pembayaran parsial didukung (Opsi A).** Mengurangi sisa; invoice tetap belum lunas sampai pembayaran tercatat menutup total. Status parsial dihitung dari ledger, tanpa enum baru. | Register harus bisa mencatat apa yang benar-benar dibayar; menolak parsial membuat pembayaran nyata tidak tercatat. | `backend/src/services/subscriptionBilling.service.js` |
| F25 | Kelebihan bayar **ditolak** dengan sisa yang diharapkan; kelebihan yang benar terjadi dicatat sebagai pembayaran tanpa invoice. | Tidak membuat saldo kredit otomatis. | sama |
| F25 | Mata uang pembayaran harus sama dengan invoice; tanpa konversi. Tanpa invoice, mata uang eksplisit (bawaan: mata uang langganan). | Tidak mencampur IDR/USD. | sama |
| F25/F26 | Invoice `pending_upload`, `uploaded`, `verified` boleh dibayar; `paid`/`void` tidak. | Pembayaran bisa terjadi sebelum pemeriksaan PDF; status verifikasi tetap terlihat. | sama |
| F26 | Invoice boleh dicatat tanpa PDF → `pending_upload` (bukan `uploaded`); PDF dapat diunggah kemudian. Verifikasi hanya dari `uploaded`; `void` ditolak bila sudah `paid` atau ada pembayaran. Subtotal + pajak = total. | Memisahkan "tercatat", "bukti ada", "diperiksa", "lunas". | sama |
| F15 | Label referensi = **"Nomor bukti di Accurate"** (diisi manual, tanpa sinkronisasi). Kolom DB `jurnal_reference_id` tetap. | Finance membukukan di Accurate. | `frontend/src/pages/it/itModel.js` |
| F06 | Mencatat pencabutan lisensi (halaman Langganan dan tugas offboarding) **wajib** konfirmasi "Akses sudah dicabut di portal vendor". | Setara dengan konfirmasi konsol admin Google. | `subscriptionLicenses.controller.js`, `hrgaWorkflow.service.js` |
| F27 | Lisensi `idle` tetap dipegang; **harus dicabut dulu** sebelum ditetapkan ke orang lain. Pencabutan `idle` diizinkan di kedua jalur. | Satu pemegang aktif per seat, histori utuh. | `licenseAssignment.service.js` |
| F23 | Memindahkan issue yang terhubung ke tiket IT **ditolak** (403 `IT_TICKET_LINKED`) bila aktor tidak punya `it_ticket.manage` di entitas tiket, atau transisinya tidak sah. | Papan tidak pernah menampilkan "Done" untuk tiket yang tidak diselesaikan. | `itTracker.service.js`, `tracker.service.js` |
| F03 | "Ubah langganan" memakai PATCH yang ada; status `expiring/expired` kembali `active` bila tanggal perpanjangan baru > 30 hari, kecuali status dipilih manual (active/paused/cancelled). Persetujuan perpanjangan **tidak dibuat** (dinyatakan belum tersedia). | Tidak membuat alur pembelian baru. | `softwareSubscriptions.controller.js` |
| F17 | Jalur ke alat tanda tangan: kartu "Tanda tangan" di **Akun saya** (sesuai izin). Halaman retired tidak dihidupkan. Pengajuan tanda tangan untuk dokumen template Drive **belum tersedia** dan dinyatakan begitu. | Tidak ada tombol yang menjanjikan alur yang tidak ada. | `frontend/src/pages/account/*` |

## 2. Daftar final per temuan

| ID | Lokasi revisi | Sebelum → sesudah | Aktor/scope | Kasus uji (bukti) | Hasil | Batas tersisa |
|---|---|---|---|---|---|---|
| F01 | `salesOrders.controller.js`, `salesModel.js`, `SalesOrders/SalesCustomerDetail/SalesOrderDetail.jsx`, AI `tools/sales.js` | SO tanpa faktur tampil Lunas → Belum difakturkan / Belum lunas / Faktur lunas · SO ditagih N% / Lunas / Data pembayaran belum tersedia; filter Lunas butuh faktur (+cakupan DPP penuh di mode Accurate) | Sales, RC; layar, CSV, AI | `salesOrderBilling.test.js` (7), `salesModel.test.js` | Lulus | Faktur DP saja dianggap "belum difakturkan"; toleransi cakupan Rp1 |
| F02 | `SoftwareSubscriptions.jsx`, `SubscriptionDetail.jsx`, `itModel.js` | Semua tombol tampil → tombol, aksi baris dan `?form=` mengikuti izin aktual | Member baca; Supervisor kelola langganan; Head semua; custom per izin | `itModel.test.js` (abilities), `subscriptionLicenses.test.js` (guard 10 rute: Member 403, izin lolos) | Lulus | Belum walkthrough browser |
| F03 | PATCH + dialog "Ubah langganan", banner jatuh tempo | Tak ada jalur ubah → perbarui tanggal di baris yang sama; banner ≤30 hari/lewat | `subscription.manage` | `subscriptionLicenses.test.js` (F03 ×2), `itModel.test.js` (renewalNotice) | Lulus | Alur persetujuan perpanjangan belum ada (by design) |
| F04 | `DataGrid.jsx`, `gridModel.js` | Menu Excel/CSV tanpa cakupan → "Hanya halaman ini: 20 baris dari 45" / "Semua hasil terfilter" / "daftar terpotong" + catatan top‑N | Semua tabel | `gridModel.test.js` (F04) | Lulus | Tidak ada export-all baru per halaman |
| F05 | `assignable-users` endpoint, dialog pemilih | ID angka → nama + email kerja, akun aktif satu entitas; server menolak inactive/deleted/lain entitas | `subscription.license.manage` | `subscriptionLicenses.test.js` (F05 ×2) | Lulus | Pencarian maks 20 hasil |
| F06 | Label/konfirmasi Langganan + checklist HR | "Cabut lisensi … kembali tersedia" → "Catat pencabutan" + centang portal vendor (server menolak tanpa konfirmasi) | IT/Head PC | `subscriptionLicenses.test.js`, `hrgaWorkflow.test.js` (DB, F06 negatif) | Lulus | Tidak ada API vendor (by design) |
| F07 | `warehouseMovementModel.js`, `WarehouseMovements.jsx` | "5 total" → "2 baris · 2 SKU · 2 Box + 3 PCS" | Warehouse; layar = ekspor | `warehouseMovementModel.test.js` (F07) | Lulus | Konversi antar satuan tidak dilakukan (baris pergerakan tak punya rasio) |
| F08 | `marketingCampaigns.service.js`, `marketingInsights.service.js`, `marketingModel.js`, AI `tools/marketing.js` | Jumlah lintas satuan dijumlah → per satuan; total & uplift hanya satu satuan sama; selain itu null + alasan | Marketing | `marketing.test.js` (F08), `marketingModel.test.js` (F08 ×2) | Lulus | Satuan nama sama antar‑SKU dianggap sebanding |
| F09 | `salesTargets.service.js`, `SalesTargets.jsx` | "N sales order" hardcode → `orderUnit` dari API (faktur/sales order) | Sales | `salesActions.test.js` (recap + Accurate) | Lulus | — |
| F10 | `salesModel.salesScopeText`, `SalesPipeline.jsx` | "seluruh perusahaan" untuk semua → dari `scope` respons; belum terpetakan disebut | Member vs view_all | `salesModel.test.js` (F10) | Lulus | Tidak ada scope tim (memang tidak ada di backend) |
| F11 | `RetailCommerce.jsx`, `SalesCustomerDetail.jsx`, AI `tools/retailCommerce.js` | "Nilai"/"Porsi" → "Nilai penjualan produk (DPP sebelum retur)", "Porsi dari total baris faktur" + penjelasan | RC, Sales | build + i18n; teks diverifikasi | Lulus (copy) | Retur tidak dialokasikan ke SKU (by design) |
| F12 | `handbookContent.js` + turunan | AR & AP "disetujui Finance" → AR dari batch Sales/RC, AP dari batch Finance; status pengajuan ≠ utang | Finance | `handbookBackendParity`, `handbookModel` | Lulus | — |
| F13 | `handbookContent.js`, komentar `GaServices.jsx` | "Serahkan kunci" untuk ruang → tidak ada serah terima ruang; kendaraan via TrackCar, histori lama dijelaskan | GA, semua karyawan | handbook tests; `ga.json` sudah benar | Lulus | — |
| F14 | `handbookContent.js` (Langganan) | "Unggah invoice (Supervisor/Head)" → per izin; invoice/lisensi/pembayaran Head | PC | handbook tests | Lulus | — |
| F15 | Form, AI catalog, handbook | "Referensi Jurnal.id" → "Nomor bukti di Accurate" (manual) | Head PC | `itModel.test.js` (F15), `aiFormsIt.test.js` | Lulus | Nama kolom DB lama dipertahankan |
| F16 | `Escalations.jsx`, handbook | Kosong = "semua dalam tenggat" → "Tidak ada eskalasi pada filter ini"; kolom "Kondisi sumber" terpisah; dialog menjelaskan efek | Head/manajemen | i18n/DOM tests | Lulus (UI) | Belum walkthrough browser |
| F17 | `Account.jsx` + `accountModel.js`, handbook | Shortcut hanya di halaman retired → kartu "Tanda tangan" di Akun saya per izin | Semua peran ber-izin | `accountModel.test.js` (F17) | Lulus | Membuat permintaan tanda tangan dari UI belum ada |
| F18 | `navigation.js` | "sample request" → pipeline, pelanggan/leads, kunjungan, Data Sales; komentar "Segera hadir" Finance dihapus | — | navigation tests | Lulus | — |
| F19 | `Login.jsx`, `Account.jsx`, handbook | Kontak berbeda → akun: Administrator Sistem/Super Admin; kata sandi: Super Admin | — | loginModel/handbook tests | Lulus | — |
| F20 | `MarketingInsights.jsx`, `SalesOrders.jsx`, `MarginEstimate.jsx`, AI catatan | "dibagi rata" → "dialokasikan proporsional terhadap nilai baris" (rumus view tidak diubah) | — | rumus view `mg_invoice_lines_accurate` dicek | Lulus (copy) | — |
| F21 | `softwareSubscriptions.controller.js` list, banner | LIMIT 200 diam-diam → `total/limit/hasMore` + banner + catatan ekspor | PC | `subscriptionLicenses.test.js` (201 baris) | Lulus | Belum server search/pagination penuh |
| F22 | `verifyModel.js`, `VerifyDocument.jsx`, handbook | Semua error = "tidak ditemukan" → 404/400 vs "Belum dapat memverifikasi" (timeout/jaringan/5xx/429) + retry; catatan hash | Publik | `verifyModel.test.js` | Lulus | — |
| F23 | `itTracker.service.js`, `tracker.service.js`, `ProjectTracker.jsx` | `canManage:true` konstan → cek `it_ticket.manage` + entitas + transisi sebelum issue berubah; hasil sinkronisasi dikembalikan dan dicatat | Anggota Space vs pengelola IT | `itTracker.test.js` (F23 ×3), `tracker.test.js` (F23 ×2) | Lulus | Tidak ada jalur AI yang memindahkan issue (dicek) |
| F24 | `itTicket.service.js`, `itTickets.controller.js`, AI `tools/it.js` | Detail/status/komentar/lampiran hanya per ID → selalu `id + entity_id`; lintas entitas = 404 sebelum child/Drive/notifikasi; status dengan *compare-and-set* | Manager entitas A vs tiket B | `itTicket.test.js` (F24 ×4), `itCompanyScope.test.js` | Lulus | — |
| F25 | `subscriptionBilling.service.js`, migrasi `143`, controller, UI | Setiap insert → `paid`, nol diterima, tanpa transaksi → validasi penuh, satu transaksi dengan lock, parsial, idempoten | Head PC | `subscriptionBilling.test.js` (18), `subscriptionConcurrency.test.js` (MySQL nyata: 10 pembayar paralel → tepat 5; retry ×5 → 1) | Lulus | **Migrasi 143 wajib dijalankan sebelum deploy** |
| F26 | `subscriptionBilling.service.js`, `POST /invoices/:id/file`, UI | Tanpa file = `uploaded`; verify tanpa guard → `pending_upload`; PDF saja; total = subtotal+pajak; verify/void dengan guard; file Drive dihapus bila DB gagal | Head PC | `subscriptionBilling.test.js` (F26 ×7) | Lulus | Penghapusan file Drive best-effort |
| F27 | `licenseAssignment.service.js`, controller | Idle bisa dialihkan → assignment ganda; revoke idle 409 → satu mesin status | Langganan + checklist HR | `subscriptionLicenses.test.js` (F27 ×3), `subscriptionConcurrency.test.js` (2 aktor paralel, urutan idle) | Lulus | Rekonsiliasi data lama belum dijalankan (lihat §5) |

## 3. Skenario A–P

| Skenario | Status | Bukti / catatan |
|---|---|---|
| A, B (faktur/retur/diskon) | Dicek pada kode dan label | Rumus view proporsional tidak diubah (F20); label sebelum retur (F11); omzet net tetap dari `sales_revenue_accurate` |
| C (satuan) | Diuji | F07, F08 test |
| D (kampanye) | Sebagian | Teks "bukan efek kausal/ROI", NOO "belum tentu produk target"; selisih coverage NOO master vs faktur **tidak diubah, belum diverifikasi** |
| E (gudang) | Tidak diubah | Aturan pencocokan tetap; tidak ada test baru |
| F (reorder) | Tidak diubah | — |
| G (Finance tandai dibayar) | Tidak diubah | Panduan F12 menegaskan status pengajuan ≠ utang |
| H (PC, TrackCar) | Diubah sebagian | F06, F13 |
| I (tiket) | Diuji | Metrik penyelesaian tidak menghitung cancelled (dicek di `management/providers/it.js`) |
| J (dokumen/QR) | Diubah | F17, F22 |
| K (peran) | Diuji pada peran standar | Matriks §4 |
| L, M | Diuji | F23, F24 |
| N, O, P | Diuji | F25, F26, F27 (unit + MySQL nyata) |

## 4. Matriks peran (izin efektif, 24 peran standar + 2 global)

Dihitung dengan `permissionsForStandardRole` dan helper yang sama dengan halaman. Super Admin menerima semua izin lewat migrasi.

| Peran | Lihat langganan | Tambah/ubah langganan | Invoice | Lisensi | Pembayaran | Kelola tiket IT (dan geser issue tiket) | Cakupan angka Sales | Alat tanda tangan di Akun saya |
|---|---|---|---|---|---|---|---|---|
| finance.member | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| finance.supervisor | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| finance.head | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| procurement.member | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| procurement.supervisor | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| procurement.head | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| sales.member | – | – | – | – | – | – | data sendiri | Permintaan, Tanda, Cap |
| sales.supervisor | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| sales.head | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| people_culture.member | ya | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| people_culture.supervisor | ya | ya | – | – | – | ya | – | Permintaan, Tanda, Cap |
| people_culture.head | ya | ya | ya | ya | ya | ya | – | Permintaan, Tanda, Cap |
| management_office.member | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| management_office.supervisor | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| management_office.head | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| retail_commerce.member | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| retail_commerce.supervisor | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| retail_commerce.head | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| warehouse.member | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| warehouse.supervisor | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| warehouse.head | – | – | – | – | – | – | – | Permintaan, Tanda, Cap |
| marketing.member | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| marketing.supervisor | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| marketing.head | – | – | – | – | – | – | seluruh perusahaan | Permintaan, Tanda, Cap |
| system.super_admin | ya (semua izin) | ya | ya | ya | ya | ya | seluruh perusahaan | semua |
| system.admin | – | – | – | – | – | – | – | – |

## 5. Pengujian dan lingkungan

- **Backend tanpa DB** (`node --test test/*.test.js`): 1519 test, 1424 lulus, 1 gagal, 27 dibatalkan, 67 dilewati. Kegagalan dan pembatalan sama persis dengan baseline `2947c9d` (`morningBriefing` ECONNREFUSED; `aiClientTools` dan `morningBriefing` dibatalkan).
- **Backend dengan MySQL 8 lokal terisolasi** (database `prakasa_test`, 128 migrasi termasuk `143`): 20 file berbasis DB, 202 test, 189 lulus, 12 gagal. Ke-12 kegagalan identik di `2947c9d` pada database yang sama (database uji kosong tanpa seed/fixture). `claudeTeamStream.test.js` macet/gagal dengan DB, juga di baseline.
- **Frontend**: 824 test lulus; `vite build` berhasil; katalog i18n lengkap (ID/EN). Commit laporan rekonsiliasi (`f79bb28`) sempat membuat test katalog gagal (teks laporan belum punya EN); diperbaiki di commit walkthrough.
- **Email**: tidak ada kredensial Google di lingkungan uji, jadi **0 email terkirim**; notifikasi diuji dengan mock. Pengiriman email tidak terverifikasi.
- **Walkthrough UI di browser** (3 Okt 2026, Chromium + Playwright, backend dan frontend lokal, MySQL 8 sandbox, data sintetis, tanpa kredensial Google): lihat bagian 5a.

### 5a. Walkthrough di layar

Akun uji: PC Member, PC Supervisor, PC Head, Sales Member (entitas 1) dan PC Head entitas 2; satu akun nonaktif; langganan "Figma (uji)" berisi 4 seat (1 dipakai, 1 idle, 2 tersedia) dan satu invoice lama `paid` dengan pembayaran 0.

| ID | Langkah | Hasil |
|---|---|---|
| F02 | Daftar dan detail per peran; `/it/subscriptions?baru=1` | Member: tanpa tombol, form tidak terbuka. Supervisor: Tambah/Ubah langganan saja. Head: semua tombol. Sesuai |
| F26 | Catat invoice 900 + 0 ≠ 1000 | Ditolak: "Total harus sama dengan subtotal + pajak." |
| F26 | Catat invoice tanpa PDF | "Menunggu file PDF", tombol verifikasi tidak ada, tombol unggah ada |
| F26 | Unggah PDF tanpa Google Drive (sandbox) | Pesan jelas "Google Shared Drive belum dikonfigurasi…", status tidak berubah. Unggah sukses tidak terverifikasi di sandbox (diuji dengan mock) |
| F26 | Invoice `uploaded` → Tandai terverifikasi | Dialog konfirmasi → `verified` |
| F25 | Bayar 1100 pada invoice 1000 | Ditolak: melebihi sisa tagihan |
| F25 | Bayar 100, lalu 900 | "Dibayar sebagian · sisa Rp 900", lalu "Lunas (tercatat)" |
| F25 | Invoice lama `paid` dengan pembayaran 0 | **Temuan, diperbaiki**: sebelumnya tampil "Lunas · sudah menutup total". Kini "Lunas, perlu dicek · kurang Rp 1.000" (status pembayaran `paid_short`) |
| F27 | Seat idle | Hanya "Catat pencabutan"; tidak bisa ditetapkan langsung |
| F06 | Catat pencabutan | Wajib centang "Akses sudah dicabut di portal vendor" (tanpa centang ditolak dengan pesan, pola yang sama dengan HRGA); setelah dicatat seat tersedia, 0 penetapan aktif |
| F05 | Cari pengguna untuk penetapan | Akun nonaktif dan akun entitas lain tidak muncul; akun aktif muncul; setelah dicatat 1 penetapan aktif |
| F03 | Ubah tanggal perpanjangan > 30 hari | Baris yang sama diperbarui, status kembali Aktif, tidak ada baris baru |
| F24 | Head entitas 1 membuka tiket entitas 2 | "Tidak ditemukan"; Head entitas 2 dapat membukanya |
| F19 | Halaman masuk | Teks kontak Administrator Sistem / Super Admin sesuai |
| F17 | Akun saya | Kartu "Tanda tangan" berisi alat sesuai izin |
| F16 | Pusat eskalasi kosong | "Tidak ada eskalasi pada filter ini", kolom "Kondisi sumber" |
| F10 | Pipeline sebagai Sales Member | Keterangan "data Anda saja" |
| F01 | Data Sales | Filter "Belum difakturkan"; tanpa batch Accurate di sandbox tabel kosong |
| F22 | `/verify/<kode>` dengan backend hidup / mati | Hidup: "tidak ditemukan". Mati: "Belum dapat memverifikasi" + "Coba lagi" |
| — | `npm run report:subscriptions` pada data sandbox | Menemukan tepat 2 temuan dari data lama yang ditanam (invoice lunas tanpa pelunasan, pembayaran 0); data baru dari layar bersih |

Tidak diuji di layar karena butuh data Accurate yang disetujui: F07–F09, F11, F20 (tercakup test unit/DB). F23 (geser issue di Tracker) tercakup test, tidak diulang di layar.

## 6. Risiko tersisa dan tindak lanjut

1. **Deploy**: jalankan migrasi `143_subscription_payment_request_key.sql` sebelum kode baru; tanpa kolom `request_key` pencatatan pembayaran gagal.
2. **Data lama**: seat dengan >1 assignment aktif, invoice `uploaded` tanpa `document_id`, dan invoice `paid` dari pembayaran parsial/nol sebelum revisi **tidak diubah**. Perlu rencana rekonsiliasi terpisah (laporan dulu, tanpa menghapus histori).
3. Persetujuan perpanjangan langganan dan pembuatan permintaan tanda tangan dari UI belum ada; keduanya dinyatakan di layar dan panduan.
4. Perubahan perilaku: anggota Space tanpa `it_ticket.manage` kini tidak bisa memindahkan issue tiket IT; pencabutan lisensi butuh centang portal vendor.
5. Tidak ada jaminan 100% bebas bug. Cakupan yang didefinisikan di atas terverifikasi pada versi `a74fed2` kecuali butir yang ditandai belum diverifikasi; walkthrough 5a pada versi commit walkthrough.
6. **Preview Vercel**: frontend preview meneruskan `/api` ke API produksi (kecuali `API_UPSTREAM_ORIGIN` diisi), jadi preview memakai data produksi tanpa perubahan backend revisi. Login Google di preview butuh `VITE_ENABLE_GOOGLE_LOGIN`/`VITE_GOOGLE_CLIENT_ID` untuk lingkungan Preview dan origin preview di Google Cloud. Gambar rusak di preview tidak dapat direproduksi dari build lokal (semua gambar termuat); perlu dicek di Vercel.
