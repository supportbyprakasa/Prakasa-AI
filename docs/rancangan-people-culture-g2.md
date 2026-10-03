# Rancangan People & Culture Gelombang 2

Status: **rancangan siap dibangun (1 Oktober 2026)**, disusun Claude sebagai Head People & Culture, GA Lead, dan IT Lead atas delegasi owner. Belum ada kode, migrasi, atau data yang dibuat.

Isi dokumen: rancangan teknis baris 2.1 (Onboarding & offboarding siap pakai), 2.2 (Layanan GA), dan 2.3 (Register infrastruktur IT dan nomor telepon/HP perusahaan) di [program-people-culture.md](program-people-culture.md). Rancangan awal dikritik oleh tiga peninjau independen: keamanan & privasi, integritas data & konkurensi, serta produk/UX untuk perusahaan 34 orang. **Semua temuan sudah diterapkan ke spesifikasi di bawah.** Bagian 5 mencatat setiap temuan dan cara penyelesaiannya. Bila ada yang bertentangan, Bagian 5 yang berlaku.

Cara baca:
- **Bagian 1**: keputusan (bahasa Indonesia), berlaku untuk ketiga baris.
- **Bagian 2–4**: spesifikasi teknis per baris (bahasa Inggris, seperti saat diserahkan ke pembangun): model data, endpoint dan izin, halaman UI, provider manajemen, tes, dan gerbang data asli.
- **Bagian 5**: kritik dan penyelesaiannya.
- **Bagian 6**: yang ditunda beserta alasannya.
- **Bagian 7**: nomor migrasi, urutan pembangunan, dan langkah setelah build.

Fakta yang dipakai (diperiksa 1 Oktober 2026, hanya baca): 1 entitas (PFN), 34 akun aktif, migrasi terakhir 107. Data di `hrga_workflows`, `it_tickets`, `devices`, `software_*`, `people_directory`, dan `org_locations` masih 0 baris. Divisi People & Culture berisi 1 Head dan 1 Member, tanpa Supervisor. Management Office punya 5 akun Head, termasuk 1 akun uji. Matrix approval yang aktif hanya untuk Warehouse dan data Accurate.

---


> **Perubahan setelah dibangun (1 Oktober 2026):**
> - Peminjaman kendaraan **tidak** dibangun di Layanan GA. Owner: kendaraan sudah punya aplikasi sendiri, trackcar.prakasafoods.com. Layanan GA hanya memesan ruang; menu "Pinjam kendaraan" membuka TrackCar. Bagian kendaraan di §2.2/§3.5 tidak berlaku.
> - Form "Buat offboarding" menampilkan ringkasan "N perangkat · N lisensi · N nomor" begitu karyawan dipilih (§2.1.6), lewat `GET /hrga/holdings?personKey=` (izin `hrga.request`, dibatasi perusahaan; akun tanpa baris direktori hanya menghitung yang tercatat atas akunnya).


## Bagian 1 — Keputusan

### Batas (tidak berubah dari program)
1. **Hanya PFN.** Semua data dibatasi `req.user.entityId`, tidak pernah dari body atau query. Data entitas lain terbaca "tidak ditemukan". Relasi lintas tabel memakai FK komposit `(entity_id, …)`.
2. **Tidak ada integrasi KantorKu dan tidak ada data pribadi.** Tidak menyimpan absensi, cuti, gaji, rekening, NIK/KTP, NPWP, BPJS, alamat, tanggal lahir, atau nomor HP pribadi. Formulir onboarding tidak lagi meminta telepon pribadi. Lampiran KTP, kontrak, offer letter, dan surat resign ditolak karena tempatnya di KantorKu. Alasan offboarding hanya berupa kategori, tanpa cerita.
3. **Tidak ada kredensial.** Password WiFi, username/password router/NVR/akun, PIN/PUK SIM, kode verifikasi aplikasi CCTV, dan license key tidak disimpan, tidak diimpor, dan tidak ditampilkan. Catatan bebas yang berisi pola kata sandi ditolak server.
4. **Tidak ada perubahan nyata di Google Workspace.** Pembuatan dan penonaktifan akun Google tetap tugas checklist, dengan tautan ke konsol admin dan konfirmasi manual.
5. **Approval lewat mesin approval yang ada, dengan pemisahan tugas.** Pengaju, pembuat, dan orang yang menjadi subjek tidak pernah bisa menyetujui. Yang menyetujui hanya atasan yang punya akun aplikasi aktif dan izin `approval.decide`. Akun yang dikecualikan di direktori (akun uji atau sistem) tidak bisa memutuskan.
6. **Data lama tidak diubah atau dihapus.** Migrasi hanya menambah kolom, tabel, nilai enum, izin, dan aturan matrix. Satu-satunya pencabutan adalah izin `hrga.manage` dari peran People & Culture Member (temuan audit 0.2), mengikuti preseden migrasi 037. Tidak ada data yang diimpor tanpa persetujuan owner.

### Penyetuju (berlaku untuk onboarding, offboarding, dan GA)
7. **Rantai penyetuju:** (a) **atasan langsung** dari direktori, bila punya akun aktif, memegang `approval.decide`, dan bukan pengaju atau subjek; (b) bila tidak memenuhi, **Head divisi** subjek (peran `<divisi>.head`), bila ada minimal satu akun Head selain pengaju atau subjek; (c) bila tidak ada, **Head Management Office**. Bila ketiganya kosong, pengajuan ditolak dengan pesan jelas dan tidak ada approval tanpa penyetuju.
8. Atasan untuk onboarding adalah atasan yang dipilih di formulir. Untuk offboarding, atasan orang yang keluar. Untuk GA, atasan pengaju.
9. Bila tidak diputuskan dalam 24 jam, penyetuju diingatkan. Setelah 48 jam, Head Management Office ikut bisa memutuskan (eskalasi matrix yang sudah ada).

### 2.1 Onboarding & offboarding
10. **Checklist dibuat saat disetujui**, bukan saat draft. Draft hanya menampilkan pratinjau. Tenggat dihitung dari **tanggal mulai** (onboarding) atau **hari terakhir** (offboarding), bukan dari tanggal pembuatan. Tenggat tidak pernah lebih awal dari hari disetujui.
11. **Satu daftar tugas.** Checklist adalah satu-satunya daftar tugas. Tugas tambahan di modul Tasks tidak lagi dibuat.
12. **Penanggung jawab per tim:** IT dan GA memakai PIC yang ditetapkan Head People & Culture di pengaturan (wajib punya izin yang sesuai), Atasan memakai atasan langsung, dan People & Culture memakai PIC workflow.
13. **Terhubung ke direktori:** onboarding yang disetujui membuat atau menautkan orang di direktori dengan tanggal mulai. Orang itu belum dihitung karyawan sebelum tanggal mulai. Offboarding yang disetujui menandai resign dengan tanggal hari terakhir; orang itu tetap tampil "Hari terakhir …" sampai tanggal tersebut. Pembatalan tidak menghapus apa pun: orang baru yang batal masuk ditandai "Dikecualikan" dengan alasan, dan resign dari offboarding yang dibatalkan dikembalikan hanya bila belum diubah orang lain.
14. **Kepemilikan otomatis di offboarding:** setiap perangkat, lisensi, dan nomor perusahaan yang dipegang menjadi satu tugas yang sudah tertaut. Tugas perangkat atau nomor hanya selesai lewat tombol "Terima kembali", bukan dicentang manual.
15. **Izin:** Member People & Culture bisa membuat dan mengajukan, mengubah draft miliknya, dan menyelesaikan tugas yang ditugaskan kepadanya. Mengubah workflow orang lain, menugaskan ulang, dan membatalkan workflow berjalan butuh Supervisor/Head (`hrga.manage`). Atasan di divisi lain bisa melihat dan menyelesaikan tugasnya tanpa akses ke modul.

### 2.2 Layanan GA
16. **Dua jenis layanan:** *Permintaan* (ATK, perbaikan fasilitas, lainnya) dengan target waktu, dan *Peminjaman* (ruang, kendaraan) dengan jadwal.
17. **Approval:** ATK dan perbaikan fasilitas tanpa approval (GA bisa menolak dengan alasan). Biaya perbaikan dibayar lewat pengajuan pembayaran Finance yang sudah ada. **Ruang** langsung terkonfirmasi bila tidak bentrok. **Kendaraan** dan permintaan **Lainnya** butuh approval atasan (keputusan 7).
18. **Target waktu (hari kalender, seperti tiket IT):** ATK 2 hari; perbaikan fasilitas 3 hari (mendesak 1 hari); lainnya 5 hari sejak disetujui. Target disimpan per permintaan saat waktu mulai dihitung, jadi perubahan aturan tidak mengubah riwayat.
19. **Aturan bentrok:** satu ruang atau kendaraan tidak bisa dipesan dua kali di jam yang beririsan. Peminjaman kendaraan yang menunggu approval ikut menahan jadwal. Kendaraan yang belum dikembalikan menahan jadwal sampai diterima kembali. Pemesanan kendaraan yang belum disetujui saat jam mulai otomatis kedaluwarsa.
20. Sumber daya (ruang dan kendaraan) dicatat per lokasi PFN dan dikelola People & Culture Supervisor/Head. Datanya diisi tim GA setelah owner setuju.

### 2.3 Register infrastruktur IT
21. **Register yang dibangun:** Perangkat jaringan, ISP, CCTV, Backup (dengan riwayat pemeriksaan), Review keamanan Google Workspace (snapshot berkala), Nomor telepon & HP perusahaan, serta Vendor IT (memperluas vendor software yang sudah ada). Semuanya per lokasi PFN dan milik divisi People & Culture.
22. **Access Control ditunda.** Tab itu tersembunyi dan kosong di file referensi owner. Sebagai gantinya, offboarding selalu punya tugas "Cabut akses server/NAS dan aplikasi lain".
23. **Perangkat jaringan dipisah dari tabel perangkat pengguna**, supaya angka perangkat tetap sama dengan laporan perangkat owner (69 perangkat pengguna).
24. **Impor dengan pratinjau** hanya untuk tab Network Devices, ISP, dan CCTV dari laporan IT owner. Hanya baris di lokasi PFN yang diimpor, dan baris lain dihitung sebagai dilewati. Backup (1 baris), Vendor (3 baris), dan Google Workspace diisi manual karena lebih cepat. Kolom rahasia tidak pernah dibaca.
25. **Alamat IP dan biaya** hanya terlihat oleh People & Culture (`it.infra.view`). Alamat IP tidak tampil di dasbor, halaman manajemen, pencarian, atau Prakasa AI.

