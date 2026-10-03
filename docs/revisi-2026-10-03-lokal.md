# Menjalankan revisi 3 Oktober 2026 di lokal

Panduan untuk mencoba revisi F01–F27 di mesin lokal (folder `prakasa-work-os`). Hasil dan keputusannya ada di `docs/revisi-2026-10-03-hasil.md`.

Semua langkah di bawah memakai **database lokal**, bukan database produksi. Jangan mengisi `backend/.env` lokal dengan kredensial produksi.

## Cara cepat: satu perintah

Butuh Node.js dan MySQL 8 atau 9 (MySQL 9 dari Homebrew juga bisa; nyalakan servernya dengan `mysql.server start`). Tanpa Homebrew: installer resmi Node.js (.pkg dari nodejs.org) dan MySQL (DMG dari dev.mysql.com). Setelah branch diambil (langkah 1):

```bash
bash scripts/run-local.sh
```

Skrip ini membuat database dan user MySQL lokal, `backend/.env` dan `frontend/.env` untuk lokal (file yang sudah ada tidak ditimpa), memasang dependensi, menjalankan migrasi, membuat Super Admin lokal, lalu menyalakan backend dan frontend. Buka `http://localhost:5173/login` dan masuk dengan `superadmin@prakasagroup.com` / `Uji-Lokal-2026!x`. Hentikan dengan Ctrl+C; jalankan ulang perintah yang sama untuk menyalakan lagi.

Skrip berhenti bila `backend/.env` berisi `NODE_ENV=production` atau menunjuk ke database di luar komputer ini. Bila root MySQL memakai kata sandi: `MYSQL_ADMIN="mysql -uroot -p" bash scripts/run-local.sh`.

Langkah 2–3 di bawah adalah cara manual yang sama.

## 1. Ambil branch revisi

```bash
cd ~/Downloads/prakasa-work-os
git status                      # pastikan tidak ada perubahan yang belum disimpan
git fetch origin claude/epic-feynman-xlwoxf
git switch -c revisi-2026-10-03 origin/claude/epic-feynman-xlwoxf
```

Bila ada perubahan lokal yang belum di-commit, simpan dulu (`git stash`) atau pakai folder terpisah: `git worktree add ../prakasa-revisi origin/claude/epic-feynman-xlwoxf`.

## 2. Siapkan backend dan database lokal

Butuh MySQL 8 atau 9 lokal (migrasi memakai collation `utf8mb4_0900_ai_ci`; MariaDB tidak bisa). Pengujian revisi dijalankan di MySQL 8.0.

```bash
cd backend
npm ci
cp .env.example .env            # bila belum ada; isi DB_* ke database lokal
npm run migrate                 # wajib: termasuk migrasi baru 143_subscription_payment_request_key.sql

# Super Admin lokal (hanya database lokal; ditolak bila NODE_ENV=production)
BOOTSTRAP_ALLOW=yes \
BOOTSTRAP_ADMIN_EMAIL=superadmin@prakasagroup.com \
BOOTSTRAP_ADMIN_PASSWORD='Uji-Lokal-2026!x' \
BOOTSTRAP_ADMIN_NAME='Super Admin Lokal' \
npm run bootstrap:admin

npm run dev
```

Masuk dengan `superadmin@prakasagroup.com` / `Uji-Lokal-2026!x`. Kata sandi ini hanya untuk database lokal; jangan dipakai di produksi. Bila akun sudah ada, perintah di atas tidak mengubah kata sandinya.

Sebelum revisi ini, Super Admin hasil bootstrap pada database baru berakhir di layar "Akses belum disiapkan" (perannya tidak diberi kunci `system.super_admin`). Sudah diperbaiki; menjalankan ulang perintah di atas juga memperbaiki akun lama.

Untuk email selama mencoba: biarkan kredensial Google kosong di `.env` lokal, dan isi `EMAIL_TEST_REDIRECT=support@prakasagroup.com` dengan `EMAIL_TEST_ALLOWLIST` kosong. Tanpa kredensial Google tidak ada email yang terkirim.

## 3. Jalankan frontend

```bash
cd ../frontend
npm ci
cp .env.example .env            # VITE_API_URL=http://localhost:3000/api/v1 (sesuaikan port backend)
npm run dev
```

Buka alamat yang dicetak Vite (biasanya `http://localhost:5173`) dan masuk dengan Super Admin lokal.

## 4. Jalankan test

```bash
# Test revisi (sebagian memakai database lokal, termasuk konkurensi MySQL nyata)
cd backend
node --test test/subscriptionConcurrency.test.js test/subscriptionBilling.test.js \
  test/subscriptionLicenses.test.js test/itTicket.test.js test/itTracker.test.js test/tracker.test.js \
  test/itCompanyScope.test.js test/salesOrderBilling.test.js test/salesActions.test.js \
  test/marketing.test.js test/aiAgentSales.test.js test/hrgaWorkflow.test.js
#   harapan: semua lulus. subscriptionConcurrency membuat database sementara pwos_subs_cc_<pid>
#   lalu menghapusnya; user DB lokal butuh hak CREATE/DROP database (tanpa itu test ini dilewati).

# Frontend
cd ../frontend
node --test test/*.test.js      # harapan: 823 lulus
npm run build
```

