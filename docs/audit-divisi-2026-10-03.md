# Audit dan penilaian kemudahan pengguna per divisi (3 Oktober 2026)

Tujuan: memastikan pengguna dengan peran apa pun (Member, Supervisor, Head, Administrator Sistem, Super Admin) dapat menjalankan modul dan fitur di divisinya dengan mudah, dan menemukan fitur atau modul yang sebenarnya tidak perlu.

## 1. Cara audit

| Langkah | Cakupan | Hasil |
|---|---|---|
| Inventaris | 101 rute halaman, 60 file route API (207 pemeriksaan izin), 192 kode izin, 221 tabel, 28 peran | Matriks peran × izin dari database uji (migrasi 001–143) |
| Audit kode | Empat penelusuran paralel: Sales/Retail/Marketing; Warehouse/Procurement/Finance; People & Culture (HRGA, GA, IT, Direktori); lintas divisi, Manajemen, Admin | Tombol vs izin API, alur buntu, duplikasi, fitur setengah jadi, kode mati; semua temuan dicek ulang di kode sebelum diperbaiki |
| Walkthrough layar | 26 akun uji (satu per peran standar + Administrator Sistem + Super Admin), setiap entri menu dibuka: 703 kunjungan halaman, Chromium | 0 galat JavaScript, 0 galat API di luar layanan Google (yang 503 karena sandbox tanpa kredensial Google), 0 halaman yang menolak peran yang memang berhak |
| Penilaian | Skor 1–5 per fitur per tingkat peran: mudah ditemukan, langkah sedikit, bahasa dipahami, ada bantuan saat bingung, konsisten | Bagian 3 |

Yang tidak bisa diaudit dari sini: data pemakaian produksi (seberapa sering fitur dibuka). Rekomendasi "hapus/gabungkan" didasarkan pada kode, alur, dan tumpang tindih, bukan statistik pemakaian.

## 2. Temuan utama

1. **Sepertiga menu setiap peran adalah tiruan aplikasi Google.** Setiap peran mendapat 9 entri (Gmail, Google Chat, Groups, Kalender, My Drive, Penyimpanan divisi, Docs, Sheets, Slides) dari 19–34 entri menunya. Member Warehouse: 9 dari 19. Ini pengulangan ~7.500 baris kode atas aplikasi yang sudah dipakai lewat Google sendiri; Docs/Sheets/Slides praktis hanya tautan ke Google (editor dalam iframe butuh cookie pihak ketiga), Groups hanya daftar baca-saja, Penyimpanan divisi sama persis dengan tab di My Drive.
2. **Tiga fitur tidak punya jalan masuk yang bekerja**: approval generik (`/approvals`), delegasi approval, pusat dokumen/template (`/documents`, `/templates`). Halamannya diblokir dan tidak diimpor, tetapi tautan ke sana masih ada di Prakasa AI, pencarian global, dan fallback notifikasi, sehingga pengguna dilempar ke beranda. Alur tanda tangan punya halaman, aturan, dan cek awal, tetapi tidak ada yang bisa membuat permintaan tanda tangan.
3. **Alur yang tidak bisa diselesaikan di aplikasi**: checklist gudang (tidak ada tombol selesai; eskalasi "checklist terlewat" tidak pernah bisa ditutup), perbaikan perangkat IT (tidak pernah bisa ditutup), tugas HRGA lisensi dan nomor telepon (dirutekan ke PIC yang izinnya tidak cukup), persetujuan perpanjangan langganan ("belum tersedia"), tiket IT (pengaju tidak punya aksi konfirmasi/tutup).
4. **Modul yang tampak rusak saat tarikan Accurate belum dinyalakan**: Procurement, Finance Utang, Warehouse Dokumen/Jadwal kirim menampilkan "menunggu persetujuan Head" padahal tarikannya mati (flag `ACCURATE_*` kosong secara bawaan).
5. **Tombol yang tampil tetapi ditolak server**: hapus file di Penyimpanan divisi (semua peran, API hanya Head), tab Drive divisi dan tombol buat/unggah di My Drive untuk Administrator Sistem, "Catat perawatan/perbaikan" perangkat (UI `device.manage`, API `device.log.manage`).
6. **Kebocoran API**: daftar tagihan terlambat dan SO tanpa surat jalan (`/sales/actions`) serta omzet per sales (`/sales/targets`) bisa dibaca dengan `sales.customer.view` saja, sehingga Marketing bisa membaca nominal yang migrasi 130 sengaja sembunyikan.
7. **Data yang sama di banyak tempat**: eskalasi di 4 tempat; Dashboard manajemen = Dashboard divisi untuk Head; produk terlaris dan omzet per channel di 4 halaman; serah terima perangkat lewat 3 jalur dengan 2 izin berbeda; notifikasi di 3 tempat; batch Accurate di 4 tab + 1 halaman; umur piutang di 3 tempat; dua penyimpanan target (per sales vs per divisi).
8. **Kode mati**: 24 kode izin tanpa pemeriksaan di mana pun (tetap tampil di halaman Peran dan Izin akses, dan diberikan ke 27 peran), 36 tabel tanpa referensi, 6 file halaman tanpa impor, ~25 endpoint tanpa pemanggil, sisa alur kendaraan GA yang sudah dipindah ke TrackCar.

