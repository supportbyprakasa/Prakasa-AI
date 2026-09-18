# Changelog

## [0.9.0] - 2026-09-18
### Changed
- Manual email/password authentication is now the primary login flow.
- Google OAuth is now optional/secondary and no longer auto-provisions accounts.
- Login accounts are provisioned and controlled by users with `user.manage` (Super Admin by default).

### Added
- Migration `016_manual_primary_auth.sql`: `password_hash`, `must_change_password`, and `last_login_at`.
- bcrypt password hashing.
- `POST /api/v1/auth/login` manual-login endpoint.
- `POST /api/v1/users/:id/reset-password` admin password-reset endpoint.
- One-time `npm run bootstrap:admin` command to create/update the first Super Admin without hardcoding credentials.
- Users admin UI for creating accounts, assigning roles, resetting passwords, and enabling/disabling accounts.
- `VITE_ENABLE_GOOGLE_LOGIN` flag; defaults to `false`.

## [0.8.1] - 2026-09-18
### Fixed
- Sidebar module visibility now follows JWT permissions, matching the bootstrap flow where a newly auto-provisioned user has no module access until roles are assigned.

### Added
- `docs/LOCAL_VERIFICATION.md` with static verification results and explicit runtime blockers for local execution.


## [0.1.0] - 2026-09-18
### Added — Fase 1 (Foundation & Flexible Core)
- Struktur repo backend + frontend
- Migrasi tabel: entities, departments, users, roles, permissions, user_roles, role_permissions, settings, activity_logs, audit_logs
- Google OAuth login → JWT internal
- CRUD Entity, Department, User, Role, Permission (Super Admin)
- Activity Log otomatis untuk create/update/delete
- Endpoint `GET /api/health`
- Konvensi response API standar + middleware requireAuth + global error handler
- Frontend: Login Google, layout sidebar/navbar, admin panel, halaman Activity Log

## [0.2.0] - 2026-09-18
### Added — Fase 2 (Document, Template & AI Core)
- Migrasi: drive_folders, drive_files_metadata, documents, document_templates,
  document_versions, template_placeholders, folder_mapping_rules,
  ai_module_contexts, ai_summaries, ai_actions, context_records, related_records
- Google Drive integration: ensureFolder, uploadFile, copyFile, getFileMeta
- Google Docs API: ekstraksi teks untuk AI
- AI provider abstraction: OpenAI / Gemini / Claude (dipilih via ai_module_contexts)
- Document Center: upload/link/list/detail, versions
- Template Center: CRUD template + placeholders + generate dokumen dari template
- Folder Mapping Rules: rule (entity+department+documentType → folder Drive)
- AI Document Assistant: summarize / check_completeness / check_consistency
- AI Security Principles: isolasi entity, read-only, activity log wajib
- Frontend: Document Center, Template Center, Folder Mapping Rules, AI Panel

## [0.3.0] - 2026-09-18
### Added — Fase 3 (Task, Chat, Approval & Signature)
- Migrasi: boards, board_columns, tasks, task_comments, task_attachments,
  chat_rooms, chat_room_members, chat_messages, notifications, notification_rules,
  approval_matrix, approval_requests, approval_steps,
  signature_requests, signature_placeholders, signature_logs, signed_documents,
  document_verifications, signature_assets
- Task Board ala Trello: CRUD board, kolom, task, komentar
- Chat internal: room division/project/direct, kirim pesan, convert message → task
- Approval: matrix per document type, multi-level, decision (approve/reject/revision)
- Signature: Level 1 & 2 (SOW), signature asset terenkripsi AES-256-GCM,
  generate PDF berita acara + upload ke Shared Drive + verification code
- Notification Center: in-app + optional Google Chat webhook
- AI Security Principles dipatuhi: signature hanya bisa dibuat setelah approval approved,
  signature image tidak dapat diunduh user manapun
- Frontend: Task Board, Chat, Approval Inbox, Signature Inbox, Notification Center

## [0.4.0] - 2026-09-18
### Added — Fase 4 (Sales & Warehouse MVP)
- Migrasi: sales_customers, sales_inquiries, sales_pipeline, sales_pipeline_history,
  sales_visit_reports, sales_followups, sales_sample_requests, sales_quotations,
  field_sales_bot_sessions, field_sales_bot_messages,
  warehouse_checklists, warehouse_inbound, warehouse_outbound,
  warehouse_sample_tasks, warehouse_incidents, warehouse_delivery_proofs
- Sales Pipeline dengan 9 stage (SOW 11.1), history tracking per perubahan stage
- Field Sales Chat Bot: AI mengubah laporan tidak terstruktur → data terstruktur,
  otomatis membuat visit report / follow-up / update stage pipeline
- Sample request → otomatis membuat warehouse_sample_tasks (1:1) + update pipeline
  stage ke 'sample_requested'
- Warehouse: assign task, update status (queued/preparing/ready/delivered),
  delivery proof upload (foto ke Drive), incident report, daily checklist
- Alur lengkap: Buyer Inquiry → Pipeline → Field Sales Report → Sample Request →
  Warehouse Task → Delivery Proof → Auto Follow-up → Notif ke Sales PIC
- Frontend: Sales Pipeline kanban, Customers, Sample Requests, Field Bot Chat,
  Warehouse Dashboard

