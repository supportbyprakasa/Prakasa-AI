# Go-live runbook — cPanel shared hosting

Untuk owner dan siapa pun yang menjalankan deploy. Ikuti berurutan; setiap
langkah punya cara memeriksa hasilnya. Semua secret dibuat dan ditempel
langsung di server: **jangan pernah kirim secret lewat chat atau email**.

Placeholder yang dipakai di dokumen ini:

| Placeholder | Arti | Contoh |
|---|---|---|
| `<domain>` | domain web (frontend) | `contoh.co.id` |
| `api.<domain>` | subdomain API (Node.js) | `api.contoh.co.id` |
| `USER` | nama akun cPanel | `prakasa` |
| `<db>` / `<dbuser>` | nama database / user MySQL **lengkap dengan prefix cPanel** | `prakasa_workos` / `prakasa_app` |

Arsitektur:

```
Browser ──HTTPS──► https://<domain>       Apache, public_html: frontend statis (React build) + .htaccess
        ──HTTPS──► https://api.<domain>   Passenger: Node.js API (backend/src/app.js)
                                            ├─ MySQL 8 (localhost)
                                            ├─ Google Workspace API (service account, DWD)
                                            └─ Accurate Online (OAuth, hanya baca)
cron (cPanel) ──► cron-wrapper.sh ──► backend/src/jobs/*.js
Mac owner ──► Claude Team runner (docs/claude-team-runner.md), dipanggil API lewat HTTPS
```

Daftar isi: 1 Prasyarat · 2 Database · 3 Backend · 4 Frontend · 5 Cron ·
6 Mematikan launchd di Mac · 7 Google · 8 Accurate · 9 Smoke test ·
10 Batasan keras · 11 Rollback & backup · 12 Referensi teknis

---

## 1. Prasyarat — tanyakan/cek ke host SEBELUM membeli atau migrasi

| Syarat | Cara cek | Kenapa |
|---|---|---|
| **MySQL ≥ 8.0.21, bukan MariaDB** | phpMyAdmin → SQL: `SELECT VERSION();` hasilnya harus `8.0.21` atau lebih tinggi **tanpa** kata `MariaDB` | View memakai `JSON_TABLE`, `JSON_VALUE … RETURNING` (8.0.21+) dan window function. MariaDB tidak menjalankannya. |
| Node.js 20 atau 22 di "Setup Node.js App" | cPanel → Software → Setup Node.js App → daftar versi | `backend/package.json` → `engines.node >=20` |
| Cron Jobs | cPanel → Advanced → Cron Jobs ada | Sinkron Accurate tiap 5 menit + job harian |
| Terminal (SSH di browser) | cPanel → Advanced → Terminal ada | `npm run migrate`, cek ledger, crontab |
| AutoSSL untuk `<domain>`, `www.<domain>`, `api.<domain>` | cPanel → Security → SSL/TLS Status: ketiganya hijau | Semua lalu lintas HTTPS; OAuth Google & Accurate menolak HTTP |
| Batas **EP** (entry processes), **PMEM/RAM**, **NPROC** | Tanyakan ke host; target paket: 2 vCPU / 4 GB | Passenger + cron (sinkron + job harian) berjalan bersamaan; minta EP ≥ 30, PMEM ≥ 2 GB. Tanyakan juga: **"Apakah koneksi SSE yang terbuka lama dihitung sebagai Entry Process?"** — bila ya dan EP < 150, `REALTIME_ENABLED=0` (§3.9) |
| Batas koneksi MySQL per user (`max_user_connections`) | Tanyakan ke host | Web memakai 5, cron 3 per job (`DB_POOL_LIMIT`). Rumus: **≥ 5 + 3 × jumlah job cron yang bisa berjalan bersamaan**; dengan jadwal §5 paling banyak 3–5 job sekaligus → minta **≥ 20** |
| Satu proses Node untuk aplikasi | Tanyakan: "Berapa instance Passenger maksimal per aplikasi? Bisa dikunci 1?" | Cache hasil, status login dan pembaruan langsung disimpan di memori **satu** proses (§3.9) |
| Koneksi HTTPS keluar | Tanyakan ke host (firewall keluar) | Ke `*.googleapis.com`, `account.accurate.id`, `*.accurate.id`, runner Claude |
| Timeout proxy/Passenger untuk respons panjang | Tanyakan: "Apakah respons streaming (SSE) > 60 detik diputus?" | Jawaban AI bisa mengalir sampai 4 menit; pembaruan langsung memakai SSE |

Bila MySQL ternyata MariaDB atau < 8.0.21: **berhenti**, minta host memindah
ke server MySQL 8, atau ganti paket. Jangan mencoba "menyesuaikan" migration.

---

## 2. Database

1. cPanel → **Manage My Databases** (MySQL Databases):
   - Buat database `<db>`.
   - Buat user `<dbuser>` dengan password acak panjang (buat di Password
     Generator cPanel, simpan di password manager).
   - **Add User To Database** → centang **ALL PRIVILEGES** (termasuk
     `CREATE VIEW`, `SHOW VIEW`, `ALTER`, `INDEX`, `REFERENCES`, `TRIGGER`).
2. Set charset dan collation (phpMyAdmin → pilih `<db>` → SQL):

   ```sql
   ALTER DATABASE `<db>` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   SELECT @@character_set_database, @@collation_database;  -- utf8mb4 / utf8mb4_0900_ai_ci
   ```

3. **Mulai dari database KOSONG.** Jangan impor dump database lokal:
   production memakai `SIGNATURE_ENCRYPTION_KEY` baru, sehingga token Accurate,
   secret gateway Claude, dan data terenkripsi lain dari lokal tidak bisa
   dibaca. Data contoh/uji lokal juga tidak boleh ikut.
4. Migration dijalankan dari Terminal setelah backend terpasang (§3.5), bukan
   lewat endpoint HTTP `/setup/migrate` (120+ file migration bisa melewati batas
   waktu request).

