-- ============================================================
-- Migration 145 — Pengajuan ke Accurate (data master: pelanggan, pemasok)
--
-- Owner's decision (3 Oct 2026): Accurate stays the source of truth, and
-- Prakasa Workspace may propose master-data changes to it. A change never
-- goes straight to Accurate: it is written here as a request, decided by the
-- division's Supervisor or Head, then waits in the queue until the send
-- channel is switched on (ACCURATE_WRITE_ENABLED) and confirmed by the next
-- pull. One open request per target, one request_key per submission, so a
-- change can never reach Accurate twice. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_write_requests (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id           INT UNSIGNED NOT NULL,
  department_id       INT UNSIGNED NOT NULL,
  record_type         ENUM('customer','vendor') NOT NULL,
  action              ENUM('create','update') NOT NULL,
  -- The app row the request came from (sales_customers.id for a customer).
  local_id            INT UNSIGNED NULL,
  -- Accurate's own id and number of the record being changed (update only).
  accurate_id         VARCHAR(120) NULL,
  accurate_number     VARCHAR(60) NULL,
  title               VARCHAR(255) NOT NULL,
  -- What Accurate should hold after the change / what it holds now.
  payload             JSON NOT NULL,
  before_data         JSON NULL,
  payload_hash        CHAR(64) NOT NULL,
  request_key         VARCHAR(64) NOT NULL,
  status              ENUM('pending','queued','sent','confirmed','rejected','failed','cancelled') NOT NULL DEFAULT 'pending',
  approval_request_id INT UNSIGNED NULL,
  requested_by        INT UNSIGNED NOT NULL,
  decided_by          INT UNSIGNED NULL,
  decided_at          DATETIME NULL,
  decision_note       VARCHAR(500) NULL,
  attempts            INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at     DATETIME NULL,
  last_error          VARCHAR(500) NULL,
  sent_at             DATETIME NULL,
  accurate_response   JSON NULL,
  confirmed_at        DATETIME NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_write_key (entity_id, request_key),
  KEY idx_accurate_write_status (entity_id, status, record_type),
  KEY idx_accurate_write_target (entity_id, record_type, accurate_number),
  KEY idx_accurate_write_local (entity_id, record_type, local_id),
  KEY idx_accurate_write_approval (approval_request_id),
  CONSTRAINT fk_accurate_write_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_accurate_write_requested_by FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who may propose: everyone who keeps customers (Sales, Retail Commerce) or
-- works with vendors (Procurement). Deciding stays with the approval engine
-- (approval.decide + the matrix below). Mirrors standardOrganization.js.
INSERT IGNORE INTO permissions (code, description) VALUES
('accurate.write.request', 'Ajukan perubahan data master (pelanggan, pemasok) ke Accurate lewat persetujuan Supervisor/Head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.write.request'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN (
     'sales.member', 'sales.supervisor', 'sales.head',
     'retail_commerce.member', 'retail_commerce.supervisor', 'retail_commerce.head',
     'procurement.member', 'procurement.supervisor', 'procurement.head'
   );

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.write.request'
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin'))
   AND r.deleted_at IS NULL;

-- (role_key and departments.code differ in collation on databases upgraded
-- over time, hence the explicit COLLATE.)
-- Supervisor approves, Head is the escalation and holds the step from the
-- start (owner, 3 Oct 2026: "approval dari supervisor atau head"), for every
-- division that may propose — Procurement included, unlike its pull batches.
INSERT INTO approval_matrix
  (matrix_key, matrix_name, entity_id, department_id, request_type, level, order_index,
   approver_role_id, escalation_role_id, is_required, currency, flow_type, is_optional,
   priority, reminder_after_hours, escalate_after_hours, is_active)
SELECT CONCAT('accurate_write:', d.code), CONCAT('Pengajuan ke Accurate — ', d.name), d.entity_id, d.id,
       'accurate_write', 1, 1, supervisor.id, head.id, 1, 'IDR', 'sequential', 0,
       50, 8, 24, 1
  FROM departments d
  JOIN roles supervisor ON supervisor.entity_id = d.entity_id AND supervisor.role_key COLLATE utf8mb4_unicode_ci = CONCAT(d.code, '.supervisor') AND supervisor.deleted_at IS NULL
  JOIN roles head ON head.entity_id = d.entity_id AND head.role_key COLLATE utf8mb4_unicode_ci = CONCAT(d.code, '.head') AND head.deleted_at IS NULL
  LEFT JOIN approval_matrix existing
    ON existing.entity_id = d.entity_id
   AND existing.department_id = d.id
   AND existing.request_type = 'accurate_write'
   AND existing.is_active = 1
   AND existing.deleted_at IS NULL
 WHERE d.code IN ('sales', 'retail_commerce', 'procurement')
   AND d.deleted_at IS NULL
   AND existing.id IS NULL;
