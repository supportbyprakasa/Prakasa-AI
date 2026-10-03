-- ============================================================
-- Migration 066 — Accurate mirror: insert-only, versioned
--
-- Owner's decision (2026-09-29, "TEGAS"): no change and no removal of any
-- data — not in Accurate (the app cannot write there at all) and not of the
-- app's own existing data (the recap SO/customers/leads stay as they are).
-- Accurate data therefore lives in its own table, filled only by approved
-- batches, and only ever by INSERT: a change in Accurate becomes a new
-- version row; a document that is no longer in Accurate (or no longer final)
-- gets a new version marked `missing`. Nothing is updated or deleted here.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_records (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id          INT UNSIGNED NOT NULL,
  record_type        VARCHAR(30) NOT NULL,
  accurate_id        BIGINT NOT NULL,
  version            INT NOT NULL,
  number             VARCHAR(120) NULL,
  name               VARCHAR(255) NULL,
  trans_date         DATE NULL,
  due_date           DATE NULL,
  customer_no        VARCHAR(80) NULL,
  customer_name      VARCHAR(255) NULL,
  channel            VARCHAR(80) NULL,
  salesman           VARCHAR(160) NULL,
  status             VARCHAR(60) NULL,
  dpp_amount         DECIMAL(18,2) NULL,
  total_amount       DECIMAL(18,2) NULL,
  outstanding_amount DECIMAL(18,2) NULL,
  missing            TINYINT(1) NOT NULL DEFAULT 0,
  data               JSON NULL,
  content_hash       CHAR(64) NOT NULL,
  batch_id           INT UNSIGNED NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_records_version (entity_id, record_type, accurate_id, version),
  KEY idx_accurate_records_date (entity_id, record_type, trans_date),
  KEY idx_accurate_records_customer (entity_id, record_type, customer_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "missing" replaces "delete" in batches: nothing is ever deleted.
ALTER TABLE sales_accurate_batch_items MODIFY action ENUM('create','update','delete','missing') NOT NULL;
