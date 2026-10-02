# Audit konsistensi UI (30 September 2026)

Hasil audit independen seluruh frontend (6 peninjau, 146 temuan: shell dan komponen bersama 30, Sales/Warehouse/Procurement/Finance 24, People & Culture/IT/dokumen 36, manajemen/proyek 28, admin/Google/AI 28) sebagai titik awal [program-desain-admin-console.md](program-desain-admin-console.md). Teks teknis di bawah dibiarkan dalam bahasa Inggris seperti diserahkan peninjau; rujukan `file:baris` berlaku untuk kode per 30 September 2026 dan bisa bergeser.

Bagian 4 ("Values to measure") sudah dijawab sebagian oleh [referensi-desain-admin-console.md](referensi-desain-admin-console.md) (putaran 1); sisanya diminta lewat [prompts/ai-browser-referensi-desain-admin-google-2.md](prompts/ai-browser-referensi-desain-admin-google-2.md).

---


All paths are relative to `/Users/prakasagroup/Downloads/prakasa-work-os/frontend/`. Paths starting with `docs/` are relative to the repo root.

**Where things stand**
- 143 page JSX files and 39 CSS files (7,945 lines). The two largest are `src/styles/layout.css` (1,958 lines) and `src/pages/ai/ai-command-center.css` (1,823).
- The guideline tests pass (13/13). They only check hex colours in JSX, raw controls in `pages/`, px font sizes, radii and breakpoints, and the `const X_TONES =` pattern. Nearly every problem below gets past them.
- There is no dark theme.
- The mgmt-projects audit arrived cut off after its KPI finding. I checked the rest of that area myself in the repo: progress bars, chip rows, count pills, `IssueDrawer`, checkboxes, comment lists, the two kanban boards and copy. Those results are merged in below.

## 0. Before any work
1. **Change the guideline's reference.** `docs/ui-guideline.md` (intro and §1.6) says the look follows Google Drive, and the comment at `src/components/Layout.jsx:18-20` says the breakpoints follow YouTube. Both should point to admin.google.com. Every value still waiting on a measurement is written as a `TBD-M#` placeholder that points to section 4.
2. **Take baseline screenshots before touching global CSS.** Capture about 15 representative routes at 1440, 1024 and 390 px wide. The global CSS changes in 1.2 and 1.3 change every page at once.

## 1. Shared component and token changes, most impact first

### 1.1 Token layer (`src/styles/tokens.css`)
**Add these tokens:**
- **z-index:** `--pw-z-{sticky,appbar,dropdown,drawer,dialog,snackbar,tooltip}`.
- **Motion:** `--pw-duration-{short,medium,long,extra-long,ripple}` and `--pw-ease-{standard,emphasized,emphasized-decelerate,emphasized-accelerate}`.
- **Elevation and scrim:** `--pw-elev-4`, `--pw-elev-5` and `--pw-scrim`. The scrim is 0.32, 0.28 and 0.24 in different places today.
- **Selected state:** `--pw-selected-container`, `--pw-on-selected-container`, `--pw-selected-weight`.
- **States:** `--pw-disabled-opacity` (0.38, 0.5 and 0.6 are all in use today) and a single `--pw-focus-ring`.
- **Icons:** `--pw-icon-{sm,md,lg}`.
- **Frame:** `--pw-topbar-height`, `--pw-nav-width`, `--pw-nav-rail-width`, `--pw-nav-item-height`, `--pw-page-gutter`, `--pw-page-max`, `--pw-page-gap` (header to content), `--pw-section-gap`.
- **Tables:** `--pw-row-height`, `--pw-row-height-dense`, `--pw-header-row-height`.
- **Type roles:** family, size, weight, line-height and letter-spacing for each of title, section, body, label, caption and overline.

**Remove:**
- The `--text-*` scale. The body text is 16 px today (`tokens.css:81-82,107`) and should become 14 px.
- The `--radius-*` aliases.
- The `--color-*` aliases, which are used 50 times in `layout.css`. Replace them with `--pw-*`.
- `--color-primary-tint` at `layout.css:4`.
- The unused accent data at `src/components/navigation.js:209-241`.
- The `--space-*` tokens are used nowhere. Either start using them everywhere or delete them.

**Font:** load the measured webfont in `index.html:10`, which loads only Roboto today. Use one `--font-family-base` everywhere; `.ai-app` currently puts Google Sans first (`ai-command-center.css:35`).

### 1.2 Remove global CSS leaks (`src/styles/layout.css`): one change that fixes every page
- **Delete `:825-876`.** These rules:
  - make every DataGrid header uppercase
  - draw an extra table outline
  - add `filter:brightness(.97)`, a second hover effect on top of the state layer
  - set every `label` to weight 500
  - contain the raw-`h2` heading hacks
- **Delete `:1210-1213`,** a phone rule that targets the first child `div` of every page.
- **Limit the input focus reset (`:35-39`) to `.pw-field__input`.** The two search pills then no longer need `!important` (`datagrid.css:21`, `layout.css:646-649`).
- **Replace `button:disabled{opacity:.6}` (`:22-25`)** with the disabled token, applied to the shared primitives only.
- **Add a `.pw-link` class.** The reset `a{color:inherit}` (`:8-11`) makes these links look like plain text: `OnboardingBoard:61`, `OffboardingBoard:61`, `SignatureDetail:150`, `HrgaWorkflowDetail:305`.
- **Add `b,strong{font-weight:500}`.** About 15 `<b>`/`<strong>` tags render at weight 700 today.

