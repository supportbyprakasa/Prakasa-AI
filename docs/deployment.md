# Deployment — GoDaddy Shared cPanel

## Prasyarat
- Akun GoDaddy Web Hosting Plus (Launch)
- Akses cPanel
- Domain utama: `prakasa-work-os.com` → frontend
- Subdomain: `api.prakasa-work-os.com` → backend

## 0a. Bootstrap Admin — Development Only

`backend/src/scripts/bootstrapAdmin.js` hanya untuk local/development dan akan
abort bila `NODE_ENV=production`. Script juga mewajibkan `BOOTSTRAP_ALLOW=yes`,
email/password eksplisit, dan password minimal 12 karakter yang tidak lemah.

Contoh development:

```bash
cd backend
NODE_ENV=development \
BOOTSTRAP_ALLOW=yes \
BOOTSTRAP_ADMIN_EMAIL=admin@dev.local \
BOOTSTRAP_ADMIN_PASSWORD='long-unique-dev-passphrase' \
node src/scripts/bootstrapAdmin.js
```

Jika user sudah ada, script tidak mereset password dan tidak memindahkan user
lintas entity. Hapus variabel `BOOTSTRAP_*` setelah selesai.

### Production

**Jangan menjalankan `bootstrapAdmin.js` di production.** Repository saat ini
tidak menyediakan production bootstrap endpoint. Akun Super Admin production
harus diprovision melalui proses operasional yang disetujui dan diaudit,
menggunakan mekanisme account-management yang berlaku untuk environment target.
Jangan mengubah `NODE_ENV` ke development hanya untuk melewati guard ini.

---

## 0. Migration Ledger (Batch 6.4)

Mulai Batch 6.4, migration dilacak di tabel kontrol `schema_migrations`.
Runner `backend/src/db/migrate.js` hanya menjalankan file yang belum tercatat
dengan checksum yang sama.

### Fresh database

Gunakan normal migrate. Runner membuat ledger otomatis lalu menjalankan semua
migration secara berurutan.

```bash
cd backend
npm run migrate
npm run check:ledger
# Expected: RESULT: HEALTHY
```

### Existing database dari sebelum Batch 6.4

**Jangan langsung menjalankan normal migrate bila ledger masih kosong.**
Runner akan mendeteksi schema existing dan abort agar historical migrations
tidak dijalankan ulang secara tidak sengaja.

Untuk kondisi repository saat ini, jika environment sudah memiliki migration
001–027 dan migration 028 belum diketahui/applied, gunakan alur aman berikut:

```bash
cd backend
npm run migrate -- --dry-run --baseline-through=027
npm run migrate -- --baseline-through=027
npm run migrate
npm run check:ledger
npm run check:batch5
```

Dengan alur ini, 001–027 hanya dicatat sebagai baseline. Migration 028 tetap
pending dan akan benar-benar dieksekusi oleh `npm run migrate`. Karena 028
idempotent, alur ini juga aman bila sebagian/all perubahan 028 ternyata sudah
pernah diterapkan manual sebelumnya.

Jika Anda sudah memverifikasi **semua** migration yang ada di folder migration
sudah diterapkan, `--baseline` dapat digunakan untuk mencatat semuanya:

```bash
npm run migrate -- --dry-run --baseline
npm run migrate -- --baseline
npm run check:ledger
```

### Common flags

```bash
npm run migrate -- --dry-run
npm run migrate -- --baseline-through=027
npm run migrate -- --force-file=028_search_notification_center.sql
npm run migrate -- --help
```

### Rules

- Jangan edit migration yang sudah tercatat sebagai applied. Checksum drift
  membuat runner abort.
- `--baseline` dan `--baseline-through` hanya untuk database existing dengan
  ledger kosong; runner menolak baseline pada fresh DB atau ledger aktif.
- Baseline **tidak mengeksekusi SQL**. Pastikan schema existing memang sesuai.
- MySQL DDL dapat auto-commit. Jika satu file gagal di tengah, ledger row tidak
  ditulis, tetapi sebagian DDL mungkin sudah terapkan. Inspect error lalu retry;
  migration existing dirancang idempotent/additive.
- Runner menggunakan koneksi migration khusus dengan
  `multipleStatements: true` untuk kompatibilitas dengan migration 001–028.

---

## 1. Database
1. cPanel → MySQL Databases → buat database + user
2. Catat: `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST` (biasanya `localhost`)
3. Gunakan migration runner dari backend sesuai §0. Jangan import/re-run migration lama secara manual kecuali untuk recovery yang terverifikasi.

