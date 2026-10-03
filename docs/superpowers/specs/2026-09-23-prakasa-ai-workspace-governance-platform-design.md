# Prakasa AI Workspace Governance Platform Design

Date: 2026-09-23

Status: Approved in conversation; pending written-spec review

## 1. Product Vision

Prakasa AI is a company work assistant built on Google Workspace and the
operational modules of Prakasa AI Work OS. Its purpose is not only to answer
questions or generate files. It helps every division prepare documents, follow
company standards, collaborate, hand work to other divisions, and complete
approved actions in a consistent and auditable way.

The product is chat-first and follows the familiar interaction model of
ChatGPT: conversation history in a sidebar, a central conversation, a persistent
composer, visible tool execution, and a resizable document workspace. Prakasa
adds organizational context, rules, approvals, collaboration, provenance, and
Google Workspace actions.

All business behavior is configurable through policies and playbooks. Sales is
the first pilot, not a permanently privileged or hard-coded division.

## 2. Outcomes

Prakasa AI must:

1. Reduce inconsistent document formats and missing required information.
2. Detect discrepancies across related business documents before handoff.
3. Guide users through company and division standards without silently blocking
   legitimate work.
4. Let users collaborate within one division or across selected divisions
   without exposing unrelated data.
5. Make Google Drive, Docs, Sheets, Slides, Gmail, Calendar, Meet, Forms, and
   Chat available as governed tools.
6. Let division administrators create and maintain guided playbooks without
   changing application code.
7. Preserve evidence, versions, approvals, exceptions, and audit history.
8. Provide proactive but controlled reminders, briefs, and recommendations.
9. Keep all AI actions inside the permissions and confirmation boundaries of
   the current user and workspace.

## 3. Product Principles

### 3.1 Conversation first

Users should be able to describe work naturally instead of navigating many
separate forms. Structured records still exist, but AI gathers, validates, and
previews the required data conversationally.

### 3.2 Division context first

Every conversation has an explicit organizational context. Users start in
their primary division and may switch only to other division or collaboration
spaces they are authorized to access.

### 3.3 Configuration over hard-coded workflows

Document requirements, source priority, severity, tolerances, approvals,
notifications, folders, naming, retention, and allowed tools are rules. Rules
are versioned configuration, not controller-specific conditions.

### 3.4 Advice before enforcement

Business-standard findings produce recommendations and a clear choice to fix
or continue. Continuing with important findings requires a reason and creates
an audit record. Technical and security failures remain hard blocks.

### 3.5 Evidence before assertions

Business answers cite their source file/system, version, status, and location.
When Prakasa AI cannot determine the authoritative value, it says so and asks a
user to decide.

### 3.6 Draft before external action

AI may read authorized sources and prepare drafts. Sending, publishing,
sharing, moving, or changing business data requires an explicit preview and
confirmation unless an administrator has configured a narrower safe exception.

### 3.7 Preserve originals and history

AI does not overwrite official source documents. Corrections create a new draft
or version with a traceable relationship to the source.

## 4. Users and Responsibilities

### Employee

- Uses AI in personal, division, and collaboration spaces.
- Reads recommendations and evidence.
- Creates drafts and confirms permitted actions.
- Provides reasons when continuing despite important findings.

### Division administrator

- Maintains division templates, rules, tools, and draft playbooks.
- Tests configuration using safe example cases.
- Cannot remove mandatory company or security rules.

### Division head

- Reviews and publishes division playbooks and standards.
- Reviews division-level exceptions, bottlenecks, and compliance summaries.

### Central administrator

- Maintains company-wide standards, integrations, tool permissions, data
  classification, identity, and global guardrails.
- Defines which company rules divisions may extend or override.

### Collaboration owner

- Selects participating divisions and members.
- Controls the explicit documents, records, and tools available to the space.
- Owns handoff completion and closure.

### Auditor or management reviewer

