# Prakasa Workspace Organization, Warehouse, AI, and Visual System Design

Date: 2026-09-24

Status: Implemented locally; pending deployment

Extends:

- `docs/superpowers/specs/2026-09-23-prakasa-ai-workspace-governance-platform-design.md`
- `docs/superpowers/specs/2026-09-23-ai-file-generation-processing-design.md`

## 1. Summary

Prakasa Work OS becomes **Prakasa Workspace**, an internal operating workspace
for nine divisions. Each division has Member, Supervisor, and Head roles. The
role hierarchy controls which tools people can see, which records they can
operate, and which decisions they may make.

The Warehouse module gains a friendly inbound and outbound movement workflow.
Warehouse Members prepare and submit movements, Warehouse Supervisors review
them, and Warehouse Heads oversee exceptions and escalations. Approved records
remain in Prakasa Workspace. Accurate integration is explicitly deferred and
must not be simulated.

Prakasa AI is an assistance layer across every tool, not an isolated chat page.
It may read permitted context, explain, analyze, extract, reconcile, and prepare
drafts. It cannot acquire permissions the user does not have, and consequential
actions always follow the same validation, confirmation, approval, and audit
boundaries as a human action.

The entire frontend uses one Google Workspace-inspired light Material 3 design
system with centralized color, shape, interaction, typography, spacing, and
elevation tokens. Prakasa branding remains distinct; Google logos, product
icons, and names are not copied.

## 2. Confirmed Product Decisions

1. The organization has these nine divisions:
   - Operations
   - Finance
   - Procurement
   - Sales
   - People & Culture
   - Management Office
   - Retail Commerce
   - Warehouse
   - Marketing
2. Every division has exactly three standard role templates: Member,
   Supervisor, and Head, for 27 seeded roles in total.
3. Super Admin remains a separate system role with no division.
4. Standard role permissions are seeded defaults and remain editable by an
   authorized Super Admin.
5. A role is structurally associated with a division; its name alone is not
   treated as its security scope.
6. Supervisor is the normal approval tier for Warehouse inbound and outbound
   movements.
7. The creator of a Warehouse movement cannot approve that movement.
8. Head acts as monitor, exception owner, and configured escalation target; it
   is not an automatic second approval for every movement.
9. Accurate integration is outside this delivery. No HTTP call, fake sync,
   placeholder success, or Accurate-specific credential is introduced.
10. Every user-facing tool must expose useful Prakasa AI assistance.
11. AI never signs, approves, publishes, deletes, changes authorization, or
    performs an external write without the required human confirmation or
    approval.
12. User-facing branding changes to Prakasa Workspace. Existing package names,
    repository paths, environment names, storage identifiers, and production
    domains remain unchanged unless a later deployment migration changes them.
13. The visual baseline is Google Workspace light Material 3 across desktop,
    tablet, and mobile.

## 3. Current-System Baseline

The local database currently contains one entity (`Prakasa Group`), no active
departments, one `Super Admin` role, and 149 permissions. The repository already
contains:

- entity, department, user, role, permission, and user-role tables;
- permission-protected routes and permission-filtered navigation;
- an approval matrix and approval engine with user, role, delegation,
  reminder, and escalation support;
- an AI Command Center with private, department, and entity visibility;
- AI action proposals and an Action Inbox;
- `warehouse_inbound` and `warehouse_outbound` tables without operational
  controllers, routes, approval state, or frontend tabs;
- Warehouse Sample Queue, Delivery Proof, Checklist, and Incident tools; and
- existing uncommitted AI, upload, streaming, and inbox work that must be
  preserved.

The implementation extends these systems instead of creating parallel identity,
approval, notification, or AI databases.

## 4. Scope

### 4.1 Included

- organization and role data model extensions;
- idempotent seeding of nine divisions and 27 standard roles;
- permission defaults for all standard roles;
- department-safe role assignment and management;
- a customizable role-permission administration interface;
- Warehouse inbound and outbound movement APIs, UI, state transitions,
  approval lifecycle, notification, and audit;
- Prakasa AI tool registration and contextual entry points for every visible
  application tool;
- risk-based AI proposal and confirmation rules;
- Prakasa Workspace user-facing rebrand;
- a responsive Prakasa Workspace login experience using the same design
  system; and
