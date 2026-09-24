# Prakasa Workspace Organization, Warehouse, AI, and Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Prakasa Workspace rebrand, nine-division/27-role authorization model, role administration, Google Workspace-inspired light UI and login, approved Warehouse inbound/outbound workflow, and contextual Prakasa AI assistance for every permission-visible tool.

**Architecture:** Extend the existing MySQL identity, approval, Warehouse, notification, and AI Command Center systems rather than introducing parallel subsystems. Stable department/role keys and a canonical standard-role catalog drive safe seeds and reset behavior; Warehouse movements use explicit state transitions and the existing Approval Engine; a central AI Tool Registry resolves the current route to a permission-scoped context provider and risk policy; shared CSS tokens and components govern all new and changed UI.

**Tech Stack:** MySQL migrations, Node.js/CommonJS, Express, Zod, React 18, React Router, Vite, CSS custom properties, Node test runner, existing Google OAuth and AI provider adapters.

**Spec:** `docs/superpowers/specs/2026-09-24-prakasa-workspace-organization-warehouse-ai-design.md`

## Global Constraints

- Preserve every pre-existing uncommitted user/Claude change and work on the current branch.
- Do not commit, push, deploy, or connect Accurate unless the user separately requests it.
- Keep package names, repository paths, production domains, cron paths, and `prakasa.token` unchanged.
- Accurate integration is absent: approved Warehouse records must never claim to be synced.
- Every production behavior begins with a failing regression/unit test and completes with the full relevant suite.
- All role, entity, department, record, and AI context authorization is revalidated server-side.
- Private AI sessions remain owner-only.
- Controlled decisions (approve, reject, sign, cancel, publish, authorization changes) are never executed autonomously by AI.
- New and changed UI uses the shared light Material 3 token scale and supports keyboard focus, Escape, reduced motion, tablet, and mobile.
- Use `apply_patch` for source edits and preserve local test data unless a test creates data inside its own transaction.

## Review Focus

1. A user moved to another division must not retain or receive an incompatible division role; Task 2 tests atomic department/role replacement and rejection.
2. A Warehouse creator who also has Supervisor or Head permission must not approve the own movement; Task 5 tests separation of duties at the authoritative decision boundary.
3. Duplicate submit/approve requests and concurrent stale edits must not create duplicate approvals or corrupt movement state; Task 5 tests idempotency, version conflict, and row-lock behavior.
4. An AI route context must never expose a module or record the current user cannot access; Tasks 7 and 8 test registry coverage and permission denial before context resolution.
5. Login return paths and role-not-ready states must not create open redirects or an unrestricted dashboard; Task 4 tests external/protocol-relative/login-loop paths and missing-role behavior.

---

### Task 1: Canonical Organization Catalog and Additive Role Migration

**Files:**
- Create: `backend/src/config/standardOrganization.js`
- Create: `backend/test/standardOrganization.test.js`
- Create: `backend/migrations/032_prakasa_workspace_organization.sql`
- Create: `backend/src/scripts/checkWorkspaceOrganization.js`

**Interfaces:**
- Produces: `DIVISIONS`, `ROLE_LEVELS`, `COMMON_PERMISSION_SETS`, `DIVISION_PERMISSION_SETS`, `STANDARD_ROLES`, `permissionsForStandardRole(roleKey)`.
- Produces database columns `departments.code`, `roles.role_key`, `roles.department_id`, `roles.role_level`, and `roles.is_system_template`.
- Produces nine coded departments and 27 standard roles for entity 1 without assigning them to users.

- [x] **Step 1: Write the failing catalog tests**

Create tests that prove exact division and role coverage, unique keys, and permission hierarchy:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIVISIONS,
  STANDARD_ROLES,
  permissionsForStandardRole,
} = require('../src/config/standardOrganization');

test('catalog contains nine divisions and three roles per division', () => {
  assert.equal(DIVISIONS.length, 9);
  assert.equal(STANDARD_ROLES.length, 27);
  assert.equal(new Set(STANDARD_ROLES.map((role) => role.key)).size, 27);
  for (const division of DIVISIONS) {
    assert.deepEqual(
      STANDARD_ROLES.filter((role) => role.departmentCode === division.code)
        .map((role) => role.level),
      ['member', 'supervisor', 'head'],
    );
  }
});