---

## Bagian 2 — Spec 2.1: Onboarding & offboarding ready for use

### 2.1.1 Audit 0.2 findings → fixes
| Finding | Fix |
|---|---|
| `apply-approval` changes status outside the engine, no SoD | Route returns **410 GONE** `APPROVAL_VIA_ENGINE` ("Keputusan dilakukan di menu Approval"). Frontend buttons "Tandai disetujui"/"Mulai proses" removed. Status changes only via the lifecycle hook (§2.1.4). |
| Approval request created without a clear approver (legacy unassigned step decidable by anyone with `approval.decide`) | `submit` uses `approvalEngine.createApprovalRequest` with seeded matrix rules `hrga_onboarding:default` / `hrga_offboarding:default`; refuses `flowType==='legacy'` with 409 `APPROVAL_MATRIX_MISSING`; step 1 approver is then set by the resolver (§2.1.3). |
| Members hold `hrga.manage` | Migration revokes `hrga.manage` from `people_culture.member` (system-template roles), grants it to supervisor/head; `standardOrganization.js` moves it to `supervisor`. Task completion no longer needs `hrga.manage` (responsible-user rule). |
| No tests | §2.1.9. |
| (found while reading) `linkTask` accepts linked ids without checking entity → IDOR | Generic `PATCH …/tasks/:taskId/link` returns 410; replaced by typed actions that bind entity in SQL. |
| `generateWorkflowNumber` uses COUNT → duplicate number under concurrency | `nextNumber()` helper: `GET_LOCK('seq:<prefix>:<entity>', 5)` + `MAX(seq)+1` + UNIQUE backstop + one retry on `ER_DUP_ENTRY`. Shared with GA (`GA-`, `PJM-`). |
| Due dates computed from creation day | Relative to join/last day (decision 10). |
| `update`/`updateTask`/`remove` log `entityId: null`; logs outside the transaction | Logs written with the same `conn` inside the transaction, `entityId` always set. |
| Tasks editable while draft/pending; workflow auto-complete races | Task writes only when workflow `approved`/`in_progress`; workflow row `SELECT … FOR UPDATE` before task update and completion recount. |
| Personal data: `employee_phone`, attachment types `id_document/contract/offer_letter/resignation_letter`, free-text `reason` | API stops accepting them (columns kept, unused, 0 rows today). Attachment types allowed: `handover_note`, `other`; banner on upload. Reason → `reason_code`. |

### 2.1.2 Data model — migration `108_hrga_wave2.sql`
Idempotent (information_schema guards like 107), additive only.

**`hrga_workflows`** ADD:
- `person_id INT UNSIGNED NULL` + `CONSTRAINT fk_hrga_wf_person FOREIGN KEY (entity_id, person_id) REFERENCES people_directory(entity_id, id)`, `KEY (entity_id, person_id)`.
- `person_created TINYINT(1) NOT NULL DEFAULT 0` — 1 when the approval created the directory row (drives cancel behaviour).
- `needs JSON NULL` — onboarding needs: `{google:bool, app:bool, device:'laptop'|'pc'|'none', licenses:[subscriptionId…], phone:'mobile'|'ip_phone'|'none', desk:bool, idCard:bool}` (validated by zod; ids checked against the entity).
- `reason_code ENUM('resign','contract_end','other') NULL` (offboarding).
- `planned_work_email VARCHAR(190) NULL` (company domain only via wave-1 `workEmailDomains()`; lowercased; CHECK lower/trim like directory).
- `version INT UNSIGNED NOT NULL DEFAULT 1`, `submitted_at`, `approved_at`, `cancelled_at TIMESTAMP NULL`, `cancelled_by INT UNSIGNED NULL FK users`, `cancel_reason VARCHAR(255) NULL`, `approver_basis ENUM('manager','division_head','management_office') NULL`.
- `open_person_key INT UNSIGNED GENERATED ALWAYS AS (IF(deleted_at IS NULL AND status IN ('draft','pending_approval','revision_requested','approved','in_progress'), person_id, NULL)) STORED` + `UNIQUE uq_hrga_open_person (entity_id, workflow_type, open_person_key)` — one running onboarding/offboarding per person.

**`hrga_workflow_tasks`** ADD:
- `category` ENUM extended (appended, existing values unchanged): `'app_account','app_account_deactivation','phone_line','phone_line_return','desk_setup','id_card','id_card_return','access_revoke','team_orientation'`.
- `owner_group ENUM('it','ga','manager','pc') NOT NULL DEFAULT 'pc'`, `sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0`.
- `linked_subscription_id INT UNSIGNED NULL FK software_subscriptions` (onboarding licence task: which product to give).
- `linked_it_ticket_id INT UNSIGNED NULL FK it_tickets`, `linked_phone_line_id INT UNSIGNED NULL` (FK added in 110).
- `skipped_reason VARCHAR(255) NULL` + `CHECK (status <> 'skipped' OR CHAR_LENGTH(TRIM(COALESCE(skipped_reason,''))) > 0)`.
- `KEY (responsible_user_id, status, due_date)`.

**`hrga_checklist_templates`** ADD `department_id INT UNSIGNED NULL FK departments`, `updated_by`, `active_key INT UNSIGNED GENERATED ALWAYS AS (IF(is_active=1, COALESCE(department_id,0), NULL)) STORED`, `UNIQUE (entity_id, workflow_type, active_key)` — at most one active template per type per division (0 = entity default). Item JSON: `{category, title, description?, ownerGroup, offsetDays (-30..30), requires?: 'google'|'app'|'device'|'licenses'|'phone'|'desk'|'idCard'}`. Holdings items (device/licence/phone returns) are never in templates; they are generated from data.

**`people_directory`** ADD `starts_on DATE NULL` (after status); MODIFY `resigned_on_source ENUM('entered','import','account','offboarding') NULL` (value appended; CHECK unaffected).

**Settings**: `settings` row key `people_culture.pic`, value `{"itUserId":n|null,"gaUserId":n|null}` per entity (no schema change).

**Permissions** (+ `standardOrganization.js` mirror): revoke `hrga.manage` from `people_culture.member`; grant to `people_culture.supervisor`/`head`. `hrga.view`, `hrga.request` stay with member. `hrga.approve`/`hrga.complete` no longer gate anything (kept, unused — no data removal).

**Approval matrix seed** (pattern of 033, inserted only if no active rule for the request type): `hrga_onboarding:default`, `hrga_offboarding:default` — entity 1, `department_id NULL`, level/order 1, `approver_role_id = management_office.head`, `escalation_role_id = management_office.head`, `reminder_after_hours 24`, `escalate_after_hours 48`, `is_required 1`, `flow_type 'sequential'`.

### 2.1.3 Services
`backend/src/services/approverResolver.service.js` (shared with 2.2):
```
resolveApprover(conn, { entityId, managerPersonId, departmentId, excludeUserIds })
  → { userId, roleId, basis }   // exactly one of userId/roleId
```
Order per decision 7. "Eligible user" = `users.entity_id = entityId AND status='active' AND deleted_at IS NULL`, holds `approval.decide` through `user_roles→role_permissions`, not in `excludeUserIds`, and their directory row (if any) is not `kind='excluded'`. A role qualifies when it has ≥1 eligible user. Throws 409 `APPROVER_MISSING`. After `createApprovalRequest`, the step at `order_index = 1` is updated in the same transaction: `SET approver_user_id=?, approver_role_id=?` (the matrix rule stays attached, so the reminder/escalation job keeps working — same technique as `salesAccurateBatches`).

`backend/src/services/hrgaWorkflow.service.js` (controller becomes thin; every function takes `conn` so the real-data gate runs it inside one transaction):
- `create`, `updateDraft` (requester or `hrga.manage`; status `draft|revision_requested`; `version` check), `removeDraft` (soft delete), `checklistPreview`.
- `submit`: lock row; status `draft|revision_requested`; validate (onboarding: name, department, join date ≥ today − 7, manager person in entity; offboarding: `person_id` required, person active, last day ≥ today − 30); `excludeUserIds = [requester, created_by, subject's user_id]`; create approval + set approver; `status='pending_approval'`, `submitted_at`, `approver_basis`; notify active step users (`approvalNotify.notifySteps`, excluding requester).
- `withdraw` (requester, `pending_approval`): new engine helper `approvalEngine.withdrawRequest({approvalRequestId, actorUserId, note, conn})` sets request `cancelled` and pending steps `skipped` (note required); workflow back to `draft`.
- `cancel` (`hrga.manage`, `approved|in_progress`, reason required): open tasks → `skipped` ("Workflow dibatalkan"); directory reverts (decision 13): onboarding with `person_created=1` → `kind='excluded'`, `excluded_reason='Onboarding dibatalkan <number>'`; offboarding → if directory row still `status='resigned' AND resigned_on_source='offboarding' AND resigned_on = last_working_date` → `status='active'`, resign fields NULL; else untouched with a banner. Active device assignments created by tasks are listed, never auto-returned.
- Lifecycle hooks registered in `approvalSubjectLifecycle.service.js` for subject type `hrga_workflow` (request types `hrga_onboarding`, `hrga_offboarding` also registered → manual creation through `/approvals` refused):
  - `assertCanDecide`: lock workflow; must be `pending_approval` with matching `approval_request_id` (else 409 `STALE_APPROVAL`); actor ∉ {requested_by, subject user}; actor's directory row not excluded → 403 `SELF_APPROVAL_FORBIDDEN` / `APPROVER_EXCLUDED`; denial logged.
  - `canUserDecide`: same predicate, for queues and the home card.
  - `applyApprovalDecision`: `approved` → `status='approved'`, `approved_at`, then **in the same transaction**: `ensureDirectoryPerson`, `generateChecklist`; `rejected` → `rejected`; `revision_requested` → `revision_requested`.
  - `afterDecision`: activity log + notifications (requester; every responsible user "Tugas onboarding/offboarding untuk Anda").
