# Uji coba pengguna (UAT): Sales · Warehouse · Procurement · Management

Untuk owner dan Head/Supervisor divisi. Setiap baris: apa yang dilakukan, apa yang seharusnya terlihat. Tandai ✅ bila sesuai, ❌ bila tidak (tulis singkat apa yang terlihat). Semua data dari Accurate tampil **setelah batch divisinya disetujui**; sebelum itu halaman menjelaskan bahwa data menunggu persetujuan.

Aturan yang ikut diuji di setiap bagian:
- Accurate hanya dibaca. Tidak ada tombol di aplikasi yang mengubah data Accurate.
- Harga beli hanya terlihat oleh Supervisor/Head Procurement dan Management Office.
- Warehouse melihat jumlah, tidak pernah harga. Alamat pengiriman tidak disimpan di aplikasi.

## 0. Persetujuan data Accurate (Supervisor/Head setiap divisi, owner)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 0.1 | Buka notifikasi batch baru | Judul "Data Accurate — <divisi> (n perubahan) menunggu persetujuan Anda" dan ringkasan satu kalimat (apa yang berubah, hasil pemeriksaan) | |
| 0.2 | Tekan "Setujui" di notifikasi, lalu konfirmasi | Pesan "Data Accurate disetujui & diterapkan"; tombol hilang; data divisi tampil di menunya | |
| 0.3 | Buka Data Accurate → batch lain → "Tolak" tanpa alasan | Tidak bisa: alasan wajib diisi | |
| 0.4 | Biarkan batch baru lebih dari 8 jam | Notifikasi "Pengingat: data Accurate … menunggu persetujuan" (sekali) | |
| 0.5 | Biarkan lebih dari 1 hari | Head dan owner menerima "Data Accurate <divisi> tertunda 1 hari" (sekali per hari) | |
| 0.6 | Batch Procurement dibuka oleh Supervisor Procurement (bila ada) | Tidak bisa memutuskan; hanya Head Procurement (atau Head MO sebagai pengganti) dan owner | |

## 1. Warehouse (Supervisor/Head/anggota Warehouse)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 1.1 | Warehouse → Hari ini | Perlu perhatian (stok minus, pindah gudang dalam perjalanan, tertahan ≥ 3 hari, SO harus dikirim), Kirim hari ini, PO akan datang (7 hari), Datang hari ini | |
| 1.2 | Tekan angka "Barang stok minus" | Tab Stok dengan saringan Minus | |
| 1.3 | Warehouse → Stok → buka satu barang | Stok total, satuan ("1 Ctns = 6 TetraPk"), cukup untuk berapa hari, stok per gudang, kartu stok (dokumen yang menggerakkan barang), riwayat stok; tanpa harga | |
| 1.4 | Stok → chip "Menipis" | Barang yang cukup kurang dari 7 hari | |
| 1.5 | Warehouse → Jadwal kirim | SO belum terkirim penuh, "Janji kirim" (Tgl kirim SO bila diisi setelah tanggal SO, selain itu "standar 2×24 jam"), "Stok cukup/kurang"; stok dibagi ke SO dengan janji kirim paling awal | |
| 1.6 | Buka satu SO di Jadwal kirim | Janji kirim dan Tgl kirim Accurate; baris: dipesan, terkirim, sisa (dalam satuan barisnya), cukup/kurang per baris; tanpa alamat, tanpa harga | |
| 1.7 | Warehouse → Dokumen Accurate → surat jalan | Tujuan berupa kota ("Jakarta · alamat lengkap di surat jalan Accurate") | |
| 1.8 | Anggota Warehouse membuka Procurement | Tidak ada menu/akses Procurement; bila lewat alamat langsung, dialihkan | |
| 1.9 | Warehouse → Cocokkan Accurate (setelah batch dokumen gudang disetujui) | Chip "Perlu dicek", "Selisih jumlah", "Belum di Accurate", "Belum di aplikasi", "Belum bisa dibandingkan", "Dijelaskan", "Cocok"; per baris: referensi aplikasi, dokumen Accurate, status dan alasannya, umur | |
| 1.10 | Buka satu kelompok "Selisih jumlah" | Per barang dalam satuan dasar: aplikasi, Accurate, selisih (mis. "−6 TetraPk"); pergerakan dan dokumen Accurate yang terlibat; tanpa harga | |
| 1.11 | Supervisor yang tidak mencatat pergerakannya: "Pasangkan dokumen Accurate" dan "Tandai sudah dijelaskan" | Saran dokumen ±14 hari; setelah dipasangkan status berubah; penjelasan wajib alasan; bila data berubah penjelasan gugur | |
| 1.12 | Supervisor yang mencatat pergerakan itu sendiri | Tidak bisa memasangkan atau menjelaskan (pesan pemisahan tugas) | |
| 1.13 | Dokumen "Belum di aplikasi" → "Catat sekarang" | Formulir Barang Masuk/Keluar terisi nomor referensi dan barang dari dokumen Accurate; jumlah diisi dari hitungan fisik | |
| 1.14 | Pergerakan dengan referensi "N/A" atau "0" | Tidak dicocokkan otomatis (harus dipasangkan manual) | |
| 1.15 | Selama batch Warehouse masih menunggu persetujuan, buka tab "Cocokkan Accurate" | Pergerakan yang dokumen Accurate-nya mungkin ada di batch itu tampil "Menunggu data Accurate" (netral), tidak masuk Pusat Eskalasi, dan tidak dihitung di KPI | |
| 1.16 | Jelaskan satu selisih, lalu ada pengiriman kedua dengan referensi PO yang sama yang juga berbeda | Selisih baru muncul lagi sebagai eskalasi terbuka, tidak tertutup oleh penjelasan lama | |
| 1.17 | Buka grup "Belum di aplikasi" yang pergerakannya sudah dicatat dan menunggu approval | Tidak ada tombol "Catat sekarang"; yang ada "Buka pergerakan yang menunggu" | |