Zona waktu MySQL tidak perlu diubah: setiap koneksi aplikasi menjalankan
`SET time_zone = '+00:00'` (`backend/src/db/connectionConfig.js`).

---

## 3. Backend (API di `https://api.<domain>`)

### 3.1 Subdomain dan unggah kode

1. cPanel → **Domains** → buat `api.<domain>` (document root bawaan, misalnya
   `~/api.<domain>`). Kode backend **tidak** ditaruh di document root.
2. Di komputer deploy, buat paket backend tanpa `node_modules`, `.env`, dan
   isi `uploads/`:

   ```bash
   cd backend
   zip -r ../backend-release.zip . -x 'node_modules/*' '.env' 'uploads/*' 'test/*'
   ```

3. cPanel → File Manager → buat folder `~/prakasa-work-os-backend` (nama ini
   dipakai `cron-wrapper.sh`; jangan diganti) → Upload `backend-release.zip`
   → Extract di folder itu. Pastikan `~/prakasa-work-os-backend/uploads/`
   ada dan bisa ditulis (755).

### 3.2 Setup Node.js App

cPanel → **Setup Node.js App** → **Create Application**:

| Isian | Nilai |
|---|---|
| Node.js version | 22 (atau 20) |
| Application mode | **Production** |
| Application root | `prakasa-work-os-backend` |
| Application URL | `api.<domain>` (path kosong) |
| Application startup file | `src/app.js` |

Simpan. Di bagian atas halaman aplikasi ada perintah **"Enter to the virtual
environment"**, misalnya:

```bash
source /home/USER/nodevenv/prakasa-work-os-backend/22/bin/activate && cd /home/USER/prakasa-work-os-backend
```

Catat perintah itu: dipakai untuk setiap perintah `npm`/`node` di Terminal.

**Passenger tetap hangat (wajib, hasil uji beban 1 Okt 2026).** Start dingin
(proses baru + cache kosong) membuat halaman pertama 18–26 detik bila banyak
orang masuk bersamaan. Tambahkan di `.htaccess` folder dokumen `api.<domain>`
(di **bawah** blok yang ditulis cPanel, jangan ubah blok itu):

```apache
# Prakasa Workspace: satu proses selalu hidup, start boleh sampai 90 detik
PassengerMinInstances 1
PassengerStartTimeout 90
```

`PassengerPreStart https://api.<domain>/api/health` (menyalakan proses
segera setelah server web/Passenger restart, tanpa menunggu pengunjung
pertama) hanya berlaku di konfigurasi virtual host — **minta host
memasangnya**, sekaligus `PassengerMaxInstancesPerApp 1` (satu proses, §3.9).
Bila host menolak PreStart, pasang cron pengganti (tidak dihitung EP setelah
selesai):

```cron
*/5 * * * * curl -fsS -m 20 https://api.<domain>/api/health > /dev/null 2>&1
```

### 3.3 File `.env` (satu sumber konfigurasi)

Konfigurasi disimpan di **`~/prakasa-work-os-backend/.env`** (chmod 600).
Aplikasi web (`src/app.js`), migration, dan semua job cron membaca file yang
sama (`require('dotenv').config()` dari folder aplikasi). Variabel di panel
"Environment variables" cPanel boleh dikosongkan; bila diisi, nilainya
**menang** atas `.env`, jadi jangan isi di dua tempat.

Buat secret baru di Terminal (jalankan sekali per secret, tempel langsung ke
`.env`, jangan disalin ke tempat lain):

```bash
openssl rand -hex 48      # JWT_SECRET, SIGNATURE_ENCRYPTION_KEY (masing-masing berbeda)
openssl rand -hex 32      # SETUP_TOKEN (harus tepat 64 karakter hex)
```

Jangan pernah memakai ulang secret dari `.env` lokal. Dengan
`NODE_ENV=production` server **menolak start** bila `JWT_SECRET` /
`SIGNATURE_ENCRYPTION_KEY` kosong, < 32 karakter, atau masih nilai contoh, atau
`DB_*` belum lengkap (`backend/src/config/validateEnv.js`); alasannya tertulis
di log aplikasi.

Isi `.env` per kelompok (nama variabel persis seperti `backend/.env.example`;
baca komentar di file itu untuk detail tiap variabel):

**A. Wajib**

```env
NODE_ENV=production
DB_HOST=localhost
DB_PORT=3306
DB_USER=<dbuser>
DB_PASS=<password database>
DB_NAME=<db>
DB_POOL_LIMIT=5
DB_SSL_MODE=disabled
JWT_SECRET=<openssl rand -hex 48>
JWT_EXPIRES_IN=8h
SIGNATURE_ENCRYPTION_KEY=<openssl rand -hex 48, berbeda dari JWT_SECRET>
CORS_ORIGINS=https://<domain>,https://www.<domain>
PUBLIC_WEB_URL=https://<domain>
APP_PUBLIC_URL=https://<domain>
PRAKASA_AGENT_API_URL=https://api.<domain>/api/v1
```

**B. Sementara, hanya untuk membuat Super Admin pertama (§3.7) — hapus sesudahnya**

```env
SETUP_ENABLED=yes
SETUP_TOKEN=<openssl rand -hex 32>
```

**C. Login Google (opsional; email + password tetap login utama)**

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth client "Prakasa Workspace
Login", §7), `GOOGLE_ALLOWED_DOMAIN=prakasagroup.com,prakasafoods.com`.

**D. Google Workspace (service account + domain-wide delegation)**

