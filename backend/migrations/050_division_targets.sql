-- ============================================================
-- Migration 050 — Target & realisasi per divisi
--
-- Management sets a target per division, per metric, per period. The ACTUAL
-- value is never stored: it is computed live from issues and approvals, so a
-- target is always compared with what really happened, not with a snapshot.
--
-- metric_key is validated against the catalog in targets.service.js rather
-- than an ENUM, so adding a metric does not need a migration.
--
-- (047 is reserved for the module removal migration.)
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS division_targets (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_id     INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  metric_key    VARCHAR(40)  NOT NULL,
  period_type   ENUM('month','quarter') NOT NULL,
  period_start  DATE NOT NULL COMMENT 'first day of the month or quarter',
  target_value  DECIMAL(12,2) NOT NULL,
  note          VARCHAR(500) NULL,
  created_by    INT UNSIGNED NULL,
  updated_by    INT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One target per division, metric and period: writes upsert onto this key.
  UNIQUE KEY uq_division_target (entity_id, department_id, metric_key, period_type, period_start),
  KEY idx_target_period (entity_id, period_type, period_start),
  CONSTRAINT fk_target_entity     FOREIGN KEY (entity_id)     REFERENCES entities (id),
  CONSTRAINT fk_target_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_target_creator    FOREIGN KEY (created_by)    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_target_updater    FOREIGN KEY (updated_by)    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