## 3. Matriks penilaian

Skor 1–5 (5 = mudah). M = Member, S = Supervisor, H = Head. "—" = peran itu tidak punya fitur tersebut. Skor sesudah perbaikan di bagian 4 ditulis dalam kurung bila berubah.

### Sales
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Pipeline sales | 3 (4) | 3 (4) | 3 (4) | Daftar Dormant tampil dua kali di halaman yang sama (diperbaiki). Target per sales dan target divisi tersimpan terpisah. |
| Pelanggan | 4 | 4 | 4 | Jelas. Teks banner menyebut "Customers" padahal menu "Pelanggan" (diperbaiki). |
| Leads | 4 | 4 | 4 | Lead yang sudah ditautkan tidak bisa dilepas; tombol impor SimpliDOTS masih ada. |
| Data Sales | 3 | 3 | 3 | Mode Accurate menyembunyikan semua tombol tulis, benar; tetapi tab Umur piutang dan Tukar faktur baru muncul setelah batch disetujui, dan tautan `?tab=aging` diam-diam jatuh ke tab lain. Tab Data Accurate = halaman `/data-accurate`. |

### Retail Commerce
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Retail Commerce | 3 (4) | 3 (4) | 3 (4) | Keadaan kosong tanpa jalan ke batch (diperbaiki); baris tabel tanpa tautan ke SO/pelanggan; peran Retail juga mendapat menu Sales penuh. |

### Marketing
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Produk & channel | 4 | 4 | 4 | Jelas; data berulang dengan Pipeline dan Retail. |
| Kampanye | 4 | 5 | 5 | Alur status lengkap, keadaan kosong menjelaskan langkah. |

### Warehouse
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Hari ini | 3 | 3 | 3 | Dua angka tanpa tautan; "SO harus dikirim" menampilkan 0 saat tarikannya mati. Panel PO berulang dengan Procurement. |
| Barang masuk / keluar / Riwayat / Approval | 3 | 3 | 3 | Izin cocok. Riwayat = masuk + keluar tanpa filter jenis; tab Approval memuat yang tidak bisa diputus pemiliknya. |
| Stok, Dokumen Accurate, Cocokkan Accurate | 3 | 4 | 4 | Banner "belum tersedia" tanpa tautan batch saat batch pending. |
| Checklist | 1 (4) | 1 (4) | 1 (4) | Tidak bisa diselesaikan (diperbaiki: tombol "Tandai selesai"). |
| Insiden | 3 (4) | 3 (4) | 3 (4) | Dialog "Selesaikan" default "Diselidiki" (diperbaiki: default "Selesai"). |
| Data Accurate | — | 3 (4) | 3 (4) | Tab digating izin tarik, bukan izin baca (diperbaiki); Head Management Office kini melihatnya. |

