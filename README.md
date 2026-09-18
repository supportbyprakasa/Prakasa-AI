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

## Modules
- Fase 1 — Foundation & Flexible Core
- Fase 2 — Document, Template & AI Core
- Fase 3 — Task, Chat, Approval & Signature
- Fase 4 — Sales & Warehouse MVP
- Fase 5 — IT Governance MVP
- Fase 6 — Calendar, Meet & Meeting AI
- Fase 7 — Finance & HRGA Workflow Layer
- Fase 8 — Advanced Cross-Division & Automation

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
npm run migrate
```

Configure the one-time bootstrap variables in `backend/.env`:

```env
BOOTSTRAP_ADMIN_NAME=Super Admin
BOOTSTRAP_ADMIN_EMAIL=admin@prakasagroup.com
BOOTSTRAP_ADMIN_PASSWORD=replace_with_a_strong_password
BOOTSTRAP_ADMIN_ENTITY_ID=1
```

Then create/update the first Super Admin:

```bash
npm run bootstrap:admin
```

After the bootstrap succeeds, remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env`.

Start the API:

```bash
npm run dev
```

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
Run `npm run migrate` in `backend/`. The migration runner executes every `.sql` file in `backend/migrations/` in filename order, including `016_manual_primary_auth.sql`.

## Deployment
See `docs/deployment.md`.

## Important
Never commit `.env` files or real credentials. Configure database credentials, JWT secret, optional Google credentials, AI API keys, service-account credentials and cPanel paths outside Git.
