-- Marketing reads sales through Marketing insights (per channel and product),
-- never the order book or receivables (test/standardRoleNeeds.test.js).
-- Migration 052 granted sales.order.view to every role holding
-- sales.customer.view, which included Marketing; the final UAT (1 Oct 2026)
-- found the "Data Sales" menu and /sales/orders open for marketing.*. This
-- revokes that one grant from the three Marketing roles only. Permission
-- grants only; no business data. Idempotent.
SET NAMES utf8mb4;

DELETE rp
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE r.role_key IN ('marketing.member', 'marketing.supervisor', 'marketing.head')
   AND p.code IN ('sales.order.view', 'sales.order.manage', 'sales.receivable.view');