### Procurement
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Hari ini, PO, Pemasok, Harga beli, Saran pesan ulang | 2 (3) | 2 (3) | 2 (3) | Saat `ACCURATE_PROCUREMENT` mati, semua halaman kosong dengan pesan yang salah (diperbaiki: pesan "belum dinyalakan"). Stat "PO tanpa tgl datang" tanpa daftar; baris PO di modal pemasok tidak bisa diklik. |
| Data Accurate | — | 3 (4) | 4 | Supervisor bisa tarik tetapi tidak bisa memutuskan (batch Procurement Head-only); teks header dan halaman batch saling berbeda. |

### Finance
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Piutang | 3 | 3 | 3 | Keadaan belum siap tanpa pemilik/tautan; berulang dengan Data Sales "Umur piutang" dan Retail. |
| Utang | 2 | 2 | 2 | Di balik `ACCURATE_FINANCE`; Finance tidak punya tab Data Accurate. |
| Pengajuan pembayaran | 4 | 3 (4) | 3 (4) | Tidak ada tampilan "menunggu keputusan saya" (diperbaiki: chip). Member punya `finance.manage` sehingga bisa mengubah/menghapus draf orang lain (kebijakan; lihat bagian 6). |

### People & Culture
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Onboarding / Offboarding | 4 | 3 | 3 | Tugas lisensi dan nomor telepon jatuh ke PIC yang izinnya tidak cukup; tugas "Buat akun Workspace" tanpa tautan; tanggal resign diedit di dua tempat. |
| Template checklist | — | — | 4 | Jelas. |
| Layanan GA | 4 | 4 | 4 | Keadaan kosong peminjaman tanpa langkah; sisa alur kendaraan setengah jadi. |
| Operasional GA | 3 | 3 | 3 | "Perlu tindak lanjut" hanya label; tagihan tanpa "Tandai lunas" dan tanpa tautan ke Pengajuan pembayaran; keadaan kosong menyuruh viewer "Catat" tanpa tombol. |
| Tiket IT | 3 | 3 | 3 | Pengaju tanpa aksi di "Menunggu respons"/"Selesai"; Member IT tidak bisa melihat tiket orang lain. |
| Dashboard IT | 3 (4) | 3 (4) | 3 (4) | Grid perpanjangan dan invoice tanpa tautan (diperbaiki). |
| Perangkat | 3 (4) | 3 (4) | 3 (4) | Perawatan/perbaikan digating izin yang salah (diperbaiki); perbaikan tidak pernah bisa ditutup; serah terima lewat tiga jalur. |
| Infrastruktur IT | 3 | 4 | 4 | Keadaan kosong backup/telepon/vendor hanya "Belum ada…". |
| Langganan software | 3 (4) | 3 (4) | 3 (4) | Detail tanpa tombol "Catat invoice" (diperbaiki); "Persetujuan perpanjangan belum tersedia"; kartu Riwayat perpanjangan selalu kosong. |
| Direktori | 4 | 4 | 4 | Jelas. |

### Lintas divisi dan Manajemen
| Fitur | M | S | H | Catatan |
|---|---|---|---|---|
| Beranda | 3 | 3 | 3 | Dengan briefing pagi aktif, kartu pekerjaan yang sama tampil dua kali (briefing + bagian di bawahnya). |
| Notifikasi | 4 | 4 | 4 | Tiga tempat untuk daftar yang sama (popover, kartu beranda, halaman). |
| Prakasa AI | 3 (4) | 3 (4) | 3 (4) | Tombol "Buka di Approval" ke halaman yang diblokir (diperbaiki). |
| Dashboard divisi | — | 4 | 4 | Satu template untuk semua divisi (pekerjaan sebelumnya). |
| Dashboard manajemen, Pusat eskalasi, Target, Peta program, Alur & margin | — | — | 3 | Dashboard manajemen mengulang Dashboard divisi untuk Head; eskalasi di 4 tempat. |
| Project Tracker, Kalender | 4 | 4 | 4 | `/tasks` (papan tugas lama) masih hidup tanpa menu, dirujuk briefing dan pencarian. |
| Gmail, Chat, Groups, Docs, Sheets, Slides, My Drive, Penyimpanan divisi | 2 | 2 | 2 | Lihat temuan 1. Hapus file tanpa izin (diperbaiki); tab Drive divisi untuk peran tanpa izin (diperbaiki). |
| Template dokumen | 3 | 3 | 3 | Kop divisi berulang dengan Cap surat; jenis dokumen teks bebas tidak terhubung dengan "Jenis dokumen". |
| Pencarian global | 2 (3) | 2 (3) | 2 (3) | Hasil dokumen dan approval menaut ke halaman yang diblokir (diperbaiki: dua jenis itu tidak dicari lagi). |
| Google Analytics, Log aktivitas | — | — | 3 | Log aktivitas hanya 50 terbaru tanpa paging/filter padahal API mendukungnya; Analytics menampilkan langkah penyiapan admin ke non-admin. |
| Akun saya, Panduan | 4 | 4 | 4 | Kartu tanda tangan menjanjikan alur yang tidak ada. |