## 2. Backend
1. Upload folder `backend/` ke `~/prakasa-work-os-backend` (di luar `public_html`)
2. cPanel → Setup Node.js App → Create Application:
   - Node.js version: 20/22 LTS
   - Application root: `prakasa-work-os-backend`
   - Application URL: `api.prakasa-work-os.com`
   - Application startup file: `src/app.js`
3. Set Environment Variables dari `.env.example`
4. Run NPM Install
5. Jalankan migration sesuai §0 dan pastikan `npm run check:ledger` HEALTHY.
6. Pastikan akun Super Admin production sudah diprovision melalui proses
   operasional yang disetujui. Jangan jalankan `bootstrapAdmin.js`; lihat §0a.
7. Restart Passenger setiap deploy.

## 3. Authentication
- Login utama: email + password.
- Password disimpan sebagai bcrypt hash.
- Super Admin mengelola create account, roles, enable/disable, dan reset password.
- Google Login bersifat optional/secondary.
- Google Login tidak boleh membuat user baru secara otomatis; user harus sudah ada.
- Untuk menampilkan Google Login, set frontend `VITE_ENABLE_GOOGLE_LOGIN=true` dan isi `VITE_GOOGLE_CLIENT_ID`.

## 4. Frontend
1. Lokal: `cd frontend && npm install && npm run build`
2. Default production env:
   ```env
   VITE_API_URL=https://api.prakasa-work-os.com/api/v1
   VITE_ENABLE_GOOGLE_LOGIN=false
   VITE_GOOGLE_CLIENT_ID=
   ```
3. Upload isi `frontend/dist/` ke `public_html/`.

## 5. Google Service Account (Fase 2)
1. Google Cloud Console → IAM → Service Accounts → Create
2. Buat key JSON → catat `client_email` & `private_key`
3. Isi `.env`: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
   (escape newline jadi `\n`)
4. Aktifkan Drive API, Docs API, Sheets API, Slides API di project
5. Shared Drive → Manage members → tambahkan service account sebagai Content Manager
6. Catat Shared Drive ID → `GOOGLE_SHARED_DRIVE_ID`

## 6. AI Provider
Setiap modul AI memilih provider lewat tabel `ai_module_contexts`.
Ubah lewat endpoint: `PATCH /api/v1/ai/modules/:module`

## 7. Cron Job — IT Reminders (Fase 5)
```
0 7 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/itReminders.js >> /home/USER/logs/itReminders.log 2>&1
```

## 8. Google Calendar & Meet (Fase 6)
1. Google Cloud Console → APIs & Services → Enable: Google Calendar API
2. Service Account → tambahkan scope:
   - https://www.googleapis.com/auth/calendar
   - https://www.googleapis.com/auth/calendar.events
3. Admin Console Google Workspace → Security → API Controls → Domain-wide Delegation.
4. Set `GOOGLE_CALENDAR_DELEGATED_USER`.

## 9. Catatan AI Security Principles — Meeting
- Transcript meeting hanya bisa diakses user dengan permission `meeting.ai_summary`
- Action item WAJIB dikonfirmasi user sebelum jadi task
- Hasil AI tersimpan di ai_summaries + activity_logs

## 10. Finance & HRGA — Batasan Keras
Tidak ada tabel/kolom yang menduplikasi:
- Jurnal.id: transaksi akuntansi, jurnal umum, saldo, laporan keuangan, pajak
- KantorKu HRIS: payroll, absensi, cuti, lembur, performance review, rekrutmen

## 11. AI Document Check
- Modul `document_check` di ai_module_contexts
- Jika AI down, sistem tetap return rule-based result
- Hasil AI disimpan di ai_summaries

## 12. Fase 8 — Cron Jobs
```
*/15 * * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/automationRunner.js >> /home/USER/logs/automationRunner.log 2>&1
0 8 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/overdueTaskScan.js >> /home/USER/logs/overdueTaskScan.log 2>&1
0 6 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/briefGenerator.js >> /home/USER/logs/briefGenerator.log 2>&1
```

## 13. Knowledge Base
- Menggunakan keyword match, bukan embedding/vector search pada shared hosting.
- AI menjawab hanya dari context yang tersedia.

## 14. Automation Builder
- Rule dijalankan lewat cron `automationRunner.js`, bukan queue.
- Semua run dicatat di `automation_logs`.
