-- ============================================================
-- Migration 039 — IT Ticketing
-- Any active user can submit a ticket; People & Culture Supervisor/Head
-- (the IT permission holders from migration 037) administer all tickets.
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS it_tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  category ENUM('device_damage', 'new_device_request', 'access_software', 'network') NOT NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NOT NULL,
  priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed', 'cancelled') NOT NULL DEFAULT 'open',
  device_id INT UNSIGNED NULL,
  requester_id INT UNSIGNED NOT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  resolved_by INT UNSIGNED NULL,
  closed_at TIMESTAMP NULL DEFAULT NULL,
  closed_by INT UNSIGNED NULL,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_it_tickets_requester (requester_id, status),
  KEY idx_it_tickets_entity_status (entity_id, status),
  KEY idx_it_tickets_device (device_id),
  CONSTRAINT fk_it_tickets_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_tickets_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_it_tickets_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  CONSTRAINT fk_it_tickets_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_it_tickets_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_it_tickets_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_it_tickets_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS it_ticket_comments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NOT NULL,
  author_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_it_ticket_comments_ticket (ticket_id),
  CONSTRAINT fk_it_ticket_comments_ticket FOREIGN KEY (ticket_id) REFERENCES it_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_it_ticket_comments_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS it_ticket_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  web_view_link VARCHAR(500) NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  size BIGINT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_it_ticket_attachments_ticket (ticket_id),
  CONSTRAINT fk_it_ticket_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES it_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_it_ticket_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('it_ticket.view', 'Lihat tiket IT milik sendiri, ajukan tiket baru'),
('it_ticket.create', 'Buat tiket IT baru'),
('it_ticket.comment', 'Berkomentar pada tiket IT milik sendiri'),
('it_ticket.cancel_own', 'Batalkan tiket IT milik sendiri selama masih Open'),
('it_ticket.manage', 'Kelola semua tiket IT — ubah status, prioritas, dan balas semua tiket');

-- Every active user can submit and track their own tickets.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('it_ticket.view', 'it_ticket.create', 'it_ticket.comment', 'it_ticket.cancel_own')
WHERE r.is_system_template = 1 AND r.deleted_at IS NULL;

-- People & Culture Supervisor/Head (the IT permission holders from migration 037) administer all tickets.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'it_ticket.manage'
WHERE r.is_system_template = 1 AND d.code = 'people_culture'
  AND r.role_level IN ('supervisor', 'head') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'it_ticket.manage'
WHERE LOWER(r.name) IN ('super admin', 'superadmin') AND r.deleted_at IS NULL;
