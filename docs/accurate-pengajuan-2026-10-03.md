# Pengajuan ke Accurate: data dari Prakasa Workspace ke Accurate (3 Oktober 2026)

## Keputusan owner (3 Oktober 2026)

1. **Accurate tetap sumber kebenaran.** Prakasa Workspace mengajukan perubahan ke Accurate, bukan sebaliknya. Angka di aplikasi selalu hasil tarikan, bukan hitungan sendiri.
2. **Yang disetujui: Supervisor atau Head divisi.** Berlaku juga untuk Procurement (berbeda dari batch tarikan Procurement yang Head saja).
3. **Urutan jenis data:** pelanggan dan pemasok dulu; sales order dan purchase order menyusul; faktur, pembayaran, dan jurnal tetap hanya di Accurate.
4. **Tidak ada pengujian ke Accurate.** Seluruh alur dibangun dan diverifikasi di Prakasa Workspace. Saluran kirim ke Accurate **tertutup** sampai owner membukanya (lihat "Yang belum dilakukan").

Tujuan: data di Prakasa Workspace dan di Accurate sama, tanpa dobel dan tanpa selisih.

## Yang dibangun (tahap 1: pelanggan dan pemasok)

### Alur

```
Pengguna (Sales / Retail Commerce / Procurement)
   │  "Ajukan ke Accurate" — pelanggan baru, perubahan pelanggan,
   │  pemasok baru, perubahan pemasok
   ▼
accurate_write_requests  status = pending  ──► approval engine (request_type accurate_write)
   │                                           Supervisor ATAU Head divisi memutuskan
   │                                           (Head memegang langkah sejak awal; pengaju tidak boleh)
   ├── ditolak ──► rejected (alasan wajib)
   ▼ disetujui
status = queued ("Disetujui, antre kirim")
   │  jobs/accurateWriteDispatch.js (dan percobaan pertama tepat setelah persetujuan)
   │  services/accurate/accurateWriteTransport.js
   │     ACCURATE_WRITE_ENABLED kosong  → blocked: tetap queued, alasan tercatat
   │     ACCURATE_WRITE_ENABLED=1       → masih blocked (saluran belum disambungkan)
   ▼ (masa depan, setelah saluran dibuka)
status = sent ──► tarikan Accurate berikutnya menampilkan record ──► confirmed
```

### Pengaman supaya Accurate tidak berantakan

| Pengaman | Cara kerja |
|---|---|
| Tidak dobel | Satu pengajuan terbuka per target (nomor Accurate atau baris aplikasi). Nomor yang sudah ada di mirror Accurate ditolak sebagai "data baru". |
| Tidak terkirim dua kali | `request_key` unik per pembukaan form; submit ulang mengembalikan pengajuan yang sama. |
| Perubahan jelas | Perubahan dimulai dari snapshot mirror yang disetujui (`before_data`); penyetuju membaca "Di Accurate sekarang → Diajukan". Perubahan tanpa selisih ditolak. |
| Keputusan manusia | Approval engine, matrix `accurate_write` per divisi (migrasi 145). Pengaju tidak bisa memutuskan sendiri. Hanya setuju/tolak. |
| Pembatalan aman | Pengaju atau Supervisor/Head membatalkan selama belum terkirim (pending → menarik approval; queued → langsung). Yang sudah terkirim tidak bisa dibatalkan. |
| Bukti dari Accurate | Terkonfirmasi hanya bila tarikan berikutnya (batch yang disetujui) menampilkan record. Bila kolomnya berbeda, dicatat di pengajuan. |
| Jejak | activity log (`accurate.write_request.*`), approval audit, notifikasi ke penyetuju dan pengaju. |
| Tidak ada jalur tulis diam-diam | `accurateReadOnly.js` tetap satu-satunya pemanggil Accurate; tes menolak file lain yang menyebut host Accurate. Transport baru tidak memanggil apa pun. |

