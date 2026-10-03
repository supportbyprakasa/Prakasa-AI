// Customer status, exactly as the Sales Data Tracker computes it (verified
// against the sheet: 44 Aktif / 13 Dormant / 321 Lost on 2026-09-28):
//   last order < 30 days ago → Aktif
//   30–59 days              → Dormant
//   60+ days, or no order   → Lost
// One definition, used by the pages, the funnel and the management provider.

const ACTIVE_DAYS = 30;
const LOST_DAYS = 60;
// A first order this recent counts as a new customer (NOO) in the funnel.
const NEW_CUSTOMER_DAYS = 30;
// A visited outlet that is still not a customer this long after its last visit
// is a prospect going cold: flagged on the Leads page and to management.
const LEAD_FOLLOWUP_DAYS = 14;

const STATUSES = ['aktif', 'dormant', 'lost'];

// Which division a synced record reports to (owner's decision, 2026-09-29):
// e-Commerce orders belong to Retail Commerce, everything else to Sales. A
// customer follows the channel of its latest order; one that never ordered
// follows its category in the Customer List (marketplace stores = e-Commerce).
const DEFAULT_DIVISION = 'sales';
const ORDER_CHANNEL_DIVISION = Object.freeze({ 'e-Commerce': 'retail_commerce' });
const CUSTOMER_CATEGORY_DIVISION = Object.freeze({ Shopee: 'retail_commerce', TokoPedia: 'retail_commerce' });

function divisionForOrderChannel(channel) {
  return ORDER_CHANNEL_DIVISION[channel] || DEFAULT_DIVISION;
}

function divisionForCustomerCategory(category) {
  return CUSTOMER_CATEGORY_DIVISION[category] || DEFAULT_DIVISION;
}

// An Accurate record's channel (read from the customer number, e.g. Shopee,
// TokoPedia, FoodService): the same rule as the app's customer categories —
// Shopee/TokoPedia to Retail Commerce, everything else to Sales.
function divisionForAccurateChannel(channel) {
  return CUSTOMER_CATEGORY_DIVISION[channel] || DEFAULT_DIVISION;
}

// SQL expression for a customer row aliased `alias`.
function statusSql(alias = 'c') {
  return `CASE
    WHEN ${alias}.last_order_date IS NULL THEN 'lost'
    WHEN DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${alias}.last_order_date) < ${ACTIVE_DAYS} THEN 'aktif'
    WHEN DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${alias}.last_order_date) < ${LOST_DAYS} THEN 'dormant'
    ELSE 'lost' END`;
}

// Funnel stage: where the account stands on the way from first visit to
// repeat buyer. Derived from events only — nobody drags a card.
function stageSql(alias = 'c') {
  return `CASE
    WHEN ${alias}.last_order_date IS NULL THEN 'belum_order'
    WHEN DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${alias}.last_order_date) >= ${LOST_DAYS} THEN 'lost'
    WHEN DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${alias}.last_order_date) >= ${ACTIVE_DAYS} THEN 'dormant'
    WHEN ${alias}.noo_date IS NOT NULL AND DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${alias}.noo_date) < ${NEW_CUSTOMER_DAYS} THEN 'order_pertama'
    ELSE 'aktif' END`;
}

module.exports = {
  ACTIVE_DAYS, LOST_DAYS, NEW_CUSTOMER_DAYS, LEAD_FOLLOWUP_DAYS, STATUSES, statusSql, stageSql,
  DEFAULT_DIVISION, CUSTOMER_CATEGORY_DIVISION, divisionForOrderChannel, divisionForCustomerCategory, divisionForAccurateChannel,
};