- a centralized Google Workspace-inspired design-token and component system.

### 4.2 Excluded

- Accurate API authentication, master-data import, transaction posting, or
  synchronization;
- replacement of Accurate as the accounting or inventory system of record;
- a complete new inventory valuation, costing, or accounting engine;
- automatic approval or signature by AI;
- Google branding, logos, proprietary product icons, or misleading claims that
  Prakasa Workspace is a Google product;
- package, domain, directory, cron, local-storage key, or deployment-root
  renaming; and
- dark mode in this delivery.

## 5. Organizational and Role Model

### 5.1 Department identity

`departments` gains a stable, entity-scoped `code`. The seed uses:

| Code | Display name |
|---|---|
| `operations` | Operations |
| `finance` | Finance |
| `procurement` | Procurement |
| `sales` | Sales |
| `people_culture` | People & Culture |
| `management_office` | Management Office |
| `retail_commerce` | Retail Commerce |
| `warehouse` | Warehouse |
| `marketing` | Marketing |

The pair `(entity_id, code)` is unique. Display names may later change without
breaking policy references.

### 5.2 Role identity

`roles` gains:

- `role_key`: stable entity-unique key such as `warehouse.supervisor`;
- `department_id`: nullable foreign key; null only for system/global roles;
- `role_level`: `member`, `supervisor`, `head`, `admin`, or `custom`; and
- `is_system_template`: identifies the 27 managed defaults and Super Admin.

Seeded role names use human-readable order: `Warehouse Member`, `Warehouse
Supervisor`, and `Warehouse Head`. The stable keys, not display names, drive
seed idempotency and policies.

### 5.3 Assignment invariants

- A standard division role may be assigned only to an active user in the same
  entity and department.
- A global role may be assigned only when its policy explicitly allows a null
  department.
- Changing a user's department must reject incompatible existing roles unless
  the request also supplies a valid replacement role set in the same
  transaction.
- Role IDs sent by clients are always reloaded and validated server-side.
- Multiple roles are allowed only when all non-global roles belong to the
  user's department.
- Super Admin is exempt from division matching but is never granted implicitly.
- Soft-deleted departments or roles cannot be assigned.

### 5.4 Role hierarchy semantics

Hierarchy is expressed through complete seeded permission sets, not hidden
runtime inheritance. This keeps the existing `role_permissions` authorization
path authoritative and lets Super Admin customize an individual role.

- Member: performs operational work and submits requests.
- Supervisor: includes the Member defaults, manages team work, and makes the
  division's routine approvals.
- Head: includes Supervisor defaults, owns standards and exceptions, sees
  division reporting, and receives configured escalations.

The administration UI warns when a customization removes a lower-tier
permission from a higher-tier role, but it permits the authorized change.

## 6. Common Tool Access

All access remains bounded to the user's entity, department, record ownership,
explicit collaboration space, and existing domain validation.

### 6.1 Member baseline

- notifications;
- document view, create, and update;
- template view;
- task view, create, update, watch, checklist, and activity history;
- chat view and send;
- approval view and request;
- signature view, request, assigned signing, and personal signature asset;
- meeting view, create, update, recording attachment, and AI summary;
- forms, own submissions, and permitted workflow instances;
- document type view;
- global search filtered by domain permission;
- Knowledge Base view and query;
- customer or project workspaces explicitly shared with the user; and
- Prakasa AI personal and department assistance, context attachment, and action
  proposal.

### 6.2 Supervisor additions

- operational board and team task management;
- routine approval decisions for the division;
- workflow transition where the division owns the workflow;
- AI action confirmation within the Supervisor's existing write permissions;
- division timeline and decision-log view;
- configured cross-division collaboration spaces; and
- team-level exception and pending-work summaries.

### 6.3 Head additions

- division standards, templates, and playbook management within department
  scope;
- division AI Brief and performance summary;
- division-wide audit and exception visibility without exposure of private AI
  conversation content;
- approval escalation and cancellation authority configured for the division;
- cross-division handoff oversight; and
- department-level Knowledge Base and data-classification management.

## 7. Division Tool Matrix

The following access is added to the common tier baseline.