`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (satu
baris, newline ditulis `\n`, dalam tanda kutip), `GOOGLE_SHARED_DRIVE_ID`,
`GOOGLE_CALENDAR_DELEGATED_USER`, `GOOGLE_CHAT_DELEGATED_USER`,
`GOOGLE_GMAIL_SENDER` (kosong = email notifikasi tidak dikirim),
`GOOGLE_ADMIN_DELEGATED_USER`, `GOOGLE_CHAT_WEBHOOK_URL`,
`MARKETING_GA_PROPERTY`.

**E. AI**

`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_TIMEOUT_MS`, `ANTHROPIC_API_KEY`,
`CLAUDE_TIMEOUT_MS`, `CLAUDE_ALLOW_TEMPERATURE=no`,
`CLAUDE_TEAM_MODEL`, `CLAUDE_TEAM_CLI_PATH`, `CLAUDE_TEAM_TIMEOUT_MS`,
`CLAUDE_TEAM_WORKDIR`, `CLAUDE_TEAM_AGENT_TIMEOUT_MS`,
`CLAUDE_TEAM_GATEWAY_URL`, `CLAUDE_TEAM_GATEWAY_SECRET`,
`CLAUDE_TEAM_GATEWAY_HOST`, `CLAUDE_TEAM_GATEWAY_PORT`,
`CLAUDE_TEAM_GATEWAY_TIMEOUT_MS`, `CLAUDE_TEAM_MAX_CONCURRENT`,
`CLAUDE_TEAM_MAX_QUEUE`, `CLAUDE_TEAM_QUEUE_TIMEOUT_MS`,
`CLAUDE_TEAM_RETRY_DELAY_MS`, `AI_AGENT_ENABLED`, `AI_AGENT_DAILY_LIMIT`,
`AI_LARGE_CONTEXT_CHARS`, `AI_LARGE_HISTORY_CHARS`,
`DOCUMENT_UPLOAD_MAX_BYTES`, `AI_DOCUMENT_MAX_BYTES`,
`AI_DOCUMENT_MAX_EXTRACTED_CHARS`, `N8N_AI_GATEWAY_URL`,
`N8N_AI_GATEWAY_SECRET`, `N8N_AI_GATEWAY_TIMEOUT_MS`.
Akun gateway Claude Team (URL runner + secret) didaftarkan di aplikasi, bukan
di `.env` (§6).

**F. Sales dan Accurate (hanya baca)**

`SALES_ENTITY_ID`, `SALES_TRANSACTION_SOURCE=accurate`,
`ACCURATE_CLIENT_ID`, `ACCURATE_CLIENT_SECRET`,
`ACCURATE_REDIRECT_URI=https://api.<domain>/api/v1/integrations/accurate/callback`,
`ACCURATE_SCOPES` (kosong), `ACCURATE_DB_NAME="PT. PRAKASA FOODS NUSANTARA"`,
`ACCURATE_SYNC_SCOPES`, `ACCURATE_SYNC_DELAY_MS`, `ACCURATE_SYNC_RETRY_MS`,
`ACCURATE_WAREHOUSE_DOCUMENTS`, `ACCURATE_ITEM_UNITS`,
`ACCURATE_WAREHOUSE_SO`, `ACCURATE_PROCUREMENT`, `ACCURATE_FINANCE`,
`PROCUREMENT_LATE_FROM`, `WAREHOUSE_OTIF_FROM`, `ACCURATE_BATCH_REMINDERS`,
`ACCURATE_SYNC_USER_ID`, `ACCURATE_OWNER_DECIDER_EMAIL`.
Flag non-rahasia (`ACCURATE_SYNC_SCOPES`, `ACCURATE_WAREHOUSE_*`,
`ACCURATE_PROCUREMENT`, `ACCURATE_FINANCE`, tanggal `*_FROM`, …) disalin dari
`.env` lokal yang sekarang berjalan, supaya cakupan sinkron sama.
`ACCURATE_SYNC_USER_ID` diisi setelah Super Admin ada (biasanya `1`), atau
dikosongkan (= Super Admin yang menyambungkan Accurate).

**G. Operasional**

`UPLOAD_DIR=uploads`, `REALTIME_ENABLED=0` (shared hosting; lihat §3.9),
`RESULT_CACHE=1`, `AUTH_CACHE_TTL_MS=30000`, `DASHBOARD_WARMUP=1`, `RATE_LIMIT_AI_PER_MIN`,
`RATE_LIMIT_UPLOAD_PER_10MIN`, `RETENTION_INTEGRATION_LOG_DAYS=90`,
`RETENTION_NOTIFICATION_DAYS=180`, `HEALTH_DB_TIMEOUT_MS`,
`SHUTDOWN_TIMEOUT_MS`, `JOB_FLUSH_TIMEOUT_MS`,
`IT_SUPPORT_EMAIL`, `IT_REPORT_ENTITY_CODE` (biasanya tidak perlu).

**H. JANGAN diisi di production**

`PORT` (Passenger mengatur sendiri), semua `BOOTSTRAP_*`,
`AI_DOCUMENT_STORAGE` (ditolak di production), `CORS_ALLOW_VERCEL`.

Setelah selesai: `chmod 600 ~/prakasa-work-os-backend/.env`.

> `backend/.env.example` adalah daftar lengkap yang berlaku. Bila ada variabel
> baru di sana yang belum tercantum di sini, ikuti file itu.

### 3.4 Install dependency

Setup Node.js App → **Run NPM Install** (memakai `package-lock.json`). Bila
tombol timeout, jalankan di Terminal setelah perintah "Enter to the virtual
environment": `npm ci --omit=dev`.

### 3.5 Migration (Terminal)

```bash
source /home/USER/nodevenv/prakasa-work-os-backend/22/bin/activate && cd /home/USER/prakasa-work-os-backend
npm run migrate -- --dry-run     # daftar migration yang akan dijalankan
npm run migrate                  # fresh DB: membuat ledger lalu menjalankan semua file
npm run check:ledger             # harus: RESULT: HEALTHY
```

Bila satu file gagal: baca pesan error, perbaiki penyebabnya (biasanya hak
akses user MySQL atau versi MySQL), lalu jalankan `npm run migrate` lagi —
file yang sudah tercatat dilewati. Detail runner: §12.1.

### 3.6 Start dan health check

Setup Node.js App → **Restart**. Lalu:

```bash
curl -sS https://api.<domain>/api/health
# {"status":"ok","db":"ok","timestamp":"…"}
```