- Reads permitted versions, approvals, exceptions, evidence, and action logs.
- Does not gain access to underlying content solely because audit metadata
  exists.

## 5. Core Product Surfaces

### 5.1 Chat shell

The main interface uses:

- a collapsible left sidebar for conversation history, division spaces, and
  collaboration spaces;
- a central conversation with streaming responses and tool cards;
- a persistent bottom composer with attachment and tool controls;
- a context switcher at the top; and
- a resizable document workspace on the right.

The interaction model may follow ChatGPT, but Prakasa branding, vocabulary,
permissions, and organizational controls remain distinct.

### 5.2 Resizable document workspace

Documents do not open in a small modal. The default desktop layout is AI on the
left and a document panel on the right, separated by a draggable divider.

The document workspace supports:

- adjustable and remembered width;
- collapse, close, full-screen, and open-in-new-tab actions;
- tabs for multiple open files;
- two-document comparison mode;
- PDF page, Docs section, Sheet range, and Slides page navigation;
- direct navigation from an AI citation to the referenced location; and
- awareness of the currently visible document and selection.

On tablets it becomes a drawer. On phones, AI, document, and comparison are
separate full-screen tabs.

### 5.3 Tool cards

Every meaningful integration action appears in the conversation as a durable
tool card with status, target, result, and available next action. Examples
include searching Drive, reading a Sheet, comparing an SO, preparing a document,
or drafting an email.

### 5.4 Action inbox and proactive briefs

The action inbox contains items that require a human decision. Daily personal
briefs and division summaries highlight missing documents, overdue approvals,
stale handoffs, discrepancies, and follow-ups without performing external
actions automatically.

### 5.5 Playbook and policy builder

Admins create playbooks through a guided AI conversation while a structured
preview is built in the document workspace. They do not begin with an empty
free-form configuration screen.

## 6. Organizational Context and Collaboration

Every AI session belongs to one context type:

- `personal` — visible only to its owner;
- `division` — scoped to one division and authorized members;
- `collaboration` — scoped to explicitly selected members from one or more
  divisions; or
- `company` — scoped to approved company-wide knowledge.

The backend derives entity, division, membership, and permission scope from the
authenticated context. User-submitted IDs never grant access.

### 6.1 Collaboration space

A collaboration space contains:

- participants and roles: owner, editor, reviewer, viewer;
- shared AI conversations;
- explicitly shared Drive files and application records;
- active playbooks and policies;
- tasks, decisions, comments, versions, and approvals;
- a timeline and audit history; and
- an AI-generated onboarding summary for newly added members.

The AI may read only the context explicitly made available to the space. It
does not inherit every file visible to each participant.

### 6.2 Handoff package

Cross-division work moves through a structured handoff package containing:

- origin and destination division;
- purpose and owning workflow;
- required documents and data;
- current validation findings;
- source and destination PIC;
- due date and SLA;
- comments and decisions; and
- acceptance, correction request, return, or completion status.

The receiving division sees the handoff package, not the origin division's full
workspace.

## 7. Google Workspace Tool Catalog

Playbooks select granular tool capabilities from a centrally governed catalog.

### Google Drive

Search, read, upload, version, copy, move, rename, organize folders, and manage
approved sharing.

### Google Docs

Create from templates, fill data, revise, suggest, comment, check standards, and
export.

### Google Sheets

Read ranges, compare tables, validate numbers, create reports, write formulas,
build charts, and reconcile data.

### Google Slides

Create proposals, customer presentations, recurring reports, and management
summaries.

### Gmail

Search permitted mail, summarize threads, prepare replies, create follow-ups,
and send only after confirmation.

### Google Calendar and Meet

Inspect availability, prepare agendas, create events after confirmation, link
meetings to business context, and capture minutes, decisions, and action items.

### Google Forms

Create governed forms from playbooks, read responses, validate submissions, and
start workflows.

### Google Chat

