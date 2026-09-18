-- ============================================================
-- Migration 024 — AI Command Center (Batch 3 Part 1)
-- Additive/idempotent. Batch 1-2 migrations end at 023.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- n8n is an opt-in provider. Existing provider values remain valid.
-- tasks.source_id already references BIGINT chat messages and now AI proposals.
-- Widen it so source references cannot overflow INT UNSIGNED.
ALTER TABLE tasks
  MODIFY COLUMN source_id BIGINT UNSIGNED NULL;

ALTER TABLE ai_module_contexts
  MODIFY COLUMN provider ENUM('openai','gemini','claude','n8n') NOT NULL;

CREATE TABLE IF NOT EXISTS ai_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  owner_user_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NULL,
  session_type VARCHAR(60) NOT NULL DEFAULT 'general',
  visibility ENUM('private','department','entity') NOT NULL DEFAULT 'private',
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  ai_module VARCHAR(80) NOT NULL DEFAULT 'ai_command_center',
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  system_context MEDIUMTEXT NULL,
  generation_status ENUM('idle','generating') NOT NULL DEFAULT 'idle',
  generation_started_at TIMESTAMP NULL,
  generation_token VARCHAR(64) NULL,
  last_message_at TIMESTAMP NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  KEY idx_ais_owner_status_last (owner_user_id, status, last_message_at),
  KEY idx_ais_entity_dept_vis (entity_id, department_id, visibility),
  KEY idx_ais_module (ai_module),
  KEY idx_ais_generation (generation_status, generation_started_at),
  CONSTRAINT fk_ais_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_ais_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_ais_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_ais_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  role ENUM('user','assistant','system','tool') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  tokens_in INT UNSIGNED NULL,
  tokens_out INT UNSIGNED NULL,
  reply_to_message_id BIGINT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aim_session_id (session_id, id),
  KEY idx_aim_entity_dept (entity_id, department_id),
  KEY idx_aim_created_by (created_by, created_at),
  CONSTRAINT fk_aim_session FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_aim_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_aim_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_aim_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_aim_reply_to FOREIGN KEY (reply_to_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_context_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  context_type VARCHAR(80) NOT NULL,
  context_id BIGINT UNSIGNED NOT NULL,
  relation VARCHAR(50) NOT NULL DEFAULT 'reference',
  added_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_acl_session_ctx (session_id, context_type, context_id, relation),
  KEY idx_acl_session (session_id),
  KEY idx_acl_entity_type (entity_id, context_type),
  CONSTRAINT fk_acl_session FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_acl_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_acl_added_by FOREIGN KEY (added_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_action_proposals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NULL,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  action_type VARCHAR(80) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('proposed','confirmed','rejected','executed','failed','expired') NOT NULL DEFAULT 'proposed',
  proposed_by_ai_module VARCHAR(80) NULL,
  confirmed_by INT UNSIGNED NULL,
  confirmed_at TIMESTAMP NULL,
  executed_by INT UNSIGNED NULL,
  executed_at TIMESTAMP NULL,
  execution_result_json JSON NULL,
  failure_message VARCHAR(1000) NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_aap_session (session_id, status),
  KEY idx_aap_entity (entity_id, status),
  KEY idx_aap_type_status (action_type, status),
  CONSTRAINT fk_aap_session FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_aap_message FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_aap_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_aap_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_aap_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id),
  CONSTRAINT fk_aap_executed_by FOREIGN KEY (executed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NULL,
  message_id BIGINT UNSIGNED NULL,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  module VARCHAR(80) NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  event_type VARCHAR(60) NOT NULL,
  tokens_in INT UNSIGNED NULL,
  tokens_out INT UNSIGNED NULL,
  duration_ms INT UNSIGNED NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aue_entity_time (entity_id, created_at),
  KEY idx_aue_dept_time (department_id, created_at),
  KEY idx_aue_user_time (user_id, created_at),
  KEY idx_aue_session_time (session_id, created_at),
  KEY idx_aue_provider_module (provider, module, created_at),
  CONSTRAINT fk_aue_session FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_aue_message FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_aue_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_aue_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_aue_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