| Division | Member | Supervisor additions | Head additions |
|---|---|---|---|
| Operations | Tasks, forms, workspaces, operational documents | Board management, workflow transitions, operational approval | Standards, automation oversight, division reporting |
| Finance | Payment/reimbursement request, finance workflow, document check | Finance approval and payment processing | Finance exceptions, standards, and reporting |
| Procurement | Procurement forms, documents, tasks, finance request, Warehouse read | Procurement approval and request monitoring | Procurement standards, Decision Log, escalations |
| Sales | Customers, inquiries, pipeline, visits, samples, quotations, Field Sales Bot | Sample approval and pipeline oversight | Sales brief, standards, and workspace oversight |
| People & Culture | Onboarding, offboarding, HR documents and tasks | HR workflow approval and completion | Checklist-template and HR standard management |
| Management Office | Cross-division workspace, meetings, timeline, briefs, Decision Log | Cross-division review and management reporting | Management Dashboard, executive oversight, escalations |
| Retail Commerce | Customers, retail pipeline, quotations, sample request, Warehouse read | Retail review and approval | Retail performance brief and standards |
| Warehouse | Movements, sample queue, delivery proof, checklist, incidents | Movement approval and team operations | Exceptions, cancellation, standards, reports |
| Marketing | Documents, campaign tasks, meetings, Knowledge Base, customer read | Campaign review and content coordination | Template, Knowledge Base, campaign standards, brief |

No role receives `entity.cross_access`, identity administration, permission
administration, provider configuration, or system integration configuration as
part of a division template.

## 8. Role Administration Experience

The Roles page becomes a management surface rather than a read-only table.

- Filters: entity, division, level, standard/custom, and text search.
- Each row shows role name, division, level, permission count, users, and last
  update.
- Detail opens a right-side panel grouped by product tool rather than a flat
  list of 149 codes.
- Each tool group shows View, Create, Update, Manage, Approve, and Admin
  capabilities when those permissions exist.
- A comparison view displays Member, Supervisor, and Head side by side.
- Reset restores only that standard role to its seeded defaults after explicit
  confirmation.
- Saving shows added and removed permissions before confirmation.
- User assignment filters roles by the selected user's entity and division.
- Attempts to assign a mismatched role show an actionable validation message.

Permission descriptions and codes remain visible in an advanced disclosure for
administrators who need exact policy inspection.

## 9. Warehouse Movement Domain

### 9.1 Existing-table extension

`warehouse_inbound` and `warehouse_outbound` remain the domain tables. Each is
extended with equivalent workflow fields:

- `status`: `draft`, `pending_approval`, `revision_requested`, `approved`,
  `rejected`, or `cancelled`;
- `created_by`, `submitted_by`, `submitted_at`;
- `approval_request_id`;
- `approved_by`, `approved_at`;
- `rejected_by`, `rejected_at`, `decision_note`;
- `cancelled_by`, `cancelled_at`, `cancellation_reason`; and
- `version` for optimistic concurrency.

Existing `received_by` and `released_by` values are preserved for backward
compatibility and included in the migration backfill where reliable.

Items remain JSON in this delivery to preserve the existing schema, but every
item is validated to a stable shape:

```json
{
  "sku": "string-or-null",
  "product": "required string",
  "quantity": 1,
  "unit": "required string",
  "batchNo": "string-or-null",
  "expiresOn": "YYYY-MM-DD-or-null",
  "location": "string-or-null",
  "note": "string-or-null"
}
```

Quantity must be finite and greater than zero. A movement requires at least one
item. Empty product or unit values are rejected. Duplicate SKU rows are allowed
only when batch or location differs.

### 9.2 Movement lifecycle

```text
draft
  -> pending_approval
       -> approved
       -> revision_requested -> draft
       -> rejected
approved -> cancelled (Head with reason only)
```

- Only draft and revision-requested records may be edited.
- Submit validates the whole record and creates the approval request in one
  database transaction.
- Repeat submit is idempotent and cannot create duplicate approval requests.
- Pending, approved, rejected, and cancelled records are immutable through the
  standard edit endpoint.
- Cancellation appends audit history and never deletes the record.
- Concurrent decisions use row locks and return conflict for stale state.

### 9.3 Approval integration

The existing Approval Engine is authoritative.

- Inbound uses request type `warehouse_inbound` and subject type
  `warehouse_inbound`.
