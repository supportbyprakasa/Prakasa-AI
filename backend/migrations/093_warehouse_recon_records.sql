-- ============================================================
-- Migration 093 — Warehouse 3.2: pencocokan Barang Masuk/Keluar ↔ Accurate
--                 (app-side records + permissions)
--
-- Two small records kept by the Warehouse, never deleted (cancelling keeps the
-- row with cancelled_at, like sales_invoice_exchanges in 096):
--   warehouse_recon_links  a Warehouse Supervisor/Head pairs an approved movement
--                          with an Accurate document its reference did not find
--   warehouse_recon_notes  a Supervisor/Head explains a difference (sampel,
--                          drop-ship, retur …); it applies only while the group
--                          still has the signature it was explained for
-- Permissions (mirrors backend/src/config/standardOrganization.js; D1/D2):
--   warehouse.recon.view     Warehouse (every role), Management Office Supervisor/Head
--   warehouse.recon.resolve  Warehouse Supervisor/Head
-- New tables only; no existing data is changed. Accurate is never written.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_recon_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  movement_type VARCHAR(10) COLLATE utf8mb4_unicode_ci NOT NULL,   -- 'inbound' | 'outbound'
  movement_id INT UNSIGNED NOT NULL,                               -- warehouse_inbound.id / warehouse_outbound.id
  doc_type VARCHAR(12) COLLATE utf8mb4_unicode_ci NOT NULL,        -- 'receipt' | 'delivery' | 'transfer' | 'adjustment'
  doc_id BIGINT NOT NULL,                                          -- accurate_records.accurate_id
  doc_number VARCHAR(120) COLLATE utf8mb4_unicode_ci NULL,         -- as shown when linked (display only)
  reason VARCHAR(255) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_by INT UNSIGNED NULL,
  cancel_reason VARCHAR(255) NULL,
  -- One live manual link per Accurate document and direction: cancelling frees the slot (NULL is not unique).
  live_doc VARCHAR(60) COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (IF(cancelled_at IS NULL, CONCAT(movement_type, ':', doc_type, ':', doc_id), NULL)) STORED,
  UNIQUE KEY uq_wh_recon_links_live (entity_id, live_doc),
  KEY idx_wh_recon_links_movement (entity_id, movement_type, movement_id),
  CONSTRAINT chk_wh_recon_links_type CHECK (movement_type IN ('inbound', 'outbound')),
  CONSTRAINT chk_wh_recon_links_doc CHECK (doc_type IN ('receipt', 'delivery', 'transfer', 'adjustment')),
  CONSTRAINT fk_wh_recon_links_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_wh_recon_links_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_wh_recon_links_cancelled FOREIGN KEY (cancelled_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warehouse_recon_notes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  direction VARCHAR(10) COLLATE utf8mb4_unicode_ci NOT NULL,       -- 'inbound' | 'outbound'
  group_key VARCHAR(90) COLLATE utf8mb4_unicode_ci NOT NULL,       -- wh_recon_groups.group_key
  status VARCHAR(20) COLLATE utf8mb4_unicode_ci NOT NULL,          -- the status that was explained
  signature CHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,          -- wh_recon_groups.signature at that moment
  reason VARCHAR(500) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_by INT UNSIGNED NULL,
  cancel_reason VARCHAR(255) NULL,
  -- One live explanation per group; a new one first cancels a lapsed one.
  live_group VARCHAR(110) COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (IF(cancelled_at IS NULL, CONCAT(direction, ':', group_key), NULL)) STORED,
  UNIQUE KEY uq_wh_recon_notes_live (entity_id, live_group),
  KEY idx_wh_recon_notes_group (entity_id, direction, group_key),
  CONSTRAINT chk_wh_recon_notes_direction CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT fk_wh_recon_notes_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_wh_recon_notes_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_wh_recon_notes_cancelled FOREIGN KEY (cancelled_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code, description) VALUES
('warehouse.recon.view', 'Lihat pencocokan Barang Masuk/Keluar dengan dokumen Accurate (jumlah saja, tanpa harga)'),
('warehouse.recon.resolve', 'Pasangkan manual atau jelaskan selisih pencocokan gudang dengan Accurate');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'warehouse.recon.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('warehouse.member', 'warehouse.supervisor', 'warehouse.head',
                      'management_office.supervisor', 'management_office.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'warehouse.recon.resolve'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('warehouse.supervisor', 'warehouse.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('warehouse.recon.view', 'warehouse.recon.resolve')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;
