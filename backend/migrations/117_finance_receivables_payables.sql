-- ============================================================
-- Migration 117 — Finance: piutang (receivables) and utang (payables), read only
--
--   fin_purchase_invoices_accurate   purchase invoices (faktur pembelian) from
--                                    approved Accurate data: what is owed to
--                                    vendors, due dates, PPN, term, PO numbers
--   fin_purchase_payments_accurate   purchase payments (pembayaran pembelian)
--                                    and the invoices each one settled
-- Only these two documents are mirrored for Finance. No general ledger,
-- journal, account balance, financial statement or tax record is ever copied
-- (docs/deployment.md §10: the books stay in Accurate). Piutang reads the Sales
-- views that already exist (sales_invoices_accurate, sales_receipts_accurate).
--
-- Views only over the insert-only mirror (the latest approved version of each
-- record, not "tidak ada lagi"); nothing copied, changed or removed ("TEGAS").
-- Each view takes its record type's latest version inside its own MAX(version)
-- table — the accurate_latest rule, without grouping the whole mirror (086).
-- JSON text is compared as utf8mb4_unicode_ci (078). The division is Finance's.
--
-- Permissions (mirrors backend/src/config/standardOrganization.js):
--   finance.receivable.view  both: Finance member/supervisor/head, Management
--   finance.payable.view     Office supervisor/head, and the Super Admin
--
-- Idempotent: CREATE OR REPLACE VIEW and INSERT IGNORE; no existing row changes.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW fin_purchase_invoices_accurate AS
SELECT r.accurate_id AS id, r.entity_id, r.version,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'finance' LIMIT 1) AS department_id,
       r.number AS invoice_number,
       r.trans_date,
       r.due_date,
       r.customer_no AS vendor_no,
       r.customer_name AS vendor_name,
       r.status,
       r.dpp_amount,
       r.total_amount,
       r.outstanding_amount,
       CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.tax_amount')), 'null') AS DECIMAL(18,2)) AS tax_amount,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.term')), 'null') COLLATE utf8mb4_unicode_ci AS term_name,
       CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.term_days')), 'null') AS SIGNED) AS term_days,
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.currency')), 'null'), 'IDR') COLLATE utf8mb4_unicode_ci AS currency,
       JSON_EXTRACT(r.data, '$.po_numbers') AS po_numbers,
       COALESCE(JSON_EXTRACT(r.data, '$.dp') = TRUE, FALSE) AS is_dp,
       r.batch_id,
       r.created_at AS approved_at
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'fin_purchase_invoice' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.record_type = 'fin_purchase_invoice' AND r.missing = 0;

CREATE OR REPLACE VIEW fin_purchase_payments_accurate AS
SELECT r.accurate_id AS id, r.entity_id, r.version,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'finance' LIMIT 1) AS department_id,
       r.number AS payment_number,
       r.trans_date,
       r.customer_no AS vendor_no,
       r.customer_name AS vendor_name,
       r.total_amount,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.bank')), 'null') COLLATE utf8mb4_unicode_ci AS bank,
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.currency')), 'null'), 'IDR') COLLATE utf8mb4_unicode_ci AS currency,
       JSON_EXTRACT(r.data, '$.invoices') AS invoices,
       r.batch_id,
       r.created_at AS approved_at
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'fin_purchase_payment' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.record_type = 'fin_purchase_payment' AND r.missing = 0;

-- ------------------------------------------------------------ permissions
INSERT IGNORE INTO permissions (code, description) VALUES
('finance.receivable.view', 'Lihat Piutang (Finance): umur piutang, pelanggan terlambat bayar, faktur jatuh tempo, dan penerimaan pembayaran dari data Accurate'),
('finance.payable.view', 'Lihat Utang (Finance): faktur pembelian yang belum dibayar, umur utang per pemasok, jatuh tempo, dan pembayaran pembelian dari data Accurate');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('finance.receivable.view', 'finance.payable.view')
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('finance.member', 'finance.supervisor', 'finance.head',
                      'management_office.supervisor', 'management_office.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('finance.receivable.view', 'finance.payable.view')
 WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