## 2. Procurement (Head/Supervisor Procurement, anggota Procurement)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 2.1 | Procurement → Hari ini | PO terlambat, dijadwalkan datang 7 hari, PO tanpa tgl datang, PO lama belum ditutup, barang datang hari ini | |
| 2.2 | Purchase order → chip "Terlambat" → buka PO | Tanggal PO, diharapkan datang + "Terlambat n hari", baris (dipesan/diterima/sisa dalam satuan baris), penerimaan gudang | |
| 2.3 | Sama seperti 2.2 sebagai **Head** | Nilai sebelum PPN, PPN, total, harga satuan per baris | |
| 2.4 | Sama seperti 2.2 sebagai **anggota** | Tidak ada kolom/nilai harga sama sekali | |
| 2.5 | Pemasok → buka satu pemasok | PO terbuka/terlambat, fill rate, tepat waktu, rata-rata waktu datang; catatan bahwa kontak/NPWP/rekening tidak diambil | |
| 2.6 | Harga beli (Head/Supervisor/MO saja) | Harga terakhir per pemasok × barang × satuan, sebelumnya, naik/turun; riwayat dan pemasok lain | |
| 2.7 | Anggota membuka `?tab=prices` | Pesan tidak punya akses; tab lain tampil | |
| 2.8 | Procurement → Saran pesan ulang (Head/Supervisor Procurement, MO) | Chip "Habis sebelum barang datang", "Pesan sekarang", "Habis, perlu dicek" dengan jumlahnya; per barang: stok total, PO berjalan (PO lama tertulis "tidak dihitung"), cukup ± hari, waktu datang, saran pesan dalam satuan beli; tanpa stok per gudang | |
| 2.9 | Tekan ikon hitungan pada satu barang | Rincian: stok, keluar per hari, stok pengaman 7 hari, siklus 14 hari, saran pesan, PO terakhir, PO yang masih berjalan; untuk Head/Supervisor juga harga terakhir bersih sebelum PPN dan perkiraan nilai | |
| 2.10 | Sebelum riwayat stok 7 hari | Banner "Laju keluar dihitung mulai …"; hanya barang habis yang rutin dibeli yang tampil, jumlahnya "Tentukan manual" | |
| 2.11 | Anggota Procurement membuka `?tab=reorder` | Tab tidak ada; pesan tidak punya akses; kartu "Perlu dipesan" di Hari ini juga tidak ada | |
| 2.12 | PO baru dengan Tgl kirim sama dengan tanggal PO | Tidak "Terlambat" dua hari kemudian; tanggal diharapkan = tanggal PO + 14 hari "(perkiraan)" | |
| 2.13 | Procurement → Hari ini, setelah stok disetujui | "Perlu dipesan" sama dengan jumlah baris di Saran pesan ulang; "Habis sebelum barang datang" menampilkan "mulai 7 Okt 2026" sampai riwayat stok 7 hari | |
| 2.14 | Buka eskalasi "Barang habis sebelum barang datang, belum dipesan" | Saran pesan ulang tersaring pemasok itu dengan chip "Belum ada PO"; jumlah baris sama dengan angka di eskalasi (termasuk barang yang stoknya minus di Accurate) | |
| 2.15 | Harga beli MKR-160 (Head Procurement) | Harga terakhir Rp 16.000, bukan baris bonus Rp 2; tidak tercatat "turun 100%" | |

