# Prompt untuk AI browser — Cek Accurate & SimpliDOTS (HANYA MELIHAT)

Salin semua teks di antara dua garis di bawah ke AI browser. Setelah AI browser selesai, tempelkan laporannya ke sesi Claude Code proyek Prakasa Workspace.

---

Kamu membantu owner PT Prakasa Foods Nusantara mengumpulkan informasi dari **Accurate Online**, dan bila tersedia dari **SimpliDOTS**, untuk persiapan integrasi. Informasi ini akan dipakai untuk menghubungkan Accurate ke aplikasi internal secara **baca-saja**.

## ATURAN MUTLAK — kamu hanya boleh MELIHAT

Accurate adalah pembukuan resmi perusahaan. Satu klik yang salah bisa mengubah laporan keuangan. Karena itu:

1. **Dilarang menekan tombol atau menu apa pun yang mengubah data atau pengaturan.** Termasuk, tetapi tidak terbatas pada:
   - Simpan, Hapus, Tambah, Baru, Buat, Edit, Ubah;
   - Posting, Proses, Setujui/Approve, Batalkan/Void, Tutup Buku;
   - Import, Kirim Email, Duplikasi, Salin Transaksi;
   - Aktifkan, Nonaktifkan, Pasang/Install, Hapus Pemasangan, Beli, Langganan/Upgrade.
2. **Jangan mengetik apa pun di kolom formulir data.** Mengetik hanya boleh di kotak **pencarian** dan kolom **filter tanggal/periode** pada daftar atau laporan.
3. **Jika sebuah transaksi atau data master terbuka dalam bentuk formulir:**
   - baca isinya tanpa mengubah apa pun;
   - tutup dengan tombol **Tutup, Batal, atau X**;
   - jika muncul pertanyaan "simpan perubahan?", pilih **Tidak / Jangan simpan**.
4. **API Token dan pengaturan integrasi: hanya lihat.** Jangan membuat, mencabut, atau mengubah token, dan jangan mendaftarkan aplikasi baru. Jika ada token tertampil di layar, **jangan menyalinnya dan jangan menuliskannya** di laporan.
5. **Jangan masuk atau keluar akun, dan jangan mengganti password.** Gunakan sesi yang sudah dibuka owner. Jika diminta login, berhenti dan minta owner login sendiri. Jangan pernah mengetik atau menyalin password, kode OTP, atau kredensial apa pun.
6. **Jangan mengubah preferensi, tampilan, atau pengaturan pengguna.**
7. **Unduh file hanya bila diminta di bawah**, dan hanya berupa laporan tampilan (mis. export laporan ke Excel/PDF). Mengunduh tidak mengubah data.
8. **Jika ragu apakah sebuah klik akan mengubah sesuatu, BERHENTI dan tanya owner dulu.** Lebih baik satu pertanyaan kosong daripada satu klik yang salah.
9. **Batasi data pribadi.** Tulis hanya yang diminta: nama dan kode. Jangan menulis nomor telepon, alamat, email, NPWP, atau nomor rekening customer.

## Yang perlu dicari (Accurate Online)

**A. Akses API**
1. Buka **Pengaturan → Accurate Store → tab API Token**. Tulis:
   - apakah menu itu ada;
   - apakah sudah ada token atau integrasi yang aktif, beserta nama aplikasinya saja (jangan menyalin isi token);
   - pesan atau batasan paket yang terlihat.
2. Tulis nama database atau perusahaan yang sedang dibuka di Accurate.
3. Di Accurate Store atau daftar aplikasi terpasang, tulis apakah **SimpliDOTS** tercantum sebagai integrasi aktif.

**B. Format kode customer** (menu Penjualan/Master → Pelanggan; cari dengan kotak pencarian)

Untuk setiap nama berikut, tulis **nomor/kode pelanggan** yang tertera di Accurate, atau "tidak ditemukan":
- Feren Snacks Shop
- OLSE
- Sekian Kopi
- Toko Ahwat

**C. Format kode barang** (menu Persediaan → Barang & Jasa; cari dengan kotak pencarian)

Untuk setiap barang berikut, tulis **kode barang** dan **satuan** yang tertera, atau "tidak ditemukan":
- Gloria Abon Ayam Original 250gr
- Oatside Barista Blend 1L
- Energen Chocolate 34gr

