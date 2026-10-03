-- ============================================================
-- Migration 051 — Room for rupiah targets
--
-- target_value was DECIMAL(12,2): at most ~Rp 10 miliar. Since Sales and
-- Finance report rupiah metrics into Target & realisasi, a quarterly revenue or
-- payment target can easily exceed that. DECIMAL(18,2) holds up to ~Rp 9.999
-- triliun, well above any realistic target; the service caps at Rp 1.000
-- triliun so the column can never overflow.
-- Idempotent: only widens when the column is still narrower.
-- ============================================================
SET NAMES utf8mb4;

SET @precision := (SELECT NUMERIC_PRECISION FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'division_targets' AND COLUMN_NAME = 'target_value');
SET @s := IF(@precision IS NOT NULL AND @precision < 18,
  'ALTER TABLE division_targets MODIFY target_value DECIMAL(18,2) NOT NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
