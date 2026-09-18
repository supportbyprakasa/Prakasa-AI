# Deployment — GoDaddy Shared cPanel

## Prasyarat
- Akun GoDaddy Web Hosting Plus (Launch)
- Akses cPanel
- Domain utama: `prakasa-work-os.com` → frontend
- Subdomain: `api.prakasa-work-os.com` → backend

## 1. Database
1. cPanel → MySQL Databases → buat database + user
2. Catat: `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST` (biasanya `localhost`)
3. Jalankan migrasi: lewat SSH/Terminal cPanel atau phpMyAdmin import `backend/migrations/001_phase1_init.sql`

## 2. Backend
1. Upload folder `backend/` ke `~/prakasa-work-os-backend` (di luar `public_html`)
2. cPanel → Setup Node.js App → Create Application:
   - Node.js version: 18+
   - Application root: `prakasa-work-os-backend`
   - Application URL: `api.prakasa-work-os.com`
   - Application startup file: `src/app.js`
3. Set Environment Variables dari `.env.example`
4. Run NPM Install
5. Restart (Passenger TIDAK auto-reload — wajib restart manual tiap deploy)

## 3. Frontend
1. Lokal: `cd frontend && npm install && npm run build`
2. Upload isi `frontend/dist/` ke `public_html/` (document root domain utama)
3. Pastikan `.env` produksi punya `VITE_API_URL=https://api.prakasa-work-os.com/api/v1`

## 4. Cron (Fase lanjutan)
Semua scheduler pakai cPanel Cron Job, BUKAN queue.

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
cPanel → Cron Jobs → Add New Cron Job:
  0 7 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/itReminders.js >> /home/USER/logs/itReminders.log 2>&1

## 8. Google Calendar & Meet (Fase 6)
1. Google Cloud Console → APIs & Services → Enable: Google Calendar API
2. Service Account (yang sudah ada dari Fase 2) → tambahkan scope:
   - https://www.googleapis.com/auth/calendar
   - https://www.googleapis.com/auth/calendar.events
3. Admin Console Google Workspace → Security → API Controls → Domain-wide Delegation:
   - Client ID service account
   - Scopes sama seperti di atas
4. Env tambahan:
   GOOGLE_CALENDAR_DELEGATED_USER=admin@prakasagroup.com
5. Catatan: kalau delegation tidak tersedia, event akan muncul di kalender service account —
   tetap berfungsi untuk development, tapi tidak ideal untuk produksi.

## 9. Catatan AI Security Principles — Meeting
- Transcript meeting hanya bisa diakses user dengan permission `meeting.ai_summary`
- Action item WAJIB dikonfirmasi user sebelum jadi task
- Hasil AI tersimpan di ai_summaries + activity_logs (dengan subject meeting)

## 10. Finance & HRGA (Fase 7) — Batasan Keras
Sesuai SOW bagian 7 & 18, TIDAK ADA tabel/kolom yang menduplikasi:
- Jurnal.id: transaksi akuntansi, jurnal umum, saldo, laporan keuangan, pajak
- KantorKu HRIS: payroll, absensi, cuti, lembur, performance review, rekrutmen

Yang disimpan di platform:
- Finance: workflow request + status + dokumen pendukung + link approval + referensi Jurnal.id
- HRGA: workflow onboarding/offboarding + checklist + link ke task/device/license + referensi KantorKu

## 11. AI Document Check (Fase 7)
- Modul `document_check` di ai_module_contexts
- Kalau provider AI down, sistem tetap return rule-based result (missing documents)
- Hasil AI disimpan di ai_summaries dengan subject_type='finance_workflow'

## 12. Fase 8 — Cron Jobs
Tambahkan di cPanel Cron Jobs:

# Automation Runner (tiap 15 menit)
*/15 * * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/automationRunner.js >> /home/USER/logs/automationRunner.log 2>&1

# Overdue Task Scan (harian 08:00)
0 8 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/overdueTaskScan.js >> /home/USER/logs/overdueTaskScan.log 2>&1

# Daily Brief (pagi 06:00)
0 6 * * * /usr/local/bin/node /home/USER/prakasa-work-os-backend/src/jobs/briefGenerator.js >> /home/USER/logs/briefGenerator.log 2>&1

## 13. Catatan Knowledge Base
- Menggunakan keyword match, BUKAN embedding/vector search (keterbatasan shared hosting).
- Kalau upgrade ke VPS: ganti `knowledgeBase.service.js` ke embedding + pgvector/Qdrant.
- AI WAJIB menjawab hanya dari konteks. Kalau tidak ada konteks, kembalikan pesan penolakan baku.

## 14. Automation Builder
- Rule dijalankan lewat cron `automationRunner.js`, BUKAN queue.
- Semua aksi idempoten dan tereksekusi ulang aman.
- Setiap run dicatat di `automation_logs`.
