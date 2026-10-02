# Peran Administrator Sistem

Keputusan owner, 1 Oktober 2026: sediakan super admin yang tidak terikat divisi apa pun dan tidak bisa melihat data divisi.

## Dua peran global

| Peran | Kunci | Divisi | Lihat data divisi | Kelola sistem |
|---|---|---|---|---|
| Super Admin | `system.super_admin` | tidak ada | ya, semua | ya, termasuk akun Super Admin dan semua kata sandi |
| **Administrator Sistem** | `system.admin` | tidak ada | **tidak** | ya, kecuali akun dan peran Super Admin, dan kecuali kata sandi |

## Isi Administrator Sistem

Migrasi 112 menyiapkannya untuk setiap entitas. Daftar izinnya ada di `SYSTEM_ADMIN_PERMISSIONS` (backend/src/config/standardOrganization.js), dan tes menjaga daftar itu sama dengan migrasinya.

- **Konfigurasi:**
  - pengguna dan sinkronisasi Workspace (tanpa kata sandi, lihat "Kata sandi" di bawah);
  - peran dan izin akses;
  - divisi dan entitas;
  - matriks approval dan aturan tanda tangan;
  - jenis dokumen dan aturan folder;
  - aturan notifikasi;
  - log integrasi.
- **Alat pribadi:**
  - notifikasi sendiri;
  - tiket IT milik sendiri, termasuk tombol Butuh bantuan IT;
  - Gmail, Chat, Kalender, Docs dan My Drive milik sendiri;
  - Google Groups.
- **Tidak termasuk:**
  - Sales, Warehouse, Procurement dan Finance;
  - Onboarding/Offboarding dan pemrosesan GA;
  - aset IT, infrastruktur dan langganan;
  - dashboard manajemen, eskalasi, target, peta program dan alur & margin;
  - Google Analytics;
  - log aktivitas (isinya memuat nilai data);
  - dokumen divisi dan batch Accurate;
  - sesi AI orang lain;
  - pencarian global;
  - koneksi Accurate, penyedia AI, model dan routing AI, serta katalog izin: khusus Super Admin sejak migrasi 123 (tinjauan keamanan, Oktober 2026), karena menentukan dari mana data perusahaan masuk dan ke mana prompt dikirim.

## Pagar agar tidak bisa menaikkan aksesnya sendiri

Pagar ini ada di `rolePolicy.assertCanChangeAccount` / `assertCanChangeRole`, dan berlaku untuk siapa pun yang bukan Super Admin:

1. **Akses akun sendiri terkunci.** Peran dan divisi akun sendiri hanya bisa diubah oleh Super Admin (`SELF_ACCESS_CHANGE`).
2. **Akun Super Admin terlindungi.** Akun Super Admin tidak bisa diubah, direset kata sandinya atau dihapus, dan peran Super Admin tidak bisa diberikan (`SUPER_ADMIN_ONLY`).
3. **Dua peran global terkunci.** Izin peran Super Admin dan Administrator Sistem hanya bisa diubah atau dihapus oleh Super Admin.
4. **Kata sandi khusus Super Admin.** Mereset kata sandi, mengisi kata sandi awal, dan mencabut tanda "wajib ganti" hanya bisa dilakukan Super Admin (`SUPER_ADMIN_ONLY`). Lihat "Kata sandi" di bawah.
5. **Sinkronisasi Workspace ikut aturan yang sama.** Peran yang diberikan lewat sinkronisasi kini divalidasi seperti saat membuat pengguna manual. Sebelumnya peran ini tidak diperiksa sama sekali.
6. **Hanya peran Anggota.** Administrator Sistem hanya bisa memberi peran divisi tingkat Anggota. Peran Head, Supervisor atau peran khusus, serta peran Administrator Sistem itu sendiri, hanya bisa diberikan oleh Super Admin. Akun Administrator Sistem lain juga hanya bisa diubah oleh Super Admin.
7. **Akun baru tanpa kata sandi.** Akun yang dibuat oleh Administrator Sistem (manual atau lewat sinkronisasi Workspace) tidak punya kata sandi dan masuk dengan akun Google kantor.

Semua perubahan tercatat di log aktivitas. Log itu dibaca Super Admin, bukan Administrator Sistem.

## Kata sandi

Keputusan owner, 2 Oktober 2026: tidak ada reset atau ganti kata sandi mandiri; kata sandi dikelola oleh Super Admin saja.

| Siapa | Yang bisa dilakukan |
|---|---|
| Karyawan | Tidak bisa mengganti atau mereset kata sandi sendiri. Halaman "Akun saya" hanya menjelaskan bahwa kata sandi dikelola Super Admin. Satu-satunya penggantian adalah mengganti kata sandi **sementara** saat masuk pertama setelah dibuatkan atau direset. |
| Administrator Sistem | Tidak bisa mereset kata sandi siapa pun dan tidak bisa mengisi kata sandi awal. Akun yang ia buat masuk dengan akun Google kantor. Tombol "Atur ulang kata sandi" dan kolom kata sandi tidak tampil. |
| Super Admin | Mereset kata sandi akun mana pun dan boleh mengisi kata sandi awal saat membuat akun. Kata sandi yang ia isi selalu sementara: pemilik akun wajib menggantinya saat masuk berikutnya, dan semua sesi lama akun itu berakhir. |

Di server:

- `POST /auth/change-password` hanya menerima penggantian kata sandi sementara (`users.must_change_password = 1`). Selain itu jawabannya 403 `PASSWORD_MANAGED_BY_ADMIN` ("Kata sandi dikelola oleh Super Admin"), sebelum kata sandi saat ini diperiksa.
- `POST /users/:id/reset-password` memerlukan Super Admin (403 "Hanya Super Admin yang bisa mereset kata sandi") dan selalu memasang `must_change_password = 1`.
- `POST /users` menerima `password` hanya dari Super Admin (403 "Hanya Super Admin yang bisa mengatur kata sandi"). Tanpa `password`, akun dibuat tanpa kata sandi (masuk dengan Google).
- `POST /workspace-sync/candidates/:id/apply` membuat kata sandi sementara hanya bila pelakunya Super Admin; selain itu akun dibuat tanpa kata sandi.

Catatan: akun tanpa kata sandi baru bisa masuk bila "Masuk dengan Google" sudah dinyalakan. Bila belum, Super Admin perlu mengatur kata sandi sementara untuk akun itu.

## Batas yang perlu diketahui

Administrator Sistem tetap bisa memberi peran Anggota kepada akun **lain**, karena itu memang tugasnya. Akun palsu dengan peran Anggota masih bisa membaca data tingkat Anggota divisi tersebut. Pencegahnya adalah log aktivitas yang dipantau Super Admin. Peran Head/Supervisor (data seluruh divisi) sudah khusus Super Admin (pagar 6).

Administrator Sistem juga memegang `role.manage`, sehingga masih bisa mengubah daftar izin peran divisi (misalnya menambah izin ke peran Anggota). Langkah berikutnya bila perlu lebih ketat: perubahan izin peran divisi memerlukan Super Admin.

## Menu

Administrator Sistem melihat Dashboard dan Notifikasi, lalu grup Pengguna & akses, Aturan & dokumen, serta Sistem & integrasi paling atas. Setelah itu Kerja harian, Komunikasi dan Dokumen pribadi (docs/ui-guideline.md §2.2).
