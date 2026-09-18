SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS meetings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  agenda TEXT NULL,
  location VARCHAR(255) NULL,
  meeting_type ENUM('internal','client','vendor','interview','other') DEFAULT 'internal',
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  timezone VARCHAR(64) DEFAULT 'Asia/Jakarta',
  google_event_id VARCHAR(190) NULL UNIQUE,
  google_calendar_id VARCHAR(190) NULL,
  meet_link VARCHAR(500) NULL,
  conference_type ENUM('meet','none') DEFAULT 'meet',
  recording_link VARCHAR(500) NULL,        -- link ke Google Meet recording
  transcript_link VARCHAR(500) NULL,       -- link ke transcript (Google Drive)
  recording_drive_file_id VARCHAR(190) NULL,
  transcript_drive_file_id VARCHAR(190) NULL,
  organizer_user_id INT UNSIGNED NOT NULL,
  status ENUM('scheduled','in_progress','completed','cancelled','rescheduled') DEFAULT 'scheduled',
  ai_summary_id BIGINT UNSIGNED NULL,      -- link ke ai_summaries
  context_record_id BIGINT UNSIGNED NULL,  -- link ke context_records (customer/project)
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (organizer_user_id) REFERENCES users(id),
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id),
  FOREIGN KEY (context_record_id) REFERENCES context_records(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_meetings_time (entity_id, start_time),
  INDEX idx_meetings_organizer (organizer_user_id, start_time),
  INDEX idx_meetings_context (context_record_id),
  INDEX idx_meetings_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meeting_participants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,               -- kalau internal
  external_email VARCHAR(190) NULL,        -- kalau peserta eksternal
  external_name VARCHAR(150) NULL,
  role ENUM('organizer','required','optional','guest') DEFAULT 'required',
  rsvp_status ENUM('needs_action','accepted','declined','tentative','none') DEFAULT 'needs_action',
  attended TINYINT(1) NULL,                -- diisi setelah meeting (manual atau via Google)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_meeting_email (meeting_id, external_email),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_participants_meeting (meeting_id),
  INDEX idx_participants_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Relasi meeting ke entitas lain (task, project, customer, dokumen) via context_records Fase 2
-- Tapi kita juga butuh tabel meeting_links untuk quick lookup tanpa join context_records
CREATE TABLE IF NOT EXISTS meeting_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT UNSIGNED NOT NULL,
  linked_type ENUM('task','project','customer','document','sales_pipeline','approval_request','other') NOT NULL,
  linked_id INT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_meeting_link (meeting_id, linked_type, linked_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  INDEX idx_meeting_link_lookup (linked_type, linked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI action items hasil ringkasan meeting — WAJIB konfirmasi user sebelum jadi task
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT UNSIGNED NOT NULL,
  ai_summary_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  suggested_assignee_user_id INT UNSIGNED NULL,
  suggested_assignee_name VARCHAR(190) NULL,
  due_date DATE NULL,
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  status ENUM('pending','confirmed','dismissed') DEFAULT 'pending',
  confirmed_by INT UNSIGNED NULL,
  confirmed_at TIMESTAMP NULL,
  created_task_id INT UNSIGNED NULL,       -- diisi kalau user konfirmasi jadi task
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id),
  FOREIGN KEY (suggested_assignee_user_id) REFERENCES users(id),
  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  FOREIGN KEY (created_task_id) REFERENCES tasks(id),
  INDEX idx_action_meeting (meeting_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
