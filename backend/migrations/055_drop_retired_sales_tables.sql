-- ============================================================
-- Migration 055 — Drop the tables of retired Sales and sample features
--
-- Owner's decision (2026-09-29): the features are gone (migration 053), so is
-- their data. Contents at the time of the decision: sales_pipeline 1 test deal,
-- sales_pipeline_history 8 rows, field_sales_bot_sessions 1 test session,
-- every other table empty.
--
-- Two live tables still pointed at them through columns that were never
-- filled (0 rows each): sales_visit_reports.pipeline_id and
-- warehouse_incidents.sample_task_id. Their foreign keys and columns go first.
-- activity_logs is not touched: the audit trail stays.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

-- A. sales_visit_reports.pipeline_id
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports'
    AND COLUMN_NAME = 'pipeline_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @s := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE sales_visit_reports DROP FOREIGN KEY ', @fk));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'pipeline_id');
SET @s := IF(@c = 0, 'SELECT 1', 'ALTER TABLE sales_visit_reports DROP COLUMN pipeline_id');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- B. warehouse_incidents.sample_task_id
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_incidents'
    AND COLUMN_NAME = 'sample_task_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @s := IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE warehouse_incidents DROP FOREIGN KEY ', @fk));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouse_incidents' AND COLUMN_NAME = 'sample_task_id');
SET @s := IF(@c = 0, 'SELECT 1', 'ALTER TABLE warehouse_incidents DROP COLUMN sample_task_id');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- C. The retired tables, children before parents.
DROP TABLE IF EXISTS warehouse_delivery_proofs;
DROP TABLE IF EXISTS warehouse_sample_tasks;
DROP TABLE IF EXISTS sales_sample_requests;
DROP TABLE IF EXISTS sales_followups;
DROP TABLE IF EXISTS sales_quotations;
DROP TABLE IF EXISTS sales_pipeline_history;
DROP TABLE IF EXISTS sales_pipeline;
DROP TABLE IF EXISTS sales_inquiries;
DROP TABLE IF EXISTS field_sales_bot_messages;
DROP TABLE IF EXISTS field_sales_bot_sessions;
