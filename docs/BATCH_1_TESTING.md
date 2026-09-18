# Batch 1 — Runtime Verification Checklist

Static source review is not equivalent to runtime verification. Complete this checklist on the local/staging environment before merging/deploying.

## 1. Update and migrate

```bash
cd ~/Downloads/prakasa-work-os
git fetch origin
git checkout feature/sow-gap-completion
git pull

cd backend
npm install
npm run migrate
```

Expected migrations include:
- 017_configuration_engine.sql
- 018_configuration_engine_permissions.sql
- 019_default_configuration_seed.sql
- 020_batch1_hardening.sql

## 2. Database checks

```sql
USE prakasa_work_os;

SELECT COUNT(*) AS new_tables
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'forms','form_fields','form_submissions','form_submission_values',
    'form_submission_attachments','workflow_definitions','workflow_statuses',
    'workflow_transitions','workflow_instances','workflow_instance_history',
    'document_types','signature_rules','dashboard_widgets',
    'dashboard_role_layouts','integration_logs'
  );
```

Expected: **15**.

```sql
SELECT COUNT(*) AS batch1_permissions
FROM permissions
WHERE code IN (
  'entity.cross_access',
  'form.view','form.manage','form.submit',
  'form_submission.view','form_submission.manage','form_submission.transition',
  'workflow_definition.view','workflow_definition.manage',
  'workflow_instance.view','workflow_instance.transition',
  'document_type.view','document_type.manage',
  'signature_rule.view','signature_rule.manage',
  'dashboard_widget.manage','dashboard_layout.manage',
  'integration_log.view'
);
```

Expected: **18**.

Seed checks:
- 15 dashboard widgets;
- 5 document types per active entity;
- one `it-access-request` form per active entity with 4 active fields;
- one `simple-approval` workflow per active entity;
- seeded `simple-approval` has 4 statuses: submitted, under_review, approved, rejected;
- seeded workflow has 3 transitions.

## 3. Backend syntax / start

```bash
cd backend
node --check src/controllers/forms.controller.js
node --check src/controllers/formSubmissions.controller.js
node --check src/controllers/workflows.controller.js
node --check src/services/workflow.service.js
node --check src/services/integrationLog.service.js
npm run dev
```

In another terminal:

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok", ...}`.

## 4. Frontend build

```bash
cd ../frontend
npm install
npm run build
npm run dev
```

The production build must succeed without unresolved imports.

## 5. Form E2E

Login with a Super Admin account.

Verify:
1. `/forms` loads the authenticated user's entity-scoped catalog.
2. Open `IT Access Request`.
3. Save as draft.
4. Upload a file to the attachment field.
5. Navigate away.
6. Open My Submissions and resume the draft.
7. Finalize the **same submission**.
8. Confirm there is only one submission row and attachment remains linked.
9. Final status should be `submitted` when the seeded workflow is assigned.
10. Submission detail shows workflow history.

Submission number format is intentionally unique, for example:
`FRM-1-202609-<random-suffix>`.

## 6. Workflow E2E

For the submitted IT Access Request:
- run `Mulai Review`;
- confirm status becomes `under_review`;
- `Tolak` must require a comment;
- final status must update both workflow instance and form submission.

Direct transition with a user lacking the configured permission must return 403.

## 7. Form Builder

At `/admin/forms`:
- create a form;
- add/reorder/remove fields;
- save;
- edit the form after at least one submission exists;
- confirm historical submission values are still present after a field is removed from the builder.

## 8. Workflow Editor

At `/admin/workflows`:
- create workflow;
- exactly one initial status must be enforced;
- at least one final status required;
- invalid status code must be rejected;
- invalid hex color must be rejected;
- deleting a status/transition already used by workflow history must fail safely.

## 9. Config modules

Verify CRUD/UI for:
- Document Types
- Signature Rules
- Dashboard Layouts
- Integration Logs

Dashboard layout role choices must be limited to roles from the selected entity.

## 10. Integration Logs

Trigger:
- a Google Drive operation;
- Document Assistant / another AI call;
- a meeting Calendar operation if credentials are configured.

Check `/admin/integration-logs`:
- provider;
- operation;
- success/failure;
- entity/user context where caller supplies it;
- sanitized metadata.

Never expect secrets/tokens/private keys in log metadata.

## 11. Security checks

With a normal user from entity A:
- attempt `?entityId=<entity B>` on Batch 1 admin endpoints;
- expect 403;
- attempt direct workflow transition without required permission;
- expect 403;
- confirm own submission detail works;
- confirm another user's submission is not available unless the user has submission-view/manage permission.

## Sign-off condition

Do not mark Batch 1 runtime-verified until:
- all migrations succeed;
- backend starts;
- frontend production build succeeds;
- the form draft/upload/finalize flow succeeds;
- workflow transition flow succeeds;
- entity isolation checks succeed.
