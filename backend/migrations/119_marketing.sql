-- ============================================================
-- Migration 119 — Marketing division module (owner, 1 Oct 2026).
--
--   Produk & channel  read-only insights over the approved Accurate mirror
--                     (sales_revenue_accurate, mg_invoice_lines_accurate,
--                     sales_customers_accurate) and the Sales app's leads —
--                     aggregates only, no new table.
--   Kampanye          a campaign tracker owned by the entity's Marketing
--                     division (department_id, set by the service):
--     mkt_campaigns       one campaign: channels, objective, dates, budget, status
--     mkt_campaign_items  its target products (Accurate item codes)
--
-- Campaign performance is never stored: revenue and quantity of the target
-- products in the campaign's channels during the campaign, against the
-- same-length period right before it, plus new customers (NOO) — computed live
-- from the approved Accurate mirror (services/marketingCampaigns.service.js).
--
-- channels: JSON — the string "all" or an array of customer channel codes
-- (services/salesNumbers.js CUSTOMER_CHANNELS), validated by the service.
-- No delete: a campaign ends in 'selesai' or 'dibatalkan'. Every edit carries
-- `version` (optimistic lock, 409 VERSION_CONFLICT).
--
-- Permissions (mirrors backend/src/config/standardOrganization.js):
--   marketing.insight.view      Marketing member/supervisor/head, Management
--                               Office supervisor/head, Sales supervisor/head,
--                               Super Admin
--   marketing.campaign.manage   Marketing supervisor/head, Super Admin
--
-- New tables and permissions only; no existing data is changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS mkt_campaigns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  channels JSON NOT NULL,
  objective ENUM('awareness', 'penjualan', 'produk_baru', 'reaktivasi', 'lainnya') NOT NULL,
  start_on DATE NOT NULL,
  end_on DATE NOT NULL,
  budget DECIMAL(15,2) NULL,
  status ENUM('draft', 'berjalan', 'selesai', 'dibatalkan') NOT NULL DEFAULT 'draft',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(1000) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mkt_campaigns_entity_id (entity_id, id),
  KEY idx_mkt_campaigns_status (entity_id, status, end_on),
  KEY idx_mkt_campaigns_department (department_id),
  CONSTRAINT chk_mkt_campaigns_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT chk_mkt_campaigns_dates CHECK (end_on >= start_on),
  CONSTRAINT chk_mkt_campaigns_budget CHECK (budget IS NULL OR budget >= 0),
  CONSTRAINT chk_mkt_campaigns_channels CHECK (JSON_TYPE(channels) IN ('ARRAY', 'STRING')),
  CONSTRAINT fk_mkt_campaigns_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_mkt_campaigns_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_mkt_campaigns_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_mkt_campaigns_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Target products: Accurate item codes (sales_items_accurate.item_code), with
-- the name as it was when chosen. No products = every product.
CREATE TABLE IF NOT EXISTS mkt_campaign_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  campaign_id INT UNSIGNED NOT NULL,
  item_no VARCHAR(120) NOT NULL,
  item_name VARCHAR(255) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mkt_campaign_items (campaign_id, item_no),
  KEY idx_mkt_campaign_items_item (entity_id, item_no),
  CONSTRAINT chk_mkt_campaign_items_no CHECK (CHAR_LENGTH(TRIM(item_no)) > 0),
  CONSTRAINT fk_mkt_campaign_items_campaign FOREIGN KEY (entity_id, campaign_id) REFERENCES mkt_campaigns (entity_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ permissions
INSERT IGNORE INTO permissions (code, description) VALUES
('marketing.insight.view', 'Lihat insight Marketing: omzet per channel dan produk (agregat, DPP), customer baru, leads per area, dan hasil kampanye'),
('marketing.campaign.manage', 'Kelola kampanye Marketing: buat, ubah, jalankan, selesaikan, atau batalkan kampanye');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'marketing.insight.view'
 WHERE r.deleted_at IS NULL AND r.role_key IN (
   'marketing.member', 'marketing.supervisor', 'marketing.head',
   'management_office.supervisor', 'management_office.head',
   'sales.supervisor', 'sales.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'marketing.campaign.manage'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('marketing.supervisor', 'marketing.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('marketing.insight.view', 'marketing.campaign.manage')
 WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