## 3. Sales (Head/Supervisor Sales, salesperson)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 3.1 | Pipeline → omzet per bulan | Omzet sebelum PPN, **bersih retur**, faktur uang muka tidak dihitung | |
| 3.2 | Produk terlaris | Jumlah dalam satuan dasar (mis. "6.426 TetraPk") dengan rincian per satuan di bawahnya | |
| 3.3 | Data Sales → Umur piutang | Tabel syarat bayar × umur (belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari) | |
| 3.4 | "Lihat faktur yang lewat jatuh tempo" | Daftar faktur tersaring, tertulis "hanya yang lewat jatuh tempo" | |
| 3.5 | Data Sales → Tukar faktur → catat satu faktur | Formulir: tanggal tukar, no. tanda terima, janji bayar, catatan; setelah simpan pindah ke "Sudah tukar faktur" | |
| 3.6 | Batalkan tukar faktur | Faktur kembali ke "Belum"; catatan lama tetap tersimpan di riwayat | |
| 3.7 | Buka profil customer | Omzet 12 bulan (bersih), faktur, piutang, lewat jatuh tempo, faktur/pembayaran terakhir, produk teratas, umur piutang customer | |
| 3.8 | Salesperson membuka Umur piutang | Hanya faktur miliknya/customer-nya | |

