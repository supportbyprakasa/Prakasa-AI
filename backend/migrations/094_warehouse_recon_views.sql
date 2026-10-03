-- ============================================================
-- Migration 094 — Warehouse 3.2: pencocokan Barang Masuk/Keluar ↔ dokumen Accurate (views)
--
-- The app's own movements (warehouse_inbound / warehouse_outbound, Supervisor-
-- approved) are compared with approved Accurate warehouse documents
-- (penerimaan, surat jalan, pindah gudang, penyesuaian) — quantities only, in
-- BASE units, never a price. Views only: nothing is copied, changed or removed
-- ("TEGAS"); Accurate is only read. JSON_TABLE reads base tables (a view column
-- cannot feed it, see 071). Idempotent (CREATE OR REPLACE). Needs MySQL >= 8.0
-- (REGEXP_REPLACE, window functions, JSON_TABLE column COLLATE), not MariaDB.
--
-- Rules (program 3.2; decided 30 Sep 2026 as Head Warehouse / Inventory Controller):
--   * scope: approved movements dated from 2026-09-22 (the Accurate database
--     starts that day) and within the last 180 days — reconciliation runs on
--     the monthly cycle, anything older is settled by stock opname, and the
--     window keeps every query at its 6-month cost (measured: < 0.6 s) however
--     long the history grows; cancelled/rejected ones did not happen.
--   * key: the movement's reference number, upper-cased with every character
--     other than A–Z/0–9 removed ("DO18/HRC-PFN/IX/2026" = "do18 hrc pfn ix 2026"),
--     and only when that leaves at least 4 characters with a digit ('N/A', '0',
--     '001', 'manual' are no key: such a movement stays its own group "m-<id>").
--     It matches an Accurate document by (1) the document number, (2) the
--     supplier's surat jalan number (receipts), (3) a PO/SO number on a line.
--     Keys 2–3 obey the same 4-character/digit rule and count only within 14
--     days of the movements' dates. Same direction only (receipt/transfer-in/
--     adjustment-in = Barang Masuk; delivery/transfer-out/adjustment-out = Barang Keluar).
--   * a group = every approved movement sharing a key; each Accurate document
--     joins at most one group per direction: a manual link first, else the best
--     key (lowest priority, then lowest key).
--   * compared per item (SKU = Accurate item number, case-insensitive) in base
--     units: qty × ratio (the Accurate line's own ratio; for an app line the
--     approved "Satuan barang", else the ratio Accurate documents used for that
--     item and unit — ambiguous ratios are not guessed).
--   * status: app_only (no Accurate document), uncomparable (a line without item
--     code — a Warehouse data-entry gap, escalated with qty_diff — or a unit with
--     no known ratio), qty_diff (an item differs by 0.001 base unit or more),
--     matched; plus acc_only for Accurate receipts and deliveries dated from the
--     day the Warehouse first APPROVED a movement that way, that no group took.
--     An explanation (warehouse_recon_notes) applies while the group still has
--     the signature it was given for.
--   * "since" (grace and escalation age) counts from the movement dates, the
--     approval day and the day each Accurate document FIRST reached the mirror
--     (a routine status edit in Accurate does not restart the clock).
-- Performance: keys are typed CHAR (REGEXP_REPLACE returns LONGTEXT, which a
-- materialised derived table cannot index), groups and Accurate keys meet on
-- one composite match_key, and Accurate lines join by record_type so the
-- mirror's unique key is used. The signature is aggregated with COUNT/SUM/
-- BIT_XOR of CRC32, never GROUP_CONCAT (cut at group_concat_max_len); the
-- GROUP_CONCAT lists are for display only and capped (10 movement ids,
-- 5 document numbers; movement_count/doc_count carry the totals).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_recon_movements_app AS
SELECT y.direction, y.movement_id, y.entity_id, y.department_id, y.movement_date, y.status, y.reference_no, y.party,
       CAST(y.ref_key AS CHAR(80) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS ref_key,
       CAST(COALESCE(y.ref_key, CONCAT('m-', y.movement_id)) AS CHAR(90) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS group_key,
       CAST(CONCAT(y.entity_id, '|', y.direction, '|', y.ref_key) AS CHAR(160) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS match_key,
       y.created_by, y.submitted_by, y.approved_at, y.approved_day, y.in_scope
  FROM (SELECT x.*, IF(CHAR_LENGTH(x.norm) >= 4 AND REGEXP_LIKE(x.norm, '[0-9]'), x.norm, NULL) AS ref_key
          FROM (SELECT 'inbound' COLLATE utf8mb4_unicode_ci AS direction, m.id AS movement_id, m.entity_id, m.department_id,
                       m.inbound_date AS movement_date, m.status COLLATE utf8mb4_unicode_ci AS status,
                       m.reference_no COLLATE utf8mb4_unicode_ci AS reference_no, m.supplier COLLATE utf8mb4_unicode_ci AS party,
                       REGEXP_REPLACE(UPPER(m.reference_no COLLATE utf8mb4_unicode_ci), '[^A-Z0-9]', '') AS norm,
                       m.created_by, m.submitted_by, m.approved_at,
                       DATE(m.approved_at + INTERVAL 7 HOUR) AS approved_day,
                       (m.status = 'approved' AND m.inbound_date >= GREATEST(CAST('2026-09-22' AS DATE), DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 180 DAY)) AS in_scope
                  FROM warehouse_inbound m
                UNION ALL
                SELECT 'outbound' COLLATE utf8mb4_unicode_ci, m.id, m.entity_id, m.department_id,
                       m.outbound_date, m.status COLLATE utf8mb4_unicode_ci,
                       m.reference_no COLLATE utf8mb4_unicode_ci, m.destination COLLATE utf8mb4_unicode_ci,
                       REGEXP_REPLACE(UPPER(m.reference_no COLLATE utf8mb4_unicode_ci), '[^A-Z0-9]', ''),
                       m.created_by, m.submitted_by, m.approved_at,
                       DATE(m.approved_at + INTERVAL 7 HOUR),
                       (m.status = 'approved' AND m.outbound_date >= GREATEST(CAST('2026-09-22' AS DATE), DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 180 DAY))
                  FROM warehouse_outbound m) x) y;

CREATE OR REPLACE VIEW wh_recon_doc_lines_accurate AS
SELECT r.entity_id, r.record_type, r.accurate_id AS doc_id,
       (CASE r.record_type WHEN 'wh_delivery' THEN 'delivery' WHEN 'wh_receipt' THEN 'receipt'
            WHEN 'wh_transfer' THEN 'transfer' ELSE 'adjustment' END) COLLATE utf8mb4_unicode_ci AS doc_type,
       r.number, r.trans_date,
       (CASE r.record_type
          WHEN 'wh_receipt' THEN 'inbound'
          WHEN 'wh_delivery' THEN 'outbound'
          WHEN 'wh_transfer' THEN IF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.transfer_type')) = 'TRANSFER_IN', 'inbound', 'outbound')
          ELSE IF(l.direction = 'out', 'outbound', 'inbound') END) COLLATE utf8mb4_unicode_ci AS direction,
       CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.supplier_do')), 'null') AS CHAR(120) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS supplier_do,
       l.line_no, l.item_no, l.item_name, l.qty, l.unit,
       NULLIF(UPPER(TRIM(l.item_no)), '') AS item_key,
       IF(l.unit_ratio > 0, l.unit_ratio, NULL) AS line_ratio,
       COALESCE(IF(l.unit_ratio > 0, l.unit_ratio, NULL), u.ratio) AS unit_ratio,
       l.qty * COALESCE(IF(l.unit_ratio > 0, l.unit_ratio, NULL), u.ratio) AS qty_base,
       COALESCE(l.so_number, l.po_number) AS line_ref
  FROM accurate_records r
  JOIN (SELECT entity_id, record_type, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type IN ('wh_delivery', 'wh_receipt', 'wh_transfer', 'wh_adjustment')
         GROUP BY entity_id, record_type, accurate_id) mv
    ON mv.entity_id = r.entity_id AND mv.record_type = r.record_type AND mv.accurate_id = r.accurate_id AND mv.v = r.version
  JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
         line_no FOR ORDINALITY,
         item_no VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.item_no',
         item_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.item_name',
         qty DECIMAL(18,4) PATH '$.qty',
         unit VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.unit',
         unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
         direction VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.direction',
         so_number VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.so_number',
         po_number VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.po_number')) l
  LEFT JOIN (SELECT entity_id, item_no, unit_name, IF(MIN(ratio) = MAX(ratio), MIN(ratio), NULL) AS ratio
               FROM item_units_accurate GROUP BY entity_id, item_no, unit_name) u
    ON u.entity_id = r.entity_id AND u.item_no = l.item_no AND u.unit_name = l.unit
 WHERE r.record_type IN ('wh_delivery', 'wh_receipt', 'wh_transfer', 'wh_adjustment') AND r.missing = 0
   -- The 180-day window, plus the 14 days a supplier SJ / PO / SO key may lie before a movement.
   AND r.trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 194 DAY;

CREATE OR REPLACE VIEW wh_recon_unit_ratios AS
SELECT x.entity_id, x.item_no, x.unit_name,
       IF(SUM(x.from_master) > 0,
          IF(MIN(IF(x.from_master = 1, x.ratio, NULL)) = MAX(IF(x.from_master = 1, x.ratio, NULL)), MAX(IF(x.from_master = 1, x.ratio, NULL)), NULL),
          IF(MIN(x.ratio) = MAX(x.ratio), MAX(x.ratio), NULL)) AS ratio,
       MAX(x.from_master) AS from_master
  FROM (SELECT entity_id, CAST(item_no AS CHAR(120) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS item_no,
               CAST(unit_name AS CHAR(40) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS unit_name, ratio, 1 AS from_master
          FROM item_units_accurate WHERE ratio > 0
        UNION ALL
        SELECT entity_id, item_no, unit, line_ratio, 0 FROM wh_recon_doc_lines_accurate
         WHERE line_ratio IS NOT NULL AND item_no IS NOT NULL AND unit IS NOT NULL) x
 GROUP BY x.entity_id, x.item_no, x.unit_name;

CREATE OR REPLACE VIEW wh_recon_app_lines AS
SELECT h.direction, h.movement_id, h.entity_id, h.department_id, h.movement_date, h.status, h.group_key, h.in_scope,
       l.line_no, l.sku, l.product, l.qty, l.unit,
       NULLIF(UPPER(TRIM(l.sku)), '') AS item_key,
       u.ratio AS unit_ratio, l.qty * u.ratio AS qty_base
  FROM warehouse_inbound m
  JOIN JSON_TABLE(m.items, '$[*]' COLUMNS (
         line_no FOR ORDINALITY,
         sku VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.sku',
         product VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.product',
         qty DECIMAL(18,4) PATH '$.quantity',
         unit VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.unit')) l
  JOIN wh_recon_movements_app h ON h.direction = 'inbound' AND h.movement_id = m.id
  LEFT JOIN wh_recon_unit_ratios u ON u.entity_id = m.entity_id AND u.item_no = TRIM(l.sku) AND u.unit_name = TRIM(l.unit)
UNION ALL
SELECT h.direction, h.movement_id, h.entity_id, h.department_id, h.movement_date, h.status, h.group_key, h.in_scope,
       l.line_no, l.sku, l.product, l.qty, l.unit,
       NULLIF(UPPER(TRIM(l.sku)), ''),
       u.ratio, l.qty * u.ratio
  FROM warehouse_outbound m
  JOIN JSON_TABLE(m.items, '$[*]' COLUMNS (
         line_no FOR ORDINALITY,
         sku VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.sku',
         product VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.product',
         qty DECIMAL(18,4) PATH '$.quantity',
         unit VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$.unit')) l
  JOIN wh_recon_movements_app h ON h.direction = 'outbound' AND h.movement_id = m.id
  LEFT JOIN wh_recon_unit_ratios u ON u.entity_id = m.entity_id AND u.item_no = TRIM(l.sku) AND u.unit_name = TRIM(l.unit);

CREATE OR REPLACE VIEW wh_recon_doc_keys_accurate AS
SELECT DISTINCT k.entity_id, k.record_type, k.doc_type, k.doc_id, k.number, k.trans_date, k.direction, k.priority,
       CAST(k.ref_key AS CHAR(120) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS ref_key,
       CAST(CONCAT(k.entity_id, '|', k.direction, '|', k.ref_key) AS CHAR(160) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS match_key
  FROM (SELECT l.entity_id, l.record_type, l.doc_type, l.doc_id, l.number, l.trans_date, l.direction, p.priority,
               NULLIF(REGEXP_REPLACE(UPPER(CASE p.priority WHEN 1 THEN l.number WHEN 2 THEN l.supplier_do ELSE l.line_ref END),
                                     '[^A-Z0-9]', ''), '') AS ref_key
          FROM wh_recon_doc_lines_accurate l
          JOIN (SELECT 1 AS priority UNION ALL SELECT 2 UNION ALL SELECT 3) p) k
 WHERE k.ref_key IS NOT NULL
   AND (k.priority = 1 OR (CHAR_LENGTH(k.ref_key) >= 4 AND REGEXP_LIKE(k.ref_key, '[0-9]')));

CREATE OR REPLACE VIEW wh_recon_assign AS
SELECT a.entity_id, a.doc_type, a.doc_id, a.direction, a.group_key, a.match_kind
  FROM (SELECT c.entity_id, c.doc_type, c.doc_id, c.direction, c.group_key, c.match_kind,
               ROW_NUMBER() OVER (PARTITION BY c.entity_id, c.doc_type, c.doc_id, c.direction
                                  ORDER BY c.priority, c.group_key) AS rn
          FROM (SELECT k.entity_id, k.doc_type, k.doc_id, h.direction, h.group_key, 0 AS priority,
                       'manual' COLLATE utf8mb4_unicode_ci AS match_kind
                  FROM warehouse_recon_links k
                  JOIN wh_recon_movements_app h
                    ON h.entity_id = k.entity_id AND h.direction = k.movement_type AND h.movement_id = k.movement_id AND h.in_scope = 1
                 WHERE k.cancelled_at IS NULL
                   AND EXISTS (SELECT 1 FROM wh_recon_doc_keys_accurate d
                                WHERE d.entity_id = k.entity_id AND d.doc_type = k.doc_type AND d.doc_id = k.doc_id
                                  AND d.direction = h.direction AND d.priority = 1)
                UNION ALL
                SELECT d.entity_id, d.doc_type, d.doc_id, d.direction, g.group_key, d.priority,
                       ELT(d.priority, 'number', 'supplier_do', 'reference') COLLATE utf8mb4_unicode_ci
                  FROM wh_recon_doc_keys_accurate d
                  JOIN (SELECT group_key,
                               CAST(CONCAT(entity_id, '|', direction, '|', group_key) AS CHAR(160) CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS match_key,
                               MIN(movement_date) AS first_date, MAX(movement_date) AS last_date
                          FROM wh_recon_movements_app WHERE in_scope = 1 AND ref_key IS NOT NULL
                         GROUP BY entity_id, direction, group_key) g
                    ON g.match_key = d.match_key
                 WHERE d.priority = 1
                    OR d.trans_date BETWEEN g.first_date - INTERVAL 14 DAY AND g.last_date + INTERVAL 14 DAY) c) a
 WHERE a.rn = 1;

CREATE OR REPLACE VIEW wh_recon_items AS
SELECT t.entity_id, t.direction, t.group_key, t.item_key,
       COALESCE(MAX(IF(t.side = 'acc', t.item_name, NULL)), MAX(t.item_name)) AS item_name,
       SUM(IF(t.side = 'app', t.qty_base, 0)) AS app_qty_base,
       SUM(IF(t.side = 'acc', t.qty_base, 0)) AS acc_qty_base,
       SUM(t.side = 'app') AS app_lines,
       SUM(t.side = 'acc') AS acc_lines,
       SUM(t.qty_base IS NULL) AS unknown_lines
  FROM (SELECT a.entity_id, a.direction, a.group_key, 'app' AS side, a.item_key, a.product AS item_name, a.qty_base
          FROM wh_recon_app_lines a WHERE a.in_scope = 1
        UNION ALL
        SELECT l.entity_id, l.direction, s.group_key, 'acc', l.item_key, l.item_name, l.qty_base
          FROM wh_recon_assign s
          JOIN wh_recon_doc_lines_accurate l
            ON l.entity_id = s.entity_id AND l.record_type = CONCAT('wh_', s.doc_type) AND l.doc_id = s.doc_id AND l.direction = s.direction) t
 GROUP BY t.entity_id, t.direction, t.group_key, t.item_key;

CREATE OR REPLACE VIEW wh_recon_groups AS
SELECT z.entity_id, z.department_id, z.direction, z.group_key, z.status, z.reference_no, z.party,
       z.movement_count, z.movement_ids, z.first_movement_id, z.first_date, z.last_date,
       z.doc_count, z.doc_numbers, z.match_kinds, z.first_doc_id,
       z.item_count, z.diff_items, z.unknown_lines, z.missing_item_lines, z.pending_movements, z.since, z.signature,
       (n.id IS NOT NULL) AS explained, n.id AS note_id, n.reason AS note_reason, n.created_by AS note_by, n.created_at AS note_at,
       (dr.entity_id IS NOT NULL) AS docs_ready
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
                  FROM (SELECT h.entity_id, MIN(h.department_id) AS department_id, h.direction, h.group_key,
                               MIN(h.reference_no) AS reference_no, MIN(h.party) AS party, COUNT(*) AS movement_count,
                               SUBSTRING_INDEX(GROUP_CONCAT(h.movement_id ORDER BY h.movement_id), ',', 10) AS movement_ids,
                               CONCAT(COUNT(*), ':', SUM(h.movement_id), ':', BIT_XOR(CRC32(h.movement_id))) AS movement_sig,
                               MIN(h.movement_id) AS first_movement_id,
                               MIN(h.movement_date) AS first_date, MAX(h.movement_date) AS last_date, MAX(h.approved_day) AS last_approved_day
                          FROM wh_recon_movements_app h WHERE h.in_scope = 1
                         GROUP BY h.entity_id, h.direction, h.group_key) g
                  LEFT JOIN (SELECT s.entity_id, s.direction, s.group_key, COUNT(*) AS doc_count, MIN(s.doc_id) AS first_doc_id,
                                    CONCAT(COUNT(*), ':', SUM(CRC32(CONCAT(s.doc_type, ':', s.doc_id))), ':',
                                           BIT_XOR(CRC32(CONCAT(s.doc_type, ':', s.doc_id)))) AS doc_sig,
                                    SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT d.number ORDER BY d.number SEPARATOR ', '), ', ', 5) AS doc_numbers,
                                    GROUP_CONCAT(DISTINCT s.match_kind ORDER BY s.match_kind) AS match_kinds,
                                    MAX(GREATEST(d.trans_date,
                                                 COALESCE((SELECT DATE(MIN(v.created_at) + INTERVAL 7 HOUR) FROM accurate_records v
                                                            WHERE v.entity_id = d.entity_id AND v.record_type = CONCAT('wh_', d.doc_type)
                                                              AND v.accurate_id = d.id), d.trans_date))) AS last_doc_day
                               FROM wh_recon_assign s
                               JOIN wh_documents_accurate d ON d.entity_id = s.entity_id AND d.doc_type = s.doc_type AND d.id = s.doc_id
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
                               FROM wh_recon_items i
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
                          FROM wh_recon_movements_app WHERE in_scope = 1 GROUP BY entity_id, direction) st
                    ON st.entity_id = d.entity_id AND st.direction = IF(d.doc_type = 'receipt', 'inbound', 'outbound')
                  LEFT JOIN wh_recon_assign s ON s.entity_id = d.entity_id AND s.doc_type = d.doc_type AND s.doc_id = d.id
                  LEFT JOIN (SELECT k.entity_id, k.doc_type, k.doc_id, COUNT(DISTINCT h.movement_id) AS n
                               FROM wh_recon_doc_keys_accurate k
                               JOIN wh_recon_movements_app h ON h.match_key = k.match_key
                              WHERE h.status IN ('draft', 'pending_approval', 'revision_requested')
                                AND (k.priority = 1 OR k.trans_date BETWEEN h.movement_date - INTERVAL 14 DAY AND h.movement_date + INTERVAL 14 DAY)
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
    ON dr.entity_id = z.entity_id;
