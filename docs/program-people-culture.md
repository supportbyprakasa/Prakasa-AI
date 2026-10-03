# Program People & Culture

Status: **dipilih owner 30 September 2026** — prioritas: onboarding & offboarding, layanan GA, direktori & struktur organisasi, dan kebutuhan IT.

Dokumen ini satu-satunya sumber kebenaran untuk pekerjaan People & Culture, dengan cara kerja yang sama seperti [program-4-divisi.md](program-4-divisi.md): gelombang, gerbang per gelombang (tes, build, uji data asli di dalam transaksi yang dibatalkan, cek browser desktop dan ponsel, tinjauan independen dengan pembantah, dokumen diperbarui, laporan).

## Batas yang tidak dilanggar

- **KantorKu HRIS adalah sumber kebenaran untuk absensi, cuti, penggajian, dan data pribadi karyawan.** Aplikasi tidak membangun ulang fitur itu dan tidak pernah menyimpan gaji, rekening, NIK/KTP, NPWP, atau BPJS. Onboarding hanya menyimpan ID dan tautan KantorKu, seperti sekarang.
- **Tidak ada integrasi dengan KantorKu (owner, 30 September: "intinya saya tidak integrasi dengan kantorkuhris").** Tidak ada API, webhook, atau sinkron ke/dari KantorKu. Tautan "Referensi KantorKu" yang opsional di onboarding tetap hanya tautan.
- **Tidak ada perubahan nyata di Google Workspace dari pengujian.** Pembuatan akun dan akses Google tetap menjadi tugas checklist untuk IT dengan tautan ke konsol admin. Otomatisasi penuh (menulis ke Google) adalah keputusan owner tersendiri.
- Aturan program sebelumnya tetap berlaku: data lama tidak diubah atau dihapus, tanpa commit kecuali diminta, UI Material 3, dan setiap modul masuk eskalasi, target, dan KPI manajemen per divisi.

## Keputusan yang berlaku

