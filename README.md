# Prakasa AI Work OS

Full MVP project assembled from the Fase 1–8 implementation specification.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MySQL/MariaDB (`mysql2/promise`)
- Auth: Google OAuth -> JWT
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

## Local setup
```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev

cd ../frontend
cp .env.example .env
npm install
npm run dev
```

Backend health check: `GET /api/health`.

## Database
Run `npm run migrate` in `backend/`. The migration runner executes every `.sql` file in `backend/migrations/` in filename order.

## Deployment
See `docs/deployment.md`.

## Important
This archive is an assembled implementation package based on the supplied project specification/code iterations. Configure Google credentials, database credentials, AI API keys and cPanel paths before production use. Run the QA checklist before go-live.