Send approved notifications, approval requests, and handoff updates to selected
spaces.

The pilot prioritizes Drive, Docs, Sheets, Gmail, Calendar, and Meet. Slides and
Forms follow. Chat follows after notification rules are proven.

## 8. AI Action Model

Each tool capability is assigned one of three action levels:

1. **Read** — execute within current permissions without an action confirmation.
2. **Draft** — create a preview that is not yet published, sent, or shared.
3. **Confirm** — execute only after the user sees the target and impact and
   confirms the action.

Deleting, changing access, sending externally, publishing, overwriting official
data, or crossing a division boundary always requires explicit confirmation.
Security policy may prohibit an action entirely.

An example confirmation card states the exact recipients, attachments, record
updates, and external effects. A generic `Continue` button is insufficient for
external actions.

## 9. Policy and Rules Engine

All business rules are configurable. The evaluation hierarchy is:

```text
System security
  -> company standard
    -> division standard
      -> collaboration-space policy
        -> playbook
          -> document/process type
            -> recorded exception
```

Higher levels define whether lower levels may extend or override a field.
Mandatory company rules cannot be removed by a division.

### 9.1 Rule definition

Every rule contains:

- stable ID, name, description, and owner;
- scope and applicable context;
- trigger event;
- conditions and input selectors;
- expected values, comparisons, or tolerances;
- evidence requirements;
- finding severity;
- user-facing recommendation;
- allowed resolution actions;
- whether a continuation reason is required;
- notification, approval, and escalation behavior;
- version, effective date, and retirement date; and
- draft, review, published, or archived state.

### 9.2 Configurable business behavior

Admins can configure:

- document types, templates, and required fields;
- source priority and confidence labels;
- comparison rules and numerical tolerances;
- finding levels and messages;
- continuation modal content;
- approvals, value thresholds, SLA, and escalation;
- Drive folder, filename, version, and retention rules;
- allowed Workspace tools and action levels;
- collaboration and sharing constraints;
- proactive brief and notification triggers; and
- division language, labels, and output presentation.

### 9.3 Non-configurable security invariants

Authentication, authorization, tenant/entity isolation, malware protection,
credential secrecy, callback verification, audit integrity, unsafe archive
protection, and prohibition of active uploaded code cannot be disabled through
business configuration.

## 10. Advisory Review and Exception Flow

When a user attempts to submit, finalize, send, publish, or hand off work, the
policy engine evaluates the active rules and displays:

- important findings;
- improvement suggestions;
- evidence locations; and
- the consequences of continuing.

Users may return to fix the work or continue. Important findings require a
reason. The resulting document or process is marked `continued_with_notes`, and
the approver can see the findings and reason.

Malware, corruption, unauthorized access, invalid credentials, and other
technical/security failures are hard blocks rather than advisory findings.

## 11. Division Playbooks

A playbook is a versioned orchestration of rules, tools, documents, roles, and
actions for one repeatable business process.

### 11.1 Guided playbook format

The builder requires:

1. identity and purpose;
2. trigger and eligible users;
3. required inputs and Workspace sources;
4. ordered steps, owners, timing, and branches;
5. document and data checks;
6. outputs, filenames, formats, and Drive destinations;
7. internal and cross-division collaboration;
8. approvals, thresholds, and escalation;
9. AI read, draft, and confirm capabilities;
10. exceptions and continuation behavior;
11. normal, incomplete, and warning test cases; and
12. version, effective date, and publication approval.

### 11.2 Guided creation

The AI asks only for missing or contradictory information, offers examples, and
converts conversational answers into structured configuration. A readiness
score exposes incomplete sections. A playbook cannot be published until
required structure is complete and test simulations pass.

Starter templates include document creation, data reconciliation, approval,
cross-division handoff, and recurring reporting.

### 11.3 Publication