test('supervisor and head defaults are permission supersets', () => {
  for (const division of DIVISIONS) {
    const member = new Set(permissionsForStandardRole(`${division.code}.member`));
    const supervisor = new Set(permissionsForStandardRole(`${division.code}.supervisor`));
    const head = new Set(permissionsForStandardRole(`${division.code}.head`));
    for (const code of member) assert.equal(supervisor.has(code), true, code);
    for (const code of supervisor) assert.equal(head.has(code), true, code);
  }
});
```

- [x] **Step 2: Run the catalog tests and verify RED**

Run: `cd backend && node --test test/standardOrganization.test.js`

Expected: FAIL because `standardOrganization.js` does not exist.

- [x] **Step 3: Implement the canonical catalog**

Use these exact division records and a deterministic permission union:

```js
const DIVISIONS = Object.freeze([
  { code: 'operations', name: 'Operations' },
  { code: 'finance', name: 'Finance' },
  { code: 'procurement', name: 'Procurement' },
  { code: 'sales', name: 'Sales' },
  { code: 'people_culture', name: 'People & Culture' },
  { code: 'management_office', name: 'Management Office' },
  { code: 'retail_commerce', name: 'Retail Commerce' },
  { code: 'warehouse', name: 'Warehouse' },
  { code: 'marketing', name: 'Marketing' },
]);

const ROLE_LEVELS = Object.freeze(['member', 'supervisor', 'head']);
const unique = (values) => [...new Set(values)];

const COMMON_MEMBER = Object.freeze([
  'notification.view',
  'document.view', 'document.create', 'document.update',
  'template.view', 'document_type.view',
  'board.view', 'task.view', 'task.create', 'task.update', 'task.watch',
  'task.checklist.manage', 'task.activity.view',
  'chat.view', 'chat.send',
  'approval.view', 'approval.request',
  'signature.view', 'signature.request', 'signature.sign', 'signature.manage_asset',
  'meeting.view', 'meeting.create', 'meeting.update',
  'meeting.attach_recording', 'meeting.ai_summary',
  'form.view', 'form.submit', 'form_submission.view',
  'workflow_instance.view', 'search.global',
  'kb.view', 'kb.query', 'workspace.customer.view',
  'data_classification.view',
  'ai.use', 'ai.view', 'ai_command.use', 'ai_command.session.view',
  'ai_command.session.manage', 'ai_command.context.attach',
  'ai_command.action.propose', 'ai_command.department.view',
]);

const COMMON_SUPERVISOR = Object.freeze([
  'board.manage', 'task.delete', 'task.watch.manage', 'task.dependency.manage',
  'approval.decide', 'approval_delegation.view',
  'meeting.cancel', 'meeting.confirm_action',
  'ai_command.action.confirm',
  'workspace.cross_division.view', 'timeline.view', 'decision_log.view',
  'form_submission.manage', 'form_submission.transition',
  'workflow_instance.transition',
]);

