// The one set of rules for reading Accurate sales invoices (sales_invoices_accurate),
// so Sales, Retail Commerce, Finance, Marketing and management count the same
// invoices (data-consistency audit, decisions of the product/finance lead).
//
//   Down payment (is_dp)  — Finance rule: never a receivable, never overdue,
//                           never revenue. Shown apart where a page already does.
//   Opening balance       — Accurate's opening balance (is_opening, migration 125):
//                           invoices dated on or before OPENING_BALANCE_DATE with no
//                           product line and no sales order. Still owed, so they stay
//                           in receivables; not revenue and not a first order (NOO).
//                           sales_revenue_accurate already leaves both out.
//
// OPENING_BALANCE_DATE is written into the view by migration 125 (a view cannot
// read the environment); test/invoiceRules.test.js keeps the two in step. A new
// opening date needs a new migration.

const OPENING_BALANCE_DATE = '2025-12-31';

// Retail Commerce revenue is billed as ONE recap invoice per marketplace per
// month, dated the month's last day: during a running month its figure is 0 by
// design, not a shortfall. A metric declares `billedMonthly` (true, or the
// division codes it applies to); Target & realisasi then judges no pace for it
// in a running period, and the dashboards show the last complete month.
const BILLED_MONTHLY_DIVISIONS = Object.freeze(['retail_commerce']);

/** Whether `metric` is billed monthly for the division with this code. */
function billedMonthlyFor(metric, divisionCode) {
  const b = metric?.billedMonthly;
  if (b === true) return true;
  return Array.isArray(b) && divisionCode != null && b.includes(divisionCode);
}

/** An invoice that counts as money owed (receivables, overdue): not a down payment. */
const receivableSql = (alias = 'i') => `NOT ${alias}.is_dp`;
/** Money still owed on it. */
const openReceivableSql = (alias = 'i') => `${receivableSql(alias)} AND ${alias}.outstanding_amount > 0`;
/** An invoice that is a sale (revenue, order counts): not a down payment, not the opening balance. */
const revenueInvoiceSql = (alias = 'i') => `NOT ${alias}.is_dp AND NOT ${alias}.is_opening`;

module.exports = {
  OPENING_BALANCE_DATE, BILLED_MONTHLY_DIVISIONS, billedMonthlyFor, receivableSql, openReceivableSql, revenueInvoiceSql,
};
