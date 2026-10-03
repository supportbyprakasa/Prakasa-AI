-- ============================================================
-- Migration 100 — Management 3.3: pesanan → kirim → faktur → lunas, and
-- PO → barang datang, from approved Accurate data (docs/program-4-divisi.md 3.3)
--
--   mg_so_links_accurate          every SO number named by an approved Sales
--                                 surat jalan (DO) or faktur (down payments left
--                                 out, as in revenue), one row per document × SO
--   mg_invoice_payments_accurate  per faktur number: first and last approved
--                                 penerimaan and the amount they paid
--   mg_sales_flow_accurate        one row per approved SO: first shipment, shipped
--                                 in full, first faktur, fully paid, and its stage
--   mg_buy_flow_accurate          one row per approved PO: first and last
--                                 Warehouse-approved receipt (D4). No price column.
--
-- Shipping state is NOT defined here. It comes from wh_so_fulfilment_accurate
-- (migration 099, the one definition of the SO promise and of "terkirim
-- lengkap"; decision "Janji kirim SO dan OTIF", Head Supply Chain 30 Sep 2026):
-- so_state, closed, shipped_on (the day the SO was shipped in full — the same
-- day the metric warehouse_ship_days measures) and data_through. Late shipping
-- is escalated once, by warehouse_so_late (providers/warehouse.js); this
-- migration adds no second rule. "Mulai dikirim" is the first surat jalan, or
-- the first faktur when the SO has none (Accurate ships on the faktur).
-- Paid = every linked faktur settled AND the SO shipped in full or closed, so a
-- part-shipped SO whose first faktur is paid is still "ditagih".
--
-- The PO flow inherits migration 098 through pc_po_accurate.due_date_eff (a Tgl
-- kirim on or before the PO date is not a promise). Receiving a PO in Accurate
-- books the goods into stock at once, so "masuk stok" is the receipt itself.
--
-- Views only over the insert-only mirror (latest approved version, not "tidak
-- ada lagi"); nothing copied, changed or removed ("TEGAS"). Each view filters
-- its record type inside its own MAX(version) table. JSON text is
-- utf8mb4_unicode_ci (lesson of 078); JSON arrays are read with
-- JSON_TABLE(JSON_EXTRACT(data, '$.x'), '$[*]') as in 099. Quantities, dates and
-- receivable amounts only: no purchase price. Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW mg_so_links_accurate AS
SELECT r.entity_id, 'delivery' COLLATE utf8mb4_unicode_ci AS doc_type, r.accurate_id AS doc_id, r.number AS doc_number,
       r.trans_date, r.outstanding_amount, j.so_number
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'delivery_order' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(JSON_EXTRACT(r.data, '$.so_numbers'), '$[*]' COLUMNS (
         so_number VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$')) j
 WHERE r.record_type = 'delivery_order' AND r.missing = 0
UNION ALL
SELECT r.entity_id, 'invoice' COLLATE utf8mb4_unicode_ci, r.accurate_id, r.number,
       r.trans_date, r.outstanding_amount, j.so_number
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'sales_invoice' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(JSON_EXTRACT(r.data, '$.so_numbers'), '$[*]' COLUMNS (
         so_number VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$')) j
 WHERE r.record_type = 'sales_invoice' AND r.missing = 0
   AND NOT COALESCE(JSON_EXTRACT(r.data, '$.dp') = TRUE, FALSE);

CREATE OR REPLACE VIEW mg_invoice_payments_accurate AS
SELECT r.entity_id, j.invoice_number,
       MIN(r.trans_date) AS first_paid_on, MAX(r.trans_date) AS last_paid_on,
       SUM(j.amount) AS paid_amount, COUNT(*) AS receipt_count
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'sales_receipt' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(JSON_EXTRACT(r.data, '$.invoices'), '$[*]' COLUMNS (
         invoice_number VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$.number',
         amount DECIMAL(18,2) PATH '$.amount')) j
 WHERE r.record_type = 'sales_receipt' AND r.missing = 0 AND j.invoice_number IS NOT NULL
 GROUP BY r.entity_id, j.invoice_number;

-- Stage: paid = every linked faktur has nothing outstanding and the SO is
-- shipped in full or closed (paid_on = the last penerimaan; NULL when Accurate
-- settled it without one); billed = at least one faktur; shipped = a surat jalan
-- but no faktur yet; closed = closed in Accurate before anything happened;
-- ordered = nothing yet. department_id is the SO's Sales / Retail Commerce division.
CREATE OR REPLACE VIEW mg_sales_flow_accurate AS
SELECT w.id AS so_id, w.entity_id, w.sales_department_id AS department_id, w.number AS so_number, w.trans_date AS ordered_on,
       w.customer_no AS customer_code, w.customer_name, w.channel, w.status AS so_status, w.percent_shipped,
       w.closed, w.so_state, w.promised_date, w.data_through,
       d.first_on AS delivered_on, COALESCE(d.docs, 0) AS delivery_count,
       COALESCE(d.first_on, b.first_on) AS started_on, w.shipped_by,
       IF(w.so_state = 'shipped', w.shipped_on, NULL) AS shipped_on,
       b.first_on AS billed_on, COALESCE(b.docs, 0) AS invoice_count, COALESCE(b.open_docs, 0) AS open_invoice_count,
       b.outstanding,
       IF(b.docs > 0 AND b.open_docs = 0 AND (w.percent_shipped >= 100 OR w.closed), b.last_paid_on, NULL) AS paid_on,
       (CASE WHEN b.docs > 0 AND b.open_docs = 0 AND (w.percent_shipped >= 100 OR w.closed) THEN 'paid'
             WHEN b.docs > 0 THEN 'billed'
             WHEN d.docs > 0 THEN 'shipped'
             WHEN w.closed THEN 'closed'
             ELSE 'ordered' END) COLLATE utf8mb4_unicode_ci AS stage
  FROM wh_so_fulfilment_accurate w
  LEFT JOIN (SELECT k.entity_id, k.so_number, MIN(k.trans_date) AS first_on, COUNT(DISTINCT k.doc_id) AS docs
               FROM mg_so_links_accurate k
              WHERE k.doc_type = 'delivery'
              GROUP BY k.entity_id, k.so_number) d
    ON d.entity_id = w.entity_id AND d.so_number = w.number
  LEFT JOIN (SELECT k.entity_id, k.so_number, MIN(k.trans_date) AS first_on, COUNT(DISTINCT k.doc_id) AS docs,
                    COUNT(DISTINCT CASE WHEN k.outstanding_amount > 0 THEN k.doc_id END) AS open_docs,
                    SUM(k.outstanding_amount) AS outstanding, MAX(p.last_paid_on) AS last_paid_on
               FROM mg_so_links_accurate k
               LEFT JOIN mg_invoice_payments_accurate p ON p.entity_id = k.entity_id AND p.invoice_number = k.doc_number
              WHERE k.doc_type = 'invoice'
              GROUP BY k.entity_id, k.so_number) b
    ON b.entity_id = w.entity_id AND b.so_number = w.number;

CREATE OR REPLACE VIEW mg_buy_flow_accurate AS
SELECT p.id AS po_id, p.entity_id, p.department_id, p.number AS po_number, p.trans_date, p.vendor_no, p.vendor_name,
       p.status, p.po_state, p.percent_received, p.expected_date, p.due_date_eff,
       g.first_on AS first_received_on, g.last_on AS last_received_on, COALESCE(g.receipts, 0) AS receipt_count,
       IF(p.po_state = 'received', g.last_on, NULL) AS completed_on
  FROM pc_po_accurate p
  LEFT JOIN (SELECT r.entity_id, r.po_number, MIN(r.received_on) AS first_on, MAX(r.received_on) AS last_on,
                    COUNT(DISTINCT r.receipt_id) AS receipts
               FROM pc_po_receipts_accurate r
              GROUP BY r.entity_id, r.po_number) g
    ON g.entity_id = p.entity_id AND g.po_number = p.number COLLATE utf8mb4_unicode_ci;
