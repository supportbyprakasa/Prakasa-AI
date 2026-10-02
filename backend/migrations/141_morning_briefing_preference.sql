-- Prakasa AI Wave D1 (2 Oct 2026): users.morning_briefing — whether the home
-- page shows the "Ringkasan pagi" card. The user switches it in Akun saya
-- (PATCH /auth/me/preferences). Shown by default. Column only; no data changes.
SET NAMES utf8mb4;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'morning_briefing');
SET @sql := IF(@need, 'ALTER TABLE users ADD COLUMN morning_briefing TINYINT(1) NOT NULL DEFAULT 1 AFTER language', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
