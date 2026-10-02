-- Prakasa AI Wave D2 (2 Oct 2026): "Periksa dengan AI" on a Data Accurate batch.
-- One row per batch: the last review someone ran — the automatic findings
-- (JSON) and, when asked for, the AI's note for the human who decides.
-- A re-run replaces the row. A review never changes the batch or its approval.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_batch_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  batch_id INT UNSIGNED NOT NULL,
  requested_by INT UNSIGNED NULL,
  findings JSON NOT NULL,
  ai_note TEXT NULL,
  ai_status VARCHAR(30) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_batch_reviews_batch (batch_id),
  KEY idx_accurate_batch_reviews_entity (entity_id, created_at),
  CONSTRAINT fk_accurate_batch_reviews_batch FOREIGN KEY (batch_id) REFERENCES sales_accurate_batches (id) ON DELETE CASCADE,
  CONSTRAINT fk_accurate_batch_reviews_user FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
