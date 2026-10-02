-- ============================================================
-- Migration 053 — Sales is four modules: Customers, Leads, Sales Pipeline
-- (automatic) and Data Sales
--
-- Retired, pages and code removed: the hand-typed deal pipeline, inquiries,
-- quotations, visit-report forms, Field Sales Bot, and the whole sample flow
-- (Sales Sample Requests, Warehouse Sample Queue and Delivery Proof). Their
-- permissions are revoked from every role and removed, so no role editor offers
-- them any more.
--
-- The tables themselves (sales_pipeline, sales_quotations, sales_inquiries,
-- sales_followups, sales_sample_requests, warehouse_sample_tasks,
-- warehouse_delivery_proofs, field_sales_bot_*) are kept untouched; dropping
-- data is a separate, explicit decision.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN (
  'sales.inquiry.view', 'sales.inquiry.manage', 'sales.pipeline.manage',
  'sales.visit.view', 'sales.visit.create', 'sales.quotation.view', 'sales.quotation.manage',
  'sales.sample.view', 'sales.sample.request', 'sales.sample.approve', 'sales.field_bot.use',
  'warehouse.sample.view', 'warehouse.sample.manage', 'warehouse.delivery_proof.upload'
);

DELETE FROM permissions
WHERE code IN (
  'sales.inquiry.view', 'sales.inquiry.manage', 'sales.pipeline.manage',
  'sales.visit.view', 'sales.visit.create', 'sales.quotation.view', 'sales.quotation.manage',
  'sales.sample.view', 'sales.sample.request', 'sales.sample.approve', 'sales.field_bot.use',
  'warehouse.sample.view', 'warehouse.sample.manage', 'warehouse.delivery_proof.upload'
);