### Administrator Sistem dan Super Admin
| Fitur | Admin | Super Admin | Catatan |
|---|---|---|---|
| Pengguna & akses (6 halaman) | 4 | 4 | Halaman Izin akses memuat 24 kode mati (dihapus di migrasi 144). |
| Aturan & dokumen (5 halaman) | 3 | 3 | Aturan dan cek awal tanda tangan mengatur alur yang tidak pernah menerima permintaan; Jenis dokumen tidak dipakai UI lain. |
| Sistem & integrasi (5 halaman) | 3 | 4 | Beberapa hanya Super Admin (sengaja, migrasi 123). |
| Menu | 25 entri | 62 entri | Super Admin melihat 62 entri; tidak ada pengelompokan yang bisa dilipat. |

## 4. Perbaikan yang sudah dilakukan (commit ini)

Semua diverifikasi dengan test unit dan, yang bertanda ✓, juga di layar sandbox.

| # | Perbaikan | Bukti |
|---|---|---|
| 1 | Checklist gudang bisa diselesaikan: aksi "Tandai selesai" memanggil `PATCH /warehouse/checklists/:id/complete`; server membatasi ke divisi Warehouse dan menolak yang sudah selesai | `WarehouseDashboard.jsx`, `warehouseChecklists.controller.js` ✓ |
| 2 | Dialog "Selesaikan insiden" dibuka dengan status "Selesai" | `WarehouseDashboard.jsx` ✓ |
| 3 | "Catat perawatan/perbaikan" perangkat digating `device.log.manage`, sama dengan API | `DeviceDetail.jsx` |
| 4 | Kebocoran nominal Sales ditutup: `/sales/actions` jenis overdue/no_do dan `/sales/targets` butuh `sales.order.view` | `sales.routes.js`, `salesData.controller.js` |
| 5 | Pipeline: "Perlu tindakan hari ini" dibuka pada Tagihan terlambat, bukan Dormant yang sudah menjadi grid tahap di bawahnya | `SalesTodo.jsx` ✓ |
| 6 | Procurement menjelaskan "tarikan belum dinyalakan" saat `ACCURATE_PROCUREMENT` mati | `procurementModel.js` + test ✓ |
| 7 | Tab "Data Accurate" Warehouse/Procurement tampil untuk pemegang `accurate.batch.view`; tombol "Tarik sekarang" tetap hanya untuk izin tarik | `WarehouseDashboard.jsx`, `ProcurementDashboard.jsx` ✓ (Head Management Office) |
| 8 | Dua rute halaman batch disatukan ke `/data-accurate/:id`; alamat lama dialihkan | `App.jsx`, `SalesAccurateBatch.jsx` |
| 9 | Retail Commerce: keadaan "Menunggu batch" memberi tombol "Buka Data Accurate" bagi yang berhak | `RetailCommerce.jsx` ✓ |
| 10 | Pengajuan pembayaran: chip "Menunggu keputusan saya" (`?awaiting=1`, memakai `awaitingMyDecision`) | `financeRequests.service.js`, `PaymentRequests.jsx` ✓ |
| 11 | Penyimpanan divisi: tombol hapus hanya dengan `document.delete`; My Drive: tab Drive divisi hanya dengan `document.view`, buat/unggah/hapus hanya dengan `mydrive.manage` | `DivisionStorage.jsx`, `MyDrive.jsx` ✓ (Administrator Sistem) |
| 12 | Tautan ke halaman yang diblokir: Prakasa AI "Buka di Approval" → Beranda; pencarian global tidak lagi mengembalikan hasil dokumen dan approval | `AIInbox.jsx`, `globalSearch.service.js` |
| 13 | Dashboard IT: baris perpanjangan dan invoice membuka langganannya; detail langganan punya tombol "Catat invoice" | `ItDashboard.jsx`, `itDashboard.controller.js`, `SubscriptionDetail.jsx` |
| 14 | Teks banner Sales: "Pelanggan → Pemetaan sales" | `SalesScopeBanner.jsx` |
| 15 | Kode mati dihapus: 6 file halaman tanpa impor (ApprovalInbox, ApprovalDelegations, DocumentCenter, TemplateCenter, ComingSoon, DependencyGraphModal) + CSS-nya; stub 410 dan alias HRGA; `MODULE_GROUPS`/`moduleGroupsFor` di navigasi; entri inventaris AI untuk file yang dihapus | `git rm`, `hrga.routes.js`, `hrga.controller.js`, `navigation.js` |
| 16 | Migrasi `144_remove_dead_permissions.sql`: 24 kode izin yang tidak diperiksa di mana pun dihapus dari katalog (grant ikut terhapus lewat cascade; akses siapa pun tidak berubah) | + test di `standardRoleNeeds.test.js` |