Division admins author and review drafts. The relevant division head can
publish a division playbook without central approval, provided it does not
conflict with mandatory company rules. Every publication creates an immutable
version and effective date.

## 12. Evidence, Provenance, and Trust

Every company-data answer identifies:

- source file or system;
- version and last-modified time;
- page, section, slide, sheet, range, row, cell, or media timestamp;
- draft, published, final, archived, or unknown status;
- owning division and collaboration context; and
- applicable source-priority rule.

The default trust ordering is configurable, but begins with:

1. designated source-of-truth systems;
2. approved final or published documents;
3. latest active documents;
4. drafts; and
5. unverified conversation attachments.

When sources disagree and policy cannot resolve them, AI reports the conflict
and asks an authorized user to choose. That decision, reason, and evidence are
recorded for the current case; it does not silently rewrite global policy.

## 13. Proactive Assistant

The proactive engine can detect:

- missing or incomplete required documents;
- document discrepancies;
- unreviewed drafts and delayed approvals;
- stale or rejected handoffs;
- incorrect folder/name/version placement;
- duplicate or ambiguous versions;
- overdue customer follow-up;
- meetings without minutes or action items;
- unassigned actions;
- incomplete playbook runs; and
- approaching expiration or retention events.

Delivery channels are contextual chat suggestions, a personal action inbox,
daily user briefs, permitted division summaries, and rule-driven escalations.
The engine deduplicates notifications and respects quiet periods and user
permissions.

## 14. Document and File Engine

The existing file-generation and processing design is a subsystem of this
platform:

`docs/superpowers/specs/2026-09-23-ai-file-generation-processing-design.md`

It provides Shared Drive storage, resumable uploads, file extraction,
compression, OCR, transcription, artifact rendering, durable progress, and
authenticated downloads. It must consume policy, context, and permission
decisions from the platform rather than implementing independent business rules.

## 15. Sales Pilot

Sales is the first configured division because the repository already includes
customers, pipeline, quotations, visit reports, sample requests, warehouse
handoff, meetings, tasks, and a Field Sales Bot.

### 15.1 Initial Sales capabilities

- Customer workspace summaries across authorized records and files.
- Quotation and proposal drafting from approved templates.
- Visit-report creation from text, voice, images, and meeting notes.
- Pipeline completeness and follow-up recommendations.
- Sample-request validation and Sales-to-Warehouse handoff.
- Sales collaboration for review, comments, versions, and approvals.
- Cross-division handoff to Warehouse, Finance, and Management.

### 15.2 Sales Document Reconciliation

The first high-value capability compares uploaded or Drive-selected business
documents without assuming a specific ERP:

```text
customer request / PO
  -> quotation
    -> sales order
      -> stock or production request
        -> delivery order
          -> invoice
```

The engine identifies document type, extracts structured fields, aligns line
items, and detects differences in customer identity, address, SKU, description,
quantity, unit, price, discount, tax, totals, dates, terms, version, missing
items, duplicate items, and spreadsheet-versus-document values.

The initial mode is hybrid:

- compare files from upload and Google Workspace immediately;
- let users or policy designate an authoritative source;
- report differences without inventing correctness when no authority exists;
  and
- add ERP or application connectors later through the same source adapter
  interface.

### 15.3 Correction behavior

AI never overwrites a compared source. It displays values side by side, cites
their locations, and offers to create a correction list or a new draft version.
The user previews and confirms the draft. Selected values, reasons, actor, and
source evidence are recorded.

### 15.4 Pilot collaboration sequence

1. Sales internal collaboration and document reconciliation.
2. Sales-to-Warehouse sample and fulfillment handoff.
3. Sales-to-Finance price, discount, tax, term, and quotation review.
4. Management summaries and special approvals.
5. Reuse the platform configuration for Finance, HRGA, IT, and other divisions.

## 16. Service Boundaries

The platform is divided into independently testable services:

