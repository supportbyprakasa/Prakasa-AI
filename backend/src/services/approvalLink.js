// Where a notification about an approval should open: the page of the thing
// being decided, since the generic /approvals page is closed (navigation.js
// BLOCKED_ROUTES). Unknown subjects fall back to /approvals/:id.
const PAGES = {
  warehouse_inbound: (id) => `/warehouse/movements/inbound/${id}`,
  warehouse_outbound: (id) => `/warehouse/movements/outbound/${id}`,
  sales_accurate_batch: (id) => `/data-accurate/${id}`,
  sales_accurate_sync: (id) => `/data-accurate/${id}`,
  ga_request: (id) => `/ga/requests/${id}`,
  finance_workflow: (id) => `/finance/payment-requests/${id}`,
  finance_payment_request: (id) => `/finance/payment-requests/${id}`,
  finance_reimbursement: (id) => `/finance/payment-requests/${id}`,
  ga_request_other: (id) => `/ga/requests/${id}`,
  ga_booking: (id) => `/ga/bookings/${id}`,
  ga_vehicle_booking: (id) => `/ga/bookings/${id}`,
  hrga_workflow: (id) => `/hrga/workflows/${id}`,
  hrga_onboarding: (id) => `/hrga/workflows/${id}`,
  hrga_offboarding: (id) => `/hrga/workflows/${id}`,
};

function approvalActionUrl({ id, subjectType, subjectId }) {
  const page = PAGES[subjectType];
  return page && subjectId != null ? page(subjectId) : `/approvals/${id}`;
}

module.exports = { approvalActionUrl, PAGES };
