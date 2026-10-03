-- ============================================================
-- Migration 089 — Procurement: "Saran pesan ulang" (docs/program-4-divisi.md 3.1)
--
--   procurement.reorder.view    see reorder suggestions with the item's TOTAL
--                               stock and days of cover (D2 extended by the
--                               Head Supply Chain, 30 Sep 2026): Procurement
--                               Supervisor/Head and Management Office
--                               Supervisor/Head. Never a Procurement member;
--                               stock per gudang stays Warehouse + MO. Purchase
--                               prices stay behind procurement.price.view (P1).
--   pc_item_last_po_accurate    per item: its latest PO line that was not
--                               cancelled (closed with nothing received) — the
--                               vendor to reorder from and the purchase unit with
--                               its ratio (base units per purchase unit).
--                               Quantities only; NO price column.
-- View only over the insert-only mirror (latest approved PO versions via
-- pc_po_lines_accurate / pc_po_accurate); nothing copied, changed or removed
-- ("TEGAS"). Mirrors backend/src/config/standardOrganization.js. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('procurement.reorder.view', 'Lihat saran pesan ulang dengan stok total dan hari-cukup dari Accurate (tanpa stok per gudang)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'procurement.reorder.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('procurement.supervisor', 'procurement.head', 'management_office.supervisor', 'management_office.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'procurement.reorder.view'
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;

CREATE OR REPLACE VIEW pc_item_last_po_accurate AS
SELECT z.entity_id, z.department_id, z.item_no, z.item_name, z.vendor_no, z.vendor_name,
       z.unit, z.ratio, z.qty, z.po_id, z.po_number, z.trans_date
  FROM (SELECT l.entity_id, l.department_id, l.item_no, l.item_name, l.vendor_no, p.vendor_name,
               l.unit, COALESCE(NULLIF(l.unit_ratio, 0), 1) AS ratio, l.qty, l.po_id, l.po_number, l.trans_date,
               ROW_NUMBER() OVER (PARTITION BY l.entity_id, l.item_no
                                  ORDER BY l.trans_date DESC, l.po_id DESC, l.line_no DESC) AS rn
          FROM pc_po_lines_accurate l
          JOIN pc_po_accurate p ON p.entity_id = l.entity_id AND p.id = l.po_id
         WHERE l.item_no IS NOT NULL AND l.qty > 0
           AND NOT (p.po_state = 'closed' AND COALESCE(p.percent_received, 0) = 0)) z
 WHERE z.rn = 1;