const COMMON_HEAD = Object.freeze([
  'document.delete', 'template.manage', 'kb.manage',
  'decision_log.manage', 'automation.view', 'brief.view',
  'data_classification.manage', 'approval_matrix.view',
  'approval_delegation.manage',
]);
```

Define `DIVISION_PERMISSION_SETS` with these domain additions:

- Operations: Member gets `it.dashboard.view`, `device.view`, and
  `subscription.view`; Supervisor adds device/subscription operational manage
  permissions; Head adds vendor, license, invoice, renewal-decision, payment,
  automation, and workflow-definition management.
- Finance: Member gets finance view/request/manage/document-check; Supervisor
  adds approve/process; Head adds no unsafe system-admin permission.
- Procurement: Member gets finance view/request and Warehouse movement/sample
  view; Supervisor relies on common approval; Head adds no cross-entity access.
- Sales: Member gets all customer/inquiry/pipeline/visit/sample/quotation use
  and manage permissions plus Field Sales Bot; Supervisor adds sample approve.
- People & Culture: Member gets HRGA view/request/manage; Supervisor adds
  approve/complete; Head adds checklist-template manage.
- Management Office: Member gets cross-division workspace, timeline, brief,
  and decision-log view; Supervisor adds management-dashboard view; Head adds
  activity-log view.
- Retail Commerce: Member gets customer/pipeline/quotation manage, sample
  view/request, and Warehouse movement/sample view; Supervisor adds sample
  approve.
- Warehouse: Member gets movement view/create/update/submit plus existing
  sample/checklist/delivery/incident operational permissions; Supervisor adds
  movement approve and audit view; Head adds movement cancel.
- Marketing: Member gets customer and quotation view; Supervisor adds template
  manage; Head adds no system-admin permission.

Build each level with `unique([...lowerLevel, ...levelAdditions])` and export all
interfaces.

- [x] **Step 4: Add migration 032**

The SQL must:

1. add nullable `departments.code`, backfill normalized codes where possible,
   then add `UNIQUE(entity_id, code)`;
2. add nullable `roles.role_key`, `department_id`, `role_level`, and
   `is_system_template` plus indexes/FK;
3. backfill active Super Admin as `system.super_admin`, `admin`, system template;
4. insert nine departments with `NOT EXISTS` checks;
5. insert 27 roles by stable key and department code;
6. insert the seven Warehouse movement permissions;
7. grant all new permissions to Super Admin; and
8. seed every standard role permission with explicit
   `INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT`
   statements without
   deleting existing rows.

Use the repository's information-schema guard pattern from migration 021 for
every additive column/index/constraint so reruns remain safe.

- [x] **Step 5: Add migration/catalog consistency assertions**

Extend `standardOrganization.test.js` to read migration 032 and assert that all
division codes, role keys, and new movement permission codes appear. This test
must fail if the runtime reset catalog and initial SQL seed drift apart.

- [x] **Step 6: Verify Task 1 GREEN**

Run:

```bash
cd backend
node --test test/standardOrganization.test.js
node --test test/
```

Expected: catalog tests and the complete backend suite pass.

- [x] **Step 7: Record a local checkpoint**

Run `git diff --check`. Do not commit; report Task 1 files and test evidence in
the running work log.

---

### Task 2: Department-Safe Role and User APIs

**Files:**
- Create: `backend/src/services/rolePolicy.service.js`
- Create: `backend/test/rolePolicy.test.js`
- Modify: `backend/src/controllers/roles.controller.js`
- Modify: `backend/src/routes/roles.routes.js`
- Modify: `backend/src/controllers/users.controller.js`

**Interfaces:**
- Produces: `validateRoleAssignment({ entityId, departmentId, roleRows })`.
- Produces: `getAssignableRoles({ entityId, departmentId })`.
- Produces: `resetStandardRole({ roleId, actor })`.
- Role DTO adds `roleKey`, `departmentId`, `departmentName`, `roleLevel`,
  `isSystemTemplate`, `permissionCount`, and `userCount`.

- [x] **Step 1: Write failing policy tests**

Cover same-department success, global Super Admin success, cross-department
failure, cross-entity failure, missing department failure, deleted role failure,
and atomic department change with replacement roles.

```js
test('division role must match the user department', () => {
  assert.throws(
    () => validateRoleAssignment({
      entityId: 1,
      departmentId: 11,
      roleRows: [{ id: 9, entity_id: 1, department_id: 12, deleted_at: null }],
    }),
    /divisi pengguna/,
  );
});
```

- [x] **Step 2: Verify RED**

Run: `cd backend && node --test test/rolePolicy.test.js`

Expected: FAIL because the policy service does not exist.

- [x] **Step 3: Implement role policy service**

Validation rules must match section 5.3 of the spec. Database helpers accept a
transaction connection so user creation/update validates role rows and writes
`users`/`user_roles` in one transaction.

- [x] **Step 4: Apply policy to user create/update**

For create, load all requested roles using `WHERE id IN (?) FOR SHARE`, verify
entity/department compatibility, then insert. For update, load the current user
inside the transaction, calculate the effective entity/department from patch +
current values, validate either supplied or existing roles, and reject a
department change that leaves incompatible roles.

- [x] **Step 5: Expand role list/detail and reset API**

Add `POST /roles/:id/reset-standard` guarded by `role.manage`. Reset must look up
`role_key`, reject custom/system-admin roles, resolve catalog codes to permission
IDs, replace only that role's permission rows transactionally, and audit added /
removed codes.

- [x] **Step 6: Add controller-level regression tests**

Use `node:test` method mocks on the shared pool/connection to prove controllers
call validation before modifying `user_roles` and roll back on mismatch.

- [x] **Step 7: Verify Task 2 GREEN**

Run `cd backend && node --test test/rolePolicy.test.js test/ && git diff --check`.

- [x] **Step 8: Record a local checkpoint**

Do not commit. Summarize API contracts and test counts.

---

### Task 3: Role Matrix and Division-Safe User Administration UI

**Files:**
- Create: `frontend/src/pages/admin/roleAdminModel.js`
- Create: `frontend/test/roleAdminModel.test.js`
- Create: `frontend/src/pages/admin/RoleEditorPanel.jsx`
- Modify: `frontend/src/pages/admin/Roles.jsx`
- Modify: `frontend/src/pages/admin/Users.jsx`
- Modify: `frontend/src/styles/layout.css`

**Interfaces:**
- Produces: `groupPermissions(permissions)`, `roleDiff(original, selected)`,
  `rolesForDepartment(roles, entityId, departmentId)`, and
  `roleHierarchyRows(roles, departmentId)`.
- Consumes expanded Role DTO and `/roles/:id/reset-standard` from Task 2.

- [x] **Step 1: Write failing pure-model tests**

Test permission grouping by tool prefix, Member/Supervisor/Head ordering,
role-diff added/removed sets, and strict entity+department filtering while
retaining allowed global roles.

- [x] **Step 2: Verify RED**

Run: `cd frontend && node --test test/roleAdminModel.test.js`.

- [x] **Step 3: Implement the model and Role Editor panel**

The panel loads `/roles/:id` plus `/permissions`, renders collapsible tool
groups, checkboxes, selected count, exact permission code disclosure, and a
sticky Save action. Before PATCH it renders added/removed permission summaries
inside `ConfirmDialog`.

- [x] **Step 4: Replace the read-only Roles page**

Add division/level/search filters, role metadata columns, a three-role comparison
mode, edit action, and Reset Default action for standard division templates.

- [x] **Step 5: Make Users role selection department-safe**

Disable role selection until a department is selected (except Super Admin
creation paths), show only roles returned for the chosen entity/department, and
clear incompatible selected roles when entity or department changes. Render
role names and department names rather than raw IDs.

- [x] **Step 6: Verify Task 3 GREEN**

Run:

```bash
cd frontend
node --test test/roleAdminModel.test.js test/
npm run build
```

- [x] **Step 7: Browser-check administration flows**

As Super Admin, inspect desktop and 390px mobile layouts, open a role, toggle a
permission without saving, inspect the diff dialog, cancel it, and verify the
user form filters roles after choosing Warehouse. Do not mutate production-like
user assignments during visual verification.

- [x] **Step 8: Record a local checkpoint**

Run `git diff --check`; do not commit.

---

### Task 4: Central Material 3 Tokens, Branding, and Login

**Files:**
- Create: `frontend/src/pages/login/loginModel.js`
- Create: `frontend/test/loginModel.test.js`
- Create: `frontend/test/branding.test.js`
- Modify: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/styles/layout.css`
- Modify: `frontend/src/components/Button.jsx`
- Modify: `frontend/src/components/Input.jsx`
- Modify: `frontend/src/components/Card.jsx`
- Modify: `frontend/src/components/Modal.jsx`
- Modify: `frontend/src/components/DataTable.jsx`
- Modify: `frontend/src/components/ConfirmDialog.jsx`
- Modify: `frontend/src/pages/Login.jsx`
- Modify: `frontend/src/components/Navbar.jsx`
- Modify: `frontend/src/pages/DivisionHub.jsx`
- Modify: `frontend/src/components/ai/AIAccountMenu.jsx`
- Modify: `frontend/src/pages/ai/AICommandCenter.jsx`
- Modify: `frontend/index.html`
- Modify: `backend/src/app.js`
- Modify: `backend/src/services/pdf.service.js`
- Modify: `README.md`