- Outbound uses request type `warehouse_outbound` and subject type
  `warehouse_outbound`.
- The default matrix assigns one active step to the `warehouse.supervisor`
  role.
- A routine movement decision requires both the generic `approval.decide`
  permission and the Warehouse-specific `warehouse.movement.approve`
  permission; neither permission alone is sufficient.
- Warehouse Head is the default escalation role, not a required second step.
- The movement creator cannot decide its linked approval even if the creator
  also has Supervisor or Head permissions.
- A domain lifecycle handler synchronizes final approval decisions back to the
  movement in the same controlled flow.
- Approval notification appears in Notification Center and Action Inbox.
- Revision and rejection require a note.

### 9.4 Warehouse permissions

New explicit permissions are introduced:

- `warehouse.movement.view`
- `warehouse.movement.create`
- `warehouse.movement.update`
- `warehouse.movement.submit`
- `warehouse.movement.approve`
- `warehouse.movement.cancel`
- `warehouse.movement.audit.view`

Legacy inbound/outbound permissions remain for compatibility but do not bypass
the movement state machine.

### 9.5 Warehouse UI

The existing Warehouse page gains:

- Barang Masuk;
- Barang Keluar;
- Approval Supervisor;
- Riwayat Transaksi;
- existing Sample Queue, Delivery Proof, Checklist, and Incidents.

The create/edit experience is a responsive guided form:

1. transaction type, date, reference, supplier or destination;
2. editable item rows with SKU, product, quantity, unit, batch, expiry,
   location, and note;
3. notes, attachment context, validation summary, and submission preview.

Desktop uses a dense but readable table. Mobile uses one item card at a time
with persistent Add Item and Save Draft controls. The status header always
shows who submitted, who must act next, and why editing is or is not available.

### 9.6 Accurate boundary

Approved movements end at `approved`. The UI states that Accurate integration
is not active; it never says a record was synchronized. The model preserves the
validated information required for a later mapping, but introduces no Accurate
status, credential, endpoint, or transaction identifier in this delivery.

## 10. Prakasa AI Across Every Tool

### 10.1 Product behavior

Every navigable tool exposes **Bantu dengan Prakasa AI**. The assistant opens
in the existing resizable right panel and receives a permission-filtered context
descriptor for the current page, selected record, visible filters, and selected
rows. On mobile it opens full-screen.

Every registered tool provides at least:

- explain the current page or record;
- summarize permitted visible data;
- identify missing or inconsistent fields;
- answer questions with source references; and
- prepare a draft or next-step recommendation appropriate to that module.

Tools with safe, implemented domain commands may additionally expose proposed
actions. Lack of an executor is displayed honestly as a draft/recommendation,
never as an executed action.

### 10.2 AI Tool Registry

A central registry describes each application tool:

- stable tool key and route patterns;
- context provider;
- read permissions;
- available prompts and read operations;
- proposed action schemas;
- executor identifier when implemented;
- required permission for each action;
- risk tier;
- confirmation tier; and
- audit event names.

A registry-coverage test fails when a permission-visible navigation tool has no
AI descriptor. This prevents newly added tools from silently lacking AI
assistance.

### 10.3 Risk tiers

| Tier | Examples | Behavior |
|---|---|---|
| Read | Explain, search, summarize, compare | Runs within current read permission |
| Draft | Draft document, task, form, movement | Produces preview; user chooses whether to save/submit |
| Confirmed write | Update task, create record, send notification | Exact action preview and explicit confirmation |
| Controlled decision | Approve, reject, sign, cancel, publish | AI recommends only; authorized human performs decision |
| System administration | Roles, permissions, providers, integrations | AI explains and drafts changes; Super Admin explicitly confirms |

### 10.4 Role-aware assistance

- Member AI focuses on creation, extraction, completion, and permitted work.
- Supervisor AI adds validation, discrepancy analysis, queue summary, and
  decision recommendations but never decides.
- Head AI adds trends, risks, exceptions, standards, and division reporting.
- Super Admin AI may explain configuration and prepare a change preview but
  cannot silently alter authorization or credentials.

### 10.5 Warehouse AI

Warehouse AI can:

- extract proposed movement lines from an authorized image, invoice, packing
  list, spreadsheet, or scanned PDF;
