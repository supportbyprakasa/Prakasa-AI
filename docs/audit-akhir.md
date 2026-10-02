# Audit akhir sebelum produksi

Tanggal: 1 Oktober 2026. Diminta owner: "lakukan audit, UAT, dan uji kelayakan web app untuk digunakan banyak karyawan, dan ini harus final."

**Kesimpulan: aplikasi layak dipakai banyak karyawan, dengan syarat di bagian 7 dipenuhi saat go-live.** Semua temuan kritis dan tinggi dari lima audit sudah diperbaiki dan diuji ulang.

## 1. Hasil pengujian akhir

| Pemeriksaan | Hasil |
|---|---|
| Tes backend | 1.189 lulus; 1 tes database kadang gagal bila dijalankan paralel, lulus bila dijalankan sendiri |
| Tes frontend | 638 lulus, 0 gagal |
| Build frontend | Berhasil (berkas utama 349 kB) |
| Migrasi | Sampai 139, tidak ada yang tertunda |
| Konsistensi angka | Sama sebelum dan sesudah perbaikan performa (hanya keterangan waktu yang berubah) |
| Data uji | Semua akun uji (UJI-SEC, UJI-UAT, UJI-UI, UJI-LOAD) sudah dihapus; log aktivitas dipertahankan |

## 2. Keamanan

Sudah diperbaiki:

- **Ganti kata sandi wajib** tidak bisa dilewati lagi lewat manipulasi alamat; algoritma token dikunci.
- **Data per divisi:** tugas, papan, approval, dokumen, tanda tangan, pencarian global, dan lampiran pengajuan pembayaran hanya terlihat oleh divisi sendiri, pembuat, atau pihak yang terlibat. Log aktivitas dibatasi per entitas.
- **Lintas divisi** hanya untuk Management Office dan Super Admin. Sebelumnya semua Supervisor/Head memilikinya (migrasi 131).
- **Approval:** pengaju tidak bisa menyetujui pengajuannya sendiri; langkah tanpa penyetuju hanya bisa diputuskan divisi yang sama.
- **Delegasi approval** hanya untuk diri sendiri atau anggota divisi sendiri.
- **Administrator Sistem** tidak bisa mengubah katalog izin, membuat akun admin baru, memberi peran Supervisor/Head, atau mengubah pengaturan AI dan koneksi Accurate. Semua itu khusus Super Admin (migrasi 123).
- **Login:** pembatas per email dan per jaringan (login berhasil tidak dihitung), "Keluar" mengakhiri sesi di semua perangkat (migrasi 124), waktu respons sama untuk email yang tidak terdaftar.
- **Input:** unggahan dicek isinya, tautan wajib https, pesan error produksi tidak membocorkan detail teknis.
- **Marketing** tidak lagi bisa membuka Data Sales (migrasi 130).

## 3. UAT per peran

26 peran diuji lewat browser dengan API asli: semua menu dan halaman terbuka tanpa error, sekitar 1.600 percobaan akses tanpa izin semuanya ditolak, dan alur tiket IT, Layanan GA, pengajuan pembayaran, kampanye Marketing, operasional GA, serta ganti kata sandi wajib berjalan sesuai aturan. Tampilan ponsel (390 px) tidak melebar ke samping.

## 4. Konsistensi data

Omzet, piutang, pelanggan, pelanggan baru (NOO), dan PO sekarang sama di semua halaman. Yang diperbaiki:

- Saldo awal 31 Desember 2025 (71 faktur, Rp 919,2 juta) tidak lagi dihitung sebagai omzet dan pelanggan baru; tetap masuk piutang. Omzet 12 bulan menjadi Rp 5.257.264.236,15.
- SO terlambat memakai satu aturan di Gudang, Retail Commerce, dan Alur.
- "Produk terlaris" memakai DPP (sebelum PPN, setelah diskon).
- Tab Orders: "Nilai SO" benar-benar nilai SO; faktur diberi label "Nilai faktur".
- Rasio seluruh perusahaan dihitung pasti, bukan rata-rata antar divisi.
- Status target untuk ukuran "makin rendah makin baik" tidak lagi terbalik.
- Faktur tanpa channel memakai channel dari data pelanggan.
- NOO dihitung dari pelanggan Accurate (September: 21 di semua halaman).
- Retail Commerce diberi tanda "ditagih bulanan"; bulan berjalan tidak dinilai lajunya.
- Target per sales yang belum dipetakan menampilkan ajakan memetakan, bukan Rp 0.

Tidak ada data Accurate, Excel, atau Sheets yang diubah. Semua lewat view dan kode.

## 5. Tampilan dan aksesibilitas

Sekitar 600 tampilan (semua halaman × 4 lebar layar) diperiksa. Yang diperbaiki: tab yang membuat halaman macet saat dibuka lewat tautan langsung, pesan error berbahasa Inggris, angka KPI yang tidak terbaca pembaca layar, fokus keyboard setelah dialog ditutup, kontras teks di kartu (dijaga tes otomatis), urutan judul halaman, dan penyeragaman istilah (entitas, peran, pelanggan, grafik capaian bulanan). Deskripsi izin di halaman Peran/Izin berbahasa Indonesia (migrasi 139).

## 6. Uji beban

Diukur di laptop pengembangan, pengguna membuka halaman terus-menerus tanpa jeda (lebih berat dari pemakaian nyata).

