# Batch 1 — Integration & Migration Guide

## Branch

`feature/sow-gap-completion`

This branch is based on the current `main` and contains the complete Batch 1 implementation plus hardening performed during integration review.

## Migration order

Run the normal project migration runner from `backend`:

```bash
npm install
npm run migrate
```

Batch 1 migration order:

1. `017_configuration_engine.sql`
2. `018_configuration_engine_permissions.sql`
3. `019_default_configuration_seed.sql`
4. `020_batch1_hardening.sql`

Do not manually edit migrations 001–016.

## Why migration 020 exists

Batch 1 was integrated iteratively. Migration 020 ensures forward compatibility for environments that may have already executed an earlier draft of 017–019.

It safely:
- adds `form_fields.deleted_at` if missing;
- widens configurable form submission status values;
- aligns the seeded workflow initial state.

## Backend modules added

Controllers:
- forms
- form submissions
- workflows
- workflow instances
- document types
- signature rules
- dashboard widgets
- dashboard layouts
- integration logs

Routes:
- `/api/v1/forms`
- `/api/v1/workflows`
- `/api/v1/workflow-instances`
- `/api/v1/document-types`
- `/api/v1/signature-rules`
- `/api/v1/dashboard-widgets`
- `/api/v1/dashboard-layouts`
- `/api/v1/integration-logs`

## Important form endpoints

User catalog:
- `GET /api/v1/forms/catalog`
- `GET /api/v1/forms/catalog/:idOrSlug`

Current user submissions:
- `GET /api/v1/forms/submissions`
- `GET /api/v1/forms/submissions/mine`

Draft lifecycle:
- `POST /api/v1/forms/submit` with `submit=false`
- `PATCH /api/v1/forms/submissions/:id/draft`
- `POST /api/v1/forms/submissions/:id/upload-field`
- `POST /api/v1/forms/submissions/:id/finalize`

Admin list:
- `GET /api/v1/forms/submissions/list`

## Frontend routes added

User:
- `/forms`
- `/forms/:slug`
- `/forms/submissions`
- `/forms/submissions/:id`

Admin:
- `/admin/forms`
- `/admin/forms/new`
- `/admin/forms/:id`
- `/admin/workflows`
- `/admin/workflows/new`
- `/admin/workflows/:id`
- `/admin/document-types`
- `/admin/signature-rules`
- `/admin/dashboard-layouts`
- `/admin/integration-logs`

## Integration logging changes

The following existing services were modified in place:
- Google Drive
- Google Docs
- Google Calendar
- AI provider

Selected existing controllers/services now pass entity/user/subject context into those integrations.

There are no parallel `logged*` wrapper APIs. Existing function names remain the public service API.

## Local verification sequence

Terminal 1:

```bash
cd ~/Downloads/prakasa-work-os
git fetch origin
git checkout feature/sow-gap-completion
git pull

cd backend
npm install
npm run migrate
npm run dev
```

Terminal 2:

```bash
curl http://localhost:3000/api/health
```

Terminal 3:

```bash
cd ~/Downloads/prakasa-work-os/frontend
npm install
npm run build
npm run dev
```

Then execute `docs/BATCH_1_TESTING.md`.

## Merge policy

Do not merge solely because static source checks passed.

Preferred merge gate:
- migrations pass;
- backend health passes;
- frontend build passes;
- form draft/upload/finalize E2E passes;
- workflow transition E2E passes;
- entity isolation smoke tests pass.

The GitHub PR can be opened before runtime verification, but should remain unmerged until the gate above is satisfied.