Tidak diubah: kebijakan peran standar, matriks approval, SoD, dan data. Tabel mati tidak di-drop (butuh keputusan; data lama tetap ada).

## 5. Rekomendasi pertahankan / gabungkan / sembunyikan / hapus

Yang di bawah ini belum dikerjakan karena mengubah bentuk aplikasi atau kebijakan; perlu persetujuan.

### Hapus (tidak dipakai, atau sudah digantikan)
| Kandidat | Alasan | Dampak |
|---|---|---|
| Groups (`/groups`) | Daftar baca-saja; peluncur aplikasi sudah menaut ke groups.google.com | Hilang 1 entri menu di semua peran |
| Docs, Sheets, Slides sebagai halaman | Editor iframe praktis hanya tautan ke Google; My Drive sudah membuat/membuka file | Hilang 3 entri menu di semua peran |
| Penyimpanan divisi (`/division-storage`) sebagai entri menu | Sama persis dengan tab "Drive divisi" di My Drive | Hilang 1 entri |
| Papan tugas lama (`/tasks`) | UI kedua atas data yang sama dengan Project Tracker; tanpa menu | Arahkan briefing, pencarian, notifikasi ke tracker |
| Sisa alur kendaraan GA (enum, endpoint checkout/return, UI serah kunci, cabang form) | Backend sudah menolak kendaraan (TrackCar) | Kode saja |
| Endpoint tanpa pemanggil (approval generik list/create/patch, approval-delegations, document-templates, documents list/upload, `GET /ai/summaries`, `POST /signatures`, ~12 endpoint IT, 5 sub-endpoint laporan Finance, `/procurement/orders?vendor`, `PATCH /approvals/:id`) | Tidak ada UI yang memanggil | Kode saja; cek dulu pemakaian oleh Prakasa AI |
| 36 tabel tanpa referensi (`form_*`, `workflow_*`, `kb_*`, `automation_*`, `decision_logs`, `meetings*`, `chat_*`, `dashboard_role_layouts`, dll.) | Sisa fitur yang sudah dicabut | Migrasi drop: **menghapus data lama**, keputusan pemilik |
| Izin yang diberikan tetapi tidak pernah diperiksa (`hrga.approve`, `hrga.complete`, `subscription.renewal.*`, `it_ticket.cancel_own`, `warehouse.inbound/outbound.manage`, `workspace.*.view`, `chat.view`, `meeting.*` yang tak dipakai, `sales.pipeline.view` yang hanya gating menu) | Membingungkan di halaman Peran | Migrasi lanjutan seperti 144 |
| Redirect `/coming-soon/*` dan aliasnya di AI | Tidak ada tautan masuk | Kode saja |

