#!/usr/bin/env bash
# Menjalankan Prakasa Workspace di komputer sendiri (localhost) dengan satu perintah:
#
#   bash scripts/run-local.sh
#
# Yang dilakukan:
#   1. Memeriksa Node.js dan MySQL 8 lokal.
#   2. Membuat database dan user MySQL lokal (bila belum ada).
#   3. Membuat backend/.env dan frontend/.env untuk lokal (bila belum ada).
#      File .env yang sudah ada tidak ditimpa; skrip berhenti bila isinya
#      menunjuk ke produksi atau ke database di luar komputer ini.
#   4. npm ci (bila perlu), migrasi database, membuat Super Admin lokal.
#   5. Menjalankan backend (port 3000) dan frontend (port 5173).
#
# Hanya untuk database lokal. Tanpa kredensial Google: tidak ada email,
# Drive, atau Chat yang terkirim. Hentikan dengan Ctrl+C.
#
# Bisa diubah lewat variabel lingkungan:
#   MYSQL_ADMIN="mysql -uroot"   perintah MySQL dengan hak membuat database
#   LOCAL_DB_NAME, LOCAL_DB_USER, LOCAL_DB_PASS, LOCAL_DB_PORT

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQL_ADMIN="${MYSQL_ADMIN:-mysql -uroot}"
DB_NAME="${LOCAL_DB_NAME:-prakasa_work_os}"
DB_USER="${LOCAL_DB_USER:-prakasa_user}"
DB_PASS="${LOCAL_DB_PASS:-lokal123}"
DB_PORT="${LOCAL_DB_PORT:-3306}"
ADMIN_EMAIL="superadmin@prakasagroup.com"
ADMIN_PASS='Uji-Lokal-2026!x'

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n[berhenti] %s\n' "$*" >&2; exit 1; }

# 1. Alat yang dibutuhkan
say "Memeriksa Node.js dan MySQL"
command -v node >/dev/null || fail "Node.js belum terpasang. Pasang dulu: brew install node"
command -v npm >/dev/null || fail "npm belum terpasang."
command -v mysql >/dev/null || fail "MySQL belum terpasang. Pasang dulu:
  brew install mysql@8.0 && brew services start mysql@8.0 && brew link mysql@8.0 --force"
MYSQL_VERSION="$(mysql --version)"
case "$MYSQL_VERSION" in
  *MariaDB*) fail "Terdeteksi MariaDB ($MYSQL_VERSION). Butuh MySQL 8 (collation utf8mb4_0900_ai_ci)." ;;
  *" 8."*|*"Ver 8"*|*"Distrib 8"*) ;;
  *) fail "Butuh MySQL 8, terdeteksi: $MYSQL_VERSION" ;;
esac

# 2. Database dan user lokal
say "Menyiapkan database lokal $DB_NAME"
$MYSQL_ADMIN -e "SELECT 1" >/dev/null 2>&1 \
  || fail "Tidak bisa masuk ke MySQL dengan '$MYSQL_ADMIN'. Pastikan MySQL berjalan (brew services start mysql@8.0),
  atau jalankan ulang dengan MYSQL_ADMIN=\"mysql -uroot -p\" bila root memakai kata sandi."
$MYSQL_ADMIN -e "
  CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
  CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
  GRANT ALL ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
  GRANT ALL ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
  FLUSH PRIVILEGES;"

# 3. File .env lokal (tidak menimpa yang sudah ada)
say "Menyiapkan file .env lokal"
if [ ! -f "$ROOT/backend/.env" ]; then
  ROOT="$ROOT" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" DB_PORT="$DB_PORT" node -e '
    const fs = require("fs"); const crypto = require("crypto");
    const e = process.env;
    const set = {
      NODE_ENV: "development", PORT: "3000",
      DB_HOST: "127.0.0.1", DB_PORT: e.DB_PORT, DB_USER: e.DB_USER, DB_PASS: e.DB_PASS, DB_NAME: e.DB_NAME, DB_SSL_MODE: "disabled",
      JWT_SECRET: crypto.randomBytes(32).toString("hex"),
      CORS_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
      EMAIL_TEST_REDIRECT: "support@prakasagroup.com", EMAIL_TEST_ALLOWLIST: "",
    };
    const lines = fs.readFileSync(`${e.ROOT}/backend/.env.example`, "utf8").split("\n").map((line) => {
      const m = line.match(/^([A-Z0-9_]+)=/);
      if (m && m[1] in set) { const v = set[m[1]]; delete set[m[1]]; return `${m[1]}=${v}`; }
      // Kredensial pihak ketiga dikosongkan di lokal.
      if (m && /(GOOGLE_|ACCURATE_|ANTHROPIC_|CLAUDE_TEAM_GATEWAY_SECRET|WEBHOOK)/.test(m[1])) return `${m[1]}=`;
      return line;
    });
    for (const [k, v] of Object.entries(set)) lines.push(`${k}=${v}`);
    fs.writeFileSync(`${e.ROOT}/backend/.env`, lines.join("\n"));
  '
  echo "backend/.env dibuat untuk database lokal $DB_NAME."
else
  echo "backend/.env sudah ada; tidak diubah."
fi
grep -Eq '^NODE_ENV=production' "$ROOT/backend/.env" \
  && fail "backend/.env berisi NODE_ENV=production. Ubah ke NODE_ENV=development untuk lokal."
DB_HOST_SET="$(grep -E '^DB_HOST=' "$ROOT/backend/.env" | head -1 | cut -d= -f2- | tr -d "\"' ")"
case "$DB_HOST_SET" in
  localhost|127.0.0.1|"") ;;
  *) fail "backend/.env menunjuk ke database $DB_HOST_SET, bukan lokal. Skrip ini hanya untuk database lokal." ;;
esac
if [ ! -f "$ROOT/frontend/.env" ]; then
  cp "$ROOT/frontend/.env.example" "$ROOT/frontend/.env"
  echo "frontend/.env dibuat (API: http://localhost:3000/api/v1)."
else
  echo "frontend/.env sudah ada; tidak diubah."
fi

# 4. Dependensi, migrasi, Super Admin
say "Memasang dependensi (sekali saja, bisa beberapa menit)"
[ -d "$ROOT/backend/node_modules" ] || (cd "$ROOT/backend" && npm ci)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm ci)

say "Menjalankan migrasi database lokal"
(cd "$ROOT/backend" && npm run -s migrate)

say "Membuat Super Admin lokal"
(cd "$ROOT/backend" && BOOTSTRAP_ALLOW=yes BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" \
  BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASS" BOOTSTRAP_ADMIN_NAME='Super Admin Lokal' npm run -s bootstrap:admin)

# 5. Jalankan
say "Menjalankan backend dan frontend"
(cd "$ROOT/backend" && npm run -s dev) &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT INT TERM
cat <<EOF

  Buka:  http://localhost:5173/login
  Email: $ADMIN_EMAIL
  Sandi: $ADMIN_PASS   (hanya untuk lokal)

  Hentikan dengan Ctrl+C.

EOF
cd "$ROOT/frontend" && npm run dev -- --port 5173
