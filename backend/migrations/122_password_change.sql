-- Kata sandi sementara wajib diganti (production readiness, 1 Oct 2026):
-- users.password_changed_at — set when a password is changed or reset by an
-- admin; sessions (JWT) issued before it stop working, so a reset password
-- also signs the account out everywhere. Column only; no data changes.
SET NAMES utf8mb4;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_changed_at');
SET @sql := IF(@need, 'ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL AFTER must_change_password', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
