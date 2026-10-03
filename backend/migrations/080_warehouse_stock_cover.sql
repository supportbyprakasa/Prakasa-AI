-- ============================================================
-- Migration 080 — Warehouse stage 3: how long the stock lasts ("Menipis", D7)
--
-- wh_stock_cover_accurate, per item: what left the stock in the last 30 days —
-- the drops between consecutive approved versions of the item's Accurate total
-- (wh_stock_total), in base units — and how many days of approved history
-- there are (at most 30). Accurate's own minimum stock is empty for every item
-- (probe 29 Sep 2026), so days of cover replaces it: stock ÷ average daily out.
-- View only over the insert-only mirror. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_stock_cover_accurate AS
SELECT v.entity_id, v.item_id,
       SUM(CASE WHEN v.prev_qty IS NOT NULL AND v.qty < v.prev_qty AND v.created_at >= NOW() - INTERVAL 30 DAY
                THEN v.prev_qty - v.qty ELSE 0 END) AS out_30d,
       LEAST(30, GREATEST(0, DATEDIFF(NOW(), MIN(v.created_at)))) AS history_days
  FROM (SELECT r.entity_id, r.accurate_id AS item_id, r.version, r.created_at,
               CAST(JSON_EXTRACT(r.data, '$.qty') AS DECIMAL(18,4)) AS qty,
               LAG(CAST(JSON_EXTRACT(r.data, '$.qty') AS DECIMAL(18,4)))
                 OVER (PARTITION BY r.entity_id, r.accurate_id ORDER BY r.version) AS prev_qty
          FROM accurate_records r
         WHERE r.record_type = 'wh_stock_total') v
 GROUP BY v.entity_id, v.item_id;
