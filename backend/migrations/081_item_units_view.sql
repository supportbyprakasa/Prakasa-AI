-- ============================================================
-- Migration 081 — program 1.3: units per item from approved Accurate data
--
--   item_units_accurate   one row per item × unit: the base unit (ratio 1) and
--                         every other unit with how many base units it holds.
-- Sales, Warehouse and Procurement count a quantity in base units with
--   qty × ratio, joining on item_no and the unit name (case-insensitive:
--   Accurate has both "Pcs" and "PCS").
-- A view over the insert-only mirror (latest approved version, not "tidak ada
-- lagi"); nothing copied, changed or removed ("TEGAS"). Quantities only.
-- JSON_TABLE reads accurate_records itself (it cannot take a view column; see
-- migration 071). Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW item_units_accurate AS
SELECT r.entity_id, r.accurate_id AS item_id, r.number AS item_no, r.name AS item_name,
       JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.base_unit')) COLLATE utf8mb4_unicode_ci AS base_unit,
       JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.base_unit')) COLLATE utf8mb4_unicode_ci AS unit_name,
       CAST(1 AS DECIMAL(18,4)) AS ratio, TRUE AS is_base
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'wh_item_unit' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.record_type = 'wh_item_unit' AND r.missing = 0
   AND JSON_TYPE(JSON_EXTRACT(r.data, '$.base_unit')) = 'STRING'
UNION ALL
SELECT r.entity_id, r.accurate_id, r.number, r.name,
       JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.base_unit')) COLLATE utf8mb4_unicode_ci,
       u.unit_name COLLATE utf8mb4_unicode_ci, u.ratio, FALSE
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'wh_item_unit' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(r.data, '$.units[*]' COLUMNS (
         unit_name VARCHAR(40) PATH '$.name',
         ratio DECIMAL(18,4) PATH '$.ratio')) u
 WHERE r.record_type = 'wh_item_unit' AND r.missing = 0 AND u.ratio > 0;