`503` / `"db":"down"` = database tidak terjangkau (cek `DB_*`). Halaman error
Passenger = aplikasi gagal start: lihat log aplikasi (di cPanel biasanya
`~/prakasa-work-os-backend/stderr.log`); pesan `[config] …` menyebut variabel
yang salah.

### 3.7 Super Admin pertama (endpoint setup sementara)

Endpoint `/api/v1/setup/*` hanya aktif bila `SETUP_ENABLED=yes` **dan**
`SETUP_TOKEN` tepat 64 hex. Dibatasi 5 request / 15 menit / IP. Token hanya
dikirim lewat header `X-Setup-Token`.

```bash
# 1. Status (read-only): ledger harus healthy, semua migration applied
curl -sS -H "X-Setup-Token: <token>" https://api.<domain>/api/v1/setup/status

# 2. Buat Super Admin (password ≥ 12 karakter, unik; ketik langsung, jangan disimpan di file)
curl -sS -X POST \
  -H "X-Setup-Token: <token>" -H "Content-Type: application/json" \
  -d '{"email":"<email admin>@prakasagroup.com","name":"Super Admin","password":"<password kuat>"}' \
  https://api.<domain>/api/v1/setup/bootstrap-admin
```

Bootstrap ditolak (409) bila ledger belum 100% healthy. Akun dibuat dengan
tanda wajib ganti password. User yang sudah ada tidak direset dan tidak
dipindah entitas.

### 3.8 Menutup endpoint setup

1. Hapus baris `SETUP_ENABLED` dan `SETUP_TOKEN` dari `.env`.
2. Restart aplikasi.
3. Periksa:

   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" https://api.<domain>/api/v1/setup/status
   # 404
   ```

Jangan menjalankan `bootstrapAdmin.js` di production (skrip itu menolak
`NODE_ENV=production`; jangan mengubah `NODE_ENV` untuk melewatinya).

---

### 3.9 Kapasitas dan performa (uji beban 1 Okt 2026)

Diukur lokal dengan data nyata (MySQL CPU-bound adalah batasnya). Aturan yang
berlaku untuk shared hosting 2 vCPU / 4 GB:

- **`DB_POOL_LIMIT=5`** untuk web, **3** untuk cron. Jangan dinaikkan: pool
  10 dan 20 terukur **lebih lambat** (p95 25 pengguna: 40–62 detik vs 21
  detik) karena query saling berebut 2 vCPU MySQL.
- **`max_user_connections` host ≥ 5 + 3 × job cron bersamaan** (praktis ≥ 20).
- **`REALTIME_ENABLED=0`** kecuali host memastikan stream SSE **tidak**
  dihitung sebagai Entry Process, atau batas EP ≥ 150. Setiap tab yang
  terbuka memegang satu stream (maks 2 per pengguna; tab tersembunyi
  menjeda stream). Dengan 0, halaman tetap jalan; notifikasi muncul saat
  halaman dimuat ulang/berpindah.
- **Satu proses Node.** Cache hasil (dashboard manajemen/divisi 120 detik;
  Sales, Retail Commerce, Marketing, laporan Finance, stok & pencocokan gudang
  60 detik), status login (30 detik) dan stream realtime ada di memori proses.
  Perubahan data (batch Accurate disetujui, target/eskalasi disimpan, tulis di
  modul) membuang cache saat itu juga **di proses itu**. Bila host
  menjalankan > 1 instance, keluar/ganti kata sandi baru berlaku di instance
  lain setelah ≤ 30 detik (`AUTH_CACHE_TTL_MS`): kunci 1 instance (§3.2).
  Darurat: `RESULT_CACHE=0` mematikan semua cache (aplikasi tetap benar,
  hanya lebih lambat).
- **Passenger hangat** (`PassengerMinInstances 1`, `PassengerPreStart`,
  `PassengerStartTimeout 90`, §3.2). Sesudah start, seri 12 bulan dashboard
  divisi dihangatkan di latar belakang (15 detik setelah start, satu query
  sekaligus; `DASHBOARD_WARMUP=0` mematikan).
- **Cron berat di luar 07:30–09:30 WIB** (jam semua orang masuk): job harian
  dijadwalkan sebelum 07:30 (§5). Job 5-menit/jam yang ringan tetap jalan.
- Log permintaan tidak mencatat `/api/health` dan `/api/v1/realtime/stream`.

---

## 4. Frontend (web di `https://<domain>`)

Build dilakukan di komputer deploy (Mac), bukan di hosting.

1. Konfigurasi build — `frontend/.env.production` (tidak di-commit):

   ```bash
   cd frontend
   cp .env.production.example .env.production
   ```

   ```env
   VITE_API_URL=https://api.<domain>/api/v1
   VITE_ENABLE_GOOGLE_LOGIN=false        # true bila login Google dipakai
   VITE_GOOGLE_CLIENT_ID=                # client ID "Prakasa Workspace Login" (publik, bukan secret)
   ```

   Nilai ini ditanam saat build; setiap perubahan butuh build ulang. Jangan
   ada `.env.production.local` (akan menimpa). Halaman verifikasi publik
   memanggil `https://api.<domain>/verify/<kode>` (origin dari `VITE_API_URL`).

2. Build:

   ```bash
   npm ci
   npm run build
   grep -o 'https://api\.[a-z0-9.-]*' dist/assets/index-*.js | sort -u   # harus https://api.<domain>
   ```

3. Isi domain di `.htaccess` hasil build (CSP `connect-src` ke API):

   ```bash
   sed -i '' 's/<domain>/contoh.co.id/g' dist/.htaccess     # ganti contoh.co.id dengan domain asli
   grep -c '<domain>' dist/.htaccess                        # harus 0
   ```

4. Paket dan unggah (titik di `zip -r … .` ikut membawa `.htaccess`):

   ```bash
   cd dist && zip -r ../web-release.zip . && cd ..
   ```

   cPanel → File Manager → `public_html`:
   - Backup dulu: pilih semua isi `public_html` → Compress →
     `~/releases/web-<tanggal>.zip` (untuk rollback).
   - Upload `web-release.zip` → Extract (timpa). File lama di `assets/` boleh
     dibiarkan beberapa hari: tab yang masih terbuka tetap bisa memuat
     halaman, dan aplikasi memuat ulang sendiri bila potongan lama hilang
     (`frontend/src/components/lazyPage.js`).
   - Pastikan "Show Hidden Files" aktif dan `public_html/.htaccess` ada.