### 1.3 Page frame: `<Page>`, `PageHeader`, `PageTrail` and the shell
- **New `src/components/Page.jsx`** (or make Layout's main area a stack). It owns the header-to-content gap and the section gap, and `.pw-page-header` margin becomes 0 (`patterns.css:10`). This fixes the 36/28/20/16 px drift on about 40 pages (list in 2.A).
- **`PageHeader`:**
  - Use `moduleDescriptions[path]` (`navigation.js:253-269`) when a page gives no description.
  - The eyebrow shows the record type only.
- **`PageTrail` becomes the only back button:**
  - Add parents for `/hrga/workflows/:id`, `/signatures/*` and every other detail route. Today `navigation.js:342` falls back to "Home › Halaman".
  - Share `--pw-page-gutter` with the main area; today it is 24 px at `:316` vs 32 px at `:737`.
  - Label it "Beranda" instead of "Home", at weight 500.
- **Shell, rebuilt to the measurements:**
  - Top-bar icon buttons become `<IconButton>`. Delete `.prakasa-navbar__icon-btn` (`:435-450`) and `.prakasa-navbar__menu` (`:337-350`).
  - Size the avatar to the measured value.
  - The navbar search becomes `SearchField`.
  - Sidebar item height is 36 px expanded vs 40 px in the rail (`:161` vs `:229`); set both to the measured value.
  - Add expandable nav groups if Admin has them.
  - The rail uses native `title` tooltips (`Sidebar.jsx:68`); switch to the pw tooltip.
  - Use `100dvh` instead of `100vh` (`:114`).
  - Stop the unread dot pulsing (`:452-461`).
  - Remove the Footer and the Drive-style white rounded sheet if Admin has neither.

### 1.4 One hover and click system
Keep `.pw-state-layer` + `src/styles/ripple.js` and extend it to cover the disabled, focus-visible (one ring) and selected states.

**Delete the second system:** `.ai-ripple`, `src/components/ai/usePointerRipple.js` and `ai-command-center.css:79-139`. It is used by 10 AI components.

**Remove these local hovers and add `pw-state-layer` instead:**
- `layout.css:172` (sidebar; the active item has no hover at all), `:539`, `:668`, `:704`, `:1507`, `:1600`
- `datagrid.css:52` (row hover 4%) and `:64` (sort 8%)
- `ai-components.css:102`
- `gantt.css:52` and `:107-109`
- `primitives.css:198`
- `components/tasks/tasks.css:39`
- `tracker.css:98`, `:141`, `:271-273` (`.tracker-project` has both a state layer and its own hover)
- `pages/tasks/tasks.css:10`
- `calendar.css:35`, `:88`, `:104`, `:106`, `:135`, `:150`
- `division-storage.css:58-78`
- `dashboard.css:35`
- the primary and danger button hover shadows (`tokens.css:184`, `:189`), if Admin has no such lift

**Make clickable divs real controls** (role, tabIndex, Enter/Space):
- DataGrid rows (`DataGrid.jsx:519-523`)
- `SearchResultCard:79-86`
- `GanttChart:70-74` and `:163-166`, `GanttListView:19-22`
- `TaskBoard.jsx:684-692`

### 1.5 Overlay primitives (this also fixes a live bug)
**Snackbar** (replaces `Toast.jsx` and `primitives.css:29-50`):
- Measured position, colours and motion; an optional action and close button; `role=alert` for errors; duration from a token; top of the z-index ladder.
- **The bug:** when a delete fails, `DataGrid.jsx:341-342` shows the error toast (z 200) while the ConfirmDialog stays open, so the toast is drawn under the ConfirmDialog scrim (z 300, `primitives.css:94`). It also sits under the role/user editor (z 220).

**Shared Dialog base** for `Modal` and `ConfirmDialog`:
- Focus trap (only `ConfirmDialog.jsx:43-58` has one today), Escape closes only the top-most dialog, focus is restored, enter and exit motion.
- The close button becomes an `IconButton` (`Modal.jsx:51`).
- Remove the `maxWidth`/`minWidth` props (`Modal.jsx:7-8,47`; `GridImportDialog.jsx:99`) and the `.pw-grid-import` padding (`datagrid.css:122`).
- One footer mechanism: the Modal `footer` renders `FormActions`.

**Menu/Popover** (anchor positioning, Escape and outside-click close, focus management, tokens). It replaces:
- ActionMenu (`patterns.css:148-154`)
- the DataGrid export menu (`datagrid.css:26-33`), which has no Escape or outside-click close
- the Navbar popovers (`layout.css:491-591`: `#fff`, a Tailwind-slate shadow, fixed `top:56px`)
- the AppLauncher (`app-launcher.css:3-9`)
- AIDropdown, AIAccountMenu and AISessionList (`.ai-menu`, `ai-command-center.css:500-510`)

**SideSheet** (modal and docked). Start from `src/pages/projects/IssueDrawer.jsx`, the only drawer that already has `role=dialog`, `aria-modal` and Escape handling. Use it for:
- the nav drawer (`Layout.jsx:112-117`): no trap, no role, no scroll lock, no exit animation
- the AI panel (`layout.css:1723-1757`)
- the User and Role editors (`layout.css:1378-1697`)

**Tooltip:** extend `[data-pw-tooltip]` (`tokens.css:283-319`) with placement and delay. Migrate:
- the AI `[data-tooltip]` system (`ai-command-center.css:423-457`)
- native `title` tooltips at `Sidebar.jsx:68`, `AppLauncher.jsx:56`, `GanttChart.jsx:72`, `SalesOrderDetail:263,266` and `SalesPipeline:192`
- Add a `tooltip` prop to `Button` and `Chip`.

### 1.6 DataGrid becomes the only list surface
- **Search and filters in one toolbar.** Add a controlled, debounced server-side search (`search`/`onSearchChange`) and put the filter chips in `toolbarActions`, so each list has one toolbar row. Today 29 pages set `searchable={false}`, and 17 of them build a labelled "Cari" Input in a Toolbar above the grid's own toolbar.
- **One set of width helpers.** Add `.pw-toolbar__search` and `.pw-toolbar__filter` to `patterns.css`, then delete the copies at `sales.css:3-4`, `warehouse-movements.css:5-6`, `procurement.css:3-4`, `it-tickets.css:4` and `signatures.css:21`.
- **Pick one filter pattern.** Choose between FilterBar (used on 6 pages) and filter chips, following Admin, and delete the other.
- **One place for the add button.** Either remove the grid's own "Tambah data" button (`DataGrid.jsx:457-461`, 5 pages) or document the grid as the single place in §2.1.
- **Empty and error states:**
  - An empty grid shows `EmptyState` (`DataGrid.jsx:557-563`).
  - A load failure shows `EmptyState tone=error` with "Coba lagi" through the `error` prop, which no page uses today.
  - Delete `.pw-grid__banner` (`datagrid.css:35-39`).
  - Make skeleton widths fixed; they use `Math.random()` today (`Skeleton.jsx:29,45`).
  - Give the skeleton the same shape as the loaded grid (`primitives.css:63-68`).
- **Pager.** Server paging gets the same pager as client paging (`DataGrid.jsx:571-573`). Extract a `<Pager>` so `NotificationCenter.jsx:197-207` can reuse it.
- **New props:**
  - a `flush` variant for use inside `<Card noPadding>`
  - a `footnote` prop
  - `type:'date'|'datetime'|'money'`, formatted by the shared `format.js`
- **Dense controls.** Add a dense size to `Input`/`Select` for the cell editor and the page-size select (`datagrid.css:98-105,116-119`).
- **Retire `DataTable`.** Migrate its 25 importers, then delete `src/components/DataTable.jsx`. This also fixes the two pages where only the first 20 rows can be reached and two different counts show: `Devices.jsx:36-37,87-104` and `DocumentCenter.jsx:41-45,97-120`.

### 1.7 Controls
- **IconButton:**
  - a toggled/expanded state using the selected token
  - a `CountBadge` slot
  - a filled variant, which replaces `.ai-send-button` (`ai-command-center.css:1059-1073`)
  - an `icon` prop that sets the icon size and `aria-hidden`
  - `Button` gets the same `icon` prop (33 Sales icons are missing `aria-hidden`).
- **CountBadge** (dot and number variants) replaces:
  - the local `Badge` function in `Sidebar.jsx:13-21` (rename it; it clashes with the shared Badge)
  - the navbar bell dot
  - `.wm-count`, `.dash-card__count`, `.tracker-column__count`, `.nc-unread`
  - and supplies TabBar counts
- **Chip** replaces `.pw-ai-starter` (`layout.css:1872-1889`), `.ai-suggestion-chip`, `.ai-chip-button` and `.ai-export-chip`.
- **TabBar:**
  - Add icon and count slots, arrow-key focus movement and a disabled style.
  - Migrate the 8 hand-built `role="tablist"` files: `SalesOrders`, `SalesCustomerDetail`, `google/Groups`, `google/chat/Conversation`, `google/chat/DrivePicker`, `admin/IntegrationLogs`, `ai/AICommandCenter`, `warehouse/WarehouseDashboard`.
  - Also migrate the chip or button tabs in `DataAccurate.jsx:24-27` and `MyDrive.jsx:315-316`.
  - Delete `.wm-tabs` (`warehouse-movements.css:58-65`) and `.sales-tabs` (`sales.css:13-20`).
- **SearchField:** one component for the navbar search (`layout.css:603-640`) and the grid search (`datagrid.css:13-22`).
- **Checkbox:** replaces 22 raw checkboxes in 14 files.
- **FileInput / UploadButton:** replaces 4 different file-picker patterns.
- **Text links:** in-text navigation uses `.pw-link` instead of a 40 px text Button (`ProcurementToday:36,66`, `WarehouseToday:64,68`, `ProcurementReorder:59,85`).

### 1.8 New shared display components

| New | Replaces |
|---|---|
| `StatCard` | `sales-kpi`, `sales-stat`, `mgmt-kpi`, `tgt-kpi`, `esc-kpi`, `mflow-kpi`, `tracker-kpi`, `it-stat`, `ga-kpi`. They use weights 700/500/600 and pick either warning or error for the alert colour. |
| `ProgressBar` | `task-progress`, `sales-progress`, `sales-bars`, `tracker-share`, the HRGA bar (`hrga-workflow.css:14-17`: radius-xs, `300ms ease`), targets |
| `ListRow` / `ListItem` | the navbar notification popover and `NotificationItem`, search results, the Gantt list, `.hrga-line`/`.it-line` (identical), approval steps |
| `AttachmentList`, `CommentList`/`ActivityTimeline` | HrgaWorkflowDetail, ItTicketDetail, SubscriptionDetail, TaskDetail, IssueDrawer, `.wm-timeline` |
| `FileCard`, `FileGrid`, `DrivePreviewModal` | DivisionStorage, MyDrive, DocumentCenter (the same code copied 3 times) |
| `Board` / `BoardCard` | TaskBoard, TrackerBoard |
| `ReasonDialog` | `SalesAccurateBatch:173-190`, `WarehouseRecon:65-81`, `WarehouseMovementDetail:404-426` |
| `LineItemsEditor` | `SalesOrderForm:206-227`, `WarehouseMovementForm:271-307` |
| `Breadcrumb` | PageTrail and the Drive path (`MyDrive.jsx:140-170`) |
| `Banner` neutral tone | `wm-notice`, `wm-decision-blocked`, `wm-validation`, `wm-conflict`, `fin-check-missing`, `sig-blocked`, `approval-movement`, `.ai-note`, `.pw-login__error`, and ItTicketForm's borrowed `.pw-grid__banner` |
| One `Spinner` | the LoadingState ring, `Loader2 .ai-spin`, the Gantt `RefreshCw`, plain "Memuat…" text |
| Helpers in `patterns.css` | `.pw-cell` (with `__title`/`__meta`), `.pw-nowrap`, `.pw-section-title`, `.pw-note`; `.pw-row` for chip rows |

- `.pw-section-title` replaces bare `h3.pw-text-sm`, which renders at 700 with browser margins, plus `.wh-section-title` and `.sales-section-title`.
- `.pw-row` replaces `sales-chips`, `wh-chips` and `tracker-chips`.
- Badge should not wrap by default; this removes the `.pc-badge` patch.
- Delete `.coming-soon` (`layout.css:776-821`) and `.pw-empty` (`patterns.css:64`).

### 1.9 Status colours, labels and formatting
- **Add the missing statuses to `src/components/statusTone.js`:**
  - `investigating`
  - document-check results. `DOC_CHECK` maps to `verified` and `needs_review`, which do not exist in the map, so "Lolos" and "Perlu dicek" render grey.
  - batch actions, `geo_mismatch`, price up/down, lead converted/dropped
  - dependency types, notification events, visibility, and workflow/flow types
- **Severity uses `PriorityBadge`** everywhere. `SignaturePrecheckPanel.jsx:9-20` maps high to error, which contradicts the priority map (high is warning).
- **Gantt bars take their colour from `statusTone`.** In `gantt.css:6-12`, `closed` is green where the map says default, and `cancelled` is grey where the map says error.
- **Entity types are shown in a neutral style,** not status colours (`SearchResultCard.jsx:12-26`).
- **Every enum gets an Indonesian label map in its module model:** `device_type`, `billing_cycle`, `signatureType`, `requestType`, `documentType`, category, and the "Open" status in `itTicketModel.js:14`.
- **New `src/components/format.js`** with `formatDate`, `formatDateTime`, `formatMoney` ("Rp") and `formatQty`. An empty value shows a muted "—".
  - DataGrid's date type uses it. Today the grid shows "30/9/2026" (`DataGrid.jsx:66-72`) while `formatDate` shows "30 Sep 2026".
  - Delete the copies: move `trackerModel.js:270` into it, and delete `WarehouseMovements.jsx:42-46`, `WarehouseMovementDetail.jsx:31-40` and `DivisionStorage`/`MyDrive :24-29`. There are also 69 `toLocale*` calls in pages to replace.

### 1.10 Typography and icons
- **Type roles come from the measurements.**
  - Use one overline style; there are 5 variants today.
  - Use weights 400 and 500 only. Weight 600/700 is used at `layout.css:364,394,425,471,536,545,690,701,731,818,1369,1426,1567` and `ai-command-center.css:273,881`.
  - Titles are 22/400 (dialog), 22/500 (page), 18/500 (grid), 18/400 (launcher) and 16/500 (AI panel) today; each maps to one role.
- **Icons go through an `<Icon>` wrapper** with the `--pw-icon-*` sizes. Today lucide icons appear in 13 sizes with stroke widths of 1.6, 1.9, 2 and 3.
  - Admin uses Material Symbols. Any lucide → Material Symbols switch happens only inside the wrapper.
  - Icon containers use 2–3 token sizes; today there are six (32, 36, 40, 48, 52, 56).

### 1.11 CSS structure
- **Move page CSS out of the global `layout.css`:**
  - Login (`:878-1115`) → `src/pages/login/login.css`
  - the User/Role editor (`:1260-1697`) → `src/pages/admin/`
  - ComingSoon → next to its page
  - the AI panel and embedded AI styles (`:1723-1957`) → `src/components/ai/`
- **Move component CSS out of `tokens.css`.** Lines 111-362 hold the state layer, button, field, dialog, card, icon button and tooltip rules. Move them to `src/styles/components.css` so `tokens.css` keeps only `:root`. Define `.pw-card` once; it is split between `tokens.css:241` and `patterns.css:23`.
- **Each component imports its own CSS.**
  - `PrakasaAIToolPanel` stops depending on `.ai-app`/`.ai-spin` from `pages/ai/ai-command-center.css`.
  - Drop the cross-module `sales.css` imports (`ProcurementDashboard.jsx:16`, `DataAccurate.jsx:7`, `ManagementFlow.jsx:12`).
- **Delete dead CSS:**
  - `floatSlow`, the orphan comments at `layout.css:754-775`, and the dead phone padding at `:1207`
  - `sales.css:13-20` and `:27-28`
  - classes used in JSX that were never defined (`sales-funnel-card`, `sales-todo`, `sales-source-note`, `sales-line__sku`, `sales-line__num`, `is-near`, `sp-party`)
  - the unused `hrga-workflow.css` imports

## 2. Page-level changes (after section 1)

**A. Page root → `<Page>`.**
- **Pages to move:** Onboarding, Offboarding, ChecklistTemplates, HrgaWorkflowDetail, ItDashboard, ItTickets, ItTicketDetail, ItTicketForm, Devices, DeviceDetail, SoftwareSubscriptions, SubscriptionDetail, ApprovalInbox, SignatureInbox, SignatureDetail, SignatureAsset, Letterhead, DocumentCenter, TemplateCenter, DivisionStorage, MyDrive, NotificationCenter, Escalations, ManagementDashboard, ManagementFlow, Roadmap, Targets, Projects, ProjectPage, TaskBoard, TaskDetail, GlobalSearch, ActivityLogs, and all Sales, Warehouse, Procurement and Finance pages.
- **Local overrides to remove:** Dashboard (`dashboard.css:3,55`) and Calendar (`calendar.css:13,16`).
- **Local back buttons to delete:** `HrgaWorkflowDetail:171-175`, `SignatureDetail:112-114`, `PaymentRequestDetail:184-188`, `WarehouseMovementDetail:235`, `WarehouseMovementForm:237`, `SalesOrderForm:163`.

**B. List anatomy.** Order: PageHeader → Banner → grid toolbar (search, chips, count, export) → grid → footnote.
- **Pages:** SalesOrders, SalesCustomers, SalesLeads, SalesExchanges, SalesPipeline, SalesAccurateBatch, WarehouseMovements, WarehouseShipping, WarehouseStock, WarehouseAccurateDocs, WarehouseRecon, ProcurementOrders, ProcurementVendors, ProcurementPrices, ProcurementReorder, PaymentRequests, ApprovalInbox, NotificationCenter, DocumentCenter (it has two searches), ItTickets, SignatureInbox.
- **Status filters become chips.** Selects are used today at `SalesOrders:379-385`, `WarehouseMovements:146-155` and `SalesAccurateBatch:119-126`.
- **Other fixes:**
  - Remove the duplicate "Semua" option (`NotificationCenter.jsx:149`).
  - Remove the Terapkan/Filter buttons.
  - Turn filters that ask for typed codes into Selects.
  - Move create buttons into PageHeader (`WarehouseDashboard:152,255`, `WarehouseMovements:131-136`).

**C. Detail pages and when to use a modal.**
- **The rule:** a record with its own ID or number gets a detail page (§2.2); a computed, read-only drill-down gets a SideSheet.
- **Modal detail views to convert:** `ProcurementOrders:68`, `ProcurementVendors:65`, `WarehouseShipping:64`, `WarehouseAccurateDocs:83`, `SalesLeads:237`, and `WarehouseRecon:228`, which opens more modals inside itself.
- **Drill-downs that become sheets:** `WarehouseStock:79`, `ProcurementPrices:56`, `ProcurementReorder:69`.
- **Header fixes:**
  - The status goes in the description: `SalesOrderDetail:222-227`, `SalesCustomerDetail:171-178`, `SalesAccurateBatch:251-253`.
  - At most 1 primary + 2 secondary buttons, the rest in an ActionMenu. `SalesOrderDetail:213-218` has 6 buttons; `DeviceDetail:129-138` has 4 and styles a non-destructive action as danger.
  - Decision actions move into the header: `WarehouseMovementDetail:266-289`, `ApprovalInbox:417-446`, `ItTicketDetail:218-233`.
  - Two cards on SalesCustomerDetail are both titled "Ringkasan" (`:209`, `:257`).
  - The same action gets different button variants on different pages (Edit is text on one page, secondary on others).

**D. Row interaction.**
- **Row click opens the detail on non-Sales lists**, which currently use the Eye button: `WarehouseStock:193`, `WarehouseShipping:117`, `WarehouseAccurateDocs:170`, `WarehouseRecon:365`, the four Procurement lists, AccurateBatchList, and `ApprovalInbox:183-187` (a duplicate of its row click).
- **At most 2 row IconButtons:**
  - 3 actions: `HrgaWorkflowDetail:243-260`
  - 4 Buttons: `ApprovalInbox:417-446`
  - full-size Buttons in rows: `SubscriptionDetail:141-146`
  - 5 buttons: `NotificationItem.jsx:91-115`
  - a text Button as a row action: `WarehouseRecon:135`
- **Mark destructive actions as danger:** `WarehouseMovementForm:298`, `SalesExchanges:119`.

**E. Local status colours → `StatusBadge`.** There are 35 `<Badge tone=` in pages.
- **Finance:** `PaymentRequests:27-32`, `PaymentRequestDetail:26-31`
- **Warehouse:** `WarehouseDashboard:50-55,268-270`
- **Procurement:** `procurementModel.js:115` (via `ProcurementPrices:30`), `ProcurementVendors:28`
- **Sales:** `SalesLeads:50,281`, `SalesOrderDetail:224-226`, `accurateBatchModel.js:14`
- **Other pages:** `ChecklistTemplates:89`, `ApprovalInbox:195,304,329`, `SoftwareSubscriptions:25-27`
- **Components:** `DependencyGraphModal:62,69`, `NotificationItem:71-73`, `AIVisibilityBadge:10-30`

**F. Loading, error and empty states.**
- **Toast-then-redirect on load failure → `EmptyState tone=error` with retry:** `HrgaWorkflowDetail:50-53`, `SignatureDetail:50-52`, `SalesCustomerDetail:127`, `PaymentRequestDetail:62`.
- **A bare Banner replaces the whole page:** `SalesOrderDetail:201`, `SalesAccurateBatch:233`, `SalesOrderForm:168`.
- **Silent failures:** `PaymentRequests:41-54`, `WarehouseDashboard:128,215`, `ItDashboard:20-26`, `Letterhead:26-30`, and the Onboarding, Offboarding, ChecklistTemplates, SoftwareSubscriptions and TemplateCenter loaders.
- **Plain "Memuat…" text:** `SalesOrders:390`, `SalesCustomers:102`, `WarehouseStock:182`.
- **11 muted `<p>` empty messages** become `EmptyState compact`.
- **MyDrive** shows one empty state for an empty folder instead of four (`:239-248`).

**G. Hand-built markup.**
- `<a className="pw-button">` in 6 places → `<Button href>`: `HrgaWorkflowDetail:272`, `DocumentCenter:171`, `DivisionStorage:211`, `MyDrive:287`, `TaskBoard:632`, `PaymentRequestDetail:286`.
- A Card inside a Modal: `ApprovalInbox:321`.
- **Card + DataGrid (three frames around one table) → `Card noPadding` + flush grid:** SalesOrderDetail, SalesCustomerDetail, SalesPipeline, SalesTodo, SalesAccurateBatch, WarehouseMovementDetail, WarehouseToday, ProcurementToday, AccurateQuality, and `ItDashboard:68-108`.

**H. Forms.**
- **Show field errors on the field, not as toasts:** `ApprovalInbox:123`, `SignatureDetail:248`, `NotificationCenter:33`, `SignatureAsset:18`, `Letterhead:47`, `SalesOrderForm:120-124`.
- **Dates as `type=date`,** not text fields with "(YYYY-MM-DD)" in the label: `Devices:114-133`, `SoftwareSubscriptions:102-103`.
- **Pickers instead of typed numeric IDs:** `Devices:132`, `DeviceDetail:205`, `SubscriptionDetail:221,233`, `OffboardingBoard:73`, `HrgaWorkflowDetail:322-338`, `DocumentCenter:125-126`, `TemplateCenter:67-68`.
- **`Button loading` on every submit.** Missing in Finance and the Warehouse checklist/incident tabs; `SalesExchanges:62` and `SalesLeads:293-295` use `disabled` instead.
- **Bug:** at `SalesExchanges:61` the Batal button has no `type="button"` inside a form, so it submits the form.
- **Instructions move from placeholders into `hint`.**

**I. Two modules to rebuild on the standard templates.**
- **Finance:** `PaymentRequests`, `PaymentRequestDetail`, `payment-requests.css`. Problems: "IDR" instead of "Rp", `<pre>` blocks in a monospace font, English and Title Case labels, DataTable, FilterBar.
- **Warehouse checklist and incident tabs** (`WarehouseDashboard:153-175,256-284`). Problems: DataTable, raw ISO dates, raw English codes.

**J. Copy pass.** Indonesian, sentence case, buttons as verb + object, and each PageHeader title equal to its nav label.
- **Pages:** Finance, the Warehouse tabs and modals, IT ("Software Subscriptions", "IT Dashboard", Devices), HRGA, Approvals, Signatures, Documents, "Notification Center", "My Drive Saya", Tasks, GlobalSearch, ActivityLogs, VerifyDocument.
- **Components:** the labels in SearchResultCard and "Depth" in DependencyGraphModal.

**K. Owner decision before any restyling.** `/approvals`, `/documents` and `/templates` are blocked routes (`navigation.js:180-183`), so ApprovalInbox, DocumentCenter and TemplateCenter cannot be opened. The signature pages are reachable only through `DocumentCenter:160-168`, which is itself blocked. Decide: delete or restore.

**L. Not yet audited — needed before claiming "tanpa terkecuali":**
- `src/pages/google/*`: `chat.css` (682 lines), `mail.css`, `google-files.css`, `analytics.css`, `groups.css`
- `src/pages/admin/*`: the list pages, the editors, `IntegrationLogs.css`, `AIProviderSettings.css`
- the body of the `src/pages/ai/AICommandCenter` page

## 3. Guideline gaps and new tests

### Sections to add to `docs/ui-guideline.md`
Each section gets a token table filled from section 4.
1. **Reference and frame:** admin.google.com as the reference; top bar anatomy; nav drawer (width, item height, nesting and expandable groups, selected shape, rail or collapse per breakpoint); page anatomy (gutter, max width, breadcrumb, header-to-content gap, section gap); one back button (PageTrail).
2. **Surfaces and elevation:** which layers get an outline and which a shadow, for page, card, table, menu, dialog, sheet and snackbar; the scrim.
3. **Motion:** duration and easing per component; enter and exit animations both required; one reduced-motion block that covers everything.
4. **The z-index ladder.**
5. **States:** selected, disabled, a single focus ring, link style.
6. **Tables and density:**
   - row heights (default and dense); header case, weight and background
   - toolbar anatomy and the filter pattern; the pager; sticky header
   - empty and error states inside the grid
   - numeric columns right-aligned; date and money formats; "—" for empty cells
   - the rule for row click vs the Eye button (Sales keeps its owner-mandated exception)
7. **Overlays:**
   - dialog sizes and anatomy (padding, title, close button, footer alignment, full screen on phone)
   - the rule for detail page vs side sheet vs modal
   - menus, tooltips, snackbar (position, duration, action)
8. **Icons:** icon set, sizes, stroke, container sizes, `aria-hidden`.
9. **Typography roles** (not just sizes): overline, font family, the weight of `b`/`strong`.
10. **Components the guideline does not mention yet:** the Toolbar/FilterBar decision, TabBar, StatCard, ProgressBar, ListRow, CountBadge, SearchField, Checkbox, FileInput, Pager, SideSheet, Menu, Breadcrumb, Banner neutral tone.
11. **Copy:** sentence case for titles, labels and tabs (§3.2 covers buttons only today); Indonesian labels for every enum; PageHeader title equal to the nav label; empty-state titles without a trailing period.
12. **Print documents:** print tokens for `sales-print.css`. The print exception exists today only in `tableConvention.test.js:11-13`.
13. **Theme:** state explicitly whether there is a dark theme.

### New tests
They go in `test/uiGuideline.test.js` and reuse its `checkBudget` pattern. Each budget starts at today's count, so the suite stays green, and budgets can only go down.

**CSS checks:**
- hex, rgb or rgba outside `tokens.css` (print tokens exempt)
- font-weight of 600 or more
- padding, margin or gap values off the 4/8/12/16/24/32 scale
- literal `z-index` values other than local 0, 1 or -1
- literal durations or easings
- `box-shadow` with a literal colour (elevation must come from `--pw-elev-*` or the divider token)
- `:hover` rules outside the primitives allowlist
- `.prakasa-layout__main` rules that target elements
- disabled opacity not taken from the token
- one module's CSS imported by another module

**JSX checks:**
- raw `<button>`/`<input>` also scanned in `components/`, with an allowlist for the primitives
- `role="tab"` or `role="tablist"` outside TabBar
- in pages: `<Badge … tone=`
- outside `statusTone.js`: `tone:` literals and tone ternaries
- `className="pw-button` on `<a>`
- importing `DataTable` (the budget goes to 0)
- `searchable={false}` next to an Input labelled "Cari"
- native `title=` on lowercase (HTML) tags
- lucide `size={n}` outside the icon tokens or the `<Icon>` wrapper
- `toLocale*` calls or "IDR" in pages
- `<b>`, `<strong>`, or bare `<h3>`/`<h4>` in pages
- the literal text "Memuat…"
- Modal `minWidth`
- a page root that is not `<Page>`

**Cross-checks:**
- Every token named in `docs/ui-guideline.md` exists in `tokens.css`, and every token there is documented.
- Every status literal passed to `StatusBadge` exists in `statusTone.js`. This would have caught `verified` and `needs_review`.
- Optional: each PageHeader title equals the navigation label for its route.

## 4. Values to measure on admin.google.com

**How:** Claude in the browser, using DevTools `getComputedStyle`. Take screenshots and record the date of the capture.

**Properties to record for each element:** font-family, font-size, font-weight, line-height, letter-spacing, text-transform, color, background, border, border-radius, box-shadow, padding, margin, gap, height, width, min-width, max-width, transition, animation, opacity.

**Screen widths:** 1440, 1280, 1024, 768 and 390 px.

**Screens to capture:**
- Home (dashboard cards)
- Directory › Users (the list)
- one user's detail page
- the Groups list
- the Devices list
- a service settings page under Apps
- the audit log / reporting page (its filter bar)
- the "Add new user" dialog
- a delete confirmation dialog
- a row ⋮ menu
- a tooltip on an icon button
- the snackbar shown after saving
- the search suggestions dropdown

- **M1 Fonts:** the font families actually used, the webfont URLs, and which weights are loaded.
- **M2 Text styles** for: page title, breadcrumb, section/card title, body, table header, table cell, meta text, field label, helper and error text, button, chip, tab, nav item, nav section header, dialog title, snackbar, tooltip.
- **M3 Colours:**
  - page, content, card, top bar and nav backgrounds
  - primary and link colours
  - text: primary, secondary, disabled
  - dividers and field outlines
  - error, success, warning
  - selected nav item background and text
  - selected row background
  - hover overlay colour and opacity
  - focus ring colour, width and offset
  - scrim colour and opacity
  - tooltip and snackbar background, text and action colours
- **M4 Top bar:**
  - height, background, and border or shadow (at rest and after scrolling)
  - padding
  - menu (hamburger) button size
  - logo and product-name placement and text style
  - search box: width, max width, height, radius, background (at rest and focused), icon size, placeholder, focus shadow
  - right-side icon buttons: size and spacing
  - avatar size
  - whether the bar stays fixed on scroll
- **M5 Nav drawer:**
  - expanded width
  - how it collapses at each breakpoint (rail, hidden or overlay)
  - item height, and left padding at each nesting level
  - icon size and the gap between icon and text
  - item shape (full pill or right side rounded)
  - selected style and hover colour
  - expand chevron and its animation
  - group separators; how the drawer scrolls
- **M6 Page layout:**
  - content max width, and gutters at each breakpoint
  - breadcrumb position and separator
  - page title position
  - header-to-content gap, section gap, card-to-card gap
  - column widths on two-column detail pages
- **M7 Surfaces:** card radius, border or exact shadow, padding, header height, dividers inside the card.
- **M8 Tables:**
  - the container
  - toolbar height and layout (the filter-chip bar, search)
  - header: height, background, text style, case, sort icon
  - row height, including a density setting if one exists
  - cell padding
  - hover and selected colours; checkbox size; row divider
  - pager layout: rows-per-page select, range text, chevrons
  - sticky header; column resizing
  - where row actions sit, and whether they appear only on hover
  - the empty-table state
- **M9 Buttons:** height, radius, padding, icon size and gap; colours for each variant (filled, outlined, text, tonal); disabled colours.
- **M10 Icon buttons:** size, touch area, icon size, diameter of the hover circle.
- **M11 Inputs:**
  - outlined or filled style; height; radius
  - label position (floating or above)
  - border colours at rest, on hover, on focus and on error; focus border width
  - helper text; dense size; select chevron
- **M12 Chips:** height, radius, padding, outline, selected style (is there a check icon?), text style.
- **M13 Tabs:** height; indicator thickness, width and radius; colours; text style; alignment.
- **M14 Dialogs:**
  - width of each dialog type; radius; padding
  - title and body text styles
  - how actions are aligned and which button variants they use
  - whether there is a close ×
  - max height, and dividers when the content scrolls
  - behaviour on phone
  - open and close animation
- **M15 Side panels** (if Admin uses them): width, elevation, header.
- **M16 Menus:** radius, elevation, item height, padding, min and max width, distance from the anchor, dividers, open and close animation.
- **M17 Tooltips:** background, text colour, radius, padding, font, show and hide delay, offset, placement, max width.
- **M18 Snackbar:** position, width, radius, padding, how long it stays, action and close button, animation.
- **M19 Hover and click effects:** hover, focus and pressed opacity; whether there is a ripple, and its opacity and duration; hover transition timing.
- **M20 Motion timings:** drawer, menu, dialog, snackbar, expand/collapse, tab indicator, progress, page transitions.
- **M21 Elevation values:** top bar, card, menu, dialog, snackbar, FAB.
- **M22 Progress:** linear bar height, colours and radius; spinner size, stroke and speed.
- **M23 Badges:** how statuses appear in Admin tables (pill, or dot + text); count badge size and colour.
- **M24 Icons:** which Material Symbols style (outlined or rounded), its weight, grade and fill; icon sizes in the nav, buttons, tables and top bar.
- **M25 Breakpoints:** the widths at which the nav collapses, the search turns into an icon, and table columns drop.
- **M26 Empty, loading and error states:** layout of each.
- **M27 Stacking order:** does a menu appear over a dialog? Does a snackbar appear over a dialog?
- **M28 Dark theme:** does admin.google.com offer one?

## 5. Risks
- **"100%" has limits.**
  - Google Sans and Google Sans Text are proprietary fonts; check licensing, including whether Google Sans Flex is available to use.
  - Google logos and the "Admin" product name must not be copied. Copy the measurements, not the branding.
- **Some screens have no counterpart in Admin:** chat, the AI workspace, calendar, kanban, Gantt, the Drive browser, print sheets. The rule would be to use the closest Google product with Admin's tokens. The owner has to accept that "100%" covers the frame and the shared components, not these screens.
- **Phone layout cannot be matched 1:1.** Admin is desktop-first. Choose between keeping the 40 px touch-target rule and adopting Admin's denser sizing on desktop only.
- **Global changes hit every page at once.** The deletions in 1.2 and the frame change in 1.3 shift every page. They need before/after screenshots and a real-browser check (owner rule).
- **The DataTable migration changes behaviour.** Moving 25 pages to DataGrid changes how paging and search work, and the Devices and DocumentCenter data loading changes too.
- **The new z-index ladder can reorder overlays:** the AI FAB and panel, the nav drawer, the tracker drawer (z 149/150) and the User/Role editors.
- **The AI area is fragile.** Removing `.ai-ripple` touches 10 AI components in the middle of the streaming UI. The AI panel's styles load only because `AICommandCenter` is imported, so moving its CSS carelessly can break the panel.
- **Changing icon sets touches the whole app.** Switching lucide to Material Symbols is safe only behind `<Icon>`.
- **Test budgets.** New tests must start with today's counts or CI turns red; budgets only go down.
- **Admin's own UI changes over time.** Record the measurement date and keep screenshots. Because every value sits in tokens, re-tuning later stays cheap.
- **Unaudited areas** (2.L) may hide more patterns.
- **Blocked routes.** Don't spend effort on the blocked pages (2.K) until the owner decides.
- **The Sales Eye exception** conflicts with Admin's row-click behaviour. It stays unless the owner changes it.
- **Terminology.** The English-to-Indonesian copy pass may clash with terms staff already use (Approval, Payment request). A glossary decision is needed.

**Suggested order:**
1. Guideline reference change and baseline screenshots.
2. Tokens (1.1), global leak removal (1.2) and the page frame (1.3).
3. Hover/click system (1.4) and overlays (1.5).
4. DataGrid (1.6) and controls (1.7).
5. Display components (1.8) and status/formatting (1.9).
6. Page migrations module by module (section 2).
7. Tune values to the section 4 measurements, then bring the test budgets down to 0.
