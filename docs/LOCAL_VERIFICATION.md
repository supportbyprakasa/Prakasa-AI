# Local Verification Report

Date: 2026-09-18

## Verified

- Root project structure is present.
- Database migrations `001` through `015` are present in order.
- Required cron job entry files are present:
  - `itReminders.js`
  - `automationRunner.js`
  - `overdueTaskScan.js`
  - `briefGenerator.js`
- Static SQL dependency scan found 91 created tables and no migration-order issue for `ALTER TABLE` / foreign-key targets.
- All backend local imports resolve.
- All frontend local imports resolve.
- Every external JS import is declared in the relevant `package.json`.
- All files under `backend/src/**/*.js` pass `node --check`.
- Google OAuth frontend wiring exists through `GoogleOAuthProvider` and `GoogleLogin`.
- Backend Google ID token verification, Workspace-domain restriction, user auto-provisioning, JWT generation, and `/auth/me` are wired.
- Backend `/api/health` route exists and reads `process.env.PORT` for runtime startup.
- Permission-sensitive module navigation is now hidden unless the logged-in user has the corresponding permission; Dashboard remains visible.

## Runtime blockers in the current execution environment

The current container does not have MySQL/MariaDB installed, so migrations and DB-backed endpoints cannot be executed here.

The project contains only `.env.example`; real `.env` files and real Google/database/API credentials are intentionally not fabricated.

`npm install` could not complete in this container because package registry access timed out. Therefore a real Express start, Vite build/dev server, and browser Google OAuth round trip could not be executed here.

## What must be run on the target/local machine

1. Create `backend/.env` and `frontend/.env` from the provided examples using real credentials.
2. Start MySQL/MariaDB and create `prakasa_work_os`.
3. Install backend dependencies and run migrations `001` to `015` in order.
4. Start backend and confirm `GET /api/health`.
5. Install frontend dependencies and run Vite.
6. Confirm Google OAuth origin configuration and perform login.
7. Assign the first user a Super Admin role with all permissions, then log out and back in.
8. Execute the per-phase end-to-end checklist.