**Interfaces:**
- Produces: `safeReturnPath(value)` and `hasUsableAccess(user)`.
- Produces `--pw-*` color, shape, state, elevation, spacing, and motion tokens,
  while temporarily aliasing existing `--color-*` and `--radius-*` variables.

- [x] **Step 1: Write failing login-model tests**

```js
test('safeReturnPath allows internal destinations only', () => {
  assert.equal(safeReturnPath('/warehouse?tab=inbound'), '/warehouse?tab=inbound');
  assert.equal(safeReturnPath('https://evil.example'), '/');
  assert.equal(safeReturnPath('//evil.example'), '/');
  assert.equal(safeReturnPath('/login?returnTo=/login'), '/');
});
```

Test `hasUsableAccess` for Super Admin, a division role, no permissions, and
missing department.

- [x] **Step 2: Write failing branding scan**

Scan the explicit user-visible files listed above and assert they do not contain
`Prakasa AI Work OS`, `Prakasa Work OS`, or user-facing `Kembali ke Work OS`.
Exclude migrations, deployment paths, package files, cron files, and historical
specs.

- [x] **Step 3: Verify RED**

Run `cd frontend && node --test test/loginModel.test.js test/branding.test.js`.

Expected: missing model plus old branding strings.

- [x] **Step 4: Replace token values and add state-layer primitives**

