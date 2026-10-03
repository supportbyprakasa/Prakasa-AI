-- ============================================================
-- Migration 030 — AI document artifacts and extracted content
-- Binary files remain in Google Shared Drive. This table stores
-- processing metadata and a bounded text cache for AI context.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS document_ai_content (
  document_id INT UNSIGNED NOT NULL PRIMARY KEY,
  source_session_id BIGINT UNSIGNED NULL,
  source_message_id BIGINT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  original_mime_type VARCHAR(150) NOT NULL,
  original_size BIGINT UNSIGNED NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  stored_mime_type VARCHAR(150) NOT NULL,
  stored_size BIGINT UNSIGNED NOT NULL,
  compression_method ENUM('none','native','gzip') NOT NULL DEFAULT 'none',
  extraction_status ENUM('pending','ready','no_text','unsupported','failed') NOT NULL DEFAULT 'pending',
  extracted_text MEDIUMTEXT NULL,
  extraction_error VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_dac_session (source_session_id, document_id),
  KEY idx_dac_extraction (extraction_status),
  CONSTRAINT fk_dac_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_dac_session FOREIGN KEY (source_session_id) REFERENCES ai_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_dac_message FOREIGN KEY (source_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