- populate a new draft only after showing extracted values;
- compare entered lines with source documents;
- flag quantity, unit, duplicate SKU, missing batch, expiry, or reference
  discrepancies;
- summarize a pending movement for the Supervisor;
- recommend approve, revision, or rejection with evidence; and
- analyze approved movement history within the user's scope.

It cannot approve the movement, bypass separation of duties, or claim Accurate
sync occurred.

## 11. Visual Design System

### 11.1 Design direction

The UI follows Google Workspace light Material 3 interaction grammar:

- white and pale-neutral surfaces;
- blue primary actions;
- restrained dividers and elevation;
- pill-shaped action buttons and search fields;
- compact, icon-supported navigation;
- contextual side panels;
- short sentence-case labels; and
- state layers for hover, focus, pressed, selected, and disabled states.

The implementation uses shared CSS tokens and Prakasa components rather than
copying Google assets.

### 11.2 Color tokens

| Token | Value |
|---|---|
| `--pw-primary` | `#0B57D0` |
| `--pw-on-primary` | `#FFFFFF` |
| `--pw-primary-container` | `#D3E3FD` |
| `--pw-on-primary-container` | `#041E49` |
| `--pw-background` | `#F8FAFD` |
| `--pw-surface` | `#FFFFFF` |
| `--pw-surface-container` | `#F0F4F9` |
| `--pw-on-surface` | `#1F1F1F` |
| `--pw-on-surface-variant` | `#444746` |
| `--pw-outline` | `#747775` |
| `--pw-outline-variant` | `#C4C7C5` |
| `--pw-error` | `#B3261E` |
| `--pw-error-container` | `#F9DEDC` |
| `--pw-success` | `#146C2E` |
| `--pw-warning` | `#B06000` |

No feature component introduces a raw brand or surface color when an
appropriate token exists.

### 11.3 Shape tokens

| Token | Value | Use |
|---|---:|---|
| `--pw-radius-none` | `0` | tables and joined edges |
| `--pw-radius-xs` | `4px` | checkbox, tooltip |
| `--pw-radius-sm` | `8px` | fields and menus |
| `--pw-radius-md` | `12px` | cards, tables, panels |
| `--pw-radius-lg` | `16px` | large surfaces |
| `--pw-radius-xl` | `28px` | dialogs |
| `--pw-radius-full` | `999px` | buttons, chips, search |

Feature CSS cannot add arbitrary radii outside this scale without a documented
design-system exception.

### 11.4 Interaction states

- Hover uses a semantic state layer without changing layout dimensions.
- Pressed uses a pointer-origin ripple and a stronger state layer.
- Keyboard focus uses a visible 2px primary focus ring with 2px offset.
- Selected navigation uses the primary container and on-container text.
- Disabled components have no hover/ripple and expose disabled semantics.
- Buttons do not scale, jump, or change dimensions between states.
- Loading indicators preserve the original control width.
- Standard state transitions use 100–200ms emphasized or standard easing.
- Reduced-motion preference disables nonessential movement and shortens state
  transitions.

### 11.5 Layout

- desktop top app bar: 64px;
- desktop navigation drawer: 256px, collapsible to a 72px rail;
- mobile top app bar: 56px;
- desktop AI panel: 400px default, resizable from 320px to 576px;
- tablet navigation and AI use overlay drawers; and
- mobile AI and document views use full-screen panes.

Main content uses the available viewport instead of an arbitrary narrow page.
Data-heavy tools use responsive tables on desktop and structured cards on
mobile.

### 11.6 Typography and iconography

- Roboto with system sans-serif fallback;
- 24px medium page title;
- 16–18px medium section title;
- 14px body and control labels;
- 12px supporting text;
- icon sizes restricted to 18px, 20px, or 24px for normal controls; and
- sentence-case action labels beginning with clear verbs.

### 11.7 Component convergence

Existing one-off inline controls are migrated toward shared Button, IconButton,
TextField, Select, Tabs, Card, DataTable, StatusChip, Dialog, Drawer, EmptyState,
and LoadingState components. A page may be migrated incrementally, but all new
or changed surfaces in this delivery use the shared tokens and state behavior.

## 12. Login Experience

### 12.1 Authentication behavior

The existing Google Workspace and manual email/password authentication methods
remain supported.