Implement the exact spec palette and radius scale in `tokens.css`. Add reusable
`.pw-state-layer`/component pseudo-elements for 8% hover and 12% pressed states,
2px focus-visible ring, pointer-origin ripple support, 100–200ms motion, and a
`prefers-reduced-motion` override. Remove hover transforms from Google-style
cards.

- [x] **Step 5: Converge shared components**

Use the shared tokens in Button, Input, Card, Modal, DataTable, and ConfirmDialog.
Preserve APIs and accessibility. Button dimensions must remain stable during
loading/pressed state; dialogs retain the focus trap/Escape behavior already
added.

- [x] **Step 6: Rebuild Login**

Implement the two-region desktop/one-column mobile surface. Show Google login
first only when configured, render the manual form as fallback, use a live error
summary with focus management, prevent repeat submits, apply `safeReturnPath`,
and route authenticated users without usable division access to a controlled
`Akses belum disiapkan` state with logout.

- [x] **Step 7: Replace user-facing brand copy**

Change only display copy and generated PDF text to `Prakasa Workspace`. Do not
rename package names, local-storage keys, folders, domains, cron paths, or old
migration comments.

- [x] **Step 8: Verify Task 4 GREEN**

Run frontend tests/build, backend tests affecting PDF/app startup, and
`rg -n "Prakasa (AI )?Work OS|Kembali ke Work OS"` with explicit exclusions.

- [x] **Step 9: Browser-check login states**

Verify desktop and 390px mobile: Google configured/unconfigured presentation,
manual validation, error focus, disabled loading, hover/pressed/focus, and the
role-not-ready state using controlled local data only.

- [x] **Step 10: Record a local checkpoint**

Run `git diff --check`; do not commit.

---

### Task 5: Warehouse Movement State Machine, Approval, and API

**Files:**
- Create: `backend/migrations/033_warehouse_movement_approval.sql`
- Create: `backend/src/services/warehouseMovementModel.js`
- Create: `backend/src/services/warehouseMovement.service.js`
- Create: `backend/src/services/approvalSubjectLifecycle.service.js`
- Create: `backend/src/controllers/warehouseMovements.controller.js`
- Create: `backend/test/warehouseMovementModel.test.js`
- Create: `backend/test/warehouseMovement.service.test.js`
- Modify: `backend/src/routes/warehouse.routes.js`
- Modify: `backend/src/controllers/approvals.controller.js`
- Modify: `backend/src/services/aiInbox.service.js`

**Interfaces:**
- Produces: `validateMovementInput(input)`, `assertMovementTransition(from, to)`,
  and `movementDto(row)`.
- Produces service methods `list`, `get`, `create`, `updateDraft`, `submit`,
  `requestRevision`, `applyApprovalDecision`, `cancel`, and `audit`.
- Produces REST paths under `/warehouse/movements` with `type=inbound|outbound`.
- Produces lifecycle callbacks `onApproved`, `onRejected`, and
  `onRevisionRequested` for Warehouse subjects.

- [x] **Step 1: Write failing state-machine and item-validation tests**

Test every allowed path, forbidden approved edits, positive finite quantities,
required product/unit, duplicate SKU batch/location rule, at least one item,
revision/rejection note requirement, and DTO JSON normalization.

- [x] **Step 2: Verify model RED**

Run `cd backend && node --test test/warehouseMovementModel.test.js`.

- [x] **Step 3: Implement the pure movement model**

Keep state constants and validation independent from Express and MySQL. Return
normalized items; throw errors with stable status/code for controllers.

- [x] **Step 4: Add migration 033**

Extend both existing movement tables with the workflow columns from spec section
9.1, version default 1, indexes for entity/department/status/date, and nullable
approval FK. Backfill historical rows as approved and map `received_by` /
`released_by` to creator/approver only when present. Seed Warehouse Supervisor
matrix rows for `warehouse_inbound` and `warehouse_outbound`, with Warehouse Head
as escalation role, only when equivalent active rules do not exist.

- [x] **Step 5: Write failing service tests**

With transaction/pool method mocks, prove:

