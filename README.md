# Prakasa AI Work OS

Full MVP project assembled from the Fase 1–8 implementation specification.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MySQL/MariaDB (`mysql2/promise`)
- Auth: manual email/password -> JWT (primary), Google OAuth optional (secondary)
- AI providers: OpenAI, Gemini, Claude
- Hosting target: GoDaddy shared cPanel / Passenger
- Scheduler: cPanel Cron Jobs (no Redis/queue required)

## Authentication model

Manual login is the primary login flow. Accounts are provisioned and controlled by a Super Admin.

Super Admin can:
- create login accounts,
- assign entity/department/roles,
- enable or disable accounts,
- reset passwords.

Passwords are stored as bcrypt hashes. Google login is optional and never auto-provisions a new user; the account must already exist.

## Local setup

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run setup:local
npm run dev
```

When `NODE_ENV` is not `production`, `npm run setup:local` automatically creates or updates this local Super Admin:

```text
Email    : admin@prakasagroup.com
Password : Prakasa@2026-Admin!7xQ
```

You can override the local defaults with:

```env
BOOTSTRAP_ADMIN_NAME=Super Admin
BOOTSTRAP_ADMIN_EMAIL=your-admin@prakasagroup.com
BOOTSTRAP_ADMIN_PASSWORD=your-strong-password
BOOTSTRAP_ADMIN_ENTITY_ID=1
```

Production never falls back to the local default credential; production bootstrap requires explicit `BOOTSTRAP_ADMIN_*` values.

Backend health check: `GET /api/health`.

### Frontend

```bash
cd ../frontend
cp .env.example .env
npm install
npm run dev
```

Default frontend authentication:

```env
VITE_API_URL=http://localhost:3000/api/v1
VITE_ENABLE_GOOGLE_LOGIN=false
VITE_GOOGLE_CLIENT_ID=
```

Set `VITE_ENABLE_GOOGLE_LOGIN=true` only if Google should also be shown as a secondary login option.

## Database
Run `npm run migrate` in `backend/`. The migration runner executes every `.sql` file in filename order, including `016_manual_primary_auth.sql`.

## Deployment
See `docs/deployment.md`.

## Important
Never commit `.env` files or production credentials. The built-in local credential is development-only and must never be used for production.