- When Google login is configured, **Masuk dengan Google Workspace** is the
  primary action and manual login is the clearly separated fallback.
- When Google login is not configured, the manual form becomes the primary
  action without leaving an empty separator or disabled Google control.
- Division, role, and permission are never selected or trusted from the login
  screen; they are loaded from the authenticated server-side user record.
- Successful login returns to a validated same-origin destination when one was
  requested, otherwise to the permission-filtered home dashboard.
- External, protocol-relative, malformed, and login-loop return destinations
  are rejected and fall back to `/`.
- Invalid credentials continue to use one generic error and do not disclose
  whether an email exists.
- Inactive, unprovisioned, and Google-account-mismatch states retain their
  distinct actionable messages.
- Repeated submission is disabled while authentication is pending.
- Password managers remain supported through correct `autocomplete`, labels,
  and native input semantics.
- The current backend rate limit remains enforced for both login methods.

The delivery does not replace the established token/session transport. A
separate authentication-hardening project may migrate browser storage to an
HttpOnly cookie after deployment-domain and SameSite behavior are planned.

### 12.2 Visual layout

Desktop uses a centered 28px-radius surface on the pale app background. At
large widths it has two balanced regions:

- left: Prakasa mark, `Prakasa Workspace`, and a short internal-workspace
  description; and
- right: Google Workspace action, separator when applicable, email/password
  fields, error state, and manual submit.

The surface uses restrained elevation and no decorative crate illustration.
On mobile the surface becomes a full-width, nearly flat layout with 24px page
padding, a single column, and touch targets of at least 44px. The login page
uses the same color, shape, focus, hover, pressed, disabled, and loading tokens
as the authenticated workspace.

### 12.3 Login completion states

- A successfully authenticated user with valid division roles enters the
  permission-filtered workspace.
- Super Admin enters the global home dashboard.
- A user who is authenticated but has no usable role sees a controlled
  `Akses belum disiapkan` state with logout and administrator-contact actions,
  not an empty or unrestricted dashboard.
- Authentication errors remain on the form, preserve the entered email, never
  echo the password into errors or logs, and move focus to the error summary
  without exposing sensitive details.
- Loading text and progress remain truthful; a failed request restores the
  enabled form.

## 13. Branding Migration

User-visible references become `Prakasa Workspace`, including:

- page title, login, navbar, AI return labels, and module descriptions;
- generated signed-PDF headers and explanatory copy;
- backend startup display text;
- README product heading and current product documentation; and
- accessibility labels.

Historical migration comments, old deployment paths, package names, domains,
cron environment files, and persisted local-storage keys remain unchanged.
Existing Shared Drive folder IDs remain authoritative even if their historical
folder display names contain the old product name.

## 14. Security and Audit

- Entity and department scope is resolved server-side.
- Private AI conversations remain owner-only.
- Role management requires `role.manage`; permission-catalog mutation continues
  to require `permission.manage`.
- Warehouse movement read/write queries always include entity and department
  scope unless a separately authorized cross-division collaboration grants the
  record.
- Approval step resolution, role-recipient notification, and decision checks
  enforce the movement's department in addition to entity and role ID.
- AI context providers return structured, minimum-necessary data and never raw
  credentials, password hashes, tokens, or private conversations.
- Every role change, permission change, movement transition, approval decision,
  cancellation, AI proposal, confirmed AI action, and failed authorization is
  audited.
- Audit metadata records identifiers and change summaries without duplicating
  sensitive document content.
- Login never derives role or division from client input, URL parameters, or
  Google profile claims beyond the established account-matching flow.

## 15. Error and Recovery Behavior

- Invalid division-role assignment returns a validation error naming the
  expected division.
- Stale movement edits and concurrent decisions return conflict without partial
  updates.
- Approval notification failure does not roll back an already committed state;
  it is logged and retryable.
- AI extraction failure leaves the manual movement form usable.
- AI recommendations clearly separate missing evidence from actual mismatch.
- Page-level loading errors show retry controls and never masquerade as an empty
  state.
- Long AI work shows truthful stage/loading state and retains the existing stop
  control.
- Login failure preserves a usable form, displays an actionable error, and
  never redirects into a partially authenticated workspace.

## 16. Migration and Compatibility

All schema and seed changes are additive and idempotent.