### Rekonsiliasi

Tab **Selisih pelanggan** (Data Accurate) membandingkan `sales_customers` dengan mirror Accurate (`accurate_latest`, `record_type = customer`) per ID pelanggan: belum ada di Accurate, atau nama berbeda. Setiap baris bisa langsung diajukan. Pemasok hanya hidup di Accurate (tidak ada tabel aplikasi), jadi rekonsiliasinya adalah daftar pengajuan itu sendiri.

### Tempat di aplikasi

| Peran | Jalan masuk |
|---|---|
| Sales / Retail Commerce (semua tingkat) | Pelanggan → detail → menu → "Ajukan ke Accurate"; Pelanggan → "Selisih dengan Accurate"; Data Accurate → tab "Pengajuan ke Accurate" dan "Selisih pelanggan" |
| Procurement (semua tingkat) | Procurement → Pemasok → "Ajukan pemasok baru"; detail pemasok → "Ajukan perubahan ke Accurate" |
| Supervisor / Head divisi | Notifikasi "Pengajuan ke Accurate menunggu persetujuan Anda" → halaman pengajuan → Setujui / Tolak |

### Kode

- Migrasi `backend/migrations/145_accurate_write_requests.sql`: tabel `accurate_write_requests`, izin `accurate.write.request` (Sales, Retail Commerce, Procurement; Super Admin), matrix `accurate_write` untuk tiga divisi.
- `backend/src/services/accurateWriteRequests.service.js` (aturan, antrean, konfirmasi, rekonsiliasi), `services/accurate/accurateWriteTransport.js` (saluran kirim, tertutup), `controllers/accurateWrite.controller.js`, `routes/accurateWrite.routes.js` (`/api/v1/accurate-write/*`), `jobs/accurateWriteDispatch.js`, pendaftaran di `approvalSubjectLifecycle.service.js` dan `approvalLink.js`.
- Frontend: `pages/accurate/accurateWriteModel.js`, `AccurateWriteForm.jsx`, `AccurateWriteRequests.jsx`, `AccurateWriteRequestDetail.jsx`; tab baru di `DataAccurate.jsx`; tombol di `SalesCustomerDetail.jsx`, `SalesCustomers.jsx`, `ProcurementVendors.jsx`; rute `/data-accurate/pengajuan/:id`.
- Panduan: bab Data Accurate → "Pengajuan ke Accurate: pelanggan dan pemasok dari aplikasi".
- Tes: `backend/test/accurateWriteRequests.test.js` (18), `frontend/test/accurateWriteModel.test.js` (5).

### Konfigurasi

- `ACCURATE_WRITE_ENABLED` (kosong = tertutup). Lihat `backend/.env.example`.
- Cron: `src/jobs/accurateWriteDispatch.js` tiap 15 menit (docs/deployment.md §5). Selama saluran tertutup, job hanya mencatat alasan menunggu.

## Yang belum dilakukan (butuh keputusan dan tindakan owner)

Urutannya tetap, dan tidak satu pun dikerjakan tanpa persetujuan tertulis owner:

1. **Database uji di Accurate** (bukan file perusahaan produksi).
2. **Scope tulis OAuth** untuk jenis data yang dibuka (`customer_save`, `vendor_save`). Hari ini `accurateConnection.service.js` menolak scope selain `*_view`.
3. **Membuka endpoint simpan** di `accurateReadOnly.js` (allowlist terpisah, tes sendiri), lalu menyambungkan `accurateWriteTransport.send` ke endpoint itu (pemetaan parameter `toAccurateParams` sudah ada dan diuji).
4. `ACCURATE_WRITE_ENABLED=1` di lingkungan uji, lalu produksi.

Tahap 2 (sales order, purchase order) mengikuti pola yang sama: tabel yang sama (`record_type` baru), matrix yang sama, transport yang sama; perbedaannya pada validasi baris dokumen dan pengecekan nomor dokumen.