- **Wewenang keputusan:** Claude memutuskan atas nama owner sebagai peran senior terkait (Head People & Culture, GA Lead, IT Lead) dan mencatatnya di sini.
- **Per entitas (owner, 30 September: "ini dibuat sesuai entitas, dan saat ini kita di entitas prakasa foods nusantara"):** perangkat, lokasi, jaringan, CCTV, direktori, dan permintaan GA milik satu entitas aplikasi. Laporan IT grup (PFN, PMK, IGS, Djaya77, SFG) hanya diimpor bagian entitas yang sedang dipakai; entitas lain menyusul bila dibuat di aplikasi.
- **Fokus PFN (owner, 30 September: "ya uda fokuskan yang pfn"):** semua pekerjaan People & Culture saat ini hanya untuk entitas Prakasa Foods Nusantara; data PMK, IGS, Djaya77, dan SFG tidak dimasukkan dan tidak dirancang khusus.
- **Lokasi PFN (IT Lead, 30 September):** PFN Office dan Alsut Office dikelola PFN (termasuk jaringan, ISP, dan CCTV-nya); 9 perangkat Djaya77 di Alsut Office tetap milik Djaya77 dan tidak diimpor; Toko Jelambar (Djaya77), PMK Office, dan IGS Office bukan lokasi PFN.
- **Tidak ada password di aplikasi (IT Security, 30 September):** password WiFi, admin router/NVR, dan akun tidak disimpan dan tidak diimpor. Laporan Excel IT saat ini memuat 4 password WiFi dalam teks biasa; disarankan dipindah ke password manager dan diganti.
- **Direktori di aplikasi (Head People & Culture, 30 September):** aplikasi menyimpan data direktori minimal yang dibutuhkan alur kerja: jabatan, atasan langsung, nomor kerja/ekstensi, dan lokasi kerja. Data ini dikelola People & Culture di aplikasi (karena tidak ada integrasi KantorKu), setiap perubahan tercatat di log, dan tidak ada data gaji atau data pribadi.
- **Kendaraan lewat TrackCar (owner, 1 Oktober):** peminjaman kendaraan sudah punya aplikasi sendiri, trackcar.prakasafoods.com. Layanan GA hanya memesan ruang dan menerima permintaan; menu "Pinjam kendaraan" membuka TrackCar. Server menolak sumber daya dan pemesanan kendaraan, dan eskalasi/KPI kendaraan dihapus dari manajemen.
- **Butuh bantuan IT (owner, 1 Oktober):** tombol bantuan (ikon support) di bilah atas setiap halaman, untuk semua peran dan divisi, seperti tombol Support di admin console. Tombol mengambang di pojok bawah tidak dipakai karena bertabrakan dengan snackbar/panel AI dan menutupi konten di ponsel. Permintaan menjadi tiket di Tiket IT (beserta halaman asal) dan salinannya dikirim ke email support (bawaan support@prakasagroup.com; People & Culture Supervisor/Head mengubahnya lewat Tiket IT → Pengaturan). Kirim email memakai pengirim Gmail aplikasi; bila belum diatur atau gagal, tiket tetap tersimpan.
- **Tiket IT ↔ Project Tracker ↔ Google Chat Space (owner, 1 Oktober):** di Tiket IT → Pengaturan, Supervisor/Head memilih satu project Project Tracker (hanya project yang Space-nya ia ikuti). Setiap tiket baru otomatis menjadi issue `[Tiket IT #id] judul` berlabel `tiket-it` di project itu, tanpa batas WIP, dan diumumkan di Space Google Chat project tersebut atas nama Supervisor/Head yang menyimpan pengaturan (pengaju belum tentu anggota Space). Status saling mengikuti tanpa berputar: Terbuka → To do; Sedang dikerjakan/Menunggu pengaju → In progress; Selesai/Ditutup/Dibatalkan → Done. Memindahkan issue ke In progress atau Done di papan memindahkan tiket (Done dari Terbuka melewati Sedang dikerjakan lalu Selesai). Hanya tim IT yang melihat tautan issue di detail tiket. Bila project belum dipilih atau gagal, tiket tetap tersimpan seperti biasa. Kolom baru `it_tickets.tracker_issue_id` (migrasi 111); bila issue dihapus, tautannya kosong dan tiket tetap ada.
- **Urutan menu samping per peran (owner, 1 Oktober):** menu diurutkan menurut prioritas pemakaian. Pekerjaan divisi sendiri langsung di bawah Dashboard, Notifikasi, dan Prakasa AI. Head mendapat Manajemen setelahnya. Kerja harian, Komunikasi, dan Dokumen menyusul, lalu modul divisi lain dan Laporan. Administrasi paling bawah. Aturannya ada di docs/ui-guideline.md §2.2.
- **Operations bukan divisi; GA di bawah People & Culture (owner, 1 Oktober):**
  - **Keputusan owner:** "Kalau di perusahaan saya GA yang urus" dan "seharusnya GA atau operation itu under People & Culture". Pekerjaan operasional kantor (ATK, perbaikan fasilitas, ruang rapat; kendaraan lewat TrackCar) adalah Layanan GA, yang dijalankan People & Culture.
  - **Divisi dinonaktifkan:** divisi Operations sebelumnya kosong (0 pengguna, 0 peran terpakai, hanya kartu "Segera hadir"). Migrasi 113 menonaktifkan divisi itu dan 3 peran standarnya lewat soft-delete. Bisa dikembalikan dengan mengosongkan `deleted_at`. Langkah ini tercatat di log aktivitas (`department.retire`).
  - **Yang tidak disentuh:** aturan folder Drive Operations dan folder Drive-nya tetap ada.
  - **Menu dan halaman:** menu, kartu beranda, dan halaman "Segera hadir" Operations dihapus. Tautan lama diarahkan ke beranda.
  - **Katalog divisi:** kini 8 divisi, 24 peran standar (`RETIRED_DIVISIONS` di standardOrganization.js).
