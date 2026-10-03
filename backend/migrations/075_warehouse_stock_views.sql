-- ============================================================
-- Migration 075 — Warehouse stage 1: stock from approved Accurate data
--
-- Views only over the Accurate mirror (accurate_latest); nothing copied, changed
-- or removed ("TEGAS"). Quantities only — no cost or price exists in these
-- record types. Every row belongs to the Warehouse division of its company.
--   wh_warehouses_accurate    the gudang
--   wh_stock_total_accurate   stock per item over every gudang (Accurate's own total)
--   wh_stock_accurate         stock per item × gudang
-- Stock rows are stored only while stock is (or was) there: an item without a
-- row has 0. JSON nulls are turned into SQL NULL (JSON_UNQUOTE would give 'null').
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_warehouses_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1) AS department_id,
       a.name, a.status,
       JSON_EXTRACT(a.data, '$.is_default') = TRUE AS is_default,
       JSON_EXTRACT(a.data, '$.is_scrap') = TRUE AS is_scrap,
       a.missing, a.batch_id, a.created_at AS approved_at
  FROM accurate_latest a WHERE a.record_type = 'wh_warehouse';

CREATE OR REPLACE VIEW wh_stock_total_accurate AS
SELECT a.accurate_id AS item_id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1) AS department_id,
       a.number AS item_no, a.name AS item_name,
       CAST(JSON_EXTRACT(a.data, '$.qty') AS DECIMAL(18,4)) AS qty,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.qty_all_units')), 'null') AS qty_all_units,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.upc')), 'null') AS upc,
       a.batch_id, a.created_at AS approved_at
  FROM accurate_latest a WHERE a.record_type = 'wh_stock_total';

CREATE OR REPLACE VIEW wh_stock_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1) AS department_id,
       CAST(JSON_EXTRACT(a.data, '$.item_id') AS UNSIGNED) AS item_id,
       CAST(JSON_EXTRACT(a.data, '$.warehouse_id') AS UNSIGNED) AS warehouse_id,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.warehouse')), 'null') AS warehouse_name,
       a.number AS item_no, a.name AS item_name,
       CAST(JSON_EXTRACT(a.data, '$.qty') AS DECIMAL(18,4)) AS qty,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.qty_all_units')), 'null') AS qty_all_units,
       a.batch_id, a.created_at AS approved_at
  FROM accurate_latest a WHERE a.record_type = 'wh_stock';