Seluruh suite backend (`node --test test/*.test.js`) juga bisa dijalankan. Beberapa test lama bergantung pada data di database lokal, dan sebagian sudah gagal sebelum revisi (lihat bagian 5 dokumen hasil). Untuk membandingkan, jalankan suite yang sama di commit sebelum revisi (`git switch --detach 2947c9d`). `test/claudeTeamStream.test.js` bisa macet bila ada database; lewati file itu.

Test database menolak berjalan bila `NODE_ENV=production`.

## 5. Mencoba di layar

Buat akun uji di **Pengguna & akses → Pengguna** dengan peran People & Culture Member, Supervisor, dan Head. Buat juga satu akun Sales Member dan satu akun dari perusahaan (entitas) lain bila ada. Masuk bergantian di jendela private.

| ID | Coba | Yang seharusnya terlihat |
|---|---|---|
| F02 | Buka **IT → Langganan** sebagai PC Member, Supervisor, Head | Member: tanpa tombol tambah/invoice. Supervisor: "Tambah langganan" dan "Ubah langganan" saja. Head: semua. Buka `/it/subscriptions?baru=1` sebagai Member: form tidak terbuka |
| F03 | Head: buka satu langganan → "Ubah langganan" → tanggal perpanjangan > 30 hari lagi | Langganan yang sama terbarui, status kembali Aktif; tidak ada baris baru |
| F21 | Daftar langganan | Bila > 200 baris: banner "Menampilkan 200 dari N" |
| F26 | "Catat invoice" tanpa file | Status "Menunggu file PDF"; tombol "Tandai terverifikasi" tidak ada sampai PDF diunggah |
| F26 | Total ≠ subtotal + pajak | Ditolak dengan pesan |
| F25 | Invoice 1000 → "Catat pembayaran" 100 | "Dibayar sebagian", sisa 900. Lalu 900 → "Lunas (tercatat)". Coba 0 atau 1100 → ditolak |
| F05 | "Catat penetapan lisensi" | Cari nama/email; hanya akun aktif perusahaan yang sama |
| F06 | "Catat pencabutan lisensi" | Harus centang "Akses sudah dicabut di portal vendor" |
| F27 | Lisensi berstatus Idle | Hanya ada "Catat pencabutan"; tidak bisa langsung ditetapkan ke orang lain |
| F15 | Form invoice/pembayaran | Label "Nomor bukti di Accurate" |
| F24 | Manager IT entitas A membuka `/it/tickets/<id tiket entitas B>` | "Tiket tidak ditemukan" |
| F23 | Anggota Space IT tanpa izin kelola tiket menggeser issue `[Tiket IT #…]` ke Done | Ditolak; tiket tidak berubah. Pengelola IT: berhasil dan muncul pesan "Tiket IT #… ikut diperbarui" |
| F01 | **Sales → Data Sales**, SO tanpa faktur | "Belum difakturkan", bukan "Lunas" (juga di CSV) |
| F10 | **Pipeline** sebagai Sales Member | Keterangan "data Anda saja", bukan "seluruh perusahaan" |
| F09 | **Target** | Jumlah dokumen bertuliskan "faktur" (mode Accurate) |
| F07 | **Warehouse** daftar pergerakan | "2 baris · 2 SKU · 2 Box + 3 PCS" |
| F08 | **Marketing** kampanye dan insight | Jumlah per satuan; "Jumlah gabungan tidak dapat dihitung" bila satuan berbeda |
| F11, F20 | **Retail Commerce** produk terlaris; Marketing produk | Label "DPP sebelum retur"; diskon "dialokasikan proporsional" |
| F04 | Menu ekspor di tabel berhalaman | Keterangan "Hanya halaman ini: N baris dari M" |
| F16 | **Pusat eskalasi**, filter kosong | "Tidak ada eskalasi pada filter ini"; kolom "Kondisi sumber" |
| F17 | **Akun saya** | Kartu "Tanda tangan" berisi alat sesuai izin |
| F19 | Halaman masuk | Kontak akun: Administrator Sistem atau Super Admin; kata sandi: Super Admin |
| F22 | Matikan backend lalu buka `/verify/<kode>` | "Belum dapat memverifikasi" + "Coba lagi", bukan "tidak ditemukan" |
| F12–F14, F18 | **Panduan** | Teks Finance, GA, Langganan, Sales sesuai dokumen hasil |

Data Accurate (F01, F08–F11) hanya tampil setelah ada batch Accurate yang disetujui di database lokal. Tanpa itu halaman menampilkan "Menunggu data Accurate".
