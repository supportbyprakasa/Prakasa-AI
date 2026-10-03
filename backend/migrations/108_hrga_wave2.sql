-- ============================================================
-- Migration 108 — People & Culture wave 2, row 2.1: onboarding & offboarding
-- ready for use (docs/rancangan-people-culture-g2.md, Bagian 2 §2.1.2).
--
-- hrga_workflows
--   person_id          the directory person (composite FK, same entity).
--   person_created     1 when the approval created that directory row, so a
--                      cancel marks it "Dikecualikan" instead of deleting it.
--   needs              onboarding needs (google/app/device/licenses/phone/desk/idCard).
--   reason_code        offboarding reason as a category, never free text.
--   planned_work_email company domain only, lowercased and trimmed.
--   version            optimistic lock (409 VERSION_CONFLICT).
--   submitted_at, approved_at, cancelled_at/by, cancel_reason, approver_basis.
--   open_person_key    one running onboarding/offboarding per person (UNIQUE).
--   manager_person_id, location_id
--                      the direct manager (directory) and work location picked
--                      in the onboarding form (composite FKs, same entity).
-- hrga_workflow_tasks
--   category           values appended (existing values unchanged).
--   owner_group, sort_order, linked_subscription_id, linked_it_ticket_id,
--   linked_phone_line_id (its FK is added by 110 with it_phone_lines),
--   skipped_reason     required when status = 'skipped'.
-- hrga_checklist_templates
--   department_id, updated_by, active_key: at most one active template per
--   type per division (0 = the entity default).
-- people_directory
--   starts_on          join date: not counted as an employee before it.
--   resigned_on_source + 'offboarding' (appended).
-- Permissions: hrga.manage revoked from the People & Culture Member system
--   roles only (audit 0.2, precedent 037) and granted to Supervisor/Head.
-- Approval matrix: hrga_onboarding:default / hrga_offboarding:default, only
--   when no active rule exists for the request type. The step's approver is
--   set by the resolver at submit (manager → division Head → Management Office).
--
-- Checked before writing: hrga_workflows, hrga_workflow_tasks and
-- hrga_checklist_templates hold 0 rows; every ENUM change only appends values.
-- Additive and idempotent (each step guarded via information_schema).
-- ============================================================
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- hrga_workflows

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_workflows' AND column_name = 'person_id');
SET @sql := IF(@need, "ALTER TABLE hrga_workflows
  ADD COLUMN person_id INT UNSIGNED NULL AFTER employee_user_id,
  ADD COLUMN person_created TINYINT(1) NOT NULL DEFAULT 0 AFTER person_id,
  ADD COLUMN needs JSON NULL AFTER employee_manager_user_id,
  ADD COLUMN reason_code ENUM('resign','contract_end','other') NULL AFTER reason,
  ADD COLUMN planned_work_email VARCHAR(190) NULL AFTER employee_email,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL AFTER approval_request_id,
  ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER submitted_at,
  ADD COLUMN approver_basis ENUM('manager','division_head','management_office') NULL AFTER approved_at,
  ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER completed_by,
  ADD COLUMN cancelled_by INT UNSIGNED NULL AFTER cancelled_at,
  ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER cancelled_by,
  ADD KEY idx_hrga_wf_entity_person (entity_id, person_id),
  ADD CONSTRAINT fk_hrga_wf_person FOREIGN KEY (entity_id, person_id) REFERENCES people_directory (entity_id, id),
  ADD CONSTRAINT fk_hrga_wf_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id),
  ADD CONSTRAINT chk_hrga_wf_email_lower CHECK (planned_work_email IS NULL OR CAST(planned_work_email AS CHAR CHARACTER SET binary) = CAST(LOWER(TRIM(planned_work_email)) AS CHAR CHARACTER SET binary))", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_workflows' AND column_name = 'open_person_key');
