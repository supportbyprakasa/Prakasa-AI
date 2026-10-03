-- ============================================================
-- Migration 099 — Warehouse 3.4: SO shipped on time and in full (OTIF)
--
--   wh_so_fulfilment_accurate   one row per approved sales order: its promised
--                               ship date, the day it was shipped in full, and
--                               whether that was on time and complete
--   wh_so_open_lines_accurate   as 092, plus the SO date, so the shipping
--                               schedule can hand out stock by the same promise
--
-- The promise (Head Supply Chain, 30 Sep 2026; warehouseRules.promisedSql):
-- Accurate's "Tgl kirim" when Sales set it AFTER the SO date; Accurate fills it
-- with the SO date by default, so otherwise the standard: SO date + 2 days
-- (2×24 jam), moved to Monday when it falls on a Sunday (no surat jalan is
-- ever dated on a Sunday). The Sales pull stores ship_date only when it is
-- after the SO date.
--
-- Shipped on = the last surat jalan (DO) naming the SO; an SO with no DO was
-- shipped by its faktur (a faktur without DO takes the goods out of stock in
-- Accurate), down-payment fakturs excepted. In full = Accurate's percentShipped
-- reached 100. An SO closed with nothing shipped by its promise is a
-- cancellation (left out); closed later, or closed part-shipped, is short.
-- closed_on is the WIB day of the pull that first saw it closed (not the
-- approval, which can lag).
--
-- `data_through`: the WIB day the mirror of the SO's Sales division is known
-- to be complete — while a newer pull waits for approval, the day of the last
-- approved pull; otherwise the day of the last Sales pull that ran (so a Mac
-- asleep or a failed pull never turns shipped SOs into misses). SOs promised
-- from that day on cannot be judged yet (`judged` = 0). NULL = no Sales pull
-- recorded yet.
--
-- Quantities and dates only (D1): no amount of the SO is selected.
-- MySQL 9.6 refuses JSON_TABLE(a.data, '$.x[*]') directly over accurate_latest
-- ("Incorrect arguments to JSON_TABLE"); JSON_TABLE(JSON_EXTRACT(a.data, '$.x'),
-- '$[*]') reads the same array and works. The latest version is taken per
-- record type (as in 091), so the cost follows SOs, not the whole mirror.
-- Views only over the insert-only mirror; nothing copied, changed or removed.
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_so_fulfilment_accurate AS
SELECT y.id, y.entity_id, y.department_id, y.sales_department_id, y.number, y.trans_date,
       y.customer_no, y.customer_name, y.channel, y.status, y.percent_shipped, y.closed, y.closed_on,
       y.ship_date, y.promised_date, y.promised_in_so, y.shipped_on, y.shipped_by, y.so_state,
       (y.so_state <> 'cancelled' AND (y.so_state <> 'shipped' OR y.shipped_on IS NOT NULL)) AS in_otif,
       (y.so_state = 'shipped' AND y.shipped_on IS NOT NULL AND y.shipped_on <= y.promised_date) AS on_time_in_full,
       y.data_through,
       (y.data_through IS NULL OR y.promised_date < y.data_through) AS judged
  FROM (SELECT p.*,
               (CASE WHEN p.percent_shipped >= 100 THEN 'shipped'
                     WHEN p.closed AND p.percent_shipped = 0 AND p.closed_on <= p.promised_date THEN 'cancelled'
                     WHEN p.closed THEN 'short'
                     WHEN p.percent_shipped > 0 THEN 'partial'
                     ELSE 'open' END) COLLATE utf8mb4_unicode_ci AS so_state
          FROM (SELECT z.*,
                       IF(z.ship_date > z.trans_date, z.ship_date, z.trans_date + INTERVAL (2 + (DAYOFWEEK(z.trans_date + INTERVAL 2 DAY) = 1)) DAY) AS promised_date,
                       COALESCE(z.ship_date > z.trans_date, FALSE) AS promised_in_so,
                       dt.data_through
                  FROM (SELECT a.accurate_id AS id, a.entity_id,
                               (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
                                   AND d.code = 'warehouse' LIMIT 1) AS department_id,
                               (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
                                   AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
                                 LIMIT 1) AS sales_department_id,
                               a.number, a.trans_date, a.customer_no, a.customer_name, a.channel, a.status,
                               COALESCE(JSON_VALUE(a.data, '$.percent_shipped' RETURNING DECIMAL(9,4)), 0) AS percent_shipped,
                               (COALESCE(JSON_EXTRACT(a.data, '$.closed') = TRUE, FALSE) OR a.status = 'Ditutup') AS closed,
                               (SELECT DATE(MIN(COALESCE(cb.created_at, v.created_at)) + INTERVAL 7 HOUR)
                                  FROM accurate_records v LEFT JOIN sales_accurate_batches cb ON cb.id = v.batch_id
                                 WHERE v.entity_id = a.entity_id AND v.record_type = 'sales_order' AND v.accurate_id = a.accurate_id
                                   AND (v.status = 'Ditutup' OR COALESCE(JSON_EXTRACT(v.data, '$.closed') = TRUE, FALSE))) AS closed_on,
                               JSON_VALUE(a.data, '$.ship_date' RETURNING DATE) AS ship_date,
                               COALESCE(dl.last_on, il.last_on) AS shipped_on,
                               (CASE WHEN dl.last_on IS NOT NULL THEN 'delivery'
                                     WHEN il.last_on IS NOT NULL THEN 'invoice' END) COLLATE utf8mb4_unicode_ci AS shipped_by
                          FROM accurate_records a
                          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                                 WHERE record_type = 'sales_order' GROUP BY entity_id, accurate_id) am
                            ON am.entity_id = a.entity_id AND am.accurate_id = a.accurate_id AND am.v = a.version
                          LEFT JOIN (SELECT o.entity_id, j.so_number, MAX(o.trans_date) AS last_on
                                       FROM accurate_records o
                                       JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                                              WHERE record_type = 'delivery_order' GROUP BY entity_id, accurate_id) om
                                         ON om.entity_id = o.entity_id AND om.accurate_id = o.accurate_id AND om.v = o.version
                                       JOIN JSON_TABLE(JSON_EXTRACT(o.data, '$.so_numbers'), '$[*]'
                                              COLUMNS (so_number VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$')) j
                                      WHERE o.record_type = 'delivery_order' AND o.missing = 0
                                      GROUP BY o.entity_id, j.so_number) dl
                            ON dl.entity_id = a.entity_id AND dl.so_number = a.number
                          LEFT JOIN (SELECT i.entity_id, j.so_number, MAX(i.trans_date) AS last_on
                                       FROM accurate_records i
                                       JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                                              WHERE record_type = 'sales_invoice' GROUP BY entity_id, accurate_id) im
                                         ON im.entity_id = i.entity_id AND im.accurate_id = i.accurate_id AND im.v = i.version
                                       JOIN JSON_TABLE(JSON_EXTRACT(i.data, '$.so_numbers'), '$[*]'
                                              COLUMNS (so_number VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$')) j
                                      WHERE i.record_type = 'sales_invoice' AND i.missing = 0
                                        AND NOT COALESCE(JSON_EXTRACT(i.data, '$.dp') = TRUE, FALSE)
                                      GROUP BY i.entity_id, j.so_number) il
                            ON il.entity_id = a.entity_id AND il.so_number = a.number
                         WHERE a.record_type = 'sales_order' AND a.missing = 0) z
                  LEFT JOIN (SELECT d.entity_id, d.id AS department_id,
                                    (SELECT IF(SUM(b.status = 'pending') > 0,
                                               DATE(MAX(CASE WHEN b.status = 'applied' THEN b.created_at END) + INTERVAL 7 HOUR),
                                               (SELECT DATE(r.started_at + INTERVAL 7 HOUR) FROM sales_sync_runs r
                                                 WHERE r.entity_id = d.entity_id AND r.source = 'accurate' AND r.status IN ('success', 'skipped')
                                                   AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.stats, '$.scope')), 'sales') = 'sales'
                                                 ORDER BY r.started_at DESC LIMIT 1))
                                       FROM sales_accurate_batches b
                                      WHERE b.entity_id = d.entity_id AND b.department_id = d.id AND b.status IN ('pending', 'applied')) AS data_through
                               FROM departments d
                              WHERE d.deleted_at IS NULL AND d.code IN ('sales', 'retail_commerce')) dt
                    ON dt.entity_id = z.entity_id AND dt.department_id = z.sales_department_id) p) y;