- **Operasional GA (owner, 1 Oktober: "boleh"):** menu baru People & Culture → Operasional GA (`/ga/operations`, migrasi 114).
  - **Perawatan berkala:** AC, APAR, genset, lift, pengendalian hama, air, listrik, dan gedung. Tiap jadwal punya interval dan tanggal jatuh tempo, dengan usulan interval per jenis. Setelah "Catat perawatan" diisi, jadwal berikutnya otomatis menjadi tanggal itu + interval. Riwayatnya tidak bisa dihapus.
  - **Kontrak & sewa:** sewa gedung, kebersihan, keamanan, pengendalian hama, sampah, dan perawatan. Pengingat muncul sejumlah hari sebelum kontrak berakhir (bawaan 60).
  - **Tagihan utilitas:** listrik, air, dan gas per lokasi dan per bulan, unik per nomor meter. Pembayaran tetap diajukan lewat Finance; GA mencatat tanggal lunasnya.
  - **Akses:** Member People & Culture melihat dan mencatat perawatan. Supervisor/Head mengelola. Super Admin punya akses penuh. Administrator Sistem tidak punya akses.
  - **Manajemen:** ada eskalasi perawatan lewat jadwal, kontrak segera berakhir, dan tagihan lewat jatuh tempo, ditambah KPI perawatan lewat jadwal serta target perawatan selesai dan tepat jadwal. Semuanya dibatasi ke divisi People & Culture dan tidak pernah menampilkan nominal uang. Log aktivitas juga tidak mencatat nominal uang.
  - **Prasyarat:** lokasi perusahaan belum diisi. Lokasi ditambahkan di IT → Perangkat → tab Lokasi sebelum jadwal dan tagihan dicatat.
- **Kolaborasi IT–GA, BAST, dan template dokumen (owner, 1 Oktober):** menu Dokumen → Template dokumen (`/doc-templates`, migrasi 115).
  - **Kop & footer per divisi:**
    - Pengaturannya: logo atau gambar kop surat divisi, nama perusahaan, alamat/kontak, warna aksen, teks footer, dan nomor halaman.
    - Aplikasi membuat Google Doc "Kop & footer — <Divisi>" di Shared Drive / Template dokumen / Kop & footer, yang juga bisa dirapikan langsung di Google Docs.
    - Divisi tanpa kop memakai kop seluruh perusahaan.
  - **Template berbentuk Google Docs dengan isian `{{...}}`:**
    - Ada 4 template BAST bawaan: serah terima dan pengembalian perangkat, serah terima dan pengembalian nomor HP.
    - Template lain bisa dibuat kosong atau disalin dari Google Doc yang sudah ada; dokumen aslinya tidak diubah.
    - Isian otomatis: nomor dokumen, tanggal, perusahaan, divisi, dan pembuat.
  - **Membuat dokumen:**
    - Template diekspor ke .docx, digabung dengan kop & footer divisi, lalu diimpor sebagai Google Doc di folder Shared Drive divisi (aturan folder; bila tidak ada aturan, "Dokumen <Divisi>").
    - Isiannya diisi lewat Google Docs API.
    - Nomor dokumen berbentuk AWALAN-TTTTBB-NNNN, contohnya BAST-202610-0001, dan tercatat di `generated_documents`.
    - Kata sandi, PIN, PUK, dan nomor kartu SIM tidak pernah disimpan.
  - **BAST perangkat:** dibuat dari halaman perangkat (Riwayat pemakaian), lalu ditautkan ke serah terima atau pengembaliannya.
  - **BAST nomor HP:** dibuat dari Infrastruktur IT → Nomor perusahaan.
  - **Kolaborasi IT–GA di BAST:**
    - Petugas memilih timnya, IT atau GA.
    - Kolom "Mengetahui" otomatis diisi PIC tim lainnya dari pengaturan PIC People & Culture.
    - IT (`device.handover.manage` / `it.infra.manage`) maupun GA (`ga.ops.manage`) bisa membuatnya.
  - **Pembagian kerja checklist:** perangkat, akses, dan lisensi tetap di IT. Nomor HP perusahaan (serah terima dan pengembalian) pindah ke GA, karena GA mengurus langganan operatornya.
  - **Hak kelola kop dan template:** Head divisi mengelola milik divisinya. Kop dan template seluruh perusahaan dikelola Head Management Office atau Super Admin. Siapa pun yang punya `document.create` bisa membuat dokumen.
  - **Belum diuji ke Google sungguhan:** semua tes memakai Google tiruan. Pemakaian pertama di aplikasi (Siapkan template BAST, simpan kop, buat satu BAST) sekaligus menjadi uji sungguhan.