| Pengguna bersamaan | Waktu buka halaman sebelum (median) | Sesudah (median) | Sesudah (95% tercepat) | Error |
|---|---|---|---|---|
| 10 | 4,5 detik | 0,03 detik | 0,05 detik | 0 |
| 25 | 10,2 detik | 0,05 detik | 0,09 detik | 0 |
| 50 | 21,7 detik | 0,10 detik | 0,16 detik | 0 |
| 100 | 47,9 detik | 0,23 detik | 0,35 detik | 0 |

Yang dipasang: cache hasil dashboard 60–120 detik per entitas, divisi, dan izin (dikosongkan saat batch Accurate disetujui); penyamaan format teks database agar indeks terpakai (migrasi 132); pembatasan query paralel; cache data login 30 detik yang langsung dihapus saat peran, status, atau kata sandi berubah; pemanasan dashboard setelah server menyala.

Belum diuji ulang setelah perbaikan: skenario dengan jeda baca dan skenario server baru menyala. Keduanya lebih ringan dari skenario di tabel, tetapi wajib diuji di hosting asli (lihat bagian 7).

## 7. Syarat go-live

1. Hosting memakai MySQL 8.0.21 atau lebih baru (bukan MariaDB), dengan cron.
2. `DB_POOL_LIMIT=5`. Nilai lebih besar terukur lebih lambat.
3. `REALTIME_ENABLED=0`, kecuali pihak hosting memastikan koneksi terbuka tidak dihitung ke batas Entry Process.
4. Passenger: minimal 1 instance selalu menyala dan pre-start ke `/api/health`.
5. Job terjadwal di luar jam 07.30–09.30.
6. **Kosongkan `EMAIL_TEST_REDIRECT` dan `EMAIL_TEST_ALLOWLIST`.** Selama masa uji, semua email dialihkan ke support@prakasagroup.com.
7. Isi `GOOGLE_ALLOWED_DOMAIN` dengan domain Workspace perusahaan.
8. Uji beban singkat di hosting asli sebelum semua karyawan diundang.

Langkah lengkap ada di [deployment.md](deployment.md).

## 8. Keputusan dan tindak lanjut owner

1. **Penjualan ke perusahaan grup** (kode `-IN-`: Sedap Food Group, PMK, BLS, IGS): tetap dihitung sebagai omzet sampai owner memutuskan lain. Satu faktur Sedap Food Group adalah 82% omzet September.
2. **Pembayaran pelanggan di Accurate:** 520 faktur Desember–Mei belum tercatat lunas, sehingga piutang tampil Rp 6,24 miliar (80% di atas 90 hari). Finance perlu mencatat penerimaannya di Accurate.
3. **Pemetaan sales:** Supervisor Sales menghubungkan nama sales Accurate ke akun karyawan di Pelanggan → Pemetaan sales.
4. **Batch Accurate menunggu persetujuan:** Sales #9, Warehouse #10, Retail Commerce #12, Procurement #17, Finance #18.
5. **Administrator Sistem** memakai akun admin terpisah; untuk pekerjaan harian memakai akun karyawan biasa.

## 9. Rekomendasi final

- Go-live bertahap: Management Office dan satu divisi dulu selama satu minggu, lalu semua divisi.
- Bagikan Panduan (menu Bantuan → Panduan) sebelum hari pertama; tiap orang hanya melihat bab untuk perannya.
- Setelah dua minggu berjalan, tinjau log integrasi dan Pusat eskalasi untuk menyetel pengingat dan kebijakan email.

## 10. Yang masih terbuka (tidak menghalangi go-live)

- Halaman Google (Mail, Chat, Drive, Docs) hanya diuji keadaan error-nya; tampilan dengan data perlu dicek dengan akun owner.
- Daftar delegasi approval masih terlihat se-entitas.
- Notifikasi langsung (realtime) dikirim se-entitas, hanya berisi ID.
- Berkas halaman lama yang sudah tidak punya rute (Inbox Approval, Document Center, Template Center) masih ada di repo.

### Pembaruan 2 Oktober

- **Selesai — daftar delegasi approval.** `GET /approval-delegations` kini hanya menampilkan delegasi yang Anda beri atau terima; Supervisor/Head juga melihat delegasi yang diberi anggota divisinya; Management Office dan Super Admin melihat semua. Prakasa AI tetap hanya membaca delegasi milik pengguna itu sendiri.
- **Selesai — notifikasi langsung (realtime).** Pengiriman bisa dibatasi per divisi (ditambah peran lintas divisi) atau per pengguna. Event tracker dikirim ke anggota project bila daftar anggotanya sudah ada di server, ditambah divisi project dan peran lintas divisi; bila belum ada, tetap se-entitas. Isinya tetap hanya ID. Notifikasi, approval, dan tugas belum mengirim event realtime, jadi belum ada yang perlu dibatasi di sana.
- **Selesai — tes database yang kadang gagal (deadlock).** Empat berkas tes yang memakai satu transaksi panjang kini bergiliran lewat kunci yang sama dengan tes GA.
- **Masih terbuka — berkas halaman lama tanpa rute.** Sudah didata (Inbox Approval, Document Center, Template Center, Delegasi Approval, ComingSoon, panel AI lama), tetapi belum dihapus: penghapusan berkas menunggu izin owner.
- **Masih terbuka — halaman Google dengan data** (perlu akun owner).
