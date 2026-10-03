# Local Verification Report

## 2026-09-24 — Prakasa Workspace organization, Warehouse movements, contextual AI

Scope: `docs/superpowers/specs/2026-09-24-prakasa-workspace-organization-warehouse-ai-design.md`
(plan: `docs/superpowers/plans/2026-09-24-prakasa-workspace-organization-warehouse-ai.md`).
Nothing committed, pushed, or deployed. No Accurate connection exists.

### Commands

```bash
cd backend && npm run migrate          # expect: Applied 35 · Pending 0 · Changed 0 · Missing 0
cd backend && node --test test/        # expect: 115 pass, 0 fail
cd frontend && node --test test/       # expect: 50 pass, 0 fail
cd frontend && npm run build           # expect: built; the >500 kB chunk warning is pre-existing and non-blocking
git diff --check                       # expect: no output
```

Local URLs: backend `http://127.0.0.1:3001` (`/api/health`), frontend `http://127.0.0.1:5173`.

### Database invariants (read-only queries)

| Check | Result |
|---|---|
| Coded divisions for entity 1 | 9 |
| Standard division roles / unique keys | 27 / 27 |
| Super Admin keyed `system.super_admin` | 1 |
| `warehouse.movement.*` permissions | 7 |
| Warehouse matrix | `warehouse_inbound` and `warehouse_outbound` → approver `warehouse.supervisor`, escalation `warehouse.head` |
| Users holding a division role outside their division | 0 |
| Movements with more than one pending approval | 0 |

Migrations 032 and 033 were each run twice (via the ledger and again as raw SQL) with no row-count change.
Migration 032 initially failed on MySQL `only_full_group_by`; the aggregate was fixed before it was recorded in the ledger.

### Role seed and customization

- Migration 032 seeds nine divisions and Member/Supervisor/Head templates per division. Existing users keep their roles; nobody is auto-assigned a division role.
- Super Admin edits a role in **Administrasi → Roles**, reviews the added/removed permission diff, and confirms. **Reset** restores one standard role to its seeded defaults.
- Users receive only roles from their own division (Super Admin is the single global role). The API rejects a mismatched role even if the form is bypassed.

### Warehouse approval behaviour

- Member creates a draft → submits → one approval request for `warehouse.supervisor`.
- Supervisor approves, requests revision (note required), or rejects (note required) from the movement page or `/approvals/:id`. The creator/submitter can never decide their own movement, even with Supervisor or Head permissions. A decision needs both `approval.decide` and `warehouse.movement.approve` plus the Warehouse division.
- Warehouse Head is the escalation role, not an automatic second approver; Head can cancel an approved movement with a reason.
- Pending, approved, rejected, and cancelled movements are immutable; stale edits return `409 VERSION_CONFLICT`.
- Submitting without a Warehouse matrix is refused (`APPROVAL_MATRIX_MISSING`) instead of creating an unassigned approval.
- The generic `POST /approvals` refuses Warehouse subject types, so approvals can only come from the movement flow.
- Approved movements stay in Prakasa Workspace. The UI states that Accurate integration is not active; no sync is claimed.

### End-to-end evidence (controlled local `[UJI]` accounts, password shared out of band)

- API scenario, 30/30: cross-division role assignment rejected; client-supplied entity rejected; draft → submit → idempotent resubmit; member/Head cannot decide; Supervisor self-approval → `403 SELF_APPROVAL_FORBIDDEN`; Action Inbox shows only decidable approvals; revision → edit → resubmit → approve → Head cancel; audit trail; Supervisor notification.
- AI tool API, 11/11: permission-filtered tool list; allow-listed query keys; a Procurement reader cannot pull a Warehouse draft into AI context; admin tool context refused for a Member; unknown tool refused; context attaches only to the caller's own session (Super Admin included).
- Browser (desktop 1440, tablet 1024, mobile 390): login (Google hidden when unconfigured, error focus, preserved email, return-path protection, “Akses belum disiapkan” for an account without a division role); Warehouse list, guided form, validation summary, one-item-per-card on mobile, unsaved-changes guard, Supervisor decision, Head cancel and audit; contextual AI panel on Documents, Tasks, Sales, Warehouse, Finance, People & Culture, IT, Management, Knowledge Base, Admin and approval detail. A live Claude Team answer used the movement's real data, said Accurate is not active, and did not claim it can approve.

### AI conversations: division chats, history management, message edits

- Division chat: any member of that division with `ai_command.use` can read and continue it; user messages show the author. Only the owner renames, edits details, archives, or deletes. Private and cross-division chats stay owner-written.
- Only AI administrators (Super Admin) can open a chat for a division other than their own; users without a division can no longer name one.
- History menu per conversation: pin (personal, shown in "Disematkan"), rename, edit details, delete.
- Editing your own message hides it and every later message (migration 034 soft-delete, kept for audit), expires pending AI proposals from the discarded answers, and answers the edited text again. Verified with Claude Team.
- Division members only receive AI answers when the chosen engine allows them: Claude Team follows the division allowlist in **AI Provider Settings**.

### Menus per division and role (migration 035)

- Home cards follow the organization: AI Workspace, Kerja Harian, Sales & Customer, Warehouse, Operations & IT, Finance, People & Culture, Insight & Manajemen, Pengetahuan & Kebijakan, Administrasi. A card appears only when the user can open at least one module in it; a card with one module opens that module directly.
- No standard division role sees Administrasi. Approval delegation lives in Kerja Harian (Supervisor and above), Workflow Builder in Operations & IT (Operations Head), Activity Log in Insight & Manajemen (Management Office Head).
- Trimmed from standard roles (catalog + migration 035): data classification for Members/Supervisors, approval matrix for Heads, customer workspaces outside Sales/Retail/Marketing, automation outside Operations Supervisor/Head, Warehouse sample queue for Procurement/Retail, quotations for Marketing.
- Verification: `frontend/test/navigationRoles.test.js` checks the cards for every standard role against the backend catalog; all 27 roles in the DB match the catalog.

### Known local notes

- The DB pool reads timestamps as UTC (`timezone: 'Z'`) while this machine's MySQL `NOW()` returns WIB. Values written with `NOW()` (approval steps, notifications, messages) therefore show seven hours ahead locally. Warehouse movement timestamps are written by the application and display correctly. Confirm the production MySQL time zone before deploying.
- Pre-existing bug fixed: approval detail (`GET /approvals/:id`) failed for every approval because the SQL used the reserved alias `dec`.

---

## 2026-09-18 — Historical report


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