- **Dashboard divisi dengan motion chart (owner, 1 Oktober):** menu "Dashboard divisi" (`/division-dashboard`, migrasi 116, izin `division_dashboard.view`).
  - **Siapa melihat:**
    - Supervisor dan Head setiap divisi melihat dashboard divisinya sendiri. Menu ini paling atas di grup divisinya.
    - Management Office dan Super Admin bisa memilih divisi mana pun atau "Seluruh perusahaan".
    - Member tetap memakai Dashboard pribadinya.
  - **Sumber data:** hanya provider manajemen, jadi modul baru otomatis ikut. Provider per divisi:
    - Sales dan Retail Commerce: Sales, Accurate, Approval, Project Tracker.
    - Marketing: Sales, Approval, Project Tracker.
    - Warehouse dan Procurement: modulnya sendiri, Accurate, Approval, Project Tracker.
    - Finance: Accurate, Approval, Project Tracker.
    - People & Culture: Onboarding/Offboarding, IT, dan GA untuk seluruh perusahaan (karena People & Culture melayani semua divisi), ditambah Approval dan Project Tracker.
    - Management Office: semua modul.
  - **Isi:**
    - Angka utama yang menghitung naik.
    - Motion chart: batang capaian setiap ukuran berlomba bulan demi bulan selama 12 bulan, berjalan sendiri saat terlihat, bisa diputar ulang, dan bulan bisa dipilih lewat slider atau tombol panah. Capaian dihitung terhadap target bulan itu bila ada; bila tidak, terhadap bulan terbaik ukuran tersebut.
    - Tren 12 bulan per ukuran: garis tergambar sendiri, garis target putus-putus, dan nilai tampil saat disentuh. Angka utamanya memakai bulan penuh terakhir dibanding bulan sebelumnya, dengan bulan berjalan ditulis terpisah.
    - Pekerjaan lewat tenggat per sumber.
  - **Penyesuaian tampilan:** ukuran yang selalu nol disembunyikan. Semua animasi berhenti bila perangkat meminta gerak minimal.
  - **Performa:** seri bulanan disimpan di cache 10 menit.
- **Gelombang 1 dilanjutkan (owner, 1 Oktober: "kembali ke fitur"), setelah program desain selesai.** Dibangun memakai komponen desain admin console.
- **Gelombang 1 sempat ditunda (owner, 30 September: "Pembangunan Gelombang 1 People & Culture ditunda dulu"):** pembangunan 1.1 dan 1.2 dihentikan sebelum ada perubahan (tidak ada file, migrasi, atau data yang dibuat). Rancangan yang sudah dikritik disimpan di [rancangan-people-culture-g1.md](rancangan-people-culture-g1.md) untuk dilanjutkan nanti. Perbaikan 1.0 (batas perusahaan dan unggahan hanya ke Shared Drive) tetap berlaku karena sudah selesai dan dijaga tes. Satu celah yang tercatat di rancangan dan belum diperbaiki: dasbor IT (`itDashboard.controller.js`, ringkasan dan laporan AI) masih menerima `entityId` dari query; saat ini hanya ada satu entitas sehingga belum berdampak.