1. Add department code and role metadata columns and indexes.
2. Backfill Super Admin with a stable system key and admin level.
3. Seed nine divisions for the default Prakasa Group entity if absent.
4. Seed 27 role templates by stable key.
5. Seed new Warehouse movement permissions.
6. Grant full new permissions to active Super Admin roles.
7. Seed role-permission defaults without deleting later administrator
   customization on migration rerun.
8. Extend Warehouse movement tables and backfill historical rows safely.
9. Seed Warehouse approval matrix rules only when an equivalent active rule is
   absent.

Existing users retain their roles. The migration does not automatically assign
division roles to existing users because the current database has no active
department data from which to infer intent.

## 17. Testing Strategy

### 17.1 Unit

- division and role catalog contains exactly nine divisions and 27 standard
  roles with stable unique keys;
- permission hierarchy defaults are correct;
- role assignment rejects cross-division, cross-entity, deleted, and stale
  roles;
- movement item validation and state transitions;
- self-approval prohibition;
- AI registry permission and risk resolution;
- AI navigation coverage;
- design-token and branding-copy helpers; and
- safe same-origin login return-path resolution and invalid-return fallback.

### 17.2 Integration

- migration applies twice without duplicates or permission loss;
- user create/update validates department-role compatibility transactionally;
- movement submit creates one approval and one active Supervisor step;
- approve, revision, reject, escalation, and cancellation synchronize the
  movement exactly once;
- Action Inbox shows Warehouse approvals only to authorized users;
- AI context cannot read data excluded by domain permission;
- confirmed AI writes reuse the normal domain service and validation; and
- manual and Google login resolve entity, department, roles, and permissions
  from server-side records only.

### 17.3 End to end
- Super Admin creates a Warehouse Member, Supervisor, and Head assignment;
- Member creates and submits inbound and outbound movements;
- creator cannot approve the own movement;
- Supervisor requests revision and later approves the corrected movement;
- Head sees the exception/report and can cancel with a reason;
- Prakasa AI extracts a document into a draft but cannot approve it;
- every visible tool opens contextual AI help;
- manual login, configured Google login, disabled Google login, invalid
  credentials, inactive user, pending submission, and role-not-ready states;
- desktop, tablet, and mobile Warehouse flows remain usable; and
- visual states, keyboard focus, dialog focus trap, Escape, loading, empty,
  error, and reduced motion are verified.

## 18. Acceptance Criteria

1. The active default entity has nine coded divisions and 27 standard division
   roles, plus the existing Super Admin.
2. Users cannot be assigned a standard role from another division.
3. Role permissions are visible and editable in grouped tool form.
4. Member, Supervisor, and Head navigation reflects the approved matrix.
5. Warehouse users can create, edit, submit, review, revise, approve, reject,
   cancel, and audit inbound/outbound movements according to role.
6. No Warehouse creator can approve the own movement.
7. Approved movements are immutable and never claim Accurate synchronization.
8. Warehouse approvals appear in Action Inbox and Notification Center.
9. Every permission-visible tool has contextual Prakasa AI assistance.
10. AI cannot exceed the authenticated user's permissions or perform controlled
    decisions.
11. User-facing product copy says Prakasa Workspace.
12. New and changed UI surfaces use the centralized light Material 3 tokens,
    component radii, hover, pressed/ripple, focus, disabled, and loading states.
13. Backend tests, frontend tests, production build, migration verification,
    authorization tests, and responsive browser checks pass.
14. Login uses Prakasa Workspace branding and the shared Google-style design
    tokens on desktop and mobile.
15. Login supports the existing configured authentication methods, cannot
    accept role/division from the client, and handles missing access without
    exposing an unrestricted workspace.

## 19. Delivery Order

1. Organization schema, seeds, role policy service, and assignment validation.
2. Role administration and user-assignment UI.
3. Central design tokens, shared interaction primitives, branding, and login.
4. Warehouse movement backend, approval lifecycle, notifications, and tests.
5. Warehouse responsive UI and contextual AI assistance.
6. AI Tool Registry and coverage across the remaining modules.
7. Full authorization, migration, browser, responsive, accessibility, and build
   verification.

Each stage must leave the current application runnable. Existing uncommitted
work is preserved, and no commit or deployment is performed unless separately
requested.