- `ensureDirectoryPerson(conn, wf)`:
  - Onboarding: if `person_id` set (re-hire or pre-existing row) → reuse; if that row is `resigned` → reactivate (status active, resign fields NULL) and set `starts_on`. Else match `planned_work_email` → wave-1 matching (`email → name_key`; a name-only match was already shown in the draft as "kemungkinan sama dengan …" and resolved by P&C choosing a person or "orang baru"). New row: `full_name`, `position`, `department_id`, `manager_id`, `location_id`, `work_email`, `starts_on = join_date`, `kind='employee'`; `person_created=1`. Lock `GET_LOCK('people_directory:<entity>')` like wave 1.
  - Offboarding: if the row is `active` → `status='resigned'`, `resigned_on = last_working_date`, `resigned_on_source='offboarding'`; if already resigned → untouched.
  - Directory listing/headcount helpers (wave-1 `peopleDirectory.service`) become date-aware: counted as employee iff `kind='employee' AND (starts_on IS NULL OR starts_on <= todayWib) AND (status='active' OR resigned_on >= todayWib)`. Badges: "Bergabung 12 Okt" (starts_on in future), "Hari terakhir 15 Okt" (resigned_on ≥ today).
- `generateChecklist(conn, wf)`: template = active template for (type, department) → entity default → built-in default; items filtered by `requires` vs `needs`; licence items one per selected subscription (`linked_subscription_id`); offboarding adds holdings items (below). Due = `max(base + offsetDays, approvalDayWib)`. Responsible per decision 12; if the PIC is unset or lacks the permission, the task stays unassigned and the workflow PIC is notified "Tugas IT belum punya penanggung jawab".

**Built-in templates** (title Indonesian, `offsetDays` relative to base day):

| Type | Group | Category | Title | Offset | Requires |
|---|---|---|---|---|---|
| ON | it | google_workspace_access | Buat akun Google Workspace (konsol admin) | −2 | google |
| ON | it | app_account | Buat akun Prakasa Workspace | −1 | app |
| ON | it | shared_drive_access | Beri akses Shared Drive divisi | 0 | google |
| ON | it | device_handover | Serahkan perangkat kerja | 0 | device |
| ON | it | software_license | Berikan lisensi <produk> (per produk) | 0 | licenses |
| ON | it | phone_line | Serahkan nomor telepon/HP perusahaan | 0 | phone |
| ON | ga | desk_setup | Siapkan meja kerja | −1 | desk |
| ON | ga | id_card | Siapkan kartu identitas/akses | 0 | idCard |
| ON | manager | team_orientation | Orientasi tim dan tugas pertama | 0 | — |
| ON | pc | email_account | Kirim informasi hari pertama | −1 | — |
| OFF | it | account_deactivation | Nonaktifkan akun Google Workspace (konsol admin) | 0 | — |
| OFF | it | app_account_deactivation | Nonaktifkan akun Prakasa Workspace | 0 | person has account |
| OFF | it | device_return | Terima kembali <perangkat> (per active assignment, linked) | 0 | holdings |
| OFF | it | software_license | Cabut lisensi <produk> (per assigned licence, linked) | 0 | holdings |
| OFF | it | phone_line_return | Terima kembali nomor <nomor> (per line, linked) | 0 | holdings |
| OFF | it | access_revoke | Cabut akses server/NAS dan aplikasi lain; ganti password bersama yang ia ketahui (di luar aplikasi) | 0 | — |
| OFF | ga | id_card_return | Terima kembali kartu identitas/akses | 0 | — |
| OFF | manager | document_handover | Serah terima pekerjaan dan dokumen | −1 | — |
| OFF | pc | exit_interview | Exit interview | −1 | — |