## Gelombang dan status

Legenda: ⬜ belum · 🔵 dikerjakan · ✅ lolos gerbang · ⏸ menunggu pihak lain atau ditunda owner

### Gelombang 0: audit modul yang sudah ada
| # | Pekerjaan | Status |
|---|---|---|
| 0.1 | Dokumen program ini | ✅ |
| 0.2 | Audit onboarding/offboarding (sudah ada, 0 data), tiket IT, perangkat, dan langganan: apa yang berfungsi, apa yang kurang, dan kenapa belum dipakai. Temuan awal onboarding/offboarding (30 September): perusahaan diambil dari isi permintaan, bukan dari akun yang login; detail/ubah/ajukan/tugas tidak memeriksa perusahaan; "apply-approval" mengubah status langsung di luar mesin approval dan tanpa pemisahan tugas; permintaan approval dibuat tanpa penyetuju yang jelas; anggota punya `hrga.manage` sehingga bisa mengubah alur siapa pun; tidak ada tes. Tiket IT dan dasbor IT sudah memakai perusahaan dari akun yang login; perangkat, serah-terima, log perangkat, dan langganan (lisensi, invoice, pembayaran) mengambil perusahaan dari isi permintaan dan daftarnya tidak dibatasi perusahaan. Data nyata: 1 perusahaan (Prakasa Foods Nusantara), 34 pengguna aktif, dan 0 data di onboarding/offboarding, tiket IT, perangkat, serta langganan: semua modul People & Culture belum pernah dipakai, jadi pengerasannya aman dilakukan sebelum dipakai | 🔵 |

### Gelombang 1: fondasi
| # | Pekerjaan | Status |
|---|---|---|
| 1.0 | Batas perusahaan (entitas) di semua modul People & Culture yang sudah ada: perangkat, penugasan, serah-terima, log perawatan/perbaikan/garansi, langganan, lisensi, invoice, pembayaran, vendor, onboarding/offboarding, dan template checklist. Perusahaan selalu dari akun yang login; data perusahaan lain terbaca "tidak ditemukan"; pengguna/lisensi hanya bisa diberikan ke pengguna perusahaan yang sama; kolom "Entity ID" manual di formulir dihapus. Semua unggahan file perusahaan (serah-terima/pengembalian perangkat, lampiran onboarding, invoice langganan, lampiran tiket IT, lampiran Finance, dokumen bertanda tangan tanpa aturan folder) kini hanya masuk ke Shared Drive; tanpa Shared Drive terkonfigurasi, unggahan ditolak dengan pesan jelas, tidak pernah ke Drive akun layanan. Dijaga tes `itCompanyScope.test.js` (5 tes). Tes backend 808 dan frontend 370 lulus, build berhasil | ✅ |
| 1.1 | Direktori & struktur organisasi PFN: profil kerja per karyawan (jabatan, atasan langsung, kontak kerja, lokasi), termasuk orang tanpa akun aplikasi; akun uji/sistem dan staf entitas lain bisa dikecualikan atau ditandai; bagan organisasi per divisi. Approval berdasarkan atasan menyusul bersama onboarding/GA (hanya atasan yang punya akun, tidak menyetujui pengajuan sendiri). Rancangan lengkap: [rancangan-people-culture-g1.md](rancangan-people-culture-g1.md) | ✅ |
| 1.2 | Aset IT PFN (dipindah dari 2.3 atas keputusan IT Lead): perangkat pengguna (RAM, SSD, OS, lokasi, pemakai dari direktori atau label tim, status Aktif/Cadangan/Rusak/Tidak aktif yang bisa diubah IT), impor laporan perangkat dengan pratinjau dan cek kode perusahaan di server, ekspor, dasbor setara laporan, eskalasi perangkat rusak dan perangkat di tangan karyawan resign. Rancangan dikritik independen (40 temuan diterapkan: nomor aset boleh sama karena data asli memakai ulang 3 nomor, penugasan dibuat untuk perangkat Aktif, dasbor IT dibatasi entitas, collation, pencocokan orang, domain email kerja). Rancangan lengkap: [rancangan-people-culture-g1.md](rancangan-people-culture-g1.md) | ✅ |


