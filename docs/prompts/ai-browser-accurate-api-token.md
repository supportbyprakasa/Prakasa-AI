# Prompt untuk Claude di browser — Tab Accurate: siapkan API Token baca-saja

Buka Accurate Online di satu tab, login sendiri, lalu salin semua teks di antara dua garis di bawah ke Claude di browser pada tab itu. Setelah selesai, tempelkan **laporannya** (bukan token) ke sesi Claude Code proyek Prakasa Workspace.

---

Kamu membantu owner PT Prakasa Foods Nusantara menyiapkan **API Token baca-saja** di **Accurate Online**. Token ini dipakai aplikasi internal "Prakasa Workspace" untuk **membaca** data penjualan.

Aplikasi itu tidak pernah menulis ke Accurate. Data yang dibacanya juga tidak langsung dipakai: setiap tarikan harus disetujui Supervisor atau Head divisi di aplikasi lebih dulu.

Tugasmu ada dua:

- **Bagian A:** melihat apakah Accurate punya fitur persetujuan (approval) untuk dokumen penjualan. Hanya melihat.
- **Bagian B:** mengisi formulir pembuatan API Token dengan hak akses **lihat saja**. Tombol simpan terakhir **ditekan owner sendiri**, bukan kamu.

## ATURAN MUTLAK

Accurate adalah pembukuan resmi perusahaan. Satu klik yang salah bisa mengubah laporan keuangan.

1. **Pastikan databasenya benar sebelum melakukan apa pun.** Database yang terbuka harus **"PT. PRAKASA FOODS NUSANTARA"**.
   - Jika yang terbuka "prakasa food ( Trial )" atau database lain, **berhenti**. Minta owner membuka database produksi sendiri.
2. **Jangan menyentuh transaksi atau data master.** Dilarang menekan:
   - Simpan, Hapus, Tambah, Baru, Edit, Ubah;
   - Posting, Proses, Setujui/Approve, Tolak, Batalkan/Void, Tutup Buku;
   - Import, Kirim Email, Duplikasi;
   - Aktifkan/Nonaktifkan fitur, Beli, Langganan/Upgrade.

   Ini berlaku di halaman mana pun **selain formulir API Token di Bagian B**.
3. **Jangan mengubah pengaturan.** Di Bagian A kamu hanya **membaca** halaman pengaturan. Jangan mencentang, mengubah, atau menyimpan apa pun di sana.
4. **Bagian B: hanya mengisi formulir.** Kamu boleh mengetik nama token dan mencentang hak akses **lihat/view** yang tercantum di bawah. **Kamu tidak boleh menekan tombol simpan/buat/generate.** Tombol itu ditekan owner setelah memeriksa isian.
5. **Hak akses selain "lihat" dilarang.** Jangan mencentang hak apa pun yang mengandung:
   - simpan/save, ubah/edit;
   - hapus/delete;
   - setujui/approve;
   - kirim, import, atau "semua/all".

   Jika pilihannya hanya "akses penuh" tanpa opsi lihat saja, **berhenti** dan laporkan. Jangan dibuat.
6. **Token dan kredensial rahasia.** Setelah owner membuat token:
   - jangan membaca, menyalin, meringkas, atau menuliskan isi token, signature secret, client secret, maupun kode apa pun yang tampil;
   - jangan mengambil screenshot bagian itu;
   - owner sendiri yang menyalinnya ke file lokal di komputernya.
7. **Jangan login atau logout, dan jangan mengetik password atau OTP.** Jika diminta login, berhenti dan minta owner melakukannya.
8. **Jangan mencabut, mengubah, atau menghapus token dan integrasi yang sudah ada**, termasuk integrasi SimpliDOTS.
9. **Jika ragu apakah sebuah klik mengubah sesuatu, BERHENTI dan tanya owner.**
10. **Jangan menulis data pribadi** (telepon, alamat, email, NPWP, rekening) di laporan.

## Bagian A — Fitur persetujuan di Accurate (HANYA MELIHAT)

Tujuannya agar aplikasi hanya membaca dokumen yang sudah final di Accurate.

1. Cari di menu **Pengaturan → Preferensi** (atau menu serupa) apakah ada fitur **Persetujuan / Approval** untuk transaksi. Tulis:
   - nama menunya;
   - apakah fitur itu **aktif** atau **tidak aktif**;
   - dokumen apa saja yang tercakup (pesanan penjualan, pengiriman pesanan, faktur penjualan, penerimaan penjualan).

   Jangan mengubah centangnya.
2. Buka **daftar Pesanan Penjualan** (Penjualan → Pesanan Penjualan). Tulis nama semua kolom atau filter **status** yang terlihat (mis. "Status", "Status Persetujuan", "Menunggu Persetujuan", "Draf", "Terproses"), beserta nilai-nilai status yang muncul di daftar bulan **September 2026**. Cukup nama statusnya, tanpa membuka formulir transaksi.
3. Lakukan hal yang sama untuk daftar **Faktur Penjualan**.
4. Tulis apakah ada dokumen September 2026 yang berstatus **menunggu persetujuan** atau **draf**, dan berapa jumlahnya per jenis dokumen. Cukup hitung dari daftar.

