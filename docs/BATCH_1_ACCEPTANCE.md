# Batch 1 — Acceptance & Traceability

## Scope

Batch 1 implements the configurable foundation requested for:
1. Dynamic Request Form Builder
2. Form Submissions
3. Generic Workflow Engine
4. Document Types
5. Signature Rules configuration
6. Dashboard Configuration foundation
7. Integration Logs

This document records implementation status. It does **not** claim runtime verification.

## Status legend

- ✅ Implemented in branch
- 🧪 Runtime verification required
- ⏭ Deferred by Batch 1 scope

## Traceability

| Requirement | Status | Main implementation |
|---|---|---|
| Dynamic form schema | ✅ | migrations 017/020 |
| Form Builder admin UI | ✅ | `frontend/src/pages/admin/FormBuilder.jsx` |
| User form catalog | ✅ | `FormCatalog.jsx`, `GET /forms/catalog` |
| Dynamic renderer | ✅ | `FormRenderer.jsx` |
| Save/resume draft | ✅ | form submissions controller + renderer |
| Finalize same draft | ✅ | `POST /forms/submissions/:id/finalize` |
| Shared Drive file field | ✅ | `formFileUpload.service.js` |
| Historical field preservation | ✅ | soft-delete form field definitions |
| My Submissions | ✅ | `GET /forms/submissions/mine` |
| Submission detail | ✅ | `SubmissionDetail.jsx` |
| Workflow definitions/statuses/transitions | ✅ | migration 017 + workflows controller |
| Workflow instances/history | ✅ | workflow service/controller |
| Permission-based transitions | ✅ | workflow service |
| Approval/signature transition guards | ✅ | database-derived workflow guards |
| Workflow admin UI | ✅ | WorkflowDefinitions/WorkflowEditor |
| Document Types CRUD/UI | ✅ | documentTypes controller/page |
| Signature Rules CRUD/UI | ✅ | signatureRules controller/page |
| Signature-rule enforcement in legacy signing flow | ⏭ | later signature batch |
| Dashboard widget catalog | ✅ | dashboardWidgets controller |
| Role layout config | ✅ | dashboardLayouts controller/page |
| Final dashboard widget renderers | ⏭ | later dashboard batch |
| Integration log table/service | ✅ | migration 017 + integrationLog service |
| Recursive secret sanitizer | ✅ | integrationLog service |
| Google Drive logging | ✅ | existing service instrumented |
| Google Docs logging | ✅ | existing service instrumented |
| Google Calendar logging | ✅ | existing service instrumented |
| AI provider logging | ✅ | existing provider instrumented |
| Entity-scoped Integration Log UI | ✅ | controller/page |
| Backend permission enforcement | ✅ | Batch 1 routes |
| Explicit cross-entity permission | ✅ | `entity.cross_access` |
| Frontend route/sidebar wiring | ✅ | App.jsx + Sidebar.jsx |
| Runtime migrations | 🧪 | must run locally/staging |
| Frontend production build | 🧪 | must run locally/staging |
| Browser E2E | 🧪 | checklist required |

## Deliverables currently in branch

### Database

4 migrations:
- 017_configuration_engine.sql
- 018_configuration_engine_permissions.sql
- 019_default_configuration_seed.sql
- 020_batch1_hardening.sql

15 new Batch 1 tables.

18 Batch 1 permissions including `entity.cross_access`.

### Backend

New:
- 9 controllers
- 8 route modules
- entity scope middleware
- workflow service
- form file upload service
- integration log service

Modified:
- routes index
- Google Drive service
- Google Docs service
- Google Calendar service
- AI provider
- selected AI/meeting/KB/brief/field-sales/document-check callers for integration context/security

### Frontend

12 new pages plus:
- App route wiring
- Sidebar navigation wiring

## Important deviations from the original DeepSeek Part 4 draft

The integration branch intentionally differs from the generated draft:

- Batch 1 is migrations **017–020**, not 017–019.
- There are **18** new permissions, not 17.
- Seeded `simple-approval` has **4 workflow statuses**; draft exists before workflow start.
- Form submission numbers use a collision-resistant random suffix instead of count-based sequencing.
- Integration logging is integrated into existing service functions; no `logged*` parallel API.
- Batch 1 is not described as purely additive at code level because existing integration/AI caller code was security-hardened.
- No destructive rollback is recommended after Batch 1 contains business data.
- Static source review is complete; runtime verification remains pending.

## Acceptance gate

Batch 1 can be considered accepted for merge only when all of the following are confirmed:

- [ ] `npm run migrate` succeeds on the target database
- [ ] backend starts and `/api/health` returns OK
- [ ] frontend `npm run build` succeeds
- [ ] form draft → upload → resume → finalize uses one submission
- [ ] workflow transitions update form submission status
- [ ] required-comment transition rejects an empty comment
- [ ] unauthorized cross-entity request returns 403
- [ ] unauthorized workflow transition returns 403
- [ ] Integration Logs redact sensitive fields
- [ ] no regression observed in manual-login flow

Until those boxes are checked, status is:

**Implementation complete in branch; runtime acceptance pending.**