**D. Alur dokumen penjualan** (menu Penjualan)
1. Cari pesanan penjualan **SO64/HRC-PFN/IX/2026**. Tulis:
   - tanggal, nama pelanggan, dan penjual/salesman;
   - nomor pengiriman pesanan (surat jalan) dan nomor faktur penjualan yang terkait;
   - di kolom atau bagian mana keterkaitan itu terlihat (mis. "No. Pesanan" di faktur).
2. Tulis contoh format nomor untuk masing-masing: 3 pesanan penjualan terbaru, 3 pengiriman pesanan terbaru, 3 faktur penjualan terbaru, dan 3 penerimaan penjualan (pembayaran) terbaru. **Nomornya saja.**
3. Tulis daftar **Syarat Pembayaran** yang dipakai (mis. "Net 14", "COD"), namanya saja.
4. Tulis daftar nama **Penjual/Salesman** yang ada, namanya saja.

**E. Angka pembanding, September 2026** (dari laporan, bukan dengan membuka transaksi satu per satu)

Buka laporan penjualan yang tersedia (mis. Laporan Penjualan per Faktur / Rincian Penjualan) dan laporan umur piutang, dengan filter tanggal **1–30 September 2026**. Tulis:
- jumlah faktur penjualan dan total nilai penjualan;
- jumlah pesanan penjualan, bila laporannya ada;
- total piutang yang belum lunas per 30 September 2026;
- nama persis laporan yang dipakai, dan apakah angkanya termasuk atau tidak termasuk PPN.

## Yang perlu dicari (SimpliDOTS) — hanya bila owner punya akses dan sedang login

1. Di menu **Integrasi** (Sales Management Hub), tulis apakah integrasi **Accurate Online** aktif, dan data apa saja yang disinkronkan (mis. pelanggan, barang, pesanan, pembayaran). Jangan mengubah pengaturannya.
2. Tulis apakah ada menu **Open API** atau **API Key** yang tersedia. Hanya lihat; jangan membuat key.

## Format laporan — WAJIB persis seperti ini

Salin kerangka berikut, isi setiap baris, dan tulis "tidak ditemukan" atau "tidak ada akses" bila perlu. Jangan menambahkan data pribadi.

```
LAPORAN CEK ACCURATE & SIMPLIDOTS
Tanggal cek: <tanggal>

[A. AKSES API]
Menu API Token ada: <ya/tidak>
Token/integrasi aktif (nama aplikasi saja): <...>
Batasan paket yang terlihat: <...>
Nama database/perusahaan: <...>
SimpliDOTS tercantum sebagai integrasi di Accurate: <ya/tidak/tidak terlihat>

[B. KODE CUSTOMER]
Feren Snacks Shop: <kode>
OLSE: <kode>
Sekian Kopi: <kode>
Toko Ahwat: <kode>

[C. KODE BARANG]
Gloria Abon Ayam Original 250gr: <kode> | satuan: <...>
Oatside Barista Blend 1L: <kode> | satuan: <...>
Energen Chocolate 34gr: <kode> | satuan: <...>

[D. ALUR DOKUMEN]
SO64/HRC-PFN/IX/2026 -> tanggal: <...> | pelanggan: <...> | salesman: <...>
  surat jalan terkait: <nomor> | faktur terkait: <nomor>
  keterkaitan terlihat di: <kolom/bagian>
Contoh nomor pesanan penjualan: <3 nomor>
Contoh nomor pengiriman pesanan: <3 nomor>
Contoh nomor faktur penjualan: <3 nomor>
Contoh nomor penerimaan penjualan: <3 nomor>
Syarat pembayaran yang dipakai: <daftar>
Nama salesman: <daftar>

[E. ANGKA SEPTEMBER 2026]
Laporan yang dipakai: <nama laporan>
Jumlah faktur: <...> | Total penjualan: <Rp ...> | Termasuk PPN: <ya/tidak>
Jumlah pesanan penjualan: <...>
Total piutang belum lunas per 30-09-2026: <Rp ...>

[F. SIMPLIDOTS]
Integrasi Accurate aktif: <ya/tidak/tidak ada akses>
Data yang disinkronkan: <...>
Menu Open API / API Key tersedia: <ya/tidak/tidak ada akses>

[PENEGASAN]
Saya tidak menekan Simpan/Hapus/Posting/Setujui/Import atau tombol pengubah lain,
tidak mengubah pengaturan, dan tidak menyalin token atau kredensial apa pun: <ya/tidak — jika tidak, jelaskan>
Hal yang membuat saya berhenti dan bertanya ke owner: <... atau "tidak ada">
```

---