Isi `frontend/public/.htaccess` (ikut ke `dist/`):
- paksa HTTPS (kecuali `/.well-known/` untuk AutoSSL);
- SPA fallback: path yang bukan file/folder → `index.html`, sehingga
  `/sales/orders` dan `/verify/<kode>` bisa di-refresh; file hilang di
  `/assets/` tetap 404;
- `Cache-Control: no-cache` untuk `index.html` dan manifest, cache 1 tahun
  `immutable` untuk bundle ber-hash;
- header keamanan: HSTS (1 tahun, tanpa `includeSubDomains`),
  `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` minimal, dan CSP (§12.3).

`frontend/vercel.json` dan `frontend/api/proxy.js` adalah **warisan** hosting
Vercel lama (proxy `/api/*` ke `prakasa-ai-api.vercel.app`). Tidak dipakai di
cPanel dan tidak ikut ke `dist/`; dibiarkan karena masih diuji
`frontend/test/proxy.test.js`.

---

## 5. Cron

Cron tidak mewarisi environment Passenger. Semua job dijalankan lewat
`backend/cron-wrapper.sh`, yang:
- membaca `~/.prakasa-work-os-cron.env` (wajib ada, chmod 600),
- masuk ke `~/prakasa-work-os-backend`,
- mencari binary Node (`/opt/cpanel/ea-nodejs22/bin/node`, `…20…`, atau `NODE_BIN`),
- lalu job membaca `.env` aplikasi (dotenv tidak menimpa nilai yang sudah ada).

Jadi file cron env cukup berisi **override** untuk proses cron:

```bash
cat > ~/.prakasa-work-os-cron.env <<'EOF'
NODE_ENV=production
# Job cron cukup 3 koneksi (web 5); semua nilai lain dibaca dari ~/prakasa-work-os-backend/.env
DB_POOL_LIMIT=3
# NODE_BIN=/opt/cpanel/ea-nodejs22/bin/node
EOF
chmod 600 ~/.prakasa-work-os-cron.env
chmod 700 ~/prakasa-work-os-backend/cron-wrapper.sh
mkdir -p ~/logs
```

(`backend/cron.env.example` berisi daftar lengkap bila host ingin cron env
yang berdiri sendiri; nilainya harus sama persis dengan `.env`.)

Uji satu job secara manual dulu:

```bash
/bin/bash ~/prakasa-work-os-backend/cron-wrapper.sh src/jobs/retention.js --dry-run
```

Pasang crontab lewat Terminal (`crontab -e`), ganti `USER`:

```cron
CRON_TZ=Asia/Jakarta
SHELL=/bin/bash
# m    h  dom mon dow  command
*/5    *  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/accurateSync.js            >> /home/USER/logs/accurateSync.log 2>&1
2-59/5 *  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/claudeTeamHealth.js        >> /home/USER/logs/claudeTeamHealth.log 2>&1
0      *  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/approvalReminders.js       >> /home/USER/logs/approvalReminders.log 2>&1
30     2  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/retention.js               >> /home/USER/logs/retention.log 2>&1
30     6  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/accurateTokenRefresh.js    >> /home/USER/logs/accurateTokenRefresh.log 2>&1
# Job harian selesai sebelum 07:30 WIB (jam semua orang masuk, §3.9)
40     6  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/itReminders.js             >> /home/USER/logs/itReminders.log 2>&1
45     6  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/peopleCultureReminders.js  >> /home/USER/logs/peopleCultureReminders.log 2>&1
50     6  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/gaOpsReminders.js          >> /home/USER/logs/gaOpsReminders.log 2>&1
55     6  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/marketingReminders.js      >> /home/USER/logs/marketingReminders.log 2>&1
3      7  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/scripts/taskDueReminder.js      >> /home/USER/logs/taskDueReminder.log 2>&1
8      7  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/overdueTaskScan.js         >> /home/USER/logs/overdueTaskScan.log 2>&1
13     7  *   *   *    /bin/bash /home/USER/prakasa-work-os-backend/cron-wrapper.sh src/jobs/salesDormantReminder.js    >> /home/USER/logs/salesDormantReminder.log 2>&1
# Log tidak tumbuh tanpa batas: kosongkan log > 20 MB setiap Minggu 03:00
0      3  *   *   0    find /home/USER/logs -name '*.log' -size +20M -exec truncate -s 0 {} \;
```

Catatan:
- `taskDueReminder.js` ada di `src/scripts/`, bukan `src/jobs/`.
- **Tidak ada job harian antara 07:30 dan 09:30 WIB**: jam itu semua orang
  membuka dashboard, dan MySQL 2 vCPU adalah batasnya (§3.9). Menit job harian
  sengaja tidak jatuh di kelipatan 5 (bentrok dengan `accurateSync.js`), jadi
  paling banyak ±3 job berjalan bersamaan (3 × 3 + 5 = 14 koneksi MySQL).
- **`CRON_TZ`**: semua jam di atas WIB. Periksa setelah pemasangan
  (`crontab -l`) dan setelah jam jalan pertama di log. Bila host tidak
  mendukung `CRON_TZ` (job jalan 7 jam lebih awal/lambat), hapus baris itu
  dan geser jam ke zona server (`date` di Terminal; WIB = UTC+7, mis. 07:00
  WIB = `0 0 * * *` UTC).
- `accurateSync.js` memakai kunci database (`GET_LOCK`), jadi dua jalan yang
  tumpang tindih tidak menarik dua kali. Sebelum Accurate tersambung (§8),
  job ini hanya mencatat satu baris "belum tersambung" per jalan.
- Panel Cron Jobs cPanel juga bisa dipakai (satu baris per job, tanpa
  `CRON_TZ`; jam mengikuti zona server).

