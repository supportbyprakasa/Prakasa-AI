-- ============================================================
-- Migration 104 — Warehouse 3.2: pencocokan gudang waits for a complete mirror
--                 (`data_through`, `judged`), and wh_recon_groups is computed once
--
--   wh_recon_groups   as in 094, plus two columns:
--     data_through    the WIB day the company's Warehouse mirror is known to be
--                     complete. While a Warehouse batch waits for approval: the
--                     day the last APPLIED Warehouse batch was pulled (its
--                     created_at). Otherwise: the day of the last Warehouse pull
--                     (sales_sync_runs, stats.scope 'warehouse', success or
--                     skipped) that neither skipped the Warehouse division nor
--                     had its batch for it rejected or withdrawn — the same rule
--                     103 applies to the Sales divisions. A Mac asleep or a
--                     failed pull leaves it at the last pull that ran. NULL = no
--                     pull recorded yet.
--     judged          status = 'acc_only' OR data_through IS NULL
--                     OR since + RECON_GRACE_DAYS <= data_through.
--                     An approved movement with no Accurate document, or with a
--                     different quantity, can only be called a difference once
--                     the mirror covers the grace days after it: the document
--                     may be in a batch nobody has approved yet (batch #10
--                     waited from 29 Sep 2026; a rolled-back check escalated
--                     "belum ada dokumen Accurate yang cocok" for a receipt that
--                     sat in it). `<=` keeps today's timing when the mirror is
--                     fresh (data_through = today: judged exactly when due,
--                     since <= today − RECON_GRACE_DAYS) and holds a group only
--                     while the mirror lags. An Accurate document the Warehouse
--                     never recorded (acc_only) is in the mirror already: always
--                     judged. The escalations, the KPI warehouse_recon_open and
--                     the metric warehouse_recon_match_rate count judged groups
--                     only; the tab shows the others as "Menunggu data Accurate".
--
-- The same groups, computed once: 094's wh_recon_groups read wh_recon_assign
-- three times (document counts, per-item totals, the acc_only anti-join) and
-- every read re-ran the JSON_TABLE expansion of the Accurate lines and the key
-- extraction. Here each step is a common table expression that MySQL
-- materialises once and shares: h (the movements), dl (the Accurate lines),
-- dk (their keys), asg (which group each document joins), ur (unit ratios),
-- ii (per-item totals). DISTINCT on h and dl changes nothing (a movement is
-- unique by direction and id, a line by document and line number); it keeps
-- MySQL from merging them into each reference, so they are read once too. The
-- CTEs restate 094's rules word for word (keys, the 14-day window, manual link
-- first then the best key, base units, the signature); 094's helper views stay
-- as they are for the group detail, the candidates and the pairing. Checked on
-- the real mirror and on a synthetic year (1,843 groups): the same groups,
-- statuses, counts and signatures as 094, so no explanation lapses.
--
-- View only over the mirror, the app's movements and the pull log; nothing
-- copied, changed or removed; Accurate is only read. 094 is not edited (applied,
-- its checksum recorded). Idempotent (CREATE OR REPLACE). MySQL >= 8.0.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_recon_groups AS
WITH h AS (SELECT DISTINCT * FROM wh_recon_movements_app),
dl AS (SELECT DISTINCT * FROM wh_recon_doc_lines_accurate),
-- Keys as wh_recon_doc_keys_accurate: 1 = document number, 2 = supplier SJ, 3 = PO/SO on a line.
dk AS (SELECT DISTINCT k.entity_id, k.record_type, k.doc_type, k.doc_id, k.number, k.trans_date, k.direction, k.priority,
              CAST(k.ref_key AS CHAR(120) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS ref_key,
              CAST(CONCAT(k.entity_id, '|', k.direction, '|', k.ref_key) AS CHAR(160) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS match_key
         FROM (SELECT l.entity_id, l.record_type, l.doc_type, l.doc_id, l.number, l.trans_date, l.direction, p.priority,
                      NULLIF(REGEXP_REPLACE(UPPER(CASE p.priority WHEN 1 THEN l.number WHEN 2 THEN l.supplier_do ELSE l.line_ref END),
                                            '[^A-Z0-9]', ''), '') AS ref_key
                 FROM dl l
                 JOIN (SELECT 1 AS priority UNION ALL SELECT 2 UNION ALL SELECT 3) p) k
        WHERE k.ref_key IS NOT NULL
          AND (k.priority = 1 OR (CHAR_LENGTH(k.ref_key) >= 4 AND REGEXP_LIKE(k.ref_key, '[0-9]')))),
-- As wh_recon_assign: one group per document and direction, a manual link first, else the best key.
asg AS (SELECT a.entity_id, a.doc_type, a.doc_id, a.direction, a.group_key, a.match_kind
          FROM (SELECT c.entity_id, c.doc_type, c.doc_id, c.direction, c.group_key, c.match_kind,
                       ROW_NUMBER() OVER (PARTITION BY c.entity_id, c.doc_type, c.doc_id, c.direction
                                          ORDER BY c.priority, c.group_key) AS rn
                  FROM (SELECT k.entity_id, k.doc_type, k.doc_id, x.direction, x.group_key, 0 AS priority,
                               'manual' COLLATE utf8mb4_unicode_ci AS match_kind
                          FROM warehouse_recon_links k
                          JOIN h x ON x.entity_id = k.entity_id AND x.direction = k.movement_type AND x.movement_id = k.movement_id AND x.in_scope = 1
                         WHERE k.cancelled_at IS NULL
                           AND EXISTS (SELECT 1 FROM dk d
                                        WHERE d.entity_id = k.entity_id AND d.doc_type = k.doc_type AND d.doc_id = k.doc_id
                                          AND d.direction = x.direction AND d.priority = 1)
                        UNION ALL
                        SELECT d.entity_id, d.doc_type, d.doc_id, d.direction, g.group_key, d.priority,
                               ELT(d.priority, 'number', 'supplier_do', 'reference') COLLATE utf8mb4_unicode_ci
                          FROM dk d
                          JOIN (SELECT group_key,
                                       CAST(CONCAT(entity_id, '|', direction, '|', group_key) AS CHAR(160) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS match_key,
                                       MIN(movement_date) AS first_date, MAX(movement_date) AS last_date
                                  FROM h WHERE in_scope = 1 AND ref_key IS NOT NULL
                                 GROUP BY entity_id, direction, group_key) g
                            ON g.match_key = d.match_key
                         WHERE d.priority = 1
                            OR d.trans_date BETWEEN g.first_date - INTERVAL 14 DAY AND g.last_date + INTERVAL 14 DAY) c) a
         WHERE a.rn = 1),
-- As wh_recon_unit_ratios: Accurate's own unit master first, else the ratio its documents used.
ur AS (SELECT x.entity_id, x.item_no, x.unit_name,
              IF(SUM(x.from_master) > 0,
                 IF(MIN(IF(x.from_master = 1, x.ratio, NULL)) = MAX(IF(x.from_master = 1, x.ratio, NULL)), MAX(IF(x.from_master = 1, x.ratio, NULL)), NULL),
                 IF(MIN(x.ratio) = MAX(x.ratio), MAX(x.ratio), NULL)) AS ratio
         FROM (SELECT entity_id, CAST(item_no AS CHAR(120) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS item_no,
                      CAST(unit_name AS CHAR(40) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS unit_name, ratio, 1 AS from_master
                 FROM item_units_accurate WHERE ratio > 0
               UNION ALL
               SELECT entity_id, item_no, unit, line_ratio, 0 FROM dl
                WHERE line_ratio IS NOT NULL AND item_no IS NOT NULL AND unit IS NOT NULL) x
        GROUP BY x.entity_id, x.item_no, x.unit_name),
-- As wh_recon_items (without the item name): the app's lines in scope against the assigned documents' lines.
ii AS (SELECT t.entity_id, t.direction, t.group_key, t.item_key,
              SUM(IF(t.side = 'app', t.qty_base, 0)) AS app_qty_base,
              SUM(IF(t.side = 'acc', t.qty_base, 0)) AS acc_qty_base,
              SUM(t.side = 'app') AS app_lines,
              SUM(t.side = 'acc') AS acc_lines,
              SUM(t.qty_base IS NULL) AS unknown_lines
         FROM (SELECT x.entity_id, x.direction, x.group_key, 'app' AS side, NULLIF(UPPER(TRIM(l.sku)), '') AS item_key, l.qty * u.ratio AS qty_base
                 FROM warehouse_inbound m
                 JOIN JSON_TABLE(m.items, '$[*]' COLUMNS (
                        sku VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.sku',
                        qty DECIMAL(18,4) PATH '$.quantity',
                        unit VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.unit')) l
                 JOIN h x ON x.direction = 'inbound' AND x.movement_id = m.id AND x.in_scope = 1
                 LEFT JOIN ur u ON u.entity_id = m.entity_id AND u.item_no = TRIM(l.sku) AND u.unit_name = TRIM(l.unit)
               UNION ALL
               SELECT x.entity_id, x.direction, x.group_key, 'app', NULLIF(UPPER(TRIM(l.sku)), ''), l.qty * u.ratio
                 FROM warehouse_outbound m
                 JOIN JSON_TABLE(m.items, '$[*]' COLUMNS (
                        sku VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.sku',
                        qty DECIMAL(18,4) PATH '$.quantity',
                        unit VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.unit')) l
                 JOIN h x ON x.direction = 'outbound' AND x.movement_id = m.id AND x.in_scope = 1
                 LEFT JOIN ur u ON u.entity_id = m.entity_id AND u.item_no = TRIM(l.sku) AND u.unit_name = TRIM(l.unit)
               UNION ALL
               SELECT l.entity_id, l.direction, s.group_key, 'acc', l.item_key, l.qty_base
                 FROM asg s
                 JOIN dl l ON l.entity_id = s.entity_id AND l.record_type = CONCAT('wh_', s.doc_type) AND l.doc_id = s.doc_id AND l.direction = s.direction) t
        GROUP BY t.entity_id, t.direction, t.group_key, t.item_key)
SELECT z.entity_id, z.department_id, z.direction, z.group_key, z.status, z.reference_no, z.party,
       z.movement_count, z.movement_ids, z.first_movement_id, z.first_date, z.last_date,
       z.doc_count, z.doc_numbers, z.match_kinds, z.first_doc_id,
       z.item_count, z.diff_items, z.unknown_lines, z.missing_item_lines, z.pending_movements, z.since, z.signature,
       (n.id IS NOT NULL) AS explained, n.id AS note_id, n.reason AS note_reason, n.created_by AS note_by, n.created_at AS note_at,
       (dr.entity_id IS NOT NULL) AS docs_ready,
       dt.data_through,
       -- 2 = RECON_GRACE_DAYS (warehouseReconModel.js).
       (z.status = 'acc_only' OR dt.data_through IS NULL OR z.since + INTERVAL 2 DAY <= dt.data_through) AS judged
  FROM (SELECT y.*, SHA2(CONCAT_WS('|', y.status, COALESCE(y.movement_sig, '-'), COALESCE(y.doc_sig, '-'),
                                    COALESCE(y.item_sig, '-'), y.item_count, y.unknown_lines, y.missing_item_lines), 256) COLLATE utf8mb4_unicode_ci AS signature
          FROM (SELECT g.entity_id, g.department_id, g.direction, g.group_key,
                       (CASE WHEN dc.doc_count IS NULL THEN 'app_only'
                             WHEN COALESCE(it.missing_item_lines, 0) > 0 THEN 'uncomparable'
                             WHEN COALESCE(it.diff_items, 0) > 0 THEN 'qty_diff'
                             WHEN COALESCE(it.unknown_lines, 0) > 0 THEN 'uncomparable'
                             ELSE 'matched' END) COLLATE utf8mb4_unicode_ci AS status,
                       g.reference_no, g.party, g.movement_count, g.movement_ids, g.movement_sig, g.first_movement_id, g.first_date, g.last_date,
                       COALESCE(dc.doc_count, 0) AS doc_count, dc.doc_sig, dc.doc_numbers, dc.match_kinds, dc.first_doc_id,
                       COALESCE(it.item_count, 0) AS item_count, COALESCE(it.diff_items, 0) AS diff_items,
                       COALESCE(it.unknown_lines, 0) AS unknown_lines, COALESCE(it.missing_item_lines, 0) AS missing_item_lines,
                       it.item_sig, 0 AS pending_movements,
                       GREATEST(g.last_date, COALESCE(g.last_approved_day, g.last_date), COALESCE(dc.last_doc_day, g.last_date)) AS since
                  FROM (SELECT x.entity_id, MIN(x.department_id) AS department_id, x.direction, x.group_key,
                               MIN(x.reference_no) AS reference_no, MIN(x.party) AS party, COUNT(*) AS movement_count,
                               SUBSTRING_INDEX(GROUP_CONCAT(x.movement_id ORDER BY x.movement_id), ',', 10) AS movement_ids,
                               CONCAT(COUNT(*), ':', SUM(x.movement_id), ':', BIT_XOR(CRC32(x.movement_id))) AS movement_sig,
                               MIN(x.movement_id) AS first_movement_id,
                               MIN(x.movement_date) AS first_date, MAX(x.movement_date) AS last_date, MAX(x.approved_day) AS last_approved_day
                          FROM h x WHERE x.in_scope = 1
                         GROUP BY x.entity_id, x.direction, x.group_key) g
                  -- A document's number and date from its own lines (every assigned document has lines in dl).
                  LEFT JOIN (SELECT s.entity_id, s.direction, s.group_key, COUNT(*) AS doc_count, MIN(s.doc_id) AS first_doc_id,
                                    CONCAT(COUNT(*), ':', SUM(CRC32(CONCAT(s.doc_type, ':', s.doc_id))), ':',
                                           BIT_XOR(CRC32(CONCAT(s.doc_type, ':', s.doc_id)))) AS doc_sig,
                                    SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT d.number ORDER BY d.number SEPARATOR ', '), ', ', 5) AS doc_numbers,
                                    GROUP_CONCAT(DISTINCT s.match_kind ORDER BY s.match_kind) AS match_kinds,
                                    MAX(GREATEST(d.trans_date,
                                                 COALESCE((SELECT DATE(MIN(v.created_at) + INTERVAL 7 HOUR) FROM accurate_records v
                                                            WHERE v.entity_id = d.entity_id AND v.record_type = CONCAT('wh_', d.doc_type)
                                                              AND v.accurate_id = d.id), d.trans_date))) AS last_doc_day
                               FROM asg s
                               JOIN (SELECT DISTINCT entity_id, doc_type, doc_id AS id, number, trans_date FROM dl) d
                                 ON d.entity_id = s.entity_id AND d.doc_type = s.doc_type AND d.id = s.doc_id
                              GROUP BY s.entity_id, s.direction, s.group_key) dc
                    ON dc.entity_id = g.entity_id AND dc.direction = g.direction AND dc.group_key = g.group_key
                  LEFT JOIN (SELECT i.entity_id, i.direction, i.group_key, COUNT(*) AS item_count,
                                    SUM(i.item_key IS NOT NULL AND i.unknown_lines = 0
                                        AND ABS(COALESCE(i.app_qty_base, 0) - COALESCE(i.acc_qty_base, 0)) >= 0.001) AS diff_items,
                                    SUM(i.unknown_lines) AS unknown_lines,
                                    SUM(IF(i.item_key IS NULL, i.app_lines + i.acc_lines, 0)) AS missing_item_lines,
                                    CONCAT(COUNT(*), ':',
                                           SUM(CRC32(CONCAT_WS('=', COALESCE(i.item_key, '-'), COALESCE(ROUND(i.app_qty_base, 3), 'x'), COALESCE(ROUND(i.acc_qty_base, 3), 'x')))), ':',
                                           BIT_XOR(CRC32(CONCAT_WS('=', COALESCE(i.item_key, '-'), COALESCE(ROUND(i.app_qty_base, 3), 'x'), COALESCE(ROUND(i.acc_qty_base, 3), 'x'))))) AS item_sig
                               FROM ii i
                              GROUP BY i.entity_id, i.direction, i.group_key) it
                    ON it.entity_id = g.entity_id AND it.direction = g.direction AND it.group_key = g.group_key
                UNION ALL
                SELECT d.entity_id, d.department_id, st.direction, CONCAT(d.doc_type, '-', d.id) COLLATE utf8mb4_unicode_ci,
                       'acc_only' COLLATE utf8mb4_unicode_ci, NULL, d.party, 0, NULL, NULL, NULL, d.trans_date, d.trans_date,
                       1, CONCAT(1, ':', CRC32(CONCAT(d.doc_type, ':', d.id)), ':', CRC32(CONCAT(d.doc_type, ':', d.id))), d.number, NULL, d.id,
                       COALESCE(d.line_count, 0), 0, 0, 0, NULL, COALESCE(pm.n, 0),
                       GREATEST(d.trans_date,
                                COALESCE((SELECT DATE(MIN(v.created_at) + INTERVAL 7 HOUR) FROM accurate_records v
                                           WHERE v.entity_id = d.entity_id AND v.record_type = CONCAT('wh_', d.doc_type)
                                             AND v.accurate_id = d.id), d.trans_date))
                  FROM wh_documents_accurate d
                  JOIN (SELECT entity_id, direction, MIN(approved_day) AS start_date
                          FROM h WHERE in_scope = 1 GROUP BY entity_id, direction) st
                    ON st.entity_id = d.entity_id AND st.direction = IF(d.doc_type = 'receipt', 'inbound', 'outbound')
                  LEFT JOIN asg s ON s.entity_id = d.entity_id AND s.doc_type = d.doc_type AND s.doc_id = d.id
                  LEFT JOIN (SELECT k.entity_id, k.doc_type, k.doc_id, COUNT(DISTINCT x.movement_id) AS n
                               FROM dk k
                               JOIN h x ON x.match_key = k.match_key
                              WHERE x.status IN ('draft', 'pending_approval', 'revision_requested')
                                AND (k.priority = 1 OR k.trans_date BETWEEN x.movement_date - INTERVAL 14 DAY AND x.movement_date + INTERVAL 14 DAY)
                              GROUP BY k.entity_id, k.doc_type, k.doc_id) pm
                    ON pm.entity_id = d.entity_id AND pm.doc_type = d.doc_type AND pm.doc_id = d.id
                 WHERE d.doc_type IN ('receipt', 'delivery') AND s.doc_id IS NULL AND d.trans_date >= st.start_date
                   -- not at the window's edge, where its movement may lie just outside
                   AND d.trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 166 DAY) y) z
  LEFT JOIN warehouse_recon_notes n
    ON n.entity_id = z.entity_id AND n.cancelled_at IS NULL AND n.direction = z.direction AND n.group_key = z.group_key
   AND n.signature = z.signature AND z.status <> 'matched'
  -- Once per company, not per row: are there Warehouse documents in the mirror at all?
  LEFT JOIN (SELECT entity_id FROM accurate_records
              WHERE record_type IN ('wh_receipt', 'wh_delivery', 'wh_transfer', 'wh_adjustment')
              GROUP BY entity_id) dr
    ON dr.entity_id = z.entity_id
  -- Once per company: how far its Warehouse mirror is complete (header).
  LEFT JOIN (SELECT d.entity_id,
                    (SELECT IF(SUM(b.status = 'pending') > 0,
                               DATE(MAX(CASE WHEN b.status = 'applied' THEN b.created_at END) + INTERVAL 7 HOUR),
                               (SELECT DATE(r.started_at + INTERVAL 7 HOUR) FROM sales_sync_runs r
                                 WHERE r.entity_id = d.entity_id AND r.source = 'accurate' AND r.status IN ('success', 'skipped')
                                   AND JSON_UNQUOTE(JSON_EXTRACT(r.stats, '$.scope')) = 'warehouse'
                                   AND NOT JSON_CONTAINS(COALESCE(JSON_EXTRACT(r.stats, '$.skipped[*].departmentId'), JSON_ARRAY()), CAST(d.id AS JSON))
                                   AND NOT EXISTS (SELECT 1 FROM sales_accurate_batches x
                                                    WHERE x.sync_run_id = r.id AND x.department_id = d.id AND x.status IN ('rejected', 'withdrawn'))
                                 ORDER BY r.started_at DESC LIMIT 1))
                       FROM sales_accurate_batches b
                      WHERE b.entity_id = d.entity_id AND b.department_id = d.id AND b.status IN ('pending', 'applied')) AS data_through
               FROM departments d
              WHERE d.deleted_at IS NULL AND d.code = 'warehouse') dt
    ON dt.entity_id = z.entity_id;
