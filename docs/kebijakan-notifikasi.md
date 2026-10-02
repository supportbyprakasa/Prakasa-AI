# Kebijakan notifikasi & email

Keputusan owner, 1 Oktober 2026: "tentukan langsung mana fitur yang harus ada notifikasi dan mana yang butuh notifikasi email, untuk keseluruhan fitur di setiap divisi".

Daftar lengkap ada di `backend/src/config/notificationPolicy.js`. Admin bisa melihatnya di **Sistem & integrasi → Notifikasi & email** dan menyalakan atau mematikan email per notifikasi; pilihan admin mengalahkan aturan bawaan.

## Aturan

| Saluran | Kapan | Contoh |
|---|---|---|
| **Di aplikasi** (ikon lonceng) | Ada yang menyangkut pekerjaan atau permintaan Anda sendiri | Tugas untuk Anda, status tiket/permintaan Anda berubah, komentar untuk Anda, tenggat Anda |
| **+ Email** | Ada yang menunggu keputusan atau tindakan, dan terlambat itu merugikan perusahaan | Approval (dan pengingat serta eskalasinya), tanda tangan, data Accurate menunggu Supervisor/Head, tugas dan tenggat onboarding/offboarding, hari terakhir karyawan dengan akses/aset belum beres, perangkat belum kembali, perpanjangan dan pembayaran langganan, kontrak GA berakhir, tagihan utilitas terlambat, pembayaran Finance dibayar/ditolak, Prakasa AI terputus |
| **Tidak dikirim** | Perubahan kecil yang sudah terlihat di Project Tracker atau di Space Google Chat | Kartu dipindah atau diurutkan, checklist, watcher, dependensi, sprint |

Jenis notifikasi baru yang belum ada di daftar otomatis masuk **di aplikasi saja**.

## Cara kerja

- **Pengiriman email:**
  - Dikirim lewat Gmail perusahaan (`GOOGLE_GMAIL_SENDER`, scope `gmail.send` di domain-wide delegation).
  - Subjeknya diawali `[Prakasa Workspace]` dan isinya memuat tautan ke halamannya (`APP_PUBLIC_URL`).
- **Bila pengirim belum diatur atau Gmail gagal:** notifikasi di aplikasi tetap tersimpan. Email dikirim di latar belakang, jadi tidak pernah memperlambat tindakan pengguna.
- **Akun nonaktif** tidak menerima email.
- **Pengingat harian** (approval, onboarding/offboarding, IT, Operasional GA, data Accurate) memakai kunci dedupe, sehingga satu hal tidak dikirim berulang di hari yang sama. Hal yang terlambat diulang paling banyak seminggu sekali (GA) atau sesuai aturan modulnya.

## Ringkasan per divisi

| Divisi | Email | Di aplikasi saja |
|---|---|---|
| Semua divisi | Approval yang menunggu Anda, pengingat dan eskalasinya, tanda tangan | Hasil approval, tugas dan komentar |
| Sales & Retail Commerce | Data Accurate menunggu persetujuan (Supervisor/Head) | Pelanggan/leads diserahkan, pengingat pelanggan dormant, faktur terlambat |
| Warehouse, Procurement | Data Accurate menunggu persetujuan, approval pergerakan barang | — |
| Finance | Pengajuan dibayar/ditolak, data Accurate Finance menunggu persetujuan | Pengajuan sedang diproses |
| People & Culture — onboarding/offboarding | Tugas baru, jatuh tempo, terlambat, hari terakhir dengan akses terbuka | Tugas belum punya penanggung jawab |
| People & Culture — IT | Perangkat belum kembali, perpanjangan dan pembayaran langganan | Tiket (salinan email sudah ke kotak support), perangkat/lisensi diserahkan, garansi, lisensi menganggur |
| People & Culture — GA | Approval permintaan "Lainnya", kontrak berakhir, tagihan terlambat | Permintaan baru/ditugaskan/status, pemesanan ruang, perawatan jatuh tempo |
| Marketing | — | Kampanye berakhir, catat hasilnya |
| Admin | Prakasa AI terputus | Batas pemakaian AI |