---

## 6. Mematikan launchd di Mac owner

**Setelah** cron production berjalan dan Accurate production tersambung (§8),
matikan sinkron lama di Mac agar tidak ada dua penarik:

```bash
launchctl bootout gui/$(id -u)/id.prakasa.accurate-sync
launchctl bootout gui/$(id -u)/id.prakasa.accurate-token-refresh
mkdir -p ~/Library/LaunchAgents/nonaktif
mv ~/Library/LaunchAgents/id.prakasa.accurate-sync.plist ~/Library/LaunchAgents/id.prakasa.accurate-token-refresh.plist ~/Library/LaunchAgents/nonaktif/
launchctl list | grep prakasa     # hanya id.prakasa.claude-runner yang tersisa
```

**Claude Team runner tetap di Mac** (`id.prakasa.claude-runner`), sesuai
`docs/claude-team-runner.md`:
1. Runner tetap menyala dan terjangkau lewat URL HTTPS tetap (tunnel).
2. Di aplikasi production: Administrasi → AI Provider & Engine → tambah akun
   mode **gateway** (URL runner + `CLAUDE_TEAM_GATEWAY_SECRET` runner), lalu
   atur routing divisi. Wajib diulang karena database production baru dan
   secret disimpan terenkripsi dengan kunci production.
3. `PRAKASA_AGENT_API_URL=https://api.<domain>/api/v1` di `.env` production
   (§3.3 A), agar alat agen di runner memanggil balik API production.
4. Cron `claudeTeamHealth.js` (§5) menandai bila runner tidak terjangkau.

---

## 7. Google Cloud dan Google Workspace

Hanya project **`prakasa-work-os-local`**. Jangan menyentuh project/console
milik website PFN / Prakasa Foods.

1. Google Cloud Console → project `prakasa-work-os-local` → APIs & Services →
   Credentials → OAuth 2.0 Client ID **"Prakasa Workspace Login"**:
   - **Authorized JavaScript origins**: tambahkan `https://<domain>` dan
     `https://www.<domain>` (origin `http://localhost:…` untuk development
     biarkan).
   - Authorized redirect URIs: tidak perlu (login memakai popup, redirect
     `postmessage`).
   - Client ID → `VITE_GOOGLE_CLIENT_ID` (frontend) dan `GOOGLE_CLIENT_ID`
     (backend); client secret → `GOOGLE_CLIENT_SECRET` (backend saja).
2. API yang aktif di project (APIs & Services → Library): Drive, Docs, Sheets,
   Slides, Calendar, Gmail, Google Chat, Admin SDK, Google Analytics Admin,
   Google Analytics Data.
3. Domain-wide delegation — Google **Admin Console** (admin.google.com) →
   Security → Access and data control → API controls → Domain-wide delegation
   → Client ID service account → scope (pisahkan dengan koma):

   ```
   https://www.googleapis.com/auth/drive,
   https://www.googleapis.com/auth/documents,
   https://www.googleapis.com/auth/spreadsheets,
   https://www.googleapis.com/auth/presentations,
   https://www.googleapis.com/auth/calendar,
   https://www.googleapis.com/auth/calendar.events,
   https://www.googleapis.com/auth/calendar.readonly,
   https://www.googleapis.com/auth/gmail.send,
   https://www.googleapis.com/auth/gmail.compose,
   https://www.googleapis.com/auth/gmail.modify,
   https://www.googleapis.com/auth/chat.spaces,
   https://www.googleapis.com/auth/chat.messages,
   https://www.googleapis.com/auth/chat.memberships,
   https://www.googleapis.com/auth/chat.delete,
   https://www.googleapis.com/auth/chat.users.readstate,
   https://www.googleapis.com/auth/chat.users.spacesettings,
   https://www.googleapis.com/auth/admin.directory.user.readonly,
   https://www.googleapis.com/auth/admin.directory.group.readonly,
   https://www.googleapis.com/auth/admin.directory.group.member.readonly
   ```

   `gmail.send` wajib agar email notifikasi terkirim. Google Analytics tidak
   memakai DWD: service account ditambahkan sebagai Viewer di GA → Admin →
   Property access.
4. Shared Drive: service account adalah anggota **Content Manager**; ID-nya
   di `GOOGLE_SHARED_DRIVE_ID`.

---

## 8. Accurate Online

1. Developer area Accurate → aplikasi Prakasa Workspace → **OAuth Callback
   URL**: `https://api.<domain>/api/v1/integrations/accurate/callback` — harus
   sama persis dengan `ACCURATE_REDIRECT_URI`. (Bila Accurate hanya menerima
   satu callback, penyambungan dari laptop lokal berhenti bekerja; itu
   diterima karena sinkron pindah ke server.)
2. Login ke `https://<domain>` sebagai Super Admin → Administrasi → Integrasi
   Accurate → **Sambungkan Accurate** → pilih database
   "PT. PRAKASA FOODS NUSANTARA". Sambung ulang ini wajib: token lama
   terenkripsi dengan kunci lokal dan tidak ikut.
3. Uji tanpa menulis apa pun:

   ```bash
   /bin/bash ~/prakasa-work-os-backend/cron-wrapper.sh src/jobs/accurateSync.js --dry-run
   ```

4. Jalan sungguhan pertama (atau tunggu cron 5 menit): batch muncul di Data
   Accurate untuk disetujui Supervisor/Head divisi. Data baru masuk aplikasi
   setelah batch disetujui; alarm/eskalasi divisi menunggu batch pertama yang
   disetujui. Aplikasi tidak pernah menulis ke Accurate.

---

## 9. Smoke test (centang semua sebelum diumumkan)