- create derives entity/department/user from auth, not request body;
- update requires editable state and matching version;
- submit creates exactly one approval on repeat calls;
- submit commits movement and approval atomically;
- creator with approval permissions is denied at decision time;
- Supervisor needs both `approval.decide` and `warehouse.movement.approve`;
- lifecycle approval/revision/rejection applies once; and
- Head cancellation requires approved status and a nonempty reason.

- [x] **Step 6: Implement service and approval lifecycle**

Use row-specific `SELECT` statements ending in `FOR UPDATE`, optimistic
`version`, the existing Approval Engine
matrix resolution, notification helpers, and activity/audit logs. Extend the
approval controller at its final authoritative decision point to call the
subject lifecycle inside the transaction and enforce Warehouse self-approval /
department checks before committing.

- [x] **Step 7: Add movement routes**

Add:

```text
GET    /warehouse/movements
GET    /warehouse/movements/:type/:id
POST   /warehouse/movements
PATCH  /warehouse/movements/:type/:id
POST   /warehouse/movements/:type/:id/submit
POST   /warehouse/movements/:type/:id/cancel
GET    /warehouse/movements/:type/:id/audit
```

Apply movement-specific permissions, Zod schemas, and entity/department scope.
Do not add Accurate endpoints or fields.

- [x] **Step 8: Verify Task 5 GREEN**

Run focused movement tests, approval tests, full backend suite, migration status,
and `git diff --check`.

- [x] **Step 9: Apply migrations locally and verify seeds**

Run `npm run migrate` only after migration-status inspection reports no changed
or missing historical files. Query counts only: nine divisions, 27 standard
roles, seven movement permissions, and two Warehouse matrix request types.

- [x] **Step 10: Record a local checkpoint**

Do not commit. Report migration filenames, applied counts, and tests.

---

### Task 6: Responsive Warehouse Movement UI

**Files:**
- Create: `frontend/src/pages/warehouse/warehouseMovementModel.js`
- Create: `frontend/test/warehouseMovementModel.test.js`
- Create: `frontend/src/pages/warehouse/WarehouseMovements.jsx`
- Create: `frontend/src/pages/warehouse/WarehouseMovementForm.jsx`
- Create: `frontend/src/pages/warehouse/WarehouseMovementDetail.jsx`
- Create: `frontend/src/pages/warehouse/warehouse-movements.css`
- Modify: `frontend/src/pages/warehouse/WarehouseDashboard.jsx`
- Modify: `frontend/src/components/navigation.js`

**Interfaces:**
- Produces: `emptyMovementItem()`, `movementValidationSummary(input)`,
  `movementStatusLabel(status)`, `canEditMovement(user, movement)`, and
  `canCancelMovement(user, movement)`.
- Consumes Task 5 REST API and Task 4 design primitives.

- [x] **Step 1: Write failing UI-model tests**

Test item-row normalization, client-side required-field summaries, status copy,
permission/state action visibility, and that no status copy mentions Accurate
sync.

- [x] **Step 2: Verify RED**

Run `cd frontend && node --test test/warehouseMovementModel.test.js`.

- [x] **Step 3: Implement movement list and tab navigation**

Add Barang Masuk, Barang Keluar, Approval Supervisor, and Riwayat Transaksi
before existing Warehouse tabs. Provide status/date/search filters, permission-
aware create actions, loading/error/retry/empty states, and mobile cards.

- [x] **Step 4: Implement guided movement form**

Build three accessible sections matching the spec, editable item rows on
desktop, item cards on mobile, Save Draft and Submit actions, dirty-state exit
confirmation, exact validation messages, and version conflict recovery.

- [x] **Step 5: Implement detail and approval context**

Show immutable header, items, source metadata, approval timeline, decision note,
audit history, and allowed actions. Link pending approvals to `/approvals/:id`
and Action Inbox. Head cancellation uses a reason dialog.

- [x] **Step 6: Verify Task 6 GREEN**

Run frontend focused/full tests and production build.

- [x] **Step 7: Browser-check role workflows**

Using controlled local users/data, verify Member draft/submit, creator denial,
Supervisor revision/approve, Head cancellation, desktop/tablet/390px mobile,
keyboard navigation, responsive item rows, and no Accurate sync claim.

- [x] **Step 8: Record a local checkpoint**

Run `git diff --check`; do not commit.

---

### Task 7: Backend AI Tool Registry and Permission-Scoped Context

