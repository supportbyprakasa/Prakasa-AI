# Batch 1 — Compatibility & Security Notes

## Scope

Batch 1 adds the Configuration Engine foundation:

- Dynamic Forms and Form Submissions
- Generic Workflow Engine
- Document Types
- Signature Rules configuration
- Dashboard Widget/Layout configuration
- Integration Logs

Database migrations: **017–020**.

## Database compatibility

Migrations 017–019 create new tables/seed data. Migration 020 is a forward-compatible hardening migration for environments that may have applied an earlier Batch 1 draft.

Migration 020:
- adds `form_fields.deleted_at` only if missing;
- widens `form_submissions.status` to `VARCHAR(80)`;
- normalizes the seeded `simple-approval` workflow so `submitted` is its initial runtime state.

No legacy production table is dropped or renamed. Existing `documents.document_type` remains unchanged. The new `document_types.code` is a configurable lookup and does not replace legacy values yet.

## Form draft model

A form draft exists before workflow execution. The runtime flow is:

```
draft submission
→ optional Shared Drive attachment upload
→ finalize
→ optional workflow instance created
→ workflow initial status (for seeded workflow: submitted)
```

This avoids orphan submissions and lets required file fields be uploaded before final submission.

## Workflow compatibility

Legacy modules keep their own status logic unless explicitly integrated. The generic workflow engine is currently wired end-to-end to configurable form submissions.

For workflow-backed form submissions, `form_submissions.status` mirrors the workflow instance status.

## Entity isolation

Batch 1 introduces `entity.cross_access`.

New configuration/form/workflow/log endpoints enforce entity scope on the backend. Cross-entity access is explicit and permission-based; `entity.manage` is not treated as global access.

The Batch 1 hardening also scopes selected existing AI/Google call paths:
- Document Assistant
- Meeting AI
- Field Sales Bot
- Knowledge Base
- Daily Brief
- Document Check
- Google Calendar meeting operations

A broader audit of every legacy endpoint remains a separate security-hardening task.

## Integration logging

Existing Google/AI services were instrumented in place with `integrationLog.service.js`. There are no separate `loggedUploadFile`/ `runModuleLogged` APIs.

The logger:
- redacts credential/token/secret-like keys recursively;
- records success/failure and duration;
- supports optional response metadata;
- accepts entity/user/subject context.

Some legacy callers that do not yet pass context can still generate global integration logs. Global logs are visible only to cross-entity administrators.

## File storage

Dynamic form file fields upload to Google Shared Drive through the existing Drive integration. Metadata is persisted to:
- `drive_files_metadata`
- `documents`
- `document_versions`
- `form_submission_attachments`
- `form_submission_values`

Large file blobs are not stored in MySQL.

## Super Admin permissions

Migration 018 adds 18 permissions, including `entity.cross_access`.

Automatic grant targets active roles named:
- `Super Admin`
- `SuperAdmin`
- `Administrator`

If the production role uses another name, grant the new permissions explicitly.

## Rollback policy

There is **no automated destructive rollback migration**.

If Batch 1 must be reverted after data exists, prefer:
1. database backup;
2. code rollback;
3. forward-fix migration.

Do not casually drop Batch 1 tables after users have created forms/submissions/workflows because that would destroy Batch 1 business data.
