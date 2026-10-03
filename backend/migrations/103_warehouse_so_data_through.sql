-- ============================================================
-- Migration 103 — Warehouse 3.4 / Management 3.3: `data_through` counts only
-- the Sales pulls whose data reached the mirror
--
--   wh_so_fulfilment_accurate   as in 099, except which Sales pull sets
--                               `data_through` once no batch of the SO's
--                               division waits for approval
--
-- 099 took the day of the last Sales pull that ran (success or skipped). A pull
-- that SKIPPED the division (its previous batch still waiting: the run's
-- stats.skipped names the division) brought none of that division's data, and
-- neither did a pull whose batch for the division was then rejected or
-- withdrawn. Counting such a pull put `data_through` past what the mirror
-- holds, so right after an approval SOs and surat jalan were judged against
-- data that was not in the mirror yet (applying Sales batch #9 while Retail
-- Commerce #12 waited moved Sales from 29 to 30 Sep 2026, through run 117,
-- which skipped Sales, like 91 pulls before it). Now: the last Sales pull that
-- neither skipped the division nor had its batch for it rejected or withdrawn.
-- A pull that found nothing new for the division still counts (the mirror was
-- complete), and so does one whose batch was applied.
-- While a batch of the division waits, `data_through` is unchanged: the day of
-- the last approved pull.
--
-- Everything else is 099 verbatim: the promise (warehouseRules.promisedSql),
-- the OTIF states, `judged` and the columns. Its readers take the fix as they
-- are: warehouse_so_late, the metric warehouse_so_otif and the KPI
-- warehouse_so_otif_month (providers/warehouse.js), and flowRules.notBilledSql
-- through mg_sales_flow_accurate (100), which reads w.data_through from this
-- view. wh_so_open_lines_accurate (099) has no `data_through` and stays as it
-- is. 099 itself is not edited (applied, its checksum recorded): where its
-- header says "the day of the last Sales pull that ran", this rule applies.
--
-- View only over the insert-only mirror and the pull log; nothing copied,
-- changed or removed. Idempotent (CREATE OR REPLACE).
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
                                                   AND NOT JSON_CONTAINS(COALESCE(JSON_EXTRACT(r.stats, '$.skipped[*].departmentId'), JSON_ARRAY()), CAST(d.id AS JSON))
                                                   AND NOT EXISTS (SELECT 1 FROM sales_accurate_batches x
                                                                    WHERE x.sync_run_id = r.id AND x.department_id = d.id AND x.status IN ('rejected', 'withdrawn'))
                                                 ORDER BY r.started_at DESC LIMIT 1))
                                       FROM sales_accurate_batches b
                                      WHERE b.entity_id = d.entity_id AND b.department_id = d.id AND b.status IN ('pending', 'applied')) AS data_through
                               FROM departments d
                              WHERE d.deleted_at IS NULL AND d.code IN ('sales', 'retail_commerce')) dt
                    ON dt.entity_id = z.entity_id AND dt.department_id = z.sales_department_id) p) y;