## Bagian B — Isi formulir API Token baca-saja (TOMBOL SIMPAN DITEKAN OWNER)

1. Buka **Pengaturan → Accurate Store → API Token** (nama menu bisa sedikit berbeda).
2. Sebelum membuat yang baru, tulis daftar token atau integrasi yang **sudah ada**: nama aplikasinya saja, tanpa isi token. Jangan mengubahnya.
3. Tekan tombol untuk membuat token baru hanya sampai **formulirnya terbuka**. Jika tombol itu langsung membuat token tanpa formulir, **berhenti** dan minta owner menekannya sendiri.
4. Isi formulir:
   - **Nama/deskripsi:** `Prakasa Workspace - baca saja`
   - **Database:** PT. PRAKASA FOODS NUSANTARA (bila diminta)
   - **Hak akses (scope), hanya yang "lihat/view":**

     | Data | Pilih hak "lihat/view" untuk |
     |---|---|
     | Pelanggan | customer |
     | Barang & Jasa | item |
     | Pesanan Penjualan | sales order |
     | Pengiriman Pesanan | delivery order |
     | Faktur Penjualan | sales invoice |
     | Penerimaan Penjualan | sales receipt |
     | Retur Penjualan | sales return |
     | Karyawan / Penjual | employee |

     Jika nama scope-nya teknis (mis. berakhiran `_view`, `_save`, `_delete`), centang **hanya yang berakhiran `_view`** untuk data di atas.
   - Jika ada pilihan **masa berlaku**, pilih yang paling panjang yang tersedia dan tulis pilihannya di laporan.
5. **Berhenti di sini.** Jangan menekan Simpan/Buat/Generate. Tulis ke owner:

   > Formulir sudah terisi dengan hak lihat saja. Silakan periksa lalu tekan tombol simpan sendiri. Setelah token muncul, salin token dan signature secret ke file lokal di komputer Anda (mis. `accurate-token.txt` di Desktop). Jangan tempel ke chat mana pun, termasuk ke saya.

6. Setelah owner bilang sudah menyimpan, **tanpa membaca isi token**, tulis:
   - nama token yang tampil di daftar;
   - daftar hak akses yang tercatat pada token itu;
   - tanggal berlakunya.

## Format laporan — WAJIB persis seperti ini

```
LAPORAN API TOKEN ACCURATE — [tanggal]

0. Database yang terbuka: [nama persis]

A. Fitur persetujuan
A1. Menu fitur persetujuan: [nama menu / tidak ditemukan] — status: [aktif / tidak aktif / tidak ada]
A2. Dokumen yang tercakup: [daftar / tidak ada]
A3. Kolom/filter status di daftar Pesanan Penjualan: [nama kolom] — nilai yang muncul Sep 2026: [daftar]
A4. Kolom/filter status di daftar Faktur Penjualan: [nama kolom] — nilai yang muncul Sep 2026: [daftar]
A5. Dokumen Sep 2026 menunggu persetujuan / draf: SO [n], Faktur [n], lainnya [..]

B. API Token
B1. Token/integrasi yang sudah ada sebelumnya: [nama aplikasi saja / tidak ada]
B2. Pilihan hak akses yang tersedia: [ada opsi lihat saja: ya/tidak] — [catatan]
B3. Formulir diisi: nama [..], database [..], masa berlaku [..]
B4. Hak yang dicentang: [daftar]
B5. Disimpan oleh owner: [ya / belum]
B6. Hak akses yang tercatat pada token setelah disimpan: [daftar]

C. Konfirmasi keamanan
C1. Saya tidak menekan Simpan/Setujui/Hapus/Posting di transaksi, master, maupun pengaturan: [ya]
C2. Saya tidak menekan tombol simpan/buat token; owner yang menekannya: [ya]
C3. Saya tidak membaca, menyalin, atau menulis isi token/secret: [ya]
C4. Hal yang membuat saya berhenti atau ragu: [.. / tidak ada]
```

---

## Setelah laporan masuk (untuk owner)

1. Tempelkan **laporannya saja** ke sesi Claude Code. Jangan sertakan token.
2. Beri tahu lokasi file token di komputer Anda (mis. `~/Desktop/accurate-token.txt`). Claude Code akan memindahkannya ke konfigurasi lokal backend (`.env`, tidak ikut ke git) tanpa menampilkan isinya.
3. Tarikan pertama dari Accurate akan muncul sebagai batch di **Data Sales → Data Accurate**. Batch itu baru dipakai setelah disetujui Supervisor atau Head divisi.