### Gabungkan
| Kandidat | Usulan |
|---|---|
| Dashboard manajemen → Dashboard divisi | Dashboard divisi mode "Seluruh perusahaan" sudah mencakup semuanya kecuali portofolio proyek; tambahkan bagian portofolio, lalu pensiunkan `/management`. Head berhenti mendapat dua dashboard untuk divisi yang sama. |
| Barang masuk + Barang keluar + Riwayat → satu tab "Pergerakan" | Filter Jenis dan Status; "Approval Supervisor" jadi preset. Viewer non-Warehouse sekarang melihat tiga daftar yang sama. |
| Empat tab "Data Accurate" (Sales, Warehouse, Procurement) + `/data-accurate` → satu halaman dengan entri menu | Gating `accurate.batch.view`; tab divisi menjadi tautan. Finance ikut mendapat jalan ke batch-nya. |
| Umur piutang: Data Sales tab vs Finance Piutang vs Retail | Satu pemilik (Finance), yang lain menaut. |
| Panel "today" Warehouse vs Procurement (PO datang hari ini / 7 hari) | Satu pemilik per daftar. |
| Serah terima perangkat (HRGA `device.assign`, Perangkat `device.manage`, endpoint `/it/assignments` tak terpakai) | Satu jalur dan satu izin. Juga satu service lisensi dan satu pengelola nomor telepon di balik HRGA dan IT. |
| Dua penyimpanan target Sales (per sales vs per divisi) | Satu sumber, atau tautan silang yang jelas. |
| Jenis dokumen: tabel `document_types` vs teks bebas di template dan aturan folder | Template dan aturan folder memilih dari `document_types`, atau "Jenis dokumen" dihapus. |
| Kop divisi (Template dokumen) vs Cap surat | Satu aset. |
| Briefing pagi vs bagian kartu beranda | Hilangkan bagian "Beranda" di briefing, atau sembunyikan bagian kartu saat briefing aktif. |

### Sembunyikan sampai alurnya ada
| Kandidat | Alasan |
|---|---|
| Halaman tanda tangan, "Aturan tanda tangan", "Cek awal tanda tangan", kartu tanda tangan di Akun saya | Tidak ada yang bisa membuat permintaan tanda tangan |
| Kartu "Riwayat perpanjangan" dan banner "Persetujuan perpanjangan belum tersedia" di Langganan | Tabelnya tidak pernah diisi |
| Procurement, Finance Utang, Warehouse Dokumen/Jadwal kirim saat flag `ACCURATE_*` mati | Sekarang sudah diberi pesan; menyembunyikan menu lebih bersih |
| Langkah penyiapan Google Analytics untuk non-admin | Mereka tidak bisa menjalankannya |

### Perlu diputuskan pemilik (menyentuh kebijakan peran)
| Kandidat | Usulan |
|---|---|
| Tugas HRGA lisensi (butuh Head) dan nomor telepon (butuh `it.infra.manage`) jatuh ke PIC yang izinnya tidak cukup | Pilih: PIC lisensi default Head P&C; tugas nomor telepon masuk grup IT; atau beri `it.infra.manage` ke PIC GA |
| Finance Member punya `finance.manage` (bisa mengubah/menghapus draf siapa pun) | Pindahkan ke Supervisor |
| Member IT (People & Culture Member) tidak bisa melihat tiket orang lain (`it_ticket.manage` hanya Supervisor) | Pisahkan izin "tangani tiket" dari "atur pengaturan tiket" |
| Pengaju tiket tanpa konfirmasi/tutup/buka kembali | Tambahkan aksi pengaju dan auto-close |
| Impor SimpliDOTS di Leads | Pensiunkan bila sudah tidak dipakai |
| Perbaikan perangkat tidak pernah bisa ditutup | Tambahkan ubah status perbaikan (endpoint sudah ada) |