## 4. Management (Supervisor/Head Management Office, owner)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 4.1 | Dashboard manajemen → KPI | Omzet bulan ini (bersih retur), PO menunggu barang, stok minus, perlu dibereskan di Accurate, data Accurate menunggu keputusan | |
| 4.2 | Pusat Eskalasi | PO terlambat datang, faktur belum tukar faktur, stok minus, batch tertunda — masing-masing dengan tautan ke halamannya | |
| 4.3 | Target → buat target "PO datang tepat waktu" | Target bisa dibuat; realisasi terisi setelah penerimaan gudang disetujui | |
| 4.4 | Data Accurate → "Perlu dibereskan di Accurate" | Stok minus (terparah di atas), selisih stok, pindah gudang belum diterima, tanggal jauh di depan, SO lama, nama satuan tidak seragam; bisa diekspor | |
| 4.5 | KPI "SO tepat waktu & lengkap bulan ini" dan eskalasi "SO lewat janji kirim" | "x dari y SO"; eskalasi hanya SO sejak 22 September yang lewat janji, tautannya membuka Jadwal kirim tersaring "Lewat janji kirim" | |
| 4.6 | Target → buat target "SO terkirim tepat waktu & lengkap" untuk Warehouse | Realisasi terisi bila ada minimal 5 SO jatuh tempo pada periode itu; sebelumnya "Belum ada data" | |
| 4.7 | KPI "Barang perlu dipesan" dan eskalasi "Barang habis sebelum barang datang, belum dipesan" | KPI tertahan ("Laju keluar dihitung setelah 7 hari riwayat stok") sampai data cukup; eskalasi satu baris per pemasok, hanya hari (tanpa jumlah/rupiah), tautan ke Saran pesan ulang tersaring pemasok itu | |
| 4.8 | Insight & Manajemen → Alur & Margin → Alur penjualan / pembelian | Jumlah SO dipesan → terkirim lengkap → ditagih → lunas dengan median/rata-rata/p90 hari; PO dibuat → datang → lengkap; banner bila data Accurate masih menunggu persetujuan | |
| 4.9 | Tab "Perkiraan margin (harga PO)" (hanya Head/Supervisor MO dengan izin harga beli) | Omzet, perkiraan margin, cakupan harga; catatan "Tidak termasuk rebate/program prinsipal di luar PO; bukan HPP akuntansi Accurate"; banner bila cakupan < 80% | |
| 4.10 | Tab "Lambat laku" | Pernah laku tapi tidak laku ≥ 90 hari, lambat 60–89 hari, belum pernah terjual (cek kode lama); rupiah hanya untuk yang boleh melihat harga beli | |
| 4.11 | Head divisi membuka `/management/flow` | Tidak bisa (khusus manajemen) | |
| 4.12 | Supervisor MO yang izin harga belinya dicabut: buka Dashboard dan Target | KPI "Nilai PO bulan ini" berbunyi "Hanya untuk yang berwenang melihat harga beli"; metrik "Nilai PO (sebelum PPN)" tidak ada di Target dan diberi catatan; tidak ada rupiah pembelian | |
| 4.13 | Pusat Eskalasi sebagai Management Office | Judul baris hanya menjadi tautan bila halamannya boleh dibuka (mis. "Surat jalan belum difaktur" tampil tanpa tautan karena MO tidak membuka Data Sales) | |
| 4.14 | Alur & Margin → Alur penjualan sebagai Management Office | Tidak ada tombol "Umur piutang"; tombol Target membuka Target modul Procurement | |
| 4.15 | KPI tanpa angka (mis. OTIF 30 hari sebelum ada SO jatuh tempo) | Kartu menampilkan alasannya (mis. "Belum ada SO jatuh tempo 30 hari terakhir"), bukan hanya "Belum ada data" | |

## 5. Prakasa AI (siapa saja, sesuai hak aksesnya)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 5.1 | Percakapan pribadi (riset web mati): "stok Oatside berapa?" | Jawaban dengan jumlah, satuan, dan "data per" (tanggal disetujui); tanpa harga | |
| 5.2 | Sama, sebagai anggota Procurement | Prakasa AI menjelaskan stok tidak termasuk hak aksesnya | |
| 5.3 | "harga beli Oatside berapa?" (sebagai Head Procurement) | Prakasa AI tidak membaca harga; diarahkan ke tab Harga beli | |
| 5.4 | Tanyakan stok/PO di percakapan bersama divisi, atau saat riset web menyala | Disarankan membuka percakapan pribadi (dan mematikan riset web); tidak ada angka stok/PO | |
| 5.5 | Setelah AI membaca stok, ubah percakapan jadi "divisi" | Ditolak: berisi data stok/PO | |
| 5.6 | Setelah AI membaca stok, tekan Export (XLSX/DOCX) pada jawabannya | Ditolak: tidak disimpan ke Shared Drive/Dokumen; salin manual bila perlu | |
| 5.7 | Setelah AI membaca stok, nyalakan "Riset web" di percakapan yang sama | Ditolak dengan pesan untuk membuat percakapan baru | |
| 5.8 | Tanyakan "notifikasi saya" di percakapan bersama divisi | Tidak dibacakan; disarankan membuka percakapan pribadi | |

## 6. Keamanan data (diuji siapa saja)

| # | Langkah | Yang seharusnya terlihat | Hasil |
|---|---|---|---|
| 6.1 | Cari harga beli sebagai anggota Warehouse/Sales/Procurement | Tidak ada di halaman mana pun | |
| 6.2 | Cari alamat, telepon, NPWP pemasok/customer dari Accurate | Tidak ada | |
| 6.3 | Ubah sesuatu di Accurate (mis. tutup SO) | Dalam ±5 menit muncul batch baru; setelah disetujui, aplikasi ikut berubah. Aplikasi tidak pernah mengubah Accurate | |

---
Semua butir program (Gelombang 1–4) sudah tercakup di daftar ini.
