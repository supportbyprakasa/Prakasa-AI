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

**Jangan menjalankan `bootstrapAdmin.js` di production.** Untuk first deploy
di shared cPanel tanpa Terminal/SSH, gunakan temporary setup endpoint pada §0b.
Jangan mengubah `NODE_ENV` ke development hanya untuk melewati guard CLI.

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

## 0b. First Production Deploy — Temporary Setup Endpoint

Shared cPanel tanpa Terminal/SSH dapat menjalankan first migration + first
Super Admin melalui endpoint sementara. Endpoint ini hanya mount bila:

```env
SETUP_ENABLED=yes
SETUP_TOKEN=<64 hex characters; generate with: openssl rand -hex 32>
```

**Jangan set `PORT` di cPanel Environment Variables.** Passenger inject port
runtime sendiri.

### Alur fresh production database

1. Buat database kosong di cPanel dan gunakan **nama DB/user final yang
   ditampilkan cPanel** (biasanya memiliki prefix akun).
2. Upload backend, create Node.js App, set environment variables termasuk
   `SETUP_ENABLED=yes` + `SETUP_TOKEN`, lalu Run NPM Install dan Restart.
3. Dari komputer operator, cek status:

```bash
curl -sS \
  -H "X-Setup-Token: <token>" \
  https://api.prakasa-work-os.com/api/v1/setup/status
```

Expected untuk DB fresh: ledger belum ada, domain tables = 0, dan semua migration
terlihat pending. Request status **read-only** dan tidak membuat ledger/table.

4. Jalankan migration:

```bash
curl -sS -X POST \
  -H "X-Setup-Token: <token>" \
  https://api.prakasa-work-os.com/api/v1/setup/migrate
```

Endpoint memakai migration connection khusus dengan `multipleStatements:true`.
Jika DB sudah memiliki domain schema tetapi ledger kosong, endpoint **abort 409**.
Baseline/recovery existing DB tetap CLI-only.

5. Bootstrap Super Admin setelah ledger 100% healthy:

```bash
curl -sS -X POST \
  -H "X-Setup-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@prakasagroup.com","name":"Super Admin","password":"<strong unique password>"}' \
  https://api.prakasa-work-os.com/api/v1/setup/bootstrap-admin
```

Bootstrap tidak mereset password user existing, tidak menghidupkan user
soft-deleted, dan tidak memindahkan user lintas entity.

6. Login manual sebagai Super Admin dan smoke-test.
7. **Hapus `SETUP_ENABLED` dan `SETUP_TOKEN` dari cPanel**, lalu Restart.
8. Verifikasi route hilang:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://api.prakasa-work-os.com/api/v1/setup/status
# Expected: 404
```

### Security rules

- Token harus tepat 64 hex characters dan hanya dikirim via `X-Setup-Token`.
- Setup route rate-limited 5 request / 15 menit / IP.
- Token tidak ditulis ke log, response, database, atau query string.
- `status` read-only; migration memakai `schema_migrations` sebagai source of truth.
- Bootstrap admin ditolak bila ledger belum 100% healthy.
- Setelah env setup dihapus + Passenger restart, route tidak terdaftar.

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
5. Fresh shared-cPanel deploy tanpa Terminal: jalankan setup flow §0b.
   Environment existing dengan ledger aktif dapat menggunakan normal deploy;
   baseline/recovery tetap membutuhkan CLI/operator access.
6. Provision first Super Admin melalui §0b. Jangan jalankan
   `bootstrapAdmin.js` di production.
7. Hapus env setup setelah selesai dan Restart Passenger.

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

Cron shell tidak mewarisi Environment Variables Passenger. Gunakan
`docs/templates/cron-wrapper.sh` dan buat
`~/.prakasa-work-os-cron.env` dari template
`docs/templates/prakasa-cron.env.example` (chmod 600).

```cron
0 7 * * * /home/USER/prakasa-work-os-backend/docs/templates/cron-wrapper.sh src/jobs/itReminders.js >> /home/USER/logs/itReminders.log 2>&1
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

Gunakan wrapper yang sama agar DB/API secrets tersedia di proses cron.

```cron
*/15 * * * * /home/USER/prakasa-work-os-backend/docs/templates/cron-wrapper.sh src/jobs/automationRunner.js >> /home/USER/logs/automationRunner.log 2>&1
0 8 * * * /home/USER/prakasa-work-os-backend/docs/templates/cron-wrapper.sh src/jobs/overdueTaskScan.js >> /home/USER/logs/overdueTaskScan.log 2>&1
0 6 * * * /home/USER/prakasa-work-os-backend/docs/templates/cron-wrapper.sh src/jobs/briefGenerator.js >> /home/USER/logs/briefGenerator.log 2>&1
```

## 13. Knowledge Base
- Menggunakan keyword match, bukan embedding/vector search pada shared hosting.
- AI menjawab hanya dari context yang tersedia.

## 14. Automation Builder
- Rule dijalankan lewat cron `automationRunner.js`, bukan queue.
- Semua run dicatat di `automation_logs`.
