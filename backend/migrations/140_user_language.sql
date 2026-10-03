-- Akun saya (2 Oct 2026): users.language — the interface language the user
-- chose (Indonesia / English), kept on the account so it follows them to
-- another browser. NULL = never chosen (the browser's own choice applies).
-- Column only; no data changes.
SET NAMES utf8mb4;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'language');
SET @sql := IF(@need, 'ALTER TABLE users ADD COLUMN language ENUM(''id'',''en'') NULL AFTER avatar_url', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