**Files:**
- Create: `backend/src/services/aiToolRegistry.service.js`
- Create: `backend/src/services/aiToolContext.service.js`
- Create: `backend/test/aiToolRegistry.test.js`
- Create: `backend/test/aiToolContext.test.js`
- Modify: `backend/src/controllers/aiCommand.controller.js`
- Modify: `backend/src/routes/aiCommand.routes.js`

**Interfaces:**
- Produces: `resolveTool(pathname)`, `listToolsForUser(user)`,
  `assertToolAccess({ user, tool, operation })`, and
  `buildToolContext({ user, toolKey, subjectType, subjectId, visibleState })`.
- Produces: `GET /ai-command/tools`, `POST /ai-command/tool-context`, and a
  context attachment DTO that existing AI sessions can consume.

- [x] **Step 1: Write failing registry coverage tests**

Define registry entries for every route family in `App.jsx`/navigation:

```text
dashboard, search, notifications, ai-command, documents, templates, tasks,
chat, approvals, signatures, meetings, forms, sales-pipeline, sales-customers,
sales-samples, field-sales, warehouse, it-dashboard, devices, subscriptions,
finance, hr-onboarding, hr-offboarding, hr-checklists, workspaces,
cross-workspaces, knowledge-base, automation, decision-log, management,
brief, timeline, data-classification, users, entities, departments, roles,
permissions, folder-rules, form-builder, workflow-builder, document-types,
signature-rules, dashboard-layouts, integration-logs, approval-matrix,
approval-delegations, signature-precheck, ai-usage, ai-provider-settings,
activity-logs
```

The test parses the explicit frontend route/navigation strings and fails when a
permission-visible route has no backend descriptor. Public verify and login are
excluded because they are unauthenticated surfaces.

- [x] **Step 2: Verify RED**

Run `cd backend && node --test test/aiToolRegistry.test.js`.

- [x] **Step 3: Implement registry descriptors**

Each entry declares path patterns, title, required read permission, prompt
starters, supported context subject types, action descriptors, risk tier,
confirmation tier, and executor key or null. Admin tools use explanatory/draft
capabilities only unless an existing safe executor exists.

- [x] **Step 4: Write failing context authorization tests**

Prove that missing module permission fails before provider/query work; private
AI data cannot be attached by another user; record entity/department mismatch
fails; visibleState is allow-listed and size-bounded; unknown tools/subjects
fail; Warehouse movement context uses its domain access service.

- [x] **Step 5: Implement context service and endpoints**

Context providers return minimum structured facts plus source identifiers. The
endpoint never accepts arbitrary table/query names. Sanitize visible UI state,
cap serialized context, wrap it as untrusted data, and attach it through the
existing AI context/session permission model.

- [x] **Step 6: Verify Task 7 GREEN**

Run focused registry/context tests and the full backend suite.

- [x] **Step 7: Record a local checkpoint**

Run `git diff --check`; do not commit.

---

### Task 8: Contextual Prakasa AI Panel Across All Tools

**Files:**
- Create: `frontend/src/context/PrakasaAIToolContext.jsx`
- Create: `frontend/src/components/ai/PrakasaAIAssistButton.jsx`
- Create: `frontend/src/components/ai/PrakasaAIToolPanel.jsx`
- Create: `frontend/src/components/ai/aiToolModel.js`
- Create: `frontend/test/aiToolModel.test.js`
- Modify: `frontend/src/components/Layout.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/warehouse/WarehouseMovementDetail.jsx`
- Modify: `frontend/src/styles/layout.css`

**Interfaces:**
- Produces `PrakasaAIToolProvider`, `usePrakasaAIToolContext()`, and
  `usePublishPrakasaAIContext({ toolKey, subjectType, subjectId, visibleState })`.
- Consumes Task 7 tool list/context endpoints and existing AI Command Center
  session/message/document panel behavior.

- [x] **Step 1: Write failing AI tool UI-model tests**

Test current-path resolution, prompt-starter filtering, visible-state size and
key allow-listing, read/draft/confirmed/controlled-decision labels, deferred
executor messaging, and mobile/desktop panel mode selection.

- [x] **Step 2: Verify RED**

Run `cd frontend && node --test test/aiToolModel.test.js`.

- [x] **Step 3: Implement global provider and assist entry point**

Authenticated Layout renders one contextual `Bantu dengan Prakasa AI` control.
It resolves the route through the backend registry, stays hidden only when the
route is excluded/unauthorized, opens the 400px resizable panel on desktop, an
overlay on tablet, and full screen on mobile.