CREATE OR REPLACE VIEW wh_so_open_lines_accurate AS
SELECT y.so_id, y.entity_id, y.number, y.customer_name, y.ship_date, y.line_no, y.item_no, y.item_name, y.qty, y.unit, y.unit_ratio,
       y.shipped_base / y.ratio AS shipped_qty,
       y.remaining_base / y.ratio AS remaining_qty,
       y.remaining_base, y.warehouse, y.trans_date
  FROM (SELECT r.accurate_id AS so_id, r.entity_id, r.number, r.customer_name, r.trans_date,
               JSON_VALUE(r.data, '$.ship_date' RETURNING DATE) AS ship_date,
               l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio,
               COALESCE(NULLIF(l.unit_ratio, 0), 1) AS ratio,
               COALESCE(l.shipped_qty, 0) AS shipped_base,
               IF(l.closed, 0, GREATEST(l.qty * COALESCE(NULLIF(l.unit_ratio, 0), 1) - COALESCE(l.shipped_qty, 0), 0)) AS remaining_base,
               l.warehouse
          FROM accurate_records r
          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                 WHERE record_type = 'wh_so_open' GROUP BY entity_id, accurate_id) m
            ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
          JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
                 line_no FOR ORDINALITY,
                 item_no VARCHAR(80) COLLATE utf8mb4_unicode_ci PATH '$.item_no',
                 item_name VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$.item_name',
                 qty DECIMAL(18,4) PATH '$.qty',
                 unit VARCHAR(40) COLLATE utf8mb4_unicode_ci PATH '$.unit',
                 unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
                 shipped_qty DECIMAL(18,4) PATH '$.shipped_qty',
                 warehouse VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$.warehouse',
                 closed BOOLEAN PATH '$.closed')) l
         WHERE r.record_type = 'wh_so_open' AND r.missing = 0) y;
