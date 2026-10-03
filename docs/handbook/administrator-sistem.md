# Panduan Prakasa Workspace — Administrator Sistem

Untuk: Administrator Sistem (system.admin). Dibuat otomatis dari panduan di aplikasi (menu **Panduan**, alamat `/panduan`); jangan diedit manual — ubah `frontend/src/pages/handbook/handbookContent.js` lalu jalankan `node scripts/build-handbook-docs.mjs` dari folder `frontend`.

Isi panduan mengikuti peran: setiap orang hanya membaca bab untuk menu yang bisa ia buka. Berkas ini menggabungkan semua divisi pada tingkat yang sama; bab yang hanya untuk sebagian divisi ditandai.

## Daftar isi

1. [Mulai memakai Prakasa Workspace](#mulai)
2. [Kerja harian](#kerja-harian)
3. [Komunikasi: Gmail, Google Chat, Groups](#komunikasi)
4. [Dokumen, template, dan tanda tangan](#dokumen)
5. [Pengguna & akses](#admin-pengguna)
6. [Aturan approval & dokumen](#admin-aturan)
7. [Sistem & integrasi](#admin-sistem)
8. [Glosarium](#glosarium)
9. [Kalau ada masalah](#bantuan)

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

<a id="admin-pengguna"></a>

## Pengguna & akses

*Bagian: Administrasi sistem*

Membuat akun, menempatkannya di entitas, divisi, dan peran yang tepat, serta mengatur peran dan izin. Administrator Sistem mengatur sistem tanpa bisa melihat data divisi mana pun.

**Siapa yang memakai:** Administrator Sistem dan Super Admin.

<a id="admin-pengguna-batas-admin"></a>

### Batas peran Administrator Sistem

| Peran | Lihat data divisi | Kelola sistem |
| --- | --- | --- |
| Super Admin | Ya, semua | Ya, termasuk akun Super Admin |
| Administrator Sistem | Tidak | Ya, kecuali akun dan peran Super Admin |

- Tidak bisa mengubah peran dan divisi akun sendiri.
- Tidak bisa mengubah, mereset, atau menghapus akun Super Admin.
- Izin dua peran global hanya bisa diubah Super Admin.
- Tidak bisa mengatur atau mereset kata sandi: kata sandi dikelola oleh Super Admin saja.
- Akun yang dibuat Administrator Sistem masuk dengan akun Google kantor (tanpa kata sandi).
- Semua perubahan tercatat di log aktivitas yang dibaca Super Admin.

> **Perhatian:** Menggabungkan Administrator Sistem dengan peran divisi membuat pengguna itu bisa melihat data divisi tersebut. Aplikasi menampilkan peringatan bila ini terjadi.

<a id="admin-pengguna-pengguna"></a>

### Menambah pengguna

1. Buka "Pengguna", klik "Tambah pengguna".
2. Isi "Nama lengkap" dan "Email" kantor, pilih "Entitas" dan "Divisi".
3. Pilih "Peran" (muncul setelah divisi dipilih): Member, Supervisor, atau Head divisi itu.
4. Pilih "Status awal" Aktif.
5. Khusus Super Admin: bila pengguna perlu masuk dengan kata sandi, isi "Kata sandi sementara (opsional)" (minimal 10 karakter). Kosongkan bila pengguna masuk dengan akun Google kantor.
6. Simpan. Bila kata sandi sementara diisi, sampaikan lewat jalur aman; pengguna wajib menggantinya saat pertama masuk.

> **Catatan:** Kata sandi dikelola oleh Super Admin saja. Administrator Sistem tidak melihat kolom kata sandi: akun yang ia buat masuk dengan akun Google kantor. Bila pengguna itu memerlukan kata sandi, minta Super Admin mengaturnya lewat "Atur ulang kata sandi".

> **Tips**
>
> - Klik ikon ⓘ di samping peran untuk membaca isi peran itu.
> - Akun Super Admin / Administrator Sistem tidak perlu divisi.

<a id="admin-pengguna-reset-sandi"></a>

### Mereset kata sandi atau menonaktifkan akun

Mereset kata sandi hanya bisa dilakukan Super Admin. Tombol "Atur ulang kata sandi" tidak tampil untuk Administrator Sistem. Menonaktifkan akun bisa dilakukan Administrator Sistem maupun Super Admin.

**Mereset kata sandi (Super Admin)**
1. Buka "Pengguna" dan cari akunnya.
2. Klik "Atur ulang kata sandi" di baris akun itu, lalu isi kata sandi sementara (minimal 10 karakter).
3. Sampaikan kata sandi sementara lewat jalur aman. Semua sesi lama akun itu berakhir, dan pengguna wajib membuat kata sandi baru saat masuk berikutnya.

**Menonaktifkan akun**
1. Buka "Pengguna" dan cari akunnya.
2. Klik tombol nonaktifkan di baris akun itu, atau buka akunnya dan ubah "Status" menjadi "Nonaktif".

> **Catatan:** Untuk karyawan keluar, penonaktifan akun mengikuti checklist offboarding dari People & Culture.

<a id="admin-pengguna-sinkronisasi"></a>

### Sinkronisasi Workspace

Mengambil daftar anggota terbaru dari Google Workspace. Tidak ada akun yang dibuat otomatis.

1. Buka "Sinkronisasi Workspace" dan ambil daftar terbaru.
2. Di "Kandidat menunggu tinjauan", pilih divisi dan peran tiap orang, atau "Lewati kandidat".
3. Klik "Sinkronkan akses".

> **Catatan:** Akun yang diterapkan oleh Administrator Sistem masuk dengan akun Google kantor, tanpa kata sandi. Hanya Super Admin yang mendapat kata sandi sementara untuk disampaikan ke pengguna.

<a id="admin-pengguna-peran"></a>

### Peran

Setiap divisi punya tiga peran standar: Member, Supervisor, dan Head. Peran "Custom" bisa dibuat untuk kebutuhan khusus.

| Level | Isinya |
| --- | --- |
| Member | Mengerjakan tugas harian dan mengajukan permintaan di divisinya. |
| Supervisor | Seperti Member, ditambah menyetujui pekerjaan divisi (misalnya batch Accurate atau pergerakan barang) dan Dashboard divisi. |
| Head | Seperti Supervisor, ditambah dashboard manajemen, eskalasi, dan target yang dibatasi ke divisinya, serta cap surat dan template. |

> **Tips**
>
> - "Ubah akses" untuk mengubah izin peran; "Kembalikan ke default" untuk kembali ke izin standar.

<a id="admin-pengguna-izin"></a>

### Izin akses

Daftar hak akses yang bisa diberikan ke peran. Pemberiannya diatur di halaman "Peran".

<a id="admin-pengguna-divisi"></a>

### Divisi

Divisi di setiap entitas: Finance, Procurement, Sales, People & Culture, Management Office, Retail Commerce, Warehouse, dan Marketing. Klik "Tambah divisi" atau "Impor".

<a id="admin-pengguna-entitas"></a>

### Entitas

Badan usaha yang memakai Prakasa Workspace. Klik "Tambah entitas" untuk badan usaha baru.

<a id="admin-aturan"></a>

## Aturan approval & dokumen

*Bagian: Administrasi sistem*

Siapa menyetujui apa, siapa menandatangani dokumen jenis apa, dan di folder Shared Drive mana dokumen disimpan.

**Siapa yang memakai:** Administrator Sistem dan Super Admin.

<a id="admin-aturan-matriks"></a>

### Matriks approval

Alur approval per entitas, divisi, jenis permintaan, tipe dokumen, dan nominal: berurutan atau paralel, dengan pengingat dan eskalasi.

1. Buat matrix: isi "Nama matrix", "Jenis alur", "Jenis permintaan", "Tipe dokumen", nominal minimum/maksimum, dan "Prioritas" (angka kecil didahulukan).
2. Tambahkan langkah: "Urutan", "Approver", "Grup paralel", "Penanda tangan", dan "Pengingat / eskalasi".
3. Nyalakan "Matrix aktif".

> **Perhatian:** Perubahan matriks langsung berlaku untuk pengajuan baru. Uji dengan nominal kecil dulu.

<a id="admin-aturan-aturan-ttd"></a>

### Aturan tanda tangan

Per tipe dokumen: penanda tangan (pengguna atau peran, salah satu), level approval minimum, cek awal AI wajib, verifikasi QR wajib, izinkan delegasi, algoritma checksum (SHA-256 / SHA-512), dan ID folder arsip Drive.

<a id="admin-aturan-jenis-dokumen"></a>

### Jenis dokumen

Jenis dokumen, folder bawaannya, dan apakah dokumen itu butuh tanda tangan atau cek awal AI.

<a id="admin-aturan-aturan-folder"></a>

### Aturan folder

Folder Shared Drive tujuan untuk setiap tipe dokumen, per entitas dan divisi. Pastikan setiap divisi punya folder Shared Drive sendiri.

<a id="admin-sistem"></a>

## Sistem & integrasi

*Bagian: Administrasi sistem*

Koneksi Accurate, mesin Prakasa AI, log integrasi, dan aturan notifikasi & email.

**Siapa yang memakai:** Administrator Sistem dan Super Admin.

<a id="admin-sistem-log-integrasi"></a>

### Log integrasi

Panggilan ke layanan luar (Google, Accurate, AI). Tab "Kesehatan 24 jam" untuk gambaran cepat dan "Log detail" per panggilan untuk mencari penyebab error.

<a id="admin-sistem-notifikasi-email"></a>

### Notifikasi & email

Daftar setiap jenis notifikasi dengan kolom "Di aplikasi" dan "Email". Admin bisa menyalakan atau mematikan email per notifikasi; pilihan admin mengalahkan aturan bawaan. Klik "Kembalikan bawaan" untuk kembali.

> **Tips**
>
> - Email hanya untuk yang menunggu keputusan atau tindakan dan terlambat itu merugikan. Terlalu banyak email membuat email penting terlewat.

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