| # | Uji | Cara | Hasil yang benar |
|---|---|---|---|
| 1 | Health API | `curl -sS https://api.<domain>/api/health` | `{"status":"ok","db":"ok",…}` |
| 2 | HTTPS paksa | `curl -sI http://<domain>/sales/orders` | `301` ke `https://<domain>/sales/orders` |
| 3 | Setup tertutup | `curl -s -o /dev/null -w "%{http_code}" https://api.<domain>/api/v1/setup/status` | `404` |
| 4 | Login salah | Login dengan password salah | Pesan salah password; percobaan ke-6 dalam 1 menit ditolak dengan HTTP 429 (DevTools → Network → `auth/login`) |
| 5 | Login benar | Super Admin login | Diminta ganti kata sandi sementara (wajib; token lama berakhir setelah diganti), lalu Beranda |
| 6 | Login Google | Bila `VITE_ENABLE_GOOGLE_LOGIN=true`: "Masuk dengan Google" | Popup Google, kembali masuk; tanpa error `origin_mismatch` |
| 7 | Deep link | Buka `https://<domain>/sales/orders`, tekan F5 | Halaman yang sama, bukan 404 |
| 8 | Halaman tak dikenal | Buka `https://<domain>/tidak-ada` | "Halaman tidak ditemukan" + tombol Kembali ke Beranda |
| 9 | Verifikasi publik | Tanda tangani dokumen uji → buka link/QR `/verify/<kode>` di jendela incognito | Panel verifikasi tampil tanpa login |
| 10 | Pembaruan langsung (SSE) | Dua tab, user berbeda; ajukan approval di tab A | Tab B mendapat notifikasi tanpa refresh; DevTools → Network → `realtime/stream` tetap terbuka |
| 11 | AI stream panjang | Tanya Prakasa AI tugas panjang (> 60 detik) | Teks terus mengalir sampai selesai, tidak terputus di 60 detik |
| 12 | Upload Drive | Upload file di Penyimpanan divisi dan lampirkan dokumen ke Prakasa AI | File muncul di Shared Drive |
| 13 | Link email | Picu notifikasi email (mis. tiket IT baru ke `IT_SUPPORT_EMAIL`) | Email terkirim; link di dalamnya `https://<domain>/…`, bukan localhost |
| 14 | Accurate | §8 langkah 3–4 | Dry-run sukses; batch muncul; setelah disetujui data tampil |
| 15 | Cron | Hari berikutnya setelah 07:30 WIB: `tail -n 20 ~/logs/*.log` | Setiap job menulis baris selesai, tanpa error; `accurateSync.log` bertambah tiap 5 menit |
| 16 | Header web | `curl -sI https://<domain>/` | Ada `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cache-Control: no-cache` |
| 17 | Cache bundle | `curl -sI https://<domain>/assets/<file>.js` | `Cache-Control: public, max-age=31536000, immutable` |
| 18 | CSP tidak memblokir | Buka beberapa halaman (Beranda, Docs, Gmail, Prakasa AI) dengan DevTools → Console | Tidak ada pesan "Refused to … Content Security Policy" |
| 19 | File tersembunyi | `curl -s -o /dev/null -w "%{http_code}" https://<domain>/.htaccess` | `403` (bukan `200`) |
| 20 | Header API | `curl -sI https://api.<domain>/api/health` | Header keamanan dari helmet; `Cache-Control: no-store` |

Bila #10 atau #11 gagal (stream tertahan/terputus): minta host menaikkan
timeout proxy untuk `api.<domain>` dan mematikan buffering. Sementara itu
`REALTIME_ENABLED=0` mematikan SSE dengan aman (halaman tetap jalan tanpa
pembaruan langsung). #10 hanya diuji bila `REALTIME_ENABLED=1` (§3.9).

### 9.1 Checklist go-live (terakhir, sebelum diumumkan)

- [ ] **Kosongkan `EMAIL_TEST_REDIRECT` dan `EMAIL_TEST_ALLOWLIST`** (selama masa uji semua email dialihkan ke support@prakasagroup.com) di `~/prakasa-work-os-backend/.env`
      (masa uji: email hanya ke alamat di daftar itu), lalu Restart. Tanpa ini
      email notifikasi tidak sampai ke karyawan lain.