- **Context service:** resolves active division/collaboration and membership.
- **Workspace connector service:** exposes granular Google Workspace tools.
- **Policy engine:** resolves rule hierarchy and produces findings/actions.
- **Playbook engine:** orchestrates versioned business procedures.
- **Evidence service:** stores and resolves citations and provenance.
- **Collaboration service:** manages spaces, members, comments, and handoffs.
- **AI orchestration service:** assembles trusted instructions and bounded
  untrusted context, invokes providers, and validates structured output.
- **Action service:** previews, confirms, executes, and audits external effects.
- **Proactive service:** evaluates scheduled/event-driven signals and produces
  deduplicated inbox items and briefs.
- **Document/file engine:** reads, renders, compresses, and streams files.

Each service has a defined API and permission boundary. Google credentials and
provider secrets remain backend-only.

## 17. Conceptual Data Model

The detailed implementation plan may adapt existing tables, but the platform
requires these concepts:

- `ai_spaces` and `ai_space_members`;
- `ai_space_resources` for explicitly shared records and Drive files;
- `policy_sets`, `policy_rules`, and immutable `policy_versions`;
- `playbooks`, `playbook_versions`, steps, branches, tests, and publications;
- `playbook_runs` and step-level run state;
- `ai_findings`, evidence references, resolutions, and exception reasons;
- `handoff_packages`, participants, resources, and transitions;
- `ai_actions`, previews, confirmations, execution results, and idempotency keys;
- `ai_inbox_items` and delivery/deduplication state;
- source adapters, source-priority configuration, and provenance records; and
- attachment/generated-file records defined by the file-engine specification.

All domain rows are entity-scoped. Division and space filters are enforced in
service queries rather than trusted to frontend filtering.

## 18. Loading and Long-running Work

Every long-running action persists its stage and terminal outcome. The UI shows
real byte progress for upload/download and named stages for work without a
measurable percentage. Refreshing or changing devices restores job state.

Representative stages include:

```text
Searching sources -> Reading documents -> Checking standards
-> Comparing data -> Preparing draft -> Waiting for confirmation
-> Executing -> Complete
```

The session composer prevents conflicting generation in the same ordered
conversation, while independent background jobs may continue. Users can cancel
where cancellation is safe and retry idempotent failures.

## 19. Security and Privacy

- Enforce least-privilege OAuth/service-account scopes and app permissions.
- Never expose Google service-account keys or AI provider secrets to clients.
- Treat document and email content as untrusted prompt data.
- Require explicit membership and resource sharing for cross-division context.
- Redact secrets and document content from operational logs.
- Preserve immutable action, exception, policy publication, and approval audit.
- Apply data classification and external-sharing rules before every action.
- Scan and validate uploaded files through the file engine.
- Use idempotency and replay protection for callbacks and external actions.
- Allow administrators to disable connectors or action classes immediately.

## 20. Error and Recovery Model

Errors are specific and actionable: unauthorized context, missing source,
conflicting rules, incomplete playbook, unavailable connector, stale document,
failed extraction, invalid draft, rejected confirmation, provider failure, and
external action failure are distinct states.

Transient read and processing operations may retry with backoff. External
actions use idempotency keys and never retry blindly when the outcome is
unknown. Partial success is shown item by item, with a recovery action and audit
record.

## 21. Testing Strategy

### Unit

- policy inheritance, overrides, effective dates, and conflicts;
- playbook validation, branching, readiness score, and publication;
- context membership and resource visibility;
- action-level enforcement and confirmation requirements;
- source ranking, citations, and unresolved conflicts;
- reconciliation alignment and numerical tolerances; and
- proactive deduplication and escalation.

### Integration

- Google Workspace connector reads, drafts, and confirmed writes;
- division and collaboration isolation;
- policy evaluation during document lifecycle actions;
- playbook runs, handoffs, approvals, and exception recording;
- AI provider structured-output validation;
- file-engine extraction and generated artifact flow; and
- idempotent external action recovery.