- [x] **Step 4: Reuse AI Command Center capabilities**

The panel creates/opens an AI session with `ai_module=ai_command_center`,
attaches the validated tool context, retains streaming/loading/stop, uploads,
generated files, action proposals, citations, and resizable document behavior.
Do not create a second chat implementation.

- [x] **Step 5: Publish useful page context across route families**

The provider reads the authenticated route's `pathname` and `search`, resolves
them against the registry returned by Task 7, and sends only allow-listed query
keys plus route parameters declared by that descriptor. The backend extracts
the subject type and identifier from the matched route pattern and remains
responsible for loading authorized record content. Warehouse detail calls
`usePublishPrakasaAIContext` with movement type/id/version/status so stale
proposals can be rejected. Admin pages never publish secrets, password inputs,
tokens, credential fields, or raw provider configuration values.

- [x] **Step 6: Add role-aware starters and action cards**

Member starters emphasize create/extract/complete, Supervisor starters emphasize
review/differences/queues, and Head starters emphasize trends/exceptions/
standards. Controlled decisions display recommendation cards without an execute
button. Implemented writes display exact preview and use existing confirmation.

- [x] **Step 7: Verify Task 8 GREEN**

Run frontend focused/full tests, production build, backend registry coverage,
and `git diff --check`.

- [x] **Step 8: Browser-check representative module coverage**

Verify one tool from each family (Documents, Tasks, Sales, Warehouse, Finance,
People & Culture, IT/Operations, Management, Marketing/common content, and
Admin). Confirm the assistant title/context, permission denial, panel sizing,
mobile full-screen behavior, stop/loading, and no autonomous decision action.

- [x] **Step 9: Record a local checkpoint**

Do not commit. Report route coverage count and representative browser evidence.

---

### Task 9: Full Migration, Authorization, UI, and Runtime Verification

**Files:**
- Modify: `docs/LOCAL_VERIFICATION.md`
- Modify: `docs/deployment.md`
- Modify: `docs/superpowers/specs/2026-09-24-prakasa-workspace-organization-warehouse-ai-design.md`

Update the spec status line to `Implemented locally; pending deployment`
  only after every acceptance criterion passes

**Interfaces:**
- Produces a repeatable local verification checklist and final evidence report.

- [x] **Step 1: Run migration ledger verification**

Run setup/migration inspection. Confirm migrations 032/033 applied exactly once,
no historical checksum changes, and no missing files.

- [x] **Step 2: Verify database invariants read-only**

Query counts and keys without printing credentials or sensitive user data:

- 9 active coded divisions;
- 27 active standard division roles plus Super Admin;
- unique role keys;
- expected new movement permissions;
- Warehouse Supervisor/Head matrix references;
- no users assigned a division role from another department; and
- no duplicate approval request linked to a movement.

- [x] **Step 3: Run complete automated verification**

```bash
cd backend && node --test test/
cd ../frontend && node --test test/ && npm run build
cd .. && git diff --check
```

Treat any failure as unfinished. Record the existing Vite chunk-size warning
separately if it remains non-blocking.

- [x] **Step 4: Verify live local services**

Restart backend on port 3001 so it uses current code; retain/reuse Vite on
127.0.0.1:5173. Verify `/api/health`, authenticated `/auth/me`, role list,
Warehouse movements, Action Inbox, and AI tool registry return expected status.

- [x] **Step 5: Complete browser acceptance matrix**

Verify login, dashboard/navigation, Roles, Users, Warehouse movement lifecycle,
Action Inbox, contextual AI, document side panel, keyboard dialogs, desktop,
tablet, and 390px mobile. Do not confirm a destructive or financially material
action during verification.

- [x] **Step 6: Review security boundaries**

Attempt controlled denial cases: cross-department role assignment, creator
self-approval, unauthorized movement read, private AI session access, external
return URL, unknown AI tool, controlled decision execution, and client-supplied
entity/department override. Every attempt must fail with the expected status and
without partial writes.

- [x] **Step 7: Update verification documentation and spec status**

Document commands, expected results, local URLs, role seed behavior, Warehouse
approval behavior, Accurate exclusion, and how admins customize/reset roles.

- [x] **Step 8: Final local checkpoint**

List changed files, migrations, test totals, build result, live service status,
known warnings, and remaining deployment-only configuration. Do not commit,
push, or deploy.