- [ ] `SETUP_ENABLED` dan `SETUP_TOKEN` sudah dihapus (§3.8; smoke test #3 = `404`).
- [ ] `DB_POOL_LIMIT=5` (web) dan `3` (cron env); `max_user_connections` host ≥ 20.
- [ ] `REALTIME_ENABLED=0`, atau host sudah mengonfirmasi SSE tidak dihitung EP / EP ≥ 150.
- [ ] `PassengerMinInstances 1` + `PassengerStartTimeout 90` di `.htaccess` API,
      `PassengerPreStart https://api.<domain>/api/health` (atau cron health
      5 menit) dan 1 instance Passenger (§3.2).
- [ ] Crontab: tidak ada job harian antara 07:30 dan 09:30 WIB (§5).
- [ ] `RESULT_CACHE` tidak `0` (hanya untuk darurat).

---

## 10. Batasan keras (tidak berubah)

(Dirujuk dari kode sebagai "docs/deployment.md §10"; jangan ganti nomornya.)

Tidak ada tabel/kolom yang menduplikasi:
- **Jurnal.id / akuntansi**: transaksi akuntansi, jurnal umum, saldo, laporan
  keuangan, pajak. Tarikan Finance dari Accurate hanya faktur dan pembayaran
  pembelian (utang), baca saja.
- **KantorKu HRIS**: payroll, absensi, cuti, lembur, performance review,
  rekrutmen. Tidak ada integrasi ke KantorKu.
- **Accurate**: aplikasi hanya membaca; tidak ada penulisan balik.

Prinsip AI tetap: transcript meeting hanya untuk permission
`meeting.ai_summary`; action item wajib dikonfirmasi user sebelum jadi task;
hasil AI tersimpan di `ai_summaries` + `activity_logs`; pengecekan dokumen
tetap mengembalikan hasil berbasis aturan bila AI mati.

---

## 11. Rollback dan backup

**Backup rutin**
- cPanel → Backup (atau JetBackup bila tersedia): pastikan backup **harian**
  database MySQL aktif; unduh backup penuh mingguan ke penyimpanan di luar
  hosting.
- Tambahan via cron (dump harian, simpan 14 hari):

  ```cron
  45 1 * * * mkdir -p /home/USER/backups && mysqldump --defaults-extra-file=/home/USER/.my.cnf --single-transaction --routines --triggers --no-tablespaces <db> | gzip > /home/USER/backups/db-$(date +\%F).sql.gz && find /home/USER/backups -name 'db-*.sql.gz' -mtime +14 -delete
  ```

  `~/.my.cnf` (chmod 600) berisi `[client]` `user=<dbuser>` `password=…`.
- `~/prakasa-work-os-backend/.env` dan `~/.prakasa-work-os-cron.env`: simpan
  salinan di password manager owner. **Tanpa `SIGNATURE_ENCRYPTION_KEY` yang
  sama, data terenkripsi (token Accurate, secret gateway) tidak bisa dibaca
  dari backup.**
- `~/prakasa-work-os-backend/uploads/` ikut di backup cPanel.

**Rollback**
- Frontend: extract `~/releases/web-<tanggal>.zip` sebelumnya ke
  `public_html` (timpa).
- Backend: simpan folder lama sebelum deploy
  (`cp -a ~/prakasa-work-os-backend ~/releases/backend-<tanggal>`); rollback =
  kembalikan folder itu lalu Restart.
- Database: migration hanya menambah (tidak ada "down"). Sebelum menjalankan
  migration baru, buat dump; rollback skema = restore dump itu (phpMyAdmin →
  Import, atau `gunzip < dump.sql.gz | mysql <db>`), lalu kembalikan backend
  versi lama.
- Setiap rollback dicatat di activity log/catatan program (siapa, kapan,
  kenapa).

---

## 12. Referensi teknis

### 12.1 Migration runner (ledger)

`backend/src/db/migrate.js` mencatat setiap file di tabel `schema_migrations`
(nama + checksum) dan hanya menjalankan file yang belum tercatat.

```bash
npm run migrate -- --dry-run
npm run migrate -- --help
npm run check:ledger                  # RESULT: HEALTHY
```

- Jangan mengedit migration yang sudah applied (checksum drift membuat runner
  berhenti).
- `--baseline` / `--baseline-through=NNN` hanya untuk database lama dengan
  ledger kosong; ditolak pada DB baru. Untuk go-live (DB baru) tidak dipakai.
- DDL MySQL auto-commit: bila satu file gagal di tengah, ledger tidak ditulis
  untuk file itu; migration dirancang idempotent/aditif, jadi perbaiki
  penyebab lalu ulangi.
- Runner memakai koneksi khusus `multipleStatements: true`.

### 12.2 Koneksi database terenkripsi (bila MySQL remote)

`DB_SSL_MODE`: `disabled` (default, MySQL di server yang sama), `required`
(TLS + verifikasi sertifikat dengan trust store), `verify-ca` (TLS +
`DB_SSL_CA` wajib; `\n` literal diubah jadi newline). `DB_SSL_CA` hanya untuk
`verify-ca`. Parser: `backend/src/db/connectionConfig.js`.

### 12.3 Keputusan CSP (`frontend/public/.htaccess`)

| Direktif | Nilai | Alasan |
|---|---|---|
| `script-src` | `'self' https://accounts.google.com/gsi/client` | Build Vite tidak menyisipkan script inline (diperiksa di `dist/index.html`); GIS untuk login Google. Tanpa `'unsafe-inline'`/`'unsafe-eval'`. |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style` | **`'unsafe-inline'` sengaja**: pembaca Gmail menampilkan email di iframe `srcdoc` yang mewarisi CSP halaman, dan email butuh `<style>` + atribut `style=""` (diuji: tanpa ini tampilan email rusak). GIS juga menyisipkan style. Gaya inline React (CSSOM) sendiri tidak memerlukannya. Risiko kecil karena script tetap ketat. |
| `font-src` | `'self' data: https://fonts.gstatic.com` | Google Sans, Roboto, Material Symbols |
| `img-src` | `'self' data: blob: https:` | Avatar Google, thumbnail Drive (blob), gambar email jarak jauh |
| `connect-src` | `'self' https://api.<domain> https://accounts.google.com/gsi/` | API (XHR, SSE `realtime/stream`, stream AI, `/verify`), GIS |
| `frame-src` | `https://docs.google.com https://drive.google.com https://accounts.google.com/gsi/` | Editor Docs/Sheets/Slides, pratinjau Drive; Calendar tidak di-embed (hanya tautan) |
| lain-lain | `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests` | |

Diverifikasi 1 Okt 2026 pada build production dengan server lokal yang
memasang CSP yang sama + `report-uri`: Beranda, Data Sales, Warehouse,
Prakasa AI (+ panel samping), editor Docs (iframe), Gmail (srcdoc),
verifikasi publik, halaman 404, dan halaman login dengan GIS — tanpa
pelanggaran. `.htaccess` juga diuji di Apache 2.4 lokal (redirect HTTPS,
fallback SPA, 404 aset, header cache dan keamanan).

Jangan menambah `Cross-Origin-Opener-Policy: same-origin` pada web: popup
login Google membutuhkan `window.opener` (bila perlu, pakai
`same-origin-allow-popups`). Bila menambah layanan pihak ketiga baru (iframe,
script, API langsung dari browser), tambahkan origin-nya ke CSP di
`frontend/public/.htaccess` dan perbarui tabel ini.

### 12.4 Ukuran bundle

Halaman dimuat per rute (`React.lazy`, `frontend/src/App.jsx`); Login, bingkai
aplikasi, dan Beranda ada di bundle utama. Panel Prakasa AI (renderer
markdown) dimuat saat pertama dibuka. Bundle utama: ±344 kB (±113 kB gzip),
sebelumnya ±1.948 kB (±585 kB gzip).

### 12.5 AI provider

Setiap modul AI memilih provider lewat tabel `ai_module_contexts`
(`PATCH /api/v1/ai/modules/:module`); model per provider diatur di
Administrasi → AI Provider Settings.