### Pertahankan
Pipeline, Pelanggan, Leads, Data Sales, Kampanye, Produk & channel, Retail Commerce, Warehouse (pergerakan, stok, rekonsiliasi, insiden, checklist), Procurement (bila tarikannya dinyalakan), Piutang/Utang/Pengajuan pembayaran, Onboarding/Offboarding, Layanan GA, Operasional GA, Tiket IT, Dashboard IT, Perangkat, Infrastruktur, Langganan, Direktori, Dashboard divisi, Pusat eskalasi, Target, Peta program, Alur & margin, Project Tracker, Kalender, My Drive, Template dokumen, Prakasa AI, Notifikasi, Panduan, Akun saya, dan semua halaman admin kecuali yang disebut di atas.

### Usulan bentuk menu bila rekomendasi diterima
Member divisi turun dari 19–26 entri menjadi sekitar 13–18: grup "Komunikasi" menjadi Gmail, Chat, Kalender; grup "Dokumen" menjadi My Drive dan Template dokumen; Groups, Docs, Sheets, Slides, Penyimpanan divisi hilang. Head turun dari 25–34 menjadi sekitar 19–27 setelah Dashboard manajemen digabung.

## 6. Pengujian

- Frontend: 828 test lulus, build berhasil, katalog i18n lengkap (ID/EN).
- Backend tanpa DB: 1425 lulus, 1 gagal dan 27 dibatalkan sama dengan sebelum perubahan (`morningBriefing` ECONNREFUSED, `aiClientTools`).
- Migrasi 144 dijalankan di database sandbox: 192 → 168 kode izin; semua halaman tetap berjalan.
- Di layar (sandbox, data sintetis): checklist diselesaikan dan toast "Checklist ditandai selesai"; dialog insiden terbuka pada "Selesai"; Head Management Office melihat tab Data Accurate di Warehouse dan Procurement tanpa tombol tarik; Procurement menampilkan pesan "belum dinyalakan"; chip "Menunggu keputusan saya" mengubah URL ke `?awaiting=1`; Retail menampilkan "Buka Data Accurate"; Pipeline membuka Todo pada "Tagihan terlambat" dan tahap "Dormant"; Administrator Sistem tidak lagi melihat tab Drive divisi.
- Walkthrough 26 peran × semua entri menu: 0 galat JavaScript, 0 galat API di luar Google.

## 7. Lampiran

- Laporan audit kode per kelompok divisi, inventaris izin dan tabel: hasil pemeriksaan tersimpan dalam ringkasan di atas; rincian baris kode dirujuk di tabel.
- Kode izin yang dihapus migrasi 144: `automation.manage`, `automation.view`, `brief.view`, `dashboard_layout.manage`, `dashboard_widget.manage`, `data_classification.manage`, `data_classification.view`, `decision_log.manage`, `form.manage`, `form.submit`, `form.view`, `form_submission.manage`, `form_submission.transition`, `form_submission.view`, `kb.manage`, `kb.query`, `kb.view`, `timeline.view`, `workflow_definition.manage`, `workflow_definition.view`, `workflow_instance.transition`, `workflow_instance.view`, `workspace.customer.view`, `workspace.operations.view`.
- Tabel tanpa referensi di `backend/src`: `ai_actions`, `ai_briefs`, `automation_logs`, `automation_rules`, `chat_messages`, `chat_room_members`, `chat_rooms`, `context_records`, `cross_division_links`, `dashboard_role_layouts`, `dashboard_widgets`, `data_classifications`, `decision_logs`, `device_software_relations`, `drive_folders`, `external_references`, `form_fields`, `form_submission_attachments`, `form_submission_values`, `form_submissions`, `kb_documents`, `kb_query_logs`, `meeting_action_items`, `meeting_links`, `meeting_participants`, `meetings`, `mg_so_links_accurate`, `related_records`, `signature_placeholders`, `wh_recon_unit_ratios`, `workflow_definitions`, `workflow_instance_history`, `workflow_instances`, `workflow_statuses`, `workflow_transitions`.
