SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- FINANCE WORKFLOW
-- CATATAN PENTING (SOW bagian 7 & 18):
--   - Tabel di bawah HANYA menyimpan workflow payment request/reimbursement
--     + status + dokumen pendukung + link approval + referensi ke Jurnal.id.
--   - JANGAN menyimpan transaksi akuntansi, jurnal umum, saldo, pajak.
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_workflows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  workflow_type ENUM('payment_request','reimbursement') NOT NULL,
  request_number VARCHAR(80) NOT NULL UNIQUE,      -- PR-YYYYMM-XXXX / RB-YYYYMM-XXXX
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NULL,                       -- operational/vendor/travel/medical/dll
  -- detail pembayaran
  payee_name VARCHAR(190) NULL,                    -- vendor / karyawan
  payee_type ENUM('vendor','employee','other') DEFAULT 'vendor',
  payee_bank VARCHAR(120) NULL,
  payee_account_number VARCHAR(80) NULL,
  payee_account_name VARCHAR(190) NULL,
  -- nominal (murni untuk workflow, BUKAN jurnal akuntansi)
  amount DECIMAL(15,2) NOT NULL,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  -- tanggal yang relevan
  request_date DATE NOT NULL,
  requested_payment_date DATE NULL,
  due_date DATE NULL,
  -- status workflow
  status ENUM(
    'draft','pending_document_check','pending_approval','approved',
    'rejected','revision_requested','processing','paid','cancelled'
  ) DEFAULT 'draft',
  document_check_status ENUM('not_run','passed','warning','failed') DEFAULT 'not_run',
  document_check_summary TEXT NULL,
  document_check_at TIMESTAMP NULL,
  document_check_ai_summary_id BIGINT UNSIGNED NULL,
  -- link ke approval Fase 3
  approval_request_id INT UNSIGNED NULL,
  -- referensi/link ke Jurnal.id (bukan duplikasi data)
  jurnal_reference_id VARCHAR(190) NULL,
  jurnal_reference_url VARCHAR(500) NULL,
  jurnal_synced_at TIMESTAMP NULL,
  -- PIC
  requested_by INT UNSIGNED NOT NULL,
  finance_pic_user_id INT UNSIGNED NULL,           -- PIC Finance yang memproses
  paid_at TIMESTAMP NULL,
  paid_by INT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (document_check_ai_summary_id) REFERENCES ai_summaries(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (finance_pic_user_id) REFERENCES users(id),
  FOREIGN KEY (paid_by) REFERENCES users(id),
  INDEX idx_finance_entity_type (entity_id, workflow_type),
  INDEX idx_finance_status (status, request_date),
  INDEX idx_finance_requester (requested_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS finance_workflow_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  finance_workflow_id INT UNSIGNED NOT NULL,
  document_id INT UNSIGNED NULL,                    -- link ke documents Fase 2
  drive_file_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  attachment_type ENUM(
    'invoice','receipt','quotation','po','bank_proof','tax_doc','other'
  ) DEFAULT 'other',
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  size BIGINT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (finance_workflow_id) REFERENCES finance_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_fin_attach (finance_workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- HRGA WORKFLOW
-- CATATAN PENTING (SOW bagian 7 & 18):
--   - Tabel di bawah HANYA menyimpan workflow onboarding/offboarding
--     + checklist + status + referensi ke KantorKu HRIS.
--   - JANGAN menyimpan data payroll, absensi, cuti, lembur, performance.
-- ============================================================

CREATE TABLE IF NOT EXISTS hrga_workflows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  workflow_type ENUM('onboarding','offboarding') NOT NULL,
  workflow_number VARCHAR(80) NOT NULL UNIQUE,      -- ONB-YYYYMM-XXXX / OFF-YYYYMM-XXXX
  employee_user_id INT UNSIGNED NULL,               -- user internal yang sudah terdaftar
  employee_full_name VARCHAR(190) NOT NULL,         -- wajib, bisa jadi belum punya akun
  employee_email VARCHAR(190) NULL,
  employee_phone VARCHAR(40) NULL,
  employee_position VARCHAR(150) NULL,
  employee_division VARCHAR(150) NULL,
  employee_manager_user_id INT UNSIGNED NULL,
  join_date DATE NULL,                              -- onboarding
  last_working_date DATE NULL,                      -- offboarding
  effective_date DATE NOT NULL,                     -- tanggal efektif (join/last)
  reason TEXT NULL,                                 -- alasan offboarding
  status ENUM(
    'draft','pending_approval','approved','in_progress','completed',
    'rejected','revision_requested','cancelled'
  ) DEFAULT 'draft',
  -- link ke approval Fase 3
  approval_request_id INT UNSIGNED NULL,
  -- referensi/link ke KantorKu HRIS
  kantorku_employee_id VARCHAR(190) NULL,
  kantorku_reference_url VARCHAR(500) NULL,
  kantorku_synced_at TIMESTAMP NULL,
  -- PIC
  requested_by INT UNSIGNED NOT NULL,
  hrga_pic_user_id INT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  completed_by INT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (employee_user_id) REFERENCES users(id),
  FOREIGN KEY (employee_manager_user_id) REFERENCES users(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (hrga_pic_user_id) REFERENCES users(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  INDEX idx_hrga_entity_type (entity_id, workflow_type),
  INDEX idx_hrga_status (status, effective_date),
  INDEX idx_hrga_employee (employee_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hrga_workflow_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  hrga_workflow_id INT UNSIGNED NOT NULL,
  category ENUM(
    'google_workspace_access','shared_drive_access','device_handover','device_return',
    'email_account','software_license','account_deactivation','document_handover',
    'exit_interview','custom'
  ) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  responsible_user_id INT UNSIGNED NULL,
  linked_task_id INT UNSIGNED NULL,                 -- link ke tasks Fase 3
  linked_device_assignment_id INT UNSIGNED NULL,    -- link ke device_assignments Fase 5
  linked_subscription_license_id INT UNSIGNED NULL, -- link ke subscription_licenses Fase 5
  status ENUM('pending','in_progress','completed','skipped','blocked') DEFAULT 'pending',
  due_date DATE NULL,
  completed_at TIMESTAMP NULL,
  completed_by INT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (hrga_workflow_id) REFERENCES hrga_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  FOREIGN KEY (linked_task_id) REFERENCES tasks(id),
  FOREIGN KEY (linked_device_assignment_id) REFERENCES device_assignments(id),
  FOREIGN KEY (linked_subscription_license_id) REFERENCES subscription_licenses(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  INDEX idx_hrga_task_workflow (hrga_workflow_id, status),
  INDEX idx_hrga_task_responsible (responsible_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hrga_workflow_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  hrga_workflow_id INT UNSIGNED NOT NULL,
  document_id INT UNSIGNED NULL,
  drive_file_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  attachment_type ENUM(
    'offer_letter','contract','id_document','resignation_letter','handover_note','other'
  ) DEFAULT 'other',
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  size BIGINT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hrga_workflow_id) REFERENCES hrga_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_hrga_attach (hrga_workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed template checklist per jenis workflow (JSON) — memudahkan HRGA
CREATE TABLE IF NOT EXISTS hrga_checklist_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  workflow_type ENUM('onboarding','offboarding') NOT NULL,
  name VARCHAR(190) NOT NULL,
  items JSON NOT NULL,       -- [{category, title, description, dueOffsetDays, responsibleRoleId}]
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  INDEX idx_checklist_tpl (entity_id, workflow_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
