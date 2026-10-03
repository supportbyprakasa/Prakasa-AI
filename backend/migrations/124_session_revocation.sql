-- Sign out everywhere (security review, 1 Oct 2026): users.tokens_valid_after.
-- POST /auth/logout sets it to NOW(); requireAuth refuses every session (JWT)
-- issued before it with SESSION_EXPIRED. Column only; no data changes.
SET NAMES utf8mb4;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'tokens_valid_after');
SET @sql := IF(@need, 'ALTER TABLE users ADD COLUMN tokens_valid_after TIMESTAMP NULL AFTER password_changed_at', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