## [0.5.0] - 2026-09-18
### Added — Fase 5 (IT Governance MVP)
- Migrasi: devices, device_assignments, device_handover_documents,
  device_return_documents, device_maintenance_logs, device_repair_logs,
  device_warranty_logs, software_vendors, software_subscriptions,
  subscription_licenses, subscription_invoices, subscription_renewals,
  subscription_payments, software_assignments, device_software_relations
- Device management: 14 tipe device (SOW 10.1), assign/return, handover/return
  document, maintenance log, repair log, warranty log
- Software subscription: vendor, plan, license per seat, invoice + referensi
  Jurnal.id, payment tracking, renewal request (link ke approval Fase 3)
- AI IT Asset Report (module `it_asset_report`)
- Cron job `itReminders.js` — 6 jenis reminder otomatis (SOW 10.2):
  warranty, renewal, invoice pending, payment pending, idle license,
  device belum dikembalikan
- Frontend: IT Dashboard (KPI cards + tabel reminder), Devices, Subscriptions

## [0.6.0] - 2026-09-18
### Added — Fase 6 (Calendar, Meet & Meeting AI)
- Migrasi: meetings, meeting_participants, meeting_links, meeting_action_items
- Google Calendar API integration (create/update/delete event, auto Meet link)
- Meeting lifecycle: create, update, cancel, attach recording/transcript
- Link meeting ke task/project/customer/document via meeting_links + context_records
- AI meeting summary (module `meeting_summary`): ringkasan + keputusan + action items
- Action items TIDAK otomatis jadi task — user harus konfirmasi via
  `POST /ai/meeting-actions/:id/confirm` (sesuai AI Security Principles)
- Auto notification ke peserta internal saat meeting dibuat / dibatalkan
- Frontend: Meetings list, MeetingDetail (peserta, link, recording, AI summary, action items),
  ContextMeetingTab (embed ke context customer/project)

## [0.7.0] - 2026-09-18
### Added — Fase 7 (Finance & HRGA Workflow Layer)
- Migrasi: finance_workflows, finance_workflow_attachments,
  hrga_workflows, hrga_workflow_tasks, hrga_workflow_attachments,
  hrga_checklist_templates
- Finance: payment request & reimbursement workflow dengan:
  - AI document completeness check (module `document_check`) SEBELUM masuk approval queue
  - Link ke approval_requests (Fase 3)
  - Link referensi ke Jurnal.id (nomor + URL) — TIDAK menduplikasi transaksi akuntansi
  - Tidak ada tabel jurnal/saldo/pajak/akuntansi
- HRGA: onboarding & offboarding workflow dengan:
  - Checklist otomatis (Google Workspace, Shared Drive, device handover/return,
    software license assign/revoke, exit interview)
  - Auto-create Task (Fase 3) per checklist item
  - Link ke device_assignments (Fase 5) & subscription_licenses (Fase 5)
  - Link referensi ke KantorKu HRIS
  - Tidak ada tabel payroll/absensi/cuti/lembur/performance
- Template checklist HRGA (JSON-based) dapat dikonfigurasi
- AI Document Check: rule-based + AI sebagai pelengkap (fail-safe bila AI error)
- Frontend: Finance list & detail, Onboarding board, Offboarding board,
  Workflow detail dengan checklist interaktif

## [0.8.0] - 2026-09-18
### Added — Fase 8 (Advanced Cross-Division & Automation)
- Migrasi: cross_division_links, external_references, decision_logs,
  kb_documents, kb_query_logs, automation_rules, automation_logs,
  ai_briefs, data_classifications
- Customer Workspace: satu halaman gabungan customer + pipeline + sample + quotation +
  meeting + task + finance + activity timeline + decision log
- Cross-Division Workspace generik via context_records (Fase 2)
- Global Search lintas 10+ tipe entitas (document, task, customer, pipeline,
  meeting, device, subscription, finance, hrga, kb, decision)
- AI Knowledge Base / SOP Center:
  - Keyword-based context retrieval (tanpa vector DB — sesuai batasan shared hosting)
  - Visibility: entity / department / role / private
  - AI WAJIB menyebut sumber dokumen; menolak jika tidak ada konteks
- Automation Builder (rule-based):
  - 8 scanner bawaan (task overdue, approval pending, subscription renewal,
    warranty, onboarding/offboarding starting today, sample ready not delivered,
    invoice pending upload)
  - 7 action (create_task, create_notification, update_status, send_google_chat,
    link_records, create_approval, escalate)
  - Dijalankan via cron `automationRunner.js` tiap 15 menit
- Decision Log: catatan keputusan manajemen dengan relasi ke subject_type/subject_id
- Timeline: agregat lintas modul (tasks/meetings/approvals/finance/hrga/subscription)
- AI Daily/Weekly Brief: cron `briefGenerator.js` tiap pagi + endpoint manual
- Overdue Task Scan: cron harian notifikasi ke assignee
- Data Classification: tagging tingkat sensitivitas + tags (pii/financial/hr/legal)
- Management Dashboard: KPI lintas modul + top 5 overdue/aging
- Frontend: Workspaces, GlobalSearch, KnowledgeBase, AutomationBuilder,
  DecisionLog, BriefView, ManagementDashboard
