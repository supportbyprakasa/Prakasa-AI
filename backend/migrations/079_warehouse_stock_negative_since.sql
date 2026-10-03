-- ============================================================
-- Migration 079 — since when a stock position has been below zero
--
-- wh_stock_negative_accurate: every item × gudang now below zero in approved
-- Accurate stock, with the time of the first approved version of its current
-- negative streak (quantity changes that stay below zero do not restart it).
-- Used by the management escalation "Stok minus di Accurate". View only over
-- the insert-only mirror; the unique (entity, type, id, version) index serves
-- the history lookups. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_stock_negative_accurate AS
SELECT w.id, w.entity_id, w.department_id, w.warehouse_id, w.warehouse_name, w.item_no, w.qty,
       (SELECT MIN(r.created_at) FROM accurate_records r
         WHERE r.entity_id = w.entity_id AND r.record_type = 'wh_stock' AND r.accurate_id = w.id
           AND r.version > COALESCE((SELECT MAX(p.version) FROM accurate_records p
                                      WHERE p.entity_id = w.entity_id AND p.record_type = 'wh_stock' AND p.accurate_id = w.id
                                        AND CAST(JSON_EXTRACT(p.data, '$.qty') AS DECIMAL(18,4)) >= 0), 0)) AS negative_since
  FROM wh_stock_accurate w
 WHERE w.qty < 0;