### End to end

- Sales user starts in Sales context, compares PO/quotation/SO, opens cited
  evidence in the document panel, creates a revised draft, and confirms saving;
- Sales and Warehouse collaborate through a handoff without unintended Sales
  data exposure;
- division admin builds and tests a playbook, division head publishes it, and a
  new run uses the immutable published version;
- a user continues despite an important finding and the reason is visible to
  the approver and auditor;
- Gmail/Calendar actions remain drafts until confirmed; and
- refresh during long work restores accurate stages and available actions.

### UX and accessibility

- keyboard navigation across sidebar, conversation, divider, documents, tool
  cards, and confirmation dialogs;
- accessible live updates for streaming and job status;
- no reliance on color alone for findings;
- responsive tablet/mobile document behavior; and
- reduced-motion support.

## 22. Delivery Roadmap

### Foundation

- Context/space model, connector permissions, policy schema, action previews,
  evidence model, and ChatGPT-style shell.

### Sales pilot

- Drive/Docs/Sheets tools, document workspace, Sales reconciliation, customer
  context, correction drafts, and internal collaboration.

### Governed workflows

- Guided playbook builder, division-head publication, advisory review modal,
  exceptions, and proactive inbox.

### Cross-division

- Handoff packages, Sales-Warehouse and Sales-Finance collaboration, shared
  resources, and management summaries.

### Workspace expansion

- Gmail, Calendar, Meet, Slides, Forms, and finally Chat according to the tool
  catalog and action model.

### Division expansion

- Configure Finance, HRGA, IT, Warehouse, Management, and additional divisions
  using the same platform primitives rather than new bespoke AI architectures.

Each roadmap stage is feature-flagged, migrates existing behavior additively,
and requires its security and acceptance tests before broader enablement.

## 23. Success Measures

The platform should report, without exposing unauthorized content:

- percentage of documents using published templates/playbooks;
- missing-field and discrepancy rate before versus after AI review;
- average revision count and document completion time;
- handoff acceptance, return, and SLA performance;
- approval waiting time;
- number and type of continued-with-notes exceptions;
- confirmed versus abandoned AI action drafts;
- proactive findings resolved before deadline; and
- user adoption by division and playbook.

These metrics measure process quality and adoption, not employee performance in
isolation.

## 24. Acceptance Criteria for the Platform Foundation

The foundation is ready for the Sales pilot when:

1. Users enter their primary division automatically and can access only
   authorized division/collaboration contexts.
2. The main interface provides conversation history, tool cards, a persistent
   composer, and a resizable citation-aware document panel.
3. Company and division rules resolve through a versioned hierarchy with clear
   conflict reporting.
4. Division admins can create a complete playbook through guided conversation,
   simulate it, and submit it for division-head publication.
5. Business-standard findings support fix or continue-with-reason; security
   failures remain hard blocks.
6. Drive, Docs, and Sheets capabilities are granularly permissioned as read,
   draft, or confirm actions.
7. Every company-data answer can expose authorized source evidence or clearly
   state that no authoritative source is known.
8. Sales can compare mixed PO, quotation, and SO files without assuming a
   particular ERP, review cited differences, and create a new correction draft.
9. A Sales-to-Warehouse handoff exposes only its explicitly shared package.
10. Long-running upload, reading, comparison, and generation states survive a
    refresh and never display fabricated progress.

## 25. Relationship to Existing Modules

The new platform orchestrates and strengthens existing Customers, Pipeline,
Quotations, Sample Requests, Warehouse Tasks, Meetings, Tasks, Approvals,
Signatures, Documents, Knowledge Base, Decision Log, Notifications, and AI
Command Center modules. It does not replace them with an unstructured chat
database.

Existing module records remain authoritative for their defined domain. The AI
layer reads and proposes changes through permissioned service interfaces, and
confirmed actions use existing domain validation wherever possible.
