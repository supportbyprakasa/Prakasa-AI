-- ============================================================
-- Migration 061 — Accurate data waits for division approval
--
-- Owner's decision (2026-09-29): nothing from Accurate lands in the Sales
-- tables until the division's Supervisor (escalating to the Head) approves it.
-- Every pull becomes a batch per division — e-Commerce orders and customers go
-- to Retail Commerce, everything else to Sales — held in these staging tables
-- and submitted through the standard approval engine. Approving applies the
-- batch inside the decision transaction; rejecting changes nothing.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS sales_accurate_batches (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id           INT UNSIGNED NOT NULL,
  department_id       INT UNSIGNED NOT NULL,
  sync_run_id         INT UNSIGNED NULL,
  status              ENUM('pending','applied','rejected') NOT NULL DEFAULT 'pending',
  approval_request_id INT UNSIGNED NULL,
  item_count          INT NOT NULL DEFAULT 0,
  summary             JSON NULL,
  requested_by        INT UNSIGNED NOT NULL,
  decided_by          INT UNSIGNED NULL,
  decided_at          DATETIME NULL,
  decision_note       VARCHAR(500) NULL,
  applied_at          DATETIME NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_sales_accurate_batches_status (entity_id, department_id, status),
  KEY idx_sales_accurate_batches_approval (approval_request_id),
  CONSTRAINT fk_sales_accurate_batches_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_sales_accurate_batches_requested_by FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per change: what the app has now (before) and what Accurate says
-- (after), so the approver sees exactly what approving will do.
CREATE TABLE IF NOT EXISTS sales_accurate_batch_items (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id     INT UNSIGNED NOT NULL,
  record_type  VARCHAR(20) NOT NULL,
  action       ENUM('create','update','delete') NOT NULL,
  external_key VARCHAR(120) NOT NULL,
  label        VARCHAR(255) NULL,
  amount       DECIMAL(18,2) NULL,
  before_data  JSON NULL,
  after_data   JSON NULL,
  UNIQUE KEY uq_sales_accurate_item (batch_id, record_type, external_key),
  CONSTRAINT fk_sales_accurate_items_batch FOREIGN KEY (batch_id) REFERENCES sales_accurate_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supervisor approves, Head is the escalation — the same shape as Warehouse.
-- One rule per division; inserted only when that division has none yet.
INSERT INTO approval_matrix
  (matrix_key, matrix_name, entity_id, department_id, request_type, level, order_index,
   approver_role_id, escalation_role_id, is_required, currency, flow_type, is_optional,
   priority, reminder_after_hours, escalate_after_hours, is_active)
SELECT CONCAT('sales_accurate_sync:', d.code), CONCAT('Data Accurate — ', d.name), d.entity_id, d.id,
       'sales_accurate_sync', 1, 1, supervisor.id, head.id, 1, 'IDR', 'sequential', 0,
       50, 8, 24, 1
  FROM departments d
  JOIN roles supervisor ON supervisor.entity_id = d.entity_id AND supervisor.role_key = CONCAT(d.code, '.supervisor') AND supervisor.deleted_at IS NULL
  JOIN roles head ON head.entity_id = d.entity_id AND head.role_key = CONCAT(d.code, '.head') AND head.deleted_at IS NULL
  LEFT JOIN approval_matrix existing
    ON existing.entity_id = d.entity_id
   AND existing.department_id = d.id
   AND existing.request_type = 'sales_accurate_sync'
   AND existing.is_active = 1
   AND existing.deleted_at IS NULL
 WHERE d.code IN ('sales', 'retail_commerce')
   AND d.deleted_at IS NULL
   AND existing.id IS NULL;
