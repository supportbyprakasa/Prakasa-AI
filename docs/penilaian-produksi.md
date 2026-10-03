# Penilaian kesiapan produksi

Penilaian per 1 Oktober 2026, setelah modul Finance, Retail Commerce, dan Marketing selesai. Hasilnya: **siap dipasang di domain live**, tinggal langkah di sisi owner dan hosting di bawah. Panduan pemasangan langkah demi langkah ada di [deployment.md](deployment.md).

## Nilai per area

| Area | Sebelum | Sesudah | Yang diperbaiki |
|---|---|---|---|
| Fitur 4 divisi baru | Finance, Retail Commerce, dan Marketing masih "Segera hadir" | Lengkap | Finance: Piutang, Utang (tarikan Accurate baca-saja, disetujui per batch), dan Pengajuan pembayaran. Retail Commerce: kinerja marketplace. Marketing: Produk & channel serta Kampanye. Semua masuk dashboard divisi dan manajemen |
| Notifikasi & email | Semua hanya di aplikasi; tidak ada kebijakan | Kebijakan terpusat untuk 73 jenis notifikasi | 19 jenis lewat email, 19 tidak dikirim, sisanya di aplikasi. Admin bisa mengubahnya ([kebijakan-notifikasi.md](kebijakan-notifikasi.md)) |
| Keamanan API | Tanpa header keamanan; CORS terbuka ke domain Vercel lama | Header keamanan (helmet), CORS hanya domain sendiri | HSTS di produksi; pembatas laju AI dan unggahan; server menolak menyala di produksi bila secret masih contoh |
| Akun & sesi | Kata sandi sementara dari admin tidak pernah wajib diganti | Wajib diganti saat pertama masuk | Reset atau ganti kata sandi mengakhiri sesi lama. Login Google wajib email terverifikasi |
| Frontend di hosting | Build produksi tidak bisa menjangkau API di cPanel; deep link 404 | Alamat API dari `VITE_API_URL`; `.htaccess` dengan rute aplikasi, cache, dan CSP | Bundle utama turun dari 1,9 MB ke 346 kB; halaman 404; manifest |
| Operasional | Email dari job terjadwal bisa hilang; log tumbuh tanpa batas | Job menunggu pekerjaan latar sebelum menutup koneksi | Retensi log integrasi 90 hari dan notifikasi terbaca 180 hari (log audit tidak pernah dihapus); health check memeriksa DB; shutdown rapi |
| Data | Ada akun dan sesi uji `[UJI]` | Dibersihkan, log audit utuh | Produksi dimulai dari database baru |
| Tes | — | Backend 1117/0, frontend 611/0, build bersih | — |

## Yang masih perlu dari owner atau hosting

1. **Domain live:** alamat domain dan subdomain API, misalnya `workspace.prakasagroup.com` dan `api.workspace.prakasagroup.com`.
2. **Hosting:**
   - Pastikan **MySQL ≥ 8.0.21, bukan MariaDB**, dengan perintah `SELECT VERSION()`.
   - Pastikan Node 20/22 dan akses cron tersedia.
   - Tanyakan batas Entry Processes dan memori per proses ke penyedia hosting.
3. **Google Cloud** (proyek `prakasa-work-os-local` saja):
   - Tambahkan domain live sebagai Authorized JavaScript origin di klien OAuth "Prakasa Workspace Login".
   - Tambahkan scope `gmail.send` di domain-wide delegation agar email notifikasi terkirim.
4. **Accurate:** ganti callback OAuth ke `https://api.<domain>/api/v1/integrations/accurate/callback`, lalu sambungkan ulang Accurate di produksi.
5. **Persetujuan data:**
   - Batch Accurate Finance **#18** (faktur dan pembayaran pembelian) menunggu Supervisor/Head Finance.
   - Batch #9, #10, dan #12 masih menunggu.
6. **Keputusan proses:**
   - Pencairan dana Shopee/Tokopedia belum dicatat sebagai penerimaan di Accurate, sehingga piutang marketplace Rp 1,64 M selalu tampil terlambat.
   - Customer `SFG-IN-0341` belum punya channel (sekitar Rp 440 jt per bulan masuk "Tanpa channel").
   - Piutang Rp 5,04 M sudah lebih dari 90 hari; perlu dicek bersama Finance apakah itu tunggakan nyata atau data lama.