Holdings of the leaver = active `device_assignments` (`person_id` = row, or `assigned_to` = row's user), `subscription_licenses` with `assigned_to` = row's user and status `assigned|idle`, `it_phone_lines` with `person_id` = row and status `active` (after 110).

**Task rules** (`updateTask`, any authenticated user; service decides):
- Who: the task's `responsible_user_id`, or `hrga.manage`. Others → 404 if they cannot read the workflow, else 403.
- When: workflow `approved|in_progress` only (409 otherwise). First change moves `approved → in_progress`.
- `completed` refused (409 `USE_TASK_ACTION`) for `device_handover`, `device_return`, `phone_line`, `phone_line_return`, and `software_license` while the linked record is not yet in the target state — those complete through actions. `skipped` always allowed with reason (e.g. device lost → IT sets device status Hilang separately).
- Google items (`google_workspace_access`, `account_deactivation`): completion requires `confirmedInAdminConsole: true`; UI shows the static link `https://admin.google.com/ac/users` (constant `GOOGLE_ADMIN_USERS_URL`, opened `target=_blank rel=noreferrer`; never in notifications, which stay internal URLs).
- After each change: recount in the same transaction under the workflow row lock; all tasks `completed|skipped` → workflow `completed`, `completed_at`.

**Task actions** (one transaction each: lock workflow → lock task → domain write → link → complete task → log):
| Action | Endpoint | Extra permission | Effect |
|---|---|---|---|
| Serahkan perangkat | `POST /hrga/workflows/:id/tasks/:taskId/device-handover {deviceId, expectedReturnDate?}` | `device.assign` | `deviceLifecycle.openAssignment` with holder = directory person (or their account); device must be `available` in entity; sets `linked_device_assignment_id`. |
| Terima kembali perangkat | `…/device-return {conditionOnReturn, notes?}` | `device.assign` | Same logic as `deviceAssignments.returnDevice` (extract into `deviceLifecycle.returnAssignment(conn, …)`); assignment must be the linked one and `active`. |
| Berikan / cabut lisensi | `…/license-assign {licenseId}` / `…/license-revoke` | `subscription.license.manage` | Reuse licence service logic (extract `assignLicense(conn,…)`/`revokeLicense(conn,…)`); assign requires the person to have an app account (409 `ACCOUNT_REQUIRED`, "Buat akun Prakasa Workspace dulu"); licence must belong to `linked_subscription_id` (onboarding). |
| Serahkan / terima kembali nomor | `…/phone-line {phoneLineId}` / `…/phone-line-return` | `it.infra.manage` | Sets/clears holder on `it_phone_lines` (status active/spare). |
| Buat tiket IT | `…/it-ticket {category:'new_device_request'|'access_software', title, description}` | — (responsible or `hrga.manage`) | Creates an IT ticket through `itTicket.service.createTicket` (requester = actor, department = new hire's division), sets `linked_it_ticket_id`; task stays open. Used when no spare device exists. |
| Tambah kepemilikan ke checklist | `POST /hrga/workflows/:id/holdings-sync` | `hrga.manage` | Offboarding: adds return tasks for holdings acquired after approval (idempotent by linked id). |

### 2.1.4 Endpoints
| Method & path | Guard | Notes |
|---|---|---|
| `GET /hrga/workflows?type&status&q&departmentId&page` | `hrga.view` | P&C list. |
| `GET /hrga/workflows/:id` | read rule | Read rule: `hrga.view`; OR responsible for a task of it; OR the employee's manager; OR requester; OR `management_dashboard.view`; OR `management_dashboard.division` and `wf.department_id = user.departmentId`. Non-`hrga.view` readers get the **limited DTO**: no KantorKu reference, attachments, notes, reason. Otherwise 404. |
| `GET /hrga/workflows/:id/checklist-preview` | read rule | Draft only. |
| `POST /hrga/workflows` | `hrga.request` | Body without `entityId`, `employeePhone`, `employeeDivision`, `autoCreateLinkedTasks` (zod `.strict()` → 400). |
| `PATCH /hrga/workflows/:id` | `hrga.request` + (requester or `hrga.manage`) | `version` required. |
| `DELETE /hrga/workflows/:id` | `hrga.request` + (requester or `hrga.manage`) | Draft only, soft. |
| `POST /hrga/workflows/:id/submit` | `hrga.request` | Old path `/submit-approval` kept as alias. |
| `POST /hrga/workflows/:id/withdraw` | requester | Note required. |
| `POST /hrga/workflows/:id/cancel` | `hrga.manage` | Reason required. |
| `POST /hrga/workflows/:id/apply-approval` | — | **410**. |
| `PATCH /hrga/workflows/:id/tasks/:taskId` | auth + task rule | `{status, notes, skippedReason, confirmedInAdminConsole}`. |
| `PATCH /hrga/workflows/:id/tasks/:taskId/assign` | `hrga.manage` | Same-entity active user. |
| `PATCH /hrga/workflows/:id/tasks/:taskId/link` | — | **410**. |
| Task actions | see §2.1.3 | |
| `POST /hrga/workflows/:id/attachments` | `hrga.manage` | Types `handover_note|other`; Shared Drive only (rule 1.0). |
| `PATCH /hrga/workflows/:id/kantorku-reference` | `hrga.manage` | Unchanged (link only); UI label "Referensi diperbarui" instead of "synced". |
| `GET/POST /hrga/checklist-templates`, `PATCH /hrga/checklist-templates/:id` | view: `hrga.view`; write: `hrga.checklist_template.manage` | Deactivating = `is_active=0`; never delete. |
| `GET/PUT /people/settings/pic` | `hrga.checklist_template.manage` | Validates IT PIC holds `device.assign`, GA PIC holds `ga.request.process`; active user of the entity. |

### 2.1.5 Reminders and notifications
New daily job `backend/src/jobs/peopleCultureReminders.js` (cPanel cron 07:00 WIB, same wrapper as `itReminders`), every notification with `dedupeKey`:
- Task due tomorrow / today → responsible (`hrga_task_due:<taskId>:<dateWib>`).
- Task overdue → responsible + workflow PIC on day 1, then every 3 days (`hrga_task_late:<taskId>:<floor(daysLate/3)>`).
- Offboarding: last day is tomorrow and access/asset items are open → PIC + manager (`hrga_lastday:<wfId>`).
- Approval reminders are the existing `approvalReminders` job (matrix 24/48 h).
Event labels added to `frontend/src/components/notifications/notificationModel.js`: `hrga.task_assigned`, `hrga.task_due`, `hrga.task_overdue`, `hrga.last_day_open`, `hrga.rejected`, `hrga.revision_requested`.

Work summary (`workSummary.controller.js` `hrga()`): the "Tugas onboarding/offboarding untuk Anda" card no longer requires `hrga.view` (managers in other divisions). The "menunggu persetujuan Anda" card uses `lifecycle.canUserDecide` instead of `hrga.approve`.

### 2.1.6 UI (admin-console templates, `docs/ui-guideline.md`)
- **`/hrga/onboarding`, `/hrga/offboarding`** (§3.1 list): `PageHeader` action "Buat onboarding"/"Buat offboarding"; `DataGrid` with status chips (Draft, Menunggu approval, Berjalan, Selesai, Ditolak/Dibatalkan) and counts; columns: Nomor, Karyawan, Divisi, Mulai / Hari terakhir (`formatDate`), Status (`StatusBadge`), Progres (`ProgressBar` + "5/9"), Lewat tenggat (count, `--pw-error` note). Row click → detail.
- **Create/edit** (`FullScreenDialog`, §3.3): Onboarding sections *Karyawan* (Nama, Jabatan, Divisi, Atasan langsung — directory `Select`, Lokasi, Email kerja rencana, "Sudah ada di direktori?" person `Select` for re-hire), *Jadwal* (Tanggal mulai), *Kebutuhan* (`Switch`: Akun Google, Akun Prakasa Workspace, Kartu akses, Meja; `Select` Perangkat: Laptop/PC/Tidak; `Select` Nomor perusahaan: HP/Telepon IP/Tidak; multi-select Lisensi from active subscriptions), *People & Culture* (PIC). Offboarding: *Karyawan* (directory `Select`, then a read-only "Kepemilikan" summary: N perangkat, N lisensi, N nomor), *Hari terakhir*, *Alasan* (`Select` Resign/Kontrak selesai/Lainnya), PIC. A `Banner tone="info"`: "Data pribadi, kontrak, dan dokumen gaji disimpan di KantorKu, bukan di sini."
- **Detail `/hrga/workflows/:id`** (§3.2): eyebrow "Onboarding"/"Offboarding", title employee name, description status + number + date. Header actions by state: Ajukan (draft), Tarik pengajuan (pending, requester), Setujui / Tolak / Minta revisi (when `canDecide` — calls `/approvals/:id/decide`), ⋮ `ActionMenu` (Ubah, Batalkan workflow, Referensi KantorKu, Tambah kepemilikan ke checklist). Main column: Card "Checklist" grouped by IT / GA / Atasan / People & Culture, each row: title, responsible, due (`--pw-error` when late), `StatusBadge`, row action button (Serahkan perangkat / Terima kembali / Berikan lisensi / Buka konsol admin / Tandai selesai) + ⋮ (Lewati dengan alasan, Tugaskan ke…, Buat tiket IT). Draft shows Card "Pratinjau checklist" (read-only). Card "Riwayat approval" (existing approval steps). Aside: Card "Ringkasan" (`KeyValue`), Card "Kepemilikan" (offboarding), Card "Lampiran" (P&C only).
- **Dialogs**: Serahkan perangkat (`Modal md`: device `Select` filtered to Cadangan, expected return); Terima kembali (`Modal sm`: kondisi, catatan); Tandai selesai Google (`ConfirmDialog` with `Checkbox` "Sudah dilakukan di konsol admin Google"); Lewati (`ReasonDialog`).
- **`/hrga/checklist-templates`**: list per type + division; `FullScreenDialog` editor (rows: Tim, Kategori, Judul, Hari relatif, Hanya bila); Card "Penanggung jawab" (IT PIC, GA PIC) for the Head.
- **Directory**: badges "Bergabung …"/"Hari terakhir …"; profile sheet links to the running workflow (P&C only).
- `statusTone.js`: no new keys needed for workflows (existing); task labels `task_skipped` → "Dilewati".

### 2.1.7 Management provider (`providers/hrga.js`)
- `ACCESS_ASSET` extended to `('account_deactivation','app_account_deactivation','device_return','software_license','phone_line_return','access_revoke','id_card_return')` — escalation `hrga_offboarding_late` therefore covers "devices/access not returned by the last day".
- New escalation **`hrga_resigned_access_open`** (25 chars) "Resign tanpa offboarding, akses masih terbuka": a directory person `status='resigned'`, `resigned_on < today − 3`, kind ≠ excluded, with no offboarding workflow (any status except rejected/cancelled/deleted), who still has an active app account, an assigned licence, or an active phone line (devices are already `it_device_resigned_holder`). Scope `COALESCE(u.department_id, p.department_id)`; sourceId = person id × 100000 + DATEDIFF(resigned_on,'2000-01-01'); `locate` from the person row; link `/people/directory/p<id>` (wave-1 directory key).
- New metric **`hrga_ready_on_day_one`** "Siap di hari pertama" (%, higher, cumulative false, emptyIsZero false): onboardings with `join_date` in period and `approved_at` ≤ join date, share whose IT+GA tasks were all completed/skipped by the join date.
- Existing escalations, metrics, KPIs unchanged.

### 2.1.8 AI and search
`aiToolRegistry` entries for onboarding/offboarding keep `hrga.view`; the limited DTO is what tools receive for non-P&C callers. No new AI tools.

### 2.1.9 Tests (`node --test test/`)
- `hrgaWorkflow.test.js`: apply-approval 410; link 410; strict body rejects `entityId`/`employeePhone`/attachment `id_document`; member without `hrga.manage` cannot edit someone else's draft but can complete own task; manager outside P&C reads limited DTO and completes own task; Warehouse Head reads own-division workflow, not another's (404); task changes refused in draft/pending; device task completion refused (`USE_TASK_ACTION`); Google completion requires confirmation; skip requires reason; concurrent completion of the last two tasks → workflow completed once (two connections); number generation under 10 parallel creates → unique; due dates relative to join/last day and floored at approval day; checklist only at approval; `needs` filters items; licence item per subscription; offboarding holdings → linked tasks; cancel → excluded/reverted per rule; open-person UNIQUE blocks a second offboarding.
- `approverResolver.test.js`: manager eligible; manager without account / without `approval.decide` / is requester / excluded → division Head; division Head is the subject → Management Office; no one → 409; never returns the requester or subject.
- `hrgaLifecycle.test.js`: requester, subject, excluded account denied at decide (and logged); stale approval 409; approve creates directory row with `starts_on` + checklist in the same transaction (rollback on failure leaves approval pending).
- `peopleDirectory` headcount date-aware (starts_on future not counted; resigned_on future counted, badge).
- Provider: shape, `scope` in SQL with entity bound first, `locate` for `hrga_resigned_access_open`, episode id, key lengths.
- Migration text: additive only, `hrga.manage` revoke limited to `people_culture.member` system roles.
- Frontend: model tests for grouping, action availability per state/permission, Google confirm, preview.

### 2.1.10 Real-data gate
On the real database **inside one transaction that is rolled back**: (1) resolver for each of the 34 active users as GA requester and as onboarding manager → table of basis counts; zero unresolved, zero self-approval, list every user who could decide via the Management Office role (flag test accounts); (2) a fictional PFN new hire created → submitted → approved through the real decide path by a resolved approver → directory row with `starts_on`, checklist items/responsibles/dues printed; (3) offboarding of a real directory person → holdings tasks, a device return action, resign written; (4) all management providers called for entity-wide and each division (0 errors); (5) Accurate archive checksums unchanged. Headless (mocked API): P&C Head, P&C Member, Warehouse Head as manager with a task, Sales member (no access) at 1280 and 390; no console errors, no overflow.

---

## Bagian 3 — Spec 2.2: Layanan GA

### 3.1 Data model — migration `109_ga_services.sql`
All tables `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`, `UNIQUE (entity_id, id)`, same-entity composite FKs, `created_by/updated_by`, timestamps. No deletes (deactivate/cancel).

**`ga_resources`**: `id, entity_id, location_id NOT NULL (FK (entity_id,location_id)→org_locations), kind ENUM('room','vehicle'), name VARCHAR(120), capacity SMALLINT UNSIGNED NULL, plate_number VARCHAR(20) NULL, plate_key VARCHAR(20) GENERATED (UPPER(REPLACE(plate_number,' ',''))) STORED, is_active TINYINT(1) DEFAULT 1, notes VARCHAR(255) NULL`. `UNIQUE (entity_id, kind, name)`, `UNIQUE (entity_id, plate_key)`. CHECKs: `kind='vehicle' OR plate_number IS NULL`; `kind='room' OR capacity IS NULL`; trimmed name.

**`ga_requests`**: `id, entity_id, department_id (requester's division, FK), request_number VARCHAR(30) (GA-YYYYMM-NNNN, UNIQUE(entity_id, request_number)), request_type ENUM('atk','facility_repair','other'), title VARCHAR(190), description VARCHAR(2000) NULL, location_id NOT NULL (composite FK), area VARCHAR(120) NULL (repair: "AC ruang meeting"), urgency ENUM('normal','urgent') DEFAULT 'normal', requester_user_id FK users, assigned_to NULL FK users, status ENUM('pending_approval','open','in_progress','done','rejected','cancelled'), approval_request_id NULL FK, approver_basis ENUM(...) NULL, sla_days TINYINT UNSIGNED NULL, due_at DATETIME NULL (UTC), done_at DATETIME NULL, resolution_note VARCHAR(500) NULL, rejected_reason VARCHAR(255) NULL, cancel_reason VARCHAR(255) NULL, cancelled_at DATETIME NULL, version INT UNSIGNED DEFAULT 1`. CHECKs: `status<>'done' OR (done_at IS NOT NULL AND resolution_note IS NOT NULL)`; `status<>'rejected' OR rejected_reason IS NOT NULL`; `status NOT IN ('open','in_progress','done') OR due_at IS NOT NULL`. KEYs `(entity_id, status, due_at)`, `(requester_user_id, status)`.

**`ga_request_items`** (ATK lines): `id, request_id FK, item_name VARCHAR(120), qty DECIMAL(10,2) CHECK (qty > 0), unit VARCHAR(20), sort_order`. Max 20 lines (service).

**`ga_request_attachments`**: `id, request_id FK, drive_file_id, web_view_link, name, mime_type, size, uploaded_by, created_at` — images/PDF ≤ 10 MB, Shared Drive only (rule 1.0), max 3 per request.

**`ga_bookings`**: `id, entity_id, department_id (borrower's division), booking_number VARCHAR(30) (PJM-YYYYMM-NNNN, UNIQUE per entity), resource_id (FK (entity_id,resource_id)→ga_resources), resource_kind ENUM('room','vehicle') (copied, CHECK matches via service), requester_user_id, starts_at DATETIME, ends_at DATETIME (UTC), purpose VARCHAR(255), destination VARCHAR(190) NULL, needs_driver TINYINT(1) DEFAULT 0, driver_person_id NULL (FK (entity_id,driver_person_id)→people_directory), status ENUM('pending_approval','confirmed','in_use','returned','rejected','cancelled','expired'), approval_request_id NULL, approver_basis NULL, checked_out_at, checked_out_by, returned_at, returned_by, return_note VARCHAR(255) NULL, cancel_reason VARCHAR(255) NULL, version`. CHECK `ends_at > starts_at`. KEYs `(resource_id, starts_at, ends_at)`, `(entity_id, status, starts_at)`.

**Permissions**: `ga.request.create` (every standard role + Super Admin: own requests and bookings), `ga.request.process` (People & Culture member+), `ga.resource.manage` (People & Culture supervisor+). `standardOrganization.js` mirrored (`COMMON_MEMBER` gets `ga.request.create`).

**Matrix seed**: `ga_vehicle_booking:default`, `ga_request_other:default` (same shape as 108).

### 3.2 Rules
- **Status machine (requests)**: create → `open` (atk, facility_repair; `sla_days`/`due_at` set now) or `pending_approval` (other). Approval approved → `open` with clock from `approved_at`; rejected → `rejected` (note = reason). `open → in_progress → done` by GA (`done` requires resolution note); `open|in_progress → rejected` by GA (reason); requester cancels while `pending_approval|open` (pending → engine `withdrawRequest`). No closed/reopen state.
- **SLA**: `SLA_DAYS = { atk: 2, facility_repair: { normal: 3, urgent: 1 }, other: 5 }` in `gaRules.js` (one source for service + provider); stored per row.
- **Booking validation**: 15-minute granularity; start ≥ now − 15 min; horizon 90 days; max duration room 12 h, vehicle 7 days; resource active and in the entity.
- **Conflict (decision 19)** in one transaction: `SELECT … FROM ga_resources WHERE id=? AND entity_id=? FOR UPDATE` (serialises every write for that resource), then overlap check on half-open intervals `existing.starts_at < :end AND :start < effective_end`, where blocking statuses are `confirmed`, `in_use` (effective_end = `GREATEST(ends_at, UTC_TIMESTAMP())`), and `pending_approval` with `starts_at > UTC_TIMESTAMP()` (a pending booking whose start passed is treated as expired). 409 `BOOKING_CONFLICT` returns the clashing slot (time + division only).
- **Driver**: overlap with another booking using the same `driver_person_id` → warning in the response, not a block.
- **Vehicle approval**: decision on a booking whose `starts_at` has passed → 409 `BOOKING_STARTED`; approved → `confirmed`. Check-out refused while another booking of the vehicle is `in_use` (409 "Kendaraan belum dikembalikan dari PJM-…").
- **Deactivating a resource** refused while it has `confirmed|pending_approval|in_use` bookings ending in the future (409 lists them).
- **Lifecycle hooks** for subject types `ga_request`, `ga_booking` (request types `ga_request_other`, `ga_vehicle_booking`): SoD as 2.1 (requester and excluded accounts denied); `request_revision` denied for GA ("Tolak dengan catatan; pengaju bisa mengajukan ulang").
- **Visibility**: requester sees own; `ga.request.process` sees all; management readers per the 2.1 read rule. Agenda for non-processors shows others' bookings as "Terpakai · <divisi>" (no name or purpose).

### 3.3 Endpoints
| Method & path | Guard |
|---|---|
| `GET /ga/requests?scope=mine|all&type&status&locationId&q&page` | `ga.request.create` (mine); `all` needs `ga.request.process` |
| `POST /ga/requests` (zod discriminated union by `requestType`) | `ga.request.create` |
| `GET /ga/requests/:id` | requester / process / management read rule |
| `POST /ga/requests/:id/cancel {reason, version}` | requester |
| `POST /ga/requests/:id/status {status:'in_progress'|'done'|'rejected', note, version}` | `ga.request.process` |
| `POST /ga/requests/:id/assign {userId}` | `ga.request.process` (assignee must hold it) |
| `POST /ga/requests/:id/attachments` | requester or process |
| `GET /ga/resources?kind&locationId&active` | `ga.request.create` |
| `POST /ga/resources`, `PATCH /ga/resources/:id` | `ga.resource.manage` |
| `GET /ga/bookings?resourceId&kind&from&to` (max 31 days) | `ga.request.create` (masked for others) |
| `POST /ga/bookings` | `ga.request.create` |
| `GET /ga/bookings/:id` | owner / process / management read rule |
| `POST /ga/bookings/:id/cancel {reason}` | requester (before start) or process |
| `POST /ga/bookings/:id/checkout`, `POST /ga/bookings/:id/return {note}` | `ga.request.process` (vehicle only) |

API times are ISO-8601 with offset (`+07:00`); stored UTC (DB session is `+00:00`); day logic uses `DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)`.

### 3.4 Jobs and notifications
`peopleCultureReminders.js` also: GA request due tomorrow → assignee (or GA PIC); pending vehicle booking starting within 24 h → active-step users; pending bookings past start → `expired` + `withdrawRequest` ("Kedaluwarsa: belum disetujui sebelum jam mulai"); confirmed vehicle bookings never checked out past `ends_at` → `expired` ("Tidak diambil"); vehicle `in_use` past `ends_at` + 2 h → borrower + GA PIC once per day. Immediate: request created → GA PIC (`ga.request_new`); status change → requester (`ga.request_status`); booking confirmed/rejected/expired → requester. Labels added to `notificationModel.js`.

### 3.5 UI
- Menu: **Kerja Harian → "Layanan GA"** (`/ga`, `ga.request.create`, symbol `room_service`).
- **`/ga`** (§3.1): `PageHeader` action "Buat permintaan" opens a `Menu` (ATK, Perbaikan fasilitas, Pinjam ruang, Pinjam kendaraan, Lainnya). `TabBar`: **Permintaan saya** (DataGrid: Nomor, Jenis, Judul, Lokasi, Status, Target), **Semua permintaan** (process only; chips by status with counts, filter type/location, column "Lewat target"), **Jadwal** (`Segmented` Ruang/Kendaraan + `DateInput`; per resource a Card with the day's bookings as an agenda list and "Pesan" button; mobile = stacked cards), **Sumber daya** (manage only; DataGrid + `Modal md` form).
- **Forms** (`Modal md`, ≤ 5 fields each): ATK (Lokasi, item rows Nama/Jumlah/Satuan with "Tambah baris", Catatan); Perbaikan (Lokasi, Area/objek, Uraian, Mendesak `Switch`, Foto); Ruang (Ruang, Tanggal, Mulai, Selesai, Keperluan); Kendaraan (Kendaraan, Mulai, Selesai, Tujuan, Butuh sopir); Lainnya (Lokasi, Judul, Uraian). Location defaults to the requester's directory location.
- **Detail `/ga/requests/:id`, `/ga/bookings/:id`** (§3.2): header actions by role/state (Proses, Selesaikan, Tolak, Serahkan kunci, Terima kembali, Batalkan; Setujui/Tolak for approvers); `KeyValue` summary; activity history from `activity_logs`.
- New shared component **`TimeInput`** (`src/components/TimeInput.jsx`, underlined field like `DateInput`, 15-minute step) documented in `ui-guideline.md` §4.3 (guideline §6).
- `statusTone.js`: `ga_pending_approval` warning "Menunggu approval", `ga_open` default "Baru", `ga_in_progress` info "Diproses", `ga_done` success "Selesai", `ga_rejected` error "Ditolak", `ga_cancelled` error "Dibatalkan"; `booking_confirmed` success "Terkonfirmasi", `booking_in_use` info "Dipakai", `booking_returned` success "Dikembalikan", `booking_expired` default "Kedaluwarsa".
- Work summary card "Permintaan GA untuk Anda" (assignee/GA PIC) and approvals through the existing approval card.

### 3.6 Management provider `providers/ga.js` (key `ga`, label "Layanan GA", `navPaths: ['/ga']`)
- Escalations: **`ga_request_overdue`** (18) — `open|in_progress` and `due_at < UTC_TIMESTAMP()`; scope `r.department_id`; link `/ga/requests/:id`. **`ga_vehicle_not_returned`** (23) — vehicle `in_use` and `ends_at < UTC_TIMESTAMP() − INTERVAL 2 HOUR`; scope `b.department_id`.
- Metrics: **`ga_requests_done`** (item, higher, cumulative, emptyIsZero); **`ga_requests_on_time`** (%, higher, `done_at <= due_at`, null when none); **`ga_resolution_days`** (hari, lower, avg from clock start to done).
- KPIs: **`ga_open_requests`** (open + in_progress; sub "N lewat target"; alert when N > 0); **`ga_vehicles_out`** (vehicles in use now; sub "N terlambat kembali"; alert when late).
- No alarm while the entity has no GA data.

### 3.7 Tests
`gaRequests.test.js` (status machine, SLA stored at clock start, approval only for `other`, cancel rules, process permission, attachment limits, strict schemas); `gaBookings.test.js` (overlap matrix incl. touching intervals allowed, pending-past-start ignored, in_use extends to now, 20 parallel bookings for one slot on two connections → exactly 1 succeeds, horizon/duration/granularity, approval after start refused, checkout blocked while previous in_use, deactivation blocked, masking for non-processors, WIB boundary 23:30/00:30); lifecycle SoD; resolver for GA; provider contract and scoping; frontend model tests (forms, agenda, masking).

### 3.8 Real-data gate
Inside a rolled-back transaction on the real database: create 2 fictional rooms and 1 vehicle at a fictional PFN location; for every active user submit one ATK request and one vehicle booking → each resolves an approver (basis table, zero self); decide a sample through the real decide path; providers called entity-wide and per division (0 errors); Accurate checksums unchanged. Headless (mocked API): Sales member (request + booking), P&C Member (process), P&C Head (resources), Warehouse Head (approver) at 1280 and 390.

---

## Bagian 4 — Spec 2.3: IT infrastructure registers and company phone numbers

### 4.1 Data model — migration `110_it_registers.sql`
Common to every register table: `entity_id`, `department_id NOT NULL` (People & Culture department of the entity, set by the service — wave-1 rule 17, so the P&C Head's division view gets the KPIs), `location_id` (composite FK to `org_locations`; NOT NULL unless stated), `notes VARCHAR(500) NULL`, `created_by`, `updated_by`, timestamps, `UNIQUE (entity_id, id)`, collation `utf8mb4_0900_ai_ci`. **No delete endpoints**; rows end in a status.

Supporting changes: `devices ADD UNIQUE uq_devices_entity_id (entity_id, id)`; `software_vendors ADD UNIQUE (entity_id, id)`, `ADD vendor_kind ENUM('software','isp','cctv','network','hardware','service','other') NOT NULL DEFAULT 'software'` (existing rows: 0; default keeps semantics).

| Table | Columns (beyond common) | Excluded on purpose |
|---|---|---|
| `it_network_devices` (tab *03 - Network Devices*) | `device_type ENUM('router','switch','access_point','nvr','dvr','firewall','modem','other')`, `brand_model VARCHAR(150)`, `serial_number VARCHAR(150) NULL` + `serial_key` generated (UPPER/TRIM, NULL when empty) `UNIQUE (entity_id, serial_key)`, `ip_address VARCHAR(45) NULL` (validated IPv4/IPv6), `installed_year SMALLINT NULL` (1990–2100), `isp_link_id NULL` (composite FK), `firmware_updated_on DATE NULL`, `status ENUM('active','spare','damaged','retired')`, `status_changed_at TIMESTAMP NOT NULL` | **Username, Password** (admin login). |
| `it_isp_links` (*04_ISP_Info*) | `vendor_id NULL` (composite FK `software_vendors`, kind isp), `provider_name VARCHAR(120)`, `customer_number VARCHAR(60) NULL` ("No Pelanggan"), `bandwidth_mbps INT UNSIGNED NULL`, `public_ip_dedicated TINYINT(1)`, `is_backup TINYINT(1)`, `contract_start DATE NULL`, `contract_end DATE NULL`, `monthly_cost DECIMAL(15,2) NULL CHECK ≥ 0`, `status ENUM('active','terminated')` | **Password WiFi**, SSID passwords, customer-portal login. |
| `it_cctv_systems` (*08_CCTV_System*) | `camera_count SMALLINT UNSIGNED`, `camera_model VARCHAR(150) NULL`, `recorder_type ENUM('nvr','dvr','cloud','none')`, `recorder_device_id NULL` (composite FK `it_network_devices`), `serial_number VARCHAR(150) NULL`, `remote_access TINYINT(1)`, `same_network_as_pc TINYINT(1)` (risk flag), `status ENUM('online','partial','offline','retired')`, `cameras_offline SMALLINT UNSIGNED DEFAULT 0` (CHECK ≤ camera_count), `status_changed_at` | NVR/DVR admin login, remote-app account, device verification code, cloud/P2P IDs. |
| `it_backup_jobs` (*07_Backup_System*) | `data_scope VARCHAR(190)`, `method VARCHAR(120)`, `frequency ENUM('daily','weekly','monthly','other')`, `storage_location ENUM('onsite','offsite','cloud')`, `retention VARCHAR(60) NULL`, `restore_tested_on DATE NULL`, `last_checked_on DATE NULL`, `last_result ENUM('ok','failed','unknown') DEFAULT 'unknown'`, `status ENUM('active','retired')`; `location_id` NULL allowed (cloud) | Encryption keys/passphrases, storage or cloud account login. |
| `it_backup_checks` | `id, entity_id, backup_job_id` (composite FK), `checked_on DATE`, `result ENUM('ok','failed')`, `restore_tested TINYINT(1)`, `note VARCHAR(255) NULL`, `checked_by`, `created_at` — append-only; job's `last_*`/`restore_tested_on` updated in the same transaction | — |
| `it_gws_reviews` (*06_Google_Workspace*) | `reviewed_on DATE`, `active_users SMALLINT`, `super_admins SMALLINT`, `mfa_enforced TINYINT(1)`, `external_sharing_restricted TINYINT(1)`, `shared_accounts_used TINYINT(1)`, `ex_users_active SMALLINT`, `reviewed_by`; no location; append-only (a correction is a new review) | Admin account names/emails, recovery codes. |
| `it_phone_lines` (doc *Company Phone & Mobile Numbers*) | `kind ENUM('mobile','ip_phone')`, `number VARCHAR(30) NULL` (normalised `+62…`), `extension VARCHAR(10) NULL` (CHECK number or extension present), `active_number_key` generated `IF(status<>'terminated', number, NULL)` `UNIQUE (entity_id, active_number_key)`, same for extension, `person_id NULL` (composite FK `people_directory`), `holder_label VARCHAR(120) NULL` (CHECK not both; CHECK `status<>'active' OR person_id IS NOT NULL OR holder_label IS NOT NULL`), `device_id NULL` (composite FK `devices`), `provider VARCHAR(80) NULL`, `plan_name VARCHAR(120) NULL`, `started_on DATE NULL`, `monthly_cost DECIMAL(15,2) NULL`, `status ENUM('active','spare','terminated')` | PIN/PUK, SIM ICCID, provider-portal login, personal numbers (UI states "Hanya nomor milik perusahaan"). |

Also in 110: `hrga_workflow_tasks ADD CONSTRAINT fk_hrga_task_phone FOREIGN KEY (linked_phone_line_id) REFERENCES it_phone_lines(id)`.

**Permissions**: `it.infra.view` (People & Culture member+ and Super Admin), `it.infra.manage` (People & Culture supervisor+ and Super Admin). Vendors: create/update accept `software_vendor.manage` **or** `it.infra.manage`; vendor delete unchanged.

**Secret guard** (`services/secretText.js`, used by every register, GA, and HRGA free-text field): rejects (400 `SECRET_TEXT`, "Jangan menulis kata sandi di aplikasi") text matching `/\b(pass(word|wd)?|kata\s*sandi|sandi|pwd|pin|puk)\s*[:=]/i`. Not a security boundary on its own — a guard against habit.

**Subscriptions tidy-up (row 2.3 audit)**: `subscription_licenses.license_key` is no longer accepted or returned by the API (responses carry `hasLicenseKey: boolean`); column kept. Scope already fixed in 1.0.

### 4.2 Endpoints (`/it/infrastructure/*`, router in `it.routes.js`)
| Method & path | Guard |
|---|---|
| `GET /it/infrastructure/summary` | `it.infra.view` (counts per tab + dashboard block) |
| `GET/POST /it/infrastructure/network-devices`, `PATCH …/:id` | view / manage |
| `GET/POST /it/infrastructure/isp-links`, `PATCH …/:id` | view / manage |
| `GET/POST /it/infrastructure/cctv`, `PATCH …/:id`, `POST …/:id/status {status, camerasOffline, note}` | view / manage |
| `GET/POST /it/infrastructure/backups`, `PATCH …/:id`, `GET/POST …/:id/checks` | view / manage |
| `GET/POST /it/infrastructure/gws-reviews` | view / manage |
| `GET/POST /it/infrastructure/phone-lines`, `PATCH …/:id`, `POST …/:id/holder {personId|holderLabel|null}` | view / manage |
| `POST /it/infrastructure/import/preview`, `…/apply` | `it.infra.manage` |
| `GET /it/dashboard/summary` (existing) | adds `infrastructure` block without IPs, costs or serials |

Every PATCH takes `version` (optimistic lock column `version` on each register). Status changes set `status_changed_at`. Logs via the same connection, metadata never includes IP addresses.

### 4.3 Import (owner's IT report, PFN only)
- Reuses the wave-1 import dialog pattern (`ReportImportDialog`, `reportImportModel.js`): the browser reads the `.xlsx` with `read-excel-file`, detects the sheet kind by headers, normalises headers (trim, collapse spaces — the reference has "IP Public  Dedicated"), maps **only allow-listed columns**, and posts JSON. A header matching `/pass|sandi|kata\s*kunci|user\s*name|username|login|\bpin\b|puk|token|secret|credential/i` is never read. Values of mapped free-text cells that trip the secret guard are dropped with a warning ("Catatan berisi kata sandi — tidak diimpor").
- Kinds and maps: **network** ← *03 - Network Devices* (Device Type→`device_type` with Router/Switch/AP/Access Point/NVR/DVR mapping, Serial Number, Brand/Model, Lokasi, IP Address, Tahun Install, ISP Terkait → matched to an ISP at the same location by provider name or kept in notes, Firmware Update Terakhir → date or notes, Status Active/Spare/Damaged/Not Active → active/spare/damaged/retired, Notes); **isp** ← *04_ISP_Info* (Lokasi, Provider, No Pelanggan, Bandwidth "100 Mbps"/"1 Gbps" → Mbps or notes, IP Public Dedicated, Backup ISP, Note); **cctv** ← *08_CCTV_System* (Lokasi, Jumlah Kamera, Model, DVR/NVR, Remote Access, Serial Number, Satu Network dengan PC, Catatan).
- **PFN filter**: these tabs have no company column; the dialog lists every distinct *Lokasi* value and the user maps each to an active PFN `org_location` or "Bukan PFN — lewati". Values not equal to an existing PFN location name default to "lewati". The server re-validates that every mapped location id belongs to the entity; skipped rows are counted per value.
- Server: `zod.strict()` row schemas (unknown keys → 400, so no secret column can be smuggled); preview returns per row action (`baru` / `sudah ada` / `berbeda` with field diffs / `dilewati`) and issues. Identity: network = `serial_key`, else (location, type, IP), else (location, type, brand_model) with "tanpa nomor seri, periksa manual"; ISP = (location, provider, customer_number); CCTV = serial, else (location, recorder_type, camera_model). Apply re-validates the same payload in one transaction; existing rows change only when ticked "perbarui" per row (logged with before/after). Re-import of the same file = 0 changes.
- Nothing is imported without the owner's approval; the IT team runs it from the UI.

### 4.4 UI
- Menu: People & Culture → **"Infrastruktur IT"** (`/it/infrastructure`, `it.infra.view`, symbol `lan`).
- **`/it/infrastructure`** (§3.1): `PageHeader` actions "Impor dari laporan IT" (manage) + the add button for the active tab. `TabBar`: **Jaringan, ISP, CCTV, Backup, Google Workspace, Telepon & HP, Vendor**. Each tab = one `DataGrid` with location chips + counts, search, status chips; row click → `SideSheet` detail with `KeyValue` and actions; add/edit `FullScreenDialog` (> 5 fields) or `Modal md`. Row actions: CCTV "Ubah status" (`Modal sm`: status, kamera offline, catatan); Backup "Catat pemeriksaan" (`Modal sm`: tanggal, hasil, uji restore, catatan) + history list in the sheet; Telepon "Ganti pemegang" (directory person or team label); Google Workspace tab shows the latest review as `KeyValue` with risk flags in `--pw-error` text, button "Catat review" (`FullScreenDialog`), and a review history DataGrid. Export (DataGrid xlsx) only for manage. Field helper text on notes: "Jangan menulis kata sandi."
- **IT Dashboard** (`/it/dashboard`) gains a section "Infrastruktur" (§3.4 `StatCard`s): Kamera CCTV (sum of active systems; note "N sistem offline/sebagian"), Bandwidth (sum of active primary links; note "N lokasi tanpa ISP cadangan"), Kontrak ISP berakhir ≤ 60 hari, Backup (n aktif; note "N gagal / terlambat diperiksa", "restore belum diuji N"), Keamanan Google Workspace (MFA wajib Ya/Tidak; note super admin n, review terakhir), Nomor perusahaan (aktif n). A card is omitted when its register is empty (no "coming soon" jargon).
- **Directory** profile shows the person's active company lines (number/extension only) to every viewer; provider/cost only in the register.
- `statusTone.js`: `net_active` success "Aktif", `net_spare` default "Cadangan", `net_damaged` error "Rusak", `net_retired` default "Tidak aktif"; `cctv_online` success "Online", `cctv_partial` warning "Sebagian offline", `cctv_offline` error "Offline"; `backup_ok` success "Berhasil", `backup_failed` error "Gagal", `backup_unknown` default "Belum diperiksa"; `line_active` success "Aktif", `line_spare` default "Cadangan", `line_terminated` default "Berhenti"; `isp_active`, `isp_terminated`.

### 4.5 Management provider (`providers/it.js`, add `'/it/infrastructure'` to `navPaths`)
All scoped by the register's `department_id`; no alarm while the register is empty.
- **`it_isp_contract_ending`** (22) "Kontrak ISP segera berakhir": active link, `contract_end` set, `today > contract_end − 30 days` (named constant `ISP_DECISION_DAYS = 30`: time to renew or switch); sourceId = id × 100000 + DATEDIFF(contract_end,'2000-01-01') so a renewed contract is a new episode.
- **`it_backup_unverified`** (20) "Backup gagal atau tidak diperiksa": active job with `last_result='failed'` (since the failing check), or not checked within `CHECK_DAYS = {daily: 3, weekly: 10, monthly: 35, other: 35}` (since last check, or creation + 7 days if never); episode by the anchoring day.
- **`it_cctv_offline`** (15) "CCTV offline": status `offline|partial` for more than `CCTV_OFFLINE_DAYS = 2`; episode by `status_changed_at` day.
- **`it_gws_review_overdue`** (21) "Review keamanan Google Workspace terlambat": latest review older than `GWS_REVIEW_DAYS = 90` (only once a first review exists).
- Metric **`it_backup_checks`** (item, higher, cumulative, emptyIsZero) — backup checks recorded in the period.
- KPIs: **`it_cctv_cameras`** (alert when any system offline/partial), **`it_bandwidth_mbps`** (no alert; sub lokasi tanpa cadangan), **`it_backup_health`** (value = jobs OK and on time; sub "dari N"; alert on failing/overdue), **`it_gws_risk_flags`** (count of: MFA not enforced, sharing unrestricted, shared accounts used, ex-users active > 0, review overdue; alert > 0; `value: null` + "Belum ada review" when none), **`it_phone_lines_active`** (count; no cost in management).

### 4.6 Tests
`itRegisters.test.js` (entity scope on every read/write; composite FKs refuse another entity's location/person/device/vendor; no DELETE routes; version conflicts; status_changed_at; phone normalisation and uniqueness among non-terminated; holder CHECKs; backup check updates job in the same transaction; GWS append-only; secret guard on every free-text field; `license_key` neither accepted nor returned); `itInfraImport.test.js` (header normalisation; secret headers never read even when present; strict schema rejects extra keys; secret-looking notes dropped; location mapping and non-PFN skip counts; identity and diffs; re-import 0 changes; apply re-validates); dashboard block has no IP/cost/serial; provider contract, scope, episodes, key lengths (`managementIntegration.test.js` stays green with the new nav item); migration text (additive, collation); frontend model tests (tab models, import mapping parity client/server for the allow-list).

### 4.7 Real-data gate
The owner's current IT report is fetched in an owner-authorised session; its PFN rows of Network Devices, ISP, and CCTV are imported **inside a rolled-back transaction**: counts per tab and action, skipped counts per non-PFN location, assertion that no parsed payload key is outside the allow-list and no value trips the secret guard, re-import 0 changes, dashboard numbers (cameras, bandwidth) equal the report's PFN figures, providers 0 errors, Accurate checksums unchanged. The working copy (contains WiFi passwords) is deleted right after the gate and never committed. Headless (mocked API): P&C Head (manage), P&C Member (view), Sales member (no menu, 403 on API) at 1280 and 390.

---

## Bagian 5 — Kritik dan penyelesaian

Tiga peninjau membaca rancangan awal secara terpisah. Setiap temuan sudah diterapkan ke Bagian 1–4 (kolom "Penyelesaian" menunjuk tempatnya) atau ditolak dengan alasan.

### Peninjau 1 — Keamanan & privasi
| # | Temuan | Penyelesaian |
|---|---|---|
| S1 | `apply-approval` mengubah status tanpa mesin approval; siapa pun dengan `hrga.approve` bisa "menyetujui" pengajuannya sendiri. | Endpoint 410, keputusan hanya lewat `/approvals/:id/decide` dan hook lifecycle (§2.1.1, §2.1.3). |
| S2 | Tanpa matrix, mesin membuat langkah tanpa penyetuju yang bisa diputuskan siapa pun yang memegang `approval.decide`. | Aturan matrix di-seed, alur `legacy` ditolak, penyetuju dipasang oleh resolver (§2.1.2–2.1.3, §3.1). |
| S3 | Penyetujuan sendiri lewat peran, delegasi, atau eskalasi: Head yang mengajukan masih bisa memutuskan sebagai pemegang peran. | `assertCanDecide` memeriksa ID pelaku, apa pun jalurnya (pengaju, pembuat, subjek). `canUserDecide` menyaring antrean dan kartu beranda (§2.1.3, §3.2). |
| S4 | Akun uji memegang peran Head Management Office, jadi bisa ikut menyetujui sebagai cadangan. | Akun yang dikecualikan di direktori ditolak saat memutuskan. Gerbang mencantumkan semua pemutus lewat peran. Pencabutan peran akun uji direkomendasikan ke owner (Bagian 7). |
| S5 | `linkTask` menerima ID perangkat atau lisensi tanpa cek entitas (IDOR). | Endpoint 410. Aksi bertipe mengikat entitas di SQL (§2.1.3). |
| S6 | Data pribadi di onboarding: telepon pribadi, lampiran KTP/kontrak/offer letter/surat resign, alasan teks bebas. | API menolaknya, banner ditampilkan, alasan berupa kategori. Kolom lama tidak dihapus (§2.1.1, keputusan 2). |
| S7 | Membuka detail workflow untuk atasan dan Head divisi bisa membocorkan referensi KantorKu dan lampiran. | DTO terbatas untuk pembaca di luar P&C (§2.1.4). |
| S8 | Register mewarisi kolom rahasia dari file referensi (Username, Password, Password WiFi), dan catatan CCTV/jaringan sering berisi password. | Kolom dikecualikan per tabel, header ditolak di klien, skema strict di server, dan penjaga teks rahasia di semua kolom bebas (§4.1, §4.3). |
| S9 | Alamat IP, model, dan firmware membentuk peta jaringan. | Hanya `it.infra.view`. Tidak tampil di dasbor, manajemen, pencarian, AI, atau metadata log. Ekspor hanya untuk pengelola (§4.2, §4.4, keputusan 25). |
| S10 | `subscription_licenses.license_key` dikirim dan diterima API. | Tidak diterima dan tidak dikirim lagi, cukup `hasLicenseKey` (§4.1). |
| S11 | Tautan konsol admin Google di notifikasi bisa disalahgunakan untuk phishing. | Tautan hanya konstanta di UI; `actionUrl` notifikasi tetap internal (§2.1.3). |
| S12 | Agenda ruang dan kendaraan membuka siapa dan untuk apa (mis. wawancara kandidat). | Untuk bukan pemroses, pemesanan orang lain tampil "Terpakai · divisi" saja (§3.2). |
| S13 | Foto perbaikan bisa jatuh ke Drive akun layanan. | Hanya Shared Drive (aturan 1.0), tipe gambar/PDF, maksimal 10 MB dan 3 file (§3.1). |
| S14 | Member P&C memegang `hrga.manage`. | Dicabut oleh migrasi 108, dipindah ke Supervisor/Head (§2.1.2). |

### Peninjau 2 — Integritas data & konkurensi
| # | Temuan | Penyelesaian |
|---|---|---|
| D1 | Nomor workflow memakai COUNT, jadi bisa ganda saat dibuat bersamaan. | `nextNumber()` dengan GET_LOCK, MAX, UNIQUE, dan satu kali coba ulang. Dipakai juga untuk GA dan PJM (§2.1.1). |
| D2 | Perubahan bisa saling menimpa (lost update). | Kolom `version` dan 409 `VERSION_CONFLICT` di workflow, permintaan GA, pemesanan, dan register (§2.1.2, §3.1, §4.2). |
| D3 | Dua tugas terakhir selesai bersamaan, sehingga workflow selesai dua kali atau tidak sama sekali. | Baris workflow dikunci `FOR UPDATE` sebelum tugas diubah dan dihitung ulang. Dites dengan dua koneksi (§2.1.3, §2.1.9). |
| D4 | Tugas bisa dicentang saat draft atau menunggu approval. | Tugas hanya bisa diubah saat approved/in_progress (§2.1.3). |
| D5 | Tenggat dihitung dari hari dibuat, dan template bisa berubah setelah draft. | Checklist dibuat saat disetujui, di transaksi yang sama. Tenggat relatif ke tanggal mulai/hari terakhir, paling awal hari disetujui (§2.1.3). |
| D6 | Satu orang bisa punya dua offboarding berjalan. | Kunci tergenerasi `open_person_key` dengan UNIQUE (§2.1.2). |
| D7 | Resign dari offboarding bentrok dengan suntingan manual P&C; pembatalan bisa menimpa data yang sudah diubah orang lain. | Sumber `offboarding`, dan pengembalian hanya bila nilainya belum berubah (§2.1.3). |
| D8 | Karyawan baru masuk direktori lalu batal; menghapus melanggar aturan. | Ditandai `excluded` dengan alasan. Rehire menautkan baris lama. `starts_on` membuat hitungan karyawan sadar tanggal (§2.1.3). |
| D9 | Pemesanan ganda karena dua permintaan memeriksa bentrok bersamaan. | Baris sumber daya dikunci `FOR UPDATE`, interval setengah terbuka. Dites 20 permintaan paralel (§3.2, §3.7). |
| D10 | Kendaraan yang terlambat kembali tidak menahan jadwal; pemesanan menunggu approval yang lewat jam mulai menahan slot selamanya. | `in_use` menahan sampai sekarang. Pemesanan menunggu yang lewat jam mulai diabaikan saat cek bentrok lalu dikedaluwarsakan oleh job. Approval setelah jam mulai ditolak (§3.2, §3.4). |
| D11 | Zona waktu: sesi DB UTC, pengguna WIB. | Simpan UTC, API memakai offset, logika hari memakai `UTC+7`. Ada tes batas jam 23:30/00:30 (§3.3, §3.7). |
| D12 | Perubahan aturan SLA bisa menulis ulang riwayat ketepatan waktu. | `sla_days` dan `due_at` disimpan saat waktu mulai dihitung (§3.2). |
| D13 | Tugas perangkat dicentang manual padahal penugasan perangkat masih aktif. | Ditolak (`USE_TASK_ACTION`). Aksi bertransaksi tunggal (§2.1.3). |
| D14 | Barang yang diterima setelah offboarding disetujui tidak masuk checklist. | Tombol "Tambah kepemilikan ke checklist". `it_device_resigned_holder` tetap menjadi jaring pengaman (§2.1.3). |
| D15 | Eskalasi yang selesai lalu terulang tidak muncul lagi. | Nomor episode untuk kontrak ISP, backup, CCTV, dan resign (§2.1.7, §4.5). |
| D16 | Impor ganda dan perubahan diam-diam. | Identitas per jenis, diff per baris, dan centang "perbarui" yang eksplisit. Impor ulang tidak mengubah apa pun (§4.3). |
| D17 | Relasi bisa menunjuk lokasi, orang, perangkat, atau vendor entitas lain. | FK komposit; `UNIQUE (entity_id, id)` ditambahkan di `devices` dan `software_vendors` (§4.1). |
| D18 | Keputusan untuk approval lama setelah diajukan ulang. | `STALE_APPROVAL` di hook (§2.1.3). |
| D19 | Log aktivitas di luar transaksi dan `entityId: null`. | Log ditulis dengan koneksi yang sama dan entitas selalu diisi (§2.1.1). |
| D20 | Nomor HP sama ditulis dengan format berbeda (0812… dan +62812…). | Dinormalisasi ke `+62`, unik di antara yang belum berhenti (§4.1). |

### Peninjau 3 — Produk & UX (perusahaan 34 orang)
| # | Temuan | Penyelesaian |
|---|---|---|
| P1 | Status terlalu banyak (closed, reopen, menunggu vendor) untuk tim GA satu orang. | Enam status permintaan, tanpa reopen. Komentar ditunda (§3.2, Bagian 6). |
| P2 | Pesan ruang rapat sebagai "permintaan" dengan SLA terlalu berat. | Peminjaman dipisah dari permintaan; ruang langsung terkonfirmasi (keputusan 16–17). |
| P3 | Approval untuk ATK dan laporan kerusakan hanya menambah antrean. | Tanpa approval; approval hanya untuk kendaraan dan Lainnya (keputusan 17). |
| P4 | Register Access Control tersembunyi dan kosong di file owner, jadi akan menjadi tabel mati. | Ditunda; diganti tugas `access_revoke` di setiap offboarding (keputusan 22). |
| P5 | Impor untuk tab berisi 1–6 baris (Backup, Vendor, Google Workspace) lebih mahal daripada mengetik. | Impor hanya Network, ISP, dan CCTV (keputusan 24). |
| P6 | Atasan di divisi lain tidak punya `hrga.view`, jadi tidak pernah melihat tugasnya. | Aturan baca dan kartu beranda tanpa `hrga.view` (§2.1.4–2.1.5). |
| P7 | Head divisi mengklik tautan di Pusat Eskalasi lalu mendapat "tidak ditemukan". | Aturan baca manajemen per divisi di detail HRGA dan GA (§2.1.4, §3.2). |
| P8 | Checklist plus tugas di modul Tasks menghasilkan dua daftar yang sama. | Tidak lagi membuat baris di Tasks (keputusan 11). |
| P9 | Notifikasi berulang setiap hari terasa seperti spam. | Dedupe per item per hari, terlambat diingatkan tiap 3 hari, approval memakai job yang ada (§2.1.5). |
| P10 | P&C hanya 1 Head dan 1 Member: siapa yang menjalankan tugas IT dan perangkat, padahal `device.assign` hanya untuk Supervisor? | PIC wajib punya izin yang sesuai. Head menangani sampai ada keputusan. Rekomendasi: staf IT/GA diberi peran People & Culture Supervisor oleh admin dengan persetujuan owner. Ini konfigurasi, bukan migrasi (Bagian 7). |
| P11 | Formulir panjang tidak nyaman di ponsel. | Formulir GA maksimal 5 field di `Modal`, agenda berupa daftar (bukan grid kalender), aksi baris berupa tombol + ⋮ (§3.5). |
| P12 | Register Google Workspace berbentuk baris item–keterangan sulit dibandingkan dari waktu ke waktu. | Review berkala 6 field dengan riwayat dan tanda risiko terhitung (§4.1, §4.4). |
| P13 | Biaya ISP dan HP tampil ke Head divisi lain di dasbor manajemen. | Biaya hanya di register P&C; KPI manajemen berupa hitungan (§4.5). |
| P14 | Kartu dasbor "diisi nanti" membingungkan. | Kartu disembunyikan selama registernya kosong; tidak ada alarm tanpa data (§4.4–4.5). |
| P15 | Satu menu per register memenuhi menu samping. | Satu menu "Infrastruktur IT" dengan tab; Layanan GA satu menu di Kerja Harian (§3.5, §4.4). |
| P16 | Perlukah alur penugasan sopir dengan cek bentrok? | Ditolak sebagai fitur penuh: cukup pilih sopir dari direktori dengan peringatan bentrok, tanpa blokir (§3.2). |

---

## Bagian 6 — Ditunda

| Hal | Alasan |
|---|---|
| Register Access Control | Tab tersembunyi dan kosong di file owner. Offboarding sudah mencabut akses lewat checklist. Dibangun bila IT mulai review akses berkala. |
| Membaca atau menulis Google Workspace lewat Admin SDK (hitung pengguna, nonaktifkan akun) | Menulis ke Google adalah keputusan owner di luar program. Membaca menambah izin akun layanan; review manual cukup untuk 34 orang. |
| Impor tab Backup, Vendor, dan Google Workspace | Hanya 1–6 baris; mengetik lebih cepat dan lebih aman. |
| Katalog dan stok ATK | Persediaan dan pemesanan ulang adalah modul tersendiri. Daftar barang berupa teks bebas. |
| Data kendaraan (STNK, pajak, servis, odometer, BBM) dan jadwal sopir penuh | Bukan inti peminjaman. Bensin dan servis lewat Finance. |
| Sinkron ruang dengan Google Calendar, pemesanan berulang, tampilan grid kalender | Butuh akses Calendar per ruang. Agenda harian cukup untuk ruang yang sedikit. |
| SLA hari kerja dan jeda SLA | Konsisten dengan tiket IT (hari kalender). Ditinjau setelah data 3 bulan. |
| Komentar, penilaian, dan buka ulang permintaan GA | Satu PIC GA; percakapan lewat Google Chat. |
| Wizard pengalihan lisensi ke pengganti | Offboarding mencabut lisensi; pemberian ulang lewat halaman Langganan. |
| Ketergantungan antar-tugas checklist | Urutan cukup lewat tenggat relatif. |
| Eskalasi nomor HP di tangan karyawan resign | Sudah tertutup oleh offboarding dan `hrga_resigned_access_open`. |
| Alat Prakasa AI dan pencarian global untuk GA dan register | Register berisi data jaringan sensitif. GA menyusul setelah dipakai. |
| Pemantauan CCTV otomatis (ping atau API NVR) | Butuh akses jaringan dari server hosting bersama. Status dicatat manual. |
| Entitas lain (PMK, IGS, Djaya77, SFG) | Keputusan owner: fokus PFN. |

---

## Bagian 7 — Migrasi, urutan, dan langkah setelah build

**Nomor migrasi yang dipesan:** `108_hrga_wave2.sql`, `109_ga_services.sql`, `110_it_registers.sql`. Nomor **111** dicadangkan untuk perbaikan tinjauan akhir. Periksa `schema_migrations` sebelum mulai; terakhir diterapkan: `107_it_assets_wave1.sql`. Urutan wajib: 110 bergantung pada 108 (FK `linked_phone_line_id`).

**Urutan pembangunan:** 2.1 → 2.2 → 2.3. Setiap baris punya gerbang sendiri: tes backend dan frontend, build, gerbang data asli di dalam transaksi yang dibatalkan, cek browser desktop dan ponsel, tinjauan independen dengan pembantah, dokumen diperbarui, dan laporan. `docs/management-integration.md` tidak perlu diubah karena provider ditemukan otomatis. `docs/ui-guideline.md` mendapat `TimeInput`.

**Langkah setelah build (butuh persetujuan owner, dijalankan Claude):**
1. Head People & Culture menetapkan PIC IT dan GA di Template checklist → Penanggung jawab.
2. Rekomendasi peran: staf yang menjalankan IT dan GA diberi peran People & Culture Supervisor (perlu `device.assign`, `it.infra.manage`, `ga.resource.manage`). Peran akun uji Management Office dicabut atau akunnya ditandai "Dikecualikan" di direktori.
3. Tim GA mengisi ruang dan kendaraan PFN. Tim IT mengimpor Network, ISP, dan CCTV dari laporan IT lewat Infrastruktur IT → Impor, lalu mengisi Backup, Vendor, review Google Workspace, dan nomor telepon/HP secara manual.
4. Password WiFi di laporan Excel IT dipindah ke password manager dan diganti (rekomendasi IT Security sejak 30 September).
