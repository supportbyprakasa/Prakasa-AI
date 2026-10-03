-- Langganan software (3 Oct 2026, revision F25): "Catat pembayaran" carries a
-- request key chosen by the form when it opens. A retried or double-submitted
-- request with the same key returns the payment already recorded instead of a
-- second one; two real payments of the same amount keep different keys.
-- Column and unique key only; existing payments keep a NULL key.
SET NAMES utf8mb4;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'subscription_payments' AND column_name = 'request_key');
SET @sql := IF(@need, 'ALTER TABLE subscription_payments ADD COLUMN request_key VARCHAR(64) NULL AFTER notes', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'subscription_payments' AND index_name = 'uq_subscription_payments_request');
SET @sql := IF(@need, 'ALTER TABLE subscription_payments ADD UNIQUE KEY uq_subscription_payments_request (subscription_id, request_key)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
