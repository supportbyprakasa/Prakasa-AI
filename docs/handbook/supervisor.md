# Panduan Prakasa Workspace — Supervisor

Untuk: Supervisor di semua divisi. Dibuat otomatis dari panduan di aplikasi (menu **Panduan**, alamat `/panduan`); jangan diedit manual — ubah `frontend/src/pages/handbook/handbookContent.js` lalu jalankan `node scripts/build-handbook-docs.mjs` dari folder `frontend`.

Isi panduan mengikuti peran: setiap orang hanya membaca bab untuk menu yang bisa ia buka. Berkas ini menggabungkan semua divisi pada tingkat yang sama; bab yang hanya untuk sebagian divisi ditandai.

## Daftar isi

1. [Mulai memakai Prakasa Workspace](#mulai)
2. [Kerja harian](#kerja-harian)
3. [Komunikasi: Gmail, Google Chat, Groups](#komunikasi)
4. [Dokumen, template, dan tanda tangan](#dokumen)
5. [Prakasa AI](#prakasa-ai)
6. [Sales: pelanggan, leads, dan Data Sales](#sales)
7. [Retail Commerce: kinerja marketplace](#retail-commerce)
8. [Marketing: produk, channel, dan kampanye](#marketing)
9. [Warehouse: barang masuk, keluar, dan stok](#warehouse)
10. [Procurement: PO, pemasok, dan barang datang](#procurement)
11. [Finance: piutang dan utang](#finance)
12. [People & Culture: onboarding, offboarding, dan GA](#people-culture)
13. [IT: perangkat, langganan, dan infrastruktur](#it-aset)
14. [Data Accurate: memeriksa dan menyetujui](#data-accurate)
15. [Dashboard divisi dan grafik capaian bulanan](#dashboard-divisi)
16. [Laporan: Google Analytics dan log aktivitas](#laporan)
17. [Glosarium](#glosarium)
18. [Kalau ada masalah](#bantuan)

<a id="mulai"></a>

## Mulai memakai Prakasa Workspace

*Bagian: Mulai*

Prakasa Workspace adalah ruang kerja internal Prakasa Foods Nusantara: dokumen, approval, operasional divisi, Google Workspace, dan Prakasa AI dalam satu aplikasi. Bab ini menjelaskan cara masuk, membaca menu, mencari, dan menerima notifikasi.

**Siapa yang memakai:** Semua karyawan yang punya akun.

**Menu:** `/`

<a id="mulai-masuk-google"></a>

### Masuk dengan akun Google kantor

Cara paling mudah adalah memakai akun Google kantor Anda (alamat email perusahaan).

1. Buka alamat Prakasa Workspace di browser (Chrome disarankan).
2. Di halaman "Masuk", klik tombol "Masuk dengan Google".
3. Pilih akun Google kantor Anda, lalu ikuti langkah dari Google.
4. Setelah berhasil, Anda langsung masuk ke halaman "Dashboard".

> **Catatan:** Tombol "Masuk dengan Google" hanya muncul bila fitur ini sudah dinyalakan oleh administrator. Bila tidak ada, pakai email dan kata sandi.

<a id="mulai-masuk-kata-sandi"></a>

### Masuk dengan email dan kata sandi

1. Di halaman "Masuk", isi "Email" dengan email kantor Anda.
2. Isi "Kata sandi". Klik ikon mata ("Tampilkan kata sandi") bila ingin memeriksa ketikan Anda.
3. Klik "Masuk".

**Pesan yang mungkin muncul**

| Pesan | Artinya |
| --- | --- |
| Isi email. / Isi kata sandi. | Kolom masih kosong. |
| Gagal masuk. Periksa email dan kata sandi. | Email atau kata sandi salah. Coba lagi dengan teliti. |
| Gagal masuk dengan Google. | Akun Google yang dipilih bukan akun kantor, atau belum terdaftar. |

Akun belum dibuat atau dinonaktifkan? Hubungi Administrator Sistem atau Super Admin, seperti tertulis di bawah tombol "Masuk". Lupa kata sandi? Hanya Super Admin yang dapat mereset kata sandi; tidak ada reset mandiri.

<a id="mulai-ganti-kata-sandi"></a>

### Mengganti kata sandi sementara (pertama kali masuk)

Kata sandi dikelola oleh Super Admin. Bila Super Admin membuatkan atau mereset kata sandi Anda, kata sandi itu bersifat sementara. Saat masuk berikutnya, aplikasi langsung membuka halaman "Ganti kata sandi sementara".

1. Isi "Kata sandi saat ini" dengan kata sandi sementara dari Super Admin.
2. Isi "Kata sandi baru": minimal 10 karakter, memuat huruf dan angka, berbeda dari kata sandi lama, dan tidak memuat nama email Anda.
3. Ketik sekali lagi di "Ulangi kata sandi baru".
4. Klik "Simpan kata sandi". Anda lalu masuk seperti biasa.

> **Perhatian:** Jangan pernah memberitahukan kata sandi kepada siapa pun, termasuk tim IT. Jangan menulis kata sandi di tiket, chat, atau Prakasa AI.

> **Catatan:** Lupa kata sandi atau ingin menggantinya? Tidak ada reset atau ganti kata sandi mandiri di aplikasi. Hubungi Super Admin: ia mereset kata sandi Anda menjadi kata sandi sementara, lalu Anda membuat kata sandi baru saat masuk berikutnya. Bila akun Anda bisa masuk dengan Google, Anda tetap bisa masuk tanpa kata sandi.

<a id="mulai-akun-saya"></a>

### Akun saya: profil, bahasa, beranda, dan sesi

Halaman "Akun saya" berisi hal-hal tentang akun Anda sendiri. Bukanya dari bar atas: klik foto atau inisial Anda di pojok kanan atas, lalu pilih "Akun saya".

**Isi halaman "Akun saya"**

| Bagian | Isinya |
| --- | --- |
| Profil | Nama, email kerja, divisi, peran, dan cara masuk akun Anda. Hanya untuk dibaca: nama, divisi, dan peran diatur Administrator dan disinkronkan dari Google Workspace. |
| Bahasa | Bahasa tampilan: Indonesia atau English. Pilihan disimpan di akun Anda, jadi ikut dipakai saat Anda masuk dari perangkat lain. |
| Beranda | Tombol "Tampilkan ringkasan pagi di beranda" untuk menampilkan atau menyembunyikan kartu "Ringkasan pagi". |
| Kata sandi | Hanya penjelasan: kata sandi dikelola oleh Super Admin. Tidak ada formulir ganti kata sandi di sini. |
| Sesi | Tombol "Keluar dari semua perangkat". |

Mengganti bahasa: di bagian "Bahasa", pilih "Indonesia" atau "English". Halaman dimuat ulang dalam bahasa yang dipilih. Tombol "ID | EN" di bar atas melakukan hal yang sama dan juga menyimpan pilihan ke akun Anda.

> **Catatan:** Kata sandi dikelola oleh Super Admin. Untuk mengganti atau memulihkan kata sandi, hubungi Super Admin; setelah direset, Anda membuat kata sandi baru saat masuk berikutnya. Akun yang masuk dengan Google tidak perlu kata sandi.

Perangkat hilang atau lupa keluar di komputer lain? Di bagian "Sesi", klik "Keluar dari semua perangkat", lalu konfirmasi. Semua sesi akun Anda berakhir, termasuk di perangkat yang sedang dipakai, dan Anda perlu masuk lagi.

> **Catatan:** Data kepegawaian seperti gaji, rekening, dan nomor identitas tidak ada di Prakasa Workspace. Data itu dikelola di KantorKu.

<a id="mulai-akses-belum-siap"></a>

### Muncul "Akses belum disiapkan"

Halaman ini muncul bila akun Anda sudah ada tetapi belum punya divisi dan peran yang aktif.

1. Minta Administrator Sistem (atau Super Admin) menetapkan divisi dan peran Anda.
2. Setelah dikabari, klik "Periksa lagi".
3. Bila ingin keluar dulu, klik "Keluar".

<a id="mulai-beranda"></a>

### Dashboard (halaman awal)

Setelah masuk, Anda melihat "Dashboard": sapaan, tanggal hari ini, dan ringkasan pekerjaan yang menunggu Anda.

| Bagian | Isinya |
| --- | --- |
| Pintasan | Tombol cepat ke Gmail, Google Chat, Kalender, Docs, My Drive, Prakasa AI, dan Tiket IT (sesuai akses Anda). |
| Perlu tindakan Anda | Hal yang menunggu keputusan atau balasan Anda, diurutkan dari yang paling lama menunggu. Contoh: dokumen menunggu tanda tangan, pembayaran menunggu persetujuan. |
| Permintaan saya | Permintaan yang Anda ajukan dan masih berjalan, misalnya tiket IT atau permintaan GA. |
| Antrean tim | Pekerjaan tim Anda yang belum diambil. |
| Notifikasi | Notifikasi terbaru, dengan tautan "Lihat semua notifikasi". |

> **Tips**
>
> - Klik "Muat ulang" untuk memperbarui ringkasan.
> - Bila tertulis "Semua beres", tidak ada yang menunggu Anda saat ini.

<a id="mulai-ringkasan-pagi"></a>

### Ringkasan pagi di beranda

Kartu "Ringkasan pagi" di bagian atas "Dashboard" merangkum hari Anda dalam satu daftar: yang perlu Anda tindak lebih dulu ada di paling atas. Kartu ini disusun langsung dari data aplikasi, tanpa model AI, dan hanya memuat pekerjaan serta modul yang boleh Anda buka.

**Isi kartu "Ringkasan pagi"**

| Bagian | Isinya |
| --- | --- |
| Kalimat pembuka | Sapaan dan jumlah hal yang perlu Anda tindak hari ini, misalnya persetujuan yang menunggu dan tugas yang lewat tenggat. |
| Baris | Satu hal per baris: jumlahnya, tingkatnya ("Mendesak", "Perlu perhatian", atau "Info"), sudah berapa lama menunggu, dan paling banyak tiga contoh. Klik baris untuk membuka halamannya. |
| Angka modul | Sesuai peran Anda. Contoh: customer dormant untuk Sales, stok minus untuk Warehouse, PO terlambat untuk Procurement, eskalasi dan batch Data Accurate untuk Supervisor dan Head. |

**Memakai ringkasan pagi**
1. Buka "Dashboard". Baca kalimat pembuka, lalu kerjakan dari baris paling atas.
2. Klik sebuah baris untuk membuka halamannya.
3. Klik ikon "Tanya Prakasa AI tentang ini" di kanan baris bila ingin dibantu. Panel Prakasa AI terbuka dengan pertanyaan yang sudah tertulis; periksa, lalu kirim sendiri.
4. Klik "Ciutkan ringkasan pagi" di pojok kartu bila hanya ingin melihat kalimat pembukanya. Pilihan ini diingat di browser Anda.

> **Tips**
>
> - Ringkasan diperbarui setiap beberapa menit. Klik "Muat ulang" untuk angka terbaru.
> - Tidak ingin melihat kartu ini? Buka "Akun saya", bagian "Beranda", lalu matikan "Tampilkan ringkasan pagi di beranda".
> - Bertanya "Apa yang perlu saya kerjakan hari ini?" ke Prakasa AI memberi daftar yang sama.

> **Catatan:** Ringkasan pagi tidak mengirim notifikasi atau email, dan tidak menampilkan nilai rupiah. Cuti, absensi, dan gaji ada di KantorKu, bukan di sini.

<a id="mulai-menu-samping"></a>

### Membaca menu samping

Menu di sebelah kiri hanya berisi halaman yang boleh Anda buka. Menu orang lain bisa berbeda karena disesuaikan dengan divisi dan peran masing-masing.

- Paling atas: "Dashboard", "Notifikasi", dan "Prakasa AI".
- Di bawahnya: pekerjaan divisi Anda sendiri, supaya paling mudah dijangkau.
- Lalu grup lain: "Kerja harian", "Komunikasi", "Dokumen", modul divisi, "Laporan", dan administrasi (khusus admin).
- Grup dengan beberapa menu bisa dibuka-tutup; aplikasi mengingat pilihan Anda di browser ini.

**Di laptop dan ponsel**
1. Di layar lebar, klik ikon garis tiga ("Buka menu utama") di kiri atas untuk mengecilkan menu menjadi ikon saja.
2. Di ponsel atau layar kecil, menu tersembunyi. Ketuk ikon garis tiga untuk membukanya, lalu pilih halaman.

> **Catatan:** Membuka alamat halaman yang bukan untuk peran Anda (misalnya dari tautan yang dikirim orang lain) akan mengembalikan Anda ke Dashboard. Itu normal, bukan error.

<a id="mulai-pencarian"></a>

### Mencari menu dan data

Kotak "Cari di Prakasa Workspace" ada di tengah bar atas. Di ponsel, kotak ini menjadi ikon kaca pembesar "Cari".

1. Klik kotak pencarian, lalu ketik nama menu atau kata kunci.
2. Bagian "Modul" menampilkan menu yang cocok. Klik untuk membukanya.
3. Untuk mencari data (dokumen, task, pelanggan, perangkat, dan lainnya), pilih "Cari "…" di semua modul". Halaman "Pencarian" terbuka.
4. Di halaman "Pencarian", saring hasil dengan chip jenis data (Dokumen, Task, Pelanggan, dan seterusnya).

> **Catatan:** Pencarian hanya menampilkan data yang boleh Anda buka. Bila tertulis "Sebagian modul gagal dimuat", hasilnya mungkin belum lengkap; coba lagi sebentar lagi.

<a id="mulai-notifikasi"></a>

### Notifikasi dan email

Ikon lonceng "Notifikasi" di bar atas menampilkan titik bila ada yang belum dibaca. Klik untuk melihat 3 notifikasi terakhir, atau "Lihat semua notifikasi" untuk halaman lengkap.

**Di halaman "Notifikasi"**
1. Pilih chip "Semua", "Belum dibaca", atau "Dibaca".
2. Saring dengan "Jenis notifikasi", "Terkait dengan", serta tanggal "Dari" dan "Sampai". Klik "Hapus filter" untuk kembali.
3. Klik sebuah notifikasi atau pilih "Buka" di menu titik tiga untuk menuju halamannya.
4. Klik "Tandai dibaca" / "Tandai belum dibaca" per notifikasi, atau "Tandai semua dibaca" sekaligus.
5. Untuk merapikan daftar, buka "Aksi lainnya" lalu "Bersihkan yang dibaca". Notifikasi yang belum dibaca tidak ikut terhapus.

**Kapan Anda menerima notifikasi**

| Saluran | Kapan | Contoh |
| --- | --- | --- |
| Di aplikasi (lonceng) | Ada yang menyangkut pekerjaan atau permintaan Anda sendiri. | Tugas untuk Anda, status tiket Anda berubah, komentar untuk Anda, tenggat Anda. |
| Di aplikasi + email | Ada yang menunggu keputusan atau tindakan Anda, dan terlambat itu merugikan perusahaan. | Approval dan pengingatnya, tanda tangan, data Accurate menunggu persetujuan, tugas onboarding/offboarding, pembayaran dibayar atau ditolak. |
| Tidak dikirim | Perubahan kecil yang sudah terlihat di Project Tracker atau Space Google Chat. | Kartu dipindah, checklist, watcher, sprint. |

> **Tips**
>
> - Email dari aplikasi selalu berjudul diawali "[Prakasa Workspace]" dan berisi tautan ke halamannya.
> - Pengingat harian dikirim paling banyak sekali sehari untuk hal yang sama.

<a id="mulai-akun"></a>

### Akun, profil, dan keluar

Klik foto atau inisial Anda di kanan atas ("Menu akun") untuk melihat nama dan email akun yang sedang dipakai, serta tombol "Keluar".

- Nama, email kerja, dan divisi diatur oleh Administrator Sistem di menu Pengguna.
- Jabatan, atasan, telepon kerja, dan lokasi diatur oleh People & Culture di Direktori.
- Absensi, cuti, dan slip gaji tetap di KantorKu. Prakasa Workspace tidak menyimpan data itu.

> **Tips**
>
> - Selalu klik "Keluar" bila memakai komputer bersama.

<a id="mulai-bahasa"></a>

### Bahasa / Language

Prakasa Workspace bisa ditampilkan dalam bahasa Indonesia atau bahasa Inggris. Tombol "ID | EN" ada di bar atas, di sebelah lonceng notifikasi, dan di pojok kanan atas halaman "Masuk".

1. Klik "EN" untuk bahasa Inggris, atau "ID" untuk kembali ke bahasa Indonesia. Di ponsel tombolnya satu: ketuk untuk berganti bahasa.
2. Halaman dimuat ulang, lalu semua menu, tombol, dan keterangan tampil dalam bahasa yang dipilih.
3. Pilihan bahasa tersimpan di akun Anda dan di browser yang dipakai. Saat Anda masuk di komputer atau browser lain, bahasa akun Anda langsung dipakai.

**Yang tidak ikut diterjemahkan**
- Data dari Accurate: nama pelanggan, barang, pemasok, gudang, dan nomor dokumen.
- Semua yang diketik orang: judul, catatan, alasan, komentar, isi email dan chat.
- Dokumen cetak dan ekspor (surat jalan, invoice, BAST) tetap berbahasa Indonesia.
- Jawaban Prakasa AI mengikuti bahasa pertanyaan Anda.

> **Catatan:** Angka dan rupiah ditulis sama di kedua bahasa, misalnya Rp 1.250.000. Tanggal dan jam mengikuti bahasa yang dipilih.

<a id="mulai-bantuan-it-cepat"></a>

### Tombol "Butuh bantuan IT"

Ada masalah laptop, akun, software, atau internet? Pakai tombol "Butuh bantuan IT" di bar atas, dari halaman mana pun.

1. Klik "Butuh bantuan IT".
2. Pilih "Jenis masalah": Perangkat rusak atau bermasalah, Akses, akun, atau software, Internet atau jaringan, atau Minta perangkat baru.
3. Isi "Judul singkat" (contoh: Laptop tidak bisa menyala) dan "Ceritakan masalahnya": apa yang terjadi, sejak kapan, apa yang sudah dicoba.
4. Pilih "Urgensi" dan, bila terkait, "Perangkat".
5. Klik "Kirim ke tim IT". Permintaan menjadi tiket di Tiket IT; klik "Lihat tiket" untuk memantaunya.

> **Perhatian:** Jangan menulis password di formulir ini.

<a id="kerja-harian"></a>

## Kerja harian

*Bagian: Kerja harian*

Alat yang dipakai semua divisi setiap hari: Project Tracker, Kalender, Tiket IT, Layanan GA, Direktori, dan Pengajuan pembayaran.

**Siapa yang memakai:** Semua karyawan (setiap bagian muncul sesuai akses Anda).

<a id="kerja-harian-project-tracker"></a>

### Project Tracker

Setiap Space Google Chat bisa punya project sendiri: board, backlog, sprint, dan laporan. Menu "Project Tracker" menampilkan semua project yang Anda ikuti, dengan jumlah issue belum selesai, dikerjakan, selesai, dan terlambat.

**Mengaktifkan project di sebuah Space**
1. Buka "Google Chat", pilih Space tim Anda, lalu tab "Tugas".
2. Isi "Kunci project": 2–10 huruf kapital atau angka, misalnya MKT. Issue akan bernomor MKT-1, MKT-2, dan seterusnya.
3. Nyalakan "Kirim update ke space" bila ingin perubahan diumumkan di Space.
4. Klik "Aktifkan project tracker".

**Membuat dan mengerjakan issue**
1. Klik "Buat issue".
2. Pilih "Tipe" (Task, Bug, Story, Epic, Sub-task), isi "Judul", "Deskripsi", "Prioritas", "Penanggung jawab", "Jatuh tempo", dan bila perlu "Sprint".
3. Simpan. Issue muncul di kolom pertama board ("To Do").
4. Seret kartu ke "In Progress", "In Review", lalu "Done" sesuai kemajuan.
5. Klik kartu untuk membuka detail: menulis komentar ("Kirim komentar"), menambah sub-issue, atau "Salin tautan".

**Tampilan**

| Tampilan | Gunanya |
| --- | --- |
| Papan | Kartu per kolom status. Bila tertulis "Melebihi batas WIP", kolom itu terlalu penuh. |
| Backlog | Daftar issue per sprint. Seret issue antar-sprint, "Buat sprint", "Mulai sprint", "Selesaikan sprint". |
| Daftar | Semua issue dalam tabel, bisa dicari dan disaring. |
| Laporan | Per status, per tipe, per anggota, burndown sprint aktif, dan velocity. |

> **Catatan:** Anda mendapat notifikasi bila issue ditugaskan ke Anda, ada komentar di issue Anda, atau issue Anda selesai/dibuka lagi. Perpindahan kartu tidak dikirim sebagai notifikasi karena sudah terlihat di board dan Space.

<a id="kerja-harian-papan-tugas"></a>

### Papan tugas dan task

Task juga bisa datang dari Prakasa AI, Google Chat, atau dibuat manual. Task yang ditugaskan ke Anda muncul di notifikasi; klik untuk membuka detailnya.

1. Buka task dari notifikasi atau dari papannya.
2. Perbarui "Status", "Progres (%)", atau "Jatuh tempo" bila perlu.
3. Klik "Tandai selesai" bila pekerjaan beres. Bila ternyata belum, klik "Buka kembali task".

| Status | Artinya |
| --- | --- |
| Terbuka | Belum dikerjakan. |
| Dikerjakan | Sedang dikerjakan. |
| Review | Menunggu diperiksa. |
| Selesai | Sudah beres. |
| Dibatalkan | Tidak jadi dikerjakan. |

<a id="kerja-harian-papan-tugas-kelola"></a>

### Mengelola board dan menghapus task *(Khusus Supervisor & Head)*

Supervisor dan Head dapat membuat board baru ("Tambah board"), mengatur dependensi task, dan menghapus task ("Hapus task") di divisinya.

> **Perhatian:** Task yang dihapus tidak bisa dikembalikan. Bila ragu, ubah statusnya menjadi "Dibatalkan".

<a id="kerja-harian-kalender"></a>

### Kalender dan rapat

"Kalender" menampilkan Google Calendar Anda. Pilih tampilan "Hari", "Minggu", "Bulan", atau "Agenda", dan pindah tanggal dengan "Hari ini", "Sebelumnya", "Berikutnya".

**Membuat event atau rapat**
1. Klik "Buat event".
2. Isi "Judul", "Lokasi", dan "Deskripsi".
3. Atur "Tanggal mulai", "Jam mulai", "Tanggal selesai", "Jam selesai" (zona waktu WIB), atau centang "Seharian".
4. Ketik email tamu di "Tambah tamu" lalu tekan Enter. Centang "Tambahkan Google Meet" untuk rapat online.
5. Klik "Simpan event". Tamu menerima undangan dari Google Calendar.

> **Tips**
>
> - Jawab undangan dengan "Hadir?": Ya, Mungkin, atau Tidak.
> - Klik "Gabung dengan Google Meet" dari detail event untuk masuk rapat.
> - Mengubah event berulang hanya berlaku untuk kejadian yang Anda buka.

<a id="kerja-harian-tiket-it"></a>

### Tiket IT

Semua kebutuhan IT diajukan lewat tiket, supaya tercatat dan bisa dipantau. Cara tercepat: tombol "Butuh bantuan IT" di bar atas. Bisa juga dari menu "Tiket IT".

**Membuat tiket dari menu Tiket IT**
1. Klik "Buat tiket".
2. Pilih "Kategori": Kerusakan perangkat, Permintaan perangkat baru, Akses dan software, atau Jaringan dan konektivitas.
3. Pilih "Prioritas", isi "Judul" dan "Deskripsi", dan pilih "Perangkat terkait" bila ada.
4. Klik "Ajukan tiket".
5. Pantau statusnya di daftar. Balas pertanyaan tim IT di bagian "Percakapan" lewat "Kirim tanggapan".

| Status | Artinya | Yang perlu Anda lakukan |
| --- | --- | --- |
| Terbuka | Tiket diterima, belum dikerjakan. | Tunggu. Anda masih bisa membatalkannya. |
| Sedang dikerjakan | Tim IT sedang menangani. | Tunggu kabar. |
| Menunggu respons pengaju | Tim IT butuh jawaban Anda. | Balas di "Percakapan". |
| Selesai | Masalah sudah ditangani. | Periksa hasilnya. |
| Ditutup / Dibatalkan | Tiket berakhir. | Buat tiket baru bila masalah muncul lagi. |

> **Catatan:** Anda mendapat notifikasi di aplikasi setiap kali status tiket berubah atau ada tanggapan baru.

> **Catatan:** Tiket juga tampil sebagai issue di project IT Project Tracker. Status issue itu hanya dapat dipindahkan oleh pengelola tiket IT, dan mengikuti status tiketnya; tiket yang ditutup atau dibatalkan tidak dibuka lagi dari papan. Bila tiket tidak ikut berubah, papan memberi tahu dan riwayat issue mencatatnya.

<a id="kerja-harian-layanan-ga"></a>

### Layanan GA: ATK, perbaikan, dan pinjam ruang

"Layanan GA" dipakai untuk meminta ATK, melaporkan kerusakan fasilitas, dan memesan ruang rapat. Permintaan diproses GA (bagian People & Culture).

**Membuat permintaan**
1. Klik "Buat permintaan" lalu pilih jenisnya.
2. ATK: isi "Lokasi", "Nama barang", "Jumlah", "Satuan" (rim, pcs, box). Klik "Tambah baris" untuk barang lain, lalu "Kirim permintaan".
3. Perbaikan fasilitas: isi "Area atau objek" dan "Uraian kerusakan", lampirkan "Foto" bila ada. Centang "Mendesak (target 1 hari)" bila perlu. Klik "Laporkan kerusakan".
4. Lainnya: isi "Judul" dan "Uraian", lalu "Ajukan permintaan". Jenis ini disetujui atasan dulu, lalu diproses People & Culture (target 5 hari).
5. Pantau di tab "Permintaan saya".

**Memesan ruang**
1. Klik "Buat permintaan" lalu "Pinjam ruang".
2. Pilih "Ruang", "Tanggal", "Mulai", "Selesai", dan isi "Keperluan".
3. Periksa keterangan jadwal: bila tertulis "Sudah terpakai" atau "bentrok", pilih jam lain.
4. Klik "Pesan ruang". Bila ruang kosong, pesanan langsung terkonfirmasi.

> **Catatan:** Pinjam kendaraan dilakukan lewat TrackCar: pilihan "Pinjam kendaraan" di "Buat permintaan" membuka TrackCar di tab baru dan tidak membuat pemesanan di Prakasa Workspace. Data TrackCar tidak disinkronkan ke Workspace.

**Status permintaan dan pemesanan**

| Status | Artinya |
| --- | --- |
| Menunggu approval | Menunggu persetujuan atasan (permintaan "Lainnya") atau pengelola ruang. |
| Baru | Masuk antrean GA. |
| Diproses | Sedang dikerjakan GA. |
| Selesai | Permintaan beres. |
| Terkonfirmasi | Ruang sudah dipesan untuk Anda. |
| Kedaluwarsa | Pemesanan tidak disetujui sampai jam mulai. |
| Ditolak / Dibatalkan | Tidak dilanjutkan. Lihat catatannya di detail. |

> **Tips**
>
> - Pemesanan ruang paling lama 12 jam dan paling jauh 90 hari ke depan.
> - Tidak jadi memakai ruang? Buka pemesanannya lalu klik "Batalkan" supaya ruang bisa dipakai orang lain.

<a id="kerja-harian-layanan-ga-setuju"></a>

### Menyetujui permintaan GA tim Anda *(Khusus Supervisor & Head)*

Permintaan GA jenis "Lainnya" dari anggota tim menunggu persetujuan atasan langsung atau Head divisi. Anda menerima notifikasi dan email "Permintaan GA menunggu persetujuan Anda".

1. Buka notifikasi atau kartu "Layanan GA menunggu persetujuan Anda" di Dashboard.
2. Baca uraiannya.
3. Klik "Setujui" atau "Tolak" (tulis alasannya). Target waktu 5 hari dihitung sejak disetujui.

<a id="kerja-harian-direktori"></a>

### Direktori karyawan

"Direktori" berisi kontak kerja, jabatan, atasan langsung, dan lokasi kerja setiap orang. Pilih tampilan "Daftar" atau "Bagan" (struktur organisasi).

1. Ketik di "Cari nama, email kerja, atau jabatan".
2. Saring dengan "Divisi", "Lokasi", atau "Akun".
3. Klik nama untuk membuka "Profil kerja": kontak kerja dan bawahan langsung.

> **Catatan:** Direktori hanya berisi data kerja. Data pribadi, absensi, cuti, dan gaji tetap di KantorKu.

<a id="kerja-harian-pengajuan-pembayaran"></a>

### Pengajuan pembayaran dan reimbursement

Semua divisi mengajukan pembayaran ke pemasok dan reimbursement karyawan lewat "Pengajuan pembayaran". Pengajuan disetujui atasan, diperiksa kelengkapannya, lalu dibayar Finance.

| Jenis | Untuk | Lampiran |
| --- | --- | --- |
| Pengajuan pembayaran | Membayar pemasok atau pihak lain, termasuk tagihan GA dan langganan IT. | Invoice. |
| Reimbursement | Mengganti uang pribadi yang Anda pakai untuk keperluan kantor. Dibayar ke rekening payroll Anda (data di KantorKu). | Kuitansi atau nota. |

**Membuat pengajuan**
1. Klik "Buat pengajuan".
2. Pilih "Jenis pengajuan".
3. Isi "Rincian": "Judul", "Kategori", dan "Keterangan dan referensi".
4. Untuk pembayaran pemasok, isi "Penerima": nama, bank, nomor rekening, atas nama. Kosongkan bila dibayar lewat virtual account atau tagihan.
5. Isi "Subtotal" dan "Pajak"; "Total" terhitung otomatis. Isi "Tanggal bayar yang diminta" dan, untuk pemasok, "Jatuh tempo".
6. Klik "Simpan draf".
7. Di halaman detail, klik "Lampirkan" untuk mengunggah invoice/nota (PDF atau foto, paling besar 10 MB; disimpan di Shared Drive).
8. Klik "Ajukan". Penyetuju ditentukan otomatis.

**Status**

| Status | Artinya | Yang perlu Anda lakukan |
| --- | --- | --- |
| Draf | Belum dikirim. | Lengkapi lalu klik "Ajukan". |
| Menunggu persetujuan | Menunggu keputusan atasan. | Tunggu notifikasi. |
| Perlu revisi | Penyetuju minta perbaikan. | Klik "Ubah", perbaiki, lalu ajukan lagi. |
| Disetujui | Sudah disetujui, menunggu dibayar Finance. | Tunggu. |
| Diproses | Finance sedang memproses pembayaran. | Tunggu. |
| Dibayar | Uang sudah dibayarkan. | Selesai. Anda mendapat notifikasi dan email. |
| Ditolak / Dibatalkan | Tidak dibayar. | Baca alasannya di "Riwayat". |

> **Tips**
>
> - Lampirkan dokumen sebelum mengajukan; pemeriksaan dokumen melihat kelengkapan lampiran.
> - Draf yang tidak jadi bisa dihapus lewat "Aksi lainnya" → "Hapus draf".

<a id="kerja-harian-pengajuan-setuju"></a>

### Menyetujui pengajuan pembayaran *(Khusus Supervisor & Head)*

Bila Anda penyetuju, pengajuan anggota tim muncul di Dashboard ("Pembayaran menunggu persetujuan Anda") dan Anda mendapat email.

1. Buka pengajuan dari notifikasi. Banner "Menunggu keputusan Anda" tampil di atas.
2. Periksa "Rincian", "Penerima dan nilai", dan "Lampiran". Kartu "Pemeriksaan dokumen" menunjukkan apakah lampiran "Lengkap" atau "Belum lengkap".
3. Klik "Setujui", "Minta revisi" (pengaju memperbaiki), atau "Tolak". Tulis alasan yang jelas.

> **Catatan:** Pemeriksaan dokumen hanya melihat kelengkapan lampiran. AI boleh memberi catatan, tetapi keputusan tetap di tangan penyetuju.

<a id="kerja-harian-pengajuan-proses-finance"></a>

### Memproses dan membayar pengajuan (Finance)

Tim Finance melihat semua pengajuan dari semua divisi. Pengajuan yang sudah "Disetujui" menunggu dibayar.

1. Saring daftar dengan chip status "Disetujui".
2. Buka pengajuan, klik "Periksa" di kartu "Pemeriksaan dokumen" bila belum diperiksa.
3. Klik "Proses" saat mulai membayar. Pengaju menerima notifikasi "sedang diproses".
4. Setelah transfer dicatat di Accurate, klik "Tandai dibayar" dan isi "Nomor bukti di Accurate".

> **Perhatian:** Aplikasi tidak menulis ke Accurate. Catat pembayarannya di Accurate seperti biasa, lalu salin nomor buktinya ke sini.

<a id="kerja-harian-tugas-onboarding"></a>

### Tugas onboarding/offboarding dari People & Culture

Saat ada karyawan baru atau karyawan keluar, People & Culture bisa memberi Anda tugas checklist (misalnya menyiapkan meja kerja atau serah terima pekerjaan). Anda menerima notifikasi dan email.

1. Klik tautan di notifikasi atau email untuk membuka alurnya.
2. Kerjakan tugas Anda sebelum tenggat.
3. Tandai tugas Anda selesai di checklist.

> **Catatan:** Bila terlambat, Anda menerima pengingat "terlambat" lewat notifikasi dan email.

<a id="komunikasi"></a>

## Komunikasi: Gmail, Google Chat, Groups

*Bagian: Kerja harian*

Gmail, Google Chat, dan Google Groups langsung di dalam Prakasa Workspace. Setiap orang hanya melihat email, chat, dan grupnya sendiri.

**Siapa yang memakai:** Semua karyawan dengan akun Google kantor.

<a id="komunikasi-gmail"></a>

### Gmail

**Menulis email**
1. Klik "Tulis email".
2. Isi "Kepada" (klik "Tambah Cc/Bcc" bila perlu), "Subjek", dan "Pesan".
3. Klik "Kirim email", atau "Simpan draf" untuk dilanjutkan nanti.

**Yang bisa dilakukan pada email**
- "Balas", "Balas semua", "Teruskan".
- "Arsipkan", "Pindahkan ke sampah", "Tandai belum dibaca", "Beri bintang".
- Folder: Kotak masuk, Berbintang, Terkirim, Draf, Spam, Sampah.

> **Perhatian:** Gambar dari luar disembunyikan demi keamanan. Klik "Tampilkan gambar" hanya bila Anda mengenal pengirimnya.

<a id="komunikasi-google-chat"></a>

### Google Chat

1. Klik "Chat baru" lalu pilih "Pesan langsung", "Grup chat", atau "Space".
2. Cari orang atau Space di kotak "Cari orang, space, atau aplikasi".
3. Lampirkan file dari "Unggah dari komputer" atau "Google Drive".

> **Tips**
>
> - Setiap Space punya tab "Chat", "File", dan "Tugas" (Project Tracker).
> - Pengelola Space dapat "Kelola anggota" dan "Tambahkan orang".

<a id="komunikasi-groups"></a>

### Google Groups

Tab "Grup saya" berisi grup yang Anda ikuti; "Semua grup" berisi grup perusahaan. Pakai "Kirim email ke grup" atau "Salin email".

> **Catatan:** Anggota grup hanya bisa dilihat oleh anggota grup itu dan admin.

<a id="dokumen"></a>

## Dokumen, template, dan tanda tangan

*Bagian: Kerja harian*

Semua dokumen kerja disimpan di Google Shared Drive divisi Anda. Dari sini Anda membuat dokumen dari template berkop divisi, membuat BAST, meminta dan memberi tanda tangan, serta membuka My Drive pribadi.

**Siapa yang memakai:** Semua karyawan. Dokumen divisi hanya terlihat oleh anggota divisinya.

<a id="dokumen-penyimpanan-divisi"></a>

### Penyimpanan divisi (Shared Drive)

"Penyimpanan divisi" membuka folder Shared Drive divisi Anda. Semua dokumen resmi divisi disimpan di sini, bukan di laptop atau My Drive pribadi.

1. Buka menu "Penyimpanan divisi". Bila Anda punya lebih dari satu divisi, pilih "Divisi".
2. Klik folder untuk masuk. Klik file untuk membukanya di Google Docs, Sheets, atau Slides.
3. Untuk dokumen baru, klik "Buat baru" lalu pilih Dokumen, Spreadsheet, atau Slide.

> **Catatan:** File yang dihapus dipindahkan ke sampah Shared Drive divisi, bukan langsung hilang. Bila tertulis "Belum ada folder divisi", akun Anda belum terhubung ke divisi yang punya Shared Drive; hubungi Administrator Sistem.

<a id="dokumen-template-dokumen"></a>

### Membuat dokumen dari template

"Template dokumen" berisi template Google Docs (surat, memo, BAST, dan lainnya) yang otomatis memakai kop & footer divisi Anda. Dokumen yang dibuat langsung tersimpan di Shared Drive divisi dan diberi nomor.

1. Buka "Template dokumen", tab "Template". Pakai chip "Divisi saya" untuk menyaring.
2. Klik template yang diinginkan.
3. Klik "Buat dokumen".
4. Isi "Judul dokumen" (boleh dikosongkan; nama file otomatis diakhiri nomor dokumen).
5. Lengkapi bagian "Isian". Nomor, tanggal, perusahaan, divisi, dan pembuat terisi otomatis.
6. Klik "Buat dokumen", lalu "Buka di Google Docs" untuk memeriksa hasilnya.

> **Tips**
>
> - Nomor dokumen berbentuk AWALAN-TAHUNBULAN-URUT, misalnya ST-202610-0001.
> - Semua dokumen yang pernah dibuat ada di tab "Dokumen dibuat".
> - Bila muncul "Kop divisi belum diatur", minta Head divisi mengatur kop di tab "Kop & footer".

<a id="dokumen-template-kelola"></a>

### Menambah template dan mengatur kop & footer

**Menambah template**
1. Di tab "Template", klik "Tambah template".
2. Isi "Nama template" (misalnya Surat tugas), pilih "Untuk" (divisi), dan "Sumber": "Template kosong" atau "Salin dari Google Docs" (tempel tautannya).
3. Isi "Awalan nomor" (2–12 huruf/angka, misalnya ST) dan "Keterangan".
4. Klik "Buat template". Lalu klik "Ubah di Google Docs" dan tulis isian sebagai {{nama_isian}}.
5. Setelah mengubah di Google Docs, klik "Periksa isian" agar formulirnya ikut berubah.

**Mengatur kop & footer divisi**
1. Buka tab "Kop & footer", lalu pilih divisi.
2. Pilih "Tata letak": "Logo kiri", "Tengah", atau "Gambar kop surat".
3. Isi "Nama perusahaan", "Warna aksen", "Baris di bawah nama", dan unggah "Logo" (PNG/JPG, maksimal 1 MB).
4. Isi "Teks footer" dan pilih "Tampilkan nomor halaman" bila perlu. Periksa "Pratinjau", lalu simpan.

> **Perhatian:** Menyimpan kop dari aplikasi akan menimpa perubahan kop yang dibuat langsung di Google Docs.

> **Catatan:** Divisi tanpa kop memakai kop seluruh perusahaan. Template yang tidak dipakai lagi cukup dimatikan lewat "Ubah" lalu "Template dipakai".

<a id="dokumen-bast"></a>

### BAST (berita acara serah terima)

BAST perangkat dan nomor perusahaan dibuat dari tempat serah terimanya, supaya data barangnya terisi otomatis dari aplikasi.

| BAST | Dibuat dari |
| --- | --- |
| Serah terima / pengembalian perangkat | IT → Perangkat → buka perangkat → "Riwayat pemakaian" → "Buat BAST serah terima perangkat" atau "Buat BAST pengembalian perangkat". |
| Serah terima / pengembalian nomor | Infrastruktur IT → tab "Telepon & HP" → "BAST serah terima" atau "BAST pengembalian". |
| BAST lain | Template dokumen → template BAST → "Buat dokumen". |

Kondisi barang dipilih dari: Sangat baik, Baik, Cukup, Kurang, atau Rusak. Dokumen BAST tersimpan di Shared Drive divisi.

> **Catatan:** Bila tertulis "Template BAST belum disiapkan", pengelola template perlu menekan "Siapkan template BAST" sekali.

<a id="dokumen-tanda-tangan"></a>

### Permintaan tanda tangan

Buka "Permintaan tanda tangan" dari Akun saya (kartu "Tanda tangan") atau dari notifikasi "Dokumen menunggu tanda tangan Anda" (juga dikirim lewat email).

1. Buka notifikasi atau kartu di Dashboard.
2. Baca dokumen dan ringkasannya. Bila ada kartu "Cek awal tanda tangan (AI)", periksa temuannya.
3. Klik "Tanda tangani dokumen", lalu "Tanda tangani".
4. Aplikasi memberi kode verifikasi. Dokumen bisa diperiksa keasliannya lewat QR verifikasi.

| Status | Artinya |
| --- | --- |
| Menunggu | Belum ditandatangani. |
| Disetujui | Approval sudah lengkap. |
| Ditandatangani | Sudah ditandatangani; kode verifikasi berlaku. |
| Ditolak / Dibatalkan | Tidak dilanjutkan. |

> **Catatan:** Cek awal AI hanya saran. Hasilnya tidak menyetujui atau menolak dokumen; keputusan tetap di tangan penanda tangan.

> **Catatan:** Permintaan tanda tangan baru dibuat oleh alur yang membutuhkannya. Dokumen Google yang dibuat dari Template dokumen di Drive belum bisa diajukan untuk tanda tangan dari aplikasi, dan tidak otomatis bertanda tangan.

<a id="dokumen-tanda-tangan-saya"></a>

### Tanda tangan saya

1. Buka Akun saya, lalu di kartu "Tanda tangan" klik "Tanda tangan saya".
2. Di "Unggah tanda tangan", pilih "File tanda tangan" (PNG atau JPEG, maksimal 500 KB). Pakai latar putih atau transparan.
3. Klik "Simpan tanda tangan".

> **Catatan:** Gambar tanda tangan disimpan terenkripsi dan hanya dipakai saat Anda sendiri menandatangani.

<a id="dokumen-cap-surat"></a>

### Cap surat divisi

"Cap surat" adalah cap atau kop surat resmi divisi yang dipakai bersama oleh semua anggota divisi. Buka dari Akun saya, kartu "Tanda tangan", lalu "Cap surat".

Hanya Head divisi yang bisa mengunggah atau mengganti cap surat ("Unggah atau ganti cap surat", PNG/JPEG maksimal 500 KB, lalu "Simpan cap surat").

<a id="dokumen-verifikasi"></a>

### Memeriksa keaslian dokumen

Setiap dokumen bertanda tangan punya kode atau QR verifikasi. Siapa pun yang memindai QR itu melihat halaman verifikasi.

| Hasil | Artinya |
| --- | --- |
| Tanda tangan valid | Dokumen terdaftar dan tanda tangannya masih berlaku. |
| Tanda tangan sudah tidak berlaku | Masa berlaku habis atau dicabut. |
| Kode verifikasi tidak ditemukan / tidak valid | Server menjawab kodenya tidak terdaftar atau salah format. Waspadai dokumen palsu. |
| Belum dapat memverifikasi | Layanan verifikasi tidak bisa dihubungi (koneksi, server, atau terlalu banyak permintaan). Ini bukan tanda dokumen palsu; coba lagi. |

> **Catatan:** Hasil verifikasi berasal dari data pendaftaran di server. Untuk memastikan salinan yang Anda pegang sama, bandingkan hash dokumennya dengan hash di halaman verifikasi.

<a id="dokumen-my-drive"></a>

### My Drive

"My Drive" adalah Google Drive pribadi Anda. Tab "Drive divisi" membuka folder Shared Drive divisi di tempat yang sama.

1. Klik "Buat baru" lalu pilih "Folder", "Unggah file", "Dokumen", "Spreadsheet", atau "Slide".
2. Isi nama, lalu klik "Buat folder" atau "Buat file".

> **Perhatian:** Dokumen resmi divisi simpan di Shared Drive divisi, bukan di My Drive. File di My Drive ikut hilang aksesnya bila akun Anda dinonaktifkan.

<a id="dokumen-docs"></a>

### Docs

"Docs" menampilkan Google Docs Anda. Pilih chip "Terbaru", "Milik saya", atau "Dibagikan ke saya", dan tampilan "Kisi" atau "Daftar".

1. Klik "Buat dokumen" untuk dokumen baru.
2. Klik dokumen untuk mengeditnya langsung di Prakasa Workspace, atau pilih "Buka di tab baru".
3. Menu file juga punya "Ganti nama" dan "Hapus ke sampah".

<a id="dokumen-sheets"></a>

### Sheets

"Sheets" sama seperti Docs, untuk Google Sheets Anda. Klik "Buat spreadsheet" untuk membuat yang baru.

<a id="dokumen-slides"></a>

### Slides

"Slides" sama seperti Docs, untuk Google Slides Anda. Klik "Buat presentasi" untuk membuat yang baru.

<a id="prakasa-ai"></a>

## Prakasa AI

*Bagian: Kerja harian*

Asisten AI di dalam aplikasi: bertanya, meringkas, membaca file, dan menyiapkan draft. Prakasa AI hanya bisa membaca data yang boleh Anda buka. AI menyiapkan, Anda yang memutuskan dan menyimpan.

**Siapa yang memakai:** Semua karyawan divisi.

**Menu:** `/ai-command`

<a id="prakasa-ai-mulai-percakapan"></a>

### Memulai percakapan

1. Buka "Prakasa AI" di menu atas, atau klik ikon bintang di bar atas ("Bantu dengan Prakasa AI di halaman ini").
2. Klik "Percakapan baru".
3. Ketik permintaan di "Tanyakan atau minta apa saja ke Prakasa AI…", atau pilih saran seperti "Bantu susun draft dokumen".
4. Tekan Enter untuk mengirim (Shift+Enter untuk baris baru). Klik "Hentikan jawaban" bila ingin berhenti.
5. Klik "Salin jawaban", atau jadikan PDF / DOCX / XLSX; file tersimpan di Shared Drive dan terunduh.

> **Tips**
>
> - Tulis permintaan dengan jelas: apa yang diminta, untuk siapa, dan formatnya.
> - Nyalakan "Aktifkan riset web" bila AI perlu mencari di internet; sumbernya akan dicantumkan.
> - Klik "Edit pesan" lalu "Kirim ulang" untuk memperbaiki pertanyaan.

<a id="prakasa-ai-lampirkan-file"></a>

### Melampirkan file

1. Klik "Lampirkan file", atau seret/tempel file ke kotak pesan.
2. Tulis apa yang ingin dilakukan dengan file itu, misalnya "ringkas" atau "cari selisih angka".

- Jenis file: PDF, Word, Excel, PowerPoint, gambar (PNG/JPG/WEBP), TXT, CSV, dan sejenisnya.
- Maksimal 5 file per pesan, masing-masing paling besar 25 MB.
- Gambar atau hasil scan dibaca dengan AI vision.

> **Perhatian:** Jangan melampirkan data pribadi karyawan (KTP, slip gaji, rekening) atau kata sandi.

<a id="prakasa-ai-visibilitas"></a>

### Percakapan pribadi, divisi, atau lintas divisi

| Pilihan | Siapa yang bisa membaca |
| --- | --- |
| Pribadi | Hanya Anda. Ini bawaan. |
| Divisi | Semua anggota divisi yang dipilih bisa membaca dan ikut bertanya. |
| Lintas divisi | Dibagikan sesuai akses entitas. |

> **Tips**
>
> - Sematkan percakapan penting lewat "Sematkan".
> - Percakapan yang diarsipkan tidak bisa menerima pesan baru, tetapi riwayatnya tetap bisa dibaca.

<a id="prakasa-ai-ai-menyiapkan"></a>

### AI menyiapkan, Anda yang memutuskan

Prakasa AI tidak pernah menyimpan, menyetujui, menghapus, atau mengirim apa pun sendiri. Bila AI mengusulkan aksi (misalnya "Buat tugas"), aksi itu muncul sebagai proposal berstatus "Menunggu konfirmasi".

1. Baca proposal di percakapan atau di "Kotak aksi".
2. Klik "Konfirmasi" bila setuju. Aplikasi bertanya "Jalankan aksi ini?"; klik "Ya, jalankan".
3. Klik "Tolak" bila tidak setuju (alasan boleh diisi).

> **Catatan:** "Kotak aksi" mengumpulkan semua yang menunggu keputusan Anda: proposal dari AI, approval, dan notifikasi belum dibaca.

<a id="prakasa-ai-apa-yang-bisa-ditanyakan"></a>

### Apa yang bisa ditanyakan

Prakasa AI bisa membaca data di modul yang boleh Anda buka, lalu menjawab dengan bahasa biasa. Jawabannya mengikuti hak akses Anda: yang tidak boleh Anda lihat di halaman, tidak bisa dibaca AI untuk Anda.

| Modul | Contoh pertanyaan |
| --- | --- |
| Beranda dan pekerjaan harian | "Apa yang perlu saya kerjakan hari ini?" · "Tugas saya mana yang terlambat?" · "Pengajuan saya sudah sampai mana?" |
| Persetujuan dan tanda tangan | "Pengajuan apa saja yang menunggu keputusan saya?" · "Dokumen apa yang menunggu tanda tangan saya?" |
| Dokumen dan template | "Carikan dokumen kontrak divisi saya" · "Apa saja yang perlu saya isi untuk membuat BAST dari template?" |
| Sales | "Customer dormant mana yang perlu saya hubungi minggu ini?" · "Order mana yang belum terkirim penuh?" · "Omzet bulan ini (sebelum PPN) dibanding target dan bulan lalu" |
| Retail Commerce dan Marketing | "Pesanan marketplace mana yang belum terkirim atau terlambat?" · "Kampanye apa yang sedang berjalan?" |
| Finance | "Pengajuan pembayaran saya sudah sampai mana?" · "Ringkas posisi piutang dan perkiraan DSO" |
| Warehouse dan Procurement | "Barang apa yang stoknya menipis atau habis?" · "PO mana yang terlambat datang, dan dari pemasok siapa?" |
| People & Culture dan GA | "Tugas onboarding/offboarding saya apa saja dan kapan tenggatnya?" · "Permintaan GA saya sudah sampai mana?" · "Kontrak dan sewa mana yang segera berakhir?" |
| IT | "Tiket IT saya sudah sampai mana?" · "Lisensi software mana yang menganggur?" |
| Manajemen | "Eskalasi apa yang paling lama terbuka di divisi saya?" · "Target mana yang tertinggal kuartal ini?" |
| Cara memakai aplikasi | "Bagaimana cara mengajukan pembayaran?" · "Bagaimana cara membuat tiket IT?" |

- AI membaca data dan bisa mengisi formulir untuk Anda periksa. Menyetujui, menolak, menandatangani, menyimpan, dan mengirim tetap Anda lakukan sendiri di halamannya; AI menunjukkan halaman yang perlu dibuka.
- Cuti, absensi, dan gaji ada di KantorKu, bukan di Prakasa Workspace. Prakasa AI tidak bisa membacanya dan tidak akan menebak.
- Angka rupiah hanya untuk yang berizin, dan hanya di percakapan pribadi.
- Omzet selalu ditulis sebelum PPN (DPP). Harga beli, nilai PO, dan margin tidak pernah dibaca AI, untuk siapa pun.
- Data dari Accurate dibaca setelah disetujui Supervisor/Head divisinya. Bila datanya masih menunggu persetujuan, AI akan mengatakannya.

> **Tips**
>
> - Di panel Prakasa AI setiap halaman ada saran pertanyaan yang sesuai dengan peran Anda. Klik salah satunya untuk mulai.
> - Data divisi dan data milik Anda hanya dibaca di percakapan "Pribadi" tanpa riset web.

<a id="prakasa-ai-ai-mengisi-formulir"></a>

### AI mengisi formulir, Anda yang menyimpan

Di panel Prakasa AI sebuah halaman, Anda bisa meminta AI membuka formulir dan mengisinya, misalnya "Buatkan tiket IT: laptop saya tidak bisa konek wifi sejak pagi, prioritas tinggi". AI hanya mengisi kolom. Tombol simpan tidak pernah ditekan AI: Anda yang memeriksa, lalu menyimpan atau mengirim.

1. Buka halaman modulnya, lalu klik ikon bintang di bar atas untuk membuka panel Prakasa AI.
2. Tulis permintaan Anda, atau pilih saran seperti "Buatkan tugas dari catatan ini: …" lalu lengkapi kalimatnya.
3. AI membuka formulirnya dan mengisi kolom. Di percakapan terlihat langkahnya, misalnya "Membuka halaman Tiket IT" dan "Mengisi 4 kolom di formulir Tiket IT".
4. Periksa kolom yang disorot dan bertanda "diisi AI". Ubah bila perlu; tanda itu hilang begitu Anda mengubah kolomnya.
5. Klik "Urungkan isian AI" bila ingin mengembalikan kolom ke isi sebelumnya.
6. Bila sudah benar, tekan tombol simpan formulir itu sendiri (misalnya "Ajukan tiket" atau "Simpan draf").

Formulir yang bisa diisi AI ada di tabel di bawah, per modul. Anda hanya bisa meminta formulir yang memang boleh Anda buka dan simpan sendiri. Bila tidak yakin, tanyakan di panel: "Formulir apa saja yang bisa kamu isi di halaman ini?".

**Formulir yang bisa diisi AI: Tugas**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Tugas | Tugas | Penanggung jawab |
| Tambah board | Tugas | Tidak ada |
| Detail tugas | Tugas | Status, Penanggung jawab |
| Komentar tugas | Tugas | Tidak ada |
| Item checklist | Tugas | Tidak ada |
| Tambah dependensi | Tugas | Tidak ada |

**Formulir yang bisa diisi AI: Project Tracker**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Buat issue | Project Tracker | Penanggung jawab |
| Komentar issue | Project Tracker | Tidak ada |
| Buat sprint | Project Tracker | Tidak ada |
| Ubah sprint | Project Tracker | Tidak ada |
| Divisi project | Project Tracker | Tidak ada |

**Formulir yang bisa diisi AI: Kalender**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Buat event | Kalender | Tamu, Google Meet, Email undangan ke tamu |
| Ubah event | Kalender | Tamu, Google Meet, Email undangan ke tamu |

**Formulir yang bisa diisi AI: Sales**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Lead | Leads | Tidak ada |
| Ubah lead | Leads | Tidak ada |
| Hubungkan lead ke pelanggan | Leads | Tidak ada |
| Catatan kunjungan lead | Leads | Tidak ada |
| Pelanggan baru | Pelanggan | Telepon, Telepon usaha |
| Jadikan pelanggan | Leads | Telepon, Telepon usaha |
| Ubah pelanggan | Pelanggan | Telepon, Telepon usaha, Kode pelanggan |
| Sales order | Data Sales | Nomor SO, Ongkos kirim, Harga per baris, Kena PPN per baris |
| Ubah sales order | Data Sales | Pelanggan, Nomor SO, Ongkos kirim, Harga per baris, Kena PPN per baris |
| Surat jalan | Data Sales | Tidak ada |
| Invoice | Data Sales | Tidak ada |
| Produk baru | Data Sales | Harga jual, Harga pokok |
| Ubah produk | Data Sales | Kode SKU, Harga jual, Harga pokok, Aktif atau nonaktif |
| Pengaturan dokumen sales | Data Sales | NPWP, Telepon, Rekening bank |
| Tukar faktur | Data Sales | Tidak ada |
| Ubah tukar faktur | Data Sales | Tidak ada |

**Formulir yang bisa diisi AI: Marketing**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Kampanye | Kampanye | Anggaran, Status |
| Ubah kampanye | Kampanye | Anggaran, Status |

**Formulir yang bisa diisi AI: Finance**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Pengajuan pembayaran / reimbursement | Pengajuan pembayaran | Bank, Nomor rekening, Nama pemilik rekening, Total |

**Formulir yang bisa diisi AI: Warehouse**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Buat barang masuk | Warehouse | Jumlah tiap baris (hasil hitung fisik) |
| Buat barang keluar | Warehouse | Jumlah tiap baris (hasil hitung fisik) |
| Ubah draft barang masuk | Warehouse | Jumlah tiap baris (hasil hitung fisik) |
| Ubah draft barang keluar | Warehouse | Jumlah tiap baris (hasil hitung fisik) |
| Buat checklist harian | Warehouse | Tidak ada |
| Laporkan insiden | Warehouse | Tidak ada |

**Formulir yang bisa diisi AI: Manajemen**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Tindak lanjut eskalasi | Pusat eskalasi | Status, Penanggung jawab tindak lanjut |
| Ubah target | Target & realisasi | Angka target |

**Formulir yang bisa diisi AI: General Affairs (GA)**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Perbaikan fasilitas | Layanan GA | Foto |
| Permintaan lainnya (GA) | Layanan GA | Tidak ada |
| Permintaan ATK | Layanan GA | Tidak ada |
| Pinjam ruang | Layanan GA | Tidak ada |
| Tambah ruang | Layanan GA | Tidak ada |
| Ubah ruang | Layanan GA | Tidak ada |
| Tugaskan permintaan | Layanan GA | Tidak ada |
| Tambah jadwal perawatan | Operasional GA | Tidak ada |
| Ubah jadwal perawatan | Operasional GA | Status |
| Tambah kontrak | Operasional GA | Biaya per bulan |
| Ubah kontrak | Operasional GA | Biaya per bulan, Status |
| Catat tagihan | Operasional GA | ID pelanggan atau nomor meter, Jumlah tagihan, Tanggal dibayar |
| Ubah tagihan | Operasional GA | ID pelanggan atau nomor meter, Jumlah tagihan, Tanggal dibayar |
| Catat perawatan | Operasional GA | Biaya |

**Formulir yang bisa diisi AI: IT**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Tiket IT | Tiket IT | Tidak ada |
| Butuh bantuan IT | Ikon bantuan di bar atas (halaman mana pun) | Tidak ada |
| Tanggapan tiket IT | Tiket IT | Tidak ada |
| Tambah perangkat | Perangkat | Nomor seri, IMEI, MAC address, Harga beli |
| Ubah perangkat | Perangkat | Nomor seri, IMEI, MAC address, Harga beli |
| Ubah status perangkat | Perangkat | Status |
| Kembalikan perangkat | Perangkat | Tidak ada |
| Catat perawatan | Perangkat | Biaya |
| Catat perbaikan di vendor | Perangkat | Tidak ada |
| BAST perangkat | Perangkat | Penanda tangan "Mengetahui" |
| Tambah lokasi | Perangkat | Tidak ada |
| Ubah lokasi | Perangkat | Aktif atau nonaktif |
| Tambah langganan | Langganan software | Harga per seat |
| Catat invoice langganan | Langganan software | Subtotal, Pajak, Total, Mata uang, File invoice (PDF) |
| Tambah lisensi | Langganan software | Tidak ada |
| Tambah perangkat jaringan | Infrastruktur IT | Nomor seri, Alamat IP, Status |
| Ubah perangkat jaringan | Infrastruktur IT | Nomor seri, Alamat IP, Status |
| Tambah ISP | Infrastruktur IT | ID pelanggan atau nomor meter, Biaya per bulan, Status |
| Ubah ISP | Infrastruktur IT | ID pelanggan atau nomor meter, Biaya per bulan, Status |
| Tambah CCTV | Infrastruktur IT | Nomor seri |
| Ubah CCTV | Infrastruktur IT | Nomor seri |
| Tambah backup | Infrastruktur IT | Tidak ada |
| Ubah backup | Infrastruktur IT | Status |
| Tambah nomor | Infrastruktur IT | Nomor telepon, Biaya per bulan |
| Ubah nomor | Infrastruktur IT | Nomor telepon, Biaya per bulan, Status |
| Tambah vendor | Infrastruktur IT | Telepon, Alamat portal |
| Ubah vendor | Infrastruktur IT | Telepon, Alamat portal |
| Ubah status CCTV | Infrastruktur IT | Status |
| Catat pemeriksaan backup | Infrastruktur IT | Tidak ada |
| Catat review Google Workspace | Infrastruktur IT | Tidak ada |
| Ganti pemegang | Infrastruktur IT | Tidak ada |
| BAST nomor perusahaan | Infrastruktur IT | Penanda tangan "Mengetahui" |

**Formulir yang bisa diisi AI: People & Culture**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Onboarding | Onboarding | Catatan |
| Offboarding | Offboarding | Alasan keluar, Catatan |
| Ubah onboarding | Workflow HRGA | Catatan |
| Ubah offboarding | Workflow HRGA | Karyawan (tidak bisa diganti), Alasan keluar, Catatan |
| Penanggung jawab checklist | Template checklist | Tidak ada |
| Template checklist | Template checklist | Tidak ada |
| Ubah template checklist | Template checklist | Jenis dan divisi (tidak bisa diubah) |
| Tugaskan ke | Workflow HRGA | Tidak ada |
| Buat tiket IT | Workflow HRGA | Tidak ada |
| Serahkan perangkat | Workflow HRGA | Tidak ada |
| Terima kembali perangkat | Workflow HRGA | Tidak ada |
| Berikan lisensi | Workflow HRGA | Tidak ada |
| Tambah orang ke direktori | Direktori | Telepon kerja, Jenis dan alasan dikecualikan, Status, Tanggal resign, Catatan |
| Ubah profil kerja | Direktori | Telepon kerja, Jenis dan alasan dikecualikan, Status, Tanggal resign, Catatan |

**Formulir yang bisa diisi AI: Dokumen**

| Formulir | Dibuka dari | Yang tetap Anda isi sendiri |
| --- | --- | --- |
| Tambah template | Template dokumen | Sumber template, Tautan Google Docs |
| Ubah template | Template dokumen | Aktif atau nonaktif |
| Buat dokumen dari template | Template dokumen | Kolom template bernama data pribadi, rekening bank, pengenal perangkat, atau rupiah |
| Kop & footer | Template dokumen | Logo |
| Buat file di folder divisi | Penyimpanan divisi | Tidak ada |
| Buat file di My Drive | My Drive | Tidak ada |
| Buat folder di My Drive | My Drive | Tidak ada |

- AI tidak pernah mengisi kata sandi, rekening bank penerima, keputusan persetujuan, atau unggahan file.
- AI juga tidak pernah mengisi atau membaca data pribadi (NIK, KTP, NPWP, BPJS, gaji, tanggal lahir, alamat rumah, telepon pribadi) dan pengenal perangkat atau jaringan (alamat IP, IMEI, MAC address, nomor seri, kunci lisensi, nama dan kata sandi Wi-Fi, alamat portal, nomor pelanggan).
- Harga, diskon, anggaran, angka target, dan jumlah hasil hitung fisik gudang tetap Anda isi sendiri. Di sales order, AI mengisi pelanggan, barang, dan jumlahnya; harga tiap baris Anda yang mengetik.
- Di "Buat dokumen" dari template, AI mengisi judul dan kolom teks template. Kolom template yang bernama data pribadi, rekening bank, pengenal perangkat, atau rupiah hanya Anda yang mengisi.
- Kolom yang sudah Anda ketik tidak ditimpa AI. AI akan mengatakan kolom mana yang tidak ia isi dan alasannya.
- Isian AI tetap melewati pemeriksaan formulir. Kolom wajib yang datanya belum ada akan ditanyakan AI lebih dulu.
- Di daftar baris (misalnya barang ATK), AI hanya menambah baris. Baris yang Anda ketik tidak pernah diubah atau dihapus, dan "Urungkan isian AI" hanya membuang baris dari AI.
- Kolom yang dipilih lewat pencarian (misalnya pelanggan atau barang) hanya diisi AI bila tepat satu yang cocok. Bila ada beberapa, AI bertanya dulu kepada Anda.
- Di ponsel dan tablet, setelah AI mengisi formulir, percakapan menepi supaya formulir terlihat. Tombol "Prakasa AI" di atas formulir membuka percakapan lagi, dan "Lihat formulir" kembali ke formulir.
- Bila ada formulir yang belum disimpan dan AI ingin membuka halaman lain, aplikasi bertanya "Pindah halaman?". Pilih "Tetap di sini" bila tidak ingin kehilangan isian. Membuka formulir lain di halaman yang sama tidak menanyakan ini.
- Bila Anda menanyakan data yang tidak boleh Anda buka, AI mengatakan Anda tidak punya akses dan menyarankan bertanya ke Supervisor atau Head divisi Anda, atau meminta akses ke Super Admin.
- Mengisi formulir hanya bisa dari panel Prakasa AI di halaman, di percakapan pribadi tanpa riset web. Di halaman "Prakasa AI", AI hanya memberi tautan ke halamannya.

> **Perhatian:** Selalu periksa isian AI sebelum menyimpan, terutama angka, tanggal, dan nama penerima. Yang tersimpan adalah tanggung jawab Anda.

<a id="prakasa-ai-formulir-dari-dokumen"></a>

### Mengisi formulir dari foto atau dokumen

Di panel Prakasa AI sebuah halaman, Anda bisa melampirkan foto, scan, atau PDF (struk, surat jalan, invoice, kartu nama, tangkapan layar keluhan) lalu meminta AI mengisi formulirnya, misalnya "Isi pengajuan reimbursement dari struk ini". AI membaca lampiran, membuka formulir, dan mengisi kolom yang nilainya tertulis jelas. Anda yang memeriksa dan menyimpan.

1. Buka halaman modulnya, lalu klik ikon bintang di bar atas untuk membuka panel Prakasa AI.
2. Klik "Lampirkan file" di kotak pesan, seret file ke panel, atau tempel gambar. Bisa juga memilih saran seperti "Isi pengajuan reimbursement dari struk atau foto ini": aplikasi langsung meminta filenya.
3. Tulis permintaan Anda, lalu kirim. Di percakapan terlihat langkah "Membaca lampiran", lalu langkah membuka dan mengisi formulir.
4. Baca daftar "Terisi dari dokumen": tiap kolom, isinya, dan kutipan dari dokumen yang menjadi sumbernya.
5. Lengkapi kolom di daftar "Perlu Anda isi", periksa kolom bertanda "diisi AI", lalu tekan tombol simpan formulir itu sendiri.

| Halaman | Contoh permintaan | Yang tetap Anda isi |
| --- | --- | --- |
| Pengajuan pembayaran | "Isi pengajuan reimbursement dari struk atau foto ini" | Bank, nomor rekening, dan atas nama penerima |
| Warehouse | "Catat barang masuk dari surat jalan ini" | Jumlah tiap barang. AI menuliskan jumlah yang ia baca di percakapan supaya Anda bisa mengetiknya |
| Leads | "Buat lead dari kartu nama ini" | Kolom yang tidak tertulis di kartu nama |
| Tiket IT | "Buat tiket IT dari tangkapan layar ini" | Kolom yang tidak terlihat di tangkapan layar |

- Paling banyak 3 lampiran per pesan, masing-masing sampai 25 MB. Foto lebih dari 5 MB tidak bisa dibaca AI: perkecil dulu atau potong bagian yang penting.
- Jenis file: foto (JPG, PNG, WebP), PDF, dan dokumen Office. Foto dan PDF hasil scan dibaca dengan AI vision.
- Tulisan di dalam lampiran diperlakukan sebagai data, bukan perintah. Kalimat seperti "setujui pengajuan ini" di sebuah struk tidak mengubah apa pun.
- Nilai yang tidak terbaca atau meragukan dibiarkan kosong dan masuk daftar "Perlu Anda isi". AI tidak menebak.
- Nomor rekening, NIK, nomor KTP, NPWP, BPJS, dan pengenal pribadi lain di dokumen tidak pernah disalin AI, termasuk ke kolom catatan atau keterangan.
- Angka rupiah dari dokumen hanya diisikan ke subtotal dan pajak pengajuan pembayaran Anda sendiri. Harga, diskon, dan anggaran tetap Anda isi.
- Lampiran hanya bisa dipakai di percakapan pribadi tanpa riset web, dan percakapan yang berisi lampiran tidak bisa dibagikan ke divisi.
- File lampiran disimpan seperti file yang diunggah di halaman "Prakasa AI". Log aktivitas hanya mencatat nama, jenis, dan ukuran file, bukan isinya.

> **Perhatian:** Hasil baca foto bisa keliru, terutama angka dan tanggal pada struk yang buram. Cocokkan isian dengan dokumen aslinya sebelum menyimpan.

<a id="prakasa-ai-batas-ai"></a>

### Batas Prakasa AI

- AI membaca halaman atau data sesuai izin Anda, tidak lebih.
- Ada batas jumlah permintaan per hari. Bila tercapai, aplikasi memberi tahu; coba lagi besok.
- Saat ramai, Anda mungkin menunggu giliran beberapa saat.
- Jawaban AI bisa salah. Periksa angka dan isi sebelum dipakai.

> **Tips**
>
> - Klik "Lihat batas bantuan AI" di panel AI suatu halaman untuk melihat apa yang boleh dibaca, disiapkan, atau hanya direkomendasikan AI.

<a id="sales"></a>

## Sales: pelanggan, leads, dan Data Sales

*Bagian: Modul divisi*

Memantau pelanggan, leads, pipeline, dan transaksi penjualan. Transaksi dicatat di Accurate, lalu dipantau di sini setelah datanya disetujui Supervisor/Head divisi.

**Siapa yang memakai:** Sales; juga Retail Commerce dan Marketing (sesuai aksesnya).

**Hanya untuk divisi:** Sales, Retail Commerce, Marketing

**Menu:** `/sales/customers`

<a id="sales-aturan"></a>

### Aturan dasar data Sales

- Sales order, surat jalan, faktur, dan pembayaran dibuat di Accurate. Aplikasi hanya membaca Accurate dan tidak pernah menulis ke sana.
- Data baru dari Accurate baru tampil setelah disetujui Supervisor atau Head divisi (lihat bab Data Accurate).
- Omzet selalu dihitung sebelum PPN (DPP) dan bersih retur.
- Kunjungan lapangan berasal dari SimpliDOTS.

> **Catatan:** Sales Member melihat pelanggan, leads, dan order miliknya sendiri. Bila muncul "Akun Anda belum terhubung ke nama sales", minta Supervisor menghubungkan akun Anda di "Pemetaan sales".

<a id="sales-pipeline"></a>

### Pipeline sales

Pipeline terisi otomatis dari kunjungan dan sales order; tidak ada kartu yang perlu digeser manual.

| Tahap | Artinya |
| --- | --- |
| Prospek dikunjungi | Outlet sudah dikunjungi, belum terdaftar sebagai pelanggan. |
| Terdaftar, belum order | Sudah jadi pelanggan, belum pernah order. |
| Order pertama (NOO) | Pelanggan yang pertama kali difakturkan bulan itu. |
| Aktif | Order terakhir kurang dari 30 hari. |
| Dormant | Lama tidak order. Hubungi sebelum jadi Lost. |
| Lost | Tidak order 60 hari atau lebih. |

**Perlu tindakan hari ini**
1. Lihat daftar "Perlu tindakan hari ini" di halaman Pipeline.
2. Klik "Lihat pelanggan" atau "Lihat SO" untuk menindaklanjuti.
3. Bila tertulis "Beres", tidak ada yang perlu ditindaklanjuti.

Bagian "Target dan pencapaian" menunjukkan target omzet (sebelum PPN) dan target pelanggan baru bulan ini, serta pencapaiannya.

<a id="sales-pelanggan"></a>

### Pelanggan

Daftar pelanggan dengan status Aktif, Dormant, atau Lost yang dihitung otomatis dari order terakhir.

1. Saring dengan chip Semua / Aktif / Dormant / Lost dan filter "Channel".
2. Klik pelanggan untuk membuka detail: tab "Ikhtisar", "Order", "Kunjungan", "Aktivitas".
3. Di "Ikhtisar" ada omzet 12 bulan (bersih retur), piutang, produk teratas, dan umur piutang.

<a id="sales-pelanggan-tambah"></a>

### Menambah dan mengubah pelanggan

1. Klik "Tambah pelanggan".
2. Isi "Informasi pelanggan": Nama pelanggan, Channel, Bentuk usaha, Kode kota, ID pelanggan, PIC sales.
3. Isi "Kontak dan alamat": Kontak, Handphone, Email, Alamat pengiriman, Kota.
4. Simpan. Untuk mengubah, buka pelanggan lalu klik "Ubah pelanggan".

> **Tips**
>
> - Samakan ID pelanggan dengan Accurate supaya order dan piutangnya tersambung.

<a id="sales-leads"></a>

### Leads dan kunjungan

Leads adalah outlet yang sudah dikunjungi tetapi belum menjadi pelanggan, dari SimpliDOTS dan yang dicatat di sini.

**Filter**
- Belum order
- Perlu dikunjungi ulang
- Sudah jadi pelanggan
- Tidak berminat

<a id="sales-leads-kelola"></a>

### Mencatat lead dan kunjungan

1. Klik "Tambah lead". Isi Nama outlet, Area, Alamat, PIC sales, dan (opsional) Latitude/Longitude untuk tombol Maps.
2. Setelah berkunjung, buka lead lalu klik "Catat kunjungan": tanggal, jam datang, jam pulang, hasil kunjungan.
3. Bila outlet mulai order, klik "Jadikan pelanggan", atau "Hubungkan ke pelanggan" bila pelanggan-nya sudah ada.

<a id="sales-impor-simplidots"></a>

### Impor kunjungan SimpliDOTS dan pemetaan sales *(Khusus Supervisor & Head)*

**Impor SimpliDOTS**
1. Di "Leads", klik "Impor SimpliDOTS".
2. Pilih "File export" dari SimpliDOTS (makro di file tidak dijalankan).
3. Klik "Impor kunjungan".

**Pemetaan sales**
1. Di "Pelanggan", klik "Pemetaan sales".
2. Hubungkan nama sales di Accurate/SimpliDOTS dengan akun aplikasi tiap anggota tim.
3. Simpan. Anggota tim lalu melihat data miliknya.

<a id="sales-data-sales"></a>

### Data Sales: order, surat jalan, faktur, pembayaran

"Data Sales" memantau transaksi dari Accurate. Pilih jenis data di tab: Sales order, Surat jalan, Faktur, Penerimaan, Retur, Umur piutang, Tukar faktur, dan Produk.

1. Pilih "Periode" (Bulan ini, Bulan lalu, 3 bulan terakhir, Tahun ini, Semua waktu) dan "Channel".
2. Pakai filter status, misalnya "Belum ada surat jalan", "Belum ditagih", "Belum lunas", "Terlambat bayar".
3. Klik baris untuk melihat detailnya.

**Status pembayaran**

| Label | Artinya |
| --- | --- |
| Lunas | Faktur sudah dibayar penuh. |
| Belum lunas | Masih ada sisa tagihan. |
| Terlambat n hari | Lewat jatuh tempo sekian hari. |

> **Catatan:** Membuat SO, surat jalan, invoice, dan pembayaran dilakukan di Accurate. Form input di aplikasi dimatikan supaya tidak ada dua versi pembukuan.

<a id="sales-umur-piutang"></a>

### Umur piutang pelanggan

Tab "Umur piutang" menunjukkan sisa tagihan per pelanggan (termasuk PPN), dikelompokkan per umur, dari faktur Accurate yang sudah disetujui divisi.

> **Tips**
>
> - Klik "Lihat faktur lewat jatuh tempo" untuk daftar yang perlu ditagih.
> - Anda mendapat notifikasi di aplikasi untuk faktur lewat jatuh tempo dan pelanggan yang mulai dormant.

<a id="sales-tukar-faktur"></a>

### Mencatat tukar faktur

1. Buka tab "Tukar faktur", chip "Belum tukar faktur".
2. Pilih faktur, isi "Tanggal tukar faktur", "No. tanda terima", "Janji bayar", dan "Catatan".
3. Klik "Catat tukar faktur".

> **Catatan:** Janji bayar tidak boleh sebelum tanggal tukar faktur. Faktur yang 7 hari atau lebih belum ditukar ditandai merah.

<a id="sales-target-sales"></a>

### Mengatur target Sales *(Khusus Supervisor & Head)*

1. Di "Pipeline sales", bagian "Target dan pencapaian", pilih "Bulan".
2. Klik "Atur target".
3. Isi "Target omzet sebelum PPN" dan "Target pelanggan baru". Kosongkan bila tidak ada target.
4. Simpan.

<a id="sales-notifikasi-sales"></a>

### Notifikasi untuk tim Sales

| Kejadian | Saluran |
| --- | --- |
| Pelanggan/leads diserahkan ke Anda | Di aplikasi |
| Pengingat pelanggan tidak order (dormant) | Di aplikasi |
| Faktur lewat jatuh tempo | Di aplikasi |
| Data Accurate menunggu persetujuan (Supervisor/Head) | Di aplikasi + email |

<a id="retail-commerce"></a>

## Retail Commerce: kinerja marketplace

*Bagian: Modul divisi*

Kinerja penjualan marketplace (Shopee, Tokopedia, dan lainnya) dari data Accurate yang sudah disetujui. Omzet dihitung sebelum PPN dan bersih retur.

**Siapa yang memakai:** Tim Retail Commerce, Supervisor/Head Sales, dan manajemen.

**Hanya untuk divisi:** Sales, Retail Commerce

**Menu:** `/retail-commerce`

<a id="retail-commerce-membaca"></a>

### Membaca halaman Retail Commerce

| Bagian | Isinya |
| --- | --- |
| Angka utama | Omzet bulan ini dan bulan lalu, pesanan, rata-rata per faktur, retur, piutang marketplace belum cair, SO belum dikirim. |
| Porsi omzet per platform | Sumbangan tiap marketplace. |
| Perbandingan platform | Omzet 12 bulan, faktur, SO, rasio retur, dan piutang per platform. |
| Grafik capaian bulanan & Tren 12 bulan | Perjalanan capaian dari bulan ke bulan. |
| Produk terlaris | Pilih "Bulan" untuk melihat bulan lain. |
| SO belum dikirim / Faktur belum cair | Yang perlu ditindaklanjuti. |

> **Catatan:** Marketplace ditagih dengan satu faktur rekap per platform setiap bulan. Angka baru muncul setelah Supervisor atau Head Sales/Retail Commerce menyetujui batch data Accurate pertama.

> **Tips**
>
> - Klik "Muat ulang" untuk angka terbaru.
> - Pelanggan, leads, dan Data Sales kanal ritel ada di menu Sales.

<a id="marketing"></a>

## Marketing: produk, channel, dan kampanye

*Bagian: Modul divisi*

Apa yang laku, di channel mana, dan siapa pelanggan baru, dari data Accurate yang sudah disetujui. Juga pencatatan kampanye dan hasilnya.

**Siapa yang memakai:** Tim Marketing, Supervisor/Head Sales, dan manajemen.

**Hanya untuk divisi:** Sales, Marketing

**Menu:** `/marketing/insights`

<a id="marketing-produk-channel"></a>

### Produk & channel

| Tab | Isinya |
| --- | --- |
| Channel | Omzet 12 bulan per channel, omzet bulan ini, dan "Channel berlomba". |
| Produk | 20 produk terlaris, yang naik paling tinggi, dan yang turun paling dalam. |
| Pelanggan & leads | Pelanggan baru (NOO) per channel dan leads per area. |

> **Catatan:** Bila tertulis "Menunggu data Accurate", batch data penjualan belum disetujui divisi Sales.

<a id="marketing-kampanye"></a>

### Kampanye

Hasil kampanye dihitung langsung dari data Accurate: omzet produk target selama kampanye dibanding periode yang sama panjang sebelumnya.

| Status | Artinya |
| --- | --- |
| Draf | Belum berjalan. |
| Berjalan | Sedang berlangsung. |
| Selesai | Sudah berakhir dan hasilnya dicatat. |
| Dibatalkan | Tidak jadi. |

<a id="marketing-kampanye-kelola"></a>

### Membuat dan menutup kampanye *(Khusus Supervisor & Head)*

1. Klik "Tambah kampanye".
2. Isi "Nama kampanye", "Tujuan", "Tanggal mulai", "Tanggal selesai", dan "Anggaran (Rp)" bila ada.
3. Pilih channel ("Semua channel" atau tertentu) dan "Produk target" (kosong berarti semua produk).
4. Simpan, lalu ubah status menjadi "Berjalan" saat kampanye mulai.
5. Setelah selesai, klik "Tutup kampanye", pilih "Status akhir", dan isi "Hasil kampanye".

> **Catatan:** Anda mendapat notifikasi "Kampanye berakhir — catat hasilnya". Banner "Perlu ditutup" muncul bila ada kampanye yang lewat tanggal selesai tetapi masih Berjalan.

<a id="warehouse"></a>

## Warehouse: barang masuk, keluar, dan stok

*Bagian: Modul divisi*

Mencatat barang masuk dan keluar dengan approval Warehouse Supervisor, melihat stok dari Accurate, mencocokkan catatan gudang dengan Accurate, serta checklist dan insiden gudang.

**Siapa yang memakai:** Tim Warehouse; Procurement dan Retail Commerce melihat pergerakan; Management Office melihat stok.

**Hanya untuk divisi:** Procurement, Retail Commerce, Warehouse

**Menu:** `/warehouse`

<a id="warehouse-tab"></a>

### Tab di halaman Warehouse

| Tab | Isinya |
| --- | --- |
| Hari ini | Ringkasan hari ini. |
| Jadwal kirim | SO yang harus dikirim, apakah stoknya cukup. |
| Stok | Stok dari Accurate per gudang. |
| Dokumen Accurate | Surat jalan, penerimaan, pindah gudang, penyesuaian. |
| Barang masuk / Barang keluar / Riwayat transaksi | Pergerakan yang dicatat tim gudang. |
| Cocokkan Accurate | Pergerakan aplikasi dibandingkan dengan dokumen Accurate. |
| Approval Supervisor | Pergerakan menunggu keputusan (Supervisor). |
| Checklist / Insiden | Checklist harian dan laporan kejadian. |

> **Catatan:** Anda hanya melihat tab yang sesuai akses Anda. Bila membuka tab lain lewat tautan, aplikasi menampilkan tab yang boleh Anda buka.

<a id="warehouse-catat-pergerakan"></a>

### Mencatat barang masuk atau keluar

1. Klik "Buat barang masuk" atau "Buat barang keluar".
2. Isi "Tanggal transaksi" dan "Nomor referensi" (nomor dokumen Accurate, SJ pemasok, PO, atau SO).
3. Barang masuk: isi "Supplier". Barang keluar: isi "Tujuan" (cabang atau nama pelanggan, tanpa alamat).
4. Untuk setiap barang, isi "Kode barang Accurate", "Produk", "Jumlah", "Satuan" (seperti di Accurate), dan bila ada "Batch", "Kedaluwarsa", "Lokasi". Klik "Tambah barang" untuk baris berikutnya.
5. Tulis "Catatan" untuk Supervisor bila perlu.
6. Simpan sebagai draft, lalu klik "Ajukan ke Supervisor".

> **Tips**
>
> - Kode barang Accurate wajib, supaya pergerakan bisa dicocokkan otomatis.
> - Tanpa nomor referensi, Supervisor harus memasangkannya manual.
> - Bila muncul "Data ini sudah diubah orang lain", klik "Muat versi terbaru" sebelum melanjutkan.

<a id="warehouse-status-pergerakan"></a>

### Status pergerakan barang

| Status | Artinya |
| --- | --- |
| Draft | Pembuat perlu melengkapi lalu mengajukan. |
| Menunggu review | Menunggu keputusan Warehouse Supervisor. Data dikunci. |
| Perlu revisi | Supervisor minta perbaikan. Perbaiki lalu ajukan ulang. |
| Disetujui | Sudah disetujui dan tidak dapat diubah. |
| Ditolak | Tidak dapat diubah. Buat pergerakan baru bila perlu. |
| Dibatalkan | Dibatalkan Warehouse Head. |

<a id="warehouse-approval-pergerakan"></a>

### Menyetujui pergerakan barang *(Khusus Supervisor & Head)*

1. Buka tab "Approval Supervisor", atau notifikasi approval (juga dikirim lewat email).
2. Periksa barang, jumlah, dan nomor referensi.
3. Klik "Setujui", "Minta revisi" (catatan wajib), atau "Tolak" (catatan wajib).

> **Catatan:** Keputusan tercatat atas nama Anda. Riwayat lengkap ada di kartu "Riwayat audit".

<a id="warehouse-stok"></a>

### Stok dari Accurate

Tab "Stok" menampilkan angka stok Accurate per gudang, dari tarikan yang sudah disetujui Supervisor atau Head Warehouse.

| Status | Artinya |
| --- | --- |
| Ada | Stok tersedia. |
| Menipis | Di bawah batas minimum. |
| Habis | Stok nol. |
| Minus | Stok di bawah nol; perlu dibereskan di Accurate. |

> **Tips**
>
> - Klik barang untuk melihat "Kartu stok" dan "Riwayat stok".
> - Banner "Ada pembaruan stok menunggu persetujuan" berarti tarikan baru belum disetujui.
> - Di "Jadwal kirim", stok dibagi ke SO dengan janji kirim paling awal lebih dulu.

<a id="warehouse-cocokkan"></a>

### Cocokkan Accurate

Tab "Cocokkan Accurate" membandingkan pergerakan di aplikasi dengan dokumen Accurate.

| Status | Artinya |
| --- | --- |
| Cocok | Aplikasi dan Accurate sama. |
| Selisih jumlah | Jumlahnya berbeda. |
| Belum di Accurate | Ada di aplikasi, belum ada dokumen Accurate. |
| Belum di aplikasi | Ada di Accurate, belum dicatat di aplikasi. |
| Dijelaskan | Selisih sudah dijelaskan Supervisor/Head. |
| Menunggu data Accurate | Tarikan berikutnya belum disetujui. |

> **Catatan:** Accurate hanya dibaca. Selisih diperbaiki di sumbernya: dokumen Accurate atau pergerakan di aplikasi.

<a id="warehouse-jelaskan-selisih"></a>

### Menyelesaikan selisih *(Khusus Supervisor & Head)*

1. Buka baris yang berselisih.
2. Bila dokumen Accurate-nya ada, klik "Pasangkan dokumen Accurate" dan pilih dokumennya (saran ±14 hari muncul otomatis).
3. Bila selisih memang wajar, klik "Tandai sudah dijelaskan" dan tulis alasannya (minimal 5 karakter).

> **Perhatian:** Penjelasan harus diberikan oleh Supervisor/Head yang tidak mencatat pergerakan itu sendiri.

<a id="warehouse-checklist-insiden"></a>

### Checklist harian dan insiden

**Checklist**
1. Klik "Buat checklist".
2. Isi "Tanggal", "Judul", dan "Item" (satu item per baris).
3. Centang item yang sudah dikerjakan.

**Insiden**
1. Klik "Laporkan insiden".
2. Isi "Tanggal", "Kategori" (kerusakan, kehilangan, keterlambatan), "Tingkat" (Rendah, Sedang, Tinggi, Kritis), dan "Deskripsi".
3. Saat beres, pilih "Selesaikan insiden" dan isi "Resolusi".

<a id="procurement"></a>

## Procurement: PO, pemasok, dan barang datang

*Bagian: Modul divisi*

PO, pemasok, dan barang datang dari Accurate, setelah tarikan disetujui Supervisor/Head Procurement. Member melihat jumlah dan tanggal; harga hanya untuk yang berwenang.

**Siapa yang memakai:** Tim Procurement; Management Office melihat juga (hanya baca).

**Hanya untuk divisi:** Procurement

**Menu:** `/procurement`

<a id="procurement-hari-ini"></a>

### Hari ini, Purchase order, dan Pemasok

| Tab | Isinya |
| --- | --- |
| Hari ini | Barang datang hari ini, dijadwalkan datang hari ini & besok, dan yang perlu perhatian. |
| Purchase order | Semua PO dengan status penerimaan barangnya. |
| Pemasok | Kinerja pemasok: PO terbuka, terlambat, fill rate dan ketepatan waktu 90 hari. |

**Status PO**

| Status | Artinya |
| --- | --- |
| Menunggu barang | Belum ada barang diterima. |
| Sebagian diterima | Baru sebagian datang. |
| Terlambat | Lewat tanggal diharapkan datang. |
| Diterima | Semua barang sudah datang. |
| Ditutup | PO ditutup di Accurate. |
| PO lama | PO lama yang tidak dihitung lagi. |

> **Catatan:** Kontak, alamat, NPWP, dan rekening pemasok tidak diambil dari Accurate; lihat langsung di Accurate.

<a id="procurement-saran-pesan"></a>

### Saran pesan ulang *(Khusus Supervisor & Head)*

Tab "Saran pesan ulang" menghitung barang yang perlu dipesan: bila stok ditambah PO berjalan tidak cukup sampai barang baru datang (ditambah stok pengaman).

| Label | Artinya |
| --- | --- |
| Habis sebelum barang datang | Paling mendesak. |
| Pesan sekarang | Perlu dipesan sekarang. |
| Habis, perlu dicek | Stok habis; periksa apakah masih dibeli rutin. |

> **Tips**
>
> - Klik barang untuk melihat keluar per hari, PO berjalan, waktu datang, dan stok pengaman.
> - Jumlah saran dibulatkan ke atas per satuan beli. Keputusan memesan tetap di tangan Anda, di Accurate.

<a id="procurement-harga-beli"></a>

### Harga beli *(Khusus Supervisor & Head)*

Tab "Harga beli" menampilkan harga terakhir per barang, harga sebelumnya, dan perubahannya (chip Naik, Turun, Hanya 1 harga). Nilai PO dan harga satuan juga tampil di detail PO.

> **Perhatian:** Harga beli rahasia. Jangan meneruskannya ke pihak yang tidak berwenang.

<a id="finance"></a>

## Finance: piutang dan utang

*Bagian: Modul divisi*

Piutang pelanggan dari faktur dan penerimaan Accurate yang batch-nya disetujui Sales atau Retail Commerce; utang ke pemasok dari faktur dan pembayaran pembelian Accurate yang batch-nya disetujui Supervisor/Head Finance. Pengajuan pembayaran dibahas di bab Kerja harian.

**Siapa yang memakai:** Tim Finance dan Management Office.

**Hanya untuk divisi:** Finance

**Menu:** `/finance/receivables`

<a id="finance-piutang"></a>

### Piutang

"Piutang" berisi tagihan pelanggan seluruh divisi: total piutang, lewat jatuh tempo, terlambat lebih dari 90 hari, jatuh tempo 14 hari, tertagih bulan ini, dan perkiraan DSO.

1. Lihat kartu "Umur piutang"; saring per channel dengan chip.
2. Buka tab "Pelanggan terlambat" untuk daftar penagihan.
3. Buka tab "Jatuh tempo 14 hari" untuk mengingatkan pelanggan lebih awal.

> **Catatan:** Sumber piutang adalah batch Data Accurate divisi Sales dan Retail Commerce. Piutang baru berubah setelah Supervisor/Head divisi penjual menyetujui batch-nya, bukan setelah persetujuan Finance. Bila piutang belum terbaru, tanyakan ke Sales atau Retail Commerce apakah batch-nya masih menunggu.

<a id="finance-utang"></a>

### Utang

"Utang" berisi utang ke pemasok: total utang, lewat jatuh tempo, jatuh tempo 14 hari, dan dibayar bulan ini.

- Tab "Jatuh tempo 14 hari": rencana pembayaran.
- Tab "Lewat jatuh tempo": prioritas.
- Tab "Per pemasok": total per pemasok.

> **Catatan:** Sumber utang adalah batch Data Accurate Finance, yang disetujui Supervisor/Head Finance. Bila tertulis "Data utang belum tersedia", tarikan pertama belum disetujui. Status pengajuan pembayaran di Workspace (Disetujui, Diproses, Dibayar) tidak mengubah utang; utang berubah saat pembayaran pembelian di Accurate masuk lewat batch berikutnya.

<a id="finance-umur"></a>

### Cara membaca umur piutang dan utang

| Kelompok | Artinya |
| --- | --- |
| Belum jatuh tempo | Masih dalam termin. |
| 1–30 hari | Terlambat sampai sebulan. |
| 31–60 hari | Terlambat 1–2 bulan. |
| 61–90 hari | Terlambat 2–3 bulan. |
| Lebih dari 90 hari | Perlu tindakan khusus. |

> **Catatan:** Faktur uang muka dan faktur mata uang asing yang belum lunas tidak dihitung. Setiap kelompok menunjukkan jumlah faktur dan persentasenya.

<a id="people-culture"></a>

## People & Culture: onboarding, offboarding, dan GA

*Bagian: Modul divisi*

Mengelola karyawan masuk dan keluar dengan checklist IT, GA, atasan, dan People & Culture; memproses Layanan GA; dan menjalankan operasional kantor. Absensi, cuti, dan payroll tetap di KantorKu.

**Siapa yang memakai:** Tim People & Culture (termasuk GA).

**Hanya untuk divisi:** People & Culture

**Menu:** `/hrga/onboarding`

<a id="people-culture-kantorku"></a>

### Yang tetap di KantorKu

> **Perhatian:** Absensi, cuti, penggajian, dan data pribadi karyawan (KTP, NPWP, BPJS, rekening) tetap di KantorKu. Jangan mengunggah kontrak, KTP, offer letter, atau surat resign ke Prakasa Workspace.

Di aplikasi hanya ada "Referensi KantorKu": ID karyawan KantorKu dan tautan referensinya.

<a id="people-culture-onboarding"></a>

### Onboarding karyawan baru

1. Buka "Onboarding", klik "Buat onboarding".
2. Isi "Karyawan": "Sudah ada di direktori?", "Nama lengkap", "Divisi", "Jabatan", "Atasan langsung", "Lokasi kerja".
3. Isi "Jadwal" ("Tanggal mulai") dan "Kebutuhan": "Email kerja rencana", "Perangkat" (Laptop/PC/Tidak), "Nomor perusahaan" (HP/Telepon IP/Tidak), "Lisensi".
4. Pilih "PIC People & Culture", lalu simpan sebagai draf.
5. Klik "Ajukan". Atasan menyetujui, lalu checklist dibuat otomatis.
6. Pantau "Progres" dan "Lewat tenggat" di daftar.

> **Catatan:** Checklist dibuat saat pengajuan disetujui. Tenggat dihitung dari tanggal mulai, paling awal hari disetujui.

<a id="people-culture-offboarding"></a>

### Offboarding karyawan keluar

1. Buka "Offboarding", klik "Buat offboarding".
2. Pilih "Karyawan", isi "Hari terakhir" dan "Alasan" (Resign, Kontrak selesai, Lainnya).
3. Simpan, lalu klik "Ajukan".
4. Setelah disetujui, kartu "Kepemilikan" menunjukkan perangkat, lisensi, dan nomor yang dipegang. Klik "Tambah kepemilikan ke checklist" bila ada yang belum masuk.
5. Pastikan semua tugas pengembalian dan penonaktifan akses selesai sebelum hari terakhir.

> **Catatan:** Bila hari terakhir tiba dan akses/aset belum beres, People & Culture menerima notifikasi dan email.

<a id="people-culture-checklist-alur"></a>

### Mengerjakan checklist alur karyawan

Setiap tugas checklist dimiliki satu tim: IT, GA, Atasan, atau People & Culture.

- Tugas perangkat: "Serahkan perangkat" / "Terima kembali".
- Tugas lisensi: "Berikan lisensi" / "Cabut lisensi". Akses di portal vendor diberikan atau dicabut IT di luar aplikasi; tugas pencabutan baru selesai setelah IT mencentang "Akses sudah dicabut di portal vendor".
- Tugas nomor: "Serahkan nomor" / "Terima kembali nomor".
- Tugas lain: "Tandai selesai", "Lewati", "Tugaskan ke", atau "Buat tiket IT".

> **Catatan:** Akun Google dibuat atau dinonaktifkan di konsol admin Google; di aplikasi tugasnya cukup ditandai selesai.

<a id="people-culture-kelola-alur"></a>

### Menyetujui dan mengelola alur karyawan *(Khusus Supervisor & Head)*

- "Setujui", "Tolak", atau "Minta revisi" pengajuan.
- "Ubah" alur siapa pun, menugaskan ulang tugas, atau "Batalkan workflow" (tugas yang belum selesai berhenti; data tidak dihapus).
- Pengaju bisa "Tarik pengajuan" untuk kembali ke draf.

<a id="people-culture-proses-ga"></a>

### Memproses Layanan GA

1. Buka "Layanan GA", tab "Semua permintaan".
2. Buka permintaan, klik "Tugaskan ke…" bila perlu.
3. Klik "Proses" saat mulai dikerjakan, lalu "Selesaikan". Lampirkan foto/PDF bukti bila ada.

Pemesanan ruang langsung terkonfirmasi bila slotnya kosong, dan pemakaiannya mengikuti jadwal: tidak ada serah terima kunci di aplikasi. GA dapat membatalkan pemesanan bila perlu.

> **Catatan:** Peminjaman kendaraan baru dilakukan di TrackCar, bukan di Workspace, dan Workspace tidak menyinkronkan data TrackCar. Pemesanan kendaraan lama yang tercatat sebelum TrackCar dipakai tetap bisa dibuka sebagai riwayat; tombol "Serahkan kunci" dan "Terima kembali" hanya muncul di pemesanan kendaraan lama itu.

> **Tips**
>
> - Tab "Jadwal" menunjukkan pemakaian ruang.
> - Perbaikan mendesak bertarget 1 hari; permintaan "Lainnya" 5 hari sejak disetujui.

<a id="people-culture-sumber-daya-ga"></a>

### Mengatur ruang (Sumber daya) *(Khusus Supervisor & Head)*

Di tab "Sumber daya", klik "Tambah ruang" untuk menambah ruang per lokasi, atau ubah ruang yang ada. Lokasi baru ditambahkan dulu di IT → Perangkat → tab "Lokasi".

<a id="people-culture-operasional-ga"></a>

### Operasional GA

| Tab | Isinya | Status |
| --- | --- | --- |
| Perawatan berkala | AC, APAR, genset, lift, pengendalian hama, dan lainnya. | Sesuai jadwal, Segera, Lewat jadwal |
| Kontrak & sewa | Sewa gedung, kebersihan, keamanan, dan lainnya. | Aktif, Segera berakhir, Lewat masa kontrak, Selesai |
| Tagihan utilitas | Listrik, air, gas. | Belum dibayar, Segera jatuh tempo, Lewat jatuh tempo, Dibayar |

**Mencatat perawatan**
1. Buka tab "Perawatan berkala", pilih jadwal.
2. Klik "Catat perawatan", pilih hasil "Baik" atau "Perlu tindak lanjut".

> **Catatan:** Pembayaran tagihan tetap diajukan lewat Pengajuan pembayaran ke Finance. Di sini GA hanya mencatat tagihan dan tanggal lunasnya.

<a id="people-culture-operasional-kelola"></a>

### Mengatur jadwal, kontrak, dan tagihan *(Khusus Supervisor & Head)*

- "Tambah jadwal perawatan": isi interval (misalnya 90 hari untuk servis AC tiap 3 bulan).
- "Tambah kontrak": isi "Pengingat sebelum berakhir (hari)", bawaan 60.
- "Catat tagihan": jenis, nilai, dan jatuh tempo.

> **Catatan:** Kontrak yang segera berakhir dan tagihan lewat jatuh tempo dikirim lewat notifikasi dan email.

<a id="people-culture-kelola-direktori"></a>

### Mengelola Direktori *(Khusus Supervisor & Head)*

- "Tambah orang" untuk karyawan tanpa akun.
- "Impor dari laporan" untuk memperbarui banyak data sekaligus (periksa pratinjaunya dulu).
- Chip status Aktif / Resign / Dikecualikan.

> **Catatan:** Nama, email kerja, dan divisi orang yang punya akun diubah oleh Administrator Sistem di menu Pengguna.

<a id="it-aset"></a>

## IT: perangkat, langganan, dan infrastruktur

*Bagian: Modul divisi*

Aset perangkat dan pemakainya, langganan software dan lisensinya, jaringan, CCTV, backup, nomor telepon perusahaan, serta pemrosesan Tiket IT.

**Siapa yang memakai:** Tim IT (bagian People & Culture).

**Hanya untuk divisi:** People & Culture

**Menu:** `/it/dashboard`

<a id="it-aset-dashboard-it"></a>

### Dashboard IT

Ringkasan karyawan di direktori, total perangkat, perangkat bermasalah, perangkat tanpa nomor aset, perangkat di tangan karyawan resign, langganan software, dan perpanjangan dalam 30 hari.

> **Tips**
>
> - Klik "Buat laporan aset AI" untuk ringkasan aset dari Prakasa AI; periksa isinya sebelum dibagikan.

<a id="it-aset-perangkat"></a>

### Perangkat

| Status | Artinya |
| --- | --- |
| Aktif | Dipakai seseorang. |
| Cadangan | Siap dipakai. |
| Perawatan / Perbaikan | Sedang dirawat atau diperbaiki di vendor. |
| Rusak / Tidak aktif / Hilang | Butuh alasan saat mengubah status. |
| Dibuang | Final, tidak bisa diubah lagi. |

> **Tips**
>
> - Pakai chip "Bermasalah", "Tanpa nomor aset", "Di tangan karyawan resign", atau "Garansi ≤ 60 hari".
> - Lokasi baru ditambahkan di tab "Lokasi".

<a id="it-aset-serah-terima"></a>

### Menambah, menyerahkan, dan merawat perangkat *(Khusus Supervisor & Head)*

1. Klik "Tambah perangkat" atau "Impor dari laporan".
2. Buka perangkat, klik "Serahkan perangkat" dan pilih pemegangnya. Buat BAST dari "Riwayat pemakaian".
3. Saat dikembalikan, klik "Kembalikan perangkat" dan buat BAST pengembalian.
4. Catat "Catat perawatan" atau "Catat perbaikan di vendor" bila ada.

> **Catatan:** Perangkat yang belum dikembalikan tepat waktu memicu notifikasi dan email.

<a id="it-aset-langganan"></a>

### Langganan software

Daftar langganan: produk, paket, jumlah seat, harga per seat, siklus tagihan, dan tanggal perpanjangan. Semua yang dicatat di sini adalah register Workspace; akun di vendor, pembayaran ke vendor, dan pembukuan di Accurate dikerjakan di luar aplikasi.

- "Tambah langganan" dan "Ubah langganan" (izin kelola langganan; standar Supervisor dan Head People & Culture). Setelah vendor memperpanjang, perbarui tanggal perpanjangan langganan yang sama; status Akan berakhir kembali Aktif bila tanggal baru lebih dari 30 hari lagi.
- "Catat invoice", "Unggah PDF invoice", dan "Tandai terverifikasi" (izin kelola invoice; standar Head). Invoice tanpa PDF berstatus Menunggu file PDF; setelah PDF diunggah statusnya Menunggu verifikasi, lalu Terverifikasi.
- "Tambah lisensi", "Catat penetapan lisensi", dan "Catat pencabutan lisensi" (izin kelola lisensi; standar Head). Beri atau cabut akses di portal vendor dulu, lalu catat di sini. Lisensi idle masih dipegang dan harus dicabut sebelum diberikan ke orang lain.
- "Catat pembayaran" (izin kelola pembayaran; standar Head). Pembayaran sebagian membuat invoice Dibayar sebagian; invoice Lunas (tercatat) bila pembayaran yang dicatat menutup totalnya. Nomor bukti di Accurate diisi manual.

> **Catatan:** Tombol hanya muncul bagi yang punya izinnya; peran custom mengikuti izinnya, bukan nama perannya. Persetujuan perpanjangan belum tersedia di Workspace. Perpanjangan yang mendekati tanggal dikirim lewat notifikasi dan email; invoice yang belum diunggah atau diverifikasi lewat notifikasi. Pembayarannya diajukan lewat Pengajuan pembayaran.

<a id="it-aset-infrastruktur"></a>

### Infrastruktur IT dan nomor perusahaan

Tab: Jaringan, ISP, CCTV, Backup, Google Workspace, Telepon & HP, dan Vendor.

- CCTV: Online, Sebagian offline, Offline. Backup: Berhasil, Gagal, Belum diperiksa.
- Google Workspace: catat review dari konsol admin Google tiap 3 bulan ("Catat review").
- Telepon & HP: nomor milik perusahaan, pemegangnya ("Ganti pemegang"), dan BAST serah terima/pengembalian.

> **Perhatian:** Hanya nomor milik perusahaan yang dicatat. Jangan mencatat nomor pribadi, PIN, PUK, atau nomor SIM.

<a id="it-aset-proses-tiket"></a>

### Memproses Tiket IT *(Khusus Supervisor & Head)*

Tim IT melihat semua tiket dari seluruh divisi. Salinan tiket baru juga masuk ke email support.

1. Buka tiket berstatus "Terbuka", klik "Mulai kerjakan".
2. Butuh info dari pengaju? Tulis di "Percakapan" lalu klik "Tunggu respons pengaju".
3. Setelah beres, klik "Tandai selesai". "Tutup tiket" bila tidak perlu dibuka lagi.

> **Perhatian:** Tiket yang ditutup tidak bisa dibuka lagi.

<a id="data-accurate"></a>

## Data Accurate: memeriksa dan menyetujui

*Bagian: Pemantauan & manajemen*

Data dari Accurate ditarik otomatis setiap beberapa menit, tetapi baru dipakai di aplikasi setelah Supervisor atau Head divisinya menyetujui batch-nya. Aplikasi hanya membaca Accurate; tidak ada data Accurate yang diubah atau dihapus.

**Siapa yang memakai:** Supervisor dan Head Sales, Retail Commerce, Warehouse, Procurement, dan Finance; Head Management Office memantau.

**Hanya untuk divisi:** Finance, Procurement, Sales, Retail Commerce, Warehouse

**Menu:** `/data-accurate`

<a id="data-accurate-cara-kerja"></a>

### Cara kerja batch Accurate

1. Aplikasi menarik data dari Accurate (hanya membaca) dan menyusunnya menjadi satu batch per divisi.
2. Batch berstatus "Menunggu persetujuan". Angka di aplikasi belum berubah.
3. Supervisor atau Head divisi memeriksa dan memutuskan.
4. Bila disetujui, data diterapkan dan angka di modul divisi ikut berubah.

| Status batch | Artinya |
| --- | --- |
| Menunggu persetujuan | Belum dipakai di aplikasi. |
| Disetujui & diterapkan | Sudah dipakai. |
| Ditolak | Tidak dipakai. Perbaiki di Accurate; tarikan berikutnya membuat batch baru. |
| Ditarik kembali | Dibatalkan sebelum diputuskan. |

**Jenis perubahan dalam batch**

| Label | Artinya |
| --- | --- |
| Baru | Data baru di Accurate. |
| Berubah | Data yang berubah sejak tarikan lalu. |
| Tidak ada lagi | Sudah tidak ada di Accurate. Hanya ditandai; tidak ada data yang dihapus. |

<a id="data-accurate-menyetujui"></a>

### Menyetujui atau menolak batch *(Khusus Supervisor & Head)*

1. Buka notifikasi "Data Accurate menunggu persetujuan" (juga dikirim lewat email), atau menu modul divisi Anda → "Data Accurate".
2. Di tab "Batch", klik "Periksa & putuskan".
3. Periksa ringkasan dan perubahan: Baru, Berubah, Tidak ada lagi. Untuk Sales, lihat juga "DPP SO baru/berubah".
4. Klik "Setujui & terapkan" bila datanya benar, lalu konfirmasi "Setujui data Accurate?".
5. Bila salah, klik "Tolak", isi "Alasan penolakan", lalu "Tolak batch". Perbaiki datanya di Accurate.

> **Perhatian:** Jangan menyetujui batch yang belum Anda periksa. Setelah disetujui, angka di dashboard, piutang, stok, dan laporan ikut berubah.

> **Catatan:** Batch yang lama tidak diputuskan dikirim sebagai pengingat lalu eskalasi lewat email. Tombol Setujui juga ada langsung di notifikasinya.

<a id="data-accurate-periksa-dengan-ai"></a>

### Periksa dengan AI sebelum menyetujui *(Khusus Supervisor & Head)*

Di halaman sebuah batch ada kartu "Pemeriksaan sebelum memutuskan". Tombol "Periksa dengan AI" menjalankan pemeriksaan otomatis atas isi batch, lalu Prakasa AI menuliskan catatan singkat. Ini catatan untuk Anda: keputusan menyetujui atau menolak tetap Anda ambil sendiri.

1. Buka batch yang menunggu keputusan Anda ("Data Accurate" → "Periksa & putuskan").
2. Di kartu "Pemeriksaan sebelum memutuskan", klik "Periksa dengan AI".
3. Baca "Temuan pemeriksaan otomatis". Tiap temuan memuat tingkat, jumlah dokumen, penjelasan mengapa itu penting, dan beberapa nomor dokumen contoh.
4. Klik nomor dokumen contoh untuk menampilkannya di daftar "Isi batch".
5. Baca "Catatan AI — bukan keputusan": isi batch, yang perlu dicermati, dan pertanyaan untuk tim.
6. Tanyakan hal yang janggal ke admin Accurate atau tim terkait, lalu putuskan sendiri dengan "Setujui & terapkan" atau "Tolak".

**Yang diperiksa otomatis**

| Temuan | Artinya |
| --- | --- |
| Nilai dokumen yang sudah ada berubah besar | Nilai dokumen berubah 20% atau lebih, atau Rp 10 juta atau lebih, dibanding data yang sudah disetujui. |
| Data yang tidak ada lagi di Accurate | Dokumen atau data yang pernah disetujui, tetapi sekarang sudah tidak ada di Accurate. |
| Nomor dokumen yang sama muncul dua kali | Satu nomor dipakai dua dokumen berbeda. |
| Perubahan pada dokumen bulan sebelumnya | Dokumen bertanggal bulan lalu diubah atau hilang; angka bulan itu ikut berubah. |
| Perubahan pada dokumen lama | Dokumen bertanggal lebih dari 30 hari sebelum tarikan diubah atau hilang. |
| Dokumen bertanggal setelah hari tarikan | Tanggal dokumen lebih maju dari hari data ditarik. |
| Dokumen untuk customer yang belum ada di master aplikasi | Kode customer pada dokumen belum ada di master customer aplikasi. |
| Channel kosong | Dokumen atau customer tanpa channel. |
| Faktur tanpa sales order | Faktur yang tidak merujuk sales order. |
| Barang tanpa konversi satuan | Faktur memuat barang yang belum punya konversi satuan. |

> **Perhatian:** Prakasa AI tidak pernah menyetujui atau menolak batch, dan tidak memberi rekomendasi keputusan. AI bisa keliru: periksa dokumennya sendiri sebelum memutuskan.

> **Tips**
>
> - Hasil pemeriksaan terakhir tersimpan di batch, lengkap dengan siapa yang menjalankannya dan kapan. "Periksa ulang dengan AI" menggantinya.
> - Nilai rupiah pada temuan hanya tampil bagi yang berhak melihat angka uang divisinya. Nilai purchase order tidak pernah ditampilkan.
> - Pemeriksaan dibatasi 6 kali per jam untuk tiap orang.
> - Bila Prakasa AI sedang tidak tersedia atau batas harian tercapai, temuan pemeriksaan otomatis tetap tampil.

> **Catatan:** Pemeriksaan hanya membaca isi batch yang sudah tersimpan di aplikasi dan membandingkannya dengan data yang sudah disetujui. Accurate tidak dihubungi dan tidak ada data yang diubah.

<a id="data-accurate-perlu-dibereskan"></a>

### Perlu dibereskan di Accurate

Tab "Perlu dibereskan di Accurate" berisi data Accurate yang tidak lengkap atau tidak wajar (misalnya stok minus). Perbaikannya dilakukan di Accurate oleh pemilik datanya; tarikan berikutnya membawa data yang sudah benar.

<a id="data-accurate-tarik-sekarang"></a>

### Tarik sekarang *(Khusus Supervisor & Head)*

Tarikan berjalan otomatis. Bila butuh data terbaru segera, klik "Tarik sekarang" di panel "Sinkron otomatis dengan Accurate" (atau tab "Data Accurate" di modul divisi). Tarikan pertama bisa beberapa menit.

> **Catatan:** Tarikan dilewati bila tarikan lain masih berjalan atau batch sebelumnya masih menunggu keputusan.

<a id="dashboard-divisi"></a>

## Dashboard divisi dan grafik capaian bulanan

*Bagian: Pemantauan & manajemen*

Satu susunan dashboard yang sama untuk setiap divisi: angka utama, perlu perhatian, grafik capaian bulanan, tren 12 bulan, capaian terhadap target, dan pekerjaan lewat tenggat.

**Siapa yang memakai:** Supervisor dan Head setiap divisi; Management Office memilih divisi mana pun.

**Menu:** `/division-dashboard`

<a id="dashboard-divisi-membaca"></a>

### Membaca dashboard divisi

1. Buka "Dashboard divisi". Management Office memilih divisi di "Divisi".
2. Baca dari atas ke bawah: bagian yang sama selalu ada di urutan yang sama, apa pun divisinya.
3. Klik "Muat ulang" untuk data terbaru.

| Urutan | Bagian | Isinya |
| --- | --- | --- |
| 1 | Angka utama | Posisi hari ini per modul divisi; angkanya naik saat halaman dibuka. |
| 2 | Perlu perhatian | Jumlah pekerjaan lewat tenggat per sumber, dengan tombol ke Pusat eskalasi. |
| 3 | Grafik capaian bulanan | Grafik bergerak 12 bulan terakhir. |
| 4 | Tren 12 bulan | Satu kartu per ukuran, dengan garis target bila ada. |
| 5 | Capaian terhadap target | Persentase capaian tiap ukuran pada bulan lengkap terakhir. |
| 6 | Pekerjaan lewat tenggat | Daftar kerja yang paling lama menunggu. |

> **Catatan:** Bagian yang datanya belum ada tetap tampil di tempatnya dengan keterangan "menunggu data", supaya dashboard setiap divisi terbaca sama. Angka yang berasal dari Accurate hanya mencakup batch yang sudah disetujui.

<a id="dashboard-divisi-motion-chart"></a>

### Grafik capaian bulanan

Grafik capaian bulanan menggambarkan perjalanan capaian divisi bulan demi bulan. Tekan tombol putar atau geser penanda bulan untuk melihat perubahannya.

> **Catatan:** Bila tertulis "Grafik capaian bulanan menunggu data", modul divisi belum mencatat pekerjaan minimal 3 bulan.

<a id="dashboard-divisi-tren-target"></a>

### Tren 12 bulan dan target

Setiap grafik tren menampilkan realisasi per bulan dan garis target bulanan. Target ditetapkan manajemen di "Target & realisasi".

<a id="dashboard-divisi-capaian-target"></a>

### Capaian terhadap target

Untuk setiap ukuran yang punya target bulanan, bagian ini menampilkan capaian bulan lengkap terakhir sebagai persentase: hijau bila target tercapai, oranye bila 80% atau lebih, merah bila di bawahnya. Ukuran "makin rendah makin baik" dianggap tercapai bila di bawah target. Tanpa target bulanan, bagian ini meminta target diisi di "Target".

<a id="dashboard-divisi-lewat-tenggat"></a>

### Perlu perhatian dan pekerjaan lewat tenggat

"Perlu perhatian" menghitung pekerjaan divisi yang lewat tenggat per sumber; "Pekerjaan lewat tenggat" mendaftar yang paling lama menunggu. Klik "Buka Pusat eskalasi" untuk menanganinya (Head dan manajemen).

<a id="laporan"></a>

## Laporan: Google Analytics dan log aktivitas

*Bagian: Pemantauan & manajemen*

Laporan pengunjung situs perusahaan dan jejak audit aktivitas di aplikasi.

**Siapa yang memakai:** Management Office dan Marketing (Analytics); Head Management Office dan Super Admin (log aktivitas).

**Hanya untuk divisi:** Marketing

<a id="laporan-analytics"></a>

### Google Analytics

Pilih "Properti" dan rentang waktu (7 hari, 28 hari, 90 hari, Kustom). Kartu: pengguna aktif & sesi per hari, sumber trafik, perangkat, negara, dan halaman teratas.

<a id="glosarium"></a>

## Glosarium

*Bagian: Referensi*

Istilah yang sering muncul di Prakasa Workspace.

**Siapa yang memakai:** Semua karyawan.

<a id="glosarium-istilah"></a>

### Daftar istilah

| Istilah | Arti |
| --- | --- |
| Accurate | Sistem akuntansi perusahaan. Sumber resmi transaksi; aplikasi hanya membacanya. |
| Batch | Satu paket data tarikan dari Accurate yang menunggu persetujuan divisi. |
| DPP | Dasar pengenaan pajak: nilai sebelum PPN. Omzet di aplikasi selalu DPP. |
| SO / SJ | Sales order dan surat jalan. |
| PO | Purchase order (pesanan pembelian ke pemasok). |
| NOO | New open outlet: pelanggan yang pertama kali difakturkan bulan itu. |
| Dormant / Lost | Pelanggan yang lama tidak order / tidak order 60 hari atau lebih. |
| Tukar faktur | Penyerahan faktur ke pelanggan untuk ditagih, dengan tanda terima. |
| Shared Drive divisi | Folder Google Drive milik divisi, tempat semua dokumen resmi divisi. |
| Kop & footer | Kepala dan kaki surat divisi yang dipakai template dokumen. |
| BAST | Berita acara serah terima, misalnya perangkat atau nomor perusahaan. |
| Approval | Persetujuan atasan atau penyetuju menurut matriks approval. |
| Eskalasi | Pekerjaan lewat tenggat yang dinaikkan untuk ditindaklanjuti. |
| Member / Supervisor / Head | Tiga level peran di setiap divisi. |
| Administrator Sistem | Pengelola konfigurasi aplikasi tanpa akses ke data divisi. |
| KantorKu | Aplikasi HR untuk absensi, cuti, dan payroll. Tidak terhubung dengan Prakasa Workspace. |
| SimpliDOTS | Aplikasi kunjungan lapangan Sales. |
| TrackCar | Aplikasi peminjaman kendaraan kantor. |
| Space | Ruang diskusi tim di Google Chat; bisa punya Project Tracker sendiri. |

<a id="bantuan"></a>

## Kalau ada masalah

*Bagian: Referensi*

Siapa yang dihubungi, dan jawaban untuk pertanyaan yang sering muncul.

**Siapa yang memakai:** Semua karyawan.

<a id="bantuan-siapa"></a>

### Siapa yang dihubungi

| Masalah | Hubungi |
| --- | --- |
| Laptop, internet, software, akun Google | Tim IT lewat "Butuh bantuan IT" atau Tiket IT. |
| Lupa kata sandi atau ingin menggantinya | Super Admin. Kata sandi dikelola oleh Super Admin; tidak ada reset mandiri. |
| Tidak bisa masuk karena akun atau akses belum disiapkan | Administrator Sistem. |
| Menu yang dibutuhkan tidak ada | Atasan Anda, lalu Administrator Sistem untuk mengatur peran. |
| Angka dari Accurate tidak muncul atau salah | Supervisor/Head divisi Anda (persetujuan batch) atau pemilik data di Accurate. |
| ATK, fasilitas rusak, ruang rapat | GA lewat Layanan GA. |
| Absensi, cuti, slip gaji | People & Culture, lewat KantorKu. |
| Pembayaran atau reimbursement | Finance, lewat Pengajuan pembayaran. |

<a id="bantuan-faq"></a>

### Pertanyaan yang sering muncul

**Kenapa menu saya berbeda dengan rekan kerja?**
Menu dan panduan ini disesuaikan dengan divisi dan peran masing-masing. Anda hanya melihat yang boleh Anda buka.

**Saya membuka tautan dari rekan, tapi kembali ke Dashboard.**
Halaman itu bukan untuk peran Anda. Minta atasan bila Anda memang perlu aksesnya.

**Kenapa angka penjualan, stok, atau piutang belum berubah?**
Data Accurate baru dipakai setelah batch-nya disetujui Supervisor/Head divisi. Tanyakan apakah ada batch yang masih menunggu persetujuan.

**Bisakah saya membuat sales order atau mengubah data Accurate dari aplikasi?**
Tidak. Transaksi dibuat di Accurate. Prakasa Workspace hanya membaca dan memantau.

**Di mana saya mengajukan cuti atau melihat absensi?**
Di KantorKu. Prakasa Workspace sengaja tidak mengurus absensi, cuti, dan payroll.

**Apakah Prakasa AI bisa menyetujui atau mengirim sesuatu atas nama saya?**
Tidak. AI hanya menyiapkan draft atau usulan. Anda yang menekan Konfirmasi atau Simpan.

**Saya tidak menerima email notifikasi.**
Email hanya dikirim untuk hal yang menunggu keputusan atau tindakan Anda. Yang lain cukup di lonceng Notifikasi. Periksa juga folder Spam.

**Di mana menyimpan dokumen kerja?**
Di Shared Drive divisi (menu Penyimpanan divisi atau Template dokumen), bukan di laptop atau My Drive pribadi.

**Bagaimana mencetak panduan ini?**
Klik "Cetak / simpan PDF" di atas halaman Panduan. Yang tercetak hanya bab untuk peran Anda.
