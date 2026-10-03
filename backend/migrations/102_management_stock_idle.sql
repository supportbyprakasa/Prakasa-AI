-- ============================================================
-- Migration 102 — Management 3.3: barang lambat laku
--
--   mg_stock_idle_accurate   every item with Accurate stock above zero (total over
--                            every gudang, base units), when it last sold (approved
--                            faktur lines, down payments left out), since when it
--                            has been idle and for how many WIB days:
--                              sold before  → since its last sale
--                              never sold   → since the later of its first PO and
--                                             the first day with faktur lines (a
--                                             new product is not idle before it
--                                             arrives); never_sold = 1
--                            plus what left the stock in the last 30 days (stock
--                            versions, 080) as context.
-- Faktur lines are the only sales history reaching back 60–90 days (from 2 Jan
-- 2026); surat jalan start 2 Sep 2026 and stock versions 29 Sep 2026. Most
-- never-sold items are old item codes (MKR-…) whose stock was never moved to
-- the new code: the page lists them apart ("cek kode lama").
-- Quantities only (D1/D2): the rupiah value is added by the price service, for
-- price viewers only. Items appear once there is sales history.
-- View only over the insert-only mirror; nothing copied, changed or removed.
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW mg_stock_idle_accurate AS
WITH sold AS (
       SELECT x.entity_id, x.item_code, MIN(x.trans_date) AS first_sold_on, MAX(x.trans_date) AS last_sold_on
         FROM mg_invoice_lines_accurate x
        WHERE NOT x.is_dp AND x.item_code IS NOT NULL
        GROUP BY x.entity_id, x.item_code),
     horizon AS (SELECT s.entity_id, MIN(s.first_sold_on) AS data_start FROM sold s GROUP BY s.entity_id),
     bought AS (SELECT p.entity_id, p.item_no, MIN(p.trans_date) AS first_po_on
                  FROM pc_po_lines_accurate p GROUP BY p.entity_id, p.item_no)
SELECT y.*, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), y.idle_since) AS idle_days
  FROM (SELECT t.entity_id, t.department_id, t.item_id, t.item_no, t.item_name, t.qty, t.qty_all_units,
               s.last_sold_on, b.first_po_on, h.data_start, s.last_sold_on IS NULL AS never_sold,
               COALESCE(s.last_sold_on, GREATEST(COALESCE(b.first_po_on, h.data_start), h.data_start)) AS idle_since,
               c.out_30d, c.history_days
          FROM wh_stock_total_accurate t
          JOIN horizon h ON h.entity_id = t.entity_id
          LEFT JOIN sold s ON s.entity_id = t.entity_id AND s.item_code = t.item_no
          LEFT JOIN bought b ON b.entity_id = t.entity_id AND b.item_no = t.item_no
          LEFT JOIN wh_stock_cover_accurate c ON c.entity_id = t.entity_id AND c.item_id = t.item_id
         WHERE t.qty > 0) y;