**Hasil Gelombang 1 (1 Oktober 2026):** Direktori (`/people/directory`: daftar, panel profil, form, bagan organisasi, impor User List), Perangkat (status Aktif/Cadangan/Rusak/Tidak aktif dengan hitungan, lokasi, serah-terima ke akun/orang/label tim, pengembalian, ekspor format laporan, impor laporan dengan pratinjau dan cek kode perusahaan), Dashboard IT setara laporan, eskalasi perangkat rusak > 14 hari dan perangkat di tangan karyawan resign > 3 hari, KPI perangkat bermasalah. Alasan wajib untuk status Rusak/Tidak aktif/Hilang/Dibuang (IT Lead). Gerbang: tes backend 902 dan frontend 511 lulus, build berhasil, 45 skenario browser dan sweep rute baru tanpa error, uji impor 69 perangkat + 27 orang di dalam transaksi yang dibatalkan, 610 panggilan manajemen tanpa error, arsip Accurate tidak berubah. **Data laporan perangkat PFN belum diimpor**: tim IT/People & Culture mengimpor sendiri lewat menu Perangkat → Impor setelah owner setuju.

### Gelombang 2: alur kerja
| # | Pekerjaan | Status |
|---|---|---|
| 2.1 | Onboarding & offboarding siap pakai: tersambung ke direktori, tiket IT, perangkat, lisensi, dan checklist akses Google; pengingat dan eskalasi  Rancangan: [rancangan-people-culture-g2.md](rancangan-people-culture-g2.md) | 🔵 |
| 2.2 | Layanan GA: permintaan ATK, perbaikan fasilitas, peminjaman ruang/kendaraan, dengan approval, target waktu, dan eskalasi  Rancangan: [rancangan-people-culture-g2.md](rancangan-people-culture-g2.md) | 🔵 |
| 2.3 | Kebutuhan IT — sisa Master Infrastruktur & Aset IT (perangkat pengguna sudah di 1.2). Struktur mengikuti tab file referensi "IT - Master Infrastruktur & Aset IT … V1" (hanya tab dan kolomnya, bukan datanya): User List, Device Inventory (termasuk RAM, SSD, versi OS), Network Devices, ISP, Google Workspace (kondisi keamanan), Backup System, CCTV, Vendor, Access Control, ditambah register nomor telepon & HP perusahaan (struktur dari dokumen "Company Phone & Mobile Numbers": telepon IP dan nomor HP, pemakai, perangkat, provider, paket, mulai langganan, biaya). Kolom username/password dan password WiFi tidak dibangun. Dasbor setara laporan "IT - Device Management Report - V1", impor Excel dengan pratinjau untuk tim IT (hanya bagian entitas PFN; tidak ada data yang dimasukkan tanpa persetujuan owner), serta tiket IT dan langganan dirapikan sesuai audit  Rancangan: [rancangan-people-culture-g2.md](rancangan-people-culture-g2.md) | 🔵 |

### Gelombang 3: penyelesaian
| # | Pekerjaan | Status |
|---|---|---|
| 3.1 | Regresi penuh, tinjauan akhir, daftar uji coba pengguna (UAT) People & Culture | ⬜ |

### Di luar program (butuh keputusan owner)
| Pekerjaan | Pemilik |
|---|---|
| Otomatisasi pembuatan akun/akses Google Workspace (menulis ke Google) | Owner |