SET @sql := IF(@need, "ALTER TABLE hrga_workflows
  ADD COLUMN open_person_key INT UNSIGNED GENERATED ALWAYS AS (IF(deleted_at IS NULL AND status IN ('draft','pending_approval','revision_requested','approved','in_progress'), person_id, NULL)) STORED,
  ADD UNIQUE KEY uq_hrga_open_person (entity_id, workflow_type, open_person_key)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The direct manager and the work location picked in the onboarding form are
-- directory/org rows of the same entity (composite FKs): the manager may be a
-- person without an app account, and both go into the new directory row.
SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_workflows' AND column_name = 'manager_person_id');
SET @sql := IF(@need, "ALTER TABLE hrga_workflows
  ADD COLUMN manager_person_id INT UNSIGNED NULL AFTER employee_manager_user_id,
  ADD COLUMN location_id INT UNSIGNED NULL AFTER manager_person_id,
  ADD KEY idx_hrga_wf_entity_manager (entity_id, manager_person_id),
  ADD KEY idx_hrga_wf_entity_location (entity_id, location_id),
  ADD CONSTRAINT fk_hrga_wf_manager_person FOREIGN KEY (entity_id, manager_person_id) REFERENCES people_directory (entity_id, id),
  ADD CONSTRAINT fk_hrga_wf_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- hrga_workflow_tasks

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_workflow_tasks' AND column_name = 'owner_group');
SET @sql := IF(@need, "ALTER TABLE hrga_workflow_tasks
  MODIFY category ENUM('google_workspace_access','shared_drive_access','device_handover','device_return','email_account','software_license','account_deactivation','document_handover','exit_interview','custom','app_account','app_account_deactivation','phone_line','phone_line_return','desk_setup','id_card','id_card_return','access_revoke','team_orientation') NOT NULL,
  ADD COLUMN owner_group ENUM('it','ga','manager','pc') NOT NULL DEFAULT 'pc' AFTER category,
  ADD COLUMN sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER owner_group,
  ADD COLUMN linked_subscription_id INT UNSIGNED NULL AFTER linked_subscription_license_id,
  ADD COLUMN linked_it_ticket_id INT UNSIGNED NULL AFTER linked_subscription_id,
  ADD COLUMN linked_phone_line_id INT UNSIGNED NULL AFTER linked_it_ticket_id,
  ADD COLUMN skipped_reason VARCHAR(255) NULL AFTER notes,
  ADD KEY idx_hrga_task_resp_due (responsible_user_id, status, due_date),
  ADD KEY idx_hrga_task_phone (linked_phone_line_id),
  ADD CONSTRAINT fk_hrga_task_subscription FOREIGN KEY (linked_subscription_id) REFERENCES software_subscriptions (id),
  ADD CONSTRAINT fk_hrga_task_it_ticket FOREIGN KEY (linked_it_ticket_id) REFERENCES it_tickets (id),
  ADD CONSTRAINT chk_hrga_task_skipped_reason CHECK (status <> 'skipped' OR CHAR_LENGTH(TRIM(COALESCE(skipped_reason, ''))) > 0)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- hrga_checklist_templates

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_checklist_templates' AND column_name = 'active_key');
SET @sql := IF(@need, "ALTER TABLE hrga_checklist_templates
  ADD COLUMN department_id INT UNSIGNED NULL AFTER workflow_type,
  ADD COLUMN updated_by INT UNSIGNED NULL AFTER is_active,
  ADD COLUMN active_key INT UNSIGNED GENERATED ALWAYS AS (IF(is_active = 1, COALESCE(department_id, 0), NULL)) STORED,
  ADD UNIQUE KEY uq_hrga_tpl_active (entity_id, workflow_type, active_key),
  ADD CONSTRAINT fk_hrga_tpl_department FOREIGN KEY (department_id) REFERENCES departments (id),
  ADD CONSTRAINT fk_hrga_tpl_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- people_directory

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'people_directory' AND column_name = 'starts_on');
SET @sql := IF(@need, "ALTER TABLE people_directory
  ADD COLUMN starts_on DATE NULL AFTER status,
  MODIFY resigned_on_source ENUM('entered','import','account','offboarding') NULL", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- permissions

-- Audit 0.2: a Member edited anyone's workflow. Only the People & Culture
-- Member system roles lose hrga.manage; Supervisor and Head keep/gain it.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.is_system_template = 1 AND d.code = 'people_culture' AND r.role_level = 'member'
  AND p.code = 'hrga.manage';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'hrga.manage'
WHERE r.is_system_template = 1 AND d.code = 'people_culture'
  AND r.role_level IN ('supervisor', 'head') AND r.deleted_at IS NULL;

-- ---------------------------------------------------------------- approval matrix

-- One required step. The approver of that step is set at submit by the
-- resolver; the rule stays attached so the 24 h reminder / 48 h escalation to
-- the Management Office Head keeps working.
INSERT INTO approval_matrix
  (matrix_key, matrix_name, entity_id, department_id, request_type, level, order_index,
   approver_role_id, escalation_role_id, is_required, currency, flow_type, is_optional,
   priority, reminder_after_hours, escalate_after_hours, is_active)
SELECT seed.matrix_key, seed.matrix_name, e.id, NULL, seed.request_type, 1, 1,
       head.id, head.id, 1, 'IDR', 'sequential', 0,
       50, 24, 48, 1
FROM (
  SELECT 'hrga_onboarding:default' AS matrix_key, 'People & Culture — Onboarding' AS matrix_name,
         'hrga_onboarding' AS request_type
  UNION ALL SELECT 'hrga_offboarding:default', 'People & Culture — Offboarding', 'hrga_offboarding'
) seed
JOIN entities e ON e.id = 1 AND e.deleted_at IS NULL
JOIN roles head ON head.entity_id = e.id AND head.role_key = 'management_office.head' AND head.deleted_at IS NULL
LEFT JOIN approval_matrix existing
  ON existing.entity_id = e.id
 AND existing.request_type = seed.request_type
 AND existing.is_active = 1
 AND existing.deleted_at IS NULL
WHERE existing.id IS NULL;
