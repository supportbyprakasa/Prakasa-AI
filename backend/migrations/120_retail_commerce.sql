-- ============================================================
-- Migration 120 — Retail Commerce: marketplace performance page.
--
-- The Retail Commerce division sells through marketplaces (Shopee,
-- Tokopedia). Its numbers are read from the approved Accurate mirror the
-- views already route to the retail_commerce department
-- (sales_revenue_accurate, sales_invoices_accurate, sales_invoice_lines_accurate,
-- sales_so_accurate, wh_so_fulfilment_accurate …). No new table, no new view:
-- the page and the management provider read those views, scoped in SQL to the
-- Retail Commerce department.
--
-- Permission (mirrors backend/src/config/standardOrganization.js):
--   retail.insight.view  Retail Commerce member/supervisor/head, Sales
--                        supervisor/head, Management Office supervisor/head,
--                        Super Admin. It shows rupiah figures (revenue on
--                        DPP, marketplace receivables).
--
-- Permissions only; no existing data is changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('retail.insight.view', 'Lihat kinerja marketplace Retail Commerce: omzet (sebelum PPN), pesanan, retur, piutang marketplace, dan SO belum dikirim');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'retail.insight.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN (
     'retail_commerce.member', 'retail_commerce.supervisor', 'retail_commerce.head',
     'sales.supervisor', 'sales.head',
     'management_office.supervisor', 'management_office.head',
     'system.super_admin'
   );
