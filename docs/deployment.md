# Deployment — GoDaddy Shared cPanel

## Prasyarat
- Akun GoDaddy Web Hosting Plus (Launch)
- Akses cPanel
- Domain utama: `prakasa-work-os.com` → frontend
- Subdomain: `api.prakasa-work-os.com` → backend

## 1. Database
1. cPanel → MySQL Databases → buat database + user
2. Catat: `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST` (biasanya `localhost`)
3. Import migration `001` sampai `016` secara berurutan, atau jalankan `npm run migrate` dari backend.

## 2. Backend
1. Upload folder `backend/` ke `~/prakasa-work-os-backend` (di luar `public_html`)
2. cPanel → Setup Node.js App → Create Application:
   - Node.js version: 20/22 LTS
   - Application root: `prakasa-work-os-backend`
   - Application URL: `api.prakasa-work-os.com`
   - Application startup file: `src/app.js`
3. Set Environment Variables dari `.env.example`
4. Run NPM Install
5. Jalankan migration
6. Bootstrap Super Admin pertama:
   - set sementara `BOOTSTRAP_ADMIN_NAME`
   - set sementara `BOOTSTRAP_ADMIN_EMAIL`
   - set sementara `BOOTSTRAP_ADMIN_PASSWORD`
   - set `BOOTSTRAP_ADMIN_ENTITY_ID=1`
   - jalankan `npm run bootstrap:admin`
   - setelah sukses, hapus `BOOTSTRAP_ADMIN_PASSWORD` dari environment
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
