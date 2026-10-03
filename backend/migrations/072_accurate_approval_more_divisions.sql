-- ============================================================
-- Migration 072 — Accurate batches for Warehouse, Procurement and Finance
--
-- Same approval shape as Sales (migration 061): the division's Supervisor
-- approves, its Head is the escalation (and holds the step from the start).
-- One rule per division; inserted only when that division has none yet.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

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
 WHERE d.code IN ('warehouse', 'procurement', 'finance')
   AND d.deleted_at IS NULL
   AND existing.id IS NULL;
